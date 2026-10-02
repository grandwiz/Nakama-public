import type { AppState, Project } from "./types";

export const previewMode = !window.nakama;
const key = "nakama-design-preview-v1";
const emptyState: AppState = {
  config: {
    workspaceRoot: "",
    hostName: "Nakama Control Center",
    allowLan: false,
    port: 43110,
    voice: "en-GB-female",
    confirmOrdinaryActions: false,
  },
  projects: [],
  devices: [],
  tasks: [],
  approvals: [],
  messages: [],
  providers: [
    {
      id: "codex",
      name: "ChatGPT / Codex",
      status: "not_configured",
      connectionType: "subscription",
      models: [],
      selectedModel: "",
      effort: "high",
      detail: "Connect the official Codex CLI on your Windows PC.",
    },
    {
      id: "claude",
      name: "Claude",
      status: "not_configured",
      connectionType: "subscription",
      models: [],
      selectedModel: "",
      effort: "high",
      detail: "Connect the official Claude Code CLI on your Windows PC.",
    },
  ],
  connections: [
    "Vercel",
    "Render",
    "Resend",
    "GitHub",
    "Neon",
    "Gmail",
    "Calendar",
  ].map((name) => ({
    id: name.toLowerCase(),
    name,
    status: "not_configured",
    detail: "Set up this connection in the desktop app.",
  })),
};
function readPreview(): AppState {
  try {
    const stored = localStorage.getItem(key);
    const state = stored
      ? { ...structuredClone(emptyState), ...JSON.parse(stored) }
      : structuredClone(emptyState);
    state.providers = state.providers.filter((item: { id: string }) =>
      ["codex", "claude"].includes(item.id),
    );
    state.connections = state.connections.filter((item: { id: string }) =>
      [
        "vercel",
        "render",
        "resend",
        "github",
        "neon",
        "gmail",
        "calendar",
        "chrome",
        "kling",
      ].includes(item.id),
    );
    return state;
  } catch {
    return structuredClone(emptyState);
  }
}
function savePreview(state: AppState) {
  localStorage.setItem(key, JSON.stringify(state));
  window.dispatchEvent(new Event("nakama-preview-change"));
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (window.nakama) return window.nakama.api<T>(method, path, body);
  const state = readPreview();
  const value = body as Record<string, any> | undefined;
  if (method === "GET" && path === "/api/state") return state as T;
  if (method === "PATCH" && path === "/api/settings") {
    state.config = { ...state.config, ...value };
    savePreview(state);
    return state.config as T;
  }
  if (method === "POST" && path === "/api/projects") {
    if (!state.config.workspaceRoot)
      throw new Error(
        "Choose a workspace in Settings first. Preview folders are simulated.",
      );
    const project: Project = {
      id: crypto.randomUUID(),
      name: value!.name,
      description: value!.description || "",
      path: `${state.config.workspaceRoot}/${value!.name}`,
      updatedAt: new Date().toISOString(),
      status: "ready",
    };
    state.projects.unshift(project);
    savePreview(state);
    return project as T;
  }
  if (method === "PATCH" && /^\/api\/projects\/[^/]+$/.test(path)) {
    const project = state.projects.find(
      (item) => item.id === path.split("/")[3],
    );
    if (!project) throw new Error("Project not found");
    Object.assign(project, value);
    savePreview(state);
    return project as T;
  }
  if (method === "GET" && path.includes("/files?"))
    return { path: "", entries: [] } as T;
  if (method === "POST" && /^\/api\/providers\/[^/]+\/settings$/.test(path)) {
    const provider = state.providers.find(
      (item) => item.id === path.split("/")[3],
    );
    if (!provider) throw new Error("Provider not found");
    Object.assign(provider, value);
    savePreview(state);
    return provider as T;
  }
  throw new Error(
    "This action needs the Windows app. Browser preview cannot run commands, connect accounts, or control devices.",
  );
}
export async function chooseFolder() {
  return window.nakama
    ? window.nakama.chooseFolder()
    : "C:\\Nakama Preview\\Projects";
}
export async function openExternal(url: string) {
  if (window.nakama) await window.nakama.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
export async function openProjectFolder(projectId: string) {
  if (!window.nakama)
    throw new Error(
      "Open the Windows app to view a real project folder. Preview projects exist only in this browser.",
    );
  await window.nakama.openProjectFolder(projectId);
}
export async function copyText(text: string) {
  if (window.nakama) await window.nakama.copyText(text);
  else await navigator.clipboard.writeText(text);
}
export function subscribe(callback: () => void) {
  if (window.nakama) return window.nakama.onEvent(callback);
  window.addEventListener("nakama-preview-change", callback);
  return () => window.removeEventListener("nakama-preview-change", callback);
}
