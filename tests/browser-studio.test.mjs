import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import {
  BrowserStudio,
  browserUrl,
  browserInput,
} from "../apps/host/browser-studio.mjs";
const { publicAddress, createPublicProxy } = createRequire(import.meta.url)(
  "../apps/desktop/browser-network.cjs",
);
const OWNER = { kind: "owner", id: "desktop" },
  PHONE = { kind: "device", id: "phone" };

function fixture(t) {
  let clock = 100000,
    preview = { origin: "http://127.0.0.1:5173", launchId: "launch" };
  const store = new EventEmitter();
  store.state = {
    devices: [
      {
        id: "phone",
        platform: "android",
        permissions: {
          browserControl: true,
          projectAccess: true,
          googleAccess: true,
        },
      },
    ],
    tasks: [
      {
        id: "task",
        projectId: "project",
        requestedBy: "desktop",
        status: "running",
        workflowId: "workflow",
      },
    ],
    projectWorkflows: [
      { id: "workflow", projectId: "project", requestedBy: "desktop" },
    ],
  };
  const calls = [],
    callbacks = new Map();
  const adapter = {
    available: true,
    async create(value) {
      calls.push(["create", value.mode]);
      callbacks.set(value.id, value.onChange);
    },
    async createTab(id, tabId) {
      calls.push(["tab", id, tabId]);
    },
    async navigate(id, tabId, url) {
      calls.push(["navigate", url]);
      callbacks.get(id)({ tabId, url, title: "Fixture", loading: false });
    },
    async read() {
      return {
        revision: 1,
        title: "Fixture",
        url: preview.origin,
        text: "Page text",
        elements: [
          { id: "0", tag: "a", text: "Link", href: "https://example.com/next" },
          { id: "1", tag: "input", text: "Name" },
        ],
      };
    },
    async capture() {
      return {
        jpeg: Buffer.from([255, 216, 255, 217]),
        width: 1280,
        height: 800,
        revision: 1,
      };
    },
    async input(_id, _tab, input) {
      calls.push(["input", input]);
    },
    async element(_id, _tab, target, _revision, kind) {
      calls.push(["element", target, kind]);
      return kind === "link" ? "https://example.com/next" : true;
    },
    destroy(id) {
      calls.push(["destroy", id]);
      callbacks.delete(id);
    },
    close() {},
  };
  const host = {
    store,
    project(id) {
      if (id !== "project") throw new Error("Missing project");
      return { id };
    },
    projectPreviews: {
      browserOrigin() {
        return preview;
      },
    },
  };
  const studio = new BrowserStudio(host, {
    adapter,
    clock: () => clock,
    timers: false,
  });
  t.after(() => studio.close());
  const action = (body) =>
    studio.agentAction(body, { taskId: "task", principal: OWNER });
  const create = (mode = "project", principal = OWNER) =>
    studio.create(
      { mode, ...(mode === "project" ? { projectId: "project" } : {}) },
      principal,
    );
  const route = (session, suffix) =>
    `/api/browser-studio/sessions/${session.id}${suffix ? "/" + suffix : ""}`;
  return {
    studio,
    host,
    adapter,
    calls,
    callbacks,
    action,
    create,
    route,
    tick(ms = 400) {
      clock += ms;
    },
    invalidatePreview() {
      preview = { ...preview, launchId: "different" };
    },
  };
}

test("browser URL/input policy excludes external schemes, credentials, arbitrary local ports, login research and unbounded controls", () => {
  assert.equal(
    browserUrl("https://example.com/article", "research"),
    "https://example.com/article",
  );
  assert.equal(
    browserUrl(
      "http://127.0.0.1:5173/path",
      "project",
      "http://127.0.0.1:5173",
    ),
    "http://127.0.0.1:5173/path",
  );
  for (const url of [
    "file:///C:/secret",
    "javascript:alert(1)",
    "http://example.com",
    "https://127.0.0.1",
    "https://foo.local",
    "https://user:password@example.com",
    "https://example.com/login",
  ])
    assert.throws(() => browserUrl(url, "research"));
  assert.throws(() =>
    browserUrl("http://127.0.0.1:43110", "project", "http://127.0.0.1:5173"),
  );
  assert.throws(() => browserInput({ kind: "key", key: "Control+V" }));
  assert.throws(() => browserInput({ kind: "text", text: "secret\ncommand" }));
  assert.throws(() => browserInput({ kind: "tap", x: NaN, y: 0 }));
});

test("agent sessions associate real active tasks and only local approved preview or anonymous research", async (t) => {
  const f = fixture(t);
  const { session } = await f.action({ action: "create", mode: "project" });
  assert.equal(session.taskId, "task");
  assert.equal(session.workflowId, "workflow");
  const read = await f.action({ action: "read", sessionId: session.id });
  assert.equal(read.text, "Page text");
  await f.action({ action: "click", sessionId: session.id, elementId: "0" });
  await assert.rejects(
    f.action({ action: "click", sessionId: session.id, elementId: "0" }),
    /Read/,
  );
  await assert.rejects(
    f.action({ action: "create", mode: "private" }),
    /private/,
  );
  await assert.rejects(
    f.studio.agentAction(
      { action: "read", sessionId: session.id },
      { taskId: "imaginary", principal: OWNER },
    ),
    /active/,
  );
  f.invalidatePreview();
  await assert.rejects(
    f.action({ action: "read", sessionId: session.id }),
    /preview/,
  );
});

test("human takeover permanently hides agent/report content and requires fresh one-use frames per input", async (t) => {
  const f = fixture(t),
    { session } = await f.action({ action: "create", mode: "project" });
  await f.studio.frame(f.studio.sessions.get(session.id), {}, OWNER);
  assert.equal(f.studio.reportImages("project").length, 1);
  await f.studio.dispatch("POST", f.route(session, "takeover"), {}, OWNER);
  assert.equal(f.studio.reportImages("project").length, 0);
  await assert.rejects(
    f.action({ action: "read", sessionId: session.id }),
    /private/,
  );
  f.tick();
  const frame = await f.studio.dispatch(
    "POST",
    f.route(session, "frame"),
    {},
    OWNER,
  );
  await f.studio.dispatch(
    "POST",
    f.route(session, "control"),
    { frameId: frame.frameId, kind: "text", text: "synthetic input" },
    OWNER,
  );
  await assert.rejects(
    f.studio.dispatch(
      "POST",
      f.route(session, "control"),
      { frameId: frame.frameId, kind: "key", key: "Enter" },
      OWNER,
    ),
    /Refresh/,
  );
  await f.studio.dispatch("POST", f.route(session, "release"), {}, OWNER);
  await assert.rejects(
    f.studio.dispatch("POST", f.route(session, "frame"), {}, OWNER),
    /Private/,
  );
  assert.equal(f.studio.publicStatus(OWNER).sessions[0].tabs[0].url, "");
});

test("private session is isolated to its human controller, not other phones, agent reads or report collection", async (t) => {
  const f = fixture(t),
    { session } = await f.create("private", PHONE);
  assert.equal(session.status, "human_control");
  const frame = await f.studio.dispatch(
    "POST",
    f.route(session, "frame"),
    {},
    PHONE,
  );
  assert.ok(frame.image.startsWith("data:image/jpeg"));
  await assert.rejects(
    f.studio.dispatch("POST", f.route(session, "frame"), {}, OWNER),
    /Private/,
  );
  assert.equal(f.studio.reportImages("project").length, 0);
  f.host.store.state.devices[0].permissions.googleAccess = false;
  f.host.store.emit("changed");
  assert.equal(f.studio.publicStatus(OWNER).sessions.length, 0);
  await assert.rejects(
    f.studio.dispatch("POST", f.route(session, "frame"), {}, PHONE),
    /Enable/,
  );
});

test("takeover or permission revocation during an asynchronous capture drops the late pixels", async (t) => {
  const f = fixture(t),
    { session } = await f.create();
  let release;
  f.adapter.capture = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = f.studio.dispatch(
    "POST",
    f.route(session, "frame"),
    {},
    OWNER,
  );
  await Promise.resolve();
  await f.studio.dispatch("POST", f.route(session, "takeover"), {}, OWNER);
  release({ jpeg: Buffer.from([255, 216]), width: 1280, height: 800 });
  await assert.rejects(pending, /changed during capture/);
  assert.equal(f.studio.reportImages("project").length, 0);
});

test("sensitive page detection withholds read/frame and pauses for human attention; stopped tasks cannot keep controlling", async (t) => {
  const f = fixture(t),
    { session } = await f.action({ action: "create", mode: "project" });
  f.adapter.read = async () => ({ sensitive: true });
  const result = await f.action({ action: "read", sessionId: session.id });
  assert.equal(result.status, "attention");
  assert.equal(f.studio.publicStatus(OWNER).sessions[0].tainted, true);
  f.host.store.state.tasks[0].status = "stopped";
  f.host.store.emit("changed");
  assert.equal(f.studio.publicStatus(OWNER).sessions.length, 0);
});

test("anonymous research permits read and explicit hyperlink navigation but never form typing or keyboard submission", async (t) => {
  const f = fixture(t),
    { session } = await f.action({
      action: "create",
      mode: "research",
      url: "https://example.com",
    });
  await f.action({ action: "read", sessionId: session.id });
  await f.action({ action: "click", sessionId: session.id, elementId: "0" });
  assert.ok(
    f.calls.some(
      (row) => row[0] === "navigate" && row[1] === "https://example.com/next",
    ),
  );
  await f.action({ action: "read", sessionId: session.id });
  await assert.rejects(
    f.action({
      action: "type",
      sessionId: session.id,
      elementId: "1",
      text: "message",
    }),
    /never types/,
  );
  await assert.rejects(
    f.action({ action: "key", sessionId: session.id, key: "Enter" }),
    /never submits/,
  );
  await assert.rejects(
    f.studio.dispatch("POST", f.route(session, "takeover"), {}, OWNER),
    /Research/,
  );
});

test("public IP boundary rejects loopback, private/link-local, metadata and mapped IPv6 destinations", () => {
  for (const address of [
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.1.2",
    "198.18.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
});

test("public proxy denies private DNS results before creating an outbound connection", async () => {
  const http = await import("node:http");
  let connections = 0;
  const proxy = await createPublicProxy({
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    connect: () => {
      connections++;
      throw new Error("must not connect");
    },
  });
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port: proxy.port,
        method: "CONNECT",
        path: "example.com:443",
      });
      request.on("connect", (response, socket) => {
        socket.destroy();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 403);
    assert.equal(connections, 0);
  } finally {
    proxy.close();
  }
});

test("private Windows sessions reach only an explicitly selected phone; handoff expires and attention id is stable", async (t) => {
  const f = fixture(t),
    { session } = await f.create("private");
  assert.equal(f.studio.publicStatus(PHONE).sessions.length, 0);
  await f.studio.dispatch(
    "POST",
    f.route(session, "handoff"),
    { deviceId: "phone" },
    OWNER,
  );
  let visible = f.studio.publicStatus(PHONE).sessions[0];
  assert.equal(visible.controller.id, "phone");
  const attention = visible.attentionId;
  const frame = await f.studio.dispatch(
    "POST",
    f.route(session, "frame"),
    {},
    PHONE,
  );
  assert.ok(frame.image);
  assert.equal(f.studio.publicStatus(PHONE).sessions[0].attentionId, attention);
  await assert.rejects(
    f.studio.dispatch(
      "POST",
      f.route(session, "handoff"),
      { deviceId: "phone" },
      PHONE,
    ),
    /Only Windows/,
  );
  f.tick(120001);
  f.studio.expire();
  assert.equal(f.studio.publicStatus(PHONE).sessions.length, 0);
  await f.studio.dispatch(
    "POST",
    f.route(session, "handoff"),
    { deviceId: "phone" },
    OWNER,
  );
  f.host.store.state.devices[0].permissions.browserControl = false;
  f.host.store.emit("changed");
  assert.equal(f.studio.publicStatus(PHONE).sessions.length, 0);
  assert.equal(f.studio.publicStatus(OWNER).sessions[0].controller, null);
});

test("native adapter partitions are memory-only and request gates block outside origins, scripts' POSTs, login and private IP proxy bypass", async () => {
  const { createBrowserStudioAdapter } = createRequire(import.meta.url)(
    "../apps/desktop/browser-studio.cjs",
  );
  const partitions = [],
    sessions = [];
  const adapter = createBrowserStudioAdapter({
    BrowserWindow: class {},
    session: {
      fromPartition(name) {
        partitions.push(name);
        const handlers = {};
        const value = {
          handlers,
          setPermissionRequestHandler(fn) {
            handlers.permission = fn;
          },
          setPermissionCheckHandler(fn) {
            handlers.check = fn;
          },
          on() {},
          webRequest: {
            onBeforeRequest(_filter, fn) {
              handlers.request = fn;
            },
            onBeforeSendHeaders(fn) {
              handlers.headers = fn;
            },
            onHeadersReceived(fn) {
              handlers.response = fn;
            },
          },
          async setProxy(config) {
            handlers.proxy = config;
          },
          async clearStorageData() {},
          async closeAllConnections() {},
        };
        sessions.push(value);
        return value;
      },
    },
    proxyFactory: async () => ({ port: 12345, close() {} }),
  });
  try {
    await adapter.create({
      id: "one",
      mode: "project",
      origin: "http://127.0.0.1:5173",
      onChange() {},
    });
    await adapter.create({ id: "two", mode: "research", onChange() {} });
    assert.notEqual(partitions[0], partitions[1]);
    assert.ok(partitions.every((id) => !id.startsWith("persist:")));
    const permitted = (
      index,
      url,
      method = "GET",
      resourceType = "mainFrame",
    ) => {
      let result;
      sessions[index].handlers.request(
        { url, method, resourceType },
        (value) => (result = !value.cancel),
      );
      return result;
    };
    assert.equal(permitted(0, "http://127.0.0.1:5173/page"), true);
    assert.equal(permitted(0, "http://127.0.0.1:43110/api/state"), false);
    assert.equal(
      permitted(0, "http://127.0.0.1:5173/frame", "GET", "subFrame"),
      false,
    );
    assert.equal(permitted(1, "https://example.com/news"), true);
    assert.equal(
      permitted(1, "https://example.com/news", "POST", "xhr"),
      false,
    );
    assert.equal(permitted(1, "https://example.com/login"), false);
    assert.equal(permitted(1, "file:///secret"), false);
    assert.equal(sessions[1].handlers.proxy.proxyBypassRules, "<-loopback>");
    let headers;
    sessions[1].handlers.headers(
      {
        requestHeaders: {
          Cookie: "secret",
          Authorization: "secret",
          Referer: "private",
          Accept: "text/html",
        },
      },
      (value) => (headers = value.requestHeaders),
    );
    assert.deepEqual(headers, { Accept: "text/html" });
    assert.equal(sessions[1].handlers.check(), false);
  } finally {
    adapter.close();
  }
});
