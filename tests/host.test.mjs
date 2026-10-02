import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { NakamaHost } from "../apps/host/host.mjs";
import { digest, within, boundedJson } from "../apps/host/security.mjs";

// Actual 2x2 JPEG from disposable Chromium; COM payload deliberately resembles
// a credential only after base64 encoding, and must remain opaque image bytes.
const screenshotJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJcA7Hn/2Q==",
  "base64",
);
const screenshotWithComment = Buffer.concat([
  screenshotJpeg.subarray(0, 2),
  Buffer.from([0xff, 0xfe, 0, 63]),
  Buffer.from("AIza" + "A".repeat(28), "base64"),
  Buffer.alloc(37, 0xff),
  screenshotJpeg.subarray(2),
]);
const screenshotData = (bytes = screenshotJpeg) => ({
  kind: "browser_screenshot",
  mimeType: "image/jpeg",
  dataUrl: "data:image/jpeg;base64," + bytes.toString("base64"),
  width: 2,
  height: 2,
  url: "https://example.test/fixture",
  title: "Fixture",
  capturedAt: "2026-09-29T12:00:00.000Z",
});

async function fixture(t, options = {}) {
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-host-")),
    vaultValues = new Map();
  const vault = {
    get: async (key) => vaultValues.get(key) || null,
    set: async (key, value) => {
      vaultValues.set(key, value);
    },
  };
  const host = await new NakamaHost({
    dataDir: path.join(dir, "data"),
    vault,
    ...options,
  }).init();
  const root = path.join(dir, "projects");
  await fs.mkdir(root);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot: root });
  t.after(async () => {
    await host.close();
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-host-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { host, root, dir, vaultValues };
}
async function pair(host, platform = "android") {
  const ticket = await host.dispatch("POST", "/api/pairing/tickets", {
    platform,
  });
  const result = await host.dispatch("POST", "/api/pair", {
    ticket: ticket.ticket,
    name: platform,
    platform,
  });
  return { ...result, principal: host.authenticate("Bearer " + result.token) };
}
function request(
  server,
  { method = "GET", route = "/api/state", body, token, headers = {}, ca } = {},
) {
  const payload = body === undefined ? undefined : JSON.stringify(body),
    transport = ca ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        host: "127.0.0.1",
        port: server.address().port,
        path: route,
        method,
        ca,
        headers: {
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
            headers: res.headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
async function settle(host) {
  await new Promise((resolve) => setImmediate(resolve));
  await host.store.queue;
  await new Promise((resolve) => setImmediate(resolve));
}

test("browser dropdown arguments are exact and bounded; optional approval preserves empty values", async (t) => {
  const { host } = await fixture(t),
    chrome = await pair(host, "chrome");
  const args = { tabId: 12, selector: "#colour", value: "" };
  const requestSelect = (value) =>
    host.dispatch("POST", "/api/device/actions", {
      deviceId: chrome.deviceId,
      type: "browser_select",
      args: value,
    });
  await host.dispatch("PATCH", "/api/settings", {
    confirmOrdinaryActions: true,
  });
  for (const invalid of [
    {},
    { ...args, tabId: "12" },
    { ...args, tabId: 0 },
    { ...args, tabId: 1.5 },
    { ...args, tabId: Number.MAX_SAFE_INTEGER + 1 },
    { ...args, selector: "  " },
    { ...args, selector: "x".repeat(301) },
    { ...args, selector: "#colour\0" },
    { ...args, value: null },
    { ...args, value: ["blue"] },
    { ...args, value: "x".repeat(201) },
    { ...args, value: "blue\0" },
    { ...args, approved: true },
  ])
    await assert.rejects(requestSelect(invalid), { status: 400 });
  assert.equal(host.store.state.approvals.length, 0);
  assert.equal(host.store.state.actions.length, 0);
  const approval = await requestSelect(args);
  assert.equal(approval.status, "pending");
  assert.equal(host.store.state.actions.length, 0);
  await host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
    approved: true,
    args: { ...args, value: "injected" },
  });
  const queued = await host.dispatch(
    "GET",
    "/api/device/actions?types=browser_select",
    {},
    chrome.principal,
  );
  assert.equal(queued.actions.length, 1);
  assert.deepEqual(queued.actions[0].args, args);
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
      approved: true,
    }),
    { status: 409 },
  );
  await host.dispatch("PATCH", "/api/settings", {
    confirmOrdinaryActions: false,
  });
  await requestSelect({ ...args, value: "  blue  " });
  assert.equal(host.store.state.actions.at(-1).args.value, "  blue  ");
});

test("dropdown relays retain device isolation and cannot revive revoked pending approvals", async (t) => {
  const { host } = await fixture(t),
    chrome = await pair(host, "chrome");
  const body = {
    deviceId: chrome.deviceId,
    type: "browser_select",
    args: { tabId: 12, selector: "#colour", value: "blue" },
  };
  await host.dispatch("PATCH", "/api/settings", {
    confirmOrdinaryActions: true,
  });
  for (const revoke of [false, true]) {
    const phone = await pair(host);
    await assert.rejects(
      host.dispatch("POST", "/api/device/actions", body, phone.principal),
      { status: 403 },
    );
    await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
      browserControl: true,
      googleAccess: false,
      projectAccess: false,
    });
    await assert.rejects(
      host.dispatch(
        "POST",
        "/api/device/actions",
        { ...body, deviceId: phone.deviceId },
        phone.principal,
      ),
      { status: 400 },
    );
    const approval = await host.dispatch(
      "POST",
      "/api/device/actions",
      body,
      phone.principal,
    );
    await assert.rejects(
      host.dispatch(
        "POST",
        `/api/approvals/${approval.id}/resolve`,
        { approved: true },
        phone.principal,
      ),
      { status: 403 },
    );
    if (revoke) await host.dispatch("DELETE", `/api/devices/${phone.deviceId}`);
    else
      await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
        browserControl: false,
      });
    await assert.rejects(
      host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
        approved: true,
      }),
      { status: revoke ? 404 : 403 },
    );
    assert.equal(
      host.store.state.approvals.find((item) => item.id === approval.id).status,
      "failed",
    );
  }
  assert.equal(host.store.state.actions.length, 0);
});

test("browser relay authority is rechecked after waiting for the store queue", async (t) => {
  const { host } = await fixture(t),
    chrome = await pair(host, "chrome"),
    phone = await pair(host);
  await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
    browserControl: true,
  });
  let release;
  const barrier = host.store.change(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  await new Promise((done) => setImmediate(done));
  assert.ok(release);
  const disabled = host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
    browserControl: false,
  });
  const rejected = assert.rejects(
    host.dispatch(
      "POST",
      "/api/device/actions",
      {
        deviceId: chrome.deviceId,
        type: "browser_select",
        args: { tabId: 12, selector: "#colour", value: "blue" },
      },
      phone.principal,
    ),
    { status: 403 },
  );
  release();
  await Promise.all([barrier, disabled, rejected]);
  assert.equal(host.store.state.actions.length, 0);
});

test("revoked browser relays stop redelivery but can report an already dispatched result", async (t) => {
  const { host } = await fixture(t),
    chrome = await pair(host, "chrome");
  for (const revoke of [false, true]) {
    const phone = await pair(host);
    await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
      browserControl: true,
    });
    const action = await host.dispatch(
      "POST",
      "/api/device/actions",
      {
        deviceId: chrome.deviceId,
        type: "browser_select",
        args: { tabId: 12, selector: "#colour", value: "blue" },
      },
      phone.principal,
    );
    assert.equal(
      (await host.dispatch("GET", "/api/device/actions", {}, chrome.principal))
        .actions.length,
      1,
    );
    if (revoke) await host.dispatch("DELETE", `/api/devices/${phone.deviceId}`);
    else
      await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
        browserControl: false,
      });
    assert.equal(
      (await host.dispatch("GET", "/api/device/actions", {}, chrome.principal))
        .actions.length,
      0,
    );
    assert.ok(
      host.store.state.actions.find((item) => item.id === action.id)
        .redeliveryStoppedAt,
    );
    await host.dispatch(
      "POST",
      `/api/device/actions/${action.id}/result`,
      {
        status: "completed",
        message: "Fixture had already selected the option.",
        data: { value: "blue", changed: true },
      },
      chrome.principal,
    );
    assert.equal(
      host.store.state.actions.find((item) => item.id === action.id).status,
      "completed",
    );
  }
});

test("pairing tickets are single-use, expire and are bound to the device platform", async (t) => {
  const { host } = await fixture(t),
    ticket = await host.dispatch("POST", "/api/pairing/tickets", {
      platform: "android",
    });
  await assert.rejects(
    host.pair({ ticket: ticket.ticket, name: "wrong", platform: "chrome" }),
    { status: 403 },
  );
  const results = await Promise.allSettled([
    host.pair({ ticket: ticket.ticket, name: "one", platform: "android" }),
    host.pair({ ticket: ticket.ticket, name: "two", platform: "android" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter((r) => r.status === "rejected")[0].reason.status,
    401,
  );
  const expired = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  host.tickets.get(digest(expired.ticket)).expiresAt = new Date(
    Date.now() - 1,
  ).toISOString();
  await assert.rejects(
    host.pair({ ticket: expired.ticket, name: "late", platform: "android" }),
    { status: 401 },
  );
});

test("a paired device cannot grant itself owner authority; revocation is immediate", async (t) => {
  const { host } = await fixture(t),
    device = await pair(host),
    project = await host.dispatch("POST", "/api/projects", {
      name: "Private project",
    });
  const approval = await host.dispatch(
    "POST",
    `/api/projects/${project.id}/delete-request`,
    {},
    device.principal,
  );
  for (const [method, route, body] of [
    ["PATCH", "/api/settings", { confirmOrdinaryActions: false }],
    ["POST", "/api/pairing/tickets", {}],
    ["POST", `/api/approvals/${approval.id}/resolve`, { approved: true }],
    ["DELETE", `/api/devices/${device.deviceId}`, {}],
    ["POST", "/api/providers/codex/settings", { effort: "low" }],
  ])
    await assert.rejects(host.dispatch(method, route, body, device.principal), {
      status: 403,
    });
  await host.dispatch("DELETE", `/api/devices/${device.deviceId}`);
  assert.throws(() => host.authenticate("Bearer " + device.token), {
    status: 401,
  });
  await assert.rejects(
    host.dispatch("GET", "/api/state", {}, device.principal),
    { status: 404 },
  );
  assert.ok(await fs.stat(project.path));
});

test("project deletion requires one exact owner approval and moves files to recovery", async (t) => {
  const { host, root } = await fixture(t),
    project = await host.dispatch("POST", "/api/projects", {
      name: "Keep recoverable",
    });
  const approval = await host.dispatch(
    "POST",
    `/api/projects/${project.id}/delete-request`,
  );
  assert.ok(await fs.stat(project.path));
  const results = await Promise.allSettled([
    host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
      approved: true,
      operation: { projectId: "different" },
    }),
    host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
      approved: true,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(host.store.state.projects.length, 0);
  await assert.rejects(fs.stat(project.path), { code: "ENOENT" });
  const recovered = await fs.readdir(path.join(root, ".nakama-trash"));
  assert.equal(recovered.length, 1);
  assert.match(
    await fs.readFile(
      path.join(root, ".nakama-trash", recovered[0], "README.md"),
      "utf8",
    ),
    /Keep recoverable/,
  );
});

test("rejected, expired and unavailable deployments cannot execute or be replayed", async (t) => {
  const { host } = await fixture(t),
    project = await host.dispatch("POST", "/api/projects", { name: "Deploy" });
  const rejected = await host.dispatch("POST", "/api/deployments", {
    projectId: project.id,
    provider: "vercel",
  });
  await host.dispatch("POST", `/api/approvals/${rejected.id}/resolve`, {
    approved: false,
  });
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${rejected.id}/resolve`, {
      approved: true,
    }),
    { status: 409 },
  );
  const expired = await host.dispatch("POST", "/api/deployments", {
    projectId: project.id,
    provider: "render",
  });
  host.store.state.approvals.find((a) => a.id === expired.id).expiresAt =
    new Date(0).toISOString();
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${expired.id}/resolve`, {
      approved: true,
    }),
    { status: 409 },
  );
  const notConfigured = await host.dispatch("POST", "/api/deployments", {
    projectId: project.id,
    provider: "render",
  });
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${notConfigured.id}/resolve`, {
      approved: true,
    }),
    { status: 409 },
  );
  assert.equal(
    host.store.state.approvals.find((a) => a.id === notConfigured.id).status,
    "failed",
  );
  assert.equal(host.runs.size, 0);
});

test("command requests freeze exact arguments and never run before owner approval", async (t) => {
  const { host } = await fixture(t),
    project = await host.dispatch("POST", "/api/projects", {
      name: "Command fixture",
    }),
    device = await pair(host),
    calls = [];
  host.startCommand = async (operation) => {
    calls.push(structuredClone(operation));
  };
  const args = ["-e", 'console.log("fixture")'],
    approval = await host.dispatch(
      "POST",
      "/api/commands",
      { projectId: project.id, command: process.execPath, args },
      device.principal,
    );
  args[1] = "changed after request";
  assert.equal(calls.length, 0);
  await assert.rejects(
    host.dispatch(
      "POST",
      `/api/approvals/${approval.id}/resolve`,
      { approved: true },
      device.principal,
    ),
    { status: 403 },
  );
  await host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
    approved: true,
    command: "other",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[0].args[1], 'console.log("fixture")');
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
      approved: true,
    }),
    { status: 409 },
  );
});

test("invalid multi-field mutations leave metadata and persistent state unchanged", async (t) => {
  const { host } = await fixture(t),
    project = await host.dispatch("POST", "/api/projects", {
      name: "Original",
    }),
    original = await fs.readFile(host.store.file, "utf8");
  await assert.rejects(
    host.dispatch("PATCH", `/api/projects/${project.id}`, {
      name: "Partial",
      pinned: "yes",
    }),
    { status: 400 },
  );
  await assert.rejects(
    host.dispatch("POST", "/api/providers/codex/settings", {
      selectedModel: "Partial",
      executablePath: 7,
    }),
    { status: 400 },
  );
  assert.equal(project.name, "Original");
  assert.equal(host.store.state.providers[0].selectedModel, "");
  assert.equal(await fs.readFile(host.store.file, "utf8"), original);
});

test("device jobs are filtered, redelivered, acknowledged idempotently and isolated per device", async (t) => {
  const { host } = await fixture(t),
    phone = await pair(host),
    other = await pair(host);
  const call = await host.dispatch("POST", "/api/device/actions", {
    deviceId: phone.deviceId,
    type: "call",
    args: { number: "test-fixture" },
  });
  const tap = await host.dispatch("POST", "/api/device/actions", {
    deviceId: phone.deviceId,
    type: "ui_tap",
    args: { x: 1, y: 1 },
  });
  let result = await host.dispatch(
    "GET",
    "/api/device/actions?types=ui_tap,ui_type,ui_scroll,ui_back",
    {},
    phone.principal,
  );
  assert.deepEqual(
    result.actions.map((a) => a.id),
    [tap.id],
  );
  result = await host.dispatch(
    "GET",
    "/api/device/actions?excludeTypes=ui_tap,ui_type,ui_scroll,ui_back",
    {},
    phone.principal,
  );
  assert.deepEqual(
    result.actions.map((a) => a.id),
    [call.id],
  );
  assert.deepEqual(
    (
      await host.dispatch(
        "GET",
        "/api/device/actions?types=call",
        {},
        phone.principal,
      )
    ).actions.map((a) => a.id),
    [call.id],
  );
  assert.deepEqual(
    (await host.dispatch("GET", "/api/device/actions", {}, other.principal))
      .actions,
    [],
  );
  await assert.rejects(
    host.dispatch(
      "GET",
      "/api/device/actions?types=invalid",
      {},
      phone.principal,
    ),
    { status: 400 },
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      `/api/device/actions/${call.id}/result`,
      { status: "completed", message: "done" },
      other.principal,
    ),
    { status: 404 },
  );
  const ack = {
    status: "completed",
    message: "done",
    data: { text: "page content", count: 1 },
  };
  assert.deepEqual(
    await host.dispatch(
      "POST",
      `/api/device/actions/${call.id}/result`,
      ack,
      phone.principal,
    ),
    { recorded: true },
  );
  const count = host.store.state.messages.length;
  assert.deepEqual(
    await host.dispatch(
      "POST",
      `/api/device/actions/${call.id}/result`,
      { ...ack, data: { count: 1, text: "page content" } },
      phone.principal,
    ),
    { recorded: true },
  );
  assert.equal(host.store.state.messages.length, count);
  await assert.rejects(
    host.dispatch(
      "POST",
      `/api/device/actions/${call.id}/result`,
      { ...ack, status: "failed" },
      phone.principal,
    ),
    { status: 409 },
  );
  assert.equal(
    (await host.dispatch("GET", "/api/actions", {}, phone.principal)).actions
      .length,
    2,
  );
  assert.equal(
    (await host.dispatch("GET", "/api/actions", {}, other.principal)).actions
      .length,
    0,
  );
  const action = host.store.state.actions.find((a) => a.id === tap.id);
  action.expiresAt = new Date(0).toISOString();
  assert.deepEqual(
    (await host.dispatch("GET", "/api/device/actions", {}, phone.principal))
      .actions,
    [],
  );
  assert.equal(action.status, "expired");
});

test("oversize action data and invalid messages do not consume the result slot", async (t) => {
  const { host } = await fixture(t),
    phone = await pair(host),
    job = await host.dispatch("POST", "/api/device/actions", {
      deviceId: phone.deviceId,
      type: "contacts_search",
      args: { name: "fixture" },
    });
  await host.dispatch("GET", "/api/device/actions", {}, phone.principal);
  for (const body of [
    { status: "completed", message: "x".repeat(2001) },
    {
      status: "completed",
      message: "done",
      data: { text: "x".repeat(262144) },
    },
  ])
    await assert.rejects(
      host.dispatch(
        "POST",
        `/api/device/actions/${job.id}/result`,
        body,
        phone.principal,
      ),
      { status: 400 },
    );
  assert.equal(
    host.store.state.actions.find((a) => a.id === job.id).status,
    "dispatched",
  );
});

test("pending phone approvals fail if target device has been revoked", async (t) => {
  const { host } = await fixture(t),
    phone = await pair(host);
  await host.dispatch("PATCH", "/api/settings", {
    confirmOrdinaryActions: true,
  });
  const approval = await host.dispatch("POST", "/api/device/actions", {
    deviceId: phone.deviceId,
    type: "sms",
    args: { number: "fixture", message: "fixture" },
  });
  await host.dispatch("DELETE", `/api/devices/${phone.deviceId}`);
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
      approved: true,
    }),
    { status: 404 },
  );
  assert.equal(host.store.state.actions.length, 0);
});

test("stop during delayed agent launch cannot be overwritten by late completion", async (t) => {
  let release,
    callbacks,
    stops = 0;
  const { host } = await fixture(t, {
    runAgent: async (_provider, options) => {
      callbacks = options;
      return new Promise((resolve) => {
        release = () =>
          resolve({
            stop() {
              stops++;
              options.onComplete({ code: 0, text: "late success" });
            },
          });
      });
    },
  });
  const { taskIds } = await host.dispatch("POST", "/api/chat", {
    message: "test delayed launch",
  });
  await settle(host);
  assert.ok(release);
  await host.dispatch("POST", `/api/tasks/${taskIds[0]}/stop`);
  release();
  await settle(host);
  callbacks.onOutput("ignored after stop");
  callbacks.onComplete({
    code: 0,
    text: "late secret sk-test-12345678901234567890",
  });
  await settle(host);
  assert.equal(stops, 1);
  assert.equal(host.store.state.tasks.at(-1).status, "stopped");
  assert.equal(host.runs.size, 0);
  assert.equal(host.store.state.messages.length, 1);
  assert.equal(host.store.state.tasks.at(-1).output, "");
});

test("provider completion is once-only and redacts stored final messages", async (t) => {
  const { host } = await fixture(t, {
    runAgent: async (_provider, options) => {
      options.onComplete({ code: 0, text: "token: secret-test-value" });
      options.onComplete({ code: 1, text: "duplicate" });
      return { stop() {} };
    },
  });
  await host.dispatch("POST", "/api/chat", { message: "fixture" });
  await settle(host);
  for (let i = 0; i < 100 && host.runs.size; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(host.runs.size, 0);
  assert.equal(host.store.state.messages.length, 2);
  assert.match(host.store.state.messages[1].content, /\[redacted\]/);
  assert.equal(host.store.state.tasks[0].status, "completed");
});

test("stop remains available while an action plan is executing and prevents its next effect", async (t) => {
  let complete, release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const { host } = await fixture(t, {
    runAgent: async (_provider, options) => {
      complete = options.onComplete;
      return { stop() {} };
    },
  });
  const dispatch = host.dispatch.bind(host),
    created = [];
  host.dispatch = async (method, route, body, principal) => {
    if (method === "POST" && route === "/api/projects") {
      created.push(body.name);
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return dispatch(method, route, body, principal);
  };
  const { taskIds } = await host.dispatch("POST", "/api/chat", {
    message: "Create projects First and Second",
    mode: "act",
  });
  await settle(host);
  complete({
    code: 0,
    text:
      "```nakama-actions\n" +
      JSON.stringify({
        summary: "Create two projects",
        actions: [
          { type: "create_project", name: "First" },
          { type: "create_project", name: "Second" },
        ],
      }) +
      "\n```",
  });
  await entered;
  assert.equal(host.runs.has(taskIds[0]), true);
  await host.dispatch("POST", `/api/tasks/${taskIds[0]}/stop`);
  release();
  for (let i = 0; i < 100 && host.runs.has(taskIds[0]); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  await settle(host);
  assert.deepEqual(created, ["First"]);
  assert.equal(host.store.state.tasks[0].status, "stopped");
  assert.deepEqual(
    host.store.state.tasks[0].actionOutcomes.map((outcome) => outcome.status),
    ["completed", "stopped"],
  );
  assert.equal(host.store.state.projects.length, 1);
  assert.equal(host.runs.size, 0);
});

test("a task enqueued during shutdown releases its run and build lock without starting a provider", async (t) => {
  let launches = 0;
  const { host } = await fixture(t, {
    runAgent: async () => {
      launches++;
      return { stop() {} };
    },
  });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Closing fixture",
  });
  const task = {
    id: "closing-task",
    projectId: project.id,
    status: "queued",
    output: "",
  };
  host.store.state.tasks.push(task);
  host.building.add(project.id);
  host.closing = true;
  await host.startAgent(host.store.state.providers[0], task, {
    build: { project },
  });
  assert.equal(launches, 0);
  assert.equal(host.runs.size, 0);
  assert.equal(host.building.size, 0);
  assert.equal(task.status, "stopped");
});

test("parallel requests cannot exceed the global task limit", async (t) => {
  const { host } = await fixture(t, { runAgent: async () => ({ stop() {} }) });
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      host.dispatch("POST", "/api/chat", { message: "bounded fixture" }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 6);
  assert.equal(
    results.filter((r) => r.status === "rejected" && r.reason.status === 429)
      .length,
    2,
  );
  assert.equal(host.store.state.tasks.length, 6);
  assert.equal(host.store.state.messages.length, 6);
});

test("Chrome bridge binds loopback, separates credentials and blocks web origins/rebinding", async (t) => {
  const { host, vaultValues } = await fixture(t);
  await host.listenBrowserBridge({ port: 0 });
  assert.equal(host.browserServer.address().address, "127.0.0.1");
  const android = await pair(host),
    chromeTicket = await host.dispatch("POST", "/api/pairing/tickets", {
      platform: "chrome",
    });
  assert.equal(chromeTicket.port, host.browserServer.address().port);
  assert.equal(
    (
      await request(host.browserServer, {
        method: "POST",
        route: "/api/pair",
        body: {
          ticket: chromeTicket.ticket,
          name: "wrong",
          platform: "android",
        },
      })
    ).status,
    403,
  );
  const paired = await request(host.browserServer, {
    method: "POST",
    route: "/api/pair",
    body: { ticket: chromeTicket.ticket, name: "Browser", platform: "chrome" },
    headers: { Origin: "chrome-extension://" + "a".repeat(32) },
  });
  assert.equal(paired.status, 200);
  assert.equal(
    (await request(host.browserServer, { token: android.token })).status,
    403,
  );
  assert.equal(
    (await request(host.browserServer, { token: paired.body.token })).status,
    403,
  );
  assert.equal(
    (
      await request(host.browserServer, {
        route: "/api/device/actions",
        token: paired.body.token,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(host.browserServer, {
        token: paired.body.token,
        headers: { Origin: "https://malicious.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(host.browserServer, {
        token: paired.body.token,
        headers: { Host: "attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal((await request(host.browserServer)).status, 401);
  await host.listen({ port: 0 });
  const ca = JSON.parse(vaultValues.get("host-tls")).cert;
  assert.equal(
    (await request(host.server, { ca, token: paired.body.token })).status,
    403,
  );
  assert.equal(
    (await request(host.server, { ca, token: android.token })).status,
    200,
  );
});
test("device permissions are owner-managed and Chrome has no project or Google authority", async (t) => {
  const { host } = await fixture(t),
    android = await pair(host),
    chrome = await pair(host, "chrome"),
    otherPhone = await pair(host);
  for (const route of ["/api/state", "/api/google/accounts", "/api/media/jobs"])
    await assert.rejects(host.dispatch("GET", route, {}, chrome.principal), {
      status: 403,
    });
  await assert.rejects(
    host.dispatch(
      "POST",
      "/api/projects",
      { name: "forbidden" },
      chrome.principal,
    ),
    { status: 403 },
  );
  await assert.rejects(
    host.dispatch(
      "PATCH",
      `/api/devices/${android.deviceId}`,
      { browserControl: true },
      android.principal,
    ),
    { status: 403 },
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      "/api/device/actions",
      { deviceId: chrome.deviceId, type: "browser_tabs", args: {} },
      android.principal,
    ),
    { status: 403 },
  );
  await host.dispatch("PATCH", `/api/devices/${android.deviceId}`, {
    browserControl: true,
    googleAccess: false,
    projectAccess: false,
  });
  await host.dispatch(
    "POST",
    "/api/device/actions",
    { deviceId: chrome.deviceId, type: "browser_tabs", args: {} },
    android.principal,
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      "/api/device/actions",
      { deviceId: otherPhone.deviceId, type: "call", args: {} },
      android.principal,
    ),
    { status: 403 },
  );
  await assert.rejects(
    host.dispatch("GET", "/api/google/accounts", {}, android.principal),
    { status: 403 },
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      "/api/projects",
      { name: "no project access" },
      android.principal,
    ),
    { status: 403 },
  );
  const state = await host.dispatch("GET", "/api/state", {}, android.principal);
  assert.deepEqual(state.projects, []);
  assert.equal(state.config.workspaceRoot, "");
});

test("disabling Google access hides all privileged history and blocks CLI workers while retaining own device receipts", async (t) => {
  const prompts = [];
  const { host } = await fixture(t, {
    runAgent: async (_provider, options) => {
      prompts.push(options.prompt);
      options.onComplete({ code: 0, text: "Restricted device reply" });
      return { stop() {} };
    },
  });
  const phone = await pair(host),
    other = await pair(host),
    secret = "PRIVATE_MAILBOX_SENTINEL";
  await host.store.change((s) => {
    s.messages.push({
      id: "legacy",
      role: "assistant",
      projectId: null,
      content: secret,
    });
    s.messages.push({
      id: "other-restricted",
      role: "assistant",
      projectId: null,
      content: secret,
      restrictedToDevice: other.deviceId,
    });
    s.messages.push({
      id: "old-own-tag",
      role: "assistant",
      content: secret,
      restrictedToDevice: phone.deviceId,
    });
    s.tasks.push({
      id: "owner-task",
      status: "completed",
      output: secret,
      actionOutcomes: [{ description: secret }],
    });
    s.approvals.push({
      id: "mail-approval",
      status: "pending",
      type: "google_action",
      description: secret,
    });
    s.googleAccounts = [{ id: "private-account", email: secret }];
    s.connections.find((c) => c.id === "gmail").accountLabel = secret;
  });
  await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
    googleAccess: false,
  });
  const before = await host.dispatch("GET", "/api/state", {}, phone.principal);
  assert.equal(JSON.stringify(before).includes(secret), false);
  for (const mode of ["discuss", "build", "act"])
    await assert.rejects(
      host.dispatch(
        "POST",
        "/api/chat",
        { message: "Explain my project structure", mode },
        phone.principal,
      ),
      { status: 403 },
    );
  assert.equal(prompts.length, 0);
  const job = await host.dispatch("POST", "/api/device/actions", {
    deviceId: phone.deviceId,
    type: "contacts_search",
    args: { name: "Fixture" },
  });
  await host.dispatch("GET", "/api/device/actions", {}, phone.principal);
  await host.dispatch(
    "POST",
    `/api/device/actions/${job.id}/result`,
    { status: "completed", message: "Own phone result" },
    phone.principal,
  );
  const after = await host.dispatch("GET", "/api/state", {}, phone.principal);
  assert.equal(JSON.stringify(after).includes(secret), false);
  assert.equal(after.messages.length, 1);
  assert.match(after.messages[0].content, /Own phone result/);
  assert.equal(after.tasks.length, 0);
  await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
    googleAccess: true,
  });
  await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
    googleAccess: false,
  });
  assert.equal(
    JSON.stringify(
      await host.dispatch("GET", "/api/state", {}, phone.principal),
    ).includes(secret),
    false,
  );
  assert.equal(
    JSON.stringify(await host.dispatch("GET", "/api/state")).includes(secret),
    true,
  );
});

test("a phone can stop only its own task while its project permission is enabled", async (t) => {
  let stopped = 0;
  const { host } = await fixture(t),
    phone = await pair(host),
    other = await pair(host);
  host.store.state.tasks.push(
    { id: "owned", requestedBy: phone.deviceId },
    { id: "other-task", requestedBy: other.deviceId },
  );
  for (const id of ["owned", "other-task"])
    host.runs.set(id, {
      stop: () => {
        stopped++;
        host.runs.delete(id);
      },
    });
  await assert.rejects(
    host.dispatch("POST", "/api/tasks/other-task/stop", {}, phone.principal),
    { status: 403 },
  );
  await host.dispatch("POST", "/api/tasks/owned/stop", {}, phone.principal);
  assert.equal(stopped, 1);
  await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
    projectAccess: false,
  });
  await assert.rejects(
    host.dispatch("POST", "/api/tasks/owned/stop", {}, phone.principal),
    { status: 403 },
  );
  await host.dispatch("POST", "/api/tasks/other-task/stop");
  assert.equal(stopped, 2);
  host.runs.clear();
});

test("revoking a phone or disabling its Google access cancels its running AI task", async (t) => {
  let stopped = 0;
  const { host } = await fixture(t, {
    runAgent: async () => ({
      stop() {
        stopped++;
      },
    }),
  });
  for (const revoke of [false, true]) {
    const phone = await pair(host);
    const { taskIds } = await host.dispatch(
      "POST",
      "/api/chat",
      { message: "Wait for my next instruction" },
      phone.principal,
    );
    await settle(host);
    if (revoke) await host.dispatch("DELETE", `/api/devices/${phone.deviceId}`);
    else
      await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
        googleAccess: false,
      });
    for (let i = 0; i < 100 && host.runs.has(taskIds[0]); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      host.store.state.tasks.find((task) => task.id === taskIds[0]).status,
      "stopped",
    );
  }
  assert.equal(stopped, 2);
});

test("revocation and browser permission removal discard that phones undelivered relay actions", async (t) => {
  const { host } = await fixture(t),
    chrome = await pair(host, "chrome");
  const ownerJob = await host.dispatch("POST", "/api/device/actions", {
    deviceId: chrome.deviceId,
    type: "browser_tabs",
    args: {},
  });
  for (const revoke of [false, true]) {
    const phone = await pair(host);
    await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
      browserControl: true,
    });
    const job = await host.dispatch(
      "POST",
      "/api/device/actions",
      { deviceId: chrome.deviceId, type: "browser_tabs", args: {} },
      phone.principal,
    );
    if (revoke) await host.dispatch("DELETE", `/api/devices/${phone.deviceId}`);
    else
      await host.dispatch("PATCH", `/api/devices/${phone.deviceId}`, {
        browserControl: false,
      });
    assert.equal(
      host.store.state.actions.some((action) => action.id === job.id),
      false,
    );
  }
  assert.equal(
    host.store.state.actions.some((action) => action.id === ownerJob.id),
    true,
  );
});

test("old screenshot pixels are omitted while exact acknowledgements remain idempotent", async (t) => {
  const { host } = await fixture(t),
    chrome = await pair(host, "chrome");
  let first;
  for (let i = 0; i < 12; i++) {
    const job = await host.dispatch("POST", "/api/device/actions", {
      deviceId: chrome.deviceId,
      type: "browser_screenshot",
      args: { tabId: 1 },
    });
    await host.dispatch("GET", "/api/device/actions", {}, chrome.principal);
    const result = {
      status: "completed",
      message: "Captured fixture",
      data: screenshotData(screenshotWithComment),
    };
    await host.dispatch(
      "POST",
      `/api/device/actions/${job.id}/result`,
      result,
      chrome.principal,
    );
    if (!first) first = { job, result };
  }
  assert.equal(
    host.store.state.actions.filter((action) => action.resultData).length,
    10,
  );
  const old = host.store.state.actions.find(
    (action) => action.id === first.job.id,
  );
  assert.equal(old.resultDataOmitted, true);
  assert.equal(old.resultData, undefined);
  assert.equal(old.resultDataMetadata.title, "Fixture");
  assert.equal(
    host.store.state.actions.at(-1).resultData.dataUrl,
    first.result.data.dataUrl,
  );
  const route = `/api/device/actions/${first.job.id}/result`,
    messageCount = host.store.state.messages.length;
  assert.deepEqual(
    await host.dispatch("POST", route, first.result, chrome.principal),
    { recorded: true },
  );
  assert.equal(host.store.state.messages.length, messageCount);
  await assert.rejects(
    host.dispatch(
      "POST",
      route,
      { ...first.result, data: undefined },
      chrome.principal,
    ),
    { status: 409 },
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      route,
      { ...first.result, data: { ...first.result.data, title: "Changed" } },
      chrome.principal,
    ),
    { status: 409 },
  );
});

test("screenshot acknowledgement preserves exact validated JPEG bytes and rejects malformed or changed payloads", async (t) => {
  const { host } = await fixture(t),
    chrome = await pair(host, "chrome");
  const job = await host.dispatch("POST", "/api/device/actions", {
    deviceId: chrome.deviceId,
    type: "browser_screenshot",
    args: { tabId: 1 },
  });
  await host.dispatch("GET", "/api/device/actions", {}, chrome.principal);
  const route = `/api/device/actions/${job.id}/result`,
    data = screenshotData(screenshotWithComment);
  data.title = "Fixture API_KEY=private-title";
  assert.notEqual(boundedJson(data).dataUrl, data.dataUrl);
  const result = { status: "completed", message: "Screenshot ready", data };
  const stored = host.store.state.actions.find(
    (action) => action.id === job.id,
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      route,
      { ...result, data: { ...data, dataUrl: "data:image/jpeg;base64,YmFk" } },
      chrome.principal,
    ),
    { status: 400 },
  );
  assert.equal(stored.status, "dispatched");
  assert.equal(stored.resultData, undefined);
  assert.deepEqual(
    await host.dispatch("POST", route, result, chrome.principal),
    { recorded: true },
  );
  assert.equal(stored.resultData.dataUrl, data.dataUrl);
  assert.deepEqual(
    Buffer.from(stored.resultData.dataUrl.split(",")[1], "base64"),
    screenshotWithComment,
  );
  assert.equal(stored.resultData.title, "Fixture API_KEY=[redacted]");
  const originalDigest = stored.dataDigest,
    messages = host.store.state.messages.length;
  assert.deepEqual(
    await host.dispatch(
      "POST",
      route,
      { ...result, data: Object.fromEntries(Object.entries(data).reverse()) },
      chrome.principal,
    ),
    { recorded: true },
  );
  assert.equal(stored.dataDigest, originalDigest);
  assert.equal(host.store.state.messages.length, messages);
  await assert.rejects(
    host.dispatch(
      "POST",
      route,
      { ...result, data: { ...data, dataUrl: screenshotData().dataUrl } },
      chrome.principal,
    ),
    { status: 409 },
  );
  assert.equal(stored.dataDigest, originalDigest);
});
