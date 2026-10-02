import type { CheckRepair, Project, Provider, Task } from "./types";

const checks = new Set(["test", "lint", "typecheck", "check", "build"]);
const activeStatuses = new Set([
  "preparing",
  "building",
  "awaiting_approval",
  "checking",
]);

export function eligibleRepairSource(
  project: Project,
  task?: Task,
): task is Task {
  return Boolean(
    project.id &&
    task?.id &&
    task.projectId === project.id &&
    task.kind === "project_check" &&
    task.status === "failed" &&
    /^[a-f0-9]{64}$/.test(task.manifestHash || "") &&
    Number.isSafeInteger(task.exitCode) &&
    Number(task.exitCode) > 0 &&
    checks.has(task.checkName || ""),
  );
}

export function activeProjectRepair(
  repairs: CheckRepair[] | undefined,
  projectId: string,
) {
  return repairs?.find(
    (repair) =>
      repair.projectId === projectId && activeStatuses.has(repair.status),
  );
}

export function repairRequest(
  source: Task,
  provider: Provider,
  model: string,
  effort: string,
) {
  if (!provider.id || provider.connectionType !== "subscription")
    throw new Error(
      "Choose a subscription AI connection before starting a repair.",
    );
  if (
    !source.id ||
    source.kind !== "project_check" ||
    source.status !== "failed" ||
    !/^[a-f0-9]{64}$/.test(source.manifestHash || "") ||
    !Number.isSafeInteger(source.exitCode) ||
    Number(source.exitCode) <= 0 ||
    !checks.has(source.checkName || "")
  )
    throw new Error("Choose a failed project check.");
  return {
    sourceTaskId: source.id,
    providerId: provider.id,
    ...(model.trim() ? { model: model.trim() } : {}),
    ...(effort ? { effort } : {}),
  };
}

// A newly observed attempt invalidates an open buffer even if the complete
// repair finished between state polls. Lifecycle changes keep it stale while
// work may still be saving files; no current buffer is silently replaced.
export function repairFileRevision(
  repairs: CheckRepair[] | undefined,
  projectId: string,
) {
  return (repairs || [])
    .filter((repair) => repair.projectId === projectId)
    .map(
      (repair) => `${repair.id}:${repair.buildTaskId || ""}:${repair.status}`,
    )
    .sort()
    .join("|");
}

export function repairResult(repair: CheckRepair, tasks: Task[]) {
  const check = tasks.find(
    (task) =>
      task.id === repair.checkTaskId &&
      task.projectId === repair.projectId &&
      task.kind === "project_check" &&
      task.checkName === repair.checkName,
  );
  const active = activeStatuses.has(repair.status);
  if (repair.status === "completed") {
    if (check?.status === "completed" && check.exitCode === 0)
      return {
        title: "Check passed after repair",
        tone: "completed",
        active,
        check,
      };
    return {
      title: "Review the final check result",
      tone: "unknown",
      active: false,
      check,
    };
  }
  const titles: Record<string, string> = {
    preparing: "Preparing one repair attempt",
    building: "Repairing project files",
    awaiting_approval: "Rerun needs desktop approval",
    checking: "Running the approved check",
    needs_review: "Needs your review",
    stopped: "Repair stopped",
    interrupted: "Repair interrupted",
  };
  return {
    title: titles[repair.status] || "Repair status unavailable",
    tone: active
      ? "running"
      : repair.status === "needs_review"
        ? "failed"
        : repair.status,
    active,
    check,
  };
}
