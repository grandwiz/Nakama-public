// Delivery is separate from ownership and execution target. Unknown legacy
// conversations remain inspectable by the PC owner rather than broadcast.
export const originId = (principal) =>
  principal?.kind === "device" ? principal.id : "desktop";
export function deliveryId(state, record) {
  if (record.ownerOnly) return "desktop";
  if (record.deliveryDeviceId || record.visibleToDeviceId || record.requestedBy)
    return (
      record.deliveryDeviceId || record.visibleToDeviceId || record.requestedBy
    );
  for (const [field, collection] of [
    ["taskId", "tasks"],
    ["workflowId", "projectWorkflows"],
    ["intakeId", "projectIntakes"],
    ["deliveryId", "projectDeliveries"],
    ["autonomousRunId", "autonomousTasks"],
  ]) {
    const parent =
      record[field] &&
      state[collection]?.find((item) => item.id === record[field]);
    if (parent)
      return parent.deliveryDeviceId || parent.requestedBy || "desktop";
  }
  if (record.taskIds?.length) {
    const ids = new Set(
      record.taskIds.map(
        (id) =>
          state.tasks?.find((task) => task.id === id)?.requestedBy || "desktop",
      ),
    );
    if (ids.size === 1) return [...ids][0];
  }
  return record.sourceDeviceId || "desktop";
}
export function forDelivery(state, record, principal) {
  return deliveryId(state, record) === originId(principal);
}
export function deliveryRecord(state, record) {
  return { ...record, deliveryDeviceId: deliveryId(state, record) };
}

export function stampDeliveryState(state) {
  for (const collection of [
    "tasks",
    "projectWorkflows",
    "projectIntakes",
    "projectDeliveries",
    "autonomousTasks",
    "approvals",
  ])
    for (const record of state[collection] || [])
      record.deliveryDeviceId ||= deliveryId(state, record);
  for (const message of state.messages || [])
    message.deliveryDeviceId ||= deliveryId(state, message);
}
