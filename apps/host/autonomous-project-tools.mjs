import { ApiError, redact } from "./security.mjs";

const own = new Set(["project_checks", "project_check"]);
const pending = (approvalId) => ({
  status: "pending",
  pendingApprovalId: approvalId,
  summary: "Waiting for the exact PC approval and saved command outcome.",
});

// Commands retain their existing fresh PC approval. This adapter coordinates
// receipts; a model response, broad task request or service grant is no authority.
export function createAutonomousProjectTools(host, base) {
  function binding(approval) {
    const op = approval?.operation;
    if (!op?.autonomousRunId && !approval?.autonomousRunId) return;
    const record = host.autonomousTasks.get(op?.autonomousRunId);
    host.autonomousTasks.guard(record);
    const receipt = record.receipts.find(
      (r) => r.id === op.autonomousReceiptId,
    );
    if (
      approval.type !== "project_check" ||
      approval.status !== "executing" ||
      approval.autonomousRunId !== record.id ||
      approval.autonomousReceiptId !== receipt?.id ||
      !receipt ||
      receipt.tool !== "project_check" ||
      receipt.approvalId !== approval.id ||
      ![
        "pending",
        "attempting",
        "dispatching",
        "running",
        "awaiting_approval",
        "awaiting_result",
      ].includes(receipt.status) ||
      op.projectId !== record.projectId ||
      approval.requestedBy !== record.requestedBy ||
      receipt.request?.arguments?.name !== op.checkName ||
      receipt.request?.arguments?.manifestHash !== op.manifestHash
    )
      throw new ApiError(
        409,
        "This check approval no longer matches its active autonomous task.",
      );
    return record;
  }
  function context(record, guard) {
    guard();
    if (!record.projectId)
      throw new ApiError(400, "Select a project for project checks.");
    return host.project(record.projectId);
  }
  function settle(receipt, { record, guard }) {
    context(record, guard);
    const approval = host.store.state.approvals.find(
      (a) => a.id === receipt.approvalId,
    );
    if (
      !approval ||
      approval.operation?.autonomousRunId !== record.id ||
      approval.operation?.autonomousReceiptId !== receipt.id ||
      approval.requestedBy !== record.requestedBy ||
      approval.operation?.projectId !== record.projectId
    )
      throw new ApiError(
        409,
        "The saved check approval is unavailable or no longer matches.",
      );
    if (["pending", "executing"].includes(approval.status)) {
      if (
        approval.status === "pending" &&
        Date.parse(approval.expiresAt) <= Date.now()
      )
        return {
          status: "attention",
          summary: "The PC approval expired. No command was started.",
        };
      return pending(approval.id);
    }
    if (approval.status !== "started")
      return {
        status: "attention",
        summary: `Check approval ${approval.status}. ${redact(approval.error || "")}`,
      };
    const task = host.store.state.tasks.find(
      (t) => t.id === approval.result?.taskId,
    );
    if (
      !task ||
      task.autonomousRunId !== record.id ||
      task.autonomousReceiptId !== receipt.id ||
      task.approvalId !== approval.id ||
      task.projectId !== record.projectId ||
      task.requestedBy !== record.requestedBy ||
      task.checkName !== receipt.request.arguments.name ||
      task.manifestHash !== receipt.request.arguments.manifestHash
    )
      throw new ApiError(
        409,
        "The command outcome does not match this exact check request.",
      );
    if (
      ["running", "queued"].includes(task.status) ||
      host.commandProcesses.has(task.id)
    )
      return {
        ...pending(approval.id),
        summary:
          "The approved check is running; waiting for process close and its saved outcome.",
      };
    return {
      status:
        task.status === "completed" && task.exitCode === 0
          ? "completed"
          : task.status === "failed" &&
              Number.isInteger(task.exitCode) &&
              task.exitCode !== 0
            ? "failed"
            : "attention",
      summary: `${task.checkName}: ${task.status}, exit ${task.exitCode ?? "unknown"}. This verifies the script outcome, not the whole application.`,
      data: {
        taskId: task.id,
        approvalId: approval.id,
        checkName: task.checkName,
        manifestHash: task.manifestHash,
        status: task.status,
        exitCode: task.exitCode ?? null,
        output: redact(task.output || "").slice(-3000),
        outputTruncated: (task.output || "").length > 3000,
        error: redact(task.error || "").slice(0, 1000),
      },
    };
  }
  return {
    ...base,
    guardApproval: binding,
    catalogue(record, principal) {
      const result = base.catalogue(record, principal);
      const extra =
        !record || record.projectId
          ? [
              {
                tool: "project_checks",
                name: "Project check discovery",
                arguments: {},
                detail:
                  "Discover supported root npm checks and exact manifestHash. Does not run code.",
              },
              {
                tool: "project_check",
                name: "Approved project check",
                arguments: {
                  name: "listed check name",
                  manifestHash: "exact discovered hash",
                },
                detail:
                  "Request fresh PC approval for one check, then wait for actual process close and saved exit receipt. No automatic approval or dependency installation.",
              },
            ]
          : [];
      return Array.isArray(result)
        ? [...result, ...extra]
        : {
            ...result,
            limits: `${result.limits || ""} Selected-project npm checks use fresh exact PC approval and saved exit receipts.`,
            tools: [...(result.tools || []), ...extra],
          };
    },
    async execute(request, ctx) {
      if (!own.has(request.tool)) return base.execute(request, ctx);
      const project = context(ctx.record, ctx.guard);
      const args = request.arguments;
      if (
        !args ||
        Array.isArray(args) ||
        typeof args !== "object" ||
        Object.keys(args).some(
          (key) =>
            !(
              request.tool === "project_checks" ? [] : ["name", "manifestHash"]
            ).includes(key),
        )
      )
        throw new ApiError(400, "Unexpected project check fields.");
      if (request.tool === "project_checks") {
        const data = await host.discoverProjectChecks(
          project.id,
          ctx.principal,
        );
        ctx.guard();
        return {
          status: "completed",
          summary: "Read supported project check scripts; no command executed.",
          data: {
            supported: data.supported,
            reason: data.reason,
            detail: redact(data.detail || "").slice(0, 800),
            manifestHash: data.manifestHash,
            active: data.active,
            checks: (data.checks || []).slice(0, 5).map((check) => ({
              name: check.name,
              script: redact(check.script || "").slice(0, 300),
              preview: redact(check.preview || "").slice(0, 300),
            })),
            detailLimit:
              "Script text is bounded here; the exact PC approval contains the full execution preview.",
          },
        };
      }
      const receipt = ctx.record.receipts.find((r) => r.id === ctx.receiptId);
      if (!receipt || receipt.tool !== "project_check")
        throw new ApiError(
          409,
          "Save an exact check attempt before requesting approval.",
        );
      const approval = await host.requestProjectCheck(
        project,
        args,
        ctx.principal,
        {
          autonomousRunId: ctx.record.id,
          autonomousReceiptId: receipt.id,
          guard: ctx.guard,
          onCreated: (item) => {
            receipt.approvalId = item.id;
            ctx.record.approvalId = item.id;
          },
        },
      );
      ctx.guard();
      return pending(approval.id);
    },
    async settle(receipt, ctx) {
      if (receipt.tool === "project_check") return settle(receipt, ctx);
      return base.settle?.(receipt, ctx);
    },
    async verify(receipt, ctx) {
      if (!own.has(receipt.tool)) return base.verify(receipt, ctx);
      if (receipt.tool === "project_checks") {
        const result = await this.execute(receipt.request, ctx);
        return {
          verified: true,
          completionEligible: false,
          summary:
            "Fresh script discovery; availability does not prove a passed check.",
          data: result.data,
        };
      }
      const result = settle(receipt, ctx);
      return {
        verified: result.status === "completed",
        completionEligible: false,
        summary: result.summary,
        data: result.data,
      };
    },
    async stop(record) {
      try {
        await host.store.change((state) => {
          for (const approval of state.approvals)
            if (
              approval.operation?.autonomousRunId === record.id &&
              approval.status === "pending"
            ) {
              approval.status = "cancelled";
              approval.error = "The autonomous task stopped before approval.";
            }
        });
      } finally {
        // Revocation is an in-memory fact even if the receipt disk is unavailable.
        for (const task of host.store.state.tasks)
          if (
            task.autonomousRunId === record.id &&
            task.providerId === "terminal"
          )
            host.runs.get(task.id)?.stop();
        await base.stop?.(record);
      }
    },
  };
}
