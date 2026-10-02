import { forDelivery, originId } from "./device-delivery.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";

// Notifications carry generic descriptions and stable record IDs, never question
// contents, website addresses, login fields, credentials or provider responses.
export function publicAttention(
  state,
  principal,
  browser = { sessions: [] },
  connectionRequests = [],
  monitoring = { monitors: [] },
  maintenance = { requests: [] },
) {
  try {
    assertPersonalAccess(state, principal);
  } catch {
    return { version: 1, items: [] };
  }
  const items = [];
  for (const monitor of monitoring.monitors || [])
    if (monitor.attentionId && monitor.status === "attention" && (forDelivery(state, monitor, principal) || monitor.sharedDeviceIds?.includes(originId(principal))))
      items.push({
        id: `monitor:${monitor.id}:${monitor.attentionId}`,
        kind: "monitor",
        title: "A Nakama monitor needs your attention",
        monitorId: monitor.id,
        reason: ["captcha", "queue", "checkout"].includes(
          monitor.attentionReason,
        )
          ? monitor.attentionReason
          : "page",
        createdAt: monitor.updatedAt,
      });
  for (const request of maintenance.requests || [])
    if (
      [
        "review_required",
        "review_ready",
        "packaged",
        "failed",
        "interrupted",
        "awaiting_install_approval",
      ].includes(request.status) && forDelivery(state, request, principal)
    )
      items.push({
        id: `maintenance:${request.id}:${request.revision}`,
        kind: "upgrade",
        title: "A Nakama upgrade needs your review",
        selfMaintenanceId: request.id,
        createdAt: request.updatedAt,
      });
  for (const run of state.autonomousTasks || []) {
    if (
      run.status !== "awaiting_answers" ||
      !forDelivery(state, run, principal)
    )
      continue;
    for (const question of run.questions || [])
      if (!question.answer)
        items.push({
          id: `autonomous:${run.id}:${question.id}`,
          kind: "question",
          title: "Nakama has a task question",
          autonomousRunId: run.id,
          questionId: question.id,
          projectId: run.projectId,
          createdAt: run.updatedAt || run.createdAt,
        });
  }
  for (const workflow of state.projectWorkflows || []) {
    if (workflow.status !== "awaiting_answers" || !forDelivery(state, workflow, principal)) continue;
    for (const question of workflow.questions || [])
      if (!question.answer)
        items.push({
          id: `question:${workflow.id}:${question.id}`,
          kind: "question",
          title: "Nakama has a project question",
          projectId: workflow.projectId,
          workflowId: workflow.id,
          questionId: question.id,
          createdAt: workflow.updatedAt || workflow.createdAt,
        });
  }
  for (const delivery of state.projectDeliveries || [])
    if (delivery.status === "awaiting_answers" && forDelivery(state, delivery, principal))
      for (const q of delivery.questions || [])
        if (!q.answer)
          items.push({
            id: `delivery:${delivery.id}:${q.id}`,
            kind: "question",
            title: "Nakama has a delivery question",
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            questionId: q.id,
            createdAt: delivery.updatedAt,
          });
  for (const intake of state.projectIntakes || []) {
    if (intake.status !== "awaiting_answers" || !forDelivery(state, intake, principal)) continue;
    for (const question of intake.questions || [])
      if (!question.answer)
        items.push({
          id: `intake:${intake.id}:${question.id}`,
          kind: "question",
          title: "Nakama needs project setup details",
          projectId: intake.projectId,
          intakeId: intake.id,
          questionId: question.id,
          createdAt: intake.updatedAt || intake.createdAt,
        });
  }
  for (const session of browser?.sessions || [])
    if (
      session.status === "attention" && forDelivery(state, session, principal) ||
      (session.sharedDeviceId === principal.id &&
        session.status === "human_control")
    )
      items.push({
        id: `browser:${session.id}:${session.attentionId || session.updatedAt}`,
        kind: "login",
        title: "Nakama's browser needs your attention",
        browserSessionId: session.id,
        projectId: session.projectId,
        workflowId: session.workflowId,
        createdAt: session.updatedAt,
      });
  for (const request of connectionRequests)
    if (request.status === "waiting" && forDelivery(state, request, principal))
      items.push({
        id: `connection:${request.id}`,
        kind: "login",
        title: "Nakama needs an account connection",
        connectionRequestId: request.id,
        createdAt: request.createdAt,
      });
  for (const approval of state.approvals || [])
    if (
      approval.status === "pending" &&
      (principal.kind === "owner" || forDelivery(state, approval, principal)) &&
      Date.parse(approval.expiresAt) > Date.now()
    )
      items.push({
        id: `approval:${approval.id}`,
        kind: "approval",
        title: "A Nakama action needs approval on your PC",
        approvalId: approval.id,
        createdAt: approval.createdAt,
      });
  for (const timer of state.clock?.timers || [])
    if (timer.status === "finished" && (timer.targetDeviceId || timer.requestedBy || "desktop") === originId(principal))
      items.push({ id: `timer:${timer.id}`, kind: "timer", title: "A Nakama timer has finished", timerId: timer.id, createdAt: timer.finishedAt });
  return { version: 1, items: items.slice(-100).map((item) => ({ ...item, deliveryDeviceId: originId(principal) })) };
}
