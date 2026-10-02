import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import {
  parseBrowserRequest,
  browserToolReceipt,
} from "../apps/host/browser-agent.mjs";

const request = (value) =>
  "```nakama-browser\n" + JSON.stringify(value) + "\n```";
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Fixture timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(
  t,
  { role = "research", device = false, service = false } = {},
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-browser-agent-")),
    calls = [],
    actions = [];
  const host = await new NakamaHost({
    dataDir: dir,
    runAgent: async (provider, options) => {
      const run = { provider, options, stopped: false };
      calls.push(run);
      return {
        stop() {
          run.stopped = true;
        },
      };
    },
    browserStudioAdapter: { available: true, close() {} },
  }).init();
  if (device)
    host.store.state.devices.push({
      id: "phone",
      platform: "android",
      permissions: {
        browserControl: true,
        googleAccess: true,
        projectAccess: true,
      },
    });
  host.browserStudio.agentAction = async (body, context) => {
    actions.push({ body, context });
    return body.action === "screenshot"
      ? {
          sessionId: "session",
          image: "data:image/jpeg;base64,SYNTHETIC-PRIVATE-PIXELS",
          width: 100,
          height: 100,
          capturedAt: "fixture",
        }
      : {
          session: {
            id: "session",
            mode: "research",
            status: "ready",
            tainted: false,
            tabs: [],
            activeTabId: "tab",
          },
        };
  };
  const task = {
    id: "task",
    status: "queued",
    routingRole: role,
    requestedBy: device ? "phone" : "desktop",
    output: "",
    title: "Fixture browser task",
    createdAt: new Date().toISOString(),
    ...(service ? { projectId: "project" } : {}),
  };
  let paused;
  if (service)
    host.store.state.projects.push({
      id: "project",
      name: "Fixture",
      path: dir,
    });
  await host.store.change((state) => state.tasks.push(task));
  await host.startAgent({ id: "codex" }, task, {
    prompt: "Synthetic fixture only",
    cwd: dir,
    ...(service
      ? {
          serviceTools: {
            principal: { kind: "owner", id: "desktop" },
            projectId: "project",
          },
          guard() {
            if (paused) throw new Error("Coordinator awaiting approval");
          },
          onServicePause: async (receipt) => {
            paused = receipt;
          },
        }
      : {}),
  });
  t.after(async () => {
    await host.close();
    await host.store.queue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { host, task, calls, actions, paused: () => paused };
}
test("browser tool grammar rejects ambiguous/multiple requests and receipts never carry pixels or private tabs", () => {
  assert.equal(parseBrowserRequest("An ordinary answer."), null);
  assert.throws(() =>
    parseBrowserRequest(
      "First\n" + request({ action: "read", sessionId: "s" }),
    ),
  );
  assert.throws(() =>
    parseBrowserRequest(request({ action: "evaluate", code: "arbitrary" })),
  );
  assert.throws(() =>
    parseBrowserRequest(
      request({ action: "read", sessionId: "s", __unexpected: true }),
    ),
  );
  assert.deepEqual(
    browserToolReceipt({
      session: { id: "s", tainted: true, tabs: [{ url: "private" }] },
    }).session.tabs,
    [],
  );
  assert.ok(
    !JSON.stringify(
      browserToolReceipt({ image: "SECRETPIXELS", width: 1, height: 1 }),
    ).includes("SECRETPIXELS"),
  );
});
test("research tool loop keeps a real running task, consumes actual receipts, excludes image bytes, then delivers once", async (t) => {
  const f = await fixture(t);
  assert.match(f.calls[0].options.prompt, /nakama-browser/);
  f.calls[0].options.onOutput("tool stream must not leak");
  f.calls[0].options.onComplete({
    code: 0,
    text: request({
      action: "create",
      mode: "research",
      url: "https://example.com",
    }),
  });
  await until(() => f.calls.length === 2);
  assert.equal(f.task.status, "running");
  assert.equal(f.actions[0].context.taskId, "task");
  assert.match(f.calls[1].options.prompt, /Untrusted browser evidence/);
  f.calls[1].options.onComplete({
    code: 0,
    text: request({ action: "screenshot", sessionId: "session" }),
  });
  await until(() => f.calls.length === 3);
  assert.ok(!f.calls[2].options.prompt.includes("SYNTHETIC-PRIVATE-PIXELS"));
  f.calls[2].options.onComplete({ code: 0, text: "Verified fixture result." });
  await until(() => f.task.status === "completed");
  assert.equal(f.task.browserSteps.length, 2);
  assert.equal(f.task.output, "Verified fixture result.");
  assert.equal(
    f.host.store.state.messages.filter((row) => row.taskId === "task").length,
    1,
  );
});
test("fast interaction remains one model call and receives no browser tool instructions", async (t) => {
  const f = await fixture(t, { role: "interaction" });
  assert.ok(!f.calls[0].options.prompt.includes("nakama-browser"));
  f.calls[0].options.onComplete({ code: 0, text: "Hello." });
  await until(() => f.task.status === "completed");
  assert.equal(f.calls.length, 1);
  assert.equal(f.actions.length, 0);
});
test("revocation during a browser call drops its receipt and never launches another model", async (t) => {
  const f = await fixture(t, { device: true });
  let release;
  f.host.browserStudio.agentAction = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.calls[0].options.onComplete({
    code: 0,
    text: request({ action: "create", mode: "research" }),
  });
  await until(() => release);
  f.host.store.state.devices[0].permissions.googleAccess = false;
  release({ status: "ready", text: "late private data" });
  await until(() => f.task.status === "failed");
  assert.equal(f.calls.length, 1);
  assert.ok(
    !JSON.stringify(f.host.store.state.messages).includes("late private data"),
  );
});
test("stop during a pending browser operation finishes once and suppresses late relaunch", async (t) => {
  const f = await fixture(t);
  let release;
  f.host.browserStudio.agentAction = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.calls[0].options.onComplete({
    code: 0,
    text: request({ action: "create", mode: "research" }),
  });
  await until(() => release);
  f.host.runs.get("task").stop();
  await until(() => f.task.status === "stopped");
  release({ status: "ready" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.calls.length, 1);
  assert.equal(f.task.status, "stopped");
});
test("browser loop enforces twelve calls and cannot repeatedly relaunch forever", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 13; index++) {
    await until(() => f.calls.length > index);
    f.calls[index].options.onComplete({
      code: 0,
      text: request({ action: "read", sessionId: "session" }),
    });
  }
  await until(() => f.task.status === "failed");
  assert.equal(f.actions.length, 12);
  assert.equal(f.calls.length, 13);
  assert.match(f.task.error, /limit reached/);
});

test("explicit service coordinator pauses on an exact PC approval and finishes its task without a misleading provider success", async (t) => {
  const f = await fixture(t, { role: "delivery_manager", service: true });
  const plan = {
    id: "plan",
    hash: "hash",
    projectId: "project",
    provider: "vercel",
    accountId: "account",
    action: "vercel.project.create",
    settings: { name: "fixture" },
    summary: "Create fixture",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  f.host.provisioning.listPlans = () => [plan];
  f.host.provisioning.listOperations = () => [];
  f.host.provisioning.execute = async () => {
    throw new Error("No provider write is allowed in this fixture");
  };
  assert.match(f.calls[0].options.prompt, /nakama-service/);
  f.calls[0].options.onComplete({
    code: 0,
    text: '```nakama-service\n{"action":"execute","planId":"plan","planHash":"hash"}\n```',
  });
  await until(() => f.task.status === "completed");
  assert.ok(f.paused().pendingApprovalId);
  assert.equal(f.calls.length, 1);
  assert.match(f.task.output, /waiting for its exact PC approval/);
  assert.equal(f.host.store.state.approvals[0].status, "pending");
  assert.equal(f.task.serviceSteps[0].approvalId, f.paused().pendingApprovalId);
});
