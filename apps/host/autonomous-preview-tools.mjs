import { ApiError, redact } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";

const OWN = new Set([
  "project_previews",
  "project_preview",
  "project_preview_stop",
]);
const WAITING = new Set([
  "dispatching",
  "awaiting_approval",
  "awaiting_result",
]);
const pending = (approvalId) => ({
  status: "awaiting_approval",
  approvalId,
  summary:
    "Waiting for the exact PC preview approval and its saved launch receipt.",
});
const clean = (value, limit = 800) =>
  redact(String(value || "")).slice(0, limit);

// A launch receipt establishes only a live, specifically approved local process.
// Browser observations and application acceptance remain separate evidence.
export function createAutonomousPreviewTools(host, base) {
  function context(ctx) {
    ctx.guard();
    assertPersonalAccess(host.store.state, ctx.principal);
    if (!ctx.record.projectId || ctx.record.requestedBy !== ctx.principal.id)
      throw new ApiError(
        403,
        "Choose this task's selected project for a preview.",
      );
    return host.project(ctx.record.projectId);
  }
  function bind(approval) {
    const op = approval?.operation;
    if (approval?.type !== "project_preview")
      return base.guardApproval?.(approval);
    if (
      !op?.autonomousRunId &&
      !approval.autonomousRunId &&
      !op?.autonomousReceiptId &&
      !approval.autonomousReceiptId
    )
      return;
    const record = host.autonomousTasks.get(op?.autonomousRunId);
    host.autonomousTasks.guard(record);
    const receipt = record.receipts.find(
      (row) => row.id === op.autonomousReceiptId,
    );
    if (
      host.store.state.approvals.find((row) => row.id === approval.id) !==
        approval ||
      approval.status !== "executing" ||
      approval.autonomousRunId !== record.id ||
      approval.autonomousReceiptId !== receipt?.id ||
      !receipt ||
      receipt.tool !== "project_preview" ||
      receipt.approvalId !== approval.id ||
      !WAITING.has(receipt.status) ||
      op.projectId !== record.projectId ||
      approval.requestedBy !== record.requestedBy ||
      receipt.request?.arguments?.name !== op.checkName ||
      receipt.request?.arguments?.manifestHash !== op.manifestHash
    )
      throw new ApiError(
        409,
        "This preview approval no longer matches its exact active task.",
      );
    return record;
  }
  function launchReceipt(receipt, ctx) {
    const project = context(ctx),
      { record } = ctx,
      approval = host.store.state.approvals.find(
        (row) => row.id === receipt.approvalId,
      );
    if (
      !approval ||
      approval.type !== "project_preview" ||
      approval.autonomousRunId !== record.id ||
      approval.autonomousReceiptId !== receipt.id ||
      approval.operation?.autonomousRunId !== record.id ||
      approval.operation?.autonomousReceiptId !== receipt.id ||
      approval.operation?.projectId !== project.id ||
      approval.requestedBy !== record.requestedBy ||
      approval.operation?.checkName !== receipt.request?.arguments?.name ||
      approval.operation?.manifestHash !==
        receipt.request?.arguments?.manifestHash
    )
      throw new ApiError(
        409,
        "The saved preview approval does not match this task receipt.",
      );
    if (["pending", "executing"].includes(approval.status)) {
      if (
        approval.status === "pending" &&
        Date.parse(approval.expiresAt) <= Date.now()
      )
        return {
          status: "attention",
          summary:
            "The PC preview approval expired. No launch was established.",
        };
      return pending(approval.id);
    }
    if (approval.status !== "completed")
      return {
        status: "attention",
        summary: `Preview approval ${clean(approval.status, 60)}. ${clean(approval.error)}`,
      };
    const launch = host.projectPreviews.public(project.id),
      entry = host.projectPreviews.entries.get(project.id),
      task = host.store.state.tasks.find(
        (row) => row.id === approval.result?.taskId,
      );
    if (
      !launch ||
      !entry ||
      !task ||
      launch.id !== approval.result?.id ||
      launch.taskId !== task.id ||
      launch.origin !== approval.result?.origin ||
      entry.autonomousRunId !== record.id ||
      entry.autonomousReceiptId !== receipt.id ||
      entry.approvalId !== approval.id ||
      task.kind !== "project_preview" ||
      task.autonomousRunId !== record.id ||
      task.autonomousReceiptId !== receipt.id ||
      task.approvalId !== approval.id ||
      task.projectId !== project.id ||
      task.requestedBy !== record.requestedBy ||
      task.previewLaunchId !== launch.id ||
      task.previewOrigin !== launch.origin ||
      task.checkName !== receipt.request.arguments.name ||
      task.manifestHash !== receipt.request.arguments.manifestHash
    )
      return {
        status: "attention",
        summary:
          "The approved preview ended or its exact launch binding changed. No working page is established.",
      };
    if (
      task.status !== "running" ||
      launch.status !== "running" ||
      !host.commandProcesses.has(task.id)
    )
      return {
        status: "attention",
        summary: `The approved preview process is ${clean(task.status, 60)}. No working page is established.`,
      };
    const origin = host.projectPreviews.browserOrigin(project.id);
    if (origin.launchId !== launch.id || origin.origin !== launch.origin)
      throw new ApiError(
        409,
        "The local browser origin changed after preview approval.",
      );
    return {
      status: "completed",
      taskId: task.id,
      observation: {
        projectId: project.id,
        approvalId: approval.id,
        taskId: task.id,
        launchId: launch.id,
        origin: launch.origin,
        name: task.checkName,
        manifestHash: task.manifestHash,
        processStatus: task.status,
        scope: "approved_process_launch_only",
      },
      summary:
        "The exact PC-approved preview process is running. Open this project's browser and inspect the actual page; startup, HTTP readiness and application behavior are not yet verified.",
    };
  }
  function shutdownReceipt(receipt, ctx) {
    context(ctx);
    const ref = receipt.reference,
      source = ctx.record.receipts.find(
        (row) => row.id === ref?.sourceReceiptId,
      ),
      approval = host.store.state.approvals.find(
        (row) => row.id === ref?.approvalId,
      ),
      task = host.store.state.tasks.find((row) => row.id === ref?.taskId);
    if (
      !ref ||
      ref.tool !== "project_preview_stop" ||
      receipt.request?.arguments?.launchId !== ref.launchId ||
      !source ||
      source.tool !== "project_preview" ||
      source.status !== "completed" ||
      source.approvalId !== approval?.id ||
      !approval ||
      approval.type !== "project_preview" ||
      approval.status !== "completed" ||
      approval.autonomousRunId !== ctx.record.id ||
      approval.operation?.autonomousRunId !== ctx.record.id ||
      approval.autonomousReceiptId !== source.id ||
      approval.operation?.autonomousReceiptId !== source.id ||
      approval.requestedBy !== ctx.record.requestedBy ||
      approval.operation?.projectId !== ctx.record.projectId ||
      approval.operation?.checkName !== source.request?.arguments?.name ||
      approval.operation?.manifestHash !==
        source.request?.arguments?.manifestHash ||
      approval.result?.id !== ref.launchId ||
      approval.result?.taskId !== ref.taskId ||
      !task ||
      task.kind !== "project_preview" ||
      task.projectId !== ctx.record.projectId ||
      task.autonomousRunId !== ctx.record.id ||
      task.autonomousReceiptId !== source.id ||
      task.approvalId !== approval.id ||
      task.requestedBy !== ctx.record.requestedBy ||
      task.previewLaunchId !== ref.launchId ||
      task.previewOrigin !== approval.result.origin ||
      task.checkName !== source.request?.arguments?.name ||
      task.manifestHash !== source.request?.arguments?.manifestHash
    )
      throw new ApiError(
        409,
        "The shutdown receipt does not match this task's exact approved preview.",
      );
    const observation = {
      launchId: ref.launchId,
      taskId: task.id,
      processStatus: task.status,
      scope: "owned_preview_process_shutdown",
    };
    if (
      ["running", "queued"].includes(task.status) ||
      host.commandProcesses.has(task.id)
    )
      return {
        status: "awaiting_result",
        taskId: task.id,
        reference: ref,
        observation,
        summary:
          "Preview Stop was requested. Waiting for actual process close and its saved terminal receipt.",
      };
    return {
      status: task.status === "stopped" ? "completed" : "attention",
      taskId: task.id,
      reference: ref,
      observation,
      summary:
        task.status === "stopped"
          ? "This task's exact preview process stopped and its terminal receipt is saved. This verifies shutdown only, not application acceptance."
          : "The preview ended without a confirmed saved Stop outcome. Inspect its terminal receipt before more work.",
    };
  }
  return {
    ...base,
    guardApproval: bind,
    catalogue(record, principal) {
      const result = base.catalogue(record, principal),
        extra =
          !record || record.projectId
            ? [
                {
                  tool: "project_previews",
                  name: "Local preview discovery",
                  arguments: {},
                  detail:
                    "Read available root dev/start scripts and exact manifestHash. Only plain vite/next dev scripts can be launched; dependencies must already exist.",
                },
                {
                  tool: "project_preview",
                  name: "Approved local preview",
                  arguments: {
                    name: "listed dev/start name",
                    manifestHash: "exact discovered hash",
                  },
                  detail:
                    "Request one fresh exact PC approval for a local preview. A saved launch receipt is not HTTP readiness or application acceptance. Then use browser create mode project and fresh reads.",
                },
                {
                  tool: "project_preview_stop",
                  name: "Stop this task's local preview",
                  arguments: {
                    launchId:
                      "exact launchId from this task's completed project_preview receipt",
                  },
                  detail:
                    "Stop only the preview this task launched, then wait for real process close and saved shutdown before further builds/checks. Cannot stop a manual or another task's preview.",
                },
              ]
            : [];
      return Array.isArray(result)
        ? [...result, ...extra]
        : { ...result, tools: [...(result.tools || []), ...extra] };
    },
    async execute(request, ctx) {
      if (!OWN.has(request.tool)) return base.execute(request, ctx);
      const project = context(ctx),
        args = request.arguments,
        fields =
          request.tool === "project_previews"
            ? []
            : request.tool === "project_preview_stop"
              ? ["launchId"]
              : ["name", "manifestHash"];
      if (
        Object.keys(request).some(
          (key) => !["tool", "arguments"].includes(key),
        ) ||
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        Object.keys(args).some((key) => !fields.includes(key))
      )
        throw new ApiError(400, "Unexpected autonomous preview fields.");
      if (request.tool === "project_previews") {
        const result = await host.projectPreviews.describe(
          project.id,
          ctx.principal,
        );
        context(ctx);
        return {
          status: "completed",
          summary:
            "Read local preview scripts and current launch state; no command executed.",
          observation: {
            supported: result.supported,
            reason: clean(result.reason, 100),
            detail: clean(result.detail),
            runtimeAvailable: result.runtime?.available === true,
            manifestHash: result.manifestHash,
            checks: (result.checks || []).slice(0, 2).map((check) => ({
              name: check.name,
              script: clean(check.script, 300),
              preview: clean(check.preview, 300),
            })),
            launch: result.launch && {
              id: result.launch.id,
              taskId: result.launch.taskId,
              origin: result.launch.origin,
              status: result.launch.status,
            },
            detailLimit:
              "Full command preview appears in the exact PC approval. Existing previews are not owned or stopped by this task.",
          },
        };
      }
      if (request.tool === "project_preview_stop") {
        if (
          typeof args.launchId !== "string" ||
          !args.launchId ||
          args.launchId.length > 100
        )
          throw new ApiError(
            400,
            "Choose this task's exact saved preview launch ID.",
          );
        const attempt = ctx.record.receipts.find(
            (row) => row.id === ctx.receiptId,
          ),
          source = ctx.record.receipts.find(
            (row) =>
              row.tool === "project_preview" &&
              row.status === "completed" &&
              row.observation?.launchId === args.launchId,
          );
        if (
          !attempt ||
          attempt.tool !== "project_preview_stop" ||
          attempt.status !== "dispatching" ||
          attempt.request?.arguments?.launchId !== args.launchId ||
          !source
        )
          throw new ApiError(
            409,
            "Save an exact shutdown attempt for this task's completed preview launch.",
          );
        const current = launchReceipt(source, ctx);
        if (
          current.status !== "completed" ||
          current.observation.launchId !== args.launchId
        )
          throw new ApiError(
            409,
            "This task's exact preview is no longer running; inspect its current receipt.",
          );
        const reference = {
          tool: "project_preview_stop",
          launchId: args.launchId,
          taskId: current.taskId,
          sourceReceiptId: source.id,
          approvalId: source.approvalId,
        };
        // Retain the target before Stop removes its ephemeral preview entry.
        await host.store.change(() => {
          context(ctx);
          attempt.reference = reference;
        });
        context(ctx);
        const entry = host.projectPreviews.entries.get(project.id);
        if (
          !entry ||
          entry.id !== args.launchId ||
          entry.taskId !== reference.taskId ||
          entry.autonomousRunId !== ctx.record.id
        )
          throw new ApiError(409, "The preview changed before shutdown.");
        host.projectPreviews.stop(project.id, ctx.principal);
        return shutdownReceipt(attempt, ctx);
      }
      if (
        !["dev", "start"].includes(args.name) ||
        typeof args.manifestHash !== "string" ||
        !/^[a-f0-9]{64}$/i.test(args.manifestHash)
      )
        throw new ApiError(
          400,
          "Choose a discovered dev/start script and its exact manifest hash.",
        );
      const receipt = ctx.record.receipts.find(
        (row) => row.id === ctx.receiptId,
      );
      if (
        !receipt ||
        receipt.tool !== "project_preview" ||
        receipt.status !== "dispatching" ||
        receipt.request?.arguments?.name !== args.name ||
        receipt.request?.arguments?.manifestHash !== args.manifestHash
      )
        throw new ApiError(
          409,
          "Save this exact preview request before asking for approval.",
        );
      const approval = await host.projectPreviews.request(
        project.id,
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
      context(ctx);
      return pending(approval.id);
    },
    async settle(receipt, ctx) {
      if (receipt.tool === "project_preview")
        return launchReceipt(receipt, ctx);
      if (receipt.tool === "project_preview_stop")
        return shutdownReceipt(receipt, ctx);
      return base.settle?.(receipt, ctx);
    },
    async verify(receipt, ctx) {
      if (!OWN.has(receipt.tool)) return base.verify(receipt, ctx);
      if (receipt.tool === "project_previews") {
        const fresh = await this.execute(receipt.request, ctx);
        return {
          verified: true,
          completionEligible: false,
          summary:
            "Fresh preview discovery only; no page or application behavior verified.",
          observation: fresh.observation,
        };
      }
      const result =
        receipt.tool === "project_preview_stop"
          ? shutdownReceipt(receipt, ctx)
          : launchReceipt(receipt, ctx);
      return {
        verified: result.status === "completed",
        completionEligible: false,
        summary: result.summary,
        observation: result.observation,
      };
    },
    async stop(record) {
      try {
        await host.store.change((state) => {
          for (const approval of state.approvals)
            if (
              approval.type === "project_preview" &&
              approval.operation?.autonomousRunId === record.id &&
              approval.status === "pending"
            ) {
              approval.status = "cancelled";
              approval.error =
                "The autonomous task stopped before preview approval.";
            }
        });
      } finally {
        // A delayed spawn may not yet have returned its task ID to the entry.
        for (const task of host.store.state.tasks)
          if (
            task.autonomousRunId === record.id &&
            task.kind === "project_preview"
          )
            host.runs.get(task.id)?.stop();
        for (const [id, entry] of host.projectPreviews.entries)
          if (entry.autonomousRunId === record.id) {
            entry.status = "stopping";
            host.runs.get(entry.taskId)?.stop();
            host.projectPreviews.entries.delete(id);
          }
        await base.stop?.(record);
      }
    },
  };
}
