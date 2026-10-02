import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const secret = () => crypto.randomBytes(32).toString("base64url");
export const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export function requireOwner(principal) {
  if (principal?.kind !== "owner")
    throw new ApiError(
      403,
      "This action requires approval in Windows Control Center.",
    );
}
export function text(value, label, max = 1000) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new ApiError(400, `${label} must contain 1-${max} characters.`);
  return value.trim();
}
export function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export async function workspace(root) {
  if (!root || !path.isAbsolute(root))
    throw new ApiError(409, "Choose a project folder in Settings first.");
  const real = await fs.realpath(root).catch(() => {
    throw new ApiError(400, "The selected folder does not exist.");
  });
  if (!(await fs.stat(real)).isDirectory())
    throw new ApiError(400, "Select a folder.");
  if (path.parse(real).root === real)
    throw new ApiError(
      400,
      "Select a dedicated project folder rather than an entire drive.",
    );
  return real;
}
export async function projectRoot(root, project) {
  const realRoot = await workspace(root);
  const realProject = await fs.realpath(project.path).catch(() => {
    throw new ApiError(404, "The project folder is missing.");
  });
  if (realRoot === realProject || !within(realRoot, realProject))
    throw new ApiError(403, "Project is outside the selected workspace.");
  if ((await fs.lstat(project.path)).isSymbolicLink())
    throw new ApiError(403, "Linked project folders are not supported.");
  return realProject;
}
export async function safeFile(
  root,
  relative = "",
  { allowRoot = false, allowMissing = false } = {},
) {
  if (
    typeof relative !== "string" ||
    relative.includes("\0") ||
    path.isAbsolute(relative) ||
    /^[A-Za-z]:/.test(relative)
  )
    throw new ApiError(400, "Use a relative project path.");
  const pieces = relative.replaceAll("\\", "/").split("/").filter(Boolean);
  const forbidden = new Set([
    "..",
    ".git",
    ".nakama",
    "node_modules",
    ".nakama-trash",
  ]);
  if (
    pieces.some(
      (p) =>
        forbidden.has(p.toLowerCase()) ||
        /[:<>|?*]/.test(p) ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p),
    )
  )
    throw new ApiError(403, "That path is protected or invalid.");
  const target = path.resolve(root, ...pieces);
  if (!within(root, target) || (!allowRoot && target === root))
    throw new ApiError(403, "Path must stay inside the project.");
  let cursor = root;
  for (const piece of pieces) {
    cursor = path.join(cursor, piece);
    const stat = await fs.lstat(cursor).catch((e) => {
      if (e.code === "ENOENT" && allowMissing) return null;
      throw new ApiError(404, "File or folder not found.");
    });
    if (!stat) continue;
    if (stat.isSymbolicLink() || !within(root, await fs.realpath(cursor)))
      throw new ApiError(403, "Symbolic links and junctions are not followed.");
    if (stat.isFile() && stat.nlink > 1)
      throw new ApiError(403, "Hard-linked files are not supported.");
  }
  return target;
}
export function redact(value) {
  return String(value)
    .replace(
      /\b(sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,}|AIza[\w-]{20,}|ya29\.[\w.-]{12,}|re_[\w]{20,}|rnd_[\w]{20,})\b/g,
      "[redacted]",
    )
    .replace(/(Bearer\s+)[\w.\-/+=]{8,}/gi, "$1[redacted]")
    .replace(
      /((?:[A-Z][A-Z0-9_]*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD)|token|password|api[_-]?key)\s*[=:]\s*["']?)[^\s"',;}]+/gi,
      "$1[redacted]",
    );
}
export function boundedJson(value, maxBytes = 256 * 1024) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch {
    throw new ApiError(400, "Provide JSON data without circular references.");
  }
  if (raw === undefined || Buffer.byteLength(raw) > maxBytes)
    throw new ApiError(400, "Result data is too large.");
  const clean = (item, depth = 0) => {
    if (depth > 30)
      throw new ApiError(400, "Result data is nested too deeply.");
    if (typeof item === "string") return redact(item);
    if (Array.isArray(item)) return item.map((v) => clean(v, depth + 1));
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([k, v]) => [k, clean(v, depth + 1)]),
      );
    return item;
  };
  return clean(JSON.parse(raw));
}
export class RateGate {
  #hits = new Map();
  allow(key, limit = 12, windowMs = 60000) {
    const time = Date.now();
    if (this.#hits.size > 1000)
      for (const [k, v] of this.#hits) if (v.until < time) this.#hits.delete(k);
    const item = this.#hits.get(key);
    if (!item || item.until < time) {
      this.#hits.set(key, { count: 1, until: time + windowMs });
      return true;
    }
    item.count += 1;
    return item.count <= limit;
  }
}
