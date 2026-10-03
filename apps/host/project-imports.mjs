import fs from "node:fs/promises";
import path from "node:path";
import { ApiError, uid, now, text, workspace, safeFile, projectRoot, requireOwner, within } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";

// Only PC-selected library roots are browsable. Imported folders stay in place.
export class ProjectImports {
  constructor(host) { this.host = host; }
  access(principal) { assertPersonalAccess(this.host.store.state, principal); }
  roots(principal) {
    this.access(principal);
    const state = this.host.store.state;
    const rows = [...(state.projectImportRoots || [])];
    if (state.config.workspaceRoot) rows.unshift({ id: "workspace", name: "Nakama workspace", path: state.config.workspaceRoot });
    return rows.map(({ id, name, path: folder }) => ({ id, name, ...(principal.kind === "owner" ? { path: folder } : {}) }));
  }
  async root(id, principal) {
    this.access(principal);
    const state = this.host.store.state;
    const root = id === "workspace" ? { id, path: state.config.workspaceRoot } : (state.projectImportRoots || []).find(r => r.id === id);
    if (!root?.path) throw new ApiError(404, "Select an available project library.");
    const real = await workspace(root.path);
    if (within(real, this.host.store.dir) || within(this.host.store.dir, real)) throw new ApiError(403, "Nakama private data cannot be a project library.");
    if (real !== path.resolve(root.path)) throw new ApiError(403, "The project library changed or is linked. Select it again on the PC.");
    return real;
  }
  async add(body, principal) {
    requireOwner(principal);
    const folder = await workspace(text(body.path, "Project library", 1000));
    if (within(this.host.store.dir, folder) || within(folder, this.host.store.dir)) throw new ApiError(403, "Choose a dedicated project library, not Nakama's private data or its parent.");
    const name = text(body.name || path.basename(folder), "Library name", 80);
    return this.host.store.change(s => {
      s.projectImportRoots ||= [];
      const previous = s.projectImportRoots.find(r => r.path.toLowerCase() === folder.toLowerCase());
      if (previous) return previous;
      if (s.projectImportRoots.length >= 20) throw new ApiError(400, "Keep at most twenty project libraries.");
      const row = { id: uid(), name, path: folder };
      s.projectImportRoots.push(row);
      this.host.store.audit(s, "project.library_added", principal, name);
      return row;
    });
  }
  async browse(rootId, relative, principal) {
    const root = await this.root(rootId, principal);
    const folder = await safeFile(root, relative || "", { allowRoot: true });
    const entries = [];
    for (const entry of (await fs.readdir(folder, { withFileTypes: true })).slice(0, 1000)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || ["node_modules", "Windows", "Program Files", "AppData"].includes(entry.name)) continue;
      const next = [relative, entry.name].filter(Boolean).join("/");
      try { await safeFile(root, next); } catch { continue; }
      entries.push({ name: entry.name, path: next });
    }
    this.access(principal);
    if (await this.root(rootId, principal) !== root) throw new ApiError(409, "Library changed while browsing.");
    const detected = [];
    for (const [file, label] of [["CLAUDE.md", "Claude"], ["AGENTS.md", "GPT / Codex"], [".git", "Git"]]) {
      const stat = await fs.lstat(path.join(folder, file)).catch(() => null);
      if (stat && !stat.isSymbolicLink()) detected.push(label);
    }
    this.access(principal);
    if (await this.root(rootId, principal) !== root) throw new ApiError(409, "Library changed while reading project markers.");
    this.access(principal);
    return { rootId, path: relative || "", entries: entries.sort((a,b) => a.name.localeCompare(b.name)), detected, canImport: Boolean(relative), truncated: entries.length >= 1000 };
  }
  async import(body, principal) {
    const root = await this.root(body.rootId, principal);
    const relative = text(body.path, "Project folder", 1000);
    const folder = await safeFile(root, relative);
    if (!(await fs.stat(folder)).isDirectory()) throw new ApiError(400, "Select a project folder.");
    const name = text(body.name || path.basename(folder), "Project name", 80);
    const project = { id: uid(), name, description: "Imported existing local project", path: folder, importedRoot: root, importedPath: relative, imported: true, updatedAt: now(), status: "ready", pinned: false };
    await projectRoot(this.host.store.state.config.workspaceRoot, project);
    return this.host.store.change(async s => {
      this.access(principal);
      if (await this.root(body.rootId, principal) !== root || await projectRoot(s.config.workspaceRoot, project) !== folder) throw new ApiError(409, "Project library changed before import.");
      const previous = s.projects.find(p => p.path.toLowerCase() === folder.toLowerCase());
      if (previous) { const { importedRoot, importedPath, ...visible } = previous; return { project: visible, alreadyImported: true }; }
      s.projects.unshift(project);
      this.host.store.audit(s, "project.imported", principal, name);
      const { importedRoot, importedPath, ...visible } = project;
      return { project: visible, alreadyImported: false };
    });
  }
  async route(method, route, body, principal, query) {
    this.access(principal);
    if (route === "/api/project-imports/roots" && method === "GET") return { roots: this.roots(principal) };
    if (route === "/api/project-imports/roots" && method === "POST") return this.add(body, principal);
    const match = route.match(/^\/api\/project-imports\/roots\/([^/]+)$/);
    if (match && method === "DELETE") {
      requireOwner(principal);
      return this.host.store.change(s => { s.projectImportRoots = (s.projectImportRoots || []).filter(r => r.id !== match[1]); return { removed: true }; });
    }
    if (route === "/api/project-imports/browse" && method === "GET") return this.browse(query.get("rootId"), query.get("path") || "", principal);
    if (route === "/api/project-imports" && method === "POST") return this.import(body, principal);
    throw new ApiError(404, "Unknown project import operation.");
  }
}
