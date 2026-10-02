import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectDeliveries } from "../apps/host/project-deliveries.mjs";
import { ProjectGrants } from "../apps/host/project-grants.mjs";
import { ProjectPreviews } from "../apps/host/project-previews.mjs";
import { projectSnapshot } from "../apps/host/build-files.mjs";

const OWNER = { kind: "owner", id: "desktop" },
  PHONE = { kind: "device", id: "phone" };
const outcome = (questions) =>
  "```nakama-delivery\n" +
  JSON.stringify({
    summary: "Static fixture done; live acceptance remains unverified.",
    questions,
    acceptance: ["User acceptance pending"],
  }) +
  "\n```";
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Fixture timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-delivery-")),
    projectPath = path.join(dir, "project");
  await fs.mkdir(projectPath);
  await fs.writeFile(path.join(projectPath, "index.html"), "Reviewed fixture");
  const project = {
    id: "project",
    name: "Fixture",
    path: projectPath,
    reportSettings: { automaticEnabled: false },
  };
  const workflow = {
    id: "workflow",
    projectId: "project",
    status: "completed",
    message: "Deliver fixture",
    delivery: "Both static reviews passed.",
    taskIds: ["review"],
    snapshot: [...(await projectSnapshot(projectPath))],
  };
  const state = {
    config: {
      workspaceRoot: dir,
      aiRoles: {
        planning: { providerId: "codex", model: "gpt-6-astra", effort: "low" },
      },
    },
    projects: [project],
    projectWorkflows: [workflow],
    projectDeliveries: [],
    projectGrants: [],
    devices: [
      {
        id: "phone",
        platform: "android",
        permissions: {
          projectAccess: true,
          googleAccess: true,
          browserControl: true,
        },
      },
    ],
    connections: [{ id: "vercel", accounts: [{ id: "account" }] }],
    approvals: [],
    tasks: [],
  };
  let queue = Promise.resolve();
  const calls = [],
    runs = new Map();
  const store = {
    state,
    dir,
    change(fn) {
      const next = queue.then(() => fn(state));
      queue = next.catch(() => {});
      return next;
    },
    audit() {},
  };
  const host = {
    store,
    runs,
    project(id) {
      if (id !== project.id) throw new Error("Missing project");
      return project;
    },
    projectWorkflows: {
      get(id) {
        if (id !== workflow.id) throw new Error("Missing workflow");
        return workflow;
      },
    },
    assertCheckAvailable() {},
    provisioning: {
      list() {
        return { plans: [], operations: [], secrets: [] };
      },
    },
    projectGrants: {
      public() {
        return [];
      },
    },
    async chat(body, principal, options) {
      const task = { id: "task-" + calls.length, status: "running" };
      const call = { body, principal, options, task };
      calls.push(call);
      options.onTasks([task]);
      runs.set(task.id, {
        stop() {
          task.status = "stopped";
          void options.onFinished(task, "");
        },
      });
      return { taskIds: [task.id] };
    },
    async approval(
      type,
      title,
      description,
      operation,
      principal,
      options = {},
    ) {
      const approval = {
        id: "approval",
        type,
        title,
        description,
        operation,
        requestedBy: principal.id,
        status: "pending",
      };
      await store.change(() => {
        options.guard?.();
        state.approvals.push(approval);
        options.onCreated?.(approval);
      });
      return approval;
    },
  };
  const deliveries = new ProjectDeliveries(host);
  host.projectDeliveries = deliveries;
  t.after(async () => {
    for (const record of state.projectDeliveries)
      await deliveries.stop(record.id, OWNER);
    await Promise.allSettled(
      [...deliveries.entries.values()].map((entry) => entry.promise),
    );
    await queue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    host,
    state,
    store,
    project,
    workflow,
    deliveries,
    calls,
    projectPath,
  };
}
test("delivery only starts from the exact dual-reviewed snapshot and reserves one active project run", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.projectPath, "index.html"), "Unreviewed edit");
  await assert.rejects(
    f.deliveries.start("project", { workflowId: "workflow" }, OWNER),
    /since dual review/,
  );
  assert.equal(f.calls.length, 0);
  await fs.writeFile(
    path.join(f.projectPath, "index.html"),
    "Reviewed fixture",
  );
  const results = await Promise.allSettled([
    f.deliveries.start("project", { workflowId: "workflow" }, OWNER),
    f.deliveries.start("project", { workflowId: "workflow" }, OWNER),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  await until(() => f.calls.length === 1);
});
test("delivery drops changed files before any service action or final reviewed outcome", async (t) => {
  const f = await fixture(t);
  const record = await f.deliveries.start(
    "project",
    { workflowId: "workflow" },
    OWNER,
  );
  await until(() => f.calls.length === 1);
  await fs.writeFile(
    path.join(f.projectPath, "index.html"),
    "Changed during coordinator",
  );
  await assert.rejects(
    f.calls[0].options.beforeServiceAction(),
    /files changed/,
  );
  await f.calls[0].options.onFinished({ status: "completed" }, outcome([]));
  await until(() => f.deliveries.get(record.id).status === "needs_attention");
  assert.equal(f.deliveries.get(record.id).liveVerified, false);
});
test("approval resume waits for the paused model to finish, resumes exactly once and never revives Stop", async (t) => {
  const f = await fixture(t);
  const first = await f.deliveries.start(
    "project",
    { workflowId: "workflow" },
    OWNER,
  );
  await until(() => f.calls.length === 1);
  const approval = {
    id: "approved",
    deliveryId: first.id,
    status: "completed",
  };
  f.state.approvals.push(approval);
  await f.calls[0].options.onServicePause({ pendingApprovalId: approval.id });
  const resumes = Promise.all([
    f.deliveries.afterApproval(approval),
    f.deliveries.afterApproval(approval),
  ]);
  assert.equal(f.calls.length, 1);
  await f.calls[0].options.onFinished(
    { status: "completed" },
    "Pending approval.",
  );
  await resumes;
  await until(() => f.calls.length === 2);
  const secondApproval = {
    id: "later",
    deliveryId: first.id,
    status: "completed",
  };
  f.state.approvals.push(secondApproval);
  await f.calls[1].options.onServicePause({
    pendingApprovalId: secondApproval.id,
  });
  const pending = f.deliveries.afterApproval(secondApproval);
  await f.deliveries.stop(first.id, OWNER);
  await pending;
  assert.equal(f.calls.length, 2);
  assert.equal(f.deliveries.get(first.id).status, "stopped");
});
test("delivery approval dispatch rechecks reviewed files, requester access and Stop even before pause callback saves id", async (t) => {
  const f = await fixture(t);
  const record = await f.deliveries.start(
    "project",
    { workflowId: "workflow" },
    PHONE,
  );
  await until(() => f.calls.length === 1);
  const approval = { id: "fast", deliveryId: record.id, status: "executing" };
  await f.deliveries.beforeApproval(approval);
  await fs.writeFile(
    path.join(f.projectPath, "index.html"),
    "Changed while approval pending",
  );
  await assert.rejects(f.deliveries.beforeApproval(approval), /files changed/);
  f.state.devices[0].permissions.googleAccess = false;
  assert.throws(() => f.deliveries.guardApproval(approval), /disabled/);
  f.state.devices[0].permissions.googleAccess = true;
  await f.deliveries.stop(record.id, OWNER);
  assert.throws(() => f.deliveries.guardApproval(approval), /stopped/);
});
test("delivery question updates validate atomically and a waiting question retains the active project reservation", async (t) => {
  const f = await fixture(t);
  const record = await f.deliveries.start(
    "project",
    { workflowId: "workflow" },
    OWNER,
  );
  await until(() => f.calls.length === 1);
  await f.calls[0].options.onFinished(
    { status: "completed" },
    outcome(["Which region?", "Which domain?"]),
  );
  await until(() => !f.deliveries.entries.size);
  const saved = f.deliveries.get(record.id);
  await assert.rejects(
    f.deliveries.answer(
      record.id,
      {
        answers: [
          { id: saved.questions[0].id, answer: "Europe" },
          { id: "missing", answer: "example.com" },
        ],
      },
      OWNER,
    ),
    /current questions/,
  );
  assert.equal(saved.questions[0].answer, "");
  await assert.rejects(
    f.deliveries.start("project", { workflowId: "workflow" }, OWNER),
    /active delivery/,
  );
  await f.deliveries.answer(
    record.id,
    {
      answers: saved.questions.map((q, index) => ({
        id: q.id,
        answer: index ? "No domain change" : "Europe",
      })),
    },
    OWNER,
  );
  await until(() => f.calls.length === 2);
  assert.match(f.calls[1].options.promptContext, /No domain change/);
});
test("grant quota is consumed atomically across concurrent plans and queued revoke rechecks device access", async (t) => {
  const f = await fixture(t),
    grants = new ProjectGrants(f.host);
  const grant = await grants.approved(
    {
      projectId: "project",
      projectPath: f.project.path,
      workspaceRoot: f.state.config.workspaceRoot,
      scopes: [
        {
          provider: "vercel",
          accountId: "account",
          action: "project.create",
          match: { name: "fixture" },
        },
      ],
      hours: 1,
      maxOperations: 1,
    },
    { id: "approved", requestedBy: "desktop" },
  );
  const plan = {
    projectId: "project",
    provider: "vercel",
    accountId: "account",
    action: "vercel.project.create",
    settings: { name: "fixture" },
  };
  const results = await Promise.allSettled([
    grants.consume({ ...plan, id: "one" }, { grantId: grant.id }),
    grants.consume({ ...plan, id: "two" }, { grantId: grant.id }),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(f.state.projectGrants[0].used, 1);
  let release;
  const barrier = f.store.change(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await until(() => release);
  const revocation = grants.revoke(grant.id, PHONE);
  f.state.devices[0].permissions.googleAccess = false;
  release();
  await barrier;
  await assert.rejects(revocation, /disabled/);
  assert.equal(f.state.projectGrants[0].status, "active");
});
test("preview reserves its project before async verification and Stop suppresses a delayed process launch", async (t) => {
  const f = await fixture(t);
  let release,
    launches = 0;
  const previews = new ProjectPreviews(
    {
      ...f.host,
      async startCommand() {
        launches++;
        return { id: "command" };
      },
    },
    {
      checkTools: {
        verifyCheck: async () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
      allocatePort: async () => 5555,
    },
  );
  const pending = previews.approved(
    { projectId: "project", framework: "vite" },
    { requestedBy: "desktop" },
  );
  await until(() => release);
  await assert.rejects(
    previews.approved(
      { projectId: "project", framework: "vite" },
      { requestedBy: "desktop" },
    ),
    /already exists/,
  );
  previews.stop("project", OWNER);
  release({ command: "synthetic", args: [], cwd: f.projectPath, env: {} });
  await assert.rejects(pending, /stopped/);
  assert.equal(launches, 0);
});
