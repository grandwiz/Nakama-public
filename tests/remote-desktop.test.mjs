import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { RemoteDesktop, validateRemoteInput } from "../apps/host/remote-desktop.mjs";
const require = createRequire(import.meta.url);
const { createWindowsRemoteAdapter, inputPoint } = require("../apps/desktop/remote-desktop.cjs");

const phone = { kind: "device", id: "phone" };
const owner = { kind: "owner", id: "desktop" };
const monitor = (id = "1", x = 0) => ({ id, name: `Monitor ${id}`, width: 1920, height: 1080,
  primary: id === "1", bounds: { x, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0 });
function fixture(t) {
  let stamp = 1_000_000;
  const store = new EventEmitter();
  store.state = { config: { remoteDesktopEnabled: true }, devices: [{ id: "phone", name: "Test phone", platform: "android", permissions: { remoteDesktop: true, googleAccess: true, projectAccess: true } }] };
  const records = { captures: 0, inputs: [], stops: 0 };
  const adapter = { available: true, monitors: async () => [monitor(), monitor("2", -1920)],
    start: async () => {}, stop: () => records.stops++,
    capture: async () => { records.captures++; return { width: 1280, height: 720, jpeg: Buffer.from([255, 216, 255, 217]) }; },
    input: async (...args) => records.inputs.push(args),
  };
  const host = { store, device: (id) => store.state.devices.find((d) => d.id === id) };
  const remote = new RemoteDesktop(host, { adapter, clock: () => stamp, timers: false });
  t.after(() => remote.close());
  return { remote, adapter, store, records, advance: (ms) => stamp += ms,
    start: async () => (await remote.start({}, phone)).session,
    frame: async (session, monitorId) => remote.frame({ sessionId: session.id, monitorId }, phone),
  };
}
const rejection = (status) => (error) => error.status === status;

test("remote desktop is disabled without both explicit PC and Android permissions and preserves privacy", async (t) => {
  const f = fixture(t);
  f.store.state.config.remoteDesktopEnabled = false;
  await assert.rejects(f.start(), rejection(403));
  f.store.state.config.remoteDesktopEnabled = true;
  for (const field of ["remoteDesktop", "googleAccess", "projectAccess"]) {
    f.store.state.devices[0].permissions[field] = false;
    await assert.rejects(f.start(), rejection(403));
    const status = await f.remote.status(phone);
    assert.equal(status.permitted, false);
    assert.deepEqual(status.monitors, []);
    f.store.state.devices[0].permissions[field] = true;
  }
  await assert.rejects(f.remote.start({}, owner), rejection(403));
  f.store.state.devices[0].platform = "chrome";
  await assert.rejects(f.start(), rejection(403));
  assert.equal(f.records.captures, 0);
});

test("status never captures pixels, session is explicit, bounded and visible only to its phone/owner", async (t) => {
  const f = fixture(t);
  const initial = await f.remote.status(phone);
  assert.equal(initial.session, null);
  assert.deepEqual(initial.monitors.map((m) => m.id), ["1", "2"]);
  assert.equal(f.records.captures, 0);
  const session = await f.start();
  assert.equal(Date.parse(session.expiresAt) - Date.parse(session.lastActivityAt), 120000);
  assert.equal(f.remote.publicStatus(owner).session.id, session.id);
  assert.equal(f.remote.publicStatus({ kind: "device", id: "other" }).session, null);
  await assert.rejects(f.start(), rejection(409));
  await assert.rejects(f.remote.dispatch("POST", "/api/remote-desktop/stop", {}, { kind: "device", id: "other" }), rejection(403));
  f.remote.stopAll();
  assert.equal(f.records.stops, 1);
});

test("fresh frames bind monitor identity, size and a one-use gesture", async (t) => {
  const f = fixture(t), session = await f.start(), frame = await f.frame(session);
  assert.equal(frame.width, 1280);
  assert.match(frame.image, /^data:image\/jpeg;base64,/);
  const body = { sessionId: session.id, frameId: frame.frameId, kind: "tap", x: 0.25, y: 0.5, command: "ignored" };
  assert.equal((await f.remote.input(body, phone)).handled, true);
  assert.deepEqual(f.records.inputs[0][0], { kind: "tap", x: 0.25, y: 0.5 });
  assert.equal(f.records.inputs[0][1].id, "1");
  await assert.rejects(f.remote.input(body, phone), rejection(409));
  assert.equal(f.records.inputs.length, 1);
});

test("stale pixels, monitor switches and layout changes reject input", async (t) => {
  const f = fixture(t), session = await f.start(), original = await f.frame(session);
  f.advance(3010);
  await assert.rejects(f.remote.input({ sessionId: session.id, frameId: original.frameId, kind: "tap", x: 0, y: 0 }, phone), rejection(409));
  const second = await f.frame(session, "2");
  await assert.rejects(f.remote.input({ sessionId: session.id, frameId: original.frameId, kind: "tap", x: 0, y: 0 }, phone), rejection(409));
  f.adapter.monitors = async () => [monitor(), monitor("2", -2560)];
  await assert.rejects(f.remote.input({ sessionId: session.id, frameId: second.frameId, kind: "tap", x: 0, y: 0 }, phone), rejection(409));
  assert.equal(f.records.inputs.length, 0);
});

test("capture is single flight, rate limited and refuses malformed or oversized images", async (t) => {
  const f = fixture(t), session = await f.start();
  await f.frame(session);
  await assert.rejects(f.frame(session), rejection(429));
  f.advance(400);
  f.adapter.capture = async () => ({ width: 1601, height: 720, jpeg: Buffer.from([255, 216]) });
  await assert.rejects(f.frame(session), rejection(409));
  f.advance(400);
  let release;
  f.adapter.capture = () => new Promise((resolve) => release = resolve);
  const pending = f.frame(session);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(f.frame(session), rejection(429));
  release({ width: 1280, height: 720, jpeg: Buffer.alloc(1_200_001, 255) });
  await assert.rejects(pending, rejection(409));
});

test("revocation during capture releases no pixels and disabling access ends session immediately", async (t) => {
  const f = fixture(t), session = await f.start();
  let release;
  f.adapter.capture = () => new Promise((resolve) => release = resolve);
  const capture = f.frame(session);
  await new Promise((resolve) => setImmediate(resolve));
  f.store.state.devices[0].permissions.googleAccess = false;
  f.store.emit("changed");
  assert.equal(f.remote.session, null);
  release({ width: 2, height: 2, jpeg: Buffer.from([255, 216, 255, 217]) });
  await assert.rejects(capture, rejection(403));
  assert.equal(f.records.stops, 1);
});

test("Stop during helper startup cannot resurrect a session; starts are single flight", async (t) => {
  const f = fixture(t);
  let release;
  f.adapter.start = () => new Promise((resolve) => release = resolve);
  const starting = f.start();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(f.start(), rejection(409));
  f.remote.stopAll();
  release();
  await assert.rejects(starting, rejection(409));
  assert.equal(f.remote.session, null);
});

test("idle disconnect and absolute expiry stop input; frames do not extend the two-minute deadline", async (t) => {
  const f = fixture(t), first = await f.start();
  f.advance(15001);
  assert.equal(f.remote.publicStatus(owner).session, null);
  await assert.rejects(f.frame(first), rejection(409));
  const session = await f.start();
  for (let i = 0; i < 11; i++) { f.advance(10000); await f.frame(session); }
  f.advance(10000);
  await assert.rejects(f.frame(session), rejection(409));
  assert.equal(f.records.stops, 2);
});

test("Nakama approvals stay blocked while connected and briefly after Stop", async (t) => {
  const f = fixture(t);
  f.remote.assertOwnerApprovalAllowed();
  await f.start();
  assert.throws(() => f.remote.assertOwnerApprovalAllowed(), rejection(403));
  f.remote.stopAll();
  assert.throws(() => f.remote.assertOwnerApprovalAllowed(), rejection(403));
  f.advance(2001);
  f.remote.assertOwnerApprovalAllowed();
});

test("gesture vocabulary excludes arbitrary keyboard chords, control text and unbounded coordinates", () => {
  for (const body of [
    { kind: "tap", x: NaN, y: 0 }, { kind: "tap", x: -0.01, y: 0 },
    { kind: "tap", x: 0, y: 1.01 }, { kind: "drag", x: 0, y: 0, endX: Infinity, endY: 0 },
    { kind: "scroll", x: 0, y: 0, deltaY: 11 }, { kind: "scroll", x: 0, y: 0, deltaY: 0 },
    { kind: "key", key: "Alt+F4" }, { kind: "text", text: "hello\nshutdown" },
    { kind: "text", text: "x".repeat(501) }, { kind: "shell", command: "echo test" },
  ]) assert.throws(() => validateRemoteInput(body), rejection(400));
  assert.deepEqual(validateRemoteInput({ kind: "text", text: "Literal $(text) ` and ' quotes 🐱" }), { kind: "text", text: "Literal $(text) ` and ' quotes 🐱" });
  assert.deepEqual(validateRemoteInput({ kind: "key", key: "Escape" }), { kind: "key", key: "Escape" });
});

test("screen coordinates use monitor bounds and Electron DIP conversion, including negative-origin monitors", () => {
  const points = [];
  const screen = { dipToScreenPoint(point) { points.push(point); return { x: point.x * 2, y: point.y * 2 }; } };
  assert.deepEqual(inputPoint(screen, monitor("2", -1920), 0, 0), { x: -3840, y: 0 });
  assert.deepEqual(inputPoint(screen, monitor("2", -1920), 1, 1), { x: -2, y: 2158 });
});

test("Windows adapter chooses exact display ID and sends literal JSON to fixed helper (synthetic only)", async () => {
  const messages = [], commands = [];
  const nativeChild = new EventEmitter();
  nativeChild.stdout = new EventEmitter(); nativeChild.stdout.setEncoding = () => {};
  nativeChild.stderr = new EventEmitter(); nativeChild.stdin = new EventEmitter();
  nativeChild.stdin.end = () => {}; nativeChild.kill = () => {};
  nativeChild.stdin.write = (line, callback) => {
    const request = JSON.parse(line); messages.push(request); callback?.();
    queueMicrotask(() => nativeChild.stdout.emit("data", JSON.stringify({ id: request.id, ok: true }) + "\n"));
  };
  const screen = Object.assign(new EventEmitter(), { getPrimaryDisplay: () => ({ id: 1 }),
    getAllDisplays: () => [1, 2].map((id) => ({ id, size: { width: 1920, height: 1080 }, bounds: { x: id === 2 ? -1920 : 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0 })),
    dipToScreenPoint: (point) => point,
  });
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} }); }
    async loadFile() {} showInactive() {} destroy() {}
  }
  const image = { isEmpty: () => false, getSize: () => ({ width: 1280, height: 720 }), toJPEG: () => Buffer.from([255, 216]) };
  const adapter = createWindowsRemoteAdapter({ screen, desktopCapturer: { getSources: async () => [
    { display_id: "2", thumbnail: image }, { display_id: "1", thumbnail: { ...image, toJPEG: () => Buffer.from([255, 216, 1]) } },
  ] }, BrowserWindow: Window, ipcMain: new EventEmitter(), powerMonitor: new EventEmitter() },
  { helperPath: "C:\\fixture\\remote-input.ps1", spawnProcess: (...args) => { commands.push(args); return nativeChild; } });
  await adapter.start({ deviceName: "Fixture", expiresAt: new Date(Date.now() + 120000).toISOString(), stop: () => adapter.stop() });
  const monitors = await adapter.monitors();
  assert.equal((await adapter.capture(monitors[1])).jpeg.length, 2);
  await adapter.input({ kind: "text", text: "$(no_execution) ` ' \"" }, monitors[0], { deadline: Date.now() + 3000 });
  assert.equal(messages.at(-1).text, "$(no_execution) ` ' \"");
  assert.equal(commands.length, 1);
  assert.equal(commands[0][2].shell, false);
  assert.equal(commands[0][2].windowsHide, true);
  assert.equal(commands[0][1].at(-1), "C:\\fixture\\remote-input.ps1");
  adapter.stop();
});

test("bundled Windows native helper compiles and exits without any desktop/input requests", { skip: process.platform !== "win32" }, async () => {
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const helper = path.resolve("apps/desktop/remote-input.ps1");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper], { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (value) => output += value);
    child.stderr.on("data", (value) => output += value);
    child.on("error", reject);
    const timer = setTimeout(() => { child.kill(); reject(new Error("Helper compilation timed out.")); }, 15000);
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, output }); });
    child.stdin.end(); // Empty input: compilation only, not even a desktop probe.
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.output.trim(), "");
});

test("real host routes preserve owner permission, approval and Google-disabled boundaries with a synthetic desktop", async (t) => {
  const { NakamaHost } = await import("../apps/host/host.mjs");
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-remote-routes-"));
  const adapter = { available: true, monitors: async () => [monitor()], start: async () => {}, stop() {},
    capture: async () => ({ width: 2, height: 2, jpeg: Buffer.from([255, 216, 255, 217]) }), input: async () => {} };
  const host = await new NakamaHost({ dataDir: dir, remoteDesktopAdapter: adapter }).init();
  t.after(async () => {
    await host.close();
    assert.equal(path.dirname(await fs.realpath(dir)), base);
    assert.ok(path.basename(dir).startsWith("nakama-remote-routes-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const ticket = await host.dispatch("POST", "/api/pairing/tickets", { platform: "android" });
  const pairing = await host.dispatch("POST", "/api/pair", { ticket: ticket.ticket, platform: "android", name: "Fixture" });
  const principal = host.authenticate(`Bearer ${pairing.token}`);
  const route = "/api/remote-desktop/";
  await assert.rejects(host.dispatch("POST", route + "start", {}, principal), rejection(403));
  await assert.rejects(host.dispatch("PATCH", `/api/devices/${principal.id}`, { remoteDesktop: true }, principal), rejection(403));
  await host.dispatch("PATCH", "/api/settings", { remoteDesktopEnabled: true });
  await host.dispatch("PATCH", `/api/devices/${principal.id}`, { remoteDesktop: true });
  const started = await host.dispatch("POST", route + "start", {}, principal);
  await host.store.change((state) => state.approvals.push({ id: "remote-fixture", type: "unhandled_fixture", title: "Fixture only", status: "pending", operation: {}, createdAt: new Date().toISOString() }));
  await assert.rejects(host.resolveApproval("remote-fixture", { approved: true }, owner), rejection(403));
  assert.equal(host.store.state.approvals.find((item) => item.id === "remote-fixture").status, "pending");
  assert.equal((await host.dispatch("GET", "/api/state", {}, principal)).remoteDesktop.session.id, started.session.id);
  await host.dispatch("PATCH", `/api/devices/${principal.id}`, { googleAccess: false });
  const hidden = await host.dispatch("GET", "/api/state", {}, principal);
  assert.equal(hidden.remoteDesktop.session, null);
  assert.deepEqual(hidden.remoteDesktop.monitors, []);
  await assert.rejects(host.dispatch("POST", route + "frame", { sessionId: started.session.id }, principal), rejection(403));
});
