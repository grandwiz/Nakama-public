import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import {
  calendarDay,
  latestDueOccurrence,
  nextScheduledDate,
  zonedOccurrence,
} from "../apps/host/personal-boards.mjs";

async function fixture(t) {
  const dir = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "nakama-personal-"),
  );
  let date = new Date("2026-10-01T00:00:00Z"),
    host;
  const calls = [];
  const create = async () =>
    new NakamaHost({
      dataDir: path.join(dir, "state"),
      boardClock: () => date,
      runAgent: async (provider, options) => {
        calls.push({ provider, options });
        return { stop() {} };
      },
    }).init();
  host = await create();
  t.after(async () => {
    await host.close();
    await host.store.queue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    get host() {
      return host;
    },
    calls,
    date: (value) => {
      date = new Date(value);
    },
    get now() {
      return date;
    },
    restart: async () => {
      await host.close();
      await host.store.queue;
      host = await create();
    },
  };
}
async function phone(host, name = "Fixture phone") {
  const { ticket } = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  const value = await host.dispatch("POST", "/api/pair", {
    ticket,
    platform: "android",
    name,
  });
  return { kind: "device", id: value.deviceId, platform: "android" };
}
const routine = (overrides = {}) => ({
  title: "Morning stretch",
  details: "",
  kind: "reminder",
  time: "07:00",
  timeZone: "Europe/London",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  enabled: true,
  targetDeviceId: null,
  ...overrides,
});
const chat = (host, message, principal, extra = {}) =>
  host.dispatch(
    "POST",
    "/api/chat",
    { routing: "auto", message, ...extra },
    principal,
  );

test("manual board cards persist, requests are idempotent, and completion cleanup never changes task history", async (t) => {
  const f = await fixture(t);
  const body = {
    title: "Read a chapter",
    details: "Personal task",
    requestId: "fixture-request-001",
  };
  const first = await f.host.dispatch("POST", "/api/task-board/items", body);
  const second = await f.host.dispatch("POST", "/api/task-board/items", body);
  assert.equal(first.id, second.id);
  assert.equal(f.host.store.state.taskBoard.items.length, 1);
  await assert.rejects(
    f.host.dispatch("POST", "/api/task-board/items", {
      ...body,
      title: "Different",
    }),
    { status: 409 },
  );
  await f.host.dispatch("PATCH", `/api/task-board/items/${first.id}`, {
    completed: true,
  });
  await f.restart();
  assert.equal(f.host.store.state.taskBoard.items[0].completed, true);
  const removed = await f.host.dispatch(
    "POST",
    "/api/task-board/cleanup-completed",
    {},
  );
  assert.equal(removed.removed, 1);
  assert.equal(removed.sourceHistoryPreserved, true);
});

test("all ordinary tasks and managed workflows derive one card each; manual ticking does not finish their source", async (t) => {
  const f = await fixture(t),
    stamp = f.now.toISOString();
  await f.host.store.change((state) => {
    state.tasks.push(
      {
        id: "ordinary",
        title: "Investigate",
        status: "running",
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: "worker",
        title: "Worker step",
        status: "running",
        workflowId: "project-1",
        createdAt: stamp,
        updatedAt: stamp,
      },
    );
    state.projectWorkflows.push({
      id: "project-1",
      message: "Build project",
      status: "running",
      stage: "planning",
      createdAt: stamp,
      updatedAt: stamp,
    });
  });
  const board = await f.host.dispatch("GET", "/api/task-board");
  assert.equal(board.items.length, 2);
  const card = board.items.find((item) => item.sourceKind === "workflow");
  await f.host.dispatch(
    "PATCH",
    `/api/task-board/items/${encodeURIComponent(card.id)}`,
    { completed: true, details: "My own next step" },
  );
  await f.host.store.change((state) => {
    state.projectWorkflows[0].stage = "reviewing";
  });
  assert.equal(f.host.store.state.projectWorkflows[0].status, "running");
  assert.equal(
    f.host.store.state.taskBoard.items.find((item) => item.id === card.id)
      .details,
    "My own next step",
  );
  await f.host.dispatch(
    "DELETE",
    `/api/task-board/items/${encodeURIComponent(card.id)}`,
    {},
  );
  await f.host.store.change(() => {});
  assert.equal(
    f.host.store.state.taskBoard.items.some((item) => item.id === card.id),
    false,
  );
  assert.equal(f.host.store.state.projectWorkflows.length, 1);
  // Dispose the synthetic source without making it an active executable workflow.
  await f.host.store.change((state) => {
    state.projectWorkflows[0].status = "completed";
  });
});

test("daily cleanup runs once per host calendar day and catches up across restart without recreating source cards", async (t) => {
  const f = await fixture(t),
    stamp = f.now.toISOString();
  await f.host.store.change((state) =>
    state.tasks.push({
      id: "finished",
      title: "Completed fixture",
      status: "completed",
      createdAt: stamp,
      updatedAt: stamp,
    }),
  );
  assert.equal(f.host.store.state.taskBoard.items.length, 1);
  await f.host.boards.tick();
  assert.equal(f.host.store.state.taskBoard.items.length, 1);
  f.date("2026-10-04T12:00:00Z");
  await f.restart();
  assert.equal(f.host.store.state.taskBoard.items.length, 0);
  assert.equal(f.host.store.state.tasks.length, 1);
  assert.equal(
    f.host.store.state.taskBoard.lastCleanupDate,
    calendarDay(f.now),
  );
  const count = f.host.store.state.taskBoard.lastCleanupCount;
  await f.host.boards.tick();
  await f.host.store.change(() => {});
  assert.equal(f.host.store.state.taskBoard.lastCleanupCount, count);
  assert.equal(f.host.store.state.taskBoard.items.length, 0);
});

test("routine time zones handle daylight-saving gaps and overlaps deterministically", () => {
  assert.equal(zonedOccurrence("2026-03-29", "01:30", "Europe/London"), null);
  assert.equal(
    zonedOccurrence("2026-10-25", "01:30", "Europe/London"),
    "2026-10-25T00:30:00.000Z",
  );
  assert.equal(
    zonedOccurrence("2026-10-02", "07:00", "Asia/Kolkata"),
    "2026-10-02T01:30:00.000Z",
  );
  const value = {
    ...routine({ time: "01:30" }),
    createdAt: "2026-10-24T00:00:00Z",
    lastScheduledFor: "2026-10-25T00:30:00.000Z",
  };
  assert.equal(
    latestDueOccurrence(value, new Date("2026-10-25T01:45:00Z")),
    null,
  );
});

test("missed routines create at most one receipt per routine and repeated/restart ticks never duplicate them", async (t) => {
  const f = await fixture(t),
    saved = await f.host.dispatch("POST", "/api/routines", routine());
  f.date("2026-10-05T08:00:00Z");
  await Promise.all([f.host.boards.tick(), f.host.boards.tick()]);
  assert.equal(f.host.store.state.routineBoard.occurrences.length, 1);
  assert.equal(
    f.host.store.state.routineBoard.occurrences[0].scheduledFor,
    "2026-10-05T06:00:00.000Z",
  );
  assert.equal(
    f.host.store.state.taskBoard.items.filter(
      (item) => item.sourceKind === "routine",
    ).length,
    1,
  );
  await f.restart();
  assert.equal(f.host.store.state.routineBoard.occurrences.length, 1);
  assert.equal(f.host.store.state.actions.length, 0);
  assert.equal(f.host.store.state.approvals.length, 0);
  assert.equal(f.calls.length, 0);
  const receipt = f.host.store.state.routineBoard.occurrences[0];
  const complete = await chat(f.host, "Complete routine Morning stretch");
  assert.equal(complete.outcome.type, "routine_completed");
  assert.equal(
    f.host.store.state.taskBoard.items.find(
      (item) => item.sourceId === receipt.id,
    ).completed,
    true,
  );
  f.date("2026-10-06T08:00:00Z");
  await f.host.boards.tick();
  assert.equal(f.host.store.state.routineBoard.occurrences.length, 2);
  await f.host.dispatch("PATCH", `/api/routines/${saved.id}`, {
    enabled: false,
  });
  f.date("2026-10-07T08:00:00Z");
  await f.host.boards.tick();
  assert.equal(f.host.store.state.routineBoard.occurrences.length, 2);
});

test("phone routine targeting, status revisions and cleanup respect the intended device", async (t) => {
  const f = await fixture(t),
    a = await phone(f.host, "A"),
    b = await phone(f.host, "B");
  const alarm = await f.host.dispatch(
    "POST",
    "/api/routines",
    routine({ kind: "alarm", targetDeviceId: a.id }),
    a,
  );
  await assert.rejects(
    f.host.dispatch(
      "POST",
      `/api/routines/${alarm.id}/device-status`,
      { status: "scheduled", expectedUpdatedAt: alarm.updatedAt },
      b,
    ),
    { status: 403 },
  );
  await f.host.dispatch(
    "POST",
    `/api/routines/${alarm.id}/device-status`,
    { status: "scheduled", expectedUpdatedAt: alarm.updatedAt },
    a,
  );
  const changed = await f.host.dispatch(
    "PATCH",
    `/api/routines/${alarm.id}`,
    { time: "08:00" },
    a,
  );
  assert.notEqual(changed.updatedAt, alarm.updatedAt);
  assert.equal(changed.deviceSchedule, undefined);
  await assert.rejects(
    f.host.dispatch(
      "POST",
      `/api/routines/${alarm.id}/device-status`,
      { status: "scheduled", expectedUpdatedAt: alarm.updatedAt },
      a,
    ),
    { status: 409 },
  );
  f.date("2026-10-02T10:00:00Z");
  await f.host.boards.tick();
  const occurrence = f.host.store.state.routineBoard.occurrences[0];
  await f.host.dispatch(
    "POST",
    `/api/routines/occurrences/${encodeURIComponent(occurrence.id)}/ack`,
    {},
    a,
  );
  assert.equal(
    (await f.host.dispatch("GET", "/api/task-board", {}, b)).items.length,
    0,
  );
  assert.equal(
    (await f.host.dispatch("POST", "/api/task-board/cleanup-completed", {}, b))
      .removed,
    0,
  );
  assert.equal(f.host.store.state.taskBoard.items.length, 1);
});

test("routine validation rejects invalid time zones, duplicate weekdays and unrelated fields", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { time: "25:00" },
    { timeZone: "Not/AZone" },
    { weekdays: [1, 1] },
    { enabled: "true" },
    { command: "delete" },
    { kind: "alarm" },
  ])
    await assert.rejects(
      f.host.dispatch("POST", "/api/routines", routine(patch)),
      { status: 400 },
    );
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
});

test("routine task completion and reopening update the same due receipt across devices without rescheduling its alarm", async (t) => {
  const f = await fixture(t),
    target = await phone(f.host, "Alarm phone"),
    other = await phone(f.host, "Other phone");
  await f.host.dispatch(
    "POST",
    "/api/routines",
    routine({ kind: "alarm", targetDeviceId: target.id }),
  );
  f.date("2026-10-01T08:00:00Z");
  await f.host.boards.tick();
  const card = f.host.store.state.taskBoard.items.find(
      (item) => item.sourceKind === "routine",
    ),
    receiptId = card.sourceId,
    route = `/api/task-board/items/${encodeURIComponent(card.id)}`,
    unchangedSchedule = structuredClone(f.host.store.state.routineBoard.routines[0]);
  await assert.rejects(
    f.host.dispatch("PATCH", route, { completed: true }, other),
    { status: 403 },
  );
  // Windows completion must clear the phone's Due list as well as the card.
  await f.host.dispatch("PATCH", route, { completed: true });
  const acknowledged = (await f.host.dispatch("GET", "/api/routines", {}, target))
    .occurrences.find((item) => item.id === receiptId);
  assert.equal(acknowledged.status, "acknowledged");
  assert.equal(acknowledged.acknowledgedAt, f.now.toISOString());
  assert.deepEqual(f.host.store.state.routineBoard.routines[0], unchangedSchedule);
  // Reopen is a receipt state change, never another alarm or occurrence.
  await f.host.dispatch("PATCH", route, { completed: false }, target);
  await f.host.boards.tick();
  await f.restart();
  const reopened = f.host.store.state.routineBoard.occurrences[0];
  assert.equal(reopened.id, receiptId);
  assert.equal(reopened.status, "pending");
  assert.equal(reopened.acknowledgedAt, undefined);
  assert.equal(f.host.store.state.routineBoard.occurrences.length, 1);
  assert.equal(f.host.store.state.taskBoard.items[0].completed, false);
  assert.deepEqual(f.host.store.state.routineBoard.routines[0], unchangedSchedule);
  await f.host.dispatch(
    "POST",
    `/api/routines/occurrences/${encodeURIComponent(receiptId)}/ack`,
    {},
    target,
  );
  assert.equal(f.host.store.state.taskBoard.items[0].completed, true);
  assert.equal(f.host.store.state.actions.length, 0);
  assert.equal(f.calls.length, 0);
});

test("normal voice and chat requests execute locally with truthful receipts and no inference", async (t) => {
  const f = await fixture(t),
    p = await phone(f.host);
  const added = await chat(f.host, "Add a task read a chapter", p, {
    requestId: "spoken-task-001",
  });
  assert.equal(added.local, true);
  assert.equal(added.outcome.type, "task_created");
  await chat(f.host, "Rename task read a chapter to finish my book", p);
  assert.match(
    (await chat(f.host, "List my tasks", p)).reply,
    /finish my book/,
  );
  await chat(f.host, "Complete task finish my book", p);
  assert.equal(f.host.store.state.taskBoard.items[0].completed, true);
  await chat(f.host, "Delete task finish my book", p);
  assert.equal(f.host.store.state.taskBoard.items.length, 0);
  const created = await chat(
    f.host,
    "Create routine stretch at 7:30 am on weekdays",
    p,
    { timeZone: "Europe/London" },
  );
  assert.equal(created.outcome.type, "routine_created");
  await chat(f.host, "Change routine stretch to 8 am", p);
  assert.equal(f.host.store.state.routineBoard.routines[0].time, "08:00");
  await chat(f.host, "Pause routine stretch", p);
  assert.equal(f.host.store.state.routineBoard.routines[0].enabled, false);
  await chat(f.host, "Delete routine stretch", p);
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
  const alarm = await chat(f.host, "Set a morning alarm for 7 am", p);
  assert.match(alarm.reply, /Waiting for the selected Android device to confirm scheduling/);
  assert.equal(alarm.outcome.type, "routine_created");
  assert.match(
    (await chat(f.host, "What are you working on", p)).reply,
    /No assistant work/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.host.store.state.tasks.length, 0);
  assert.equal(f.host.store.state.actions.length, 0);
});

test("Core Memory aliases preserve existing notes and explicit personality/routines never become automatic actions", async (t) => {
  const f = await fixture(t),
    p = await phone(f.host);
  await f.host.dispatch("POST", "/api/companion-memory", {
    category: "note",
    text: "Existing note",
  });
  assert.equal(
    (await f.host.dispatch("GET", "/api/core-memory", {}, p)).entries[0].text,
    "Existing note",
  );
  const saved = await chat(
    f.host,
    "Nakama personality: Keep replies playful and practical.",
    p,
  );
  assert.equal(saved.outcome.type, "memory_saved");
  await chat(f.host, "I usually stretch after breakfast", p);
  assert.equal(
    f.host.store.state.companionMemory.entries.at(-1).category,
    "routine",
  );
  assert.equal(f.host.store.state.routineBoard.routines.length, 0);
  assert.match((await chat(f.host, "Read my core memory", p)).reply, /playful/);
  await chat(f.host, "Update memory Existing note to Updated note", p);
  await chat(f.host, "Forget memory Updated note", p);
  await f.host.dispatch("PATCH", "/api/settings", {
    companionLearningEnabled: false,
  });
  const paused = await chat(f.host, "Remember that I like tea", p);
  assert.equal(paused.outcome.type, "memory_not_saved");
  await chat(f.host, "Forget all core memory", p);
  assert.equal(f.host.store.state.companionMemory.entries.length, 0);
  assert.equal(f.calls.length, 0);
});

test("Google/project-disabled phones cannot inspect personal boards, notes or local status results", async (t) => {
  const f = await fixture(t),
    p = await phone(f.host);
  await chat(f.host, "Add task Private card");
  await f.host.dispatch("POST", "/api/routines", routine());
  for (const permission of ["googleAccess", "projectAccess"]) {
    await f.host.dispatch("PATCH", `/api/devices/${p.id}`, {
      [permission]: false,
    });
    for (const route of [
      "/api/task-board",
      "/api/routines",
      "/api/core-memory",
    ])
      await assert.rejects(f.host.dispatch("GET", route, {}, p), {
        status: 403,
      });
    await assert.rejects(chat(f.host, "List my tasks", p), { status: 403 });
    const state = await f.host.dispatch("GET", "/api/state", {}, p);
    assert.deepEqual(state.taskBoard.items, []);
    assert.deepEqual(state.routineBoard.routines, []);
    await f.host.dispatch("PATCH", `/api/devices/${p.id}`, {
      [permission]: true,
    });
  }
});

test("location upload is consented, own-device-only, bounded, stale-safe and revoked by owner or privacy changes", async (t) => {
  const f = await fixture(t),
    a = await phone(f.host, "A"),
    b = await phone(f.host, "B"),
    fix = {
      latitude: 51.5,
      longitude: -0.1,
      accuracy: 12,
      observedAt: new Date().toISOString(),
    };
  await assert.rejects(
    f.host.dispatch("POST", "/api/device/location", fix, a),
    { status: 403 },
  );
  await f.host.dispatch(
    "POST",
    "/api/device/location/consent",
    { enabled: true },
    a,
  );
  await f.host.dispatch("POST", "/api/device/location", fix, a);
  await assert.rejects(
    f.host.dispatch(
      "POST",
      "/api/device/location",
      { ...fix, deviceId: b.id },
      a,
    ),
    { status: 400 },
  );
  await assert.rejects(
    f.host.dispatch(
      "POST",
      "/api/device/location",
      { ...fix, latitude: 200 },
      a,
    ),
    { status: 400 },
  );
  await assert.rejects(
    f.host.dispatch(
      "POST",
      "/api/device/location",
      {
        ...fix,
        observedAt: new Date(Date.parse(fix.observedAt) - 1000).toISOString(),
      },
      a,
    ),
    { status: 409 },
  );
  assert.deepEqual(
    (await f.host.dispatch("GET", "/api/state", {}, b)).deviceLocations,
    [],
  );
  assert.equal(
    (await f.host.dispatch("GET", "/api/state")).deviceLocations[0].lastKnown
      .latitude,
    51.5,
  );
  await f.host.dispatch("DELETE", `/api/device-locations/${a.id}`, {});
  await assert.rejects(
    f.host.dispatch("POST", "/api/device/location", fix, a),
    { status: 403 },
  );
  await f.host.dispatch(
    "POST",
    "/api/device/location/consent",
    { enabled: true },
    a,
  );
  await f.host.dispatch("POST", "/api/device/location", fix, a);
  await f.host.dispatch("PATCH", `/api/devices/${a.id}`, {
    googleAccess: false,
  });
  assert.equal(f.host.store.state.deviceLocations.length, 0);
});

test("location replies stay scoped to their phone and never enter unrelated provider history", async (t) => {
  const f = await fixture(t),
    a = await phone(f.host, "A"),
    b = await phone(f.host, "B");
  await f.host.dispatch(
    "POST",
    "/api/device/location/consent",
    { enabled: true },
    a,
  );
  await f.host.dispatch(
    "POST",
    "/api/device/location",
    {
      latitude: 12.34567,
      longitude: 76.54321,
      accuracy: 5,
      observedAt: new Date().toISOString(),
    },
    a,
  );
  const lookup = await chat(f.host, "Weather here", a);
  assert.equal(lookup.outcome.type, "weather_lookup");
  assert.match(lookup.reply, /no live weather was fetched/);
  assert.equal(f.calls.length, 0);
  const stateB = await f.host.dispatch("GET", "/api/state", {}, b);
  assert.equal(JSON.stringify(stateB.messages).includes("12.34567"), false);
  assert.equal(
    (await f.host.dispatch("GET", "/api/state", {}, a)).messages.some(
      (message) => message.kind === "location_result",
    ),
    true,
  );
  await chat(f.host, "Explain how rainbows form", a);
  for (let index = 0; index < 100 && !f.calls.length; index++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(f.calls[0].options.prompt, /12\.34567|76\.54321/);
});


test("one-shot next dates respect destination time zones and daylight-saving gaps", () => {
  assert.equal(nextScheduledDate("07:00", "Europe/London", new Date("2026-10-02T05:59:00Z")), "2026-10-02");
  assert.equal(nextScheduledDate("07:00", "Europe/London", new Date("2026-10-02T06:00:00Z")), "2026-10-03");
  assert.equal(nextScheduledDate("01:00", "Asia/Tokyo", new Date("2026-10-02T18:00:00Z")), "2026-10-04");
  assert.equal(nextScheduledDate("01:30", "Europe/London", new Date("2026-03-29T00:45:00Z")), "2026-03-30");
  assert.equal(nextScheduledDate("01:30", "Europe/London", new Date("2026-10-25T00:45:00Z")), "2026-10-26");
  for (const [time, zone] of [["24:00", "UTC"], ["7:00", "UTC"], ["07:00", "Not/AZone"], ["07:00", ""]])
    assert.throws(() => nextScheduledDate(time, zone), { status: 400 });
});

test("one-shot dates reject impossible calendars and local times while recurring schedules require weekdays", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { scheduledDate: "2026-02-29" }, { scheduledDate: "2026-04-31" },
    { scheduledDate: "2026-13-01" }, { scheduledDate: "2026-1-01" },
    { scheduledDate: "2026-10-02T07:00:00Z" }, { scheduledDate: "0000-01-01" },
    { scheduledDate: "" }, { scheduledDate: 20261002 },
    { scheduledDate: "2026-03-29", time: "01:30" },
    { scheduledDate: "2026-10-02", weekdays: [1, 1] },
    { scheduledDate: null, weekdays: [] },
    { scheduledDate: "2026-10-02", timeZone: "" },
    { scheduledDate: "2026-10-02", timeZone: false },
  ])
    await assert.rejects(f.host.dispatch("POST", "/api/routines", routine(patch)), { status: 400 });
  const leap = await f.host.dispatch("POST", "/api/routines", routine({ scheduledDate: "2028-02-29", weekdays: [] }));
  assert.equal(leap.scheduledDate, "2028-02-29");
  assert.deepEqual(leap.weekdays, []);
});

test("a dated alarm stays on its origin device, persists and becomes due only once across restart and delayed ticks", async (t) => {
  const f = await fixture(t),
    origin = await phone(f.host, "Alarm origin"),
    other = await phone(f.host, "Other device"),
    body = routine({ kind: "alarm", scheduledDate: "2026-10-02", requestId: "one-shot-request-001" });
  delete body.weekdays;
  const saved = await f.host.dispatch("POST", "/api/routines", body, origin),
    replay = await f.host.dispatch("POST", "/api/routines", body, origin);
  assert.equal(replay.id, saved.id);
  assert.deepEqual(saved.targetDeviceIds, [origin.id]);
  assert.deepEqual(saved.weekdays, []);
  await assert.rejects(f.host.dispatch("POST", "/api/routines", { ...body, scheduledDate: "2026-10-03" }, origin), { status: 409 });
  assert.equal(latestDueOccurrence(saved, new Date("2026-10-02T05:59:00Z")), null);
  await f.restart();
  f.date("2026-10-20T08:00:00Z");
  await Promise.all([f.host.boards.tick(), f.host.boards.tick()]);
  const receipts = f.host.store.state.routineBoard.occurrences;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].scheduledFor, "2026-10-02T06:00:00.000Z");
  assert.equal(receipts[0].targetDeviceId, origin.id);
  assert.equal((await f.host.dispatch("GET", "/api/routines", {}, other)).routines.length, 0);
  assert.equal((await f.host.dispatch("GET", "/api/routines", {}, other)).occurrences.length, 0);
  f.date("2026-11-02T08:00:00Z");
  await f.restart();
  await f.host.boards.tick();
  assert.equal(f.host.store.state.routineBoard.occurrences.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.host.store.state.actions.length, 0);
});

test("editing a dated alarm resets every target receipt and explicit date clearing restores weekday recurrence", async (t) => {
  const f = await fixture(t),
    origin = await phone(f.host, "Alarm origin"),
    other = await phone(f.host, "Other target"),
    saved = await f.host.dispatch("POST", "/api/routines", routine({
      kind: "alarm", scheduledDate: "2026-10-02", weekdays: [],
      targetDeviceId: undefined, targetDeviceIds: [origin.id, other.id],
    }), origin);
  for (const target of [origin, other])
    await f.host.dispatch("POST", `/api/routines/${saved.id}/device-status`, { status: "scheduled", expectedUpdatedAt: saved.updatedAt }, target);
  await assert.rejects(f.host.dispatch("PATCH", `/api/routines/${saved.id}`, { scheduledDate: "2026-10-03" }, other), { status: 403 });
  const renamed = await f.host.dispatch("PATCH", `/api/routines/${saved.id}`, { title: "Still once" }, origin);
  assert.equal(renamed.scheduledDate, "2026-10-02");
  assert.equal(Object.keys(renamed.deviceSchedules).length, 2);
  const changed = await f.host.dispatch("PATCH", `/api/routines/${saved.id}`, { scheduledDate: "2026-10-03" }, origin);
  assert.equal(changed.deviceSchedules, undefined);
  assert.equal(changed.deviceSchedule, undefined);
  assert.equal(changed.scheduleUpdatedAt, changed.updatedAt);
  assert.notEqual(changed.scheduleUpdatedAt, saved.scheduleUpdatedAt);
  for (const target of [origin, other])
    await assert.rejects(f.host.dispatch("POST", `/api/routines/${saved.id}/device-status`, { status: "scheduled", expectedUpdatedAt: saved.updatedAt }, target), { status: 409 });
  await assert.rejects(f.host.dispatch("PATCH", `/api/routines/${saved.id}`, { scheduledDate: null }, origin), { status: 400 });
  const recurring = await f.host.dispatch("PATCH", `/api/routines/${saved.id}`, { scheduledDate: null, weekdays: [1] }, origin);
  assert.equal(recurring.scheduledDate, null);
  assert.deepEqual(recurring.weekdays, [1]);
  assert.equal(latestDueOccurrence(recurring, new Date("2026-10-05T08:00:00Z")), "2026-10-05T06:00:00.000Z");
  await f.host.dispatch("PATCH", `/api/devices/${other.id}`, { projectAccess: false });
  await assert.rejects(f.host.dispatch("PATCH", `/api/routines/${saved.id}`, { scheduledDate: "2026-10-06" }, origin), { status: 403 });
});
