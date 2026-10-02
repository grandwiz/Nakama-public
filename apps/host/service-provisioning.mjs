import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";
import {
  ApiError,
  digest,
  now,
  redact,
  requireOwner,
  uid,
} from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";

// No caller-supplied endpoints, billing, purchase, deletion, shell, or provider hooks.
const ORIGINS = Object.freeze({
  github: "https://api.github.com",
  vercel: "https://api.vercel.com",
  render: "https://api.render.com",
  neon: "https://console.neon.tech",
  namecheap: "https://api.namecheap.com",
});
export const PROVISIONING_LIMITS = Object.freeze({
  responseBytes: 2 * 1024 * 1024,
  secretBytes: 16000,
  plans: 500,
  operations: 500,
  secrets: 100,
  planMinutes: 30,
});
const ACTIONS = Object.freeze({
  "github.repository.create": [
    "name",
    "private",
    "description",
    "organization",
  ],
  "vercel.project.create": ["name", "teamId", "framework"],
  "vercel.deployment.create": [
    "remoteProjectId",
    "name",
    "repoId",
    "ref",
    "commitId",
    "target",
    "teamId",
  ],
  "vercel.environment.set": [
    "remoteProjectId",
    "key",
    "secretRef",
    "target",
    "teamId",
  ],
  "vercel.domain.add": ["remoteProjectId", "domain", "teamId"],
  "render.service.create": [
    "name",
    "ownerId",
    "repository",
    "branch",
    "runtime",
    "buildCommand",
    "startCommand",
    "region",
    "plan",
    "rootDirectory",
  ],
  "render.environment.set": ["serviceId", "key", "secretRef"],
  "render.deployment.create": ["serviceId", "commitId"],
  "neon.project.create": [
    "name",
    "regionId",
    "orgId",
    "pgVersion",
    "storeConnection",
  ],
  "neon.connection.store": [
    "remoteProjectId",
    "branchId",
    "databaseName",
    "roleName",
    "pooled",
  ],
  "namecheap.nameservers.set": ["sld", "tld", "nameservers"],
});
export const ACTION_SCHEMAS = ACTIONS;
const providerStatus = (value) =>
  [
    "queued",
    "pending",
    "running",
    "finished",
    "failed",
    "skipped",
    "scheduling",
    "build_in_progress",
    "update_in_progress",
    "live",
    "deactivated",
    "build_failed",
    "update_failed",
    "pre_deploy_in_progress",
    "pre_deploy_failed",
    "canceled",
    "created",
    "QUEUED",
    "INITIALIZING",
    "BUILDING",
    "READY",
    "ERROR",
    "CANCELED",
  ].includes(value)
    ? value
    : "unknown";
const clone = (v) => structuredClone(v);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function keys(v, allowed) {
  if (!plain(v) || Object.keys(v).some((k) => !allowed.includes(k)))
    throw new ApiError(400, "Unexpected provisioning fields.");
}
function str(v, label, max = 160) {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    /[\x00-\x1f\x7f]/.test(v) ||
    redact(v) !== v
  )
    throw new ApiError(
      400,
      `${label} must be valid non-secret text (1-${max} characters).`,
    );
  return v.trim();
}
function id(v, label = "Identifier") {
  v = str(v, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(v) || v.includes(".."))
    throw new ApiError(400, `${label} is invalid.`);
  return v;
}
function bool(v, fallback) {
  if (v === undefined) return fallback;
  if (typeof v !== "boolean")
    throw new ApiError(400, "Expected a boolean setting.");
  return v;
}
function choice(v, list, label) {
  if (!list.includes(v)) throw new ApiError(400, `Unsupported ${label}.`);
  return v;
}
function dns(v) {
  v = str(v, "DNS name", 253).toLowerCase();
  if (
    !v.includes(".") ||
    !v
      .split(".")
      .every((p) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)) ||
    isIP(v)
  )
    throw new ApiError(400, "Use a plain DNS name without a URL or wildcard.");
  return v;
}
function repo(v) {
  v = str(v, "GitHub owner/repository", 201);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
      v,
    ) ||
    v.includes("..")
  )
    throw new ApiError(400, "Use a GitHub owner/repository.");
  return v;
}
function ref(v) {
  v = str(v, "Git ref", 200);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v) ||
    v.includes("..") ||
    v.endsWith("/") ||
    v.includes("//")
  )
    throw new ApiError(400, "Use a simple Git branch or tag.");
  return v;
}
function sha(v) {
  if (typeof v !== "string" || !/^[a-f0-9]{40}$/i.test(v))
    throw new ApiError(
      400,
      "Deployment requires an exact 40-character commit SHA.",
    );
  return v.toLowerCase();
}
function query(p, values) {
  const q = new URLSearchParams(
    Object.entries(values).filter(([, v]) => v !== undefined),
  );
  return p + (q.size ? `?${q}` : "");
}
function canonicalSettings(action, s) {
  keys(s, ACTIONS[action] || []);
  const o = {},
    set = (k, fn = id) => {
      if (s[k] !== undefined) o[k] = fn(s[k], k);
    };
  switch (action) {
    case "github.repository.create":
      o.name = id(s.name, "Repository name");
      o.private = bool(s.private, true);
      set("description", (v) => str(v, "Description", 350));
      set("organization");
      break;
    case "vercel.project.create":
      o.name = id(s.name, "Project name");
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(o.name))
        throw new ApiError(400, "Use a lowercase Vercel project name.");
      set("framework", (v) =>
        choice(
          v,
          [
            "nextjs",
            "vite",
            "create-react-app",
            "astro",
            "sveltekit",
            "nuxtjs",
            "remix",
          ],
          "framework",
        ),
      );
      set("teamId");
      break;
    case "vercel.deployment.create":
      o.remoteProjectId = id(s.remoteProjectId);
      o.name = id(s.name);
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(o.name))
        throw new ApiError(400, "Use the Vercel project name.");
      if (typeof s.repoId !== "string" || !/^\d{1,20}$/.test(s.repoId))
        throw new ApiError(400, "Use a numeric GitHub repository ID.");
      o.repoId = s.repoId;
      o.ref = ref(s.ref);
      o.commitId = sha(s.commitId);
      o.target = choice(
        s.target ?? "preview",
        ["preview", "production"],
        "deployment target",
      );
      set("teamId");
      break;
    case "vercel.environment.set":
    case "render.environment.set":
      if (action.startsWith("vercel")) {
        o.remoteProjectId = id(s.remoteProjectId);
        if (!Array.isArray(s.target) || !s.target.length || s.target.length > 3)
          throw new ApiError(400, "Choose environment targets.");
        o.target = [
          ...new Set(
            s.target.map((v) =>
              choice(
                v,
                ["preview", "production", "development"],
                "environment target",
              ),
            ),
          ),
        ].sort();
        set("teamId");
      } else o.serviceId = id(s.serviceId);
      if (
        typeof s.key !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s.key)
      )
        throw new ApiError(400, "Invalid environment variable name.");
      o.key = s.key;
      o.secretRef = id(s.secretRef, "Project secret reference");
      break;
    case "vercel.domain.add":
      o.remoteProjectId = id(s.remoteProjectId);
      o.domain = dns(s.domain);
      set("teamId");
      break;
    case "render.service.create":
      o.name = id(s.name);
      o.ownerId = id(s.ownerId);
      o.repository = repo(s.repository);
      o.branch = ref(s.branch);
      o.runtime = choice(
        s.runtime,
        ["node", "python", "go", "ruby", "rust", "elixir"],
        "Render runtime",
      );
      o.buildCommand = str(s.buildCommand, "Build command", 500);
      o.startCommand = str(s.startCommand, "Start command", 500);
      o.region = choice(
        s.region,
        ["frankfurt", "oregon", "ohio", "singapore", "virginia"],
        "Render region",
      );
      o.plan = choice(s.plan, ["free"], "Render plan (only free is supported)");
      set("rootDirectory", (v) => {
        const p = str(v, "Root directory", 200);
        if (
          !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(p) ||
          p.split("/").some((x) => x === ".." || !x)
        )
          throw new ApiError(400, "Use a relative repository directory.");
        return p;
      });
      break;
    case "render.deployment.create":
      o.serviceId = id(s.serviceId);
      o.commitId = sha(s.commitId);
      break;
    case "neon.project.create":
      o.name = str(s.name, "Neon project name", 100);
      o.regionId = id(s.regionId);
      if (!/^(aws|azure)-[a-z0-9-]+$/.test(o.regionId))
        throw new ApiError(400, "Use a supported Neon region ID.");
      set("orgId");
      o.pgVersion = choice(
        s.pgVersion ?? 17,
        [14, 15, 16, 17, 18],
        "Postgres version",
      );
      o.storeConnection = bool(s.storeConnection, true);
      break;
    case "neon.connection.store":
      o.remoteProjectId = id(s.remoteProjectId);
      set("branchId");
      o.databaseName = id(s.databaseName);
      o.roleName = id(s.roleName);
      o.pooled = bool(s.pooled, true);
      break;
    case "namecheap.nameservers.set":
      o.sld = str(s.sld, "Domain SLD", 63).toLowerCase();
      o.tld = str(s.tld, "Domain TLD", 10).toLowerCase();
      dns(`${o.sld}.${o.tld}`);
      if (o.sld.includes("."))
        throw new ApiError(
          400,
          "Provide the domain SLD separately from its full TLD.",
        );
      if (
        !Array.isArray(s.nameservers) ||
        s.nameservers.length < 2 ||
        s.nameservers.length > 6
      )
        throw new ApiError(400, "Provide 2-6 nameservers.");
      o.nameservers = [...new Set(s.nameservers.map(dns))].sort();
      if (o.nameservers.length < 2)
        throw new ApiError(400, "Provide distinct nameservers.");
      break;
    default:
      throw new ApiError(400, "Unsupported provisioning action.");
  }
  return o;
}
function signature(p) {
  return digest(
    JSON.stringify({
      version: p.version,
      id: p.id,
      provider: p.provider,
      action: p.action,
      accountId: p.accountId,
      projectId: p.projectId,
      settings: p.settings,
      accountBinding: p.accountBinding,
      projectBinding: p.projectBinding,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      requestedBy: p.requestedBy,
    }),
  );
}
function publicPlan(p) {
  const { accountBinding, projectBinding, requestedBy, ...visible } = p;
  return clone(visible);
}
function publicSecret(s) {
  const { id, projectId, name, createdAt, source } = s;
  return { id, projectId, name, createdAt, source };
}
function accountRecord(state, provider, accountId) {
  if (!Object.hasOwn(ORIGINS, provider))
    throw new ApiError(400, "Unsupported provider.");
  const a = state.connections
    .find((c) => c.id === provider)
    ?.accounts?.find((a) => a.id === accountId);
  if (!a) throw new ApiError(404, "Select a saved provider account.");
  return a;
}
function projectRecord(state, projectId) {
  const p = state.projects.find((p) => p.id === projectId);
  if (!p) throw new ApiError(404, "Select an existing Nakama project.");
  return p;
}
const projectBinding = (p) =>
  digest(
    JSON.stringify({
      id: p.id,
      path: p.path || "",
      createdAt: p.createdAt || "",
    }),
  );
function requireResponseId(v) {
  try {
    if (typeof v !== "string" && !(Number.isSafeInteger(v) && v > 0))
      throw new Error();
    return id(String(v ?? ""), "Provider resource ID");
  } catch {
    throw new ApiError(
      502,
      "The provider did not return a valid resource identity. Inspect its dashboard before retrying.",
    );
  }
}

export class ServiceProvisioning {
  constructor({
    store,
    vault,
    fetchImpl = globalThis.fetch,
    authorize,
    consume,
  }) {
    this.store = store;
    this.vault = vault;
    this.fetchImpl = fetchImpl;
    this.authorize = authorize;
    this.consume = consume;
  }
  async init() {
    await this.store.change((s) => {
      s.provisioningPlans ??= [];
      s.provisioningOperations ??= [];
      s.provisioningSecrets ??= [];
      for (const op of s.provisioningOperations)
        if (op.status === "started") {
          op.status = "unconfirmed";
          op.error =
            "Control Center stopped during this attempt. Inspect the provider before creating another plan.";
          op.finishedAt = now();
        }
    });
  }
  access(principal) {
    assertPersonalAccess(this.store.state, principal);
  }
  list(projectId, principal) {
    this.access(principal);
    projectRecord(this.store.state, projectId);
    return {
      version: 1,
      plans: (this.store.state.provisioningPlans || [])
        .filter((p) => p.projectId === projectId)
        .map(publicPlan),
      operations: clone(
        (this.store.state.provisioningOperations || []).filter(
          (o) => o.projectId === projectId,
        ),
      ),
      secrets: this.listSecrets(projectId, principal),
      limits: PROVISIONING_LIMITS,
    };
  }
  listSecrets(projectId, principal) {
    this.access(principal);
    projectRecord(this.store.state, projectId);
    return (this.store.state.provisioningSecrets || [])
      .filter((s) => s.projectId === projectId)
      .map(publicSecret);
  }
  listPlans(projectId, principal) {
    return this.list(projectId, principal).plans;
  }
  listOperations(projectId, principal) {
    return this.list(projectId, principal).operations;
  }
  async saveSecret(body, principal) {
    requireOwner(principal);
    keys(body, ["projectId", "name", "value"]);
    projectRecord(this.store.state, body.projectId);
    return this.#saveSecret(
      body.projectId,
      str(body.name, "Secret label", 80),
      body.value,
      "user",
    );
  }
  async #saveSecret(projectId, name, value, source) {
    if (
      !this.vault?.set ||
      typeof value !== "string" ||
      !value ||
      Buffer.byteLength(value) > PROVISIONING_LIMITS.secretBytes ||
      value.includes("\0")
    )
      throw new ApiError(
        400,
        "A protected vault and a secret value up to 16000 bytes are required.",
      );
    const record = { id: uid(), projectId, name, source, createdAt: now() };
    if (
      (this.store.state.provisioningSecrets || []).length >=
      PROVISIONING_LIMITS.secrets
    )
      throw new ApiError(409, "Project secret limit reached.");
    await this.vault.set(`provisioning-secret:${record.id}`, value);
    await this.store.change((s) => {
      projectRecord(s, projectId);
      s.provisioningSecrets ??= [];
      if (s.provisioningSecrets.length >= PROVISIONING_LIMITS.secrets)
        throw new ApiError(409, "Project secret limit reached.");
      s.provisioningSecrets.push(record);
    });
    return publicSecret(record);
  }
  async #credential(provider, accountId) {
    const a = accountRecord(this.store.state, provider, accountId);
    const token = await this.vault?.get(`${provider}:${accountId}`);
    if (
      typeof token !== "string" ||
      !token ||
      token.length > 16000 ||
      /[\r\n\0]/.test(token)
    )
      throw new ApiError(
        409,
        "The selected account has no usable saved credential.",
      );
    let bundle;
    if (provider === "namecheap") {
      try {
        bundle = JSON.parse(token);
        keys(bundle, ["apiUser", "apiKey", "userName", "clientIp"]);
        for (const k of ["apiUser", "userName"]) id(bundle[k]);
        if (
          typeof bundle.apiKey !== "string" ||
          !/^[A-Za-z0-9_-]{16,200}$/.test(bundle.apiKey) ||
          isIP(bundle.clientIp) !== 4
        )
          throw new Error();
      } catch {
        throw new ApiError(
          409,
          "Namecheap needs a saved JSON credential with apiUser, apiKey, userName and whitelisted IPv4 clientIp.",
        );
      }
    }
    return {
      token,
      bundle,
      binding: digest(
        JSON.stringify({
          token,
          id: a.id,
          label: a.accountLabel || "",
          createdAt: a.createdAt || "",
        }),
      ),
    };
  }
  async prepare(body, principal) {
    this.access(principal);
    keys(body, ["provider", "action", "accountId", "projectId", "settings"]);
    if (
      !Object.hasOwn(ACTIONS, body.action) ||
      body.action.split(".")[0] !== body.provider
    )
      throw new ApiError(400, "Unsupported provider/action combination.");
    const p = projectRecord(this.store.state, id(body.projectId));
    const binding = projectBinding(p);
    const settings = canonicalSettings(body.action, body.settings);
    const credential = await this.#credential(
      body.provider,
      id(body.accountId),
    );
    if (settings.secretRef) await this.#secretValue(settings.secretRef, p.id);
    const createdAt = now(),
      includesDeployment =
        body.action.includes("deployment.") ||
        body.action === "render.service.create";
    const plan = {
      version: 1,
      id: uid(),
      provider: body.provider,
      action: body.action,
      accountId: body.accountId,
      projectId: p.id,
      settings,
      accountBinding: credential.binding,
      projectBinding: binding,
      requestedBy: clone(principal),
      createdAt,
      expiresAt: new Date(
        Date.now() + PROVISIONING_LIMITS.planMinutes * 60000,
      ).toISOString(),
      includesDeployment,
      summary:
        body.action === "render.service.create"
          ? "Create a free Render web service and its initial build/deploy. Later automatic deploys are disabled."
          : body.action === "namecheap.nameservers.set"
            ? "Replace this existing domain's nameservers; DNS, website and email routing may change. No domain purchase."
            : body.action.endsWith("environment.set")
              ? "Set the named environment variable from its project-scoped protected secret; this may replace an existing value."
              : `Request ${body.action} using the selected account. Provider acceptance does not establish application health.`,
    };
    plan.hash = signature(plan);
    await this.store.change((s) => {
      this.access(principal);
      if (projectBinding(projectRecord(s, p.id)) !== binding)
        throw new ApiError(409, "Project changed during preparation.");
      s.provisioningPlans ??= [];
      s.provisioningPlans = s.provisioningPlans.filter(
        (p) =>
          Date.parse(p.expiresAt) > Date.now() ||
          (s.provisioningOperations || []).some((o) => o.planId === p.id),
      );
      if (s.provisioningPlans.length >= PROVISIONING_LIMITS.plans)
        throw new ApiError(409, "Provisioning plan limit reached.");
      s.provisioningPlans.push(plan);
    });
    return publicPlan(plan);
  }
  async #secretValue(secretRef, projectId) {
    const s = (this.store.state.provisioningSecrets || []).find(
      (s) => s.id === secretRef && s.projectId === projectId,
    );
    if (!s)
      throw new ApiError(
        403,
        "Choose a secret belonging to this Nakama project.",
      );
    const value = await this.vault?.get(`provisioning-secret:${s.id}`);
    if (
      typeof value !== "string" ||
      !value ||
      Buffer.byteLength(value) > PROVISIONING_LIMITS.secretBytes ||
      value.includes("\0")
    )
      throw new ApiError(409, "The project secret is unavailable.");
    return value;
  }
  #plan(input) {
    const p = (this.store.state.provisioningPlans || []).find(
      (p) => p.id === (typeof input === "string" ? input : input?.id),
    );
    if (!p) throw new ApiError(404, "Provisioning plan not found.");
    if (typeof input !== "string" && !isDeepStrictEqual(publicPlan(p), input))
      throw new ApiError(409, "The proposed plan changed.");
    if (
      signature(p) !== p.hash ||
      !isDeepStrictEqual(canonicalSettings(p.action, p.settings), p.settings) ||
      !Number.isFinite(Date.parse(p.expiresAt)) ||
      Date.parse(p.expiresAt) <= Date.now()
    )
      throw new ApiError(409, "Plan expired or changed. Prepare a new plan.");
    if (
      projectBinding(projectRecord(this.store.state, p.projectId)) !==
      p.projectBinding
    )
      throw new ApiError(409, "The local project changed. Prepare a new plan.");
    this.access(p.requestedBy);
    return p;
  }
  async #authority(plan, authority) {
    if (typeof authority === "string") {
      const a = this.store.state.approvals.find((a) => a.id === authority);
      if (
        !a ||
        a.type !== "service_provision" ||
        a.status !== "executing" ||
        !Number.isFinite(Date.parse(a.expiresAt)) ||
        Date.parse(a.expiresAt) <= Date.now() ||
        !isDeepStrictEqual(a.operation, {
          planId: plan.id,
          planHash: plan.hash,
        })
      )
        throw new ApiError(
          403,
          "An executing Windows approval for this exact plan is required.",
        );
      return { id: a.id, requestedBy: a.requestedBy };
    }
    keys(authority, ["grantId"]);
    id(authority.grantId);
    if (!this.authorize || !this.consume)
      throw new ApiError(403, "Scoped project authorization is unavailable.");
    const a = await this.authorize(publicPlan(plan), clone(authority));
    if (!a?.id || !a.requestedBy)
      throw new ApiError(403, "A valid project authorization is required.");
    return a;
  }
  async execute(
    input,
    authority,
    { guard: runtimeGuard, beforeDispatch } = {},
  ) {
    runtimeGuard?.();
    const plan = this.#plan(input);
    const credential = await this.#credential(plan.provider, plan.accountId);
    if (credential.binding !== plan.accountBinding)
      throw new ApiError(
        409,
        "The provider account changed. Prepare a new plan.",
      );
    const auth = await this.#authority(plan, authority);
    runtimeGuard?.();
    if (typeof authority !== "string")
      await this.consume(publicPlan(plan), clone(authority));
    const op = await this.store.change(async (s) => {
      runtimeGuard?.();
      this.#plan(plan.id);
      await this.#authority(plan, authority);
      runtimeGuard?.();
      s.provisioningOperations ??= [];
      if (s.provisioningOperations.some((o) => o.planId === plan.id))
        throw new ApiError(
          409,
          "This plan was already attempted. Verify its receipt; writes are never retried automatically.",
        );
      if (s.provisioningOperations.length >= PROVISIONING_LIMITS.operations)
        throw new ApiError(409, "Provisioning receipt limit reached.");
      const r = {
        id: uid(),
        planId: plan.id,
        planHash: plan.hash,
        provider: plan.provider,
        action: plan.action,
        accountId: plan.accountId,
        projectId: plan.projectId,
        authorityId: auth.id,
        status: "started",
        startedAt: now(),
      };
      s.provisioningOperations.push(r);
      return r;
    });
    let dispatched = false;
    try {
      const context = {
        plan,
        credential,
        runtimeGuard,
        beforeDispatch,
        onDispatch: () => {
          dispatched = true;
        },
        guard: async () => {
          runtimeGuard?.();
          this.#plan(plan.id);
          const fresh = await this.#credential(plan.provider, plan.accountId);
          if (fresh.binding !== plan.accountBinding)
            throw new ApiError(
              409,
              "The selected account changed before the request.",
            );
          await this.#authority(plan, authority);
          runtimeGuard?.();
          this.#plan(plan.id);
        },
      };
      const { receipt, connection } = await this.#dispatch(context);
      await this.store.change(() => {
        Object.assign(op, {
          status: "submitted",
          finishedAt: now(),
          result: receipt,
        });
      });
      if (connection) {
        try {
          const s = await this.#saveSecret(
            plan.projectId,
            "Neon database connection",
            connection,
            "neon",
          );
          await this.store.change(() => {
            op.result.secretRefs = [s.id];
          });
        } catch {
          await this.store.change(() => {
            op.warning =
              "The provider accepted the operation, but its connection could not be saved. Use a new connection.store plan; do not create the project again.";
          });
        }
      }
      this.access(plan.requestedBy);
      return clone(op);
    } catch (error) {
      // A completed write remains recorded even if its requester lost access
      // while the provider was processing it. Never turn that into a retry hint.
      if (op.status === "submitted")
        throw new ApiError(
          403,
          "The operation receipt was saved, but the original requester's access changed.",
        );
      await this.store.change(() => {
        op.status = dispatched ? "unconfirmed" : "blocked";
        op.finishedAt = now();
        op.error = dispatched
          ? "No confirmed provider receipt was saved. Inspect the provider dashboard before preparing any repeat write."
          : "Authorization, project, account, or secret changed before the provider request.";
      });
      throw new ApiError(error.status || 502, op.error);
    }
  }
  async #request(context, method, path, body, { xml = false } = {}) {
    const { plan, credential } = context,
      url = new URL(path, ORIGINS[plan.provider]);
    if (
      url.origin !== ORIGINS[plan.provider] ||
      url.username ||
      url.password ||
      !path.startsWith("/") ||
      path.startsWith("//")
    )
      throw new ApiError(400, "Invalid fixed-origin request.");
    const headers = {
      Accept: xml ? "application/xml" : "application/json",
      "User-Agent": "Nakama/0.1",
    };
    if (!xml) headers.Authorization = `Bearer ${credential.token}`;
    if (plan.provider === "github")
      headers["X-GitHub-Api-Version"] = "2022-11-28";
    if (body !== undefined)
      headers["Content-Type"] = xml
        ? "application/x-www-form-urlencoded"
        : "application/json";
    await context.beforeDispatch?.();
    await context.guard?.();
    // A coordinator may be stopped while the async credential/authority guard
    // yields. This synchronous check is the final instruction before fetch.
    context.runtimeGuard?.();
    context.onDispatch?.();
    let response;
    try {
      response = await this.fetchImpl(url.href, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : xml
              ? body.toString()
              : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError(502, "The provider response was not confirmed.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ApiError(502, `Provider returned HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(502, "Provider response is missing.");
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > PROVISIONING_LIMITS.responseBytes)
          throw new ApiError(502, "Provider response exceeded its limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const content = Buffer.concat(chunks).toString("utf8");
    if (xml) return content;
    try {
      return JSON.parse(content);
    } catch {
      throw new ApiError(502, "Provider response is not valid JSON.");
    }
  }
  #namecheapBody(context, command) {
    const { bundle } = context.credential,
      s = context.plan.settings;
    return new URLSearchParams({
      ApiUser: bundle.apiUser,
      ApiKey: bundle.apiKey,
      UserName: bundle.userName,
      ClientIp: bundle.clientIp,
      Command: command,
      SLD: s.sld,
      TLD: s.tld,
      ...(command.endsWith("setCustom")
        ? { NameServers: s.nameservers.join(",") }
        : {}),
    });
  }
  #xmlResult(content, command, domain) {
    if (
      /<!/i.test(content) ||
      !/<ApiResponse\b[^>]*\bStatus=["']OK["']/.test(content) ||
      !content.includes(`<RequestedCommand>${command}</RequestedCommand>`) ||
      !new RegExp(
        `\\bDomain=["']${domain.replaceAll(".", "\\.")}["']`,
        "i",
      ).test(content)
    )
      throw new ApiError(
        502,
        "Namecheap did not confirm the requested domain operation.",
      );
    return content;
  }
  async #dispatch(context) {
    const p = context.plan,
      s = p.settings,
      call = (method, path, body) => this.#request(context, method, path, body),
      vq = (path, extra = {}) => query(path, { teamId: s.teamId, ...extra });
    let d, receipt, connection;
    switch (p.action) {
      case "github.repository.create":
        d = await call(
          "POST",
          s.organization ? `/orgs/${s.organization}/repos` : "/user/repos",
          {
            name: s.name,
            private: s.private,
            description: s.description || "",
            auto_init: false,
          },
        );
        if (
          typeof d.full_name !== "string" ||
          repo(d.full_name).split("/")[1].toLowerCase() !==
            s.name.toLowerCase() ||
          (s.organization &&
            d.full_name.split("/")[0].toLowerCase() !==
              s.organization.toLowerCase()) ||
          d.private !== s.private
        )
          throw new ApiError(502, "GitHub repository identity did not match.");
        receipt = {
          resourceId: requireResponseId(d.id),
          repository: d.full_name,
          private: d.private,
          url: `https://github.com/${d.full_name}`,
          providerStatus: "created",
        };
        break;
      case "vercel.project.create":
        d = await call("POST", vq("/v11/projects"), {
          name: s.name,
          framework: s.framework || null,
          publicSource: false,
        });
        if (d.name !== s.name)
          throw new ApiError(502, "Vercel project identity did not match.");
        receipt = {
          resourceId: requireResponseId(d.id),
          providerStatus: "created",
          url: "https://vercel.com/dashboard",
        };
        break;
      case "vercel.deployment.create":
        d = await call("POST", vq("/v13/deployments"), {
          name: s.name,
          project: s.remoteProjectId,
          gitSource: {
            type: "github",
            repoId: s.repoId,
            ref: s.ref,
            sha: s.commitId,
          },
          ...(s.target === "production" ? { target: "production" } : {}),
        });
        receipt = {
          resourceId: requireResponseId(d.id),
          remoteProjectId: s.remoteProjectId,
          providerStatus: providerStatus(d.readyState),
          url: `https://vercel.com/dashboard`,
          commitId: s.commitId,
        };
        break;
      case "vercel.environment.set":
        d = await call(
          "POST",
          vq(`/v10/projects/${s.remoteProjectId}/env`, { upsert: "true" }),
          {
            key: s.key,
            value: await this.#secretValue(s.secretRef, p.projectId),
            type: "encrypted",
            target: s.target,
          },
        );
        if (
          d.error ||
          !Array.isArray(d.failed) ||
          d.failed.length ||
          d.created?.key !== s.key
        )
          throw new ApiError(
            502,
            "Vercel did not confirm the environment value.",
          );
        receipt = {
          resourceId: s.key,
          remoteProjectId: s.remoteProjectId,
          providerStatus: "accepted",
          url: "https://vercel.com/dashboard",
          secretRefs: [s.secretRef],
        };
        break;
      case "vercel.domain.add":
        d = await call(
          "POST",
          vq(`/v10/projects/${s.remoteProjectId}/domains`),
          { name: s.domain },
        );
        if (d.name !== s.domain)
          throw new ApiError(502, "Vercel returned a different domain.");
        receipt = {
          resourceId: s.domain,
          remoteProjectId: s.remoteProjectId,
          providerStatus:
            d.verified === true ? "domain_verified" : "verification_required",
          url: "https://vercel.com/dashboard",
        };
        break;
      case "render.service.create":
        d = await call("POST", "/v1/services", {
          type: "web_service",
          name: s.name,
          ownerId: s.ownerId,
          repo: `https://github.com/${s.repository}`,
          branch: s.branch,
          autoDeployTrigger: "off",
          ...(s.rootDirectory ? { rootDir: s.rootDirectory } : {}),
          serviceDetails: {
            runtime: s.runtime,
            region: s.region,
            plan: "free",
            numInstances: 1,
            envSpecificDetails: {
              buildCommand: s.buildCommand,
              startCommand: s.startCommand,
            },
          },
        });
        if (d.service?.name !== s.name)
          throw new ApiError(502, "Render service identity did not match.");
        receipt = {
          resourceId: requireResponseId(d.service?.id),
          providerStatus: "created_initial_deploy_submitted",
          ...(d.deployId
            ? { deploymentId: requireResponseId(d.deployId) }
            : {}),
          url: "https://dashboard.render.com/",
        };
        break;
      case "render.environment.set":
        d = await call("PUT", `/v1/services/${s.serviceId}/env-vars/${s.key}`, {
          value: await this.#secretValue(s.secretRef, p.projectId),
        });
        if (d.key !== s.key)
          throw new ApiError(
            502,
            "Render did not confirm the requested environment key.",
          );
        receipt = {
          resourceId: s.key,
          serviceId: s.serviceId,
          providerStatus: "accepted",
          secretRefs: [s.secretRef],
          url: "https://dashboard.render.com/",
        };
        break;
      case "render.deployment.create":
        d = await call("POST", `/v1/services/${s.serviceId}/deploys`, {
          commitId: s.commitId,
          clearCache: "do_not_clear",
        });
        receipt = {
          resourceId: requireResponseId(d.id),
          serviceId: s.serviceId,
          providerStatus: providerStatus(d.status),
          commitId: s.commitId,
          url: "https://dashboard.render.com/",
        };
        break;
      case "neon.project.create":
        d = await call("POST", "/api/v2/projects", {
          project: {
            name: s.name,
            region_id: s.regionId,
            pg_version: s.pgVersion,
            ...(s.orgId ? { org_id: s.orgId } : {}),
            default_endpoint_settings: {
              autoscaling_limit_min_cu: 0.25,
              autoscaling_limit_max_cu: 0.25,
              suspend_timeout_seconds: 0,
            },
          },
        });
        receipt = {
          resourceId: requireResponseId(d.project?.id),
          providerStatus: "created_operations_pending",
          operationIds: (Array.isArray(d.operations) ? d.operations : [])
            .slice(0, 20)
            .map((o) => requireResponseId(o.id)),
          url: "https://console.neon.tech/",
        };
        if (s.storeConnection) {
          try {
            connection = this.#connection(
              d.connection_uris?.[0]?.connection_uri,
            );
          } catch {
            receipt.connectionUnavailable = true;
          }
        }
        break;
      case "neon.connection.store":
        d = await call(
          "GET",
          query(`/api/v2/projects/${s.remoteProjectId}/connection_uri`, {
            branch_id: s.branchId,
            database_name: s.databaseName,
            role_name: s.roleName,
            pooled: String(s.pooled),
          }),
        );
        connection = this.#connection(d.uri);
        receipt = {
          resourceId: s.remoteProjectId,
          providerStatus: "connection_retrieved",
          url: "https://console.neon.tech/",
        };
        break;
      case "namecheap.nameservers.set":
        d = this.#xmlResult(
          await this.#request(
            context,
            "POST",
            "/xml.response",
            this.#namecheapBody(context, "namecheap.domains.dns.setCustom"),
            { xml: true },
          ),
          "namecheap.domains.dns.setCustom",
          `${s.sld}.${s.tld}`,
        );
        if (!/<DomainDNSSetCustomResult\b[^>]*\bUpdated=["']true["']/.test(d))
          throw new ApiError(
            502,
            "Namecheap did not confirm the nameserver change.",
          );
        receipt = {
          resourceId: `${s.sld}.${s.tld}`,
          providerStatus: "accepted_propagation_unverified",
          nameservers: s.nameservers,
          url: "https://ap.www.namecheap.com/",
        };
        break;
    }
    return {
      receipt: {
        ...receipt,
        message:
          "Provider receipt only. Application health, successful builds, DNS propagation and end-to-end behavior are not established by this result.",
      },
      connection,
    };
  }
  #connection(value) {
    try {
      const u = new URL(value);
      if (
        !["postgres:", "postgresql:"].includes(u.protocol) ||
        !u.hostname.endsWith(".neon.tech") ||
        !u.username ||
        !u.password ||
        value.length > PROVISIONING_LIMITS.secretBytes
      )
        throw new Error();
      return value;
    } catch {
      throw new ApiError(502, "Neon returned an unusable connection URI.");
    }
  }
  async verify(operationId, principal) {
    this.access(principal);
    const op = (this.store.state.provisioningOperations || []).find(
      (o) => o.id === operationId,
    );
    if (!op) throw new ApiError(404, "Operation not found.");
    const p = (this.store.state.provisioningPlans || []).find(
      (p) => p.id === op.planId,
    );
    if (!p || !op.result?.resourceId)
      throw new ApiError(
        409,
        "No saved provider resource ID. Inspect the provider dashboard; the write cannot safely be repeated.",
      );
    projectRecord(this.store.state, p.projectId);
    const credential = await this.#credential(p.provider, p.accountId);
    if (credential.binding !== p.accountBinding)
      throw new ApiError(409, "The account changed since this operation.");
    const guard = async () => {
      this.access(principal);
      if (
        projectBinding(projectRecord(this.store.state, p.projectId)) !==
        p.projectBinding
      )
        throw new ApiError(409, "The project changed.");
      const c = await this.#credential(p.provider, p.accountId);
      if (c.binding !== p.accountBinding)
        throw new ApiError(409, "The account changed.");
    };
    const c = { plan: p, credential, guard },
      s = p.settings,
      r = op.result,
      call = (path) => this.#request(c, "GET", path);
    let status = "present",
      details = {};
    if (p.action === "github.repository.create") {
      const d = await call(`/repos/${repo(r.repository)}`);
      if (String(d.id) !== r.resourceId)
        throw new ApiError(409, "Repository identity changed.");
      status = "repository_present";
    } else if (p.action === "vercel.project.create") {
      const d = await call(
        query(`/v9/projects/${id(r.resourceId)}`, { teamId: s.teamId }),
      );
      if (d.id !== r.resourceId)
        throw new ApiError(409, "Project identity changed.");
      status = "project_present";
    } else if (p.action === "vercel.deployment.create") {
      const d = await call(
        query(`/v13/deployments/${id(r.resourceId)}`, { teamId: s.teamId }),
      );
      if (d.id !== r.resourceId)
        throw new ApiError(409, "Deployment identity changed.");
      status = providerStatus(d.readyState || d.status);
    } else if (p.action === "vercel.domain.add") {
      const d = await call(
        query(`/v9/projects/${s.remoteProjectId}/domains/${s.domain}`, {
          teamId: s.teamId,
        }),
      );
      if (d.name !== s.domain)
        throw new ApiError(409, "Domain identity changed.");
      status =
        d.verified === true ? "domain_verified" : "verification_required";
    } else if (p.action === "vercel.environment.set") {
      const d = await call(
        query(`/v9/projects/${s.remoteProjectId}/env`, { teamId: s.teamId }),
      );
      status =
        Array.isArray(d.envs) &&
        d.envs.some(
          (e) =>
            e.key === s.key && s.target.every((t) => e.target?.includes(t)),
        )
          ? "key_present_value_not_exposed"
          : "key_not_found";
    } else if (p.action === "render.service.create") {
      const d = await call(`/v1/services/${id(r.resourceId)}`);
      if (d.id !== r.resourceId)
        throw new ApiError(409, "Service identity changed.");
      status = "service_present";
      if (r.deploymentId) {
        const deploy = await call(
          `/v1/services/${id(r.resourceId)}/deploys/${id(r.deploymentId)}`,
        );
        status = providerStatus(deploy.status);
      }
    } else if (p.action === "render.deployment.create") {
      const d = await call(
        `/v1/services/${s.serviceId}/deploys/${id(r.resourceId)}`,
      );
      if (d.id !== r.resourceId)
        throw new ApiError(409, "Deployment identity changed.");
      status = providerStatus(d.status);
    } else if (p.action === "render.environment.set") {
      const d = await call(`/v1/services/${s.serviceId}/env-vars/${s.key}`);
      status =
        d.key === s.key || d.envVar?.key === s.key
          ? "key_present_value_not_exposed"
          : "key_not_found";
    } else if (p.provider === "neon") {
      const d = await call(`/api/v2/projects/${id(r.resourceId)}`);
      if (d.project?.id !== r.resourceId)
        throw new ApiError(409, "Neon project identity changed.");
      const operations = [];
      for (const operationId of r.operationIds || []) {
        const data = await call(
          `/api/v2/projects/${id(r.resourceId)}/operations/${id(operationId)}`,
        );
        if (data.operation?.id !== operationId)
          throw new ApiError(409, "Neon operation identity changed.");
        operations.push({
          id: operationId,
          status: providerStatus(data.operation.status),
        });
      }
      details.operations = operations;
      status = operations.length
        ? operations.every((o) => o.status === "finished")
          ? "operations_finished"
          : "operations_pending_or_failed"
        : "project_present";
    } else if (p.provider === "namecheap") {
      const d = this.#xmlResult(
        await this.#request(
          c,
          "POST",
          "/xml.response",
          this.#namecheapBody(c, "namecheap.domains.dns.getList"),
          { xml: true },
        ),
        "namecheap.domains.dns.getList",
        r.resourceId,
      );
      const nameservers = [...d.matchAll(/<Nameserver>([^<]+)<\/Nameserver>/g)]
        .map((m) => dns(m[1]))
        .sort();
      details.nameservers = nameservers;
      status = isDeepStrictEqual(nameservers, s.nameservers)
        ? "registrar_nameservers_match_propagation_unverified"
        : "registrar_nameservers_differ";
    }
    await guard();
    const verification = {
      checkedAt: now(),
      providerStatus: redact(status),
      ...details,
      message:
        "Read-only provider status. This does not test application health or DNS propagation.",
    };
    await this.store.change(() => {
      this.access(principal);
      op.verification = verification;
    });
    return clone(op);
  }
}
