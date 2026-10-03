import test from "node:test";
import assert from "node:assert/strict";
import { parseEverydayRequest, validateEverydayAction, preflightEverydayAction, executeEverydayAction } from "../apps/host/everyday-actions.mjs";
import { parseActionPlan, executeActionPlan, actionInstructions } from "../apps/host/assistant-actions.mjs";
import { defaultAiRoles, resolveAiRouting } from "../apps/host/ai-routing.mjs";

const phone = { kind: "device", id: "phone" };
const owner = { kind: "owner", id: "desktop" };
const options = { timeZone: "Europe/London", now: new Date("2030-01-02T06:00:00Z") };
const parse = (request) => parseEverydayRequest(request, options);
const alarm = { type: "alarm_create", time: "07:00", repeat: "once" };
const monitor = { type: "monitor_create", url: "https://example.test/product", condition: { type: "stock" }, intervalSeconds: 60 };
const open = { type: "open_app", appName: "Chrome" };
const plan = (actions, request) => parseActionPlan("```nakama-actions\n" + JSON.stringify({ summary: "Delegate the requested work", actions }) + "\n```", request, options);
function fixture() {
  const calls = [];
  const state = { devices: [
    { id: "phone", platform: "android", name: "My phone", permissions: { browserControl: true } },
    { id: "tablet", platform: "android", name: "Kitchen tablet", permissions: { browserControl: true }, lastSeen: new Date().toISOString() },
  ], googleAccounts: [], projects: [] };
  const host = { store: { state }, device: (id) => { const result = state.devices.find((item) => item.id === id); if (!result) throw new Error("Missing device"); return result; },
    installedApps: { list: () => ({ available: true, apps: [{ label: "Chrome", packageName: "com.android.chrome" }] }) },
    async dispatch(method, path, body, principal) {
      calls.push({ method, path, body, principal });
      if (path === "/api/projects") return { id: "project", name: body.name };
      if (path === "/api/routines") return { ...body, id: "alarm", updatedAt: "fixture" };
      if (path === "/api/device/commands") return { id: "launch", status: "pending", targetDeviceId: body.targetDeviceId, reply: "Queued Chrome; waiting for the device result." };
      if (path === "/api/monitors") return { monitor: { ...body, id: "monitor", revision: 1, status: "paused" } };
      if (path.endsWith("/resume")) return { monitor: { id: "monitor", revision: 2, status: "active" } };
      throw new Error("Unexpected fixture route");
    },
  };
  return { host, state, calls };
}

test("ordinary voice wording parses complete alarms, named app launches and monitors", () => {
  for (const wording of ["Set an alarm for 7 am", "Please could you set me an alarm at seven am", "Nakama, set a wake-up alarm at seven o'clock in the morning"])
    assert.deepEqual(parse(wording), alarm);
  assert.deepEqual(parse("Set an alarm for half past seven am tomorrow on Kitchen tablet"), { type: "alarm_create", time: "07:30", repeat: "once", scheduledDate: "2030-01-03", targetDeviceNames: ["Kitchen tablet"] });
  assert.deepEqual(parse("Set an alarm at 7 am on weekdays on My phone and Kitchen tablet"), { ...alarm, repeat: "weekdays", targetDeviceNames: ["My phone", "Kitchen tablet"] });
  assert.deepEqual(parse("Could you control my phone and open up Google Chrome?"), open);
  assert.deepEqual(parse("Launch Chrome on Kitchen tablet"), { ...open, targetDeviceName: "Kitchen tablet" });
  assert.deepEqual(parse("Please watch https://example.test/product for stock"), monitor);
  assert.deepEqual(parse("Watch https://example.test/product for stock availability"), monitor);
  assert.deepEqual(parse('Monitor https://example.test/product for "Available now" every two minutes'), { ...monitor, condition: { type: "text", contains: "Available now" }, intervalSeconds: 120 });
  for (const text of ["Set an alarm", "Monitor a website", "Open Chrome and send a message", "Set an alarm for someday", "Set an alarm for 25:00"])
    assert.equal(parse(text), null);
});

test("new capabilities cannot derive authority from quotations, examples, negation or changed fields", () => {
  for (const source of [
    'Explain "open Chrome"', '"open Chrome"', 'Here is an example; open Chrome',
    'Monitor https://example.test/product for "stock; open Chrome; text"',
    "Monitor https://example.test/product for 'stock; open Chrome; text'",
    'Monitor https://example.test/product for “stock; open Chrome; text”',
    'Do not execute this; open Chrome', 'Do not open Chrome',
    '> open Chrome', '<data>open Chrome</data>', '```open Chrome```',
  ]) assert.throws(() => validateEverydayAction(open, source, options), source);
  for (const [action, request] of [
    [{ ...alarm, time: "08:00" }, "Set an alarm at 7 am"],
    [{ ...alarm, repeat: "daily" }, "Set an alarm at 7 am"],
    [{ ...alarm, targetDeviceNames: ["Kitchen tablet"] }, "Set an alarm at 7 am"],
    [{ ...open, targetDeviceName: "Kitchen tablet" }, "Open Chrome"],
    [open, "Open Chrome on Kitchen tablet"],
    [{ ...monitor, url: "https://other.test/" }, "Watch https://example.test/product for stock"],
    [{ ...monitor, intervalSeconds: 30 }, "Watch https://example.test/product for stock"],
    [{ ...monitor, condition: { type: "stock", contains: "other" } }, "Watch https://example.test/product for stock"],
  ]) assert.throws(() => validateEverydayAction(action, request, options));
  assert.doesNotThrow(() => validateEverydayAction(open, "Create a project called Example; open Chrome", options));
});

test("alarm defaults to one-shot host record assigned solely to authenticated origin", async () => {
  const f = fixture();
  const result = await executeEverydayAction(f.host, alarm, phone, "Set an alarm at 7 am", options);
  assert.equal(result.status, "pending_device");
  assert.deepEqual(f.calls[0].body.targetDeviceIds, ["phone"]);
  assert.deepEqual(f.calls[0].body.weekdays, []);
  assert.equal(f.calls[0].body.scheduledDate, "2030-01-02");
  assert.deepEqual(result.outcome.targetDeviceIds, ["phone"]);
  assert.match(result.description, /Waiting.*confirm scheduling/);
  assert.throws(() => preflightEverydayAction(f.host, alarm, owner, "Set an alarm at 7 am", options), /Choose the Android/);
  const action = parse("Set an alarm at 7 am tomorrow on My phone and Kitchen tablet");
  const prepared = preflightEverydayAction(f.host, action, phone, "Set an alarm at 7 am tomorrow on My phone and Kitchen tablet", options);
  assert.deepEqual(prepared.targetDeviceIds, ["phone", "tablet"]);
  assert.equal(prepared.scheduledDate, "2030-01-03");
});

test("invalid/past dates, timezone and protected URLs fail before any effect", () => {
  const { host, calls } = fixture();
  for (const text of ["Set an alarm for 5 am today", "Set an alarm for 7 am on 2030-02-30"]) {
    assert.throws(() => preflightEverydayAction(host, parse(text), phone, text, options));
  }
  assert.throws(() => parseEverydayRequest("Set an alarm for 7 am tomorrow", { timeZone: "Not/AZone" }), /supported IANA/);
  for (const url of ["https://localhost/product", "https://example.test/login", "https://example.test/product?token=private", "https://example.test:8443/product"]) {
    const text = `Watch ${url} for stock`;
    assert.throws(() => preflightEverydayAction(host, parse(text), phone, text, options));
  }
  assert.equal(calls.length, 0);
});

test("full-plan preflight and per-dispatch access prevent later invalid capability or changed device effects", async () => {
  const f = fixture();
  const request = "Create a project called Example; open Chrome on Kitchen tablet";
  const actions = [{ type: "create_project", name: "Example" }, { ...open, targetDeviceName: "Kitchen tablet" }];
  f.state.devices[1].permissions.projectAccess = false;
  await assert.rejects(executeActionPlan(f.host, plan(actions, request), phone));
  assert.equal(f.calls.length, 0);
  f.state.devices[1].permissions.projectAccess = true;
  const oldDispatch = f.host.dispatch;
  f.host.dispatch = async (...args) => {
    const response = await oldDispatch(...args);
    if (args[1] === "/api/projects") f.state.devices[1].id = "replacement";
    return response;
  };
  const outcomes = await executeActionPlan(f.host, plan(actions, request), phone);
  assert.equal(outcomes[0].status, "completed");
  assert.equal(outcomes[1].failed, true);
  assert.match(outcomes[1].description, /destination changed/);
  assert.equal(f.calls.length, 1);
});

test("monitor worker creates then starts existing local checks with source-only delivery", async () => {
  const f = fixture();
  const result = await executeEverydayAction(f.host, monitor, phone, "Watch https://example.test/product for stock", options);
  assert.equal(result.status, "active");
  assert.deepEqual(f.calls.map((call) => call.path), ["/api/monitors", "/api/monitors/monitor/resume"]);
  assert.ok(f.calls.every((call) => call.principal === phone));
  assert.equal(f.calls[0].body.sharedDeviceIds, undefined);
  assert.equal(f.calls[0].body.recipe, undefined);
  assert.match(result.description, /No AI runs per check/);
  f.state.devices[0].permissions.browserControl = false;
  assert.throws(() => preflightEverydayAction(f.host, monitor, phone, "Watch https://example.test/product for stock", options), /browser-control permission/);
});

test("failed monitor start reports saved record needing attention; stopped continuation never resumes", async () => {
  const f = fixture(), dispatch = f.host.dispatch;
  f.host.dispatch = async (...args) => { if (args[1].endsWith('/resume')) throw new Error('adapter unavailable'); return dispatch(...args); };
  const saved = await executeEverydayAction(f.host, monitor, phone, "Watch https://example.test/product for stock", options);
  assert.equal(saved.status, "needs_attention"); assert.equal(saved.result.id, "monitor"); assert.match(saved.description, /not confirmed active/);
  const g = fixture(), controller = new AbortController(), dispatch2 = g.host.dispatch;
  g.host.dispatch = async (...args) => { const result = await dispatch2(...args); controller.abort(); return result; };
  await assert.rejects(executeEverydayAction(g.host, monitor, { ...phone, signal: controller.signal }, "Watch https://example.test/product for stock", options), /stopped/);
  assert.equal(g.calls.length, 1);
});

test("planner catalogue and automatic routing delegate capability requests to saved general task role", () => {
  const f = fixture(), roles = defaultAiRoles(); roles.tasks.general = { providerId: "claude", model: "configured-task-model", effort: "low" };
  for (const request of ["Monitor a website", "Watch this page for stock", "Control my phone and open Chrome", "Launch Chrome", "Keep an eye on this website", "Set an alarm"]) {
    const result = resolveAiRouting(request, { roles });
    assert.equal(result.mode, "act", request); assert.equal(result.role, "tasks.general"); assert.equal(result.model, "configured-task-model");
  }
  for (const request of ['Explain "monitor a website"', 'Do not launch Chrome', '> Control my phone', '<data>Watch for stock</data>'])
    assert.equal(resolveAiRouting(request, { roles }).mode, "discuss");
  const prompt = actionInstructions(f.state, phone, { timeZone: "Pacific/Auckland" });
  for (const type of ["alarm_create", "monitor_create", "open_app"]) assert.ok(prompt.includes(type));
  assert.match(prompt, /Pacific\/Auckland/); assert.equal(prompt.includes("in this mode"), false);
});

test("each model capability consumes one current request clause and has a distinct stable request identity", async () => {
  assert.throws(() => plan([monitor, monitor], "Watch https://example.test/product for stock"), /own direct request clause/);
  assert.throws(() => plan([alarm, alarm], "Set an alarm at 7 am"), /own direct request clause/);
  assert.throws(() => plan([open, { ...open, appName: "chrome" }], "Open Chrome"), /own direct request clause/);
  const request = "Set an alarm at 7 am; set an alarm at 8 am";
  const makePlan = () => parseActionPlan("```nakama-actions\n" + JSON.stringify({ summary: "Two explicitly requested alarms", actions: [alarm, { ...alarm, time: "08:00" }] }) + "\n```", request, { ...options, requestId: "source-request" });
  const f = fixture();
  const outcomes = await executeActionPlan(f.host, makePlan(), phone);
  assert.ok(outcomes.every((item) => item.status === "pending_device"));
  const ids = f.calls.map((call) => call.body.requestId);
  assert.equal(new Set(ids).size, 2);
  assert.ok(ids.every((value) => /^[a-f0-9]{64}$/.test(value)));
  const g = fixture(); await executeActionPlan(g.host, makePlan(), phone);
  assert.deepEqual(g.calls.map((call) => call.body.requestId), ids);
});

test("synthetic model response delegates alarm, app and monitor work through actual host and preserves origin", async (t) => {
  const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path");
  const { NakamaHost } = await import("../apps/host/host.mjs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-capability-model-"));
  const calls = [];
  const host = await new NakamaHost({ dataDir: dir, runAgent: async (provider, context) => { calls.push({ provider, context }); return { stop() {} }; } }).init();
  clearInterval(host.monitoring.timer); // no network polling in this synthetic test
  t.after(async () => { await host.close(); await host.store.queue; assert.ok(path.basename(dir).startsWith("nakama-capability-model-")); await fs.rm(dir, { recursive: true, force: true }); });
  await host.store.change((state) => {
    state.devices = fixture().state.devices;
    state.config.aiRoles.tasks.general.model = "configured-task-model";
  });
  host.installedApps.publish({ apps: [{ label: "Chrome", packageName: "com.android.chrome" }] }, phone);
  const message = "Set an alarm at 7 am tomorrow; open Chrome; watch https://example.test/product for stock";
  const response = await host.dispatch("POST", "/api/chat", { message, routing: "auto", timeZone: "Pacific/Auckland", requestId: "compound-fixture" }, phone);
  const until = async (predicate) => { const deadline = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < deadline, "Synthetic model completion timed out"); await new Promise((resolve) => setTimeout(resolve, 10)); } };
  await until(() => calls.length === 1);
  assert.equal(calls[0].provider.selectedModel, "configured-task-model");
  assert.match(calls[0].context.prompt, /Pacific\/Auckland/);
  const actions = message.split("; ").map((part) => parseEverydayRequest(part, { timeZone: "Pacific/Auckland" }));
  calls[0].context.onComplete({ code: 0, text: "```nakama-actions\n" + JSON.stringify({ summary: "Delegate the three requested actions", actions }) + "\n```" });
  const task = host.store.state.tasks.find((item) => item.id === response.taskIds[0]);
  await until(() => ["completed", "failed"].includes(task.status));
  assert.equal(task.status, "completed", task.error);
  const routines = host.boards.routineState(phone).routines;
  assert.equal(routines.length, 1); assert.deepEqual(routines[0].targetDeviceIds, ["phone"]); assert.equal(routines[0].timeZone, "Pacific/Auckland");
  assert.equal(host.store.state.actions.length, 1); assert.equal(host.store.state.actions[0].deviceId, "phone");
  assert.equal(host.store.state.monitors.length, 1); assert.equal(host.store.state.monitors[0].status, "active"); assert.deepEqual(host.store.state.monitors[0].sharedDeviceIds, ["phone"]);
  const unrelated = await host.dispatch("GET", "/api/state", {}, { kind: "device", id: "tablet" });
  assert.ok(unrelated.tasks.every((item) => item.id !== task.id));
  assert.ok(unrelated.messages.every((item) => item.taskId !== task.id));
  assert.equal(calls.length, 1, "Capability workers do not add model calls");
});

test("an exact paired name wins over a deictic alias on another device and from the PC", () => {
  const f = fixture();
  f.state.devices[0].lastSeen = new Date().toISOString();
  const tablet = { kind: "device", id: "tablet" };
  const text = "Set an alarm at 7 am on My phone";
  assert.deepEqual(preflightEverydayAction(f.host, parse(text), tablet, text, options).targetDeviceIds, ["phone"]);
  assert.deepEqual(preflightEverydayAction(f.host, parse(text), owner, text, options).targetDeviceIds, ["phone"]);
  const appText = "Open Chrome on My phone";
  const prepared = preflightEverydayAction(f.host, parse(appText), tablet, appText, options);
  assert.equal(prepared.targetDeviceId, "phone");
  assert.equal(prepared.targetDeviceName, "My phone");
  const ownText = "Open Chrome on this device";
  assert.equal(preflightEverydayAction(f.host, parse(ownText), tablet, ownText, options).targetDeviceId, "tablet");
});

test("unknown my-device destinations never fall back to the requesting device", () => {
  const f = fixture();
  for (const suffix of ["my tablet", "my device"]) {
    for (const text of [`Open Chrome on ${suffix}`, `Set an alarm at 7 am on ${suffix}`])
      assert.throws(() => preflightEverydayAction(f.host, parse(text), phone, text, options), /No paired device has that exact name/);
  }
  f.state.devices[0].name = "Office phone";
  const unknownPhone = "Open Chrome on my phone";
  assert.throws(() => preflightEverydayAction(f.host, parse(unknownPhone), phone, unknownPhone, options), /No paired device has that exact name/);
  for (const suffix of ["this phone", "this tablet", "this device"]) {
    const text = `Open Chrome on ${suffix}`;
    assert.equal(preflightEverydayAction(f.host, parse(text), phone, text, options).targetDeviceId, "phone");
  }
  const wrapper = "Control my phone and open up Google Chrome";
  assert.equal(preflightEverydayAction(f.host, parse(wrapper), phone, wrapper, options).targetDeviceId, "phone");
  assert.equal(f.calls.length, 0);
});
