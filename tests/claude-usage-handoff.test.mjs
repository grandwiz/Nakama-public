import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  usageTerminalLaunch,
  openClaudeUsageTerminal,
} from "../apps/host/claude-usage-handoff.mjs";
import { NakamaHost } from "../apps/host/host.mjs";
const provider = {
  id: "claude",
  connectionType: "subscription",
  executablePath: "C:\\Claude Code\\claude.exe",
};
const decode = (value) => Buffer.from(value, "base64").toString("utf16le");
test("repair uses a real visible terminal with fixed local /usage and disabled tools/hooks/MCP", () => {
  const result = usageTerminalLaunch(
    provider.executablePath,
    "C:\\Temp\\owner's $(Get-Item secret) usage",
    { systemRoot: "C:\\Windows" },
  );
  assert.equal(result.options.shell, false);
  assert.equal(result.options.windowsHide, true);
  assert.equal(result.options.stdio, "ignore");
  const launch = decode(result.args.at(-1));
  assert.match(launch, /-WindowStyle Normal/);
  assert.match(launch, /-NoProfile/);
  const encoded = launch.match(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1];
  const command = decode(encoded);
  assert.match(
    command,
    /Set-Location -LiteralPath 'C:\\Temp\\owner''s \$\(Get-Item secret\) usage'/,
  );
  assert.match(command, /-NoNewWindow -Wait/);
  assert.match(command, /"--safe-mode"/);
  assert.match(command, /"--setting-sources" ""/);
  assert.match(command, /"--tools" ""/);
  assert.match(command, /"--strict-mcp-config"/);
  assert.match(command, /mcpServers/);
  assert.match(command, /"\/usage"/);
  assert.doesNotMatch(
    command,
    /--print|--no-session-persistence|--dangerously|\s-p\b|--resume|--continue/,
  );
  for (const key of Object.keys(result.options.env))
    assert.doesNotMatch(key, /^(ANTHROPIC_|OPENAI_|CLAUDE_CODE_)/i);
  assert.throws(
    () => usageTerminalLaunch("broken\npath", "C:\\Temp"),
    /Invalid/,
  );
});
test("launch handoff uses an isolated empty folder and does not run a test terminal", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-usage-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const result = await openClaudeUsageTerminal(provider, {
    platform: "win32",
    temp: dir,
    locate: async () => provider.executablePath,
    spawnImpl: () => {
      calls++;
      const child = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    },
  });
  assert.equal(result.opened, true);
  assert.equal(calls, 1);
  const entries = await fs.readdir(dir);
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^nakama-claude-usage-/);
  assert.deepEqual(await fs.readdir(path.join(dir, entries[0])), []);
  await assert.rejects(
    openClaudeUsageTerminal(provider, { platform: "linux" }),
    { status: 409 },
  );
  await assert.rejects(
    openClaudeUsageTerminal(
      { ...provider, connectionType: "api" },
      { platform: "win32" },
    ),
    { status: 409 },
  );
});
test("only explicit owner repair route can open the fixed CLI and private stores never leak", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-usage-route-"));
  let calls = 0;
  const host = await new NakamaHost({
    dataDir: dir,
    usageTerminal: async (value) => {
      calls++;
      assert.equal(value.id, "claude");
      return { opened: true };
    },
  }).init();
  t.after(async () => {
    await host.close();
    await host.store.queue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  await host.store.change((s) => {
    s.devices.push({
      id: "phone",
      platform: "android",
      permissions: { projectAccess: true, googleAccess: true },
    });
    s.projectImportRoots = ["HOST_PRIVATE"];
    s.alarmSoundLibrary = { secret: "SOUND_PRIVATE" };
  });
  assert.equal(
    (await host.dispatch("POST", "/api/providers/claude/usage-terminal", {}))
      .opened,
    true,
  );
  await assert.rejects(
    host.dispatch("POST", "/api/providers/claude/usage-terminal", {
      command: "arbitrary",
    }),
    { status: 400 },
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      "/api/providers/claude/usage-terminal",
      {},
      { kind: "device", id: "phone" },
    ),
    { status: 403 },
  );
  assert.equal(calls, 1);
  const state = host.store.publicState();
  assert.equal(state.chatHistory, undefined);
  assert.equal(state.projectImportRoots, undefined);
  assert.equal(state.alarmSoundLibrary, undefined);
});
