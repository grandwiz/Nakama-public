import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const MAX_BYTES = 64 * 1024;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const labels = {
  five_hour: "Claude · 5-hour allowance",
  seven_day: "Claude · Weekly allowance",
  seven_day_sonnet: "Claude · Sonnet weekly allowance",
  seven_day_opus: "Claude · Opus weekly allowance",
  seven_day_cowork: "Claude · Cowork weekly allowance",
};

// The official Claude Code /usage local command reads this account endpoint.
// It is a CLI-internal interface, not a model API; unknown fields are ignored.
// Never send /usage as a print-mode prompt: unsupported slash commands could
// become inference. No shell, hooks, MCP, token refresh or billing writes occur.
export function normalizeClaudeUsage(payload) {
  if (!object(payload)) return [];
  const windows = Object.entries(labels).flatMap(([key, label]) => {
    const value = payload[key];
    if (
      !object(value) ||
      typeof value.utilization !== "number" ||
      !Number.isFinite(value.utilization)
    )
      return [];
    const usedPercent = Math.min(100, Math.max(0, value.utilization));
    const reset =
      typeof value.resets_at === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(value.resets_at)
        ? Date.parse(value.resets_at)
        : NaN;
    return [
      {
        label,
        usedPercent,
        remainingPercent: 100 - usedPercent,
        resetsAt: Number.isFinite(reset) ? new Date(reset).toISOString() : null,
      },
    ];
  });
  // Current official /usage also identifies scoped windows by typed limits.
  // Only the observed Fable weekly shape is recognized; opaque top-level keys,
  // arbitrary model names, monetary balances and surface quotas stay private.
  const fable = Array.isArray(payload.limits) && payload.limits.slice(0, 32).find(
    (value) => object(value) && value.kind === "weekly_scoped" &&
      value.group === "weekly" && object(value.scope) &&
      object(value.scope.model) && value.scope.model.display_name === "Fable" &&
      value.scope.surface === null && typeof value.percent === "number" &&
      Number.isFinite(value.percent),
  );
  if (fable) {
    const usedPercent = Math.min(100, Math.max(0, fable.percent));
    const reset = typeof fable.resets_at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(fable.resets_at)
      ? Date.parse(fable.resets_at) : NaN;
    windows.push({ label: "Claude · Fable weekly allowance", usedPercent,
      remainingPercent: 100 - usedPercent,
      resetsAt: Number.isFinite(reset) ? new Date(reset).toISOString() : null });
  }
  return windows;
}

async function readCredentials() {
  // Claude uses its OS keychain on macOS; never invoke an arbitrary keychain
  // command or fall back to an API key. Windows/Linux use this local file.
  if (process.platform === "darwin") return null;
  const dir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const file = await fs.open(path.join(dir, ".credentials.json"), "r");
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) return null;
    return (
      JSON.parse(buffer.toString("utf8", 0, bytesRead))?.claudeAiOauth || null
    );
  } finally {
    await file.close();
  }
}
async function boundedJson(response) {
  if (Number(response.headers?.get("content-length")) > MAX_BYTES)
    throw Error("Usage body too large");
  if (!response.body?.getReader) throw Error("No bounded usage body");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error("Usage body too large");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function readClaudeUsage(
  provider,
  {
    now = Date.now,
    timeoutMs = 10000,
    credentials = readCredentials,
    request = globalThis.fetch,
  } = {},
) {
  const result = (status, detail, windows = [], checked = true) => ({
    id: "claude",
    name: "Claude",
    status,
    detail,
    windows,
    checkedAt: checked ? new Date(now()).toISOString() : null,
    source: "https://code.claude.com/docs/en/commands#usage",
  });
  if (!provider || provider.connectionType !== "subscription")
    return result(
      "unavailable",
      "Connect Claude Code with your Claude subscription to see its allowances.",
      [],
      false,
    );
  const controller = new AbortController();
  let expired = false;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => {
        expired = true;
        controller.abort();
        reject(Error("Usage timeout"));
      },
      Math.min(12000, Math.max(1, timeoutMs)),
    );
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const auth = await credentials();
        if (expired) return undefined;
        if (
          !object(auth) ||
          !["pro", "max", "team", "enterprise"].includes(
            auth.subscriptionType,
          ) ||
          !Array.isArray(auth.scopes) ||
          !auth.scopes.includes("user:profile") ||
          typeof auth.accessToken !== "string" ||
          !/^[\x21-\x7e]{20,8192}$/.test(auth.accessToken) ||
          typeof auth.expiresAt !== "number" ||
          !Number.isFinite(auth.expiresAt) ||
          auth.expiresAt <= now()
        )
          return result(
            "unavailable",
            "Claude Code needs a current subscription sign-in. On your PC, open Claude /usage from Nakama’s Usage screen to refresh its session or complete sign-in, then refresh usage here. Nakama does not change your credentials.",
          );
        const response = await request(ENDPOINT, {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${auth.accessToken}`,
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "Nakama-Usage/1.0 (Claude-Code-account-metadata)",
          },
        });
        if (expired) {
          await response.body?.cancel?.();
          return undefined;
        }
        if (!response.ok) {
          await response.body?.cancel?.();
          return result(
            response.status === 401 || response.status === 403
              ? "unavailable"
              : "error",
            response.status === 401 || response.status === 403
              ? "Claude did not accept the current subscription sign-in. Open Claude Code and sign in again, then refresh usage."
              : "Claude allowance metadata is temporarily unavailable. Try refreshing later. No model request was made.",
          );
        }
        const windows = normalizeClaudeUsage(await boundedJson(response));
        return windows.length
          ? result(
              "available",
              "Shared subscription allowances from the same read-only account endpoint used by Claude Code /usage. This internal interface may change. No model request was made.",
              windows,
            )
          : result(
              "unavailable",
              "Claude returned no recognized allowance percentages. Unknown usage is not zero usage; check /usage in Claude Code.",
            );
      })(),
    ]);
  } catch {
    return result(
      "error",
      "Could not read Claude allowances. Check Claude Code sign-in and your connection, then refresh. No model request was made.",
    );
  } finally {
    expired = true;
    clearTimeout(timer);
    controller.abort();
  }
}
