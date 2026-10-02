import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { Store } from "../apps/host/store.mjs";
import { within } from "../apps/host/security.mjs";

const OWNER = { kind: "owner", id: "desktop" };
const block = (name, value) =>
  "```" + name + "\n" + JSON.stringify(value) + "\n```";
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(predicate, message = "Workflow fixture timed out") {
  const end = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < end, message);
    await pause();
  }
}

async function fixture(
  t,
  {
    phone = false,
    script = "console.log('LOCAL_WORKFLOW_CHECK');",
    fixContent = "<button>Fixture</button>",
  } = {},
) {
  const temp = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(temp, "nakama-workflow-check-host-"));
  const calls = [];
  const host = await new NakamaHost({
    dataDir: path.join(dir, "state"),
    runAgent: async (_provider, options) => {
      const [, stage, role] =
        options.prompt.match(/Managed project stage: (\w+); role: (\w+)\./) ||
        [];
      const call = { options, stage, role };
      calls.push(call);
      setTimeout(() => {
        let answer;
        if (["planning", "manager_planning"].includes(stage))
          answer = block("nakama-plan", {
            plan: "Change one local page, execute the existing npm test after approval, and independently review the recorded result. No external services.",
            questions: [],
            workItems: [
              {
                title: "Local page",
                instructions: "Create the accessible local page.",
                files: ["index.html"],
              },
            ],
          });
        else if (["developing", "fixing"].includes(stage))
          answer = block("nakama-files", {
            summary: "Synthetic local page",
            files: [
              {
                path: "index.html",
                content:
                  stage === "fixing" ? fixContent : "<button>Fixture</button>",
              },
            ],
          });
        else if (stage === "reviewing")
          answer = block("nakama-review", {
            verdict: "pass",
            summary: "Reviewed the actual fixture and check receipt.",
            findings: [],
          });
        else if (stage === "delivering")
          answer =
            "The local fixture is implemented and reviewed. Live acceptance remains unverified.";
        else return;
        options.onComplete({ code: 0, text: answer });
      }, 0);
      return { stop() {} };
    },
  }).init();
  const workspace = path.join(dir, "projects");
  await fs.mkdir(workspace);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot: workspace });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Workflow checks fixture",
  });
  project.reportSettings = { automaticEnabled: false };
  await fs.writeFile(
    path.join(project.path, "package.json"),
    JSON.stringify({
      private: true,
      scripts: { test: "node test.cjs" },
    }),
  );
  await fs.writeFile(path.join(project.path, "test.cjs"), script);
  let principal = OWNER;
  if (phone) {
    const { ticket } = await host.dispatch("POST", "/api/pairing/tickets", {
      platform: "android",
    });
    const paired = await host.dispatch("POST", "/api/pair", {
      ticket,
      platform: "android",
      name: "Synthetic fixture phone",
    });
    principal = { kind: "device", id: paired.deviceId };
  }
  t.after(async () => {
    await host.close();
    await until(
      () => !host.commandProcesses.size && !host.checking.size,
      "Fixture process did not close",
    );
    await host.store.queue;
    assert.ok(
      within(temp, dir) &&
        path.basename(dir).startsWith("nakama-workflow-check-host-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    host,
    project,
    calls,
    principal,
    record: () => host.store.state.projectWorkflows[0],
    async start() {
      await host.dispatch(
        "POST",
        "/api/chat",
        {
          routing: "auto",
          projectId: project.id,
          message: "Build an accessible local app",
        },
        principal,
      );
      await until(() =>
        host.store.state.approvals.some((a) => a.type === "project_check"),
      );
      return host.store.state.approvals.find((a) => a.type === "project_check");
    },
  };
}
const approve = (f, approval) =>
  f.host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
    approved: true,
  });

test("managed workflow pauses before local execution and both reviewers receive the persisted completed check", async (t) => {
  const f = await fixture(t);
  const approval = await f.start();
  assert.equal(approval.status, "pending");
  assert.equal(approval.workflowId, f.record().id);
  assert.equal(approval.operation.workflowId, f.record().id);
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
  assert.equal(
    f.host.store.state.tasks.some((task) => task.kind === "project_check"),
    false,
  );
  const finishedReceipts = [];
  const onFinished = f.host.projectWorkflows.onCheckFinished.bind(
    f.host.projectWorkflows,
  );
  f.host.projectWorkflows.onCheckFinished = (task) => {
    finishedReceipts.push({
      id: task.id,
      status: task.status,
      exitCode: task.exitCode,
      stillRunning: f.host.commandProcesses.has(task.id),
      checking: f.host.checking.has(task.projectId),
    });
    return onFinished(task);
  };
  const started = await approve(f, approval);
  assert.equal(started.status, "started");
  await until(() => f.record().status !== "running");
  assert.equal(f.record().status, "completed", f.record().error);
  const check = f.host.store.state.tasks.find(
    (task) => task.id === started.taskId,
  );
  assert.equal(check.workflowId, f.record().id);
  assert.equal(check.approvalId, approval.id);
  assert.equal(check.status, "completed");
  assert.equal(check.exitCode, 0);
  assert.match(check.output, /LOCAL_WORKFLOW_CHECK/);
  assert.deepEqual(finishedReceipts, [
    {
      id: check.id,
      status: "completed",
      exitCode: 0,
      stillRunning: false,
      checking: false,
    },
  ]);
  assert.equal(
    approval.status,
    "started",
    "Approval authorizes execution; the task records success",
  );
  const reviewers = f.calls.filter((call) => call.stage === "reviewing");
  assert.equal(reviewers.length, 2);
  for (const reviewer of reviewers) {
    assert.match(reviewer.options.prompt, /LOCAL_WORKFLOW_CHECK/);
    assert.match(reviewer.options.prompt, /exitCode/);
  }
});

test("ordinary check requests cannot bypass managed ownership by adding workflow identifiers", async (t) => {
  const f = await fixture(t);
  const approval = await f.start();
  const route = `/api/projects/${f.project.id}/checks/request`;
  const body = { name: "test", manifestHash: approval.operation.manifestHash };
  await assert.rejects(f.host.dispatch("POST", route, body), { status: 409 });
  await assert.rejects(
    f.host.dispatch("POST", route, { ...body, workflowId: f.record().id }),
    { status: 400 },
  );
  await assert.rejects(
    f.host.dispatch("POST", route, { ...body, approvalId: approval.id }),
    { status: 400 },
  );
  assert.equal(f.host.store.state.approvals.length, 1);
  assert.equal(
    f.host.store.state.tasks.some((task) => task.kind === "project_check"),
    false,
  );
});

test("a workflow check rejects stale source even when its package script is unchanged", async (t) => {
  const f = await fixture(t);
  const approval = await f.start();
  await fs.writeFile(
    path.join(f.project.path, "index.html"),
    "Externally changed after approval request",
  );
  await assert.rejects(
    approve(f, approval),
    /files changed|current files|snapshot/i,
  );
  await until(() => f.record().status !== "running");
  assert.notEqual(f.record().status, "completed");
  assert.equal(
    f.host.store.state.tasks.some((task) => task.kind === "project_check"),
    false,
  );
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
  assert.equal(
    await fs.readFile(path.join(f.project.path, "index.html"), "utf8"),
    "Externally changed after approval request",
  );
});

test("workflow check approvals require their exact workflow, project and requester binding", async (t) => {
  const f = await fixture(t);
  const approval = await f.start();
  const guard = (candidate) =>
    f.host.projectWorkflows.guardCheckApproval(candidate);
  const executing = { ...approval, status: "executing" };
  assert.doesNotThrow(() => guard(executing));
  for (const candidate of [
    approval,
    { ...executing, id: "unrelated-approval" },
    { ...executing, workflowId: "missing-workflow" },
    { ...executing, requestedBy: "other-device" },
    {
      ...executing,
      operation: { ...approval.operation, projectId: "other-project" },
    },
    {
      ...executing,
      operation: { ...approval.operation, workflowId: "other-workflow" },
    },
    {
      ...executing,
      operation: { ...approval.operation, manifestHash: "changed-hash" },
    },
  ])
    assert.throws(() => guard(candidate));
  const missing = structuredClone(approval);
  delete missing.operation.workflowId;
  await assert.rejects(f.host.startProjectCheck(missing.operation, missing));
  assert.equal(
    f.host.store.state.tasks.some((task) => task.kind === "project_check"),
    false,
  );
});

for (const interruption of ["stop", "revoke"]) {
  test(`${interruption} during asynchronous workflow check preparation prevents the actual process launch`, async (t) => {
    const f = await fixture(t, { phone: interruption === "revoke" });
    const approval = await f.start();
    const original = f.host.startCommand.bind(f.host);
    let release;
    f.host.startCommand = async (...args) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return original(...args);
    };
    const pending = approve(f, approval);
    await until(() => release);
    if (interruption === "stop")
      await f.host.projectWorkflows.stop(f.record().id, OWNER);
    else
      f.host.store.state.devices.find(
        (device) => device.id === f.principal.id,
      ).permissions.googleAccess = false;
    release();
    await assert.rejects(pending, /running|stopped|disabled|access/i);
    assert.equal(f.host.commandProcesses.size, 0);
    assert.equal(
      f.host.store.state.tasks.some(
        (task) => task.kind === "project_check" && task.status === "completed",
      ),
      false,
    );
    assert.equal(
      f.calls.some((call) => call.stage === "reviewing"),
      false,
    );
  });
}

test("a real nonzero managed check triggers a bounded repair and a fresh approval before either review", async (t) => {
  const f = await fixture(t, {
    fixContent: "<button>Fixed fixture</button>",
    script:
      "const fs = require('node:fs'); const ok = fs.readFileSync('index.html', 'utf8').includes('Fixed'); console.log(ok ? 'LOCAL_CHECK_FIXED' : 'LOCAL_CHECK_FAILED'); process.exit(ok ? 0 : 7);",
  });
  const first = await f.start();
  const firstRun = await approve(f, first);
  await until(() => f.host.store.state.approvals.length === 2);
  const second = f.host.store.state.approvals[1];
  assert.notEqual(second.id, first.id);
  assert.equal(second.status, "pending");
  assert.equal(f.calls.filter((call) => call.stage === "fixing").length, 1);
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
  const failed = f.host.store.state.tasks.find(
    (task) => task.id === firstRun.taskId,
  );
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.status, "failed");
  const secondRun = await approve(f, second);
  await until(() => f.record().status !== "running");
  assert.equal(f.record().status, "completed", f.record().error);
  assert.deepEqual(
    f.record().checkReceipts.map((receipt) => receipt.exitCode),
    [7, 0],
  );
  assert.notEqual(secondRun.taskId, firstRun.taskId);
  assert.match(
    f.calls.find((call) => call.stage === "fixing").options.prompt,
    /LOCAL_CHECK_FAILED/,
  );
  for (const reviewer of f.calls.filter((call) => call.stage === "reviewing")) {
    assert.match(reviewer.options.prompt, /LOCAL_CHECK_FIXED/);
  }
});

test("a check that closes before its approval-start receipt resumes the workflow exactly once", async (t) => {
  const f = await fixture(t);
  const approval = await f.start();
  const original = f.host.startProjectCheck.bind(f.host);
  let closedBeforeStarted = false;
  f.host.startProjectCheck = async (...args) => {
    const task = await original(...args);
    await until(
      () =>
        !f.host.commandProcesses.has(task.id) && task.status === "completed",
    );
    await f.host.store.queue;
    closedBeforeStarted = approval.status === "executing";
    return task;
  };
  await approve(f, approval);
  await until(() => f.record().status !== "running");
  assert.equal(closedBeforeStarted, true);
  assert.equal(f.record().status, "completed", f.record().error);
  assert.equal(f.record().checkReceipts.length, 1);
  assert.equal(f.calls.filter((call) => call.stage === "reviewing").length, 2);
  assert.equal(f.calls.filter((call) => call.stage === "delivering").length, 1);
});

test("stopping a running managed check stops its real process before another workflow stage can run", async (t) => {
  const f = await fixture(t, {
    script: "console.log('LOCAL_CHECK_WAITING'); setInterval(() => {}, 1000);",
  });
  const approval = await f.start();
  const started = await approve(f, approval);
  const task = f.host.store.state.tasks.find(
    (item) => item.id === started.taskId,
  );
  await until(() => task.output.includes("LOCAL_CHECK_WAITING"));
  await f.host.projectWorkflows.stop(f.record().id, OWNER);
  await until(
    () =>
      !f.host.commandProcesses.has(task.id) &&
      !f.host.checking.has(f.project.id),
  );
  await f.host.store.queue;
  assert.equal(task.status, "stopped");
  assert.equal(f.record().status, "stopped");
  assert.equal(
    f.calls.some((call) =>
      ["fixing", "reviewing", "delivering"].includes(call.stage),
    ),
    false,
  );
});

test("reloading a pending managed check cancels its approval and never resumes work", async (t) => {
  const f = await fixture(t);
  const approval = await f.start();
  await f.host.store.queue;
  const calls = f.calls.length;
  // Read the durable pre-crash state directly, without the graceful close path.
  const restored = await new Store(f.host.store.dir).init();
  assert.equal(restored.state.projectWorkflows[0].status, "interrupted");
  assert.equal(
    restored.state.approvals.find((item) => item.id === approval.id).status,
    "cancelled",
  );
  assert.equal(
    restored.state.tasks.some((item) => item.kind === "project_check"),
    false,
  );
  assert.equal(f.calls.length, calls);
});

test("a terminal receipt persistence failure cannot become a passing managed check", async (t) => {
  const f = await fixture(t);
  const approval = await f.start();
  const save = f.host.store.save.bind(f.host.store);
  let rejectedSave = false;
  f.host.store.save = async () => {
    if (
      !rejectedSave &&
      f.host.store.state.tasks.some(
        (task) => task.kind === "project_check" && task.status === "completed",
      )
    ) {
      rejectedSave = true;
      throw new Error("Synthetic terminal receipt disk failure");
    }
    return save();
  };
  const started = await approve(f, approval);
  await until(() => f.record().status !== "running");
  assert.equal(rejectedSave, true);
  const task = f.host.store.state.tasks.find(
    (item) => item.id === started.taskId,
  );
  assert.equal(task.status, "interrupted");
  assert.match(task.error, /could not be saved/);
  assert.equal(f.record().status, "needs_attention");
  assert.equal(f.host.commandProcesses.size, 0);
  assert.equal(f.host.checking.size, 0);
  assert.equal(
    f.calls.some((call) =>
      ["fixing", "reviewing", "delivering"].includes(call.stage),
    ),
    false,
  );
});

test("Stop catches an owned check spawned before its approval publishes the task ID", async (t) => {
  const f = await fixture(t, {
    script: "console.log('LOCAL_CHECK_UNLINKED'); setInterval(() => {}, 1000);",
  });
  const approval = await f.start();
  const original = f.host.startProjectCheck.bind(f.host);
  let release, spawned;
  f.host.startProjectCheck = async (...args) => {
    spawned = await original(...args);
    await new Promise((resolve) => {
      release = resolve;
    });
    return spawned;
  };
  const pending = approve(f, approval);
  await until(() => release && spawned.output.includes("LOCAL_CHECK_UNLINKED"));
  assert.equal(approval.status, "executing");
  assert.equal(approval.result, undefined);
  assert.equal(f.record().taskIds.includes(spawned.id), false);
  await f.host.projectWorkflows.stop(f.record().id, OWNER);
  release();
  await pending;
  await f.host.store.queue;
  assert.equal(spawned.status, "stopped");
  await until(() => !f.host.commandProcesses.has(spawned.id));
  assert.equal(f.record().status, "stopped");
  assert.equal(
    f.calls.some((call) =>
      ["fixing", "reviewing", "delivering"].includes(call.stage),
    ),
    false,
  );
});
