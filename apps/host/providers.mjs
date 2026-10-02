import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ApiError, redact } from "./security.mjs";

const npmPackages = {
  codex: "@openai/codex",
  claude: "@anthropic-ai/claude-code",
};

// npm's Windows .cmd/.ps1 files require a shell. Resolve the official package's
// declared entry point instead: package layouts change between CLI releases.
async function npmEntryPoint(prefix, id) {
  const packageName = npmPackages[id];
  if (!packageName) return null;
  const root = path.join(prefix, "node_modules", ...packageName.split("/"));
  try {
    const manifestFile = path.join(root, "package.json");
    const stat = await fs.stat(manifestFile);
    if (!stat.isFile() || stat.size > 65536) return null;
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    if (manifest.name !== packageName) return null;
    const entry =
      typeof manifest.bin === "string"
        ? manifest.bin
        : manifest.bin && Object.hasOwn(manifest.bin, id)
          ? manifest.bin[id]
          : null;
    if (
      typeof entry !== "string" ||
      !entry ||
      path.isAbsolute(entry) ||
      /[\0\r\n]/.test(entry) ||
      !/\.(exe|js|mjs)$/i.test(entry)
    )
      return null;
    const file = path.resolve(root, entry);
    const within = (base, target) => {
      const relative = path.relative(base, target);
      return (
        relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      );
    };
    if (!within(root, file) || !(await fs.stat(file)).isFile()) return null;
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(root),
      fs.realpath(file),
    ]);
    return within(realRoot, realFile) ? realFile : null;
  } catch {
    return null;
  }
}

export async function locateProvider(
  id,
  configured,
  { env = process.env, home = os.homedir(), platform = process.platform } = {},
) {
  if (!Object.hasOwn(npmPackages, id))
    throw new ApiError(400, "Unknown provider.");
  if (configured) {
    const stat = await fs.stat(configured).catch(() => null);
    if (
      !stat?.isFile() ||
      !path.isAbsolute(configured) ||
      !/\.(exe|js|mjs)$/i.test(configured)
    )
      throw new ApiError(
        400,
        "Select an installed .exe or Node .js CLI entry point.",
      );
    return configured;
  }
  const exeName = platform === "win32" ? `${id}.exe` : id;
  const searchDirs = (env.PATH || env.Path || "")
    .split(platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry && path.isAbsolute(entry));
  const candidates = searchDirs.map((dir) => path.join(dir, exeName));
  if (id === "claude")
    candidates.push(path.join(home, ".local", "bin", exeName));
  if (id === "codex" && platform === "win32") {
    const dir = path.join(
      env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "OpenAI",
      "Codex",
      "bin",
    );
    for (const name of await fs.readdir(dir).catch(() => []))
      candidates.push(path.join(dir, name, "codex.exe"));
  }
  for (const file of candidates)
    if ((await fs.stat(file).catch(() => null))?.isFile()) return file;
  const npmPrefixes = [...searchDirs];
  if (platform === "win32") {
    npmPrefixes.push(
      path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "npm"),
    );
    if (env.ProgramFiles)
      npmPrefixes.push(path.join(env.ProgramFiles, "nodejs"));
    if (env.LOCALAPPDATA)
      npmPrefixes.push(path.join(env.LOCALAPPDATA, "Programs", "nodejs"));
  }
  for (const prefix of new Set(npmPrefixes.filter(path.isAbsolute))) {
    const entry = await npmEntryPoint(prefix, id);
    if (entry) return entry;
  }
  return null;
}
export function subscriptionEnv(source = process.env) {
  const env = { ...source };
  // An inherited API token, profile, host credential, federation setting or
  // provider route must never outrank the saved subscription login. Preserve
  // CODEX_HOME / CLAUDE_CONFIG_DIR so the same saved account is checked and used.
  const unsafe =
    /^(ANTHROPIC_|OPENAI_|_?CLAUDE_CODE_|CCR_|GEMINI_|GOOGLE_|AWS_|AZURE_|BEDROCK_|VERTEX_)/i;
  for (const name of Object.keys(env))
    if (
      unsafe.test(name) ||
      (/^CODEX_/i.test(name) && name.toUpperCase() !== "CODEX_HOME") ||
      /^(CLAUDECODE|CLAUDE_API_KEY|CLOUD_SHELL|NODE_OPTIONS|NODE_PATH)$/i.test(
        name,
      )
    )
      delete env[name];
  // Do not accidentally pass Electron's Node-hosting flag to a standalone native CLI.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
function launch(file, args, options) {
  const nodeFile = /\.(mjs|js)$/i.test(file);
  const env = { ...options.env };
  if (nodeFile && process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  return spawn(
    nodeFile ? process.execPath : file,
    nodeFile ? [file, ...args] : args,
    {
      ...options,
      env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
export function stopProcess(child) {
  if (!child?.pid || !Number.isInteger(child.pid) || child.pid <= 0) return;
  if (process.platform === "win32") {
    const executable = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    const killer = spawn(executable, ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => child.kill());
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
  }
}
const claudeAuthOptions = [
  "--safe-mode",
  "--setting-sources",
  "",
  "--settings",
  '{"forceLoginMethod":"claudeai"}',
];
const authDetail =
  "Saved subscription sign-in detected. Each task rechecks the authentication method; an expired session can still require sign-in.";

// Never return raw status output: it may contain account emails or API-key hints.
// Exact known auth modes fail closed when an official client changes its schema.
export function classifySubscriptionAuth(
  id,
  { code, stdout = "", stderr = "" } = {},
) {
  if (id === "codex") {
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    if (code === 0 && output === "Logged in using ChatGPT")
      return { status: "connected", authMode: "chatgpt", detail: authDetail };
    if (/API[ _-]?key/i.test(output))
      return {
        status: "api_configured",
        authMode: "api",
        detail:
          "Codex is configured with an API key. Nakama requires a ChatGPT sign-in for subscription runs; sign in with ChatGPT in the official CLI.",
      };
    if (/not logged in/i.test(output))
      return {
        status: "needs_login",
        authMode: "none",
        detail:
          "Sign in with ChatGPT in the official Codex CLI, then check again.",
      };
    return {
      status: "unverified",
      authMode: "unknown",
      detail:
        "Codex did not report the recognised ChatGPT authentication method. No task will run until subscription sign-in can be verified.",
    };
  }
  if (id === "claude") {
    let value;
    try {
      value = JSON.parse(stdout);
    } catch {
      return {
        status: "unverified",
        authMode: "unknown",
        detail:
          "Claude returned an unrecognised authentication status. No task will run until a Claude subscription sign-in is verified.",
      };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        status: "unverified",
        authMode: "unknown",
        detail:
          "Claude returned an invalid authentication record. No model request was started.",
      };
    }
    const apiKey = Boolean(value.apiKeySource && value.apiKeySource !== "none");
    const otherProvider =
      typeof value.apiProvider === "string" &&
      value.apiProvider !== "firstParty";
    if (
      apiKey ||
      otherProvider ||
      ["api_key", "api_key_helper", "third_party"].includes(value.authMethod)
    )
      return {
        status: "api_configured",
        authMode: "api_or_external",
        detail:
          "Claude selected an API credential or external provider. Subscription runs require a first-party Claude account with no API-key source.",
      };
    if (value.loggedIn === false || value.authMethod === "none")
      return {
        status: "needs_login",
        authMode: "none",
        detail:
          "Claude could not find a saved subscription sign-in for this Windows account. In PowerShell, run claude auth login --claudeai, complete the browser sign-in, then check again. You can run this from any folder.",
      };
    if (
      code === 0 &&
      value.loggedIn === true &&
      value.authMethod === "claude.ai" &&
      value.apiProvider === "firstParty" &&
      ["pro", "max", "team", "enterprise"].includes(value.subscriptionType) &&
      (!value.forcedLoginMethod || value.forcedLoginMethod === "claudeai")
    )
      return {
        status: "connected",
        authMode: "claude_subscription",
        subscriptionType: value.subscriptionType,
        detail: authDetail,
      };
    return {
      status: "unverified",
      authMode: "unknown",
      detail:
        "Claude did not confirm a first-party subscription account. Console OAuth, bearer tokens, unknown plans and unknown authentication modes cannot run through this subscription connection.",
    };
  }
  throw new ApiError(400, "Unknown provider.");
}

function assertNotStopped(signal) {
  if (signal?.aborted)
    throw new ApiError(499, "Stopped before a model request was started.");
}

async function verifySubscriptionAuth(provider, file, { cwd, env, signal }) {
  assertNotStopped(signal);
  if (!["codex", "claude"].includes(provider.id))
    throw new ApiError(400, "Unknown provider.");
  const args =
    provider.id === "codex"
      ? ["login", "status"]
      : [...claudeAuthOptions, "auth", "status", "--json"];
  return new Promise((resolve) => {
    let stdout = "",
      stderr = "",
      finished = false,
      overflow = false;
    const child = launch(file, args, { cwd, env });
    const done = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => {
      stopProcess(child);
      done({
        status: "cancelled",
        authMode: "none",
        detail: "Stopped before a model request was started.",
      });
    };
    const timer = setTimeout(() => {
      stopProcess(child);
      done({
        status: "unverified",
        authMode: "unknown",
        detail:
          "Authentication verification timed out. No model request was started.",
      });
    }, 10000);
    const collect = (which) => (chunk) => {
      if (finished) return;
      const text = chunk.toString();
      if (stdout.length + stderr.length + text.length > 16000) {
        overflow = true;
        stopProcess(child);
        done({
          status: "unverified",
          authMode: "unknown",
          detail:
            "Authentication status exceeded the expected size. No model request was started.",
        });
        return;
      }
      if (which === "stdout") stdout += text;
      else stderr += text;
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", () =>
      done({
        status: "unverified",
        authMode: "unknown",
        detail:
          "Could not run the official authentication check. No model request was started.",
      }),
    );
    child.on("close", (code) => {
      if (!overflow)
        done(classifySubscriptionAuth(provider.id, { code, stdout, stderr }));
    });
    child.stdin.on("error", () => {});
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.stdin.end();
  });
}

export async function probeProvider(provider) {
  if (!["codex", "claude"].includes(provider.id))
    throw new ApiError(400, "Unknown provider.");
  const file = await locateProvider(provider.id, provider.executablePath);
  if (!file)
    return {
      status: "not_installed",
      detail: `Install the official ${provider.id} CLI, sign in, then check again.`,
    };
  const result = await verifySubscriptionAuth(provider, file, {
    cwd: os.homedir(),
    env: subscriptionEnv(),
  });
  return { ...result, executablePath: file };
}
export function argumentsFor(provider) {
  if (provider.connectionType !== "subscription")
    throw new ApiError(
      409,
      "This run uses official subscription CLIs. API adapters require a separately configured budget.",
    );
  if (
    ![
      "default",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
      "ultracode",
    ].includes(provider.effort || "default")
  )
    throw new ApiError(400, "Unsupported effort setting.");
  const model = provider.selectedModel || "";
  if (model && !/^[a-zA-Z0-9._:/-]{1,120}$/.test(model))
    throw new ApiError(400, "Invalid model identifier.");
  if (provider.id === "codex") {
    if (provider.effort === "ultracode")
      throw new ApiError(
        400,
        "Ultracode is a Claude setting, not a ChatGPT effort.",
      );
    const detail = provider.modelDetails?.find((m) =>
      model ? m.id === model : m.isDefault,
    );
    if (
      detail &&
      provider.effort &&
      provider.effort !== "default" &&
      !detail.efforts.includes(provider.effort)
    )
      throw new ApiError(
        400,
        "This model does not support the selected reasoning effort.",
      );
    return [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--ephemeral",
      "-c",
      'forced_login_method="chatgpt"',
      "-c",
      'model_provider="openai"',
      ...(model ? ["--model", model] : []),
      ...(provider.effort && provider.effort !== "default"
        ? ["-c", `model_reasoning_effort=${JSON.stringify(provider.effort)}`]
        : []),
      "-",
    ];
  }
  if (provider.id === "claude") {
    if (provider.effort === "ultra")
      throw new ApiError(
        400,
        "Use Claude’s native maximum effort instead of Codex Ultra.",
      );
    return [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      ...claudeAuthOptions,
      "--tools",
      "Read,Glob,Grep",
      "--permission-mode",
      "plan",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-chrome",
      "--no-session-persistence",
      ...(model ? ["--model", model] : []),
      ...(provider.effort && provider.effort !== "default"
        ? // Safe mode disables Claude's native dynamic workflows. Nakama owns
          // orchestration and applies bounded files, so report this mapping honestly.
          [
            "--effort",
            provider.effort === "ultracode" ? "xhigh" : provider.effort,
          ]
        : []),
    ];
  }
  throw new ApiError(400, "Unknown provider.");
}
export function assertClaudeProjectAccess(provider, authentication, version) {
  const fable = /^(?:claude-)?fable(?:-|$)/i.test(provider.selectedModel || "");
  const advanced = fable || provider.effort === "ultracode";
  if (provider.id !== "claude" || !advanced) return;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(String(version).trim());
  const current = match && match.slice(1).map(Number);
  const minimum = [2, 1, fable ? 257 : 203];
  if (
    !current ||
    current[0] < minimum[0] ||
    (current[0] === minimum[0] && current[1] < minimum[1]) ||
    (current[0] === minimum[0] &&
      current[1] === minimum[1] &&
      current[2] < minimum[2])
  )
    throw new ApiError(
      409,
      `This role needs Claude Code ${minimum.join(".")} or later. Update the official client; no model request was started.`,
    );
  if (
    fable &&
    (authentication.subscriptionType !== "max" ||
      provider.usageCreditsDisabledConfirmed !== true)
  )
    throw new ApiError(
      409,
      "Fable requires a verified Max subscription and your confirmation in AI team that usage credits are disabled in Claude account settings. Nakama cannot inspect that billing switch. No model request was started.",
    );
}

async function claudeVersion(file, { cwd, env, signal }) {
  assertNotStopped(signal);
  return new Promise((resolve, reject) => {
    let output = "",
      finished = false;
    const child = launch(file, ["--version"], { cwd, env });
    const done = (error, version) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(version);
    };
    const abort = () => {
      stopProcess(child);
      done(new ApiError(499, "Stopped before model version verification."));
    };
    const timer = setTimeout(() => {
      stopProcess(child);
      done(
        new ApiError(
          409,
          "Claude version verification timed out; no model request was started.",
        ),
      );
    }, 10000);
    child.stdout.on("data", (chunk) => {
      if (finished) return;
      output += chunk.toString();
      if (output.length > 4096) {
        stopProcess(child);
        done(new ApiError(409, "Claude version response was too large."));
      }
    });
    child.stderr.resume();
    child.on("error", () =>
      done(new ApiError(409, "Could not verify the Claude client version.")),
    );
    child.on("close", (code) => done(null, code === 0 ? output.trim() : ""));
    child.stdin.on("error", () => {});
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdin.end();
  });
}
export async function runProvider(
  provider,
  { cwd, prompt, onOutput, onComplete, onPhase, act, signal, guard },
) {
  assertNotStopped(signal);
  const file = await locateProvider(provider.id, provider.executablePath);
  if (!file)
    throw new ApiError(
      409,
      `The ${provider.id} CLI is not installed. Open Agents for setup.`,
    );
  const args = argumentsFor(provider);
  // Claude's supported --tools "" disables built-in tools for the bounded
  // personal-action planner. Codex has no equivalent verified here; do not
  // claim its read-only sandbox is a no-file-read boundary.
  if (act && provider.id === "claude") args[args.indexOf("--tools") + 1] = "";
  const env = subscriptionEnv();
  onPhase?.("checking_account");
  const authentication = await verifySubscriptionAuth(provider, file, {
    cwd,
    env,
    signal,
  });
  // A stop may arrive while the read-only authentication child is exiting.
  // Never start the separately billable/model process after that stop.
  assertNotStopped(signal);
  if (authentication.status !== "connected")
    throw new ApiError(409, authentication.detail);
  if (
    provider.id === "claude" &&
    (/^(?:claude-)?fable(?:-|$)/i.test(provider.selectedModel || "") ||
      provider.effort === "ultracode")
  ) {
    const version = await claudeVersion(file, { cwd, env, signal });
    assertNotStopped(signal);
    assertClaudeProjectAccess(provider, authentication, version);
  }
  assertNotStopped(signal);
  guard?.();
  onPhase?.("starting_model");
  const child = launch(file, args, { cwd, env });
  // Readable's UTF-8 decoder carries incomplete codepoints between pipe chunks.
  // Decoding each Buffer separately can corrupt JSON text and generated files.
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let finished = false,
    answerReported = false,
    lastText = "",
    buffer = "";
  const finish = (code, error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    onComplete({ code, error, text: lastText });
  };
  const timer = setTimeout(
    () => {
      stopProcess(child);
      finish(1, "Task reached its 30-minute session limit.");
    },
    30 * 60 * 1000,
  );
  const stop = () => {
    if (finished) return;
    stopProcess(child);
    finish(130, "Stopped by the user.");
  };
  child.on("error", (err) => finish(1, redact(err.message)));
  child.stdout.on("data", (chunk) => {
    if (finished) return;
    buffer += chunk;
    if (buffer.length > 4 * 1024 * 1024)
      buffer = buffer.slice(-4 * 1024 * 1024);
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const messages = [];
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message"
        )
          messages.push(event.item.text);
        if (event.type === "assistant")
          for (const block of event.message?.content || [])
            if (block.type === "text") messages.push(block.text);
        if (event.type === "result" && event.result)
          messages.push(event.result);
        if (
          event.type === "message" &&
          event.role === "assistant" &&
          event.content
        )
          messages.push(event.content);
        if (
          !answerReported &&
          messages.some(
            (message) => typeof message === "string" && message.trim(),
          )
        ) {
          answerReported = true;
          onPhase?.("answering");
        }
        if (event.type === "error")
          messages.push(
            event.message || event.error?.message || "Provider error",
          );
        for (const message of messages) {
          lastText = redact(message);
          onOutput(lastText + "\n");
        }
      } catch {
        if (line.trim()) onOutput(redact(line) + "\n");
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    if (!finished) onOutput(redact(chunk));
  });
  child.on("close", (code) => {
    if (!finished && buffer.trim()) onOutput(redact(buffer) + "\n");
    finish(
      code,
      code ? "Provider exited before completing the task." : undefined,
    );
  });
  child.stdin.on("error", () => {});
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  else child.stdin.end(prompt);
  return { stop };
}
