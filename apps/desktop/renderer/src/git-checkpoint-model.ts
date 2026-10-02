export interface CheckpointEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
}
export interface CheckpointRequest {
  paths: string[];
  message: string;
}
export interface CheckpointPreparation {
  message: string;
  id: string;
  projectId: string;
  head: string | null;
  branch: string | null;
  expiresAt: string;
  files: {
    path: string;
    kind: "added" | "modified" | "deleted";
    before: string;
    after: string;
    bytes: number;
  }[];
  disclosure: string;
}
export interface CheckpointReceipt {
  id: string;
  projectId: string;
  ref: string;
  commit: string;
  head: string | null;
  message: string;
  files: string[];
  createdAt: string;
}

const conflictStates = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Mirrors the host's path affordance; the host also inspects file contents.
const privatePart =
  /^\.env(?:\.|$)|^\.(?:git|ssh|aws|azure|kube|npmrc|pypirc|netrc|gitmodules)$|^(?:credentials|secrets?|auth)(?:\.|$)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|p12|pfx|jks|keystore)$/i;
function plainPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\\\x00-\x1f\x7f:<>|?*]/.test(value) &&
    !value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          [".git", ".nakama", "node_modules", ".nakama-trash"].includes(
            part.toLowerCase(),
          ) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
      )
  );
}
export function checkpointCandidates(entries: CheckpointEntry[]) {
  return entries.filter(
    (entry) =>
      plainPath(entry.path) &&
      !entry.path.split("/").some((part) => privatePart.test(part)) &&
      !entry.originalPath &&
      !conflictStates.has(entry.indexStatus + entry.worktreeStatus) &&
      !/[RCTU]/.test(entry.indexStatus + entry.worktreeStatus) &&
      /^[ MAD?]{2}$/.test(entry.indexStatus + entry.worktreeStatus),
  );
}
export function checkpointRequest(
  candidates: CheckpointEntry[],
  paths: string[],
  message: string,
): CheckpointRequest {
  const allowed = new Set(
    checkpointCandidates(candidates).map((item) => item.path),
  );
  if (
    !paths.length ||
    paths.length > 20 ||
    new Set(paths).size !== paths.length ||
    paths.some((item) => !allowed.has(item))
  )
    throw new Error(
      "Choose between 1 and 20 eligible files from this project.",
    );
  const title = message.trim();
  if (!title || title.length > 500 || /[\x00-\x1f\x7f]/.test(title))
    throw new Error(
      "Write a single-line checkpoint message of 1–500 characters.",
    );
  return { paths: [...paths], message: title };
}
export function validCheckpointPreparation(
  value: unknown,
  projectId: string,
  request: CheckpointRequest,
  now = Date.now(),
): value is CheckpointPreparation {
  if (!value || typeof value !== "object") return false;
  const item = value as CheckpointPreparation;
  if (
    !uuid.test(item.id) ||
    item.projectId !== projectId ||
    item.message !== request.message ||
    (item.head !== null && !oid.test(item.head)) ||
    (item.branch !== null && typeof item.branch !== "string") ||
    typeof item.disclosure !== "string" ||
    item.disclosure.length > 4000 ||
    !Number.isFinite(Date.parse(item.expiresAt)) ||
    Date.parse(item.expiresAt) <= now ||
    Date.parse(item.expiresAt) > now + 11 * 60 * 1000 ||
    !Array.isArray(item.files) ||
    item.files.length !== request.paths.length
  )
    return false;
  let total = 0;
  return item.files.every((file, index) => {
    if (
      !file ||
      file.path !== request.paths[index] ||
      !["added", "modified", "deleted"].includes(file.kind) ||
      typeof file.before !== "string" ||
      typeof file.after !== "string" ||
      file.before.length > 256 * 1024 ||
      file.after.length > 256 * 1024 ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      (file.kind === "added" && file.before !== "") ||
      (file.kind === "deleted" && file.after !== "")
    )
      return false;
    const before = new TextEncoder().encode(file.before).length;
    const after = new TextEncoder().encode(file.after).length;
    total += before + after;
    return (
      before <= 256 * 1024 &&
      after <= 256 * 1024 &&
      file.bytes === after &&
      total <= 2 * 1024 * 1024
    );
  });
}
export function validCheckpointReceipt(
  value: unknown,
  preparation: CheckpointPreparation,
): value is CheckpointReceipt {
  if (!value || typeof value !== "object") return false;
  const item = value as CheckpointReceipt;
  return (
    item.id === preparation.id &&
    item.projectId === preparation.projectId &&
    item.ref === `refs/nakama/checkpoints/${preparation.id}` &&
    oid.test(item.commit) &&
    item.head === preparation.head &&
    item.message === preparation.message &&
    Number.isFinite(Date.parse(item.createdAt)) &&
    Array.isArray(item.files) &&
    item.files.length === preparation.files.length &&
    item.files.every((file, index) => file === preparation.files[index].path)
  );
}

// A late response cannot replace an edited, refreshed or unmounted review.
export class CheckpointRequestGate {
  private revision = 0;
  private pending = false;
  begin() {
    if (this.pending) return null;
    this.pending = true;
    return ++this.revision;
  }
  finish(revision: number) {
    if (!this.pending || revision !== this.revision) return false;
    this.pending = false;
    return true;
  }
  invalidate() {
    this.revision++;
    this.pending = false;
  }
}
