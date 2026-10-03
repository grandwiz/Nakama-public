import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApiError } from "./security.mjs";
import { locateProvider, subscriptionEnv } from "./providers.mjs";
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const encode = (value) => Buffer.from(value, "utf16le").toString("base64");
const argument = (value) =>
  '"' +
  String(value)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, "$1$1") +
  '"';

// Only an explicit PC-owner button calls this handoff. The visible official
// CLI handles its own token refresh/login. Nakama never edits shared secrets.
export function usageTerminalLaunch(
  file,
  cwd,
  {
    systemRoot = process.env.SystemRoot || "C:\\Windows",
    node = process.execPath,
  } = {},
) {
  if (
    [file, cwd, systemRoot, node].some(
      (value) => typeof value !== "string" || /[\0\r\n]/.test(value),
    )
  )
    throw new ApiError(400, "Invalid usage terminal path.");
  const shell = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const args = [
    "--safe-mode",
    "--setting-sources",
    "",
    "--settings",
    '{"forceLoginMethod":"claudeai"}',
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--tools",
    "",
    "--no-chrome",
    "/usage",
  ];
  const nodeFile = /\.(mjs|js)$/i.test(file);
  const command = `$ErrorActionPreference = 'Stop'\nSet-Location -LiteralPath ${literal(cwd)}\n${nodeFile ? "$env:ELECTRON_RUN_AS_NODE = '1'\n" : ""}Start-Process -FilePath ${literal(nodeFile ? node : file)} -ArgumentList ${literal([...(nodeFile ? [file] : []), ...args].map(argument).join(" "))} -NoNewWindow -Wait`;
  // Start-Process gives the new terminal its own console/stdio. A hidden
  // bootstrap with ignored stdio cannot accidentally run Claude headlessly.
  const launch = `$ErrorActionPreference = 'Stop'\nStart-Process -FilePath ${literal(shell)} -ArgumentList @('-NoLogo','-NoProfile','-NoExit','-EncodedCommand',${literal(encode(command))}) -WorkingDirectory ${literal(cwd)} -WindowStyle Normal`;
  return {
    file: shell,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encode(launch),
    ],
    options: {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env: subscriptionEnv(),
    },
  };
}
export async function openClaudeUsageTerminal(
  provider,
  {
    platform = process.platform,
    locate = locateProvider,
    spawnImpl = spawn,
    temp = os.tmpdir(),
  } = {},
) {
  if (platform !== "win32")
    throw new ApiError(
      409,
      "Open the official Claude Code terminal and enter /usage, then refresh usage in Nakama.",
    );
  if (provider?.connectionType !== "subscription")
    throw new ApiError(409, "Connect Claude using your subscription first.");
  const file = await locate("claude", provider.executablePath);
  if (!file)
    throw new ApiError(
      409,
      "Install the official Claude Code CLI, sign in, and enter /usage.",
    );
  const cwd = await fs.mkdtemp(path.join(temp, "nakama-claude-usage-"));
  const spec = usageTerminalLaunch(file, cwd);
  await new Promise((resolve, reject) => {
    let child;
    let timer;
    let finished = false;
    const done = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    try {
      child = spawnImpl(spec.file, spec.args, spec.options);
    } catch {
      done(new ApiError(503, "Could not open the official Claude terminal."));
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      done(new ApiError(503, "The usage terminal launcher timed out."));
    }, 6000);
    child.once("error", () =>
      done(new ApiError(503, "Could not open the official Claude terminal.")),
    );
    child.once("exit", (code) =>
      done(
        code === 0
          ? null
          : new ApiError(503, "Could not open the official Claude terminal."),
      ),
    );
  });
  return {
    opened: true,
    detail:
      "Claude Code is opening /usage on this PC. Complete any sign-in there, then refresh usage in Nakama. The terminal controls its own authentication.",
  };
}
