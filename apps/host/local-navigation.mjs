import { ApiError } from "./security.mjs";

export const NAVIGATION_TARGETS = new Set([
  "agent-office",
  "home",
  "projects",
  "boards",
  "routines",
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
const aliases = new Map([
  ["agent office", "agent-office"],
  ["agents office", "agent-office"],
  ["office", "agent-office"],
  ["home", "home"],
  ["dashboard", "home"],
  ["overview", "home"],
  ["projects", "projects"],
  ["project list", "projects"],
  ["task board", "boards"],
  ["clipboard", "boards"],
  ["boards", "boards"],
  ["tasks", "boards"],
  ["routines", "routines"],
  ["routine board", "routines"],
  ["core memory", "core-memory"],
  ["skills", "skills"],
  ["nakama browser", "browser"],
  ["monitoring", "monitoring"],
  ["monitors", "monitoring"],
  ["monitoring mode", "monitoring"],
  ["dynamic upgrade", "self-maintenance"],
  ["upgrades", "self-maintenance"],
  ["self maintenance", "self-maintenance"],
  ["project setup", "project-setup"],
  ["delivery", "delivery"],
  ["project delivery", "delivery"],
  ["setup questions", "project-setup"],
  ["internal browser", "browser"],
  ["browser studio", "browser"],
  ["learned skills", "skills"],
  ["skill library", "skills"],
  ["assistant", "assistant"],
  ["chat", "assistant"],
  ["conversation", "assistant"],
  ["agents", "agents"],
  ["ai team", "agents"],
  ["usage", "usage"],
  ["account usage", "usage"],
  ["devices", "devices"],
  ["connections", "connections"],
  ["activity", "activity"],
  ["approvals", "activity"],
  ["settings", "settings"],
  ["preferences", "settings"],
]);
export function navigationRequest(input, state, projectId) {
  if (
    typeof input !== "string" ||
    /[\r\n`"<>]|\b(?:not|never|don't|don’t|instead)\b/i.test(input)
  )
    return null;
  const command =
    /^(open|go to|take me to|navigate to|show(?: me)?)\s+(?:(?:the|my)\s+)?(.+?)(?:\s+(?:page|screen|tab))?$/i.exec(
      input.trim(),
    );
  if (!command) return null;
  const destination = command[2].trim().toLowerCase().replace(/\s+/g, " ");
  // Existing spoken "show routines/core memory" asks for data; "open" navigates.
  if (
    command[1].toLowerCase().startsWith("show") &&
    ![
      "agent office",
      "agents office",
      "office",
      "skills",
      "learned skills",
      "skill library",
      "nakama browser",
      "internal browser",
      "browser studio",
      "project setup",
      "setup questions",
    ].includes(destination)
  )
    return null;
  const target = aliases.get(destination);
  if (target && NAVIGATION_TARGETS.has(target))
    return { type: "navigate", target };
  if (destination === "this project") {
    if (!(state.projects || []).some((project) => project.id === projectId))
      throw new ApiError(
        409,
        "Select a saved project first, then ask to open this project.",
      );
    return { type: "navigate", target: "projects", projectId };
  }
  const projectName = /^project\s+(.+)$/i.exec(command[2]);
  if (projectName) {
    const matches = (state.projects || []).filter(
      (project) =>
        project.name.toLowerCase() === projectName[1].trim().toLowerCase(),
    );
    if (matches.length !== 1)
      throw new ApiError(
        409,
        matches.length
          ? "Several projects have that name. Choose the intended project from Projects."
          : "No saved project has that exact name. Open Projects to choose one.",
      );
    return { type: "navigate", target: "projects", projectId: matches[0].id };
  }
  return null;
}
