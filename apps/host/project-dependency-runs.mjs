import { ApiError } from "./security.mjs";
import { createProjectDependencyTools } from "./project-dependencies.mjs";

// This is an approval coordinator, never an automatic package installer.
export class ProjectDependencyRuns {
  constructor(host, { tools = createProjectDependencyTools() } = {}) {
    this.host = host;
    this.tools = tools;
  }
  context(project) {
    return {
      workspaceRoot: this.host.store.state.config.workspaceRoot,
      project,
      dataDir: this.host.store.dir,
    };
  }
  async describe(id, principal) {
    this.host.projectWorkflows.access(principal);
    const result = await this.tools.discoverDependencies(
      this.context(this.host.project(id)),
    );
    this.host.projectWorkflows.access(principal);
    return { ...result, active: this.host.checking.has(id) };
  }
  async request(project, body, principal, options = {}) {
    if (
      !body ||
      Array.isArray(body) ||
      typeof body !== "object" ||
      Object.keys(body).some(
        (key) => !["manifestHash", "lockHash"].includes(key),
      )
    )
      throw new ApiError(
        400,
        "Choose the discovered package and lockfile hashes without custom arguments.",
      );
    const guard = () => {
      this.host.projectWorkflows.access(principal);
      options.guard?.();
      if (options.workflowId) {
        const workflow = this.host.projectWorkflows.get(options.workflowId);
        this.host.projectWorkflows.guard(workflow);
        if (
          workflow.projectId !== project.id ||
          workflow.requestedBy !== principal.id ||
          options.autonomousRunId ||
          typeof options.guard !== "function"
        )
          throw new ApiError(
            409,
            "Dependency preparation does not match its project workflow.",
          );
      }
      if (options.autonomousRunId) {
        const run = this.host.autonomousTasks.get(options.autonomousRunId);
        this.host.autonomousTasks.guard(run);
        if (
          run.projectId !== project.id ||
          run.requestedBy !== principal.id ||
          options.workflowId ||
          typeof options.guard !== "function" ||
          !run.receipts.some(
            (r) =>
              r.id === options.autonomousReceiptId &&
              r.tool === "project_prepare_dependencies",
          )
        )
          throw new ApiError(
            409,
            "Dependency preparation does not match its autonomous task.",
          );
      }
    };
    guard();
    this.host.assertCheckAvailable(project.id, undefined, options.workflowId);
    const operation = await this.tools.prepareDependencies({
      ...this.context(project),
      ...body,
      requestedBy: principal.id,
    });
    operation.checkName = "dependencies";
    guard();
    this.host.assertCheckAvailable(project.id, undefined, options.workflowId);
    if (options.workflowId) operation.workflowId = options.workflowId;
    if (options.autonomousRunId)
      Object.assign(operation, {
        autonomousRunId: options.autonomousRunId,
        autonomousReceiptId: options.autonomousReceiptId,
      });
    return this.host.approval(
      "project_dependencies",
      `Prepare locked dependencies for ${project.name}`,
      `Run the reviewed npm ci operation under your Windows account. It replaces this project's node_modules and downloads the packages in its exact package-lock.json from the public npm registry. Package lifecycle scripts, audit and funding requests are disabled. Native packages needing install scripts may remain unusable. This is not an operating-system sandbox or an application acceptance test.\n\n${operation.preview || ""}\nPackage hash: ${operation.manifestHash}\nLockfile hash: ${operation.lockHash}\nExecutable: ${operation.command}\nArguments: ${JSON.stringify(operation.args)}`,
      operation,
      principal,
      {
        guard,
        onCreated: (approval) => {
          if (options.workflowId) approval.workflowId = options.workflowId;
          if (options.autonomousRunId)
            Object.assign(approval, {
              autonomousRunId: options.autonomousRunId,
              autonomousReceiptId: options.autonomousReceiptId,
            });
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
    const guard = () => {
      this.host.projectWorkflows.access(principal);
      if (
        approval.type !== "project_dependencies" ||
        approval.status !== "executing" ||
        approval.operation !== operation ||
        operation.requestedBy !== principal.id
      )
        throw new ApiError(
          409,
          "This exact dependency approval is no longer executable.",
        );
      this.host.autonomyTools?.guardApproval(approval);
      if (operation.workflowId || approval.workflowId)
        this.host.projectWorkflows.guardCheckApproval(approval);
    };
    guard();
    if (operation.workflowId)
      await this.host.projectWorkflows.beforeCheckApproval(approval);
    guard();
    this.host.assertCheckAvailable(
      operation.projectId,
      undefined,
      operation.workflowId,
    );
    this.host.checking.add(operation.projectId);
    try {
      const verified = await this.tools.verifyDependencies({
        ...this.context(this.host.project(operation.projectId)),
        operation,
        requestedBy: principal.id,
      });
      if (operation.workflowId)
        await this.host.projectWorkflows.beforeCheckApproval(approval);
      guard();
      return await this.host.startCommand(
        { ...operation, command: verified.command, args: verified.args },
        principal,
        {
          expectedRoot: verified.cwd,
          env: verified.env,
          dependencies: {
            manifestHash: operation.manifestHash,
            lockHash: operation.lockHash,
          },
          workflowId: operation.workflowId,
          autonomousRunId: operation.autonomousRunId,
          autonomousReceiptId: operation.autonomousReceiptId,
          approvalId: approval.id,
          guard,
          beforeSpawn: async () => {
            const fresh = await this.tools.verifyDependencies({
              ...this.context(this.host.project(operation.projectId)),
              operation,
              requestedBy: principal.id,
            });
            guard();
            if (
              fresh.cwd !== verified.cwd ||
              fresh.command !== verified.command ||
              JSON.stringify(fresh.args) !== JSON.stringify(verified.args)
            )
              throw new ApiError(
                409,
                "Dependency execution changed before launch. Request a new approval.",
              );
          },
          onProcessClose: () => this.host.checking.delete(operation.projectId),
        },
      );
    } catch (error) {
      this.host.checking.delete(operation.projectId);
      throw error;
    }
  }
}
