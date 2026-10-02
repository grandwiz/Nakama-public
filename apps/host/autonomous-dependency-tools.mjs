import { ApiError, redact } from "./security.mjs";

const own = new Set(["project_dependencies", "project_prepare_dependencies"]);
const waiting = (
  id,
  summary = "Waiting for exact PC approval and the saved dependency preparation result.",
) => ({
  status: "pending",
  pendingApprovalId: id,
  summary,
});
export function createAutonomousDependencyTools(host, base) {
  function context(ctx) {
    ctx.guard();
    if (!ctx.record.projectId)
      throw new ApiError(400, "Select a project for dependency preparation.");
    return host.project(ctx.record.projectId);
  }
  function exact(approval, record, receipt) {
    const op = approval?.operation;
    return (
      approval?.type === "project_dependencies" &&
      receipt?.tool === "project_prepare_dependencies" &&
      approval.autonomousRunId === record.id &&
      op?.autonomousRunId === record.id &&
      approval.autonomousReceiptId === receipt.id &&
      op.autonomousReceiptId === receipt.id &&
      receipt.approvalId === approval.id &&
      approval.requestedBy === record.requestedBy &&
      op.requestedBy === record.requestedBy &&
      op.projectId === record.projectId &&
      op.manifestHash === receipt.request.arguments.manifestHash &&
      op.lockHash === receipt.request.arguments.lockHash
    );
  }
  async function settle(receipt, ctx) {
    const project = context(ctx);
    const approval = host.store.state.approvals.find(
      (a) => a.id === receipt.approvalId,
    );
    if (!exact(approval, ctx.record, receipt))
      throw new ApiError(
        409,
        "Dependency approval no longer matches this exact task attempt.",
      );
    if (["pending", "executing"].includes(approval.status)) {
      if (
        approval.status === "pending" &&
        Date.parse(approval.expiresAt) <= Date.now()
      )
        return {
          status: "attention",
          summary:
            "The dependency approval expired; no preparation was started.",
        };
      return waiting(approval.id);
    }
    if (approval.status !== "started")
      return {
        status: "attention",
        summary: `Dependency approval ${approval.status}. Review before any further attempt.`,
      };
    const task = host.store.state.tasks.find(
      (t) => t.id === approval.result?.taskId,
    );
    if (
      !task ||
      task.kind !== "project_dependencies" ||
      task.autonomousRunId !== ctx.record.id ||
      task.autonomousReceiptId !== receipt.id ||
      task.approvalId !== approval.id ||
      task.requestedBy !== ctx.record.requestedBy ||
      task.projectId !== project.id ||
      task.manifestHash !== approval.operation.manifestHash ||
      task.lockHash !== approval.operation.lockHash
    )
      throw new ApiError(
        409,
        "The saved process does not match this dependency attempt.",
      );
    if (
      ["running", "queued"].includes(task.status) ||
      host.commandProcesses.has(task.id)
    )
      return waiting(
        approval.id,
        "Dependency preparation is running; waiting for process close and its saved outcome.",
      );
    if (task.status !== "completed" || task.exitCode !== 0)
      return {
        status: "attention",
        summary: `Dependency preparation ${task.status}, exit ${task.exitCode ?? "unknown"}. It will not be retried automatically.`,
        data: {
          taskId: task.id,
          output: redact(task.output || "").slice(-3000),
          error: redact(task.error || "").slice(0, 1000),
        },
      };
    const result = await host.projectDependencies.tools.verifyDependencyResult({
      ...host.projectDependencies.context(project),
      operation: approval.operation,
      task,
      approvalId: approval.id,
      requestedBy: ctx.record.requestedBy,
      processClosed: true,
    });
    ctx.guard();
    if (result?.verified !== true)
      return {
        status: "attention",
        summary: redact(
          result?.summary ||
            "Dependency preparation could not be verified. Inspect it before another attempt.",
        ).slice(0, 1800),
        data: {
          verified: false,
          completionEligible: false,
          taskId: task.id,
          approvalId: approval.id,
        },
      };
    return {
      status: "completed",
      summary:
        "The exact locked dependency preparation finished successfully with lifecycle scripts disabled. Application checks are still required.",
      data: { ...result, taskId: task.id, approvalId: approval.id },
    };
  }
  return {
    ...base,
    catalogue(record, principal) {
      const result = base.catalogue(record, principal);
      const extra =
        !record || record.projectId
          ? [
              {
                tool: "project_dependencies",
                name: "Dependency preparation discovery",
                arguments: {},
                detail:
                  "Inspect supported public npm lockfile preparation; this does not install anything.",
              },
              {
                tool: "project_prepare_dependencies",
                name: "Approved locked dependency preparation",
                arguments: {
                  manifestHash: "discovered package hash",
                  lockHash: "discovered lockfile hash",
                },
                detail:
                  "Request exact PC approval for npm ci with lifecycle scripts disabled, then wait for the saved outcome. It replaces node_modules. Failed or uncertain installation stops for attention; no blind retries.",
              },
            ]
          : [];
      return Array.isArray(result)
        ? [...result, ...extra]
        : { ...result, tools: [...(result.tools || []), ...extra] };
    },
    guardApproval(approval) {
      if (approval?.type !== "project_dependencies")
        return base.guardApproval?.(approval);
      if (!approval.autonomousRunId && !approval.operation?.autonomousRunId)
        return;
      const record = host.autonomousTasks.get(
        approval.operation?.autonomousRunId,
      );
      host.autonomousTasks.guard(record);
      const receipt = record.receipts.find(
        (r) => r.id === approval.operation?.autonomousReceiptId,
      );
      if (
        !exact(approval, record, receipt) ||
        approval.status !== "executing" ||
        !["dispatching", "awaiting_approval", "awaiting_result"].includes(
          receipt.status,
        )
      )
        throw new ApiError(
          409,
          "This dependency approval no longer belongs to an active task attempt.",
        );
    },
    async execute(request, ctx) {
      if (!own.has(request.tool)) return base.execute(request, ctx);
      const project = context(ctx);
      const args = request.arguments;
      const fields =
        request.tool === "project_dependencies"
          ? []
          : ["manifestHash", "lockHash"];
      if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        Object.keys(args).some((k) => !fields.includes(k))
      )
        throw new ApiError(400, "Unexpected dependency preparation fields.");
      if (request.tool === "project_dependencies") {
        const result = await host.discoverProjectDependencies(
          project.id,
          ctx.principal,
        );
        ctx.guard();
        return {
          status: "completed",
          summary:
            "Read dependency preparation availability; no packages installed.",
          data: result,
        };
      }
      const receipt = ctx.record.receipts.find((r) => r.id === ctx.receiptId);
      if (!receipt || receipt.tool !== request.tool)
        throw new ApiError(
          409,
          "Save a dependency attempt before requesting approval.",
        );
      const approval = await host.requestProjectDependencies(
        project,
        args,
        ctx.principal,
        {
          autonomousRunId: ctx.record.id,
          autonomousReceiptId: receipt.id,
          guard: ctx.guard,
          onCreated(item) {
            receipt.approvalId = item.id;
            ctx.record.approvalId = item.id;
          },
        },
      );
      ctx.guard();
      return waiting(approval.id);
    },
    async settle(receipt, ctx) {
      return receipt.tool === "project_prepare_dependencies"
        ? settle(receipt, ctx)
        : base.settle?.(receipt, ctx);
    },
    async verify(receipt, ctx) {
      if (!own.has(receipt.tool)) return base.verify(receipt, ctx);
      const result =
        receipt.tool === "project_dependencies"
          ? await this.execute(receipt.request, ctx)
          : await settle(receipt, ctx);
      return {
        verified: result.status === "completed",
        completionEligible: false,
        summary: result.summary,
        data: result.data,
      };
    },
  };
}
