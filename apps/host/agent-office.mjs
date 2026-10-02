import { randomInt } from "node:crypto";
import { redact } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";

// Only assigned names leave the host. This pool is not a provider/account catalogue.
const names = [
  "Momo",
  "Haru",
  "Yuki",
  "Sora",
  "Hana",
  "Yuzu",
  "Kiko",
  "Nori",
  "Mugi",
  "Aoi",
  "Rin",
  "Suzu",
  "Koharu",
  "Chiyo",
  "Mika",
  "Natsu",
  "Hoshi",
  "Ume",
  "Kuma",
  "Mochi",
  "Kuri",
  "Koko",
  "Mio",
  "Saki",
  "Nana",
  "Hina",
  "Yori",
  "Riku",
  "Ren",
  "Akari",
  "Fuyu",
  "Tama",
  "Sakura",
  "Kaede",
  "Sumi",
  "Kinu",
  "Mame",
  "Yume",
  "Hotaru",
  "Koyuki",
  "Kiri",
  "Mari",
  "Piko",
  "Koto",
  "Haku",
  "Yua",
  "Niko",
  "Tsubaki",
];
// Cache only in memory. State rollback can restore the same object, so cached
// source inputs alone are insufficient: also compare the last projected values.
const projectionCaches = new WeakMap();
export const defaultAgentOffice = () => ({ version: 1, agents: [] });
const bounded = (value, limit) =>
  typeof value === "string" && value.trim()
    ? redact(value).slice(0, limit)
    : undefined;
const recentOutput = (value) =>
  typeof value === "string" && value.trim()
    ? redact(value).slice(-16000)
    : undefined;
function allocateName(used) {
  for (let suffix = 1; ; suffix++) {
    const available = names
      .map((name) => (suffix === 1 ? name : `${name} ${suffix}`))
      .filter((name) => !used.has(name));
    if (available.length) return available[randomInt(available.length)];
  }
}
function taskRole(task) {
  if (task.kind === "autonomous_task") return "Autonomous task coordinator";
  if (task.workflowStage)
    return `${task.routingRole || "worker"} · ${task.workflowStage.replaceAll("_", " ")}`;
  if (task.providerId === "terminal")
    return task.kind === "project_check"
      ? "Project check runner"
      : "Command runner";
  if (task.repairId) return "Repair worker";
  if (task.routingRole === "interaction") return "Nakama interaction";
  return (
    task.routingRole ||
    (task.mode === "act"
      ? "Task agent"
      : task.mode === "build"
        ? "File worker"
        : "Conversation agent")
  );
}

/** Materialize receipts only. It never spawns a model or invents a thinking state. */
export function syncAgentOffice(state) {
  const office = (state.agentOffice ||= defaultAgentOffice()),
    records = new Map(office.agents.map((agent) => [agent.id, agent]));
  const used = new Set(office.agents.map((agent) => agent.name)),
    sourceIds = new Set();
  let cache = projectionCaches.get(state);
  if (!cache) {
    cache = new Map();
    projectionCaches.set(state, cache);
  }
  const put = (id, inputs, build) => {
    sourceIds.add(id);
    let agent = records.get(id);
    const cached = cache.get(id);
    if (
      cached &&
      agent &&
      inputs.length === cached.inputs.length &&
      inputs.every((value, index) => value === cached.inputs[index]) &&
      Object.keys(agent).length === Object.keys(cached.data).length + 2 &&
      Object.entries(cached.data).every(([key, value]) => agent[key] === value)
    )
      return;
    const data = Object.fromEntries(
      Object.entries(build()).filter(([, value]) => value !== undefined),
    );
    if (!agent) {
      const name = allocateName(used);
      used.add(name);
      agent = { id, name };
      office.agents.push(agent);
      records.set(id, agent);
    }
    for (const key of Object.keys(agent))
      if (!["id", "name"].includes(key)) delete agent[key];
    Object.assign(agent, data);
    cache.set(id, { inputs, data });
  };
  for (const workflow of state.projectWorkflows || []) {
    const assignment = workflow.assignments?.manager;
    const unanswered =
      workflow.questions?.filter((question) => !question.answer).length || 0;
    put(
      `workflow:${workflow.id}`,
      [
        workflow.projectId,
        workflow.message,
        workflow.status,
        workflow.stage,
        workflow.delivery,
        workflow.error,
        unanswered,
        workflow.createdAt,
        workflow.updatedAt,
        assignment?.providerId,
        assignment?.model,
        assignment?.effort,
      ],
      () => ({
        sourceKind: "workflow",
        workflowId: workflow.id,
        projectId: workflow.projectId || null,
        providerId: assignment?.providerId || "host",
        role: "Project manager",
        title: bounded(workflow.message, 200) || "Managed project",
        status: workflow.status || "unknown",
        phase: workflow.stage || workflow.status || "unknown",
        summary: bounded(
          workflow.delivery ||
            workflow.error ||
            (workflow.status === "awaiting_answers"
              ? `${unanswered} question(s) await your answer.`
              : undefined),
          2000,
        ),
        error: bounded(workflow.error, 2000),
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        model: assignment?.model,
        requestedEffort: assignment?.effort,
        effectiveEffort:
          assignment?.providerId === "claude" &&
          assignment?.effort === "ultracode"
            ? "xhigh"
            : assignment?.effort,
        receiptKind: "workflow_orchestration",
      }),
    );
  }
  const tasks = state.tasks || [],
    taskIds = new Set(tasks.map((task) => task.id));
  const finalMessages = new Map();
  for (const message of state.messages || [])
    if (
      message.taskId &&
      message.role === "assistant" &&
      !message.locationSensitive
    )
      finalMessages.set(message.taskId, message);
  for (const task of tasks) {
    let parentId;
    if (task.workflowId && records.has(`workflow:${task.workflowId}`))
      parentId = `workflow:${task.workflowId}`;
    else {
      const parentTaskId =
        task.parentTaskId ||
        task.planTaskId ||
        (task.repairId &&
          (state.checkRepairs || []).find(
            (repair) => repair.id === task.repairId,
          )?.sourceTaskId);
      if (parentTaskId && parentTaskId !== task.id && taskIds.has(parentTaskId))
        parentId = `task:${parentTaskId}`;
    }
    const final = finalMessages.get(task.id),
      priorSummary = records.get(`task:${task.id}`)?.summary;
    put(
      `task:${task.id}`,
      [
        task.workflowId,
        task.projectId,
        parentId,
        task.providerId,
        task.routingRole,
        task.workflowStage,
        task.kind,
        task.repairId,
        task.mode,
        task.title,
        task.status,
        task.phase,
        task.error,
        final?.content,
        task.output,
        task.createdAt,
        task.updatedAt,
        task.selectedModel,
        task.requestedEffort,
        task.effectiveEffort,
        task.effort,
      ],
      () => ({
        sourceKind: "task",
        taskId: task.id,
        workflowId: task.workflowId,
        projectId: task.projectId || null,
        parentId,
        providerId: task.providerId || "unknown",
        role: taskRole(task),
        title: bounded(task.title, 200) || "Recorded task",
        status: task.status || "unknown",
        phase: task.phase || task.status || "unknown",
        summary: bounded(task.error || final?.content || priorSummary, 2000),
        output: recentOutput(task.output),
        ...(typeof task.output === "string" && task.output.length > 16000
          ? { outputTruncated: true }
          : {}),
        error: bounded(task.error, 2000),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        model: task.selectedModel,
        requestedEffort: task.requestedEffort || task.effort,
        effectiveEffort: task.effectiveEffort || task.effort,
        receiptKind: ["terminal", "autonomy"].includes(task.providerId)
          ? "tool_task"
          : "model_task",
      }),
    );
  }
  // A cleared source must not leave a ghost agent appearing to run forever.
  for (const agent of office.agents)
    if (!sourceIds.has(agent.id)) {
      agent.status = "unavailable";
      agent.phase = "source_unavailable";
      agent.title = "Original task unavailable";
      agent.summary = "The original task receipt is no longer available.";
      delete agent.output;
      delete agent.outputTruncated;
      delete agent.error;
      cache.delete(agent.id);
    }
  for (const agent of office.agents) {
    const seen = new Set([agent.id]);
    let parent = agent.parentId;
    while (parent) {
      if (seen.has(parent)) {
        delete agent.parentId;
        break;
      }
      seen.add(parent);
      parent = records.get(parent)?.parentId;
    }
  }
  return office;
}
export function publicAgentOffice(state, principal) {
  assertPersonalAccess(state, principal);
  return structuredClone(state.agentOffice || defaultAgentOffice());
}
