import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../apps/host/store.mjs";
import { Monitoring } from "../apps/host/monitors.mjs";
import { BrowserStudio } from "../apps/host/browser-studio.mjs";
const OWNER = { kind: "owner", id: "desktop" },
  PHONE = { kind: "device", id: "phone" };
const website = {
  title: "Example stock",
  kind: "website",
  url: "https://shop.example/product",
  condition: { type: "stock" },
  sharedDeviceIds: ["phone"],
};
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-monitors-"));
  const store = await new Store(dir).init();
  store.state.devices = ["phone", "other"].map((id) => ({
    id,
    platform: "android",
    permissions: {
      browserControl: true,
      projectAccess: true,
      googleAccess: true,
    },
  }));
  let time = Date.now(),
    outcome = "no_match",
    checkCalls = 0,
    prepareCalls = 0;
  const nativeCalls = [],
    callbacks = new Map();
  const browserAdapter = {
    available: true,
    async create(value) {
      nativeCalls.push(value);
      callbacks.set(value.id, value.onChange);
    },
    async createTab() {},
    async navigate(id, tabId, url) {
      callbacks.get(id)({ tabId, url, loading: false });
    },
    destroy(id) {
      callbacks.delete(id);
    },
    close() {},
    async forgetProfile(id) {
      nativeCalls.push({ forgot: id });
    },
  };
  const host = { store, project() {}, closing: false };
  host.browserStudio = new BrowserStudio(host, {
    adapter: browserAdapter,
    clock: () => time,
    timers: false,
  });
  const adapter = {
    websiteAvailable: true,
    windowsAvailable: true,
    async checkWebsite() {
      checkCalls++;
      return { outcome };
    },
    async prepareCheckout() {
      prepareCalls++;
      return { outcome: "checkout" };
    },
    async checkWindows() {
      return { outcome };
    },
  };
  const monitors = new Monitoring(host, {
    adapter,
    clock: () => time,
    timers: false,
  });
  await monitors.init();
  t.after(async () => {
    monitors.close();
    host.browserStudio.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const row = () => store.state.monitors[0];
  return {
    host,
    store,
    monitors,
    adapter,
    nativeCalls,
    row,
    setOutcome(value) {
      outcome = value;
    },
    calls: () => [checkCalls, prepareCalls],
    advance(ms) {
      time += ms;
    },
    clock: () => time,
    create: async (body = website, principal = OWNER) =>
      (await monitors.create(body, principal)).monitor,
    action: async (action, body = {}, principal = OWNER) =>
      monitors.dispatch(
        "POST",
        `/api/monitors/${row().id}/${action}`,
        { revision: row().revision, ...body },
        principal,
      ),
  };
}

test("monitor creation is paused, zero-model, private and revision checked", async (t) => {
  const f = await fixture(t);
  const created = await f.create();
  assert.equal(created.status, "paused");
  assert.equal(created.intervalSeconds, 60);
  assert.equal(created.profileId, undefined);
  assert.match(f.row().profileId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(f.calls(), [0, 0]);
  await assert.rejects(
    f.monitors.dispatch(
      "POST",
      `/api/monitors/${created.id}/resume`,
      { revision: 999 },
      OWNER,
    ),
    /changed/,
  );
  await assert.rejects(
    f.create({ ...website, intervalSeconds: 1 }),
    /interval/,
  );
  await assert.rejects(
    f.create({ ...website, url: "https://127.0.0.1/" }),
    /public HTTPS/,
  );
  await assert.rejects(
    f.create({ ...website, url: "https://shop.example/product?token=secret" }),
    /credentials/,
  );
  await assert.rejects(
    f.create({
      ...website,
      url: "https://shop.example/product?session_id=secret",
    }),
    /credential/,
  );
  await assert.rejects(
    f.create({ ...website, condition: { type: "script", script: "run()" } }),
    /Unexpected/,
  );
  await assert.rejects(
    f.create({ ...website, sharedDeviceIds: ["other"] }, PHONE),
    /Only Windows/,
  );
  assert.equal(
    f.monitors.list({ kind: "device", id: "other" }).monitors.length,
    0,
  );
});

test("scheduler uses saved deadlines without sleep catch-up, overlaps or stale receipts after Stop", async (t) => {
  const f = await fixture(t);
  await f.create();
  await f.action("resume");
  let release;
  f.adapter.checkWebsite = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const checking = f.monitors.tick();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(f.row().status, "checking");
  await f.monitors.tick();
  await f.action("pause");
  release({ outcome: "match" });
  await checking;
  assert.equal(f.row().status, "paused");
  assert.equal(f.row().lastOutcome, null);
  let calls = 0;
  f.adapter.checkWebsite = async () => {
    calls++;
    return { outcome: "no_match" };
  };
  await f.action("resume");
  f.advance(3600000);
  await f.monitors.tick();
  await f.monitors.tick();
  assert.equal(calls, 1);
  assert.equal(f.row().status, "active");
  assert.equal(Date.parse(f.row().nextCheckAt), f.clock() + 60000);
});

test("meaningful stock change creates one attention, CAPTCHA and queues pause without refresh", async (t) => {
  const f = await fixture(t);
  await f.create();
  await f.action("resume");
  await f.monitors.tick();
  assert.equal(f.row().lastOutcome, "no_match");
  assert.equal(f.row().attentionId, null);
  f.setOutcome("queue");
  f.advance(60000);
  await f.monitors.tick();
  const notice = f.row().attentionId,
    session = f.row().browserSessionId;
  f.advance(3600000);
  await f.monitors.tick();
  assert.equal(f.row().status, "attention");
  assert.equal(f.row().attentionId, notice);
  assert.equal(f.row().browserSessionId, session);
  assert.deepEqual(f.calls(), [2, 0]);
});

test("unavailable sources back off, never become positive, and require attention after repeated failures", async (t) => {
  const f = await fixture(t);
  await f.create();
  f.setOutcome("unavailable");
  await f.action("resume");
  await f.monitors.tick();
  assert.equal(f.row().status, "active");
  assert.equal(Date.parse(f.row().nextCheckAt) - f.clock(), 120000);
  f.advance(120000);
  await f.monitors.tick();
  assert.equal(Date.parse(f.row().nextCheckAt) - f.clock(), 240000);
  f.advance(240000);
  await f.monitors.tick();
  assert.equal(f.row().status, "attention");
  assert.equal(f.row().lastOutcome, "unavailable");
});

test("private setup and fresh selected-device handoff never expose profile identifiers or grant agent access", async (t) => {
  const f = await fixture(t);
  await f.create();
  const opened = await f.action("open", { reason: "setup" });
  assert.equal(opened.outcome.browserSessionId, opened.sessionId);
  const native = f.nativeCalls.find((row) => row.profileId);
  assert.equal(native.profileId, f.row().profileId);
  assert.equal(native.mode, "private");
  await f.action("setup-confirm", { addressConfirmed: true });
  assert.ok(f.row().setupConfirmedAt);
  await assert.rejects(
    f.action("open", {}, { kind: "device", id: "other" }),
    /unavailable/,
  );
  // Windows explicitly releases before a selected phone receives a fresh lease.
  await f.host.browserStudio.dispatch(
    "POST",
    `/api/browser-studio/sessions/${opened.sessionId}/release`,
    {},
    OWNER,
  );
  const phone = await f.action("open", {}, PHONE);
  assert.equal(phone.sessionId, opened.sessionId);
  assert.equal(
    f.host.browserStudio.sessions.get(phone.sessionId).controller.id,
    "phone",
  );
  f.store.state.tasks.push({ id: "task", status: "running" });
  await assert.rejects(
    f.host.browserStudio.agentAction(
      { action: "read", sessionId: phone.sessionId },
      { taskId: "task", principal: OWNER },
    ),
    /private/,
  );
  assert.equal(f.host.browserStudio.reportImages(undefined).length, 0);
  f.row().sharedDeviceIds = [];
  await assert.rejects(
    f.host.browserStudio.dispatch(
      "POST",
      `/api/browser-studio/sessions/${opened.sessionId}/frame`,
      {},
      PHONE,
    ),
    /unavailable/,
  );
  f.row().sharedDeviceIds = ["phone"];
  f.store.state.devices[0].permissions.browserControl = false;
  await assert.rejects(f.action("open", {}, PHONE), /Enable Browser/);
});

const recipe = {
  enabled: true,
  productText: "Fixture product",
  variantField: "id",
  variantValue: "fixture-1",
  priceText: "GBP 12.00",
  maxPrice: 12,
  currency: "GBP",
  cartPath: "/cart/add",
  checkoutPath: "/checkout",
  addLabel: "Add to cart",
  checkoutLabel: "Checkout",
};
async function prepare(f) {
  await f.create();
  const opened = await f.action("open", { reason: "setup" });
  await f.action("setup-confirm", { addressConfirmed: true });
  await f.action("recipe", { recipe, confirmed: true });
  await f.host.browserStudio.dispatch(
    "POST",
    `/api/browser-studio/sessions/${opened.sessionId}/release`,
    {},
    OWNER,
  );
  f.setOutcome("match");
  await f.action("resume");
}
test("checkout persists exact attempt before mutation and never repeats an uncertain submission", async (t) => {
  const f = await fixture(t);
  await prepare(f);
  let attempts = 0;
  f.adapter.prepareCheckout = async () => {
    attempts++;
    const disk = JSON.parse(await fs.readFile(f.store.file));
    assert.equal(disk.monitors[0].attempt.status, "started");
    throw new Error("connection lost");
  };
  await f.monitors.tick();
  assert.equal(f.row().lastOutcome, "uncertain");
  assert.equal(f.row().attempt.status, "uncertain");
  await f.action("resume");
  await f.monitors.tick();
  assert.equal(attempts, 1);
  assert.equal(f.row().lastOutcome, "match");
});

test("receipt save failure cannot start a cart attempt", async (t) => {
  const f = await fixture(t);
  await prepare(f);
  const original = f.store.save.bind(f.store);
  f.store.save = async () => {
    if (f.row()?.attempt?.status === "started") throw new Error("disk full");
    await original();
  };
  await f.monitors.tick();
  assert.equal(f.calls()[1], 0);
  assert.equal(f.row().attempt, undefined);
});

test("recipe approval is PC-only, bounded native endpoint, setup-confirmed and exact revision", async (t) => {
  const f = await fixture(t);
  await f.create();
  await assert.rejects(
    f.action("recipe", { recipe, confirmed: true }),
    /First confirm/,
  );
  await f.action("open", { reason: "setup" });
  await f.action("setup-confirm", { addressConfirmed: true });
  await assert.rejects(
    f.action("recipe", { recipe, confirmed: true }, PHONE),
    /Windows/,
  );
  await assert.rejects(
    f.action("recipe", {
      recipe: { ...recipe, cartPath: "/buy" },
      confirmed: true,
    }),
    /native/,
  );
  await assert.rejects(
    f.action("recipe", {
      recipe: { ...recipe, addLabel: "Pay now" },
      confirmed: true,
    }),
    /Payment/,
  );
  await f.action("recipe", {
    recipe: { ...recipe, maxPrice: 19.99 },
    confirmed: true,
  });
  assert.equal(f.row().recipe.maxPrice, 19.99);
  await assert.rejects(
    f.action("recipe", {
      recipe: { ...recipe, currency: "JPY" },
      confirmed: true,
    }),
    /minor units/,
  );
  f.host.remoteDesktop = {
    assertOwnerApprovalAllowed() {
      throw new Error("Remote control cannot approve");
    },
  };
  await assert.rejects(
    f.action("recipe", { recipe, confirmed: true }),
    /Remote control/,
  );
  assert.equal(f.row().recipe.maxPrice, 19.99);
});

test("restart and expiry preserve preferences but prevent automatic checks and cart replay", async (t) => {
  const f = await fixture(t);
  await f.create();
  await f.action("resume");
  f.row().attempt = { id: "attempt", status: "started" };
  await f.monitors.init();
  assert.equal(f.row().status, "paused");
  assert.equal(f.row().attempt.status, "uncertain");
  assert.equal(f.row().intervalSeconds, 60);
  await f.action("resume");
  f.advance(31 * 86400000);
  await f.monitors.tick();
  assert.equal(f.row().status, "expired");
  assert.deepEqual(f.calls(), [0, 0]);
  await assert.rejects(f.action("resume"), /expired/);
});

test("Android observer needs exact device fresh local consent and returns only typed outcomes", async (t) => {
  const f = await fixture(t);
  await f.create({
    title: "Local app",
    kind: "android_app",
    deviceId: "phone",
    packageName: "com.example.reader",
    condition: { contains: "Ready", excludes: "Not ready" },
  });
  await f.action("resume");
  await assert.rejects(
    f.action("observe-consent", { packageName: "com.example.reader" }),
    /selected Android/,
  );
  const { consentId } = await f.action(
    "observe-consent",
    { packageName: "com.example.reader" },
    PHONE,
  );
  await assert.rejects(
    f.action(
      "observation",
      {
        consentId,
        packageName: "com.example.reader",
        observedAt: new Date(f.clock()).toISOString(),
        outcome: "match",
        text: "private",
      },
      PHONE,
    ),
    /Unexpected/,
  );
  await assert.rejects(
    f.action(
      "observation",
      {
        consentId,
        packageName: "com.other.reader",
        observedAt: new Date(f.clock()).toISOString(),
        outcome: "match",
      },
      PHONE,
    ),
    /consent/,
  );
  await f.action(
    "observation",
    {
      consentId,
      packageName: "com.example.reader",
      observedAt: new Date(f.clock()).toISOString(),
      outcome: "no_match",
    },
    PHONE,
  );
  f.advance(60000);
  await f.action(
    "observation",
    {
      consentId,
      packageName: "com.example.reader",
      observedAt: new Date(f.clock()).toISOString(),
      outcome: "match",
    },
    PHONE,
  );
  assert.equal(f.row().status, "attention");
  assert.equal(f.row().lastOutcome, "match");
  await assert.rejects(
    f.action(
      "observation",
      {
        consentId,
        packageName: "com.example.reader",
        observedAt: new Date(f.clock()).toISOString(),
        outcome: "match",
      },
      PHONE,
    ),
    /consent/,
  );
});

test("forget clears only the dedicated profile and requires new private setup", async (t) => {
  const f = await fixture(t);
  await f.create();
  await f.action("open", { reason: "setup" });
  const oldProfile = f.row().profileId;
  await f.action("setup-confirm", { addressConfirmed: true });
  await f.action("forget-profile");
  assert.equal(f.row().status, "paused");
  assert.notEqual(f.row().profileId, oldProfile);
  assert.equal(f.row().setupConfirmedAt, null);
  assert.ok(f.nativeCalls.some((row) => row.forgot === oldProfile));
  assert.equal(f.host.browserStudio.sessions.size, 0);
});

test("maintenance lock blocks checks and private browser writes", async (t) => {
  const f = await fixture(t);
  await f.create();
  await f.action("resume");
  f.host.maintenanceLock = true;
  await f.monitors.tick();
  assert.deepEqual(f.calls(), [0, 0]);
  await assert.rejects(f.action("open"), /maintenance/);
  await assert.rejects(
    f.host.browserStudio.create({ mode: "private" }, OWNER),
    /closing/,
  );
});

test("human takeover cannot re-enable merchant JavaScript during a native cart operation", async (t) => {
  const f = await fixture(t);
  await f.create();
  await f.action("resume");
  let release;
  f.adapter.checkWebsite = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = f.monitors.tick();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  const session = [...f.host.browserStudio.sessions.values()][0];
  await assert.rejects(
    f.host.browserStudio.dispatch(
      "POST",
      `/api/browser-studio/sessions/${session.id}/takeover`,
      {},
      OWNER,
    ),
    /bounded monitor/,
  );
  await assert.rejects(
    f.host.browserStudio.dispatch(
      "POST",
      `/api/browser-studio/sessions/${session.id}/handoff`,
      { deviceId: "phone" },
      OWNER,
    ),
    /bounded monitor/,
  );
  assert.equal(session.controller, null);
  release({ outcome: "no_match" });
  await pending;
});

test("Windows can add current private sharing after chat creation and revocation ends phone visibility", async (t) => {
  const f = await fixture(t);
  await f.create({ ...website, sharedDeviceIds: [] });
  assert.equal(f.monitors.list(PHONE).monitors.length, 0);
  await f.action("sharing", { sharedDeviceIds: ["phone"] });
  const opened = await f.action("open", {}, PHONE);
  assert.equal(
    f.host.browserStudio.sessions.get(opened.sessionId).controller.id,
    "phone",
  );
  await assert.rejects(
    f.action("sharing", { sharedDeviceIds: ["other"] }, PHONE),
    /Windows/,
  );
  await f.action("sharing", { sharedDeviceIds: [] });
  assert.equal(f.monitors.list(PHONE).monitors.length, 0);
  assert.equal(
    f.host.browserStudio.sessions.get(opened.sessionId).controller,
    null,
  );
  await assert.rejects(
    f.host.browserStudio.dispatch(
      "POST",
      `/api/browser-studio/sessions/${opened.sessionId}/takeover`,
      {},
      PHONE,
    ),
    /unavailable/,
  );
});

test("late private capture is withheld while sharing revocation is awaiting disk save", async (t) => {
  const f = await fixture(t);
  await f.create();
  const opened = await f.action("open", {}, PHONE);
  const studio = f.host.browserStudio;
  const session = studio.sessions.get(opened.sessionId);
  let finishCapture, finishSave;
  const captureStarted = new Promise((resolve) => {
    studio.adapter.capture = async () => {
      resolve();
      return new Promise((done) => {
        finishCapture = done;
      });
    };
  });
  const captured = studio.dispatch(
    "POST",
    `/api/browser-studio/sessions/${session.id}/frame`,
    {},
    PHONE,
  );
  await captureStarted;
  const originalSave = f.store.save.bind(f.store);
  const saveStarted = new Promise((resolve) => {
    f.store.save = async () => {
      resolve();
      await new Promise((done) => {
        finishSave = done;
      });
      return originalSave();
    };
  });
  const revoked = f.action("sharing", { sharedDeviceIds: [] });
  await saveStarted;
  try {
    assert.deepEqual(f.row().sharedDeviceIds, []);
    assert.equal(
      session.controller.id,
      "phone",
      "The save has not emitted changed/expired the lease yet",
    );
    const until = session.controllerUntil;
    finishCapture({
      jpeg: Buffer.from([255, 216, 255, 217]),
      width: 1280,
      height: 800,
      revision: 1,
    });
    await assert.rejects(captured, /permission was revoked/);
    assert.equal(session.frame, null);
    assert.equal(session.hasFrame, false);
    assert.equal(
      session.controllerUntil,
      until,
      "Revoked access cannot extend the old controller lease",
    );
  } finally {
    finishSave();
    await revoked;
    f.store.save = originalSave;
  }
  assert.equal(session.controller, null);
});
