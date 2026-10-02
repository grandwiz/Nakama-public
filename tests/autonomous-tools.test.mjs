import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAutonomousTools } from "../apps/host/autonomous-tools.mjs";

const OWNER = { kind: "owner", id: "desktop" };
const PHONE = { kind: "device", id: "phone" };
const request = (tool, args = {}) => ({ tool, arguments: args });
async function fixture(
  t,
  {
    principal = OWNER,
    goal = "Research my selected project and read my email and calendar.",
  } = {},
) {
  const dir = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "nakama-autonomous-tools-"),
  );
  const root = path.join(dir, "projects"),
    folder = path.join(root, "fixture");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "index.html"),
    "<button>Fixture</button>",
  );
  const project = { id: "project", path: folder, name: "Synthetic project" };
  const record = {
    id: "run",
    requestedBy: principal.id,
    goal,
    projectId: project.id,
    status: "running",
  };
  const task = {
    id: "task",
    autonomousRunId: record.id,
    projectId: project.id,
    requestedBy: principal.id,
    status: "running",
  };
  const state = {
    config: { workspaceRoot: root },
    projects: [project],
    tasks: [task],
    devices: [
      {
        id: PHONE.id,
        platform: "android",
        permissions: {
          googleAccess: true,
          projectAccess: true,
          browserControl: true,
        },
      },
    ],
    googleAccounts: [
      {
        id: "account",
        label: "Synthetic account",
        email: "person@example.invalid",
        services: ["gmail", "calendar"],
        token: "MUST_NOT_LEAK",
      },
    ],
  };
  let stopped = false;
  const calls = [];
  const host = {
    store: { state },
    project(id) {
      assert.equal(id, project.id);
      return project;
    },
    device(id) {
      const device = state.devices.find((entry) => entry.id === id);
      if (!device) throw new Error("Missing device");
      return device;
    },
    google: {
      account(id, service) {
        const account = state.googleAccounts.find(
          (item) => item.id === id && item.services.includes(service),
        );
        if (!account) throw new Error("Unknown account");
        return account;
      },
    },
    async dispatch(method, route, body, actor) {
      calls.push({ method, route, body, actor });
      assert.equal(
        method,
        "GET",
        "Autonomous read tools must never mutate services",
      );
      if (route.includes("/messages"))
        return {
          messages: [
            {
              snippet: "A synthetic receipt",
              headers: [{ name: "Subject", value: "Fixture subject" }],
            },
          ],
        };
      if (route.includes("/events"))
        return {
          items: [
            { summary: "Synthetic appointment", start: { date: "2026-10-03" } },
          ],
        };
      throw new Error("Unexpected tool route");
    },
    browserStudio: {
      adapter: { available: true },
      allowed(actor) {
        return (
          actor.kind === "owner" || state.devices[0].permissions.browserControl
        );
      },
      async agentAction(body, context) {
        calls.push({ body, context });
        return body.action === "create"
          ? {
              session: {
                id: "session",
                mode: body.mode,
                status: "ready",
                tainted: false,
                activeTabId: "tab",
                tabs: [
                  {
                    id: "tab",
                    title: "Fixture",
                    url: "https://example.invalid/",
                  },
                ],
              },
            }
          : {
              sessionId: "session",
              tabId: "tab",
              status: "ready",
              text: "Current synthetic page",
              elements: [{ id: "0", tag: "button", text: "Continue" }],
              applied: body.action !== "read",
            };
      },
    },
  };
  const context = {
    record,
    taskId: task.id,
    principal,
    guard() {
      if (stopped) throw new Error("Stopped task");
    },
  };
  const tools = createAutonomousTools(host);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return {
    host,
    state,
    project,
    record,
    task,
    context,
    calls,
    tools,
    folder,
    stop() {
      stopped = true;
    },
  };
}

test("autonomous capability catalogue exposes only goal-scoped read metadata and never account secrets", async (t) => {
  const f = await fixture(t);
  const catalogue = f.tools.catalogue(f.record, OWNER);
  assert.deepEqual(
    catalogue.tools.map((tool) => tool.tool),
    ["browser", "read_email", "read_calendar", "project_files", "project_read"],
  );
  assert.equal(JSON.stringify(catalogue).includes("MUST_NOT_LEAK"), false);
  assert.deepEqual(f.tools.catalogue(undefined, OWNER).accounts, []);
  f.record.goal = "Research a public article.";
  const limited = f.tools.catalogue(f.record, OWNER);
  assert.deepEqual(limited.accounts, []);
  assert.equal(
    limited.tools.some((tool) => tool.tool === "read_email"),
    false,
  );
});

test("autonomous tools reject mutations, arbitrary routes and client-supplied task scope", async (t) => {
  const f = await fixture(t);
  for (const tool of [
    "send_email",
    "create_event",
    "shell",
    "service",
    "phone_action",
    "browser_evaluate",
  ])
    await assert.rejects(f.tools.execute(request(tool), f.context));
  for (const candidate of [
    { ...request("read_email", { accountId: "account" }), projectId: "other" },
    request("read_email", {
      accountId: "account",
      url: "https://arbitrary.invalid",
    }),
    request("project_read", { path: "index.html", projectId: "other" }),
    request("browser", { action: "create", mode: "private" }),
    request("browser", { action: "evaluate", code: "arbitrary()" }),
    request("browser", {
      action: "type",
      sessionId: "s",
      elementId: "0",
      text: "api_key=syntheticsecret",
    }),
  ])
    await assert.rejects(f.tools.execute(candidate, f.context));
  assert.equal(f.calls.length, 0);
});

test("mail/calendar reads are validated against the original goal and preserve the requester", async (t) => {
  const f = await fixture(t, { principal: PHONE });
  const email = await f.tools.execute(
    request("read_email", { accountId: "account", query: "subject:fixture" }),
    f.context,
  );
  assert.equal(email.status, "completed");
  assert.match(email.observation.text, /Fixture subject/);
  const calendar = await f.tools.execute(
    request("read_calendar", { accountId: "account" }),
    f.context,
  );
  assert.equal(calendar.status, "completed");
  assert.match(calendar.observation.text, /Synthetic appointment/);
  assert.ok(
    f.calls.every((call) => call.actor === PHONE && call.method === "GET"),
  );
  f.record.goal = "Research a public page. Do not read my email.";
  await assert.rejects(
    f.tools.execute(request("read_email", { accountId: "account" }), f.context),
  );
  assert.equal(f.calls.length, 2);
});

test("a tool requires its actual active coordinator task, original requester and guard", async (t) => {
  const f = await fixture(t);
  const read = request("project_read", { path: "index.html" });
  await assert.rejects(
    f.tools.execute(read, { ...f.context, guard: undefined }),
  );
  await assert.rejects(
    f.tools.execute(read, { ...f.context, taskId: "invented" }),
  );
  await assert.rejects(
    f.tools.execute(read, { ...f.context, principal: PHONE }),
  );
  f.task.autonomousRunId = "different-run";
  await assert.rejects(f.tools.execute(read, f.context));
  f.task.autonomousRunId = f.record.id;
  f.task.status = "completed";
  await assert.rejects(f.tools.execute(read, f.context));
  f.task.status = "running";
  f.stop();
  await assert.rejects(f.tools.execute(read, f.context), /Stopped/);
});

test("browser calls use the actual task identity and screenshots/private data cannot enter receipts", async (t) => {
  const f = await fixture(t);
  await f.tools.execute(
    request("browser", {
      action: "create",
      mode: "research",
      url: "https://example.invalid",
    }),
    f.context,
  );
  assert.deepEqual(f.calls[0].context, { taskId: "task", principal: OWNER });
  f.host.browserStudio.agentAction = async () => ({
    sessionId: "session",
    image: "PRIVATE_IMAGE_BYTES",
    width: 1,
    height: 1,
    token: "PRIVATE_TOKEN",
  });
  const screenshot = await f.tools.execute(
    request("browser", { action: "screenshot", sessionId: "session" }),
    f.context,
  );
  assert.equal(JSON.stringify(screenshot).includes("PRIVATE_"), false);
  f.host.browserStudio.agentAction = async () => ({
    sessionId: "session",
    status: "attention",
    text: "PRIVATE_LOGIN_TEXT",
    elements: [{ id: "0", text: "PRIVATE_FIELD" }],
    image: "PRIVATE_PIXELS",
  });
  const attention = await f.tools.execute(
    request("browser", { action: "read", sessionId: "session" }),
    f.context,
  );
  assert.equal(attention.status, "attention");
  assert.equal(JSON.stringify(attention).includes("PRIVATE_"), false);
});

for (const change of ["stop", "revoke", "goal", "project"]) {
  test(`late private tool output is discarded after ${change}`, async (t) => {
    const f = await fixture(t, { principal: PHONE });
    let release;
    f.host.browserStudio.agentAction = async () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = f.tools.execute(
      request("browser", { action: "read", sessionId: "session" }),
      f.context,
    );
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    if (change === "stop") f.stop();
    if (change === "revoke")
      f.state.devices[0].permissions.googleAccess = false;
    if (change === "goal") f.record.goal = "Changed goal";
    if (change === "project") f.project.path += "-changed";
    release({ text: "LATE_PRIVATE_CONTENT", status: "ready" });
    await assert.rejects(pending);
  });
}

test("project reads are bounded and omit sensitive, linked, binary and escaped paths", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.folder, ".env"), "SECRET=private");
  await fs.writeFile(path.join(f.folder, "credentials.json"), "private");
  await fs.writeFile(
    path.join(f.folder, "big.txt"),
    "x".repeat(128 * 1024 + 1),
  );
  await fs.writeFile(
    path.join(f.folder, "binary.txt"),
    Buffer.from([65, 0, 66]),
  );
  await fs.link(
    path.join(f.folder, "index.html"),
    path.join(f.folder, "linked.html"),
  );
  const listing = await f.tools.execute(request("project_files"), f.context);
  assert.equal(
    listing.observation.entries.some(
      (entry) => entry.name === ".env" || entry.name === "credentials.json",
    ),
    false,
  );
  for (const relative of [
    ".env",
    "credentials.json",
    "../outside",
    "C:/absolute",
    "./index.html",
    "big.txt",
    "binary.txt",
    "linked.html",
  ])
    await assert.rejects(
      f.tools.execute(request("project_read", { path: relative }), f.context),
    );
});

test("file verification re-reads and hashes the original file rather than trusting a claimed success", async (t) => {
  const f = await fixture(t);
  const receipt = await f.tools.execute(
    request("project_read", { path: "index.html" }),
    f.context,
  );
  assert.equal(receipt.observation.content, "<button>Fixture</button>");
  const unchanged = await f.tools.verify(receipt, f.context);
  assert.equal(unchanged.verified, true);
  assert.equal(unchanged.observation.scope, "file_unchanged");
  assert.notEqual(unchanged.completionEligible, true);
  await fs.writeFile(
    path.join(f.folder, "index.html"),
    "Updated after observation",
  );
  const changed = await f.tools.verify(receipt, f.context);
  assert.equal(changed.verified, false);
  assert.equal(changed.observation.scope, "file_changed");
});

test("browser input verification returns fresh evidence without certifying an arbitrary goal", async (t) => {
  const f = await fixture(t);
  const receipt = await f.tools.execute(
    request("browser", {
      action: "click",
      sessionId: "session",
      elementId: "0",
    }),
    f.context,
  );
  const verified = await f.tools.verify(receipt, f.context);
  assert.equal(f.calls[1].body.action, "read");
  assert.equal(verified.verified, false);
  assert.equal(verified.observation.scope, "fresh_observation_only");
  assert.match(verified.observation.result.text, /Current synthetic page/);
  assert.notEqual(verified.completionEligible, true);
});

test("a late Gmail result is discarded after personal access revocation", async (t) => {
  const f = await fixture(t, { principal: PHONE });
  let release;
  f.host.dispatch = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = f.tools.execute(
    request("read_email", { accountId: "account" }),
    f.context,
  );
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  f.state.devices[0].permissions.projectAccess = false;
  release({ messages: [{ snippet: "LATE_PRIVATE_EMAIL", headers: [] }] });
  await assert.rejects(pending);
});

test("large Unicode files and browser element sets fit the durable observation budget with explicit truncation", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.folder, "large.txt"), "漢字🙂".repeat(6000));
  const file = await f.tools.execute(
    request("project_read", { path: "large.txt" }),
    f.context,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(file.observation)) <= 18000);
  assert.equal(file.observation.truncated, true);
  assert.equal(file.reference.sha256.length, 64);
  f.host.browserStudio.agentAction = async () => ({
    sessionId: "session",
    tabId: "tab",
    text: "漢字🙂".repeat(6000),
    elements: Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      tag: "a",
      text: "漢字".repeat(80),
      href: "https://example.invalid/" + "x".repeat(1900),
    })),
  });
  const browser = await f.tools.execute(
    request("browser", { action: "read", sessionId: "session" }),
    f.context,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(browser.observation)) <= 18000);
  assert.equal(browser.observation.truncated, true);
});
