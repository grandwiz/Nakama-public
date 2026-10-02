import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const source = await fs.readFile(
  new URL("../apps/chrome-extension/worker.js", import.meta.url),
  "utf8",
);
const origin = "https://example.test";
const action = (id = "action-1", extra = {}) => ({
  id,
  type: "browser_click",
  args: { tabId: 1, selector: "#normal" },
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  ...extra,
});
function mockWorker({
  actions = [action()],
  local = {},
  session = {},
  fetchOverride,
  executeOverride,
  captureOverride,
  canvasOverride,
  bitmapOverride,
} = {}) {
  const localState = { pairing: { token: "private-device-token" }, ...local },
    sessionState = {
      browserSession: { id: "session-1", controlEpoch: "", pairingToken: "private-device-token", expiresAt: Date.now() + 7200000 },
      ...session,
    };
  const invocations = [],
    acks = [],
    requests = [],
    captures = [],
    encodes = [],
    listeners = {};
  let storageWrites = 0;
  const area = (state) => ({
    async get(keys) {
      if (Array.isArray(keys))
        return Object.fromEntries(
          keys.map((k) => [k, structuredClone(state[k])]),
        );
      return { [keys]: structuredClone(state[keys]) };
    },
    async set(values) {
      storageWrites++;
      Object.assign(state, structuredClone(values));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
    },
  });
  const hook = (name) => ({
    addListener: (fn) => {
      (listeners[name] ??= new Set()).add(fn);
    },
    removeListener: (fn) => listeners[name]?.delete(fn),
  });
  const emit = (name, ...args) => {
    for (const fn of listeners[name] || []) fn(...args);
  };
  const tabs = [
    {
      id: 1,
      url: `${origin}/page`,
      title: "Permitted page",
      active: true,
      windowId: 1,
      status: "complete",
    },
  ];
  const windows = [{ id: 1, focused: true, type: "normal", state: "normal" }];
  const chrome = {
    permissions: { contains: async () => true, onRemoved: hook("permissionsRemoved") },
    storage: {
      local: area(localState),
      session: area(sessionState),
      onChanged: hook("storageChanged"),
    },
    tabs: {
      query: async (query = {}) =>
        structuredClone(
          tabs.filter(
            (tab) =>
              (query.active === undefined || tab.active === query.active) &&
              (query.windowId === undefined || tab.windowId === query.windowId),
          ),
        ),
      get: async (id) => structuredClone(tabs.find((t) => t.id === id)),
      update: async (id, options) => {
        invocations.push({ type: "navigate", id, options });
      },
      onRemoved: hook("removed"),
      onActivated: hook("activated"),
      onUpdated: hook("updated"),
      onDetached: hook("detached"),
      onReplaced: hook("replaced"),
      captureVisibleTab: async (id, options) => {
        captures.push({ id, options });
        return captureOverride
          ? captureOverride(id, options)
          : "data:image/jpeg;base64,/9j/2Q==";
      },
    },
    windows: {
      get: async (id) => structuredClone(windows.find((w) => w.id === id)),
      onFocusChanged: hook("focusChanged"),
    },
    scripting: {
      executeScript: async (options) => {
        invocations.push(options);
        return executeOverride
          ? executeOverride(options)
          : options.func.name === "screenshotGuard"
            ? [{ frameId: 0, documentId: "document-1", result: { safe: true } }]
            : [{ result: { status: "started", message: "Clicked once." } }];
      },
    },
    runtime: {
      id: "nakama-extension",
      onInstalled: hook("installed"),
      onStartup: hook("startup"),
      onMessage: hook("message"),
    },
    alarms: { create: async () => {}, onAlarm: hook("alarm") },
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (fetchOverride) {
      const result = await fetchOverride(url, options);
      if (result) return result;
    }
    if (url.endsWith("/api/device/actions")) return Response.json({ actions });
    const result = JSON.parse(options.body);
    acks.push(result);
    return Response.json({ saved: true });
  };
  const context = vm.createContext({
    chrome,
    fetch: fetchImpl,
    AbortSignal,
    URL,
    Date,
    Response,
    console,
    Blob,
    Uint8Array,
    TextEncoder,
    atob,
    btoa,
    crypto,
    setTimeout,
    clearTimeout,
    createImageBitmap:
      bitmapOverride ||
      (async () => ({ width: 1920, height: 1080, close() {} })),
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob(options) {
        encodes.push({ width: this.width, height: this.height, options });
        return canvasOverride
          ? canvasOverride(this, options)
          : new Blob([new Uint8Array(1024)], { type: "image/jpeg" });
      }
    },
  });
  vm.runInContext(source.replace(/^export /gm, ""), context, {
    filename: "worker.js",
  });
  return {
    context,
    chrome,
    localState,
    sessionState,
    tabs,
    windows,
    invocations,
    captures,
    encodes,
    acks,
    requests,
    listeners,
    emit,
    get storageWrites() {
      return storageWrites;
    },
  };
}

test("dropdown actions require a positive safe integer tab ID before injection", async () => {
  const f = mockWorker();
  for (const tabId of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1, null]) {
    const result = await f.context.execute(
      action("select", {
        type: "browser_select",
        args: { tabId, selector: "#theme", value: "" },
      }),
    );
    assert.equal(result.status, "blocked");
  }
  assert.equal(f.invocations.length, 0);
});

test("dropdown redelivery preserves exact empty and whitespace values without repeating selection", async () => {
  for (const value of ["", " dark "]) {
    const f = mockWorker({
      actions: [
        action("select", {
          type: "browser_select",
          args: { tabId: 1, selector: "#theme", value },
        }),
      ],
      executeOverride: async (options) => {
        assert.equal(options.args[0], "browser_select");
        assert.equal(options.args[1].value, value);
        return [
          {
            result: {
              status: "completed",
              message: "Selection visible; verify the page.",
              data: { value, changed: true },
            },
          },
        ];
      },
    });
    await f.context.poll();
    await f.context.poll();
    assert.equal(f.invocations.length, 1);
    assert.equal(f.acks.length, 2);
    assert.deepEqual(f.acks[0], f.acks[1]);
    assert.equal(f.acks[1].data.value, value);
  }
});

test("extension performs a redelivered action once and repeats its identical acknowledgement", async () => {
  const f = mockWorker();
  await f.context.poll();
  await f.context.poll();
  assert.equal(f.invocations.length, 1);
  assert.equal(f.acks.length, 2);
  assert.deepEqual(f.acks[0], f.acks[1]);
  assert.equal(f.localState.receipts["action-1"].result.status, "started");
});

test("failed acknowledgement retains result and retries acknowledgement without repeating a click", async () => {
  let failures = 1;
  const f = mockWorker({
    fetchOverride: (url) => {
      if (url.endsWith("/result") && failures-- > 0)
        throw new Error("Connection lost after delivery.");
    },
  });
  await f.context.poll();
  assert.equal(f.invocations.length, 1);
  assert.equal(f.acks.length, 0);
  await f.context.poll();
  assert.equal(f.invocations.length, 1);
  assert.equal(f.acks.length, 1);
});

test("durable started receipt after worker interruption prevents execution", async () => {
  const f = mockWorker({
    local: {
      receipts: {
        "action-1": { startedAt: Date.now(), expiresAt: Date.now() + 300000 },
      },
    },
  });
  await f.context.poll();
  assert.equal(f.invocations.length, 0);
  assert.equal(f.acks[0].status, "interrupted");
});

test("queue receipt history does not evict executable actions after 200 entries", async () => {
  const receipts = Object.fromEntries(
    Array.from({ length: 220 }, (_, i) => [
      `old-${i}`,
      {
        startedAt: Date.now(),
        expiresAt: Date.now() + 300000,
        result: { status: "completed", message: "Already done." },
      },
    ]),
  );
  const f = mockWorker({ local: { receipts } });
  await f.context.poll();
  assert.equal(Object.keys(f.localState.receipts).length, 221);
  assert.ok(f.localState.receipts["old-0"]);
});

test("expired actions never run, old expired receipts can be reclaimed, and missing expiry is blocked", async () => {
  const f = mockWorker({
    actions: [
      action("expired", { expiresAt: "2020-01-01" }),
      action("missing", { expiresAt: undefined }),
    ],
    local: {
      receipts: { ancient: { expiresAt: 1, result: { status: "completed" } } },
    },
  });
  await f.context.poll();
  assert.equal(f.invocations.length, 0);
  assert.equal(f.acks.length, 2);
  assert.ok(f.acks.every((r) => r.status === "blocked"));
  assert.equal(f.localState.receipts.ancient, undefined);
});

test("idle paired polling prunes expired receipts while preserving executable results and acknowledgement grace", async () => {
  const now = Date.now();
  const f = mockWorker({
    actions: [],
    local: {
      receipts: {
        expired: {
          expiresAt: now - 61000,
          result: { data: { dataUrl: "expired-image" } },
        },
        grace: {
          expiresAt: now - 30000,
          result: { status: "completed", data: { dataUrl: "retry-image" } },
        },
        executable: { expiresAt: now + 300000, startedAt: now },
        unknown: { startedAt: now },
      },
    },
  });
  await Promise.all([f.context.poll(), f.context.poll(), f.context.poll()]);
  assert.deepEqual(Object.keys(f.localState.receipts).sort(), [
    "executable",
    "grace",
    "unknown",
  ]);
  assert.equal(f.localState.receipts.grace.result.data.dataUrl, "retry-image");
  assert.equal(f.requests.length, 1);
  assert.equal(f.invocations.length, 0);
  const writes = f.storageWrites;
  await f.context.poll();
  assert.equal(
    f.storageWrites,
    writes,
    "An unchanged idle history should not be rewritten.",
  );
});

test("unpaired polling still removes expired receipt images without contacting the host", async () => {
  const now = Date.now();
  const f = mockWorker({
    actions: [],
    local: {
      pairing: undefined,
      receipts: {
        expired: {
          expiresAt: now - 61000,
          result: { data: { dataUrl: "expired-image" } },
        },
        grace: { expiresAt: now - 30000, result: { status: "completed" } },
      },
    },
  });
  await f.context.poll();
  assert.equal(f.localState.receipts.expired, undefined);
  assert.ok(f.localState.receipts.grace);
  assert.equal(f.requests.length, 0);
  assert.equal(f.invocations.length, 0);
});

test("receipt persistence failure prevents side effects, including when the local storage quota is full", async () => {
  const f = mockWorker();
  const realSet = f.chrome.storage.local.set;
  f.chrome.storage.local.set = async (values) => {
    if (values.receipts) throw new Error("Quota exceeded");
    return realSet(values);
  };
  await f.context.poll();
  assert.equal(f.invocations.length, 0);
  assert.equal(f.acks.length, 0);
  assert.match(f.localState.lastStatus, /Quota exceeded/);
});

test("parallel poll triggers share the active poll and cannot execute twice", async () => {
  const f = mockWorker();
  await Promise.all([f.context.poll(), f.context.poll(), f.context.poll()]);
  assert.equal(f.invocations.length, 1);
  assert.equal(f.acks.length, 1);
});

test("revocation and connection changes stop queued browser actions", async () => {
  const revoked = mockWorker({
    local: {
      receipts: {
        capture: {
          expiresAt: Date.now() + 300000,
          result: { data: { dataUrl: "private-image" } },
        },
      },
    },
    fetchOverride: () => Response.json({ error: "revoked" }, { status: 401 }),
  });
  await Promise.all([revoked.context.poll(), revoked.context.poll()]);
  assert.equal(revoked.localState.pairing, undefined);
  assert.equal(revoked.localState.receipts, undefined);
  assert.equal(revoked.sessionState.browserSession, undefined);
  assert.equal(revoked.invocations.length, 0);
  assert.equal(revoked.requests.length, 1);
  let changed;
  changed = mockWorker({
    fetchOverride: (url) => {
      if (url.endsWith("/actions")) {
        changed.localState.pairing.token = "new-connection";
        return Response.json({ actions: [action()] });
      }
    },
  });
  await changed.context.poll();
  assert.equal(changed.invocations.length, 0);
});

test("401 while acknowledging clears receipts and stops remaining queued actions", async () => {
  const f = mockWorker({
    actions: [action("first"), action("second")],
    fetchOverride: (url) =>
      url.endsWith("/result")
        ? Response.json({ error: "revoked" }, { status: 401 })
        : undefined,
  });
  await f.context.poll();
  assert.equal(f.invocations.length, 1);
  assert.equal(f.localState.pairing, undefined);
  assert.equal(f.localState.receipts, undefined);
  assert.equal(f.sessionState.browserSession, undefined);
  assert.match(f.localState.lastStatus, /revoked/);
});

test("a stale 401 cannot clear a replacement connection or its receipts", async () => {
  let f;
  f = mockWorker({
    fetchOverride: () => {
      f.localState.pairing = { token: "replacement-token" };
      f.localState.receipts = { fresh: { expiresAt: Date.now() + 300000 } };
      return Response.json({ error: "revoked" }, { status: 401 });
    },
  });
  await f.context.poll();
  assert.equal(f.localState.pairing.token, "replacement-token");
  assert.ok(f.localState.receipts.fresh);
  assert.ok(f.sessionState.browserSession);
  assert.equal(f.invocations.length, 0);
});

test("disconnect during execution does not restore cleared receipts or acknowledge to another connection", async () => {
  let f;
  f = mockWorker({
    executeOverride: () => {
      delete f.localState.pairing;
      delete f.localState.receipts;
      return [{ result: { status: "started", message: "Already in flight." } }];
    },
  });
  await f.context.poll();
  assert.equal(f.localState.receipts, undefined);
  assert.equal(f.acks.length, 0);
  assert.match(f.localState.lastStatus, /connection changed/);
});

for (const replacement of [false, true])
  test(`disconnect during a pending receipt write removes restored old images${replacement ? " and preserves replacement receipts" : ""}`, async () => {
    const old = {
      expiresAt: Date.now() + 300000,
      result: { data: { dataUrl: "old-image" } },
    };
    const fresh = {
      expiresAt: Date.now() + 300000,
      result: { status: "completed", message: "New connection." },
    };
    const f = mockWorker({ local: { receipts: { previous: old } } });
    const realSet = f.chrome.storage.local.set;
    let release, signalStarted;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      signalStarted = resolve;
    });
    let delayed = false;
    f.chrome.storage.local.set = async (values) => {
      if (!delayed && values.receipts?.["action-1"]?.result) {
        delayed = true;
        signalStarted();
        await pending;
        await realSet(values);
        if (replacement) {
          // A newer entry must survive cleanup of this poll's restored snapshot.
          await realSet({ receipts: { ...f.localState.receipts, fresh } });
        }
        return;
      }
      return realSet(values);
    };
    const poll = f.context.poll();
    await started;
    await f.chrome.storage.local.remove(["pairing", "receipts"]);
    if (replacement) await realSet({ pairing: { token: "replacement-token" } });
    release();
    await poll;
    if (replacement) {
      assert.equal(f.localState.pairing.token, "replacement-token");
      assert.deepEqual(f.localState.receipts, { fresh });
    } else assert.equal(f.localState.receipts, undefined);
    assert.equal(f.acks.length, 0);
    assert.match(f.localState.lastStatus, /connection changed/);
  });

test("one broad session includes new tabs and other websites without a tab grant", async () => {
  const f = mockWorker();
  f.tabs.push({ ...f.tabs[0], id: 2, url: "https://another.test/help", active: false });
  f.tabs[0].url = "https://different.test/page";
  assert.equal((await f.context.execute(action())).status, "started");
  assert.equal((await f.context.execute(action("second", { args: { tabId: 2, selector: "#normal" } }))).status, "started");
  const result = await f.context.execute(action("list", { type: "browser_tabs", args: {} }));
  assert.deepEqual(Array.from(result.data.tabs, (t) => t.id), [1, 2]);
  assert.equal((await f.context.execute(action("nav", { type: "browser_navigate", args: { tabId: 1, url: "https://third.test/help" } }))).status, "started");
  f.sessionState.browserSession.expiresAt = 0;
  assert.equal((await f.context.execute(action())).status, "blocked");
  assert.equal((await f.context.execute(action("list", { type: "browser_tabs", args: {} }))).status, "blocked");
});

test("broad session excludes private, protected, loading and internal tabs", async () => {
  const f = mockWorker();
  for (const [index, url] of ["chrome://settings", "chrome-extension://test/popup.html", "file:///private.txt", "https://user:pass@example.test/", "http://127.0.0.1:43111/", "http://localhost:43111/", "https://example.test/login", "https://example.test/checkout", "https://chromewebstore.google.com/detail/app"].entries())
    f.tabs.push({ ...f.tabs[0], id: index + 2, url });
  f.tabs.push({ ...f.tabs[0], id: 20, incognito: true }, { ...f.tabs[0], id: 21, pendingUrl: origin + "/loading" });
  const result = await f.context.execute(action("list", { type: "browser_tabs", args: {} }));
  assert.deepEqual(Array.from(result.data.tabs, (t) => t.id), [1]);
  for (const tab of f.tabs.slice(1)) assert.equal((await f.context.execute(action("blocked", { args: { tabId: tab.id } }))).status, "blocked");
  assert.equal(f.invocations.length, 0);
});

test("permission removal, browser restart, legacy tab grants and replacement pairing cannot enable control", async () => {
  const cases = [
    (f) => { f.chrome.permissions.contains = async () => false; },
    (f) => { delete f.sessionState.browserSession; f.sessionState.allowedTabs = { 1: { origin, expiresAt: Date.now() + 60000 } }; },
    (f) => { f.localState.pairing.token = "new-pairing"; },
  ];
  for (const mutate of cases) {
    const f = mockWorker(); mutate(f);
    assert.equal((await f.context.execute(action())).status, "blocked");
    assert.equal(f.invocations.length, 0);
  }
  const f = mockWorker();
  f.chrome.permissions.contains = async () => false;
  await Promise.all([...f.listeners.permissionsRemoved].map((callback) => callback({ origins: ["<all_urls>"] })));
  assert.equal(f.sessionState.browserSession, undefined);
  f.chrome.permissions.contains = async () => true;
  assert.equal((await f.context.execute(action())).status, "blocked");
});

test("stop while tab details are loading blocks execution; injected checks include origin and expiry", async () => {
  const f = mockWorker();
  f.chrome.tabs.get = async () => {
    delete f.sessionState.browserSession;
    return f.tabs[0];
  };
  assert.equal((await f.context.execute(action())).status, "blocked");
  assert.equal(f.invocations.length, 0);
  const good = mockWorker();
  await good.context.execute(action());
  assert.equal(good.invocations[0].args[2].origin, origin);
  assert.ok(good.invocations[0].args[2].expiresAt > Date.now());
});

test("publishing/deletion navigation requires the user and cannot be bypassed by confirmation arguments", async () => {
  const f = mockWorker();
  for (const url of [
    `${origin}/projects/delete`,
    `${origin}/deploy`,
    `${origin}/do?action=publish`,
    `${origin}/%64elete`,
  ])
    assert.equal(
      (
        await f.context.execute(
          action("nav", {
            type: "browser_navigate",
            args: { tabId: 1, url, confirmed: true },
          }),
        )
      ).status,
      "needs_user",
    );
  assert.equal(f.invocations.length, 0);
  assert.equal(
    (
      await f.context.execute(
        action("nav", {
          type: "browser_navigate",
          args: { tabId: 1, url: `${origin}/help` },
        }),
      )
    ).status,
    "started",
  );
  assert.equal(f.invocations.length, 1);
});

test("invalid queue identifiers cannot become result URLs", async () => {
  const bad = mockWorker({ actions: [action("../escape")] });
  await bad.context.poll();
  assert.equal(bad.invocations.length, 0);
  assert.equal(bad.requests.length, 1);
});

const captureAction = (extra = {}) =>
  action("screenshot", {
    type: "browser_screenshot",
    args: { tabId: 1 },
    ...extra,
  });
test("screenshots return bounded JPEG metadata for the allowed visible tab without focusing it", async () => {
  const f = mockWorker(),
    result = await f.context.execute(captureAction());
  assert.equal(result.status, "completed");
  assert.deepEqual(
    f.captures.map((c) => c.id),
    [1],
  );
  assert.equal(result.data.kind, "browser_screenshot");
  assert.equal(result.data.mimeType, "image/jpeg");
  assert.ok(result.data.dataUrl.startsWith("data:image/jpeg;base64,"));
  assert.equal(result.data.width, 1280);
  assert.equal(result.data.height, 720);
  assert.equal(result.data.url, origin + "/page");
  assert.ok(Number.isFinite(Date.parse(result.data.capturedAt)));
  assert.ok(Buffer.byteLength(JSON.stringify(result.data)) <= 220 * 1024);
  assert.equal(f.listeners.activated.size, 0);
  assert.equal(f.listeners.updated.size, 0);
  assert.equal(f.listeners.focusChanged.size, 0);
  assert.equal(f.listeners.removed.size, 0);
  assert.equal(f.listeners.permissionsRemoved.size, 1); // Global grant revocation stays installed.
  assert.equal(f.invocations.filter((i) => i.type === "navigate").length, 0);
  assert.ok(f.invocations.some((i) => i.args?.[0] === "cleanup"));
});

test("screenshots refuse inactive, unfocused, loading, split, expired and unpaired contexts before capture", async () => {
  const cases = [
    (f) => {
      f.tabs[0].active = false;
    },
    (f) => {
      f.windows[0].focused = false;
    },
    (f) => {
      f.windows[0].state = "minimized";
    },
    (f) => {
      f.windows[0].type = "popup";
    },
    (f) => {
      f.tabs[0].pendingUrl = origin + "/next";
    },
    (f) => {
      f.tabs[0].status = "loading";
    },
    (f) => {
      f.tabs[0].splitViewId = 3;
    },
    (f) => {
      f.tabs[0].url = "https://different.test/login";
    },
    (f) => {
      f.sessionState.browserSession.expiresAt = 0;
    },
    (f) => {
      delete f.localState.pairing;
    },
  ];
  for (const mutate of cases) {
    const f = mockWorker();
    mutate(f);
    const result = await f.context.execute(captureAction());
    assert.equal(result.status, "blocked");
    assert.equal(result.data, undefined);
    assert.equal(f.captures.length, 0);
  }
  const f = mockWorker();
  assert.equal(
    (await f.context.execute(captureAction({ expiresAt: undefined }))).status,
    "blocked",
  );
  assert.equal(
    (await f.context.execute(captureAction({ expiresAt: "2020-01-01" })))
      .status,
    "blocked",
  );
  assert.equal(f.captures.length, 0);
});

test("screenshots discard transient tab/window switches, navigation and revocation during capture", async () => {
  const changes = [
    (f) => {
      f.emit("activated", { tabId: 2, windowId: 1 });
      f.emit("activated", { tabId: 1, windowId: 1 });
    },
    (f) => {
      f.emit("updated", 1, { url: origin + "/private" });
      f.emit("updated", 1, { url: origin + "/page" });
    },
    (f) => {
      f.emit("focusChanged", 2);
      f.emit("focusChanged", 1);
    },
    (f) => {
      f.emit("detached", 1);
    },
    (f) => {
      f.emit("replaced", 2, 1);
    },
    (f) => {
      f.emit("removed", 1);
    },
    (f) => {
      delete f.sessionState.browserSession;
    },
    (f) => {
      f.localState.pairing.token = "different-device";
    },
    (f) => {
      f.sessionState.browserSession.expiresAt = 0;
    },
  ];
  for (const change of changes) {
    let f;
    f = mockWorker({
      captureOverride: () => {
        change(f);
        return "data:image/jpeg;base64,/9j/2Q==";
      },
    });
    const result = await f.context.execute(captureAction());
    assert.equal(result.status, "blocked");
    assert.equal(result.data, undefined);
    assert.equal(f.captures.length, 1);
    assert.equal(f.encodes.length, 0);
    assert.equal(f.listeners.activated.size, 0);
  }
});

test("screenshots fail closed for unsafe documents, document replacement and post-capture DOM changes", async () => {
  for (const phase of ["start", "check", "finish"]) {
    const f = mockWorker({
      executeOverride: (options) => [
        {
          frameId: 0,
          documentId: "document-1",
          result: {
            safe: options.args[0] !== phase,
            message: "Protected or changing content.",
          },
        },
      ],
    });
    const result = await f.context.execute(captureAction());
    assert.equal(result.status, "blocked");
    assert.equal(result.data, undefined);
    assert.equal(f.captures.length, phase === "start" ? 0 : 1);
  }
  const replaced = mockWorker({
    executeOverride: (options) => [
      {
        frameId: 0,
        documentId: options.args[0] === "start" ? "old" : "new",
        result: { safe: true },
      },
    ],
  });
  assert.equal(
    (await replaced.context.execute(captureAction())).status,
    "blocked",
  );
  let navigating;
  navigating = mockWorker({
    executeOverride: (options) => {
      if (options.args[0] === "start")
        navigating.tabs[0].url = origin + "/next";
      return [{ frameId: 0, documentId: "document-1", result: { safe: true } }];
    },
  });
  assert.equal(
    (await navigating.context.execute(captureAction())).status,
    "blocked",
  );
  assert.equal(navigating.captures.length, 0);
});

test("capture permission failures return an actionable manual step and never screenshot another tab", async () => {
  const f = mockWorker({
    captureOverride: () => {
      throw new Error("Either all_urls or activeTab permission is required");
    },
  });
  const result = await f.context.execute(captureAction());
  assert.equal(result.status, "needs_user");
  assert.match(result.message, /Open the Nakama extension/);
  assert.equal(result.data, undefined);
  assert.equal(f.captures.length, 1);
  assert.equal(f.encodes.length, 0);
  assert.equal(f.listeners.activated.size, 0);
});

test("screenshot encoding shrinks oversized output and releases bitmap memory even on failure", async () => {
  let attempts = 0,
    closed = 0;
  const f = mockWorker({
    bitmapOverride: async () => ({
      width: 1920,
      height: 1080,
      close() {
        closed++;
      },
    }),
    canvasOverride: () =>
      new Blob([new Uint8Array(++attempts < 3 ? 200 * 1024 : 1000)], {
        type: "image/jpeg",
      }),
  });
  const result = await f.context.execute(captureAction());
  assert.equal(result.status, "completed");
  assert.equal(result.data.width, 832);
  assert.equal(closed, 1);
  assert.equal(f.encodes.length, 3);
  const tooLarge = mockWorker({
    canvasOverride: () =>
      new Blob([new Uint8Array(200 * 1024)], { type: "image/jpeg" }),
  });
  assert.equal(
    (await tooLarge.context.execute(captureAction())).status,
    "blocked",
  );
  assert.equal(tooLarge.encodes.length, 6);
  const malformed = mockWorker({
    captureOverride: () => "https://arbitrary.test/image.jpg",
  });
  assert.equal(
    (await malformed.context.execute(captureAction())).status,
    "blocked",
  );
});

test("screenshot receipts retain the exact image after failed acknowledgement and never recapture on redelivery", async () => {
  let failures = 1;
  const f = mockWorker({
    actions: [captureAction()],
    fetchOverride: (url) => {
      if (url.endsWith("/result") && failures-- > 0)
        throw new Error("Lost acknowledgement");
    },
  });
  await f.context.poll();
  assert.equal(f.captures.length, 1);
  assert.equal(f.acks.length, 0);
  const saved = structuredClone(f.localState.receipts.screenshot.result);
  await f.context.poll();
  assert.equal(f.captures.length, 1);
  assert.equal(f.acks.length, 1);
  assert.deepEqual(f.acks[0], saved);
  assert.equal(saved.status, "completed");
  assert.ok(saved.data.dataUrl);
});

test("revocation during encoding or final cleanup discards screenshot bytes and removes listeners", async () => {
  let encoding;
  encoding = mockWorker({
    canvasOverride: () => {
      delete encoding.sessionState.browserSession;
      return new Blob([new Uint8Array(1000)], { type: "image/jpeg" });
    },
  });
  const result = await encoding.context.execute(captureAction());
  assert.equal(result.status, "blocked");
  assert.equal(result.data, undefined);
  assert.equal(encoding.captures.length, 1);
  let cleanup;
  cleanup = mockWorker({
    executeOverride: (options) => {
      if (options.args[0] === "cleanup") {
        cleanup.emit("focusChanged", 2);
        cleanup.emit("focusChanged", 1);
      }
      return [{ frameId: 0, documentId: "document-1", result: { safe: true } }];
    },
  });
  const last = await cleanup.context.execute(captureAction());
  assert.equal(last.status, "blocked");
  assert.equal(last.data, undefined);
  assert.equal(cleanup.listeners.focusChanged.size, 0);
});

test("result persistence failure leaves an interrupted screenshot receipt instead of a repeat capture", async () => {
  const f = mockWorker({ actions: [captureAction()] }),
    set = f.chrome.storage.local.set;
  let failed = false;
  f.chrome.storage.local.set = async (values) => {
    if (!failed && values.receipts?.screenshot?.result?.data) {
      failed = true;
      throw new Error("Storage full");
    }
    return set(values);
  };
  await f.context.poll();
  assert.equal(f.captures.length, 1);
  assert.equal(f.acks.length, 0);
  await f.context.poll();
  assert.equal(f.captures.length, 1);
  assert.equal(f.acks[0].status, "interrupted");
  assert.equal(f.acks[0].data, undefined);
});

const require = createRequire(import.meta.url);
let chromium;
try {
  chromium = require(
    process.env.NAKAMA_PLAYWRIGHT_MODULE_PATH || "playwright",
  ).chromium;
} catch {}
test(
  "real Chromium MV3: tab control, guarded native dropdowns, protected inputs and bounded screenshot capture",
  {
    skip: !chromium
      ? "Install Playwright and its Chromium browser, or set NAKAMA_PLAYWRIGHT_MODULE_PATH for the optional real-browser check."
      : false,
    timeout: 60000,
  },
  async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "nakama-extension-test-"),
    );
    let browser;
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      if (req.url === "/capture") {
        res.end(
          '<!doctype html><title>Nakama capture fixture</title><style>html,body{margin:0;background:#245cce;color:white;font:24px sans-serif}main{padding:40px}</style><main><h1>Nakama visible-tab test</h1><p>A disposable local page with no account or private data.</p><input id="search" placeholder="Search"></main>',
        );
        return;
      }
      if (req.url === "/forms") {
        res.end(`<!doctype html><title>Nakama dropdown fixture</title>
          <label for="theme">Theme</label><select id="theme"><option value="">Automatic</option><option value="dark">Dark</option><option value=" dark ">Spaced dark</option><option value="disabled" disabled>Unavailable</option><optgroup label="Unavailable group" disabled><option value="group">Group option</option></optgroup></select>
          <select id="multiple" multiple><option value="a">A</option><option value="b">B</option></select>
          <div id="custom" role="combobox">A custom choice</div>
          <fieldset disabled><legend><select id="legend"><option value="a">A</option><option value="b">B</option></select></legend><select id="fieldset"><option value="a">A</option><option value="b">B</option></select></fieldset>
          <div inert><select id="inert"><option value="a">A</option><option value="b">B</option></select></div>
          <div aria-hidden="true"><select id="aria-hidden"><option value="a">A</option><option value="b">B</option></select></div>
          <div aria-readonly="true"><select id="aria-readonly"><option value="a">A</option><option value="b">B</option></select></div>
          <select id="readonly-select" readonly><option value="a">A</option><option value="b">B</option></select>
          <label for="protected-select">API key</label><select id="protected-select"><option value="PRIVATE_OPTION_SENTINEL">PRIVATE_OPTION_SENTINEL</option><option value="b">B</option></select>
          <label id="danger-label">Delete project</label><select id="labelled" aria-labelledby="danger-label"><option value="a">A</option><option value="b">B</option></select>
          <select id="danger-option"><option value="a">View</option><option value="b">Delete project</option></select>
          <select id="duplicate"><option value="a">A</option><option value="b">B</option><option value="b">Another B</option></select>
          <form id="outside-form" action="/deploy"></form><select id="external-form" form="outside-form"><option value="a">A</option><option value="b">B</option></select>
          <form id="encoded-form" action="/%64%65%6c%65%74%65"></form><label for="encoded-choice">50% setting</label><select id="encoded-choice" form="encoded-form"><option value="a">A</option><option value="b">B</option></select>
          <select id="reactive"><option value="a">A</option><option value="b">B</option></select>
          <script>globalThis.inputEvents=0;globalThis.changeEvents=0;document.addEventListener('input',()=>globalThis.inputEvents++);document.addEventListener('change',()=>globalThis.changeEvents++);</script>`);
        return;
      }
      res.end(
        `<!doctype html><title>Nakama local test fixture</title><p id="status">No clicks yet.</p><button id="normal" onclick="document.querySelector('#status').textContent='Clicked once'">Open details</button><button id="deploy" onclick="document.querySelector('#status').textContent='DANGER'">Deploy project</button><button id="delete"><span id="nested" onclick="document.querySelector('#status').textContent='DANGER'">Delete project</span></button><div role="dialog"><p>Delete this project?</p><button id="confirm" onclick="document.querySelector('#status').textContent='DANGER'">Continue</button></div><input id="password" type="password" value="secret"><input id="card" autocomplete="section-payment cc-number"><input id="otp" autocomplete="one-time-code"><input id="readonly" readonly><input id="normalText"><input id="api-key"><script>document.querySelector('#normalText').addEventListener('input',()=>document.querySelector('#status').textContent='Text entered')</script>`,
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
      const resolved = path.resolve(directory);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.match(path.basename(resolved), /^nakama-extension-test-/);
      await fs.rm(resolved, { recursive: true, force: true });
    });
    const extension = path.join(directory, "extension");
    await fs.cp(path.resolve("apps/chrome-extension"), extension, {
      recursive: true,
    });
    await fs.appendFile(
      path.join(extension, "worker.js"),
      "\nglobalThis.__nakamaTest = {execute, pageAction};\n",
    );
    const manifest = JSON.parse(
      await fs.readFile(path.join(extension, "manifest.json"), "utf8"),
    );
    // Headless Chrome cannot accept a real optional-permission prompt. This
    // disposable copy grants the production feature's optional all_urls upfront.
    // The profile only opens local fixture pages and its own extension popup.
    manifest.host_permissions.push("<all_urls>");
    await fs.writeFile(
      path.join(extension, "manifest.json"),
      JSON.stringify(manifest),
    );
    browser = await chromium.launchPersistentContext(
      path.join(directory, "profile"),
      {
        channel: "chromium",
        headless: true,
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      },
    );
    const worker =
      browser.serviceWorkers()[0] ||
      (await browser.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).hostname;
    const fixtureUrl = `http://127.0.0.1:${server.address().port}`,
      page = await browser.newPage();
    await page.goto(fixtureUrl);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    assert.equal(await popup.title(), "Nakama");
    assert.match(await popup.locator("#status").textContent(), /Not paired/);
    // The fixture alone is allowed in the disposable profile. These evaluations
    // grant no permissions in the user's Chrome and make no host/API requests.
    const tabId = await worker.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url)).id,
      fixtureUrl,
    );
    await worker.evaluate(
      async ({ id, url }) => {
        await chrome.storage.session.set({
          browserSession: { id: "fixture-session", controlEpoch: "", pairingToken: "disposable-local-test-token", expiresAt: Date.now() + 60000 },
        });
        await chrome.storage.local.set({
          pairing: { token: "disposable-local-test-token" },
        });
      },
      { id: tabId, url: fixtureUrl },
    );
    const run = (type, args) =>
      worker.evaluate(
        async ({ type, args, tabId }) =>
          globalThis.__nakamaTest.execute({
            type,
            args: { ...args, tabId },
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          }),
        { type, args, tabId },
      );
    const read = await run("browser_read", {});
    assert.equal(read.status, "completed");
    assert.ok(read.data.controls.some((c) => c.label === "Open details"));
    assert.equal(
      await page.locator("#password").getAttribute("data-nakama-control"),
      null,
    );
    assert.equal(
      await page.locator("#card").getAttribute("data-nakama-control"),
      null,
    );
    assert.equal(read.data.text.includes("secret"), false);
    for (const selector of ["#deploy", "#nested", "#confirm"]) {
      assert.equal(
        (
          await run("browser_click", {
            selector,
            confirmed: true,
            approved: true,
          })
        ).status,
        "needs_user",
      );
      assert.notEqual(await page.locator("#status").textContent(), "DANGER");
    }
    for (const selector of [
      "#password",
      "#card",
      "#otp",
      "#api-key",
      "#readonly",
    ])
      assert.equal(
        (await run("browser_type", { selector, text: "attempt" })).status,
        "blocked",
      );
    assert.equal(
      (await run("browser_click", { selector: "#normal" })).status,
      "started",
    );
    assert.equal(await page.locator("#status").textContent(), "Clicked once");
    assert.equal(
      (
        await run("browser_type", {
          selector: "#normalText",
          text: "Hello Nakama",
        })
      ).status,
      "completed",
    );
    assert.equal(
      await page.locator("#normalText").inputValue(),
      "Hello Nakama",
    );
    assert.equal(await page.locator("#status").textContent(), "Text entered");
    await page.goto(fixtureUrl + "/forms");
    const dropdownRead = await run("browser_read", {}),
      theme = dropdownRead.data.controls.find((c) => c.label === "Theme");
    assert.equal(theme.tag, "select");
    assert.equal(theme.multiple, false);
    assert.equal(theme.optionsTruncated, false);
    assert.deepEqual(
      theme.options.map((o) => o.value),
      ["", "dark", " dark ", "disabled", "group"],
    );
    assert.equal(theme.options.find((o) => o.value === "group").disabled, true);
    assert.equal(
      dropdownRead.data.text.includes("PRIVATE_OPTION_SENTINEL"),
      false,
    );
    assert.equal(
      dropdownRead.data.controls.some((c) =>
        c.options?.some((o) => o.value === "PRIVATE_OPTION_SENTINEL"),
      ),
      false,
    );
    const select = (selector, value) =>
      run("browser_select", { selector, value });
    const chosen = await select(theme.selector, "dark");
    assert.equal(chosen.status, "completed", JSON.stringify(chosen));
    assert.equal(chosen.data.changed, true);
    assert.equal(await page.locator("#theme").inputValue(), "dark");
    assert.deepEqual(
      await page.evaluate(() => [inputEvents, changeEvents]),
      [1, 1],
    );
    const unchanged = await select(theme.selector, "dark");
    assert.equal(unchanged.data.changed, false);
    assert.deepEqual(
      await page.evaluate(() => [inputEvents, changeEvents]),
      [1, 1],
    );
    assert.equal((await select("#theme", " dark ")).data.value, " dark ");
    assert.equal((await select("#theme", "")).data.value, "");
    for (const [selector, value, expected] of [
      ["#multiple", "b", "unsupported"],
      ["#custom", "b", "unsupported"],
      ["#fieldset", "b", "blocked"],
      ["#inert", "b", "blocked"],
      ["#aria-hidden", "b", "blocked"],
      ["#aria-readonly", "b", "blocked"],
      ["#readonly-select", "b", "blocked"],
      ["#protected-select", "b", "blocked"],
      ["#labelled", "b", "needs_user"],
      ["#danger-option", "b", "needs_user"],
      ["#external-form", "b", "needs_user"],
      ["#encoded-choice", "b", "needs_user"],
      ["#duplicate", "b", "blocked"],
      ["#theme", "disabled", "blocked"],
      ["#theme", "group", "blocked"],
      ["#theme", "missing", "blocked"],
      ["#theme", "x".repeat(201), "blocked"],
      ["#theme", "a\0b", "blocked"],
      ["[", "b", "blocked"],
      ["select", "b", "blocked"],
      ["#absent", "b", "blocked"],
    ]) {
      const before = await page.evaluate(() => [inputEvents, changeEvents]);
      const result = await select(selector, value);
      assert.equal(
        result.status,
        expected,
        `${selector}: ${JSON.stringify(result)}`,
      );
      assert.deepEqual(
        await page.evaluate(() => [inputEvents, changeEvents]),
        before,
      );
    }
    assert.equal((await select("#legend", "b")).status, "completed");
    for (const behaviour of [
      "revert-input",
      "remove-input",
      "replace-input",
      "danger-input",
      "duplicate-input",
      "revert-change",
      "microtask-change",
    ]) {
      await page.evaluate((behaviour) => {
        document.querySelector("#reactive")?.remove();
        const node = document.createElement("select");
        node.id = "reactive";
        node.innerHTML =
          '<option value="a">A</option><option value="b">B</option>';
        document.body.append(node);
        inputEvents = 0;
        changeEvents = 0;
        if (behaviour.endsWith("input"))
          node.addEventListener("input", () => {
            if (behaviour === "revert-input") node.value = "a";
            if (behaviour === "remove-input") node.remove();
            if (behaviour === "replace-input")
              node.replaceWith(node.cloneNode(true));
            if (behaviour === "danger-input")
              node.selectedOptions[0].label = "Delete project";
            if (behaviour === "duplicate-input")
              node.append(new Option("Another B", "b"));
          });
        if (behaviour === "revert-change")
          node.addEventListener("change", () => (node.value = "a"));
        if (behaviour === "microtask-change")
          node.addEventListener("change", () =>
            Promise.resolve().then(() => (node.value = "a")),
          );
      }, behaviour);
      const result = await select("#reactive", "b");
      assert.equal(
        result.status,
        "needs_user",
        `${behaviour}: ${JSON.stringify(result)}`,
      );
      assert.deepEqual(await page.evaluate(() => [inputEvents, changeEvents]), [
        1,
        behaviour.endsWith("input") ? 0 : 1,
      ]);
    }
    await page.evaluate(() => {
      document.body.replaceChildren();
      const text = document.createElement("p");
      text.textContent = "漢字😀\u0001".repeat(20000);
      document.body.append(text);
      for (let i = 0; i < 80; i++) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Dropdown ${i}`);
        for (let j = 0; j < 100; j++)
          select.add(
            new Option("漢".repeat(200), `${i}-${j}-` + "v".repeat(150)),
          );
        select.add(new Option("Too long", "v".repeat(201)), 0);
        select.add(new Option("Contains null", "bad\0value"), 0);
        document.body.append(select);
      }
    });
    const boundedRead = await run("browser_read", {});
    assert.equal(boundedRead.status, "completed");
    assert.ok(
      Buffer.byteLength(JSON.stringify(boundedRead.data)) <= 240 * 1024,
    );
    assert.ok(boundedRead.data.controls.some((c) => c.optionsTruncated));
    assert.ok(
      boundedRead.data.controls.every(
        (c) =>
          !c.options ||
          (c.options.length <= 50 &&
            c.options.every(
              (o) => o.value.length <= 200 && !o.value.includes("\0"),
            )),
      ),
    );
    assert.ok(
      boundedRead.data.controls.reduce(
        (n, c) =>
          n +
          (c.options || []).reduce(
            (m, o) => m + Buffer.byteLength(JSON.stringify(o)) + 1,
            0,
          ),
        0,
      ) <=
        16 * 1024,
    );
    await page.goto(fixtureUrl);
    const wrong = await page.evaluate(
      ({ source }) =>
        (0, eval)(`(${source})`)(
          "browser_click",
          { selector: "#normal" },
          { origin: "https://wrong.test", expiresAt: Date.now() + 60000 },
        ),
      {
        source: source
          .match(
            /export function pageAction[\s\S]*?(?=\nexport async function poll)/,
          )[0]
          .replace("export ", ""),
      },
    );
    assert.equal(wrong.status, "blocked");
    const list = await worker.evaluate(async () =>
      globalThis.__nakamaTest.execute({ type: "browser_tabs", args: {}, expiresAt: new Date(Date.now() + 300000).toISOString() }),
    );
    assert.equal(list.data.tabs.length, 1);
    assert.equal(list.data.tabs[0].id, tabId);
    const secondPage = await browser.newPage();
    await secondPage.goto(fixtureUrl + "/capture");
    const listNow = () => worker.evaluate(async () => globalThis.__nakamaTest.execute({
      type: "browser_tabs", args: {}, expiresAt: new Date(Date.now() + 300000).toISOString(),
    }));
    assert.equal((await listNow()).data.tabs.length, 2);
    await secondPage.reload();
    assert.equal((await listNow()).data.tabs.length, 2);
    const anotherOrigin = fixtureUrl.replace("127.0.0.1", "localhost");
    await secondPage.goto(anotherOrigin + "/capture");
    assert.ok((await listNow()).data.tabs.some((tab) => tab.url.startsWith(anotherOrigin)));
    const secondId = (await listNow()).data.tabs.find((tab) => tab.url.startsWith(anotherOrigin)).id;
    const secondRead = await worker.evaluate(async (id) => globalThis.__nakamaTest.execute({
      type: "browser_read", args: { tabId: id }, expiresAt: new Date(Date.now() + 300000).toISOString(),
    }), secondId);
    assert.equal(secondRead.status, "completed");
    await secondPage.close();
    await popup.close();
    await page.bringToFront();
    const protectedCapture = await run("browser_screenshot", {});
    assert.equal(
      protectedCapture.status,
      "blocked",
      JSON.stringify(protectedCapture),
    );
    assert.match(protectedCapture.message, /credential|payment|input/);
    assert.equal(protectedCapture.data, undefined);
    await page.goto(fixtureUrl + "/capture");
    const screenshot = await run("browser_screenshot", {});
    assert.equal(screenshot.status, "completed", JSON.stringify(screenshot));
    assert.ok(Buffer.byteLength(JSON.stringify(screenshot.data)) <= 220 * 1024);
    assert.ok(screenshot.data.dataUrl.length <= 220 * 1024);
    assert.equal(screenshot.data.url, fixtureUrl + "/capture");
    assert.equal(screenshot.data.title, "Nakama capture fixture");
    const pixels = await worker.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data.dataUrl.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/jpeg" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        corner: [...context.getImageData(1, 1, 1, 1).data],
      };
      bitmap.close();
      return result;
    }, screenshot.data);
    assert.equal(pixels.width, screenshot.data.width);
    assert.equal(pixels.height, screenshot.data.height);
    assert.ok(pixels.width <= 1280 && pixels.height <= 960);
    assert.ok(
      pixels.corner[0] < 70 && pixels.corner[2] > 160,
      JSON.stringify(pixels),
    );
    for (const attributes of [
      { autocomplete: "section-payment cc-number" },
      { autocomplete: "one-time-code" },
      { id: "api-key" },
    ]) {
      await page.evaluate((values) => {
        const input = document.createElement("input");
        input.dataset.captureTest = "true";
        for (const [name, value] of Object.entries(values))
          input.setAttribute(name, value);
        document.body.append(input);
      }, attributes);
      const protectedInput = await run("browser_screenshot", {});
      assert.equal(protectedInput.status, "blocked");
      assert.match(protectedInput.message, /credential|payment|input/);
      assert.equal(protectedInput.data, undefined);
      await page
        .locator('[data-capture-test="true"]')
        .evaluate((node) => node.remove());
    }
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.srcdoc = "<p>Embedded content</p>";
      document.body.append(frame);
    });
    await page.waitForLoadState("load");
    await worker.evaluate(async (id) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await chrome.tabs.get(id)).status === "complete") return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Local embedded fixture did not finish loading");
    }, tabId);
    const framed = await run("browser_screenshot", {});
    assert.equal(framed.status, "blocked");
    assert.match(framed.message, /frame|embedded/);
    assert.equal(framed.data, undefined);
    await page.evaluate(() => {
      document.querySelector("iframe").remove();
      const container = document.createElement("div");
      container.attachShadow({ mode: "open" }).innerHTML =
        '<input type="password">';
      document.body.append(container);
    });
    const shadow = await run("browser_screenshot", {});
    assert.equal(shadow.status, "blocked");
    assert.match(shadow.message, /shadow/);
    assert.equal(shadow.data, undefined);
  },
);
