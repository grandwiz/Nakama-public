import net from "node:net";
import { ApiError, now, uid } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { createProjectCheckTools } from "./project-checks.mjs";
import { subscriptionEnv } from "./providers.mjs";

const fields = (body, allowed) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "Unexpected preview fields.");
};
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export class ProjectPreviews {
  constructor(
    host,
    {
      checkTools = createProjectCheckTools({ checkNames: ["dev", "start"] }),
      allocatePort = freePort,
    } = {},
  ) {
    this.host = host;
    this.tools = checkTools;
    this.allocatePort = allocatePort;
    this.entries = new Map();
  }
  access(principal) {
    assertPersonalAccess(this.host.store.state, principal);
  }
  context(id) {
    return {
      workspaceRoot: this.host.store.state.config.workspaceRoot,
      project: this.host.project(id),
      dataDir: this.host.store.dir,
    };
  }
  async describe(id, principal) {
    this.access(principal);
    const discovery = await this.tools.discoverChecks(this.context(id));
    this.access(principal);
    return { ...discovery, launch: this.public(id) };
  }
  public(id) {
    const entry = this.entries.get(id);
    return entry
      ? {
          id: entry.id,
          projectId: id,
          origin: entry.origin,
          taskId: entry.taskId,
          status: entry.status,
          createdAt: entry.createdAt,
        }
      : null;
  }
  async request(id, body, principal, options = {}) {
    this.access(principal);
    fields(body, ["name", "manifestHash"]);
    const projectPath = this.host.project(id).path,
      workspaceRoot = this.host.store.state.config.workspaceRoot;
    const guard = () => {
      options.guard?.();
      this.access(principal);
      if (
        this.host.closing ||
        this.host.project(id).path !== projectPath ||
        this.host.store.state.config.workspaceRoot !== workspaceRoot
      )
        throw new ApiError(409, "The preview project changed before approval.");
      if (options.autonomousRunId || options.autonomousReceiptId) {
        if (typeof options.guard !== "function")
          throw new ApiError(
            409,
            "Autonomous previews require an active task guard.",
          );
        const run = this.host.autonomousTasks.get(options.autonomousRunId);
        this.host.autonomousTasks.guard(run);
        const receipt = run.receipts.find(
          (row) => row.id === options.autonomousReceiptId,
        );
        if (
          run.projectId !== id ||
          run.requestedBy !== principal.id ||
          !receipt ||
          receipt.tool !== "project_preview" ||
          receipt.status !== "dispatching" ||
          receipt.request?.arguments?.name !== body.name ||
          receipt.request?.arguments?.manifestHash !== body.manifestHash
        )
          throw new ApiError(
            409,
            "The preview request does not match its autonomous task.",
          );
      }
    };
    guard();
    if (this.entries.has(id))
      throw new ApiError(409, "Stop the current project preview first.");
    const operation = await this.tools.prepareCheck({
      ...this.context(id),
      ...body,
    });
    guard();
    const discovery = await this.tools.discoverChecks(this.context(id));
    guard();
    if (discovery.manifestHash !== operation.manifestHash)
      throw new ApiError(
        409,
        "package.json changed while preparing the preview.",
      );
    const script =
      discovery.checks.find((item) => item.name === body.name)?.script || "";
    const framework = /^vite(?:\s|$)/.test(script)
      ? "vite"
      : /^next dev(?:\s|$)/.test(script)
        ? "next"
        : null;
    if (!framework || /[;&|<>`\r\n]/.test(script))
      throw new ApiError(
        409,
        "Managed previews support a plain vite or next dev script. Use a separately reviewed command for other servers.",
      );
    return this.host.approval(
      "project_preview",
      `Start local preview for ${this.host.project(id).name}`,
      `${operation.preview}\n\nStarts a local ${framework} development server. It can run project code with your Windows account permissions. Dependencies must already be installed. The internal browser is confined to its assigned loopback origin.`,
      {
        ...operation,
        framework,
        ...(options.autonomousRunId
          ? {
              autonomousRunId: options.autonomousRunId,
              autonomousReceiptId: options.autonomousReceiptId,
            }
          : {}),
      },
      principal,
      {
        guard,
        onCreated: (approval) => {
          if (options.autonomousRunId) {
            approval.autonomousRunId = options.autonomousRunId;
            approval.autonomousReceiptId = options.autonomousReceiptId;
          }
          options.onCreated?.(approval);
        },
      },
    );
  }
  async approved(operation, approval) {
    const principal =
      approval.requestedBy === "desktop"
        ? { kind: "owner", id: "desktop" }
        : { kind: "device", id: approval.requestedBy };
    this.access(principal);
    const projectPath = this.host.project(operation.projectId).path,
      workspaceRoot = this.host.store.state.config.workspaceRoot;
    const guard = () => {
      this.access(principal);
      if (
        this.host.closing ||
        this.host.project(operation.projectId).path !== projectPath ||
        this.host.store.state.config.workspaceRoot !== workspaceRoot
      )
        throw new ApiError(409, "The preview project changed while starting.");
      if (
        operation.autonomousRunId ||
        approval.autonomousRunId ||
        operation.autonomousReceiptId ||
        approval.autonomousReceiptId
      ) {
        if (typeof this.host.autonomyTools?.guardApproval !== "function")
          throw new ApiError(
            409,
            "Autonomous preview approval guards are unavailable.",
          );
        if (approval.operation !== operation)
          throw new ApiError(
            409,
            "Use the exact saved autonomous preview operation.",
          );
        this.host.autonomyTools.guardApproval(approval);
      }
    };
    guard();
    if (this.entries.has(operation.projectId))
      throw new ApiError(409, "A preview already exists.");
    const entry = {
      id: uid(),
      projectId: operation.projectId,
      status: "starting",
      createdAt: now(),
      principal,
      ...(operation.autonomousRunId
        ? {
            autonomousRunId: operation.autonomousRunId,
            autonomousReceiptId: operation.autonomousReceiptId,
            approvalId: approval.id,
          }
        : {}),
    };
    this.entries.set(operation.projectId, entry);
    try {
      const verified = await this.tools.verifyCheck({
        ...this.context(operation.projectId),
        operation,
      });
      guard();
      if (this.entries.get(operation.projectId) !== entry)
        throw new ApiError(409, "The preview was stopped while starting.");
      const port = await this.allocatePort();
      guard();
      if (
        !Number.isInteger(port) ||
        port < 1024 ||
        port > 65535 ||
        [43110, 43111].includes(port)
      )
        throw new ApiError(409, "No suitable local preview port is available.");
      if (!["vite", "next"].includes(operation.framework))
        throw new ApiError(409, "The preview framework changed.");
      entry.origin = `http://127.0.0.1:${port}`;
      if (this.entries.get(operation.projectId) !== entry)
        throw new ApiError(409, "The preview was stopped while starting.");
      guard();
      const flags =
        operation.framework === "vite"
          ? ["--host", "127.0.0.1", "--port", String(port), "--strictPort"]
          : ["--hostname", "127.0.0.1", "--port", String(port)];
      const env = subscriptionEnv(verified.env);
      // No provider or connection credentials are passed to project previews.
      for (const key of Object.keys(env))
        if (
          /(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|DATABASE_URL)/i.test(key)
        )
          delete env[key];
      const task = await this.host.startCommand(
        {
          ...operation,
          command: verified.command,
          args: [...verified.args, "--", ...flags],
        },
        principal,
        {
          expectedRoot: verified.cwd,
          env: { ...env, PORT: String(port), HOST: "127.0.0.1" },
          ...(operation.autonomousRunId
            ? {
                autonomousRunId: operation.autonomousRunId,
                autonomousReceiptId: operation.autonomousReceiptId,
                approvalId: approval.id,
                preview: { launchId: entry.id, origin: entry.origin },
              }
            : {}),
          beforeSpawn: async () => {
            const latest = await this.tools.verifyCheck({
              ...this.context(operation.projectId),
              operation,
            });
            guard();
            if (
              this.entries.get(operation.projectId) !== entry ||
              latest.cwd !== verified.cwd ||
              latest.command !== verified.command ||
              JSON.stringify(latest.args) !== JSON.stringify(verified.args)
            )
              throw new ApiError(
                409,
                "The preview changed before its process could start.",
              );
          },
          guard: () => {
            guard();
            if (this.entries.get(operation.projectId) !== entry)
              throw new ApiError(
                409,
                "The preview was stopped while starting.",
              );
          },
          onProcessClose: () => {
            entry.status = "stopped";
            if (this.entries.get(operation.projectId) === entry)
              this.entries.delete(operation.projectId);
          },
        },
      );
      entry.taskId = task.id;
      try {
        guard();
      } catch (error) {
        this.host.runs.get(task.id)?.stop();
        throw error;
      }
      if (
        this.entries.get(operation.projectId) !== entry ||
        entry.status === "stopped"
      ) {
        this.host.runs.get(task.id)?.stop();
        return null;
      }
      entry.status = "running";
      return this.public(operation.projectId);
    } catch (error) {
      if (this.entries.get(operation.projectId) === entry)
        this.entries.delete(operation.projectId);
      throw error;
    }
  }
  browserOrigin(id) {
    const entry = this.entries.get(id);
    if (
      !entry ||
      entry.status !== "running" ||
      this.host.store.state.tasks.find((task) => task.id === entry.taskId)
        ?.status !== "running"
    )
      throw new ApiError(
        409,
        "Start an approved local project preview before opening its browser.",
      );
    this.access(entry.principal);
    return { origin: entry.origin, launchId: entry.id };
  }
  stop(id, principal) {
    this.access(principal);
    const entry = this.entries.get(id);
    if (!entry) return { stopped: true };
    entry.status = "stopping";
    this.host.runs.get(entry.taskId)?.stop();
    this.entries.delete(id);
    return { stopped: true };
  }
  close() {
    for (const entry of this.entries.values())
      this.host.runs.get(entry.taskId)?.stop();
    this.entries.clear();
  }
}
