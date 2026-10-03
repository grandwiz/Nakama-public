import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";

const phone = { kind: "device", id: "phone", platform: "android" };
const tablet = { ...phone, id: "tablet" };
const owner = { kind: "owner", id: "desktop" };
const alarm = { type: "alarm_create", time: "07:00", repeat: "once" };
const monitor = {
  type: "monitor_create",
  url: "https://shop.example/item",
  condition: { type: "stock" },
  intervalSeconds: 60,
};
const compound =
  "set an alarm for 7 am; monitor https://shop.example/item for stock";
const block = (actions) =>
  "```nakama-actions\n" +
  JSON.stringify({ summary: "Requested work", actions }) +
  "\n```";
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(
      Date.now() < deadline,
      "Synthetic model callback did not become ready",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-capability-model-"));
  const calls = [];
  const host = await new NakamaHost({
    dataDir: dir,
    runAgent: async (provider, options) => {
      calls.push({ provider, options });
      return { stop() {} };
    },
    usageReader: {
      read: async () => ({ providers: [], checkedAt: "synthetic" }),
    },
  }).init();
  clearInterval(host.monitoring.timer);
  await host.store.change((state) => {
    state.devices = [phone, tablet].map((device) => ({
      id: device.id,
      name: device.id === phone.id ? "My phone" : "Kitchen tablet",
      platform: "android",
      lastSeen: new Date().toISOString(),
      permissions: {
        projectAccess: true,
        googleAccess: true,
        browserControl: true,
      },
    }));
    state.messages.push({
      id: "previous-private-context",
      role: "user",
      deliveryDeviceId: phone.id,
      projectId: null,
      content: "Previous private instruction must not authorize actions",
      createdAt: new Date().toISOString(),
    });
  });
  t.after(async () => {
    await host.close();
    await host.store.queue;
    assert.equal(path.dirname(dir), base);
    assert.ok(path.basename(dir).startsWith("nakama-capability-model-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    host,
    calls,
    async ask(message = compound, extra = {}) {
      const response = await host.dispatch(
        "POST",
        "/api/chat",
        {
          routing: "auto",
          message,
          timeZone: "Asia/Tokyo",
          requestId: "model-capability-request-001",
          ...extra,
        },
        phone,
      );
      await until(() => calls.length === 1);
      return {
        response,
        complete: calls[0].options.onComplete,
        task: host.store.state.tasks.find(
          (task) => task.id === response.taskIds[0],
        ),
      };
    },
  };
}

test("automatic task-manager callback delegates alarm and monitor workers once with origin and timezone preserved", async (t) => {
  const f = await fixture(t),
    { response, complete, task } = await f.ask();
  assert.equal(response.routing.mode, "act");
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].options.prompt, /planning timezone: Asia\/Tokyo/);
  assert.doesNotMatch(
    f.calls[0].options.prompt,
    /Previous private instruction/,
  );
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
  await complete({ code: 0, text: block([alarm, monitor]) });
  await complete({ code: 0, text: block([alarm, monitor]) });
  assert.equal(task.status, "completed");
  assert.deepEqual(
    task.actionOutcomes.map((item) => item.status),
    ["pending_device", "active"],
  );
  assert.equal(f.host.store.state.routineBoard.routines.length, 1);
  assert.equal(
    f.host.store.state.routineBoard.routines[0].timeZone,
    "Asia/Tokyo",
  );
  assert.deepEqual(
    f.host.store.state.routineBoard.routines[0].targetDeviceIds,
    [phone.id],
  );
  assert.equal(f.host.store.state.monitors.length, 1);
  assert.equal(f.host.store.state.monitors[0].requestedBy, phone.id);
  assert.deepEqual(
    (await f.host.dispatch("GET", "/api/state", {}, tablet)).messages,
    [],
  );
  assert.equal(
    f.calls.length,
    1,
    "all provider behavior is synthetic; no additional inference per action",
  );
});

test("an invented model monitoring URL fails the full plan before any requested alarm is saved", async (t) => {
  const f = await fixture(t),
    { complete, task } = await f.ask();
  await complete({
    code: 0,
    text: block([alarm, { ...monitor, url: "https://other.example/item" }]),
  });
  assert.equal(task.status, "failed");
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
  assert.equal(f.host.store.state.monitors.length, 0);
});

test("late model output cannot act after requesting phone access is revoked", async (t) => {
  const f = await fixture(t),
    { complete, task } = await f.ask();
  await f.host.dispatch(
    "PATCH",
    "/api/devices/phone",
    { projectAccess: false },
    owner,
  );
  await complete({ code: 0, text: block([alarm, monitor]) });
  assert.equal(task.status, "stopped");
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
  assert.equal(f.host.store.state.monitors.length, 0);
});

test("whole-plan preflight catches a destination revoked during model work before saving an earlier alarm", async (t) => {
  const f = await fixture(t);
  f.host.installedApps.publish(
    { apps: [{ label: "Chrome", packageName: "com.android.chrome" }] },
    tablet,
  );
  const { complete, task } = await f.ask(
    "set an alarm for 7 am; open Chrome on Kitchen tablet",
  );
  await f.host.dispatch(
    "PATCH",
    "/api/devices/tablet",
    { projectAccess: false },
    owner,
  );
  await complete({
    code: 0,
    text: block([
      alarm,
      {
        type: "open_app",
        appName: "Chrome",
        targetDeviceName: "Kitchen tablet",
      },
    ]),
  });
  assert.equal(task.status, "failed");
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
  assert.equal(f.host.store.state.actions.length, 0);
});

test("a model-proposed command quoted as source material creates no alarm", async (t) => {
  const f = await fixture(t),
    { complete, task } = await f.ask(
      'Explain the example "set an alarm for 7 am"',
      { routing: undefined, mode: "act" },
    );
  await complete({ code: 0, text: block([alarm]) });
  assert.equal(task.status, "failed");
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
});
