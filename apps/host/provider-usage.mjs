import { readClaudeUsage } from "./claude-usage.mjs";
import { spawn } from "node:child_process";
import os from "node:os";
import { CodexRpc } from "./codex-rpc.mjs";
import { locateProvider, stopProcess } from "./providers.mjs";

const sources = {
  codex: "https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt",
  claude:
    "https://support.claude.com/en/articles/14553413-claude-code-cheatsheet",
};
const record = (id, status, detail, checkedAt = null, windows = []) => ({
  id,
  name: { codex: "ChatGPT / Codex", claude: "Claude" }[id],
  status,
  windows,
  checkedAt,
  detail,
  source: sources[id],
});
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function durationLabel(minutes, fallback) {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 525600)
    return fallback;
  if (minutes === 10080) return "Weekly allowance";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day allowance`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour allowance`;
  return `${minutes}-minute allowance`;
}

function resetDate(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
    return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

// Only quota percentages and labels leave the host. Never forward account,
// credits, reset-credit identifiers, auth status, or raw provider errors.
export function normalizeCodexUsage(payload) {
  if (!object(payload)) return [];
  const multiple = object(payload.rateLimitsByLimitId);
  const buckets = multiple
    ? Object.entries(payload.rateLimitsByLimitId).slice(0, 20)
    : object(payload.rateLimits)
      ? [["codex", payload.rateLimits]]
      : [];
  return buckets.flatMap(([key, bucket], index) => {
    if (!object(bucket)) return [];
    const rawLabel = bucket.limitName || bucket.limitId || key;
    const bucketLabel =
      rawLabel === "codex"
        ? "Codex"
        : typeof rawLabel === "string" &&
            /^[a-zA-Z0-9 ._:/()-]{1,80}$/.test(rawLabel)
          ? rawLabel
          : `Allowance ${index + 1}`;
    return ["primary", "secondary"].flatMap((type) => {
      const window = bucket[type];
      if (
        !object(window) ||
        typeof window.usedPercent !== "number" ||
        !Number.isFinite(window.usedPercent)
      )
        return [];
      const usedPercent = Math.min(100, Math.max(0, window.usedPercent));
      const duration = durationLabel(
        window.windowDurationMins,
        type === "primary" ? "Primary allowance" : "Secondary allowance",
      );
      return [
        {
          label: `${bucketLabel} · ${duration}`,
          usedPercent,
          remainingPercent: 100 - usedPercent,
          resetsAt: resetDate(window.resetsAt),
        },
      ];
    });
  });
}

function createUsageClient(file, timeoutMs) {
  return new CodexRpc(file, {
    timeoutMs,
    spawnImpl: (executable, args, options) => {
      const nodeFile = /\.(mjs|js)$/i.test(executable);
      const env = { ...options.env };
      if (nodeFile && process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
      const child = spawn(
        nodeFile ? process.execPath : executable,
        [
          ...(nodeFile ? [executable] : []),
          "-c",
          'model_provider="openai"',
          "-c",
          'forced_login_method="chatgpt"',
          ...args,
        ],
        {
          ...options,
          env,
          cwd: os.homedir(),
          detached: process.platform !== "win32",
        },
      );
      const nativeKill = child.kill.bind(child);
      child.kill = () => {
        stopProcess({ pid: child.pid, kill: nativeKill });
        return true;
      };
      return child;
    },
  });
}

export async function readCodexUsage(
  provider,
  {
    locate = locateProvider,
    createClient = createUsageClient,
    now = Date.now,
    timeoutMs = 12000,
  } = {},
) {
  if (!provider || provider.connectionType !== "subscription")
    return record(
      "codex",
      "unavailable",
      "Connect Codex with your ChatGPT subscription to see its allowances.",
    );
  let client;
  let timer;
  let expired = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("Usage check timed out."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const file = await locate("codex", provider.executablePath);
        if (expired) return undefined;
        if (!file)
          return record(
            "codex",
            "unavailable",
            "Install the official Codex CLI and sign in with ChatGPT, then refresh usage.",
          );
        client = createClient(file, timeoutMs);
        await client.initialize();
        const account = await client.request("account/read", {
          refreshToken: false,
        });
        if (account?.account?.type !== "chatgpt")
          return record(
            "codex",
            "unavailable",
            "A ChatGPT subscription sign-in could not be verified. Check the Codex connection, then refresh usage.",
            new Date(now()).toISOString(),
          );
        const windows = normalizeCodexUsage(
          await client.request("account/rateLimits/read"),
        );
        const checkedAt = new Date(now()).toISOString();
        return windows.length
          ? record(
              "codex",
              "available",
              "Shared account allowances reported by Codex. These do not represent every limit in the ChatGPT app.",
              checkedAt,
              windows,
            )
          : record(
              "codex",
              "unavailable",
              "Codex did not return any allowance percentages. Unknown usage is not zero usage; try refreshing later.",
              checkedAt,
            );
      })(),
    ]);
  } catch {
    return record(
      "codex",
      "error",
      "Could not refresh Codex allowances. Check its sign-in and your internet connection, then try again. No model request was made.",
      new Date(now()).toISOString(),
    );
  } finally {
    expired = true;
    clearTimeout(timer);
    client?.close();
  }
}

// No background polling: callers request a snapshot explicitly. All callers
// share one bounded refresh; cached snapshots retain their original timestamp.
export function createProviderUsageReader({
  now = Date.now,
  cacheMs = 30000,
  readCodex = readCodexUsage,
  readClaude = readClaudeUsage,
} = {}) {
  let cached;
  let inflight;
  return {
    async read(providers = []) {
      const provider = providers.find((item) => item.id === "codex");
      const claudeProvider = providers.find((item) => item.id === "claude");
      const key = JSON.stringify(
        [provider, claudeProvider].map((item) => [
          item?.executablePath,
          item?.connectionType,
          item?.status,
        ]),
      );
      const time = now();
      if (
        cached?.key === key &&
        time >= cached.at &&
        time - cached.at < cacheMs
      )
        return structuredClone(cached.value);
      if (inflight) {
        await inflight;
        return this.read(providers);
      }
      inflight = (async () => {
        const results = await Promise.allSettled([
          readCodex(provider, { now }),
          readClaude(claudeProvider, { now }),
        ]);
        const allowances = results.map((result, index) =>
          result.status === "fulfilled"
            ? result.value
            : record(
                index === 0 ? "codex" : "claude",
                "error",
                "Could not refresh provider allowances. Try again later.",
                new Date(now()).toISOString(),
              ),
        );
        const value = {
          providers: allowances,
          checkedAt: new Date(now()).toISOString(),
        };
        cached = { key, at: now(), value };
        return value;
      })();
      try {
        return structuredClone(await inflight);
      } finally {
        inflight = null;
      }
    },
  };
}
