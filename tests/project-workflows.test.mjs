import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import {
  defaultProjectTeam,
  parseProjectPlan,
  parseProjectReview,
  validateProjectTeam,
} from "../apps/host/project-workflows.mjs";
import { Store, initialState } from "../apps/host/store.mjs";

const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Fixture timed out");
    await pause();
  }
}
const block = (name, data) =>
  "```" + name + "\n" + JSON.stringify(data) + "\n```";
const plan = (
  questions = [],
  workItems = [
    {
      title: "Create UI",
      instructions: "Build accessible index",
      files: ["index.html"],
    },
  ],
) =>
  block("nakama-plan", {
    plan: "Method: implement accessible HTML. Architecture: one static page; test keyboard navigation separately. Preserve README. Acceptance: semantic button.",
    questions,
    workItems,
  });
const review = (pass = true) =>
  block("nakama-review", {
    verdict: pass ? "pass" : "changes_requested",
    summary: pass
      ? "Inspected current file; semantic HTML is sound. No command or live test ran."
      : "Button text needs correction.",
    findings: pass ? [] : ["Change button text to Corrected."],
  });
const files = (content = "<button>Ready</button>", file = "index.html") =>
  block("nakama-files", {
    summary: "Fixture implementation",
    files: [{ path: file, content }],
  });

async function fixture(t, responder) {
  const dir = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "nakama-project-team-"),
  );
  const calls = [];
  const makeHost = async () =>
    new NakamaHost({
      dataDir: path.join(dir, "state"),
      runAgent: async (provider, options) => {
        const [, stage, role] =
          options.prompt.match(/Managed project stage: (\w+); role: (\w+)\./) ||
          [];
        const call = { provider, options, stage, role, stopped: false };
        calls.push(call);
        if (responder)
          setTimeout(() => {
            const answer = responder(call, calls);
            if (answer !== undefined)
              options.onComplete({ code: 0, text: answer });
          }, 0);
        return {
          stop: () => {
            call.stopped = true;
          },
        };
      },
    }).init();
  let host = await makeHost();
  const root = path.join(dir, "projects");
  await fs.mkdir(root);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot: root });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Team fixture",
  });
  t.after(async () => {
    await host.close();
    await host.store.queue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    get host() {
      return host;
    },
    project,
    calls,
    dir,
    restart: async () => {
      await host.close();
      await host.store.queue;
      host = await makeHost();
      return host;
    },
  };
}
const ask = (f, principal) =>
  f.host.dispatch(
    "POST",
    "/api/chat",
    {
      routing: "auto",
      projectId: f.project.id,
      message: "Build an accessible app",
    },
    principal,
  );
const record = (f) => f.host.store.state.projectWorkflows[0];
const standard = (call) =>
  ["planning", "manager_planning"].includes(call.stage)
    ? plan()
    : call.stage === "developing" || call.stage === "fixing"
      ? files()
      : call.stage === "reviewing"
        ? review()
        : "Your accessible page is ready for local testing.";
function simulatedChecks(f, names = ["test"]) {
  const manifestHash = "a".repeat(64);
  f.host.discoverProjectChecks = async () => ({
    supported: names.length > 0,
    runtime: { available: true },
    manifestHash,
    checks: names.map((name) => ({ name, script: "fixture only" })),
  });
  f.host.requestProjectCheck = async (project, body, principal, options) =>
    f.host.approval(
      "project_check",
      "Fixture check",
      "No executable is invoked by this fixture.",
      {
        projectId: project.id,
        checkName: body.name,
        manifestHash,
        workflowId: options.workflowId,
      },
      principal,
      {
        guard: options.guard,
        onCreated: (approval) => {
          approval.workflowId = options.workflowId;
          options.onCreated(approval);
        },
      },
    );
  return {
    names,
    async start(approval, publish = true) {
      const task = {
        id: `fixture-check-${approval.id}`,
        kind: approval.type,
        projectId: f.project.id,
        workflowId: record(f).id,
        approvalId: approval.id,
        checkName: approval.operation.checkName,
        manifestHash: approval.operation.manifestHash,
        ...(approval.type === "project_dependencies"
          ? { lockHash: approval.operation.lockHash }
          : {}),
        requestedBy: approval.requestedBy,
        providerId: "terminal",
        status: "running",
        output: "",
      };
      await f.host.store.change((state) => {
        approval.status = "executing";
        f.host.projectWorkflows.guardCheckApproval(approval);
        state.tasks.push(task);
        f.host.commandProcesses.set(task.id, f.project.id);
        if (publish) {
          approval.status = "started";
          approval.result = { taskId: task.id };
        }
      });
      f.host.projectWorkflows.onCheckApproval(approval);
      return task;
    },
    async finish(task, exitCode = 0, output = "Fixture passed", close = true) {
      await f.host.store.change(() => {
        Object.assign(task, {
          status: exitCode === 0 ? "completed" : "failed",
          exitCode,
          signal: null,
          output,
        });
        if (close) f.host.commandProcesses.delete(task.id);
      });
      f.host.projectWorkflows.onCheckFinished(task);
    },
  };
}
function simulatedDependencies(f) {
  const discovery = {
    supported: true,
    runtime: { available: true },
    manifestHash: "d".repeat(64),
    lockHash: "e".repeat(64),
    packageCount: 1,
    nodeModulesPresent: false,
  };
  f.host.discoverProjectDependencies = async () => ({ ...discovery });
  f.host.requestProjectDependencies = async (
    project,
    body,
    principal,
    options,
  ) =>
    f.host.approval(
      "project_dependencies",
      "Fixture dependency preparation",
      "No package manager or network is invoked by this fixture.",
      {
        kind: "npm_ci",
        projectId: project.id,
        checkName: "dependencies",
        manifestHash: body.manifestHash,
        lockHash: body.lockHash,
        workflowId: options.workflowId,
      },
      principal,
      {
        guard: options.guard,
        onCreated: (approval) => {
          approval.workflowId = options.workflowId;
          options.onCreated(approval);
        },
      },
    );
  return discovery;
}
const pendingCheck = (f) =>
  f.host.store.state.approvals.find(
    (approval) =>
      approval.operation?.workflowId === record(f).id &&
      approval.status === "pending",
  );
async function paired(host) {
  const { ticket } = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  const p = await host.dispatch("POST", "/api/pair", {
    ticket,
    platform: "android",
    name: "Fixture phone",
  });
  return { kind: "device", id: p.deviceId, platform: "android" };
}

test("strict plans, independent-review verdicts and configurable bounded team settings", () => {
  assert.equal(defaultProjectTeam().peer.model, "claude-fable-5-1");
  assert.equal(validateProjectTeam(defaultProjectTeam()).maxFixCycles, 2);
  for (const value of [
    { ...defaultProjectTeam(), maxFixCycles: 4 },
    { ...defaultProjectTeam(), unexpected: true },
    {
      ...defaultProjectTeam(),
      peer: { providerId: "claude", model: "", effort: "max" },
    },
  ])
    assert.throws(() => validateProjectTeam(value), { status: 400 });
  for (const answer of [
    "I approve",
    block("nakama-review", {
      verdict: "pass",
      summary: "Okay",
      findings: ["a bug"],
    }),
    block("nakama-review", {
      verdict: "changes_requested",
      summary: "Bad",
      findings: [],
    }),
  ])
    assert.throws(() => parseProjectReview(answer), { status: 409 });
  for (const file of ["../bad", "/absolute", "dir\\file", "C:/outside"])
    assert.throws(
      () =>
        parseProjectPlan(
          plan(
            [],
            [{ title: "Invalid", instructions: "Invalid file", files: [file] }],
          ),
        ),
      { status: 409 },
    );
});

test("manager acknowledges accepted project planning before delayed workers finish without claiming delivery", async (t) => {
  const f = await fixture(t);
  const result = await ask(f);
  const acknowledgements = f.host.store.state.messages.filter(
    (message) => message.kind === "task_ack",
  );
  assert.equal(acknowledgements.length, 1);
  assert.equal(acknowledgements[0].workflowId, result.workflowId);
  assert.equal(acknowledgements[0].providerId, "codex");
  assert.match(acknowledgements[0].content, /starting the project plan/);
  assert.equal(record(f).status, "running");
  assert.equal(
    f.host.store.state.messages.some(
      (message) => message.kind === "project_delivery",
    ),
    false,
  );
  assert.equal(
    f.host.store.state.taskBoard.items.find(
      (item) => item.sourceId === result.workflowId,
    ).completed,
    false,
  );
  await f.host.dispatch(
    "POST",
    `/api/project-workflows/${result.workflowId}/stop`,
    {},
  );
  assert.equal(record(f).status, "stopped");
});

test("co-planning, manager synthesis, owned development and both static reviews precede only manager delivery", async (t) => {
  const f = await fixture(t, standard);
  const result = await ask(f);
  assert.equal(result.workflowId, record(f).id);
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "completed", record(f).error);
  assert.deepEqual(
    f.calls.map((call) => call.stage),
    [
      "planning",
      "planning",
      "manager_planning",
      "developing",
      "reviewing",
      "reviewing",
      "delivering",
    ],
  );
  assert.equal(
    f.calls.find((call) => call.stage === "planning" && call.role === "peer")
      .provider.selectedModel,
    "claude-fable-5-1",
  );
  assert.equal(f.calls[3].provider.selectedModel, "claude-opus-4-8");
  assert.equal(f.calls[3].provider.effort, "ultracode");
  assert.equal(
    await fs.readFile(path.join(f.project.path, "index.html"), "utf8"),
    "<button>Ready</button>",
  );
  assert.equal(record(f).reviews.length, 2);
  assert.deepEqual(record(f).checkReceipts, []);
  assert.match(record(f).checkSummary, /static only/);
  const delivered = await f.host.dispatch("POST", "/api/chats/receipts", { workflowIds: [result.workflowId] });
  assert.equal(f.host.store.state.messages.some(m => m.workflowId === result.workflowId), false, "Completed work leaves the visible chat");
  const messages = delivered.messages.filter(
    (m) =>
      m.role === "assistant" &&
      !m.pipelineIntermediate &&
      m.kind !== "task_ack",
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, "project_delivery");
  assert.match(messages[0].content, /not executed/);
  assert.equal(
    f.host.store.state.tasks.find((task) => task.workflowStage === "developing")
      .effectiveEffort,
    "xhigh",
  );
  assert.equal(f.host.store.state.approvals.length, 0);
  const office = await f.host.dispatch("GET", "/api/agent-office");
  const manager = office.agents.find(
    (agent) => agent.id === `workflow:${result.workflowId}`,
  );
  assert.equal(manager.status, "completed");
  assert.equal(manager.receiptKind, "workflow_orchestration");
  assert.equal(manager.summary, record(f).delivery);
  assert.equal(office.agents.length, f.host.store.state.tasks.length + 1);
  assert.equal(
    new Set(office.agents.map((agent) => agent.name)).size,
    office.agents.length,
  );
  assert.ok(
    office.agents
      .filter((agent) => agent.sourceKind === "task")
      .every(
        (agent) =>
          agent.parentId === manager.id && agent.status === "completed",
      ),
  );
});

test("peer questions cannot be discarded by manager; partial answers persist and all answers trigger a new full plan", async (t) => {
  let answered = false;
  const f = await fixture(t, (call) =>
    !answered && call.stage === "planning" && call.role === "peer"
      ? plan(["Which audience?", "Which colour?"])
      : standard(call),
  );
  await ask(f);
  await until(() => record(f).status === "awaiting_answers");
  assert.equal(f.calls.length, 3);
  assert.equal(record(f).questions.length, 2);
  assert.deepEqual(await fs.readdir(f.project.path), ["README.md"]);
  const id = record(f).id,
    [a, b] = record(f).questions;
  await f.host.dispatch("POST", `/api/project-workflows/${id}/answers`, {
    answers: [{ id: a.id, answer: "Adults" }],
  });
  assert.equal(record(f).status, "awaiting_answers");
  assert.equal(f.calls.length, 3);
  await f.restart();
  assert.equal(record(f).questions[0].answer, "Adults");
  answered = true;
  await f.host.dispatch("POST", `/api/project-workflows/${id}/answers`, {
    answers: [{ id: b.id, answer: "Blue" }],
  });
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "completed", record(f).error);
  assert.match(f.calls[3].options.prompt, /Adults/);
  assert.match(f.calls[3].options.prompt, /Blue/);
  assert.equal(
    (await f.host.dispatch("POST", "/api/chats/receipts", { workflowIds: [id] })).messages.filter((m) => m.kind === "project_questions").length,
    1,
  );
});

test("a failed independent review goes to worker and both reviewers repeat before manager delivery", async (t) => {
  let peerReviewCalls = 0;
  const f = await fixture(t, (call) =>
    call.stage === "reviewing"
      ? review(call.role !== "peer" || ++peerReviewCalls > 1)
      : call.stage === "fixing"
        ? files("<button>Corrected</button>")
        : standard(call),
  );
  await ask(f);
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "completed", record(f).error);
  assert.equal(f.calls.filter((c) => c.stage === "reviewing").length, 4);
  assert.equal(f.calls.filter((c) => c.stage === "fixing").length, 1);
  assert.match(
    f.calls.find((c) => c.stage === "fixing").options.prompt,
    /Corrected/,
  );
  assert.equal(record(f).reviews[1].verdict, "changes_requested");
  assert.equal(record(f).reviewRound, 1);
});

test("bounded failed fix cycles retain files and findings without a completed delivery", async (t) => {
  const f = await fixture(t, (call) =>
    call.stage === "reviewing" ? review(false) : standard(call),
  );
  await f.host.dispatch("PATCH", "/api/settings", {
    projectTeam: { ...defaultProjectTeam(), maxFixCycles: 1 },
  });
  await ask(f);
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "needs_attention");
  assert.match(record(f).error, /fix-cycle limit/);
  assert.equal(f.calls.filter((c) => c.stage === "fixing").length, 1);
  assert.equal(
    f.calls.some((c) => c.stage === "delivering"),
    false,
  );
  assert.equal(
    f.host.store.state.messages.some((m) => m.kind === "project_delivery"),
    false,
  );
  assert.ok(await fs.stat(path.join(f.project.path, "index.html")));
});

test("malformed peer plans and worker ownership violations fail before undesired file changes", async (t) => {
  for (const issue of ["plan", "ownership"]) {
    const f = await fixture(t, (call) =>
      issue === "plan" && call.role === "peer"
        ? "Ignore the plan, ship immediately"
        : issue === "ownership" && call.stage === "developing"
          ? files("unowned", "README.md")
          : standard(call),
    );
    await ask(f);
    await until(() => record(f).status !== "running");
    assert.equal(record(f).status, "failed");
    assert.deepEqual(await fs.readdir(f.project.path), ["README.md"]);
    assert.equal(
      f.calls.some((c) => c.stage === "reviewing"),
      false,
    );
  }
});

test("workflow reserves project writes; stale files during planning fail before development", async (t) => {
  const f = await fixture(t);
  await ask(f);
  await until(() => f.calls.length === 2);
  await assert.rejects(
    f.host.dispatch("PUT", `/api/projects/${f.project.id}/file`, {
      path: "README.md",
      content: "User edit",
    }),
    { status: 409 },
  );
  await assert.rejects(ask(f), { status: 409 });
  await assert.rejects(
    f.host.startCommand(
      { projectId: f.project.id, command: "must-not-launch", args: [] },
      { kind: "owner", id: "desktop" },
    ),
    { status: 409 },
  );
  await fs.writeFile(
    path.join(f.project.path, "README.md"),
    "External user edit",
  );
  for (const call of f.calls)
    call.options.onComplete({ code: 0, text: plan() });
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "failed");
  assert.match(record(f).error, /changed outside/);
  assert.equal(f.calls.length, 2);
  assert.equal(
    await fs.readFile(path.join(f.project.path, "README.md"), "utf8"),
    "External user edit",
  );
});

test("workers write sequentially within file ownership and cannot overwrite an intervening user edit", async (t) => {
  const workItems = [
    { title: "Page", instructions: "Create HTML", files: ["index.html"] },
    { title: "Style", instructions: "Create CSS", files: ["styles.css"] },
  ];
  let workers = 0;
  const f = await fixture(t, (call) =>
    ["planning", "manager_planning"].includes(call.stage)
      ? plan([], workItems)
      : call.stage === "developing"
        ? ++workers === 1
          ? files()
          : undefined
        : standard(call),
  );
  await ask(f);
  await until(() => workers === 2);
  assert.equal(
    await fs.readFile(path.join(f.project.path, "index.html"), "utf8"),
    "<button>Ready</button>",
  );
  await fs.writeFile(
    path.join(f.project.path, "README.md"),
    "Concurrent owner change",
  );
  f.calls.at(-1).options.onComplete({
    code: 0,
    text: files("body { color: blue; }", "styles.css"),
  });
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "failed");
  assert.match(record(f).error, /changed during this worker/);
  assert.equal(
    await fs.stat(path.join(f.project.path, "styles.css")).catch(() => null),
    null,
  );
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
});

test("repeated unresolved questions remain pending even after a prior answer; changed waiting files cannot resume", async (t) => {
  const f = await fixture(t, (call) =>
    call.stage === "planning" && call.role === "peer"
      ? plan(["Which audience?"])
      : standard(call),
  );
  await ask(f);
  await until(() => record(f).status === "awaiting_answers");
  const first = record(f).questions[0];
  await f.host.dispatch(
    "POST",
    `/api/project-workflows/${record(f).id}/answers`,
    { answers: [{ id: first.id, answer: "Not sure yet" }] },
  );
  await until(() => record(f).status === "awaiting_answers");
  assert.equal(
    record(f).questions.filter((question) => !question.answer).length,
    1,
  );
  assert.equal(
    f.calls.some((call) => call.stage === "developing"),
    false,
  );
  await fs.writeFile(
    path.join(f.project.path, "README.md"),
    "User edit while deciding",
  );
  await assert.rejects(
    f.host.dispatch("POST", `/api/project-workflows/${record(f).id}/answers`, {
      answers: [{ id: record(f).questions.at(-1).id, answer: "Adults" }],
    }),
    { status: 409 },
  );
  assert.equal(record(f).questions.at(-1).answer, undefined);
});

test("stop during development discards the late proposal without writing files", async (t) => {
  const f = await fixture(t, (call) =>
    call.stage === "developing" ? undefined : standard(call),
  );
  await ask(f);
  await until(() => f.calls.some((call) => call.stage === "developing"));
  await f.host.dispatch(
    "POST",
    `/api/project-workflows/${record(f).id}/stop`,
    {},
  );
  f.calls.at(-1).options.onComplete({ code: 0, text: files() });
  await until(() => !f.host.projectWorkflows.entries.size);
  assert.equal(record(f).status, "stopped");
  assert.deepEqual(await fs.readdir(f.project.path), ["README.md"]);
});

test("unfingerprintable large included files block the workflow before any provider invocation", async (t) => {
  const f = await fixture(t, standard);
  await fs.writeFile(
    path.join(f.project.path, "large-source.txt"),
    "x".repeat(1024 * 1024 + 1),
  );
  await assert.rejects(ask(f), { status: 413 });
  assert.equal(f.calls.length, 0);
  assert.equal(f.host.store.state.projectWorkflows.length, 0);
});

test("stop during planning prevents late callbacks from advancing the workflow", async (t) => {
  const f = await fixture(t);
  await ask(f);
  await until(() => f.calls.length === 2);
  await f.host.dispatch("POST", `/api/tasks/${record(f).taskIds[0]}/stop`, {});
  for (const call of f.calls)
    call.options.onComplete({ code: 0, text: plan() });
  await until(() => !f.host.projectWorkflows.entries.size);
  assert.equal(record(f).status, "stopped");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((call) => call.stopped));
});

test("phone privacy, workflow ownership and permission revocation hold across orchestration", async (t) => {
  const f = await fixture(t),
    phone = await paired(f.host),
    other = await paired(f.host);
  await ask(f, phone);
  await until(() => f.calls.length === 2);
  await assert.rejects(
    f.host.dispatch(
      "POST",
      `/api/project-workflows/${record(f).id}/stop`,
      {},
      other,
    ),
    { status: 403 },
  );
  await f.host.dispatch("PATCH", `/api/devices/${phone.id}`, {
    googleAccess: false,
  });
  await until(() => record(f).status === "stopped");
  const state = await f.host.dispatch("GET", "/api/state", {}, phone);
  assert.deepEqual(state.projectWorkflows, []);
  await assert.rejects(
    f.host.dispatch("GET", `/api/project-workflows/${record(f).id}`, {}, phone),
    { status: 403 },
  );
  for (const call of f.calls)
    call.options.onComplete({ code: 0, text: plan() });
  await until(() => !f.host.projectWorkflows.entries.size);
  assert.equal(f.calls.length, 2);
});

test("restart interrupts active work without automatic continuation and hides private snapshots", async (t) => {
  const f = await fixture(t);
  await ask(f);
  await until(() => f.calls.length === 2);
  const publicState = await f.host.dispatch("GET", "/api/state");
  assert.equal(publicState.projectWorkflows[0].snapshot, undefined);
  assert.equal(publicState.projectWorkflows[0].workspaceRoot, undefined);
  await f.restart();
  assert.equal(record(f).status, "interrupted");
  assert.equal(f.calls.length, 2);
});

test("review pass does not deliver if files change while the manager prepares its final answer", async (t) => {
  const f = await fixture(t, (call) =>
    call.stage === "delivering" ? undefined : standard(call),
  );
  await ask(f);
  await until(() => f.calls.some((call) => call.stage === "delivering"));
  await fs.writeFile(
    path.join(f.project.path, "index.html"),
    "Owner changed page after review",
  );
  f.calls.at(-1).options.onComplete({ code: 0, text: "Ready!" });
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "failed");
  assert.equal(
    f.host.store.state.messages.some((m) => m.kind === "project_delivery"),
    false,
  );
});

test("withdrawing the disabled-credits confirmation stops active team work before any later stage", async (t) => {
  const f = await fixture(t);
  await f.host.dispatch("POST", "/api/providers/claude/settings", {
    usageCreditsDisabledConfirmed: true,
  });
  await ask(f);
  await until(() => f.calls.length === 2);
  await f.host.dispatch("POST", "/api/providers/claude/settings", {
    usageCreditsDisabledConfirmed: false,
  });
  for (const call of f.calls)
    call.options.onComplete({ code: 0, text: plan() });
  await until(() => !f.host.projectWorkflows.entries.size);
  assert.equal(record(f).status, "stopped");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((call) => call.stopped));
});

test("managed checks wait for process close and give both reviewers bounded actual evidence", async (t) => {
  const f = await fixture(t, standard);
  const checks = simulatedChecks(f, ["test", "build"]);
  await ask(f);
  await until(() => pendingCheck(f));
  assert.equal(record(f).stage, "awaiting_check_approval");
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
  const first = await checks.start(pendingCheck(f));
  await checks.finish(
    first,
    0,
    "x".repeat(8000) + "\u001b[31mUNTRUSTED ACTUAL RESULT",
    false,
  );
  await until(() => record(f).stage === "checking");
  assert.equal(pendingCheck(f), undefined);
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
  f.host.commandProcesses.delete(first.id);
  f.host.projectWorkflows.onCheckFinished(first);
  await until(() => pendingCheck(f));
  assert.equal(pendingCheck(f).operation.checkName, "build");
  await checks.finish(await checks.start(pendingCheck(f)));
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "completed", record(f).error);
  assert.equal(record(f).checkReceipts.length, 2);
  assert.ok(record(f).checkReceipts.every((receipt) => receipt.exitCode === 0));
  assert.match(
    record(f).checkReceipts[0].output,
    /Earlier diagnostic output omitted/,
  );
  assert.doesNotMatch(record(f).checkReceipts[0].output, /\u001b/);
  for (const call of f.calls.filter((call) =>
    ["reviewing", "delivering"].includes(call.stage),
  )) {
    assert.match(call.options.prompt, /UNTRUSTED ACTUAL RESULT/);
    assert.match(call.options.prompt, /"exitCode":0/);
  }
});

test("managed dependency approval binds both hashes and waits for child close and reservation before checks", async (t) => {
  const f = await fixture(t, standard);
  const commands = simulatedChecks(f);
  const discovery = simulatedDependencies(f);
  await ask(f);
  await until(() => pendingCheck(f));
  const approval = pendingCheck(f);
  assert.equal(approval.type, "project_dependencies");
  assert.equal(record(f).checkReceipts[0].kind, "project_dependencies");
  const executing = { ...approval, status: "executing" };
  assert.equal(
    f.host.projectWorkflows.guardCheckApproval(executing),
    record(f),
  );
  for (const changed of [
    { ...executing, type: "project_check" },
    {
      ...executing,
      operation: { ...executing.operation, lockHash: "f".repeat(64) },
    },
    {
      ...executing,
      operation: { ...executing.operation, manifestHash: "f".repeat(64) },
    },
    { ...executing, operation: { ...executing.operation, checkName: "test" } },
  ])
    assert.throws(() => f.host.projectWorkflows.guardCheckApproval(changed), {
      status: 409,
    });
  const task = await commands.start(approval);
  discovery.nodeModulesPresent = true;
  await fs.mkdir(path.join(f.project.path, "node_modules"));
  await fs.writeFile(
    path.join(f.project.path, "node_modules", "fixture.txt"),
    "Synthetic local dependency output",
  );
  f.host.checking.add(f.project.id);
  await commands.finish(
    task,
    0,
    "Synthetic dependency process completed",
    false,
  );
  await until(() => record(f).stage === "checking");
  assert.equal(pendingCheck(f), undefined);
  f.host.commandProcesses.delete(task.id);
  f.host.projectWorkflows.onCheckFinished(task);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    pendingCheck(f),
    undefined,
    "Reservation still blocks the next check",
  );
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
  f.host.checking.delete(f.project.id);
  f.host.projectWorkflows.onCheckFinished(task);
  await until(() => pendingCheck(f));
  assert.equal(pendingCheck(f).type, "project_check");
  await commands.finish(await commands.start(pendingCheck(f)));
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "completed", record(f).error);
  assert.match(record(f).checkSummary, /Lifecycle scripts were disabled/);
  for (const call of f.calls.filter((call) =>
    ["reviewing", "delivering"].includes(call.stage),
  )) {
    assert.match(call.options.prompt, /Synthetic dependency process completed/);
    assert.match(call.options.prompt, new RegExp(discovery.lockHash));
    assert.match(call.options.prompt, /"kind":"project_dependencies"/);
  }
});

test("successful dependency receipt is explicitly reused across repairs, while changed lock hash needs fresh approval", async (t) => {
  for (const changed of [false, true]) {
    const f = await fixture(t, standard);
    const commands = simulatedChecks(f);
    const discovery = simulatedDependencies(f);
    await ask(f);
    await until(() => pendingCheck(f));
    const firstApproval = pendingCheck(f);
    discovery.nodeModulesPresent = true;
    await commands.finish(
      await commands.start(firstApproval),
      0,
      "Initial dependency receipt",
    );
    await until(() => pendingCheck(f));
    const checkTask = await commands.start(pendingCheck(f));
    if (changed) discovery.lockHash = "f".repeat(64);
    await commands.finish(checkTask, 1, "Synthetic failed check");
    await until(() => pendingCheck(f));
    if (changed) {
      assert.equal(pendingCheck(f).type, "project_dependencies");
      assert.notEqual(pendingCheck(f).id, firstApproval.id);
      assert.equal(pendingCheck(f).operation.lockHash, discovery.lockHash);
      await commands.finish(
        await commands.start(pendingCheck(f)),
        0,
        "Updated dependency receipt",
      );
      await until(() => pendingCheck(f));
    } else {
      assert.equal(pendingCheck(f).type, "project_check");
      assert.match(
        record(f).checkSummary,
        /Reusing this workflow's successful dependency receipt from round 0/,
      );
    }
    await commands.finish(await commands.start(pendingCheck(f)));
    await until(() => record(f).status !== "running");
    assert.equal(record(f).status, "completed", record(f).error);
    assert.equal(
      record(f).checkReceipts.filter(
        (receipt) => receipt.kind === "project_dependencies",
      ).length,
      changed ? 2 : 1,
    );
    for (const call of f.calls.filter((call) => call.stage === "reviewing")) {
      assert.match(call.options.prompt, /Initial dependency receipt/);
      if (changed)
        assert.match(call.options.prompt, /Updated dependency receipt/);
    }
  }
});

test("failed, declined, interrupted and ineffective dependency prep stop without automatic retry or repair", async (t) => {
  for (const outcome of [
    "failed",
    "declined",
    "interrupted",
    "missing_modules",
  ]) {
    const f = await fixture(t, standard);
    const commands = simulatedChecks(f);
    simulatedDependencies(f);
    await ask(f);
    await until(() => pendingCheck(f));
    const approval = pendingCheck(f);
    if (outcome === "declined") {
      await f.host.store.change(() => {
        approval.status = "declined";
      });
      f.host.projectWorkflows.onCheckApproval(approval);
    } else {
      const task = await commands.start(approval);
      if (outcome === "interrupted") {
        await f.host.store.change(() => {
          task.status = "interrupted";
          task.exitCode = null;
          task.signal = "SIGTERM";
          f.host.commandProcesses.delete(task.id);
        });
        f.host.projectWorkflows.onCheckFinished(task);
      } else
        await commands.finish(
          task,
          outcome === "failed" ? 1 : 0,
          "Synthetic preparation outcome",
        );
    }
    await until(() => record(f).status !== "running");
    assert.equal(
      record(f).status,
      "needs_attention",
      `${outcome}: ${record(f).error}`,
    );
    assert.equal(record(f).checkReceipts.length, 1);
    assert.equal(
      f.calls.some((call) =>
        ["fixing", "reviewing", "delivering"].includes(call.stage),
      ),
      false,
    );
    assert.equal(
      f.host.store.state.approvals.filter(
        (item) => item.operation?.workflowId === record(f).id,
      ).length,
      1,
    );
  }
});

test("dependency discovery skips only benign absence or explicitly identified manual setup", async (t) => {
  for (const discovery of [
    { supported: false, reason: "missing_manifest", preparationNeeded: false },
    { supported: false, reason: "no_dependencies", preparationNeeded: false },
    {
      supported: false,
      reason: "missing_lockfile",
      manualDependenciesAvailable: true,
      nodeModulesPresent: true,
    },
    {
      supported: false,
      reason: "missing_lockfile",
      manualDependenciesAvailable: false,
    },
    {
      supported: false,
      reason: "linked_modules",
      manualDependenciesAvailable: true,
    },
  ]) {
    const f = await fixture(t, standard);
    const commands = simulatedChecks(f);
    f.host.discoverProjectDependencies = async () => discovery;
    await ask(f);
    await until(() => pendingCheck(f) || record(f).status !== "running");
    const allowed =
      discovery.preparationNeeded === false ||
      (discovery.reason === "missing_lockfile" &&
        discovery.manualDependenciesAvailable);
    if (!allowed) {
      assert.equal(record(f).status, "needs_attention");
      assert.equal(record(f).checkReceipts.length, 0);
      continue;
    }
    assert.equal(pendingCheck(f).type, "project_check");
    await commands.finish(await commands.start(pendingCheck(f)));
    await until(() => record(f).status !== "running");
    assert.equal(record(f).status, "completed", record(f).error);
    assert.match(
      record(f).checkSummary,
      discovery.manualDependenciesAvailable
        ? /not run or verified/
        : /installation was not run/,
    );
  }
});

test("stopped dependency process reconciles its late receipt without starting checks", async (t) => {
  const f = await fixture(t, standard);
  const commands = simulatedChecks(f);
  simulatedDependencies(f);
  await ask(f);
  await until(() => pendingCheck(f));
  const task = await commands.start(pendingCheck(f), false);
  await f.host.projectWorkflows.stop(record(f).id, {
    kind: "owner",
    id: "desktop",
  });
  await until(() => !f.host.projectWorkflows.entries.has(record(f).id));
  await f.host.store.change(() => {
    task.status = "stopped";
    task.exitCode = null;
    task.signal = "SIGTERM";
    f.host.commandProcesses.delete(task.id);
  });
  f.host.projectWorkflows.onCheckFinished(task);
  await f.host.store.queue;
  assert.equal(record(f).checkReceipts[0].status, "stopped");
  assert.equal(record(f).checkReceipts[0].taskId, task.id);
  assert.equal(record(f).checkReceipts[0].lockHash, task.lockHash);
  assert.equal(record(f).status, "stopped");
  assert.equal(record(f).checkReceipts.length, 1);
});

test("Stop revokes authority and stops an unpublished dependency process even when either cancellation save fails", async (t) => {
  for (const failedSave of [1, 2, "all"]) {
    const f = await fixture(t, standard);
    const commands = simulatedChecks(f);
    simulatedDependencies(f);
    await ask(f);
    await until(() => pendingCheck(f));
    const approval = pendingCheck(f);
    const task = await commands.start(approval, false);
    assert.equal(record(f).taskIds.includes(task.id), false);
    assert.equal(record(f).checkReceipts[0].taskId, undefined);
    let stopped = false;
    f.host.runs.set(task.id, {
      stop() {
        stopped = true;
        f.host.commandProcesses.delete(task.id);
      },
    });
    const save = f.host.store.save.bind(f.host.store);
    let saves = 0;
    f.host.store.save = async () => {
      assert.equal(
        record(f).status,
        "stopped",
        "Authority must be revoked before persistence",
      );
      if (++saves === failedSave || failedSave === "all")
        throw new Error("Synthetic cancellation disk failure");
      return save();
    };
    try {
      await assert.rejects(
        f.host.projectWorkflows.stop(record(f).id, {
          kind: "owner",
          id: "desktop",
        }),
        /Synthetic cancellation disk failure/,
      );
      await until(() => !f.host.projectWorkflows.entries.has(record(f).id));
      assert.equal(
        stopped,
        true,
        `Process stop was skipped after save ${failedSave}`,
      );
      assert.equal(record(f).status, "stopped");
      assert.throws(
        () => f.host.projectWorkflows.guardCheckApproval(approval),
        { status: 409 },
      );
      assert.equal(
        f.calls.some((call) =>
          ["fixing", "reviewing", "delivering"].includes(call.stage),
        ),
        false,
      );
    } finally {
      f.host.store.save = save;
      f.host.runs.delete(task.id);
    }
  }
});

test("close cancels every owned command despite persistent disk failure in the first workflow", async (t) => {
  const f = await fixture(t);
  const stopped = [];
  const workflows = ["project_dependencies", "project_check"].map(
    (kind, index) => {
      const workflow = {
        id: `closing-workflow-${index}`,
        projectId: f.project.id,
        status: "running",
        stage: "checking",
        taskIds: [],
        checkReceipts: [],
      };
      const task = {
        id: `closing-command-${index}`,
        workflowId: workflow.id,
        kind,
        status: "running",
        projectId: f.project.id,
      };
      f.host.store.state.projectWorkflows.push(workflow);
      f.host.store.state.tasks.push(task);
      f.host.projectWorkflows.entries.set(workflow.id, {
        cancelled: false,
        promise: Promise.resolve(),
      });
      f.host.runs.set(task.id, {
        stop() {
          stopped.push(task.id);
        },
      });
      return workflow;
    },
  );
  const save = f.host.store.save.bind(f.host.store);
  f.host.store.save = async () => {
    throw new Error("Synthetic shutdown disk failure");
  };
  try {
    await assert.rejects(
      f.host.projectWorkflows.close(),
      /shutdown updates could not be saved/,
    );
    assert.deepEqual(stopped, ["closing-command-0", "closing-command-1"]);
    assert.ok(workflows.every((workflow) => workflow.status === "interrupted"));
    assert.ok(
      [...f.host.projectWorkflows.entries.values()].every(
        (entry) => entry.cancelled,
      ),
    );
  } finally {
    f.host.store.save = save;
    f.host.projectWorkflows.entries.clear();
    for (const id of stopped) f.host.runs.delete(id);
  }
});

test("failed checks use bounded owned-file repair and require a fresh check before both reviews", async (t) => {
  const f = await fixture(t, standard);
  const checks = simulatedChecks(f);
  await ask(f);
  await until(() => pendingCheck(f));
  const firstApproval = pendingCheck(f).id;
  await checks.finish(
    await checks.start(pendingCheck(f)),
    1,
    "Observed fixture failure",
  );
  await until(() => pendingCheck(f));
  assert.notEqual(pendingCheck(f).id, firstApproval);
  assert.equal(f.calls.filter((call) => call.stage === "fixing").length, 1);
  assert.match(
    f.calls.find((call) => call.stage === "fixing").options.prompt,
    /Observed fixture failure/,
  );
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
  await checks.finish(await checks.start(pendingCheck(f)));
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "completed", record(f).error);
  assert.deepEqual(
    record(f).checkReceipts.map((receipt) => receipt.exitCode),
    [1, 0],
  );
  assert.equal(record(f).reviewRound, 1);
});

test("a repair cannot remove a required failed check to gain static-only delivery", async (t) => {
  const f = await fixture(t, standard);
  const checks = simulatedChecks(f);
  await ask(f);
  await until(() => pendingCheck(f));
  const task = await checks.start(pendingCheck(f));
  checks.names.splice(0);
  await checks.finish(task, 1, "Observed failure");
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "needs_attention");
  assert.match(
    record(f).error,
    /previously required project check was removed/,
  );
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
});

test("expired approval and orphaned or mismatched managed approval never reach review", async (t) => {
  const f = await fixture(t, standard);
  simulatedChecks(f);
  await ask(f);
  await until(() => pendingCheck(f));
  const approval = pendingCheck(f);
  const executing = structuredClone(approval);
  executing.status = "executing";
  assert.equal(
    f.host.projectWorkflows.guardCheckApproval(executing),
    record(f),
  );
  for (const changed of [
    { ...executing, workflowId: "other" },
    { ...executing, status: "pending" },
    { ...executing, requestedBy: "other" },
    {
      ...executing,
      operation: { ...executing.operation, workflowId: undefined },
    },
    {
      ...executing,
      operation: { ...executing.operation, manifestHash: "b".repeat(64) },
    },
  ])
    assert.throws(() => f.host.projectWorkflows.guardCheckApproval(changed), {
      status: 409,
    });
  const entry = f.host.projectWorkflows.entries.get(record(f).id);
  f.host.projectWorkflows.entries.delete(record(f).id);
  assert.throws(() => f.host.projectWorkflows.guardCheckApproval(executing), {
    status: 409,
  });
  f.host.projectWorkflows.entries.set(record(f).id, entry);
  await f.host.store.change(() => {
    approval.expiresAt = new Date(0).toISOString();
  });
  f.host.projectWorkflows.onCheckApproval(approval);
  await until(() => record(f).status !== "running");
  assert.equal(record(f).status, "needs_attention");
  assert.equal(approval.status, "cancelled");
  assert.equal(record(f).checkReceipts[0].status, "not_run");
  assert.match(record(f).checkSummary, /approval expired/);
  assert.equal(
    f.calls.some((call) => call.stage === "reviewing"),
    false,
  );
});

test("stopping a pending managed check replaces its waiting summary and cancels approval", async (t) => {
  const f = await fixture(t, standard);
  simulatedChecks(f);
  await ask(f);
  await until(() => pendingCheck(f));
  const approval = pendingCheck(f);
  await f.host.projectWorkflows.stop(record(f).id, {
    kind: "owner",
    id: "desktop",
  });
  await until(() => !f.host.projectWorkflows.entries.has(record(f).id));
  assert.equal(record(f).status, "stopped");
  assert.equal(approval.status, "cancelled");
  assert.equal(record(f).checkReceipts[0].status, "not_run");
  assert.match(record(f).checkSummary, /workflow was stopped/);
  assert.doesNotMatch(record(f).checkSummary, /Waiting/);
});

test("late terminal callbacks reconcile stopped check receipts before and after approval task publication", async (t) => {
  for (const publish of [true, false]) {
    const f = await fixture(t, standard);
    const checks = simulatedChecks(f);
    await ask(f);
    await until(() => pendingCheck(f));
    const approval = pendingCheck(f);
    const task = await checks.start(approval, publish);
    if (publish)
      await until(() => record(f).checkReceipts[0].taskId === task.id);
    else assert.equal(approval.result, undefined);
    await f.host.projectWorkflows.stop(record(f).id, {
      kind: "owner",
      id: "desktop",
    });
    await until(() => !f.host.projectWorkflows.entries.has(record(f).id));
    const callsBeforeClose = f.calls.length;
    await f.host.store.change(() => {
      task.status = "stopped";
      task.exitCode = null;
      task.signal = "SIGTERM";
      task.output = "Observed terminal output";
      task.error = "Stopped by user.";
      f.host.commandProcesses.delete(task.id);
    });
    f.host.projectWorkflows.onCheckFinished(task);
    await f.host.store.queue;
    const receipt = record(f).checkReceipts[0];
    assert.equal(receipt.status, "stopped");
    assert.equal(receipt.taskId, task.id);
    assert.equal(receipt.exitCode, null);
    assert.equal(receipt.signal, "SIGTERM");
    assert.equal(receipt.output, "Observed terminal output");
    assert.equal(record(f).status, "stopped");
    assert.equal(f.calls.length, callsBeforeClose);
    assert.ok(record(f).taskIds.includes(task.id));
    const saved = structuredClone(receipt);
    f.host.projectWorkflows.onCheckFinished({
      ...task,
      status: "completed",
      exitCode: 0,
    });
    await f.host.store.queue;
    assert.deepEqual(
      receipt,
      saved,
      "An unrelated callback must not replace the recorded outcome",
    );
  }
});

test("role migration updates only the previous project developer default and only once", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "nakama-team-migration-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const customised of [false, true]) {
    const state = initialState();
    state.config.aiRoles.development.effort = customised ? "high" : "max";
    state.config.aiRoles.chat.model = "my-chat-model";
    state.devices = [{ id: "paired-phone", tokenHash: "private-fixture" }];
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state));
    const store = await new Store(dir).init();
    assert.equal(
      store.state.config.aiRoles.development.effort,
      customised ? "high" : "ultracode",
    );
    assert.equal(store.state.config.aiRoles.tasks.technical.effort, "max");
    assert.equal(store.state.config.aiRoles.chat.model, "my-chat-model");
    assert.equal(store.state.devices[0].tokenHash, "private-fixture");
    await store.change((saved) => {
      saved.config.aiRoles.development.effort = "max";
    });
    const next = await new Store(dir).init();
    assert.equal(next.state.config.aiRoles.development.effort, "max");
  }
});
