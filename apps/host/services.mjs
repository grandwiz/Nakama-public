import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ApiError, now, redact } from "./security.mjs";

const ORIGINS = Object.freeze({
  github: "https://api.github.com",
  vercel: "https://api.vercel.com",
  render: "https://api.render.com",
  neon: "https://console.neon.tech",
  resend: "https://api.resend.com",
});
const LIMIT = 30;
const MAX_RESPONSE = 2 * 1024 * 1024;
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const plain = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const clean = (value, max = 500) =>
  typeof value === "string"
    ? redact(value).slice(0, max)
    : value == null
      ? ""
      : String(value).slice(0, max);
const rows = (value) => {
  if (!Array.isArray(value))
    throw new ApiError(502, "The provider returned an unexpected list format.");
  return value.slice(0, LIMIT);
};
function identifier(value, label = "Identifier") {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new ApiError(400, `${label} is invalid.`);
  return value;
}
function field(value, label, max = 500, { multiline = false } = {}) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0") ||
    (!multiline && /[\r\n]/.test(value))
  )
    throw new ApiError(400, `${label} must contain 1-${max} valid characters.`);
  return multiline ? value : value.trim();
}
function keys(body, allowed) {
  if (!plain(body) || Object.keys(body).some((key) => !allowed.includes(key)))
    throw new ApiError(400, "Unexpected service request fields.");
}
function email(value, label) {
  const address = field(value, label, 254);
  if (
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(
      address,
    )
  )
    throw new ApiError(400, `${label} must be a plain email address.`);
  return address;
}
function publicUrl(value, { vercel = false } = {}) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(
      vercel && !value.includes("://") ? `https://${value}` : value,
    );
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}
function query(path, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== "")
      search.set(key, String(value));
  return `${path}${search.size ? "?" + search : ""}`;
}

/** Fixed-origin, narrowly scoped adapters. Tokens are read from the host vault only. */
export class ServiceConnections {
  constructor({ store, vault, fetchImpl = globalThis.fetch }) {
    this.store = store;
    this.vault = vault;
    this.fetchImpl = fetchImpl;
  }
  account(provider, accountId) {
    if (!Object.hasOwn(ORIGINS, provider))
      throw new ApiError(400, "Unsupported service provider.");
    identifier(accountId, "Account ID");
    const connection = this.store.state.connections.find(
      (item) => item.id === provider,
    );
    const account = connection?.accounts?.find((item) => item.id === accountId);
    if (!account)
      throw new ApiError(404, "Select a saved account for this provider.");
    return account;
  }
  async githubRepository(accountId, repository) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
        repository,
      )
    )
      throw new ApiError(400, "Choose a GitHub owner/repository.");
    const result = await this.#request(
      "github",
      accountId,
      "GET",
      `/repos/${repository}`,
    );
    if (
      !Number.isSafeInteger(result.id) ||
      typeof result.full_name !== "string" ||
      result.full_name.toLowerCase() !== repository.toLowerCase() ||
      typeof result.default_branch !== "string"
    )
      throw new ApiError(
        502,
        "GitHub returned an unexpected repository identity.",
      );
    return {
      repositoryId: String(result.id),
      repository: result.full_name,
      defaultBranch: result.default_branch,
      private: result.private === true,
      url: `https://github.com/${result.full_name}`,
    };
  }
  async #request(provider, accountId, method, path, body, extraHeaders = {}) {
    this.account(provider, accountId);
    if (!this.vault)
      throw new ApiError(
        503,
        "Open the Windows app to use its protected credential vault.",
      );
    const token = await this.vault.get(`${provider}:${accountId}`);
    if (
      typeof token !== "string" ||
      !token ||
      token.length > 16000 ||
      /[\r\n\0]/.test(token)
    )
      throw new ApiError(
        409,
        "This account has no usable saved API credential.",
      );
    const url = new URL(path, ORIGINS[provider]);
    if (
      url.origin !== ORIGINS[provider] ||
      url.protocol !== "https:" ||
      url.username ||
      url.password
    )
      throw new ApiError(
        400,
        "Service requests must use their fixed HTTPS provider origin.",
      );
    let response;
    try {
      response = await this.fetchImpl(url.href, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "Nakama/0.1",
          ...(provider === "github"
            ? { "X-GitHub-Api-Version": "2022-11-28" }
            : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError(
        502,
        `${provider} did not return a confirmed response. Check the provider dashboard before repeating a write action.`,
      );
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw new ApiError(
        response.status === 429 ? 429 : 502,
        `${provider} returned HTTP ${response.status}. Check the account, permissions and provider dashboard. Provider error bodies are hidden to protect credentials.`,
      );
    }
    let raw;
    try {
      if (Number(response.headers?.get?.("content-length") || 0) > MAX_RESPONSE)
        throw new Error("oversize");
      const reader = response.body?.getReader?.();
      if (reader) {
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE) {
              await reader.cancel();
              throw new Error("oversize");
            }
            chunks.push(Buffer.from(value));
          }
        } finally {
          reader.releaseLock();
        }
        raw = Buffer.concat(chunks).toString("utf8");
      } else {
        raw = await response.text();
        if (Buffer.byteLength(raw) > MAX_RESPONSE) throw new Error("oversize");
      }
      // Defend against a provider accidentally echoing this request's credential in a public field.
      return JSON.parse(raw.split(token).join("[credential removed]"));
    } catch {
      throw new ApiError(
        502,
        `${provider} returned an invalid or oversized JSON response. No completion is assumed.`,
      );
    }
  }
  async list(provider, accountId, resource, params = {}) {
    this.account(provider, accountId);
    keys(params, [
      "teamId",
      "remoteProjectId",
      "serviceId",
      "branchId",
      "owner",
      "repo",
      "orgId",
      "cursor",
      "page",
    ]);
    const optionalId = (key, label) =>
      params[key] === undefined || params[key] === ""
        ? undefined
        : identifier(params[key], label);
    const teamId = optionalId("teamId", "Team ID");
    const cursor =
      params.cursor === undefined || params.cursor === ""
        ? undefined
        : field(params.cursor, "Cursor", 500);
    let data,
      items = [],
      nextCursor = null,
      hasMore = false;
    if (provider === "github" && resource === "repositories") {
      const page = Number(params.page ?? cursor ?? 1);
      if (!Number.isInteger(page) || page < 1 || page > 1000)
        throw new ApiError(400, "Invalid repository page.");
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query("/user/repos", { per_page: LIMIT, sort: "updated", page }),
      );
      items = rows(data).map((r) => ({
        id: clean(r.id),
        name: clean(r.full_name || r.name),
        url: publicUrl(r.html_url),
        private: r.private === true,
        defaultBranch: clean(r.default_branch),
        updatedAt: clean(r.updated_at),
      }));
      hasMore = items.length === LIMIT;
      nextCursor = hasMore ? String(page + 1) : null;
    } else if (provider === "github" && resource === "deployments") {
      const owner = identifier(params.owner, "Repository owner"),
        repo = identifier(params.repo, "Repository name");
      const page = Number(params.page ?? cursor ?? 1);
      if (!Number.isInteger(page) || page < 1 || page > 1000)
        throw new ApiError(400, "Invalid deployment page.");
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query(`/repos/${owner}/${repo}/deployments`, { per_page: LIMIT, page }),
      );
      items = rows(data).map((d) => ({
        id: clean(d.id),
        name: clean(d.ref),
        status: clean(d.environment),
        commitId: clean(d.sha),
        createdAt: clean(d.created_at),
      }));
      hasMore = items.length === LIMIT;
      nextCursor = hasMore ? String(page + 1) : null;
    } else if (provider === "vercel" && resource === "projects") {
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query("/v9/projects", { limit: LIMIT, teamId, from: cursor }),
      );
      items = rows(data.projects).map((p) => ({
        id: clean(p.id),
        name: clean(p.name),
        framework: clean(p.framework),
        repoId: clean(p.link?.repoId),
        repository: clean(p.link?.repo),
        gitProvider: clean(p.link?.type),
        updatedAt: clean(p.updatedAt),
      }));
      nextCursor = data.pagination?.next ? String(data.pagination.next) : null;
      hasMore = !!nextCursor;
    } else if (provider === "vercel" && resource === "deployments") {
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query("/v7/deployments", {
          limit: LIMIT,
          teamId,
          projectId: optionalId("remoteProjectId", "Vercel project ID"),
          until: cursor,
        }),
      );
      items = rows(data.deployments).map((d) => ({
        id: clean(d.uid || d.id),
        name: clean(d.name),
        url: publicUrl(d.url, { vercel: true }),
        status: clean(d.readyState || d.state),
        target: clean(d.target || "preview"),
        createdAt: clean(d.created),
      }));
      nextCursor = data.pagination?.next ? String(data.pagination.next) : null;
      hasMore = !!nextCursor;
    } else if (provider === "render" && resource === "services") {
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query("/v1/services", { limit: LIMIT, cursor }),
      );
      items = rows(data)
        .map((row) => row.service || row)
        .map((s) => ({
          id: clean(s.id),
          name: clean(s.name),
          type: clean(s.type),
          status: clean(s.suspended || "active"),
          url: publicUrl(s.serviceDetails?.url),
          repository: publicUrl(s.repo),
          branch: clean(s.branch),
          autoDeploy: clean(s.autoDeploy),
        }));
      hasMore = items.length === LIMIT;
      nextCursor = hasMore ? clean(data.at(-1)?.cursor) : null;
    } else if (provider === "render" && resource === "deployments") {
      const serviceId = identifier(params.serviceId, "Render service ID");
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query(`/v1/services/${serviceId}/deploys`, { limit: LIMIT, cursor }),
      );
      items = rows(data)
        .map((row) => row.deploy || row)
        .map((d) => ({
          id: clean(d.id),
          name: clean(d.commit?.message || d.id),
          status: clean(d.status),
          commitId: clean(d.commit?.id),
          createdAt: clean(d.createdAt),
          finishedAt: clean(d.finishedAt),
        }));
      hasMore = items.length === LIMIT;
      nextCursor = hasMore ? clean(data.at(-1)?.cursor) : null;
    } else if (provider === "neon" && resource === "projects") {
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query("/api/v2/projects", {
          limit: LIMIT,
          org_id: optionalId("orgId", "Neon organisation ID"),
          cursor,
        }),
      );
      items = rows(data.projects).map((p) => ({
        id: clean(p.id),
        name: clean(p.name),
        region: clean(p.region_id),
        createdAt: clean(p.created_at),
      }));
      nextCursor = data.pagination?.cursor || data.pagination?.next || null;
      hasMore = !!nextCursor;
    } else if (provider === "neon" && resource === "branches") {
      const id = identifier(params.remoteProjectId, "Neon project ID");
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query(`/api/v2/projects/${id}/branches`, { limit: LIMIT, cursor }),
      );
      items = rows(data.branches).map((b) => ({
        id: clean(b.id),
        name: clean(b.name),
        status: clean(b.current_state),
        parentId: clean(b.parent_id),
        createdAt: clean(b.created_at),
      }));
      nextCursor = data.pagination?.next || null;
      hasMore = !!nextCursor;
    } else if (provider === "neon" && resource === "databases") {
      const id = identifier(params.remoteProjectId, "Neon project ID"),
        branchId = identifier(params.branchId, "Neon branch ID");
      data = await this.#request(
        provider,
        accountId,
        "GET",
        `/api/v2/projects/${id}/branches/${branchId}/databases`,
      );
      items = rows(data.databases).map((d) => ({
        id: clean(d.id || d.name),
        name: clean(d.name),
        owner: clean(d.owner_name),
        branchId: clean(d.branch_id),
        createdAt: clean(d.created_at),
      }));
      hasMore = Array.isArray(data.databases) && data.databases.length > LIMIT;
    } else if (provider === "resend" && resource === "domains") {
      data = await this.#request(
        provider,
        accountId,
        "GET",
        query("/domains", { limit: LIMIT, after: cursor }),
      );
      items = rows(data.data).map((d) => ({
        id: clean(d.id),
        name: clean(d.name),
        status: clean(d.status),
        region: clean(d.region),
        createdAt: clean(d.created_at),
      }));
      hasMore = data.has_more === true;
      nextCursor = hasMore ? clean(data.data?.at(-1)?.id) : null;
    } else
      throw new ApiError(
        400,
        "That read-only resource is not implemented for this provider.",
      );
    return {
      provider,
      accountId,
      resource,
      items,
      hasMore,
      nextCursor: nextCursor ? clean(nextCursor) : null,
      limit: LIMIT,
    };
  }
  prepareDeployment(body) {
    keys(body, [
      "provider",
      "accountId",
      "projectId",
      "serviceId",
      "commitId",
      "vercelProjectId",
      "deploymentName",
      "repoId",
      "ref",
      "target",
      "teamId",
    ]);
    if (!["render", "vercel"].includes(body.provider))
      throw new ApiError(400, "Select Render or Vercel for deployment.");
    this.account(body.provider, body.accountId);
    const projectId = identifier(body.projectId, "Local project ID");
    if (!this.store.state.projects.some((p) => p.id === projectId))
      throw new ApiError(404, "Select an existing Nakama project.");
    if (
      typeof body.commitId !== "string" ||
      !/^[a-f0-9]{40}$/i.test(body.commitId)
    )
      throw new ApiError(
        400,
        "Deployment requires the exact 40-character Git commit SHA.",
      );
    const operation = {
      provider: body.provider,
      accountId: body.accountId,
      projectId,
      commitId: body.commitId.toLowerCase(),
    };
    if (body.provider === "render") {
      if (
        Object.keys(body).some(
          (key) =>
            ![
              "provider",
              "accountId",
              "projectId",
              "serviceId",
              "commitId",
            ].includes(key),
        )
      )
        throw new ApiError(400, "Unexpected Render deployment fields.");
      operation.serviceId = identifier(body.serviceId, "Render service ID");
    } else {
      if (body.serviceId !== undefined)
        throw new ApiError(
          400,
          "Vercel deployments use a Vercel project, not a Render service.",
        );
      operation.vercelProjectId = identifier(
        body.vercelProjectId,
        "Vercel project ID",
      );
      operation.deploymentName = field(
        body.deploymentName,
        "Vercel project name",
        100,
      );
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(operation.deploymentName))
        throw new ApiError(400, "Use the exact Vercel project name.");
      if (typeof body.repoId !== "string" || !/^\d{1,20}$/.test(body.repoId))
        throw new ApiError(
          400,
          "Use the numeric GitHub repository ID linked to Vercel.",
        );
      operation.repoId = body.repoId;
      operation.ref = field(body.ref, "Git branch or tag", 200);
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(operation.ref) ||
        operation.ref.includes("..")
      )
        throw new ApiError(400, "Use a simple Git branch or tag.");
      operation.target = body.target || "preview";
      if (!["preview", "production"].includes(operation.target))
        throw new ApiError(
          400,
          "Deployment target must be preview or production.",
        );
      if (body.teamId)
        operation.teamId = identifier(body.teamId, "Vercel team ID");
    }
    return operation;
  }
  #approval(id, type) {
    const approval = this.store.state.approvals.find((a) => a.id === id);
    if (!approval || approval.type !== type || approval.status !== "executing")
      throw new ApiError(
        403,
        "A matching stored desktop approval must be executing.",
      );
    if (
      !Number.isFinite(Date.parse(approval.expiresAt)) ||
      Date.parse(approval.expiresAt) <= Date.now()
    )
      throw new ApiError(
        409,
        "This approval expired. Request fresh desktop approval.",
      );
    return approval;
  }
  async deploy(approvalId) {
    const saved = this.#approval(approvalId, "deploy");
    const operation = this.prepareDeployment(saved.operation);
    if (!isDeepStrictEqual(operation, saved.operation))
      throw new ApiError(
        409,
        "The stored deployment operation is not canonical. Request a fresh deployment approval.",
      );
    const receipt = await this.store.change((s) => {
      const approval = this.#approval(approvalId, "deploy");
      if (!isDeepStrictEqual(approval.operation, operation))
        throw new ApiError(
          409,
          "The approved deployment target changed. Request a fresh approval.",
        );
      if (approval.serviceExecution)
        throw new ApiError(
          409,
          "This deployment was already attempted. Inspect the provider dashboard before creating a new approval.",
        );
      approval.serviceExecution = { status: "started", startedAt: now() };
      return approval.serviceExecution;
    });
    try {
      let result;
      if (operation.provider === "render") {
        const data = await this.#request(
          "render",
          operation.accountId,
          "POST",
          `/v1/services/${operation.serviceId}/deploys`,
          { commitId: operation.commitId, clearCache: "do_not_clear" },
        );
        if (typeof data.id !== "string" || !data.id)
          throw new ApiError(
            502,
            "Render did not return a deployment ID. Check its dashboard before retrying.",
          );
        result = {
          provider: "render",
          id: clean(data.id),
          status: "submitted",
          providerStatus: clean(data.status),
          serviceId: operation.serviceId,
          url: "https://dashboard.render.com/",
          message:
            "Render accepted the deployment request. Build completion and health are not verified.",
        };
      } else {
        const body = {
          name: operation.deploymentName,
          project: operation.vercelProjectId,
          gitSource: {
            type: "github",
            repoId: operation.repoId,
            ref: operation.ref,
            sha: operation.commitId,
          },
          ...(operation.target === "production"
            ? { target: "production" }
            : {}),
        };
        const data = await this.#request(
          "vercel",
          operation.accountId,
          "POST",
          query("/v13/deployments", { teamId: operation.teamId }),
          body,
        );
        if (typeof data.id !== "string" || !data.id)
          throw new ApiError(
            502,
            "Vercel did not return a deployment ID. Check its dashboard before retrying.",
          );
        result = {
          provider: "vercel",
          id: clean(data.id),
          status: "submitted",
          providerStatus: clean(data.readyState),
          target: operation.target,
          url: publicUrl(data.url, { vercel: true }),
          message:
            "Vercel accepted the deployment request. Build completion and health are not verified.",
        };
      }
      await this.store.change((s) => {
        receipt.status = "submitted";
        receipt.result = result;
        receipt.finishedAt = now();
        this.store.audit(
          s,
          "service.deployment_submitted",
          { id: saved.requestedBy },
          `${operation.provider}: ${result.id}`,
        );
      });
      return result;
    } catch (error) {
      await this.store.change(() => {
        receipt.status = "unconfirmed";
        receipt.finishedAt = now();
        receipt.error = clean(error.message, 1000);
      });
      throw error;
    }
  }
  prepareEmail(body) {
    keys(body, [
      "provider",
      "accountId",
      "requestId",
      "from",
      "to",
      "subject",
      "text",
    ]);
    if (body.provider !== undefined && body.provider !== "resend")
      throw new ApiError(400, "This email adapter uses Resend.");
    this.account("resend", body.accountId);
    const requestId = identifier(body.requestId, "Stable request ID");
    if (requestId.length < 12)
      throw new ApiError(
        400,
        "Use a stable request ID at least 12 characters long.",
      );
    if (!Array.isArray(body.to) || body.to.length < 1 || body.to.length > 10)
      throw new ApiError(400, "Provide 1-10 explicit email recipients.");
    return {
      provider: "resend",
      accountId: body.accountId,
      requestId,
      from: email(body.from, "From"),
      to: body.to.map((value, i) => email(value, `Recipient ${i + 1}`)),
      subject: field(body.subject, "Subject", 300),
      text: field(body.text, "Email text", 100000, { multiline: true }),
    };
  }
  async sendEmail(input, { principal, approvalId } = {}) {
    if (
      principal?.kind !== "owner" &&
      !(
        principal?.kind === "device" &&
        this.store.state.devices.some((d) => d.id === principal.id)
      )
    )
      throw new ApiError(
        403,
        "Email must come from an authenticated direct user request.",
      );
    const operation = this.prepareEmail(input);
    if (approvalId) {
      const approval = this.#approval(approvalId, "service_email");
      if (!isDeepStrictEqual(approval.operation, operation))
        throw new ApiError(
          403,
          "Email does not match the exact stored desktop approval.",
        );
    } else if (this.store.state.config.confirmOrdinaryActions)
      throw new ApiError(403, "This email needs a stored desktop approval.");
    const key = `resend:${operation.accountId}:${operation.requestId}`,
      fingerprint = sha256(JSON.stringify(operation));
    const claim = await this.store.change((s) => {
      if (approvalId) {
        const approval = this.#approval(approvalId, "service_email");
        if (!isDeepStrictEqual(approval.operation, operation))
          throw new ApiError(403, "Email approval changed.");
      }
      s.serviceRequests ??= [];
      const existing = s.serviceRequests.find((item) => item.key === key);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ApiError(
            409,
            "This request ID was already used for different email content.",
          );
        if (existing.status === "accepted")
          return { cached: structuredClone(existing.result) };
        throw new ApiError(
          409,
          "This email was already attempted. Check Resend before creating another request; automatic duplicate sends are blocked.",
        );
      }
      const receipt = { key, fingerprint, status: "started", startedAt: now() };
      s.serviceRequests.push(receipt);
      return { receipt };
    });
    if (claim.cached) return claim.cached;
    try {
      const data = await this.#request(
        "resend",
        operation.accountId,
        "POST",
        "/emails",
        {
          from: operation.from,
          to: operation.to,
          subject: operation.subject,
          text: operation.text,
        },
        { "Idempotency-Key": `nakama-${sha256(key)}` },
      );
      if (typeof data.id !== "string" || !data.id)
        throw new ApiError(
          502,
          "Resend did not return an email ID. Check Resend before repeating the send.",
        );
      const result = {
        provider: "resend",
        id: clean(data.id),
        status: "accepted",
        message: "Resend accepted the email. Delivery has not been verified.",
      };
      await this.store.change((s) => {
        claim.receipt.status = "accepted";
        claim.receipt.result = result;
        claim.receipt.finishedAt = now();
        this.store.audit(
          s,
          "service.email_accepted",
          principal,
          `resend: ${result.id}`,
        );
      });
      return result;
    } catch (error) {
      await this.store.change(() => {
        claim.receipt.status = "unconfirmed";
        claim.receipt.finishedAt = now();
        claim.receipt.error = clean(error.message, 1000);
      });
      throw error;
    }
  }
}
