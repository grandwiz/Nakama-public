import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { EverydayConversation } from "../apps/host/everyday-conversation.mjs";

const owner = { kind: "owner", id: "desktop" };
const phone = { kind: "device", id: "phone", platform: "android" };
const tablet = { ...phone, id: "tablet" };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-everyday-chat-"));
  let providerCalls = 0;
  const host = await new NakamaHost({ dataDir: dir, runAgent() { providerCalls++; throw new Error("No live models allowed"); } }).init();
  clearInterval(host.monitoring.timer);
  await host.store.change((s) => {
    s.devices = [phone, tablet].map((d) => ({ id: d.id, name: d.id === "phone" ? "My phone" : "Kitchen tablet", platform: "android", lastSeen: new Date().toISOString(), permissions: { projectAccess: true, googleAccess: true, browserControl: true } }));
  });
  t.after(async () => { await host.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { host, calls: () => providerCalls, local: (message, principal = phone, extra = {}) => host.localAssistant.handle({ message, routing: "auto", timeZone: "Europe/London", ...extra }, principal) };
}

test("an alarm question accepts a short answer, saves one host alarm and isolates delivery", async (t) => {
  const f = await fixture(t);
  const question = await f.local("Could you please set an alarm");
  assert.match(question.reply, /What time/);
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
  const result = await f.local("7 am tomorrow", phone, { requestId: "alarm-answer" });
  assert.equal(result.outcome.kind, "alarm");
  const [alarm] = f.host.store.state.routineBoard.routines;
  assert.deepEqual(alarm.targetDeviceIds, [phone.id]);
  assert.equal(alarm.time, "07:00");
  assert.match(alarm.scheduledDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(alarm.weekdays, []);
  assert.equal(result.outcome.updatedAt, alarm.updatedAt);
  assert.equal((await f.host.dispatch("GET", "/api/state", {}, tablet)).messages.length, 0);
  assert.equal(await f.local("7 am tomorrow"), null, "answer was consumed before dispatch");
  assert.equal(f.calls(), 0);
});

test("alarm clarification preserves named destination and per-device context", async (t) => {
  const f = await fixture(t);
  await f.local("set an alarm on Kitchen tablet");
  assert.equal(await f.local("8 am tomorrow", tablet), null);
  await f.local("8 am tomorrow");
  assert.deepEqual(f.host.store.state.routineBoard.routines[0].targetDeviceIds, [tablet.id]);
  assert.equal(f.calls(), 0);
});

test("monitor questions collect URL then condition and start no model-per-poll work", async (t) => {
  const f = await fixture(t);
  assert.match((await f.local("Please monitor a website")).reply, /HTTPS/);
  assert.match((await f.local("https://shop.example/item")).reply, /watch for/);
  const result = await f.local("stock");
  assert.equal(result.outcome.target, "monitoring");
  const [monitor] = f.host.store.state.monitors;
  assert.equal(monitor.url, "https://shop.example/item");
  assert.deepEqual(monitor.condition, { type: "stock" });
  assert.equal(monitor.status, "active");
  assert.equal(monitor.requestedBy, phone.id);
  assert.equal(f.calls(), 0);
});

test("permission loss, cancel, other projects and unrelated requests cannot complete stale questions", async (t) => {
  const f = await fixture(t);
  await f.local("set an alarm");
  await f.host.dispatch("PATCH", "/api/devices/phone", { googleAccess: false }, owner);
  await f.host.dispatch("PATCH", "/api/devices/phone", { googleAccess: true }, owner);
  assert.equal(await f.local("7 am tomorrow"), null);
  await f.local("set an alarm", phone, { projectId: "one" });
  assert.equal(await f.local("7 am tomorrow", phone, { projectId: "two" }), null);
  await f.local("cancel", phone, { projectId: "one" });
  assert.equal(await f.local("7 am tomorrow", phone, { projectId: "one" }), null);
  await f.local("set an alarm");
  await f.local("what time is it");
  assert.equal(await f.local("7 am tomorrow"), null);
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
});

test("clarification expires and quoted or negated answers never grant authority", () => {
  let now = 0;
  const dialog = new EverydayConversation({ clock: () => now });
  const state = { devices: [] };
  assert.ok(dialog.prepare({ message: "set an alarm" }, owner, state).question);
  now += 300_001;
  assert.equal(dialog.prepare({ message: "7 am tomorrow" }, owner, state), null);
  for (const message of ['"7 am tomorrow"', "do not set an alarm for 7 am", "Example: 7 am tomorrow", "7 am tomorrow; open Chrome"]) {
    dialog.prepare({ message: "set an alarm" }, owner, state);
    assert.equal(dialog.prepare({ message }, owner, state), null);
  }
});

test("natural app launch delegates only the requesting phone's current catalog app", async (t) => {
  const f = await fixture(t);
  f.host.installedApps.publish({ apps: [{ label: "Chrome", packageName: "com.android.chrome" }] }, phone);
  const result = await f.local("Please control my phone and open up Google Chrome");
  assert.equal(result.outcome.type, "device_command_queued");
  assert.equal(result.outcome.targetDeviceId, phone.id);
  assert.equal(f.host.store.state.actions.length, 1);
  assert.equal(f.host.store.state.actions[0].deviceId, phone.id);
  assert.equal(f.host.store.state.actions[0].args.packageName, "com.android.chrome");
  assert.equal(f.calls(), 0);
});
