import path from "node:path";
import { KlingCli, validateVideoRequest } from "./kling-cli.mjs";
import {
  ApiError,
  uid,
  secret,
  digest,
  now,
  requireOwner,
} from "./security.mjs";

const ACTIVE = new Set(["submitting", "queued", "running", "unconfirmed"]);
const DISCLOSURE =
  "Kling uses separate credits from ChatGPT and Claude. The exact charge is not supplied by this integration. Approval authorises one video using the current signed-in Kling account and its credits. Check your Kling plan first. No automatic retry or credit purchase will occur.";
export class KlingVideos {
  constructor(host, { cli = new KlingCli(), mcpPath } = {}) {
    this.host = host;
    this.store = host.store;
    this.cli = cli;
    this.mcpPath = mcpPath || path.resolve("output/kling-mcp/server.mjs");
    this.polls = new Map();
  }
  async init() {
    await this.store.change((s) => {
      s.config.klingEnabled ??= false;
      s.klingJobs ||= [];
      for (const job of s.klingJobs)
        if (job.status === "submitting") {
          job.status = "unconfirmed";
          job.error =
            "Control Center restarted during submission. Check Kling before trying again; no request was resent.";
        }
    });
  }
  guard(principal) {
    if (principal?.kind === "owner") return;
    if (
      principal?.kind === "mcp" &&
      this.store.state.klingMcp?.id === principal.id
    )
      return;
    throw new ApiError(
      403,
      "Kling is available from Windows Video studio or its authorised MCP connection.",
    );
  }
  enabled(principal) {
    this.guard(principal);
    if (!this.store.state.config.klingEnabled || this.host.closing)
      throw new ApiError(
        409,
        "Enable Kling credits in Windows Video studio before preparing a video. Every video still needs approval.",
      );
  }
  job(id, principal) {
    this.guard(principal);
    const job = this.store.state.klingJobs.find((j) => j.id === id);
    if (!job || (principal.kind === "mcp" && job.requestedBy !== principal.id))
      throw new ApiError(404, "Video request not found.");
    return job;
  }
  publicJob(job) {
    const { catalogueHash, accountId, requestedBy, ...visible } =
      structuredClone(job);
    return visible;
  }
  async route(method, route, body, principal) {
    this.guard(principal);
    if (route === "/api/kling/status" && method === "GET") {
      const status = await this.cli.status();
      this.guard(principal);
      return {
        ...status,
        enabled: this.store.state.config.klingEnabled,
        mcpConfigured: Boolean(this.store.state.klingMcp),
        detail: status.detail,
        disclosure: DISCLOSURE,
      };
    }
    if (route === "/api/kling/settings" && method === "POST") {
      requireOwner(principal);
      if (
        Object.keys(body).some((k) => k !== "enabled") ||
        typeof body.enabled !== "boolean"
      )
        throw new ApiError(400, "Choose whether Kling credit use is enabled.");
      return this.store.change((s) => {
        s.config.klingEnabled = body.enabled;
        this.store.audit(
          s,
          "kling.settings",
          principal,
          body.enabled
            ? "Kling credit requests enabled; individual approvals remain mandatory."
            : "New Kling generations disabled.",
        );
        return { enabled: body.enabled };
      });
    }
    if (route === "/api/kling/mcp-config") {
      requireOwner(principal);
      if (method === "DELETE") {
        await this.store.change((s) => {
          delete s.klingMcp;
          this.store.audit(
            s,
            "kling.mcp.revoked",
            principal,
            "Kling MCP credential revoked.",
          );
        });
        return { revoked: true };
      }
      if (method === "POST") {
        const address = this.host.server?.address();
        if (!address || !this.host.fingerprint)
          throw new ApiError(
            409,
            "Restart Control Center to start its secure connection service.",
          );
        const token = secret();
        await this.store.change((s) => {
          s.klingMcp = { id: uid(), tokenHash: digest(token) };
          this.store.audit(
            s,
            "kling.mcp.created",
            principal,
            "New restricted Kling MCP credential; previous credential revoked.",
          );
        });
        return {
          config: {
            mcpServers: {
              "nakama-kling": {
                command: "node",
                args: [this.mcpPath],
                env: {
                  NAKAMA_KLING_URL: `https://127.0.0.1:${address.port}`,
                  NAKAMA_KLING_TOKEN: token,
                  NAKAMA_KLING_FINGERPRINT: this.host.fingerprint,
                },
              },
            },
          },
          detail:
            "Keep this configuration private. It can prepare video requests, never approve them. Control Center must stay open. Creating another configuration revokes the previous one.",
        };
      }
    }
    if (route === "/api/kling/catalogue" && method === "GET") {
      const data = await this.cli.discover();
      this.guard(principal);
      return {
        ...data,
        models: data.models.map((m) => ({
          ...m,
          name: m.name || m.label || m.id,
        })),
        detail:
          "Models and parameters returned by your signed-in Kling account. No video has been generated.",
      };
    }
    if (route === "/api/kling/account" && method === "GET") {
      const data = await this.cli.account();
      this.guard(principal);
      return {
        credits: data.availableCredits,
        membership: data.membership,
        detail:
          data.availableCredits == null
            ? "Kling did not supply a usable credit balance. Generation stays blocked."
            : "Current Kling credits. This is a balance, not a price quote or guaranteed spending cap.",
      };
    }
    if (route === "/api/kling/jobs" && method === "GET")
      return {
        jobs: this.store.state.klingJobs
          .filter(
            (j) => principal.kind === "owner" || j.requestedBy === principal.id,
          )
          .slice(-100)
          .reverse()
          .map((j) => this.publicJob(j)),
      };
    if (route === "/api/kling/prepare" && method === "POST")
      return this.prepare(body, principal);
    const poll = route.match(/^\/api\/kling\/jobs\/([^/]+)\/poll$/);
    if (poll && method === "POST") return this.poll(poll[1], principal);
    throw new ApiError(404, "Unknown Kling operation.");
  }
  async prepare(body, principal) {
    this.enabled(principal);
    if (
      Object.keys(body).some(
        (key) => !["prompt", "model", "parameters", "projectId"].includes(key),
      )
    )
      throw new ApiError(400, "Unsupported video request field.");
    if (body.projectId) this.host.project(body.projectId);
    const catalogue = await this.cli.discover();
    this.enabled(principal);
    const request = validateVideoRequest(
      {
        prompt: body.prompt,
        model: body.model,
        parameters: body.parameters || {},
      },
      catalogue,
    );
    if (body.projectId) request.projectId = body.projectId;
    const model = catalogue.models.find((m) => m.id === request.model);
    const job = {
      id: uid(),
      status: "awaiting_approval",
      request,
      requestedBy: principal.id,
      catalogueHash: digest(JSON.stringify(model)),
      accountId: catalogue.accountId || null,
      createdAt: now(),
      results: [],
    };
    const approval = await this.host.approval(
      "kling_video",
      `Generate a Kling video with ${request.model}`,
      `${request.prompt}\n\nParameters: ${JSON.stringify(request.parameters)}\n\n${DISCLOSURE}`,
      { jobId: job.id, requestHash: digest(JSON.stringify(request)) },
      principal,
      {
        guard: () => {
          this.enabled(principal);
          if (
            this.store.state.klingJobs.some(
              (j) =>
                ACTIVE.has(j.status) ||
                (j.status === "awaiting_approval" &&
                  Date.now() - Date.parse(j.createdAt) < 600000),
            )
          )
            throw new ApiError(
              409,
              "Review the existing video request before creating another. Unconfirmed submissions must be checked in Kling first.",
            );
        },
        onCreated: (approval) => {
          job.approvalId = approval.id;
          this.store.state.klingJobs.push(job);
        },
      },
    );
    return { job: this.publicJob(job), approval };
  }
  async decline(id) {
    await this.store.change((s) => {
      const job = s.klingJobs.find((j) => j.id === id);
      if (job?.status === "awaiting_approval") job.status = "declined";
    });
  }
  async submit(operation, approvalId) {
    const job = this.store.state.klingJobs.find(
      (j) => j.id === operation.jobId,
    );
    const requester =
      job?.requestedBy === "desktop"
        ? { kind: "owner", id: "desktop" }
        : { kind: "mcp", id: job?.requestedBy };
    const guard = () => {
      this.enabled(requester);
      if (
        !job ||
        job.approvalId !== approvalId ||
        digest(JSON.stringify(job.request)) !== operation.requestHash
      )
        throw new ApiError(
          409,
          "The video request changed. Prepare and review a fresh request.",
        );
    };
    guard();
    await this.store.change((s) => {
      guard();
      if (
        job.status !== "awaiting_approval" ||
        s.klingJobs.some((j) => j.id !== job.id && ACTIVE.has(j.status))
      )
        throw new ApiError(
          409,
          "This video was already submitted or another video is unresolved.",
        );
      job.status = "submitting";
      job.updatedAt = now();
    });
    let attempted = false;
    try {
      const catalogue = await this.cli.discover();
      guard();
      if (
        digest(
          JSON.stringify(
            catalogue.models.find((m) => m.id === job.request.model) || null,
          ),
        ) !== job.catalogueHash ||
        (job.accountId && catalogue.accountId !== job.accountId)
      )
        throw new ApiError(
          409,
          "Kling's account or model options changed. Prepare a fresh request.",
        );
      const result = await this.cli.submit(job.request, catalogue, {
        beforeSubmit: () => {
          guard();
          attempted = true;
        },
      });
      if (!result.generationId)
        throw new ApiError(
          502,
          "Kling did not return a generation ID. Check Kling before requesting another video.",
        );
      await this.record(job, result);
    } catch (e) {
      await this.store.change(() => {
        job.status = attempted ? "unconfirmed" : "not_submitted";
        job.error = attempted
          ? "Submission result is unconfirmed. Check Kling; do not resend. No automatic retry will occur."
          : e instanceof ApiError
            ? e.message
            : "Kling checks failed before submission. No video request was sent.";
        job.updatedAt = now();
      });
    }
    return this.publicJob(job);
  }
  async record(job, result) {
    await this.store.change(() => {
      job.generationId = result.generationId;
      job.providerStatus = result.status;
      job.status = !result.terminal
        ? "running"
        : /^(success|succeed|succeeded|successful|completed|complete)$/.test(
              result.status,
            )
          ? "completed"
          : /partial/.test(result.status)
            ? "partial"
            : /cancel/.test(result.status)
              ? "cancelled"
              : "failed";
      job.results = result.works || [];
      job.creditsConsumed = result.creditsConsumed ?? null;
      job.updatedAt = now();
      delete job.error;
    });
  }
  async poll(id, principal) {
    const job = this.job(id, principal);
    if (!job.generationId)
      throw new ApiError(
        409,
        "This request has no generation ID to check. No new video was requested.",
      );
    if (!this.polls.has(id)) {
      const pending = this.cli
        .query(job.generationId)
        .then(async (result) => {
          await this.record(job, result);
        })
        .finally(() => this.polls.delete(id));
      this.polls.set(id, pending);
    }
    await this.polls.get(id);
    return this.publicJob(this.job(id, principal));
  }
}
