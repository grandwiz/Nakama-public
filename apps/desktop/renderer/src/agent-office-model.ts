import type { AgentOfficeAgent, Page } from "./types";

const finished = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
  "stopped",
  "denied",
  "error",
  "unavailable",
]);
export function officeIsCurrent(agent: AgentOfficeAgent) {
  return !finished.has(agent.status);
}

export interface OfficeNode {
  agent: AgentOfficeAgent;
  children: OfficeNode[];
}

/** Build from host receipts only; tolerate retained children without their parent. */
export function officeForest(
  agents: AgentOfficeAgent[],
  history: boolean,
): OfficeNode[] {
  const unique = new Map(agents.map((agent) => [agent.id, agent]));
  const visible = new Set<string>();
  for (const agent of unique.values()) {
    if (!history && !officeIsCurrent(agent)) continue;
    let cursor: AgentOfficeAgent | undefined = agent;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      if (history || officeIsCurrent(cursor)) visible.add(cursor.id);
      cursor = cursor.parentId ? unique.get(cursor.parentId) : undefined;
    }
  }
  const nodes = new Map(
    [...visible].map((id) => [
      id,
      { agent: unique.get(id)!, children: [] } as OfficeNode,
    ]),
  );
  const roots: OfficeNode[] = [];
  for (const node of nodes.values()) {
    let parent = node.agent.parentId
      ? nodes.get(node.agent.parentId)
      : undefined;
    const visited = new Set([node.agent.id]);
    let cursor = parent;
    while (cursor) {
      if (visited.has(cursor.agent.id)) {
        parent = undefined;
        break;
      }
      visited.add(cursor.agent.id);
      cursor = cursor.agent.parentId
        ? nodes.get(cursor.agent.parentId)
        : undefined;
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const destinations = new Set<Page>([
  "agent-office",
  "home",
  "projects",
  "boards",
  "routines",
  "clock",
  "core-memory",
  "skills",
  "browser",
  "monitoring",
  "self-maintenance",
  "project-setup",
  "delivery",
  "assistant",
  "agents",
  "usage",
  "devices",
  "connections",
  "activity",
  "settings",
]);
export function navigationOutcome(
  value: unknown,
  projects: readonly { id: string }[],
): { target: Page; projectId?: string; browserSessionId?: string } | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.type !== "navigate" ||
    typeof data.target !== "string" ||
    !destinations.has(data.target as Page)
  )
    return null;
  if (
    data.projectId !== undefined &&
    (typeof data.projectId !== "string" ||
      !["projects", "assistant"].includes(data.target) ||
      !projects.some((project) => project.id === data.projectId))
  )
    return null;
  if (
    data.browserSessionId !== undefined &&
    (data.target !== "browser" ||
      typeof data.browserSessionId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(data.browserSessionId))
  )
    return null;
  return {
    target: data.target as Page,
    ...(typeof data.projectId === "string"
      ? { projectId: data.projectId }
      : {}),
    ...(typeof data.browserSessionId === "string"
      ? { browserSessionId: data.browserSessionId }
      : {}),
  };
}
