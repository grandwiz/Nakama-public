import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { ApiError, redact } from "./security.mjs";
import { locateProvider, subscriptionEnv } from "./providers.mjs";

// Read-only metadata and official authentication requests, over local stdio only.
export class CodexRpc {
  constructor(file, { spawnImpl = spawn, timeoutMs = 20000 } = {}) {
    this.sequence = 0;
    this.pending = new Map();
    this.buffer = "";
    this.notifications = [];
    this.closed = false;
    this.timeoutMs = timeoutMs;
    this.decoder = new StringDecoder("utf8");
    this.child = spawnImpl(file, ["app-server", "--listen", "stdio://"], {
      shell: false,
      windowsHide: true,
      env: subscriptionEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", () => {});
    this.child.stdout.on("data", (data) =>
      this.receive(this.decoder.write(data)),
    );
    this.child.on("error", () =>
      this.fail(
        new ApiError(
          409,
          "Codex app-server could not start. Check the configured executable.",
        ),
      ),
    );
    this.child.stdin.on("error", () =>
      this.fail(new ApiError(409, "Codex app-server input closed.")),
    );
    this.child.stdout.on("error", () =>
      this.fail(new ApiError(409, "Codex app-server output closed.")),
    );
    this.child.on("close", () =>
      this.fail(new ApiError(409, "Codex app-server closed.")),
    );
  }
  receive(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {
      this.close();
      return;
    }
    let end;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!message || typeof message !== "object" || Array.isArray(message))
        continue;
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        message.error
          ? pending.reject(
              new ApiError(
                409,
                redact(
                  String(message.error.message || "Codex request failed."),
                ).slice(0, 2000),
              ),
            )
          : pending.resolve(message.result);
      } else if (typeof message.method === "string" && line.length <= 65536) {
        this.notifications.push(message);
        if (this.notifications.length > 100) this.notifications.shift();
      }
    }
  }
  request(method, params = {}) {
    if (
      this.closed ||
      this.child.stdin.destroyed ||
      this.child.stdin.writableEnded
    )
      return Promise.reject(
        new ApiError(409, "Codex metadata session is closed."),
      );
    if (this.pending.size >= 100)
      return Promise.reject(
        new ApiError(429, "Too many pending Codex metadata requests."),
      );
    let payload;
    const id = ++this.sequence;
    try {
      payload = JSON.stringify({ id, method, params }) + "\n";
    } catch {
      return Promise.reject(
        new ApiError(400, "Codex request is not serializable."),
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ApiError(504, "Codex metadata request timed out."));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(payload, (error) => {
          if (error)
            this.fail(new ApiError(409, "Codex app-server input closed."));
        });
      } catch {
        this.fail(new ApiError(409, "Codex app-server input closed."));
      }
    });
  }
  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "nakama",
        title: "Nakama Control Center",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    if (this.closed)
      throw new ApiError(409, "Codex metadata session is closed.");
    try {
      this.child.stdin.write(
        JSON.stringify({ method: "initialized", params: {} }) + "\n",
      );
    } catch {
      this.fail(
        new ApiError(409, "Codex initialization could not be completed."),
      );
      throw new ApiError(409, "Codex metadata session is closed.");
    }
    return this;
  }
  fail(error) {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  close() {
    this.fail(new ApiError(409, "Codex metadata session ended."));
    this.buffer = "";
    try {
      this.child.stdin.end();
    } catch {}
    try {
      this.child.kill();
    } catch {}
  }
}
export async function readCodexModels(client) {
  const models = [],
    seen = new Set(),
    cursors = new Set();
  let cursor;
  for (let count = 0; count < 10; count++) {
    const page = await client.request("model/list", {
      limit: 100,
      includeHidden: false,
      ...(cursor ? { cursor } : {}),
    });
    if (
      !page ||
      !Array.isArray(page.data) ||
      page.data.length > 100 ||
      (page.nextCursor != null &&
        (typeof page.nextCursor !== "string" || page.nextCursor.length > 2000))
    )
      throw new ApiError(409, "Codex returned an invalid model list.");
    for (const model of page.data) {
      const id = model?.model || model?.id;
      if (typeof id !== "string" || !id || id.length > 200)
        throw new ApiError(409, "Codex returned an invalid model identifier.");
      if (!seen.has(id)) {
        seen.add(id);
        models.push({ ...model, id });
      }
    }
    cursor = page.nextCursor;
    if (!cursor || models.length >= 300) break;
    if (cursors.has(cursor))
      throw new ApiError(
        409,
        "Codex repeated a model-list cursor. Refresh the provider after updating its CLI.",
      );
    cursors.add(cursor);
  }
  const selected = models.slice(0, 300);
  return {
    models: selected.map((m) => m.id),
    modelDetails: selected.map((m) => ({
      id: m.id,
      name:
        typeof m.displayName === "string" ? m.displayName.slice(0, 300) : m.id,
      efforts: Array.isArray(m.supportedReasoningEfforts)
        ? m.supportedReasoningEfforts
            .map((e) => e?.reasoningEffort)
            .filter((e) => typeof e === "string" && e.length < 100)
            .slice(0, 10)
        : [],
      defaultEffort:
        typeof m.defaultReasoningEffort === "string"
          ? m.defaultReasoningEffort.slice(0, 100)
          : undefined,
      isDefault: m.isDefault === true,
    })),
    truncated: !!cursor || models.length > 300,
  };
}
export async function codexMetadata(configured) {
  const file = await locateProvider("codex", configured);
  if (!file) throw new ApiError(409, "Install Codex and sign in first.");
  const client = new CodexRpc(file);
  try {
    await client.initialize();
    return await readCodexModels(client);
  } finally {
    client.close();
  }
}
