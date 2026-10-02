import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { publicAttention } from "../apps/host/attention.mjs";
import {
  parseActionPlan,
  executeActionPlan,
} from "../apps/host/assistant-actions.mjs";
const OWNER = { kind: "owner", id: "desktop" },
  ONE = { kind: "device", id: "phone", platform: "android" },
  TWO = { ...ONE, id: "tablet" };
const until = async (fn) => {
  const end = Date.now() + 5000;
  while (!fn()) {
    assert.ok(Date.now() < end, "Fixture callback timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-delivery-")),
    calls = [];
  const host = await new NakamaHost({
    dataDir: dir,
    runAgent: async (provider, options) => {
      const call = { provider, options };
      calls.push(call);
      return {
        stop() {
          call.stopped = true;
        },
      };
    },
  }).init();
  await host.store.change((s) => {
    s.devices = [
      { id: "phone", name: "Phone" },
      { id: "tablet", name: "Tablet" },
    ].map((d) => ({
      ...d,
      platform: "android",
      lastSeen: new Date().toISOString(),
      permissions: { projectAccess: true, googleAccess: true },
    }));
  });
  for (const principal of [ONE, TWO])
    host.installedApps.publish(
      {
        apps: [
          {
            packageName:
              principal.id === "phone"
                ? "com.fixture.netflix.phone"
                : "com.fixture.netflix.tablet",
            label: "Netflix",
          },
        ],
      },
      principal,
    );
  t.after(async () => {
    await host.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    host,
    calls,
    request: (method, route, body = {}, principal = ONE) =>
      host.dispatch(method, route, body, principal),
  };
}
test("source-only ordinary app command, replies and delayed target receipts never broadcast", async (t) => {
  const f = await fixture(t);
  const response = await f.request("POST", "/api/chat", {
    message: "open Netflix",
    routing: "auto",
  });
  assert.equal(response.deliveryDeviceId, "phone");
  assert.equal(response.local, true);
  assert.equal(
    (await f.request("GET", "/api/device/actions", {}, TWO)).actions.length,
    0,
  );
  const action = (await f.request("GET", "/api/device/actions")).actions[0];
  assert.equal(action.deviceId, "phone");
  assert.equal(action.args.packageName, "com.fixture.netflix.phone");
  await f.request("POST", `/api/device/actions/${action.id}/result`, {
    status: "started",
    message: "PRIVATE_PHONE_RECEIPT",
  });
  const own = await f.request("GET", "/api/state"),
    other = await f.request("GET", "/api/state", {}, TWO);
  assert.ok(
    own.messages.some((m) => m.content.includes("PRIVATE_PHONE_RECEIPT")),
  );
  assert.equal(other.messages.length, 0);
  assert.equal(f.calls.length, 0);
});
test("explicit remote target receives the exact catalog app; its receipt returns only to caller", async (t) => {
  const f = await fixture(t);
  const result = await f.request("POST", "/api/device/commands", {
    command: "open_app",
    targetDeviceId: "tablet",
    targetDeviceName: "Tablet",
    args: { appName: "Netflix" },
  });
  assert.equal(result.deliveryDeviceId, "phone");
  assert.equal(result.targetDeviceId, "tablet");
  assert.equal(
    (await f.request("GET", "/api/device/actions")).actions.length,
    0,
  );
  const action = (await f.request("GET", "/api/device/actions", {}, TWO))
    .actions[0];
  assert.equal(action.deviceId, "tablet");
  assert.equal(action.requestedBy, "phone");
  assert.equal(action.deliveryDeviceId, "phone");
  assert.equal(action.args.packageName, "com.fixture.netflix.tablet");
  await f.request(
    "POST",
    `/api/device/actions/${action.id}/result`,
    { status: "started", message: "PRIVATE_REMOTE_RECEIPT" },
    TWO,
  );
  assert.ok(
    (await f.request("GET", "/api/state")).messages.some((m) =>
      m.content.includes("PRIVATE_REMOTE_RECEIPT"),
    ),
  );
  assert.equal(
    (await f.request("GET", "/api/state", {}, TWO)).messages.length,
    0,
  );
  await assert.rejects(
    f.request("POST", "/api/device/actions", {
      deviceId: "tablet",
      type: "open_app",
      args: { packageName: "com.fixture.netflix.tablet" },
      explicitTarget: true,
    }),
    { status: 403 },
  );
});
test("unknown ambiguous disconnected and removed target names fail without falling back or exposing catalogs", async (t) => {
  const f = await fixture(t),
    command = { command: "open_app", args: { appName: "Netflix" } };
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...command,
      targetDeviceName: "Missing",
    }),
    /No paired/,
  );
  await f.host.store.change((s) => {
    s.devices[1].name = "Phone";
  });
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...command,
      targetDeviceName: "Phone",
    }),
    /Several devices/,
  );
  await f.host.store.change((s) => {
    s.devices[1].name = "Tablet";
    s.devices[1].lastSeen = new Date(0).toISOString();
  });
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...command,
      targetDeviceName: "Tablet",
    }),
    /not currently connected/,
  );
  await f.request("DELETE", "/api/devices/tablet", {}, OWNER);
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...command,
      targetDeviceId: "tablet",
    }),
    /no longer exists/,
  );
  assert.equal(f.host.store.state.actions.length, 0);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.request("GET", "/api/devices/phone/apps"), {
    status: 403,
  });
});
test("remote source revocation and delayed approval recheck stop target delivery", async (t) => {
  const f = await fixture(t),
    command = {
      command: "timer",
      targetDeviceName: "Tablet",
      args: {
        durationSeconds: 600,
        title: "Fixture",
        requestId: "remote-timer",
      },
    };
  await f.request("POST", "/api/device/commands", command);
  await f.request(
    "PATCH",
    "/api/devices/phone",
    { googleAccess: false },
    OWNER,
  );
  assert.equal(
    (await f.request("GET", "/api/device/actions", {}, TWO)).actions.length,
    0,
  );
  await f.request("PATCH", "/api/devices/phone", { googleAccess: true }, OWNER);
  assert.equal(
    (await f.request("GET", "/api/device/actions", {}, TWO)).actions.length,
    0,
  );
  await f.request(
    "PATCH",
    "/api/settings",
    { confirmOrdinaryActions: true },
    OWNER,
  );
  const approval = await f.request("POST", "/api/device/commands", {
    ...command,
    args: { ...command.args, requestId: "remote-approved" },
  });
  await f.request(
    "PATCH",
    "/api/devices/tablet",
    { projectAccess: false },
    OWNER,
  );
  await assert.rejects(
    f.request(
      "POST",
      `/api/approvals/${approval.id}/resolve`,
      { approved: true },
      OWNER,
    ),
    { status: 403 },
  );
});
test("default phone timer queues only on source; explicitly requested PC timer alerts PC", async (t) => {
  const f = await fixture(t);
  const result = await f.request("POST", "/api/chat", {
    message: "set a 10 minute timer",
    routing: "auto",
    requestId: "source-timer",
  });
  assert.equal(result.outcome.type, "timer_queued");
  assert.equal(f.host.store.state.clock.timers.length, 0);
  const action = (await f.request("GET", "/api/device/actions")).actions[0];
  assert.equal(action.type, "timer_start");
  assert.equal(action.args.durationSeconds, 600);
  assert.equal(
    (await f.request("GET", "/api/device/actions", {}, TWO)).actions.length,
    0,
  );
  const remote = await f.request("POST", "/api/device/commands", {
    command: "timer",
    targetDeviceName: "PC",
    args: { durationSeconds: 1, title: "PC fixture" },
  });
  assert.equal(remote.timer.targetDeviceId, "desktop");
  await f.host.store.change((s) => {
    s.clock.timers[0].endsAt = new Date(0).toISOString();
  });
  await f.host.clockTimers.tick();
  assert.equal(
    (await f.request("GET", "/api/attention")).items.some(
      (i) => i.kind === "timer",
    ),
    false,
  );
  assert.equal(
    (await f.request("GET", "/api/attention", {}, OWNER)).items.find(
      (i) => i.kind === "timer",
    ).deliveryDeviceId,
    "desktop",
  );
});
test("local and asynchronous model replies retain origin across delayed callbacks and unrelated requests", async (t) => {
  const f = await fixture(t);
  await f.request("POST", "/api/chat", { message: "hello", routing: "auto" });
  assert.equal(
    (await f.request("GET", "/api/state", {}, TWO)).messages.length,
    0,
  );
  const response = await f.request("POST", "/api/chat", {
    message: "Explain a rainbow",
    routing: "auto",
  });
  await until(() => f.calls.length === 1);
  await f.request(
    "POST",
    "/api/chat",
    { message: "hello", routing: "auto" },
    TWO,
  );
  f.calls[0].options.onComplete({ code: 0, text: "PRIVATE_DELAYED_REPLY" });
  await until(() => f.host.store.state.tasks[0].status === "completed");
  const other = await f.request("GET", "/api/state", {}, TWO);
  assert.equal(
    other.tasks.some((task) => response.taskIds.includes(task.id)),
    false,
  );
  assert.equal(
    other.messages.some((m) => m.content.includes("PRIVATE_DELAYED_REPLY")),
    false,
  );
  assert.equal(
    (await f.request("GET", "/api/state")).messages.find(
      (m) => m.content === "PRIVATE_DELAYED_REPLY",
    ).deliveryDeviceId,
    "phone",
  );
  const next = await f.request(
    "POST",
    "/api/chat",
    { message: "Explain snowflakes", routing: "auto" },
    TWO,
  );
  await until(() => f.calls.length === 2);
  assert.doesNotMatch(
    f.calls[1].options.prompt,
    /PRIVATE_DELAYED_REPLY|Explain a rainbow/,
  );
  await f.request("DELETE", "/api/devices/tablet", {}, OWNER);
  f.calls[1].options.onComplete({ code: 0, text: "REVOKED_REPLY" });
  await f.host.store.queue;
  assert.equal(
    (await f.request("GET", "/api/state")).messages.some((m) =>
      m.content.includes("REVOKED_REPLY"),
    ),
    false,
  );
});
test("active questions and ordinary notifications route to origin while PC approval remains available", () => {
  const state = {
    devices: [
      { id: "phone", platform: "android" },
      { id: "tablet", platform: "android" },
    ],
    projectWorkflows: [
      {
        id: "w",
        requestedBy: "phone",
        status: "awaiting_answers",
        questions: [{ id: "q" }],
      },
    ],
    projectIntakes: [
      {
        id: "i",
        requestedBy: "phone",
        status: "awaiting_answers",
        questions: [{ id: "q" }],
      },
    ],
    projectDeliveries: [
      {
        id: "d",
        requestedBy: "phone",
        status: "awaiting_answers",
        questions: [{ id: "q" }],
      },
    ],
    approvals: [
      {
        id: "a",
        requestedBy: "phone",
        status: "pending",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    ],
  };
  assert.equal(publicAttention(state, ONE).items.length, 4);
  assert.equal(publicAttention(state, TWO).items.length, 0);
  assert.deepEqual(
    publicAttention(state, OWNER).items.map((i) => i.kind),
    ["approval"],
  );
});
test("multi-target alarm scheduling status and due acknowledgements remain independent", async (t) => {
  const f = await fixture(t);
  const result = await f.request("POST", "/api/chat", {
    message: "set an alarm for 7am on Phone and Tablet",
    routing: "auto",
    timeZone: "UTC",
  });
  assert.equal(result.outcome.type, "routine_created");
  const routine = f.host.store.state.routineBoard.routines[0];
  assert.deepEqual(routine.targetDeviceIds, ["phone", "tablet"]);
  for (const principal of [ONE, TWO]) {
    const projected = (await f.request("GET", "/api/routines", {}, principal))
      .routines[0];
    assert.equal(projected.targetDeviceId, principal.id);
    await f.request(
      "POST",
      `/api/routines/${routine.id}/device-status`,
      {
        status: "scheduled",
        detail: principal.id,
        expectedUpdatedAt: routine.updatedAt,
      },
      principal,
    );
  }
  assert.equal(Object.keys(routine.deviceSchedules).length, 2);
  f.host.boards.clock = () => new Date("2026-10-03T07:01:00Z");
  await f.host.boards.tick();
  const a = (await f.request("GET", "/api/routines")).occurrences[0],
    b = (await f.request("GET", "/api/routines", {}, TWO)).occurrences[0];
  assert.ok(a && b);
  assert.notEqual(a.id, b.id);
  await f.request(
    "POST",
    `/api/routines/occurrences/${encodeURIComponent(a.id)}/ack`,
  );
  assert.equal(
    (await f.request("GET", "/api/routines", {}, TWO)).occurrences[0].status,
    "pending",
  );
  await assert.rejects(
    f.request(
      "POST",
      `/api/routines/occurrences/${encodeURIComponent(b.id)}/ack`,
    ),
    { status: 403 },
  );
  const oldUpdatedAt = routine.updatedAt;
  await f.request("PATCH", `/api/routines/${routine.id}`, { time: "08:00" });
  await assert.rejects(
    f.request(
      "POST",
      `/api/routines/${routine.id}/device-status`,
      { status: "scheduled", expectedUpdatedAt: oldUpdatedAt },
      TWO,
    ),
    { status: 409 },
  );
  await f.request("DELETE", "/api/devices/phone", {}, OWNER);
  assert.equal(
    (await f.request("GET", "/api/routines", {}, TWO)).routines.length,
    0,
  );
});
test("model cannot replace originating phone or silently choose a desktop request target", async (t) => {
  const f = await fixture(t),
    answer =
      "```nakama-actions\n" +
      JSON.stringify({
        summary: "Open",
        actions: [
          {
            type: "phone_action",
            deviceId: "tablet",
            action: "open_app",
            args: { packageName: "com.google.android.youtube" },
          },
        ],
      }) +
      "\n```";
  await assert.rejects(
    executeActionPlan(f.host, parseActionPlan(answer, "open YouTube"), ONE),
    { status: 403 },
  );
  await assert.rejects(
    executeActionPlan(f.host, parseActionPlan(answer, "open YouTube"), OWNER),
    { status: 403 },
  );
  assert.equal(f.host.store.state.actions.length, 0);
});

test("explicit connection/browser/monitor handoffs notify only the selected recipient", async (t) => {
  const f = await fixture(t);
  await f.request(
    "PATCH",
    "/api/devices/tablet",
    { browserControl: true },
    OWNER,
  );
  const handoff = await f.host.connectionHandoffs.request(
    { provider: "github", deviceId: "tablet", accountLabel: "Fixture" },
    OWNER,
  );
  const requests = f.host.connectionHandoffs.public(TWO);
  assert.equal(requests[0].deliveryDeviceId, "tablet");
  const browser = {
    sessions: [{ id: "b", status: "attention", deliveryDeviceId: "tablet" }],
  };
  const monitoring = {
    monitors: [
      {
        id: "m",
        status: "attention",
        attentionId: "a",
        requestedBy: "phone",
        sharedDeviceIds: ["tablet"],
      },
    ],
  };
  const items = publicAttention(
    f.host.store.state,
    TWO,
    browser,
    requests,
    monitoring,
  ).items;
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.deliveryDeviceId === "tablet"));
  assert.equal(
    publicAttention(
      f.host.store.state,
      OWNER,
      browser,
      f.host.connectionHandoffs.public(OWNER),
      monitoring,
    ).items.length,
    0,
  );
  await f.request("DELETE", "/api/devices/tablet", {}, OWNER);
  assert.equal(f.host.connectionHandoffs.public(TWO).length, 0);
});

test("Android command envelope is idempotent across simultaneous retries and rejects changed meaning", async (t) => {
  const f = await fixture(t);
  const body = {
    command: "timer",
    targetDeviceId: "tablet",
    targetDeviceName: "Tablet",
    requestId: "fixture-command",
    inputMode: "voice",
    args: { durationSeconds: 60, title: "Tea", requestId: "fixture-command" },
  };
  const replies = await Promise.all([
    f.request("POST", "/api/device/commands", body),
    f.request("POST", "/api/device/commands", body),
  ]);
  assert.equal(replies[0].id, replies[1].id);
  assert.equal(f.host.store.state.actions.length, 1);
  const repeated = await f.request("POST", "/api/device/commands", body);
  assert.equal(repeated.id, replies[0].id);
  assert.equal(repeated.repeated, true);
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...body,
      args: { ...body.args, durationSeconds: 90 },
    }),
    { status: 409 },
  );
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...body,
      targetDeviceId: "phone",
      targetDeviceName: "Phone",
    }),
    { status: 409 },
  );
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...body,
      inputMode: "broadcast",
    }),
    { status: 400 },
  );
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...body,
      requestId: "different",
    }),
    { status: 400 },
  );
  assert.equal(f.host.store.state.actions.length, 1);
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...body,
      targetDeviceId: "desktop",
      targetDeviceName: "PC",
    }),
    { status: 409 },
  );
  const pcBody = {
    ...body,
    requestId: "pc-original",
    targetDeviceId: "desktop",
    targetDeviceName: "PC",
    args: { ...body.args, requestId: "pc-original" },
  };
  await f.request("POST", "/api/device/commands", pcBody);
  await assert.rejects(
    f.request("POST", "/api/device/commands", {
      ...pcBody,
      targetDeviceId: "tablet",
      targetDeviceName: "Tablet",
    }),
    { status: 409 },
  );
});
test("revocation while target command waits for durable queue prevents any target action", async (t) => {
  const f = await fixture(t);
  let release;
  const barrier = f.host.store.change(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  await until(() => release);
  const pending = f.request("POST", "/api/device/commands", {
    command: "open_app",
    targetDeviceName: "Tablet",
    requestId: "blocked-target",
    args: { appName: "Netflix" },
  });
  // Permission changes can occur before this queued mutation owns the store.
  f.host.store.state.devices.find(
    (d) => d.id === "tablet",
  ).permissions.projectAccess = false;
  release();
  await barrier;
  await assert.rejects(pending, { status: 403 });
  assert.equal(f.host.store.state.actions.length, 0);
});
test("offline explicit alarm targets remain pending schedules and PC reminder edits retain the PC", async (t) => {
  const f = await fixture(t);
  await f.host.store.change((s) => {
    s.devices[1].lastSeen = new Date(0).toISOString();
  });
  const schedule = {
    title: "Fixture alarm",
    details: "",
    kind: "alarm",
    time: "07:00",
    timeZone: "UTC",
    weekdays: [1],
    enabled: true,
    targetDeviceIds: ["tablet"],
  };
  const alarm = await f.request("POST", "/api/routines", schedule);
  assert.deepEqual(alarm.targetDeviceIds, ["tablet"]);
  assert.equal(alarm.deviceSchedule, undefined);
  const reminder = await f.request(
    "POST",
    "/api/routines",
    { ...schedule, kind: "reminder", targetDeviceIds: [] },
    OWNER,
  );
  assert.deepEqual(reminder.targetDeviceIds, ["desktop"]);
  const edited = await f.request(
    "PATCH",
    `/api/routines/${reminder.id}`,
    { title: "Edited", targetDeviceIds: ["desktop"] },
    OWNER,
  );
  assert.deepEqual(edited.targetDeviceIds, ["desktop"]);
  assert.equal(
    (await f.request("GET", "/api/routines", {}, TWO)).routines.some(
      (r) => r.id === reminder.id,
    ),
    false,
  );
});

test("phone pending-approval state stays with requester and repeated cancelled PC timer is never reported started", async (t) => {
  const f = await fixture(t);
  await f.request(
    "PATCH",
    "/api/settings",
    { confirmOrdinaryActions: true },
    OWNER,
  );
  const approval = await f.request("POST", "/api/device/commands", {
    command: "open_app",
    targetDeviceName: "Tablet",
    args: { appName: "Netflix" },
  });
  assert.equal(
    (await f.request("GET", "/api/state")).approvals[0].deliveryDeviceId,
    "phone",
  );
  assert.equal(
    (await f.request("GET", "/api/state", {}, TWO)).approvals.length,
    0,
  );
  assert.ok(
    (await f.request("GET", "/api/state", {}, OWNER)).approvals.some(
      (a) => a.id === approval.id,
    ),
  );
  const body = {
    message: "set a 10 minute timer on PC",
    routing: "auto",
    requestId: "cancelled-pc-retry",
  };
  await f.request("POST", "/api/chat", body);
  const timer = f.host.store.state.clock.timers[0];
  await f.request("POST", `/api/clock/timers/${timer.id}/cancel`, {
    revision: timer.revision,
  });
  const retry = await f.request("POST", "/api/chat", body);
  assert.match(retry.reply, /already cancelled/);
  assert.doesNotMatch(retry.reply, /Started/);
});
