import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { Store } from "../apps/host/store.mjs";

const OWNER = { kind: "owner", id: "desktop" };
const block = (value) => `\`\`\`nakama-task\n${JSON.stringify(value)}\n\`\`\``;
function dependencyFixture(host, project, { verifyWait, fail = false } = {}) {
  const hashes = { manifestHash: "a".repeat(64), lockHash: "b".repeat(64) };
  host.projectDependencies.tools = {
    async discoverDependencies() {
      return {
        supported: true,
        runtime: { available: true },
        ...hashes,
        packageCount: 1,
        nodeModulesPresent: false,
      };
    },
    async prepareDependencies({ requestedBy }) {
      return {
        kind: "npm_ci",
        projectId: project.id,
        requestedBy,
        ...hashes,
        command: process.execPath,
        args: [
          "-e",
          `console.log('LOCAL_DEPENDENCY_PROCESS_FIXTURE'); process.exit(${fail ? 2 : 0})`,
        ],
        projectRoot: project.path,
        workspaceRoot: host.store.state.config.workspaceRoot,
      };
    },
    async verifyDependencies({ operation }) {
      await verifyWait?.();
      return {
        command: operation.command,
        args: operation.args,
        cwd: project.path,
        env: {},
      };
    },
    async verifyDependencyResult({
      task,
      approvalId,
      processClosed,
      operation,
      requestedBy,
    }) {
      assert.equal(processClosed, true);
      assert.equal(host.commandProcesses.has(task.id), false);
      assert.equal(task.kind, "project_dependencies");
      assert.equal(task.approvalId, approvalId);
      assert.equal(task.requestedBy, requestedBy);
      assert.equal(task.manifestHash, operation.manifestHash);
      assert.equal(task.lockHash, operation.lockHash);
      assert.equal(task.exitCode, 0);
      return { verified: true, completionEligible: false, ...hashes };
    },
  };
  return hashes;
}

test("autonomous dependency preparation waits for exact PC approval and an actual isolated process result", async (t) => {
  const f = await fixture(t);
  const hashes = dependencyFixture(f.host, f.project);
  const run = await f.start();
  await f.respond({
    kind: "tool",
    tool: "project_dependencies",
    arguments: {},
  });
  await until(() => f.calls.length === 2);
  await f.respond({
    kind: "tool",
    tool: "project_prepare_dependencies",
    arguments: hashes,
  });
  await until(() => run.status === "awaiting_approval");
  const receipt = run.receipts.at(-1);
  const approval = f.host.store.state.approvals.find(
    (a) => a.id === receipt.approvalId,
  );
  assert.equal(approval.type, "project_dependencies");
  assert.equal(approval.operation.requestedBy, OWNER.id);
  assert.equal(
    f.host.store.state.tasks.some((t) => t.kind === "project_dependencies"),
    false,
  );
  const result = await f.host.dispatch(
    "POST",
    `/api/approvals/${approval.id}/resolve`,
    { approved: true },
  );
  await until(() => f.calls.length === 3);
  const task = f.host.store.state.tasks.find((t) => t.id === result.taskId);
  assert.match(task.output, /LOCAL_DEPENDENCY_PROCESS_FIXTURE/);
  assert.equal(task.kind, "project_dependencies");
  assert.equal(f.host.checking.has(f.project.id), false);
  assert.equal(receipt.status, "completed");
  await f.respond({ kind: "verify", receiptId: receipt.id });
  await until(() => f.calls.length === 4);
  assert.equal(receipt.verification.verified, true);
  assert.equal(receipt.verification.completionEligible, false);
});

test("failed dependency preparation stops its autonomous task instead of retrying or treating setup as website acceptance", async (t) => {
  const f = await fixture(t);
  const hashes = dependencyFixture(f.host, f.project, { fail: true });
  const run = await f.start();
  await f.respond({
    kind: "tool",
    tool: "project_prepare_dependencies",
    arguments: hashes,
  });
  await until(() => run.status === "awaiting_approval");
  await f.host.dispatch("POST", `/api/approvals/${run.approvalId}/resolve`, {
    approved: true,
  });
  await until(() => run.status === "needs_attention");
  assert.equal(f.calls.length, 1);
  assert.equal(run.receipts.at(-1).status, "attention");
  assert.equal(f.host.store.state.approvals.length, 1);
  assert.match(
    run.receipts.at(-1).summary,
    /will not be retried automatically/,
  );
});

test("dependency approvals cannot be rebound and stop during runtime verification prevents launch", async (t) => {
  for (const mode of ["tamper", "stop"])
    await t.test(mode, async (t) => {
      const f = await fixture(t);
      let release;
      let entered = false;
      const hashes = dependencyFixture(
        f.host,
        f.project,
        mode === "stop"
          ? {
              verifyWait: () =>
                new Promise((resolve) => {
                  entered = true;
                  release = resolve;
                }),
            }
          : {},
      );
      const run = await f.start();
      await f.respond({
        kind: "tool",
        tool: "project_prepare_dependencies",
        arguments: hashes,
      });
      await until(() => run.status === "awaiting_approval");
      const approval = f.host.store.state.approvals.find(
        (a) => a.id === run.approvalId,
      );
      if (mode === "tamper") approval.operation.lockHash = "c".repeat(64);
      const action = f.host.dispatch(
        "POST",
        `/api/approvals/${approval.id}/resolve`,
        { approved: true },
      );
      const rejected = assert.rejects(
        action,
        /match|active|stopped|running|execut/,
      );
      if (mode === "stop") {
        await until(() => entered);
        await f.host.autonomousTasks.stop(run.id, OWNER);
        release();
      }
      await rejected;
      assert.equal(
        f.host.store.state.tasks.some(
          (task) => task.kind === "project_dependencies",
        ),
        false,
      );
      assert.equal(f.host.commandProcesses.size, 0);
      assert.equal(f.host.checking.has(f.project.id), false);
    });
});

test("ordinary dependency requests reject internal task authority fields", async (t) => {
  const f = await fixture(t);
  const hashes = dependencyFixture(f.host, f.project);
  await assert.rejects(
    f.host.dispatch(
      "POST",
      `/api/projects/${f.project.id}/dependencies/request`,
      {
        ...hashes,
        autonomousRunId: "injected",
        workflowId: "injected",
      },
    ),
    /without custom arguments/,
  );
  assert.equal(f.host.store.state.approvals.length, 0);
});

test("a successful fixture process cannot overrule missing dependency output", async (t) => {
  const f = await fixture(t);
  const hashes = dependencyFixture(f.host, f.project);
  f.host.projectDependencies.tools.verifyDependencyResult = async () => ({
    verified: false,
    completionEligible: false,
    summary: "node_modules is unavailable; preparation is not verified.",
  });
  const run = await f.start();
  await f.respond({
    kind: "tool",
    tool: "project_prepare_dependencies",
    arguments: hashes,
  });
  await until(() => run.status === "awaiting_approval");
  await f.host.dispatch("POST", `/api/approvals/${run.approvalId}/resolve`, {
    approved: true,
  });
  await until(() => run.status === "needs_attention");
  assert.equal(run.receipts.at(-1).status, "attention");
  assert.equal(run.receipts.at(-1).data.verified, false);
  assert.equal(f.calls.length, 1);
});

test("dependency preparation revalidates after task registration before any process can spawn", async (t) => {
  const f = await fixture(t);
  const hashes = dependencyFixture(f.host, f.project);
  let changed = false;
  const originalVerify = f.host.projectDependencies.tools.verifyDependencies;
  f.host.projectDependencies.tools.verifyDependencies = async (args) => {
    if (changed)
      throw new Error("Lockfile changed during queued task persistence");
    return originalVerify(args);
  };
  const originalChange = f.host.store.change.bind(f.host.store);
  f.host.store.change = async (update) => {
    const result = await originalChange(update);
    if (
      f.host.store.state.tasks.some(
        (task) => task.kind === "project_dependencies",
      )
    )
      changed = true;
    return result;
  };
  const run = await f.start();
  const catalogue = f.host.autonomyTools.catalogue(run, OWNER);
  assert.ok(
    catalogue.tools.every(
      (tool) => typeof tool.name === "string" && tool.name.length,
    ),
  );
  await f.respond({
    kind: "tool",
    tool: "project_prepare_dependencies",
    arguments: hashes,
  });
  await until(() => run.status === "awaiting_approval");
  await assert.rejects(
    f.host.dispatch("POST", `/api/approvals/${run.approvalId}/resolve`, {
      approved: true,
    }),
    /Lockfile changed/,
  );
  assert.equal(f.host.commandProcesses.size, 0);
  assert.equal(f.host.checking.has(f.project.id), false);
  const task = f.host.store.state.tasks.find(
    (task) => task.kind === "project_dependencies",
  );
  assert.equal(task.status, "interrupted");
  assert.equal(task.output, "");
});

test("standalone dependency Stop remains available while pre-spawn verification is pending", async (t) => {
  const f = await fixture(t);
  const hashes = dependencyFixture(f.host, f.project);
  const originalVerify = f.host.projectDependencies.tools.verifyDependencies;
  let verifications = 0;
  let release;
  f.host.projectDependencies.tools.verifyDependencies = async (args) => {
    if (++verifications === 2)
      await new Promise((resolve) => {
        release = resolve;
      });
    return originalVerify(args);
  };
  const approval = await f.host.dispatch(
    "POST",
    `/api/projects/${f.project.id}/dependencies/request`,
    hashes,
  );
  const resolving = f.host.dispatch(
    "POST",
    `/api/approvals/${approval.id}/resolve`,
    { approved: true },
  );
  const rejected = assert.rejects(resolving, /stopped before/);
  await until(() => !!release);
  const task = f.host.store.state.tasks.find(
    (task) => task.kind === "project_dependencies",
  );
  await f.host.dispatch("POST", `/api/tasks/${task.id}/stop`, {});
  release();
  await rejected;
  assert.equal(task.status, "stopped");
  assert.equal(task.output, "");
  assert.equal(f.host.commandProcesses.size, 0);
  assert.equal(f.host.runs.has(task.id), false);
  assert.equal(f.host.checking.has(f.project.id), false);
});
test("host shutdown still stops other resources after a workflow persistence failure", async (t) => {
  const f = await fixture(t);
  const original = f.host.projectWorkflows.close.bind(f.host.projectWorkflows);
  let stopped = 0;
  let laterClosed = 0;
  const reportsClose = f.host.reports.close.bind(f.host.reports);
  f.host.projectWorkflows.close = async () => {
    throw new Error("Synthetic journal failure");
  };
  f.host.reports.close = async () => {
    laterClosed++;
    await reportsClose();
  };
  f.host.runs.set("synthetic-pending-command", {
    stop: () => {
      stopped++;
      f.host.runs.delete("synthetic-pending-command");
    },
  });
  await assert.rejects(f.host.close(), AggregateError);
  assert.equal(stopped, 1);
  assert.equal(laterClosed, 1);
  assert.equal(f.host.server, null);
  assert.equal(f.host.browserServer, null);
  f.host.projectWorkflows.close = original;
});

async function until(check) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "Autonomous fixture timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture(t, browserStudioAdapter) {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-autonomous-host-"));
  const calls = [];
  const host = await new NakamaHost({
    dataDir: path.join(dir, "state"),
    browserStudioAdapter,
    runAgent: async (provider, options) => {
      calls.push({ provider, options });
      return { stop() {} };
    },
  }).init();
  const workspaceRoot = path.join(dir, "projects");
  await fs.mkdir(workspaceRoot);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Local autonomy fixture",
  });
  await fs.writeFile(
    path.join(project.path, "package.json"),
    JSON.stringify({ private: true, scripts: { test: "node test.cjs" } }),
  );
  await fs.writeFile(
    path.join(project.path, "test.cjs"),
    "console.log('LOCAL_AUTONOMY_CHECK');",
  );
  t.after(async () => {
    await host.close();
    await until(() => !host.commandProcesses.size);
    await host.store.queue;
    assert.equal(path.dirname(dir), base);
    assert.ok(path.basename(dir).startsWith("nakama-autonomous-host-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    host,
    project,
    calls,
    dir,
    async respond(value) {
      const call = calls.at(-1);
      await call.options.onComplete({ code: 0, text: block(value) });
    },
    async start(principal = OWNER) {
      await host.dispatch(
        "POST",
        "/api/autonomous-tasks",
        {
          goal: "Read the project scripts and run its test after PC approval. Summarise the actual outcome.",
          projectId: project.id,
        },
        principal,
      );
      await until(() => calls.length > 0);
      return host.store.state.autonomousTasks.at(-1);
    },
  };
}

test("autonomous task coordinates fresh approval, actual npm exit and saved evidence without a live model", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  assert.ok(!f.calls[0].options.prompt.includes("```nakama-browser"));
  await f.respond({ kind: "tool", tool: "project_checks", arguments: {} });
  await until(() => f.calls.length === 2);
  const discovery = run.receipts.find((r) => r.tool === "project_checks");
  const manifestHash = discovery.data.manifestHash;
  assert.ok(manifestHash);
  await f.respond({
    kind: "tool",
    tool: "project_check",
    arguments: { name: "test", manifestHash },
  });
  await until(() => run.status === "awaiting_approval");
  const receipt = run.receipts.find((r) => r.tool === "project_check");
  const approval = f.host.store.state.approvals.find(
    (r) => r.id === receipt.approvalId,
  );
  assert.equal(approval.operation.autonomousRunId, run.id);
  assert.equal(approval.operation.autonomousReceiptId, receipt.id);
  assert.equal(
    f.host.store.state.tasks.filter((r) => r.kind === "project_check").length,
    0,
  );
  const result = await f.host.dispatch(
    "POST",
    `/api/approvals/${approval.id}/resolve`,
    { approved: true },
  );
  assert.equal(result.status, "started");
  await until(() => f.calls.length === 3);
  assert.equal(receipt.data.exitCode, 0);
  assert.match(receipt.data.output, /LOCAL_AUTONOMY_CHECK/);
  assert.equal(f.host.commandProcesses.has(receipt.data.taskId), false);
  await f.respond({ kind: "verify", receiptId: receipt.id });
  await until(() => f.calls.length === 4);
  await f.respond({
    kind: "finish",
    summary:
      "The local test exited successfully; application acceptance remains open.",
    evidence: [receipt.id],
  });
  await until(() => run.status === "review_required");
  assert.equal(
    run.receipts.find((r) => r.id === receipt.id).verification.verified,
    true,
  );
  assert.equal(
    f.host.boards
      .taskState(OWNER)
      .items.filter((r) => r.sourceKind === "autonomous").length,
    1,
  );
  assert.ok(
    !f.host.boards
      .taskState(OWNER)
      .items.some(
        (r) =>
          r.sourceKind === "task" &&
          f.host.store.state.tasks.find((task) => task.id === r.sourceId)
            ?.autonomousRunId,
      ),
  );
});

test("successive manager turns keep the real BrowserStudio session bound to one active coordinator", async (t) => {
  const callbacks = new Map();
  const f = await fixture(t, {
    available: true,
    async create(value) {
      callbacks.set(value.id, value.onChange);
    },
    async createTab() {},
    async navigate(id, tabId, url) {
      callbacks.get(id)({
        tabId,
        url,
        title: "Synthetic source",
        loading: false,
      });
    },
    async read() {
      return {
        revision: 1,
        title: "Synthetic source",
        url: "https://example.com/fixture",
        text: "Offline test content",
        elements: [],
      };
    },
    destroy(id) {
      callbacks.delete(id);
    },
    close() {},
  });
  const run = await f.start();
  await f.respond({
    kind: "tool",
    tool: "browser",
    arguments: {
      action: "create",
      mode: "research",
      url: "https://example.com/fixture",
    },
  });
  await until(() => f.calls.length === 2);
  const sessionId = run.receipts[0].reference.sessionId;
  assert.equal(
    f.host.browserStudio.publicStatus(OWNER).sessions[0].taskId,
    run.coordinatorTaskId,
  );
  await f.respond({
    kind: "tool",
    tool: "browser",
    arguments: { action: "read", sessionId },
  });
  await until(() => f.calls.length === 3);
  const receipt = run.receipts[1];
  assert.equal(receipt.observation.text, "Offline test content");
  await f.respond({ kind: "verify", receiptId: receipt.id });
  await until(() => f.calls.length === 4);
  assert.equal(receipt.verification.verified, true);
  assert.equal(
    f.host.browserStudio.publicStatus(OWNER).sessions[0].taskId,
    run.coordinatorTaskId,
  );
  await f.respond({
    kind: "finish",
    summary:
      "Read the synthetic source; general outcome still requires review.",
    evidence: [receipt.id],
  });
  await until(() => run.status === "review_required");
  assert.equal(
    f.host.store.state.tasks.find((task) => task.id === run.coordinatorTaskId)
      .status,
    "review_required",
  );
});

test("stopping cancels a pending exact check approval and prevents later execution", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  const discovery = await f.host.discoverProjectChecks(f.project.id, OWNER);
  await f.respond({
    kind: "tool",
    tool: "project_check",
    arguments: { name: "test", manifestHash: discovery.manifestHash },
  });
  await until(() => run.status === "awaiting_approval");
  const approval = f.host.store.state.approvals.find(
    (a) => a.id === run.approvalId,
  );
  await f.host.dispatch("POST", `/api/autonomous-tasks/${run.id}/stop`, {});
  assert.equal(approval.status, "cancelled");
  await assert.rejects(
    f.host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
      approved: true,
    }),
  );
  assert.equal(
    f.host.store.state.tasks.filter((r) => r.kind === "project_check").length,
    0,
  );
});

test("a rejected check approval stops autonomous continuation without another model or approval", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  const discovery = await f.host.discoverProjectChecks(f.project.id, OWNER);
  await f.respond({
    kind: "tool",
    tool: "project_check",
    arguments: { name: "test", manifestHash: discovery.manifestHash },
  });
  await until(() => run.status === "awaiting_approval");
  await f.host.dispatch("POST", `/api/approvals/${run.approvalId}/resolve`, {
    approved: false,
  });
  await until(() => run.status === "needs_attention");
  assert.equal(f.calls.length, 1);
  assert.equal(f.host.store.state.approvals.length, 1);
  assert.equal(
    f.host.store.state.tasks.filter((task) => task.kind === "project_check")
      .length,
    0,
  );
});

test("disabled phone cannot read autonomous state or start runs; revocation stops its active run", async (t) => {
  const f = await fixture(t);
  const phone = {
    id: "synthetic-phone",
    platform: "android",
    permissions: { projectAccess: true, googleAccess: true },
  };
  f.host.store.state.devices.push(phone);
  const principal = { kind: "device", id: phone.id };
  const run = await f.start(principal);
  phone.permissions.googleAccess = false;
  f.host.stopDeviceRuns(phone.id);
  await until(() => run.status === "stopped");
  await assert.rejects(
    f.host.dispatch("GET", "/api/autonomous-tasks", {}, principal),
  );
  const state = await f.host.dispatch("GET", "/api/state", {}, principal);
  assert.deepEqual(state.autonomousTasks, []);
  assert.deepEqual(state.tasks, []);
});

test("restart keeps receipts and cancels pending approvals without replaying any action", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  const discovery = await f.host.discoverProjectChecks(f.project.id, OWNER);
  await f.respond({
    kind: "tool",
    tool: "project_check",
    arguments: { name: "test", manifestHash: discovery.manifestHash },
  });
  await until(() => run.status === "awaiting_approval");
  await f.host.store.queue;
  const restarted = await new Store(f.host.store.dir).init();
  assert.equal(restarted.state.autonomousTasks[0].status, "interrupted");
  assert.equal(
    restarted.state.approvals.find((a) => a.id === run.approvalId).status,
    "cancelled",
  );
  assert.ok(!restarted.publicState(true).autonomousTasks);
});

test("tampered autonomous check bindings cannot dispatch a command", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  const discovery = await f.host.discoverProjectChecks(f.project.id, OWNER);
  await f.respond({
    kind: "tool",
    tool: "project_check",
    arguments: { name: "test", manifestHash: discovery.manifestHash },
  });
  await until(() => run.status === "awaiting_approval");
  const approval = f.host.store.state.approvals.find(
    (a) => a.id === run.approvalId,
  );
  approval.operation.autonomousReceiptId = "another-attempt";
  await assert.rejects(
    f.host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
      approved: true,
    }),
    /no longer matches/,
  );
  assert.equal(
    f.host.store.state.tasks.filter((r) => r.kind === "project_check").length,
    0,
  );
});

test("Stop terminates an owned command even when cancellation cannot be saved", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  let stopped = 0;
  f.host.store.state.tasks.push({
    id: "unlinked-command",
    autonomousRunId: run.id,
    providerId: "terminal",
  });
  f.host.runs.set("unlinked-command", {
    stop() {
      stopped++;
    },
  });
  const change = f.host.store.change.bind(f.host.store);
  f.host.store.change = async () => {
    throw new Error("Synthetic cancellation disk failure");
  };
  try {
    await assert.rejects(f.host.autonomyTools.stop(run), /disk failure/);
  } finally {
    f.host.store.change = change;
    f.host.runs.delete("unlinked-command");
  }
  assert.equal(stopped, 1);
});

test("failed terminal receipt persistence never becomes verified successful execution", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  const discovery = await f.host.discoverProjectChecks(f.project.id, OWNER);
  await f.respond({
    kind: "tool",
    tool: "project_check",
    arguments: { name: "test", manifestHash: discovery.manifestHash },
  });
  await until(() => run.status === "awaiting_approval");
  const approval = f.host.store.state.approvals.find(
    (a) => a.id === run.approvalId,
  );
  const save = f.host.store.save.bind(f.host.store);
  let rejected = false;
  f.host.store.save = async () => {
    if (
      !rejected &&
      f.host.store.state.tasks.some(
        (task) =>
          task.autonomousRunId === run.id &&
          task.kind === "project_check" &&
          task.status === "completed",
      )
    ) {
      rejected = true;
      throw new Error("Synthetic terminal receipt disk failure");
    }
    return save();
  };
  const started = await f.host.dispatch(
    "POST",
    `/api/approvals/${approval.id}/resolve`,
    { approved: true },
  );
  await until(() => f.calls.length > 1 || run.status === "needs_attention");
  assert.equal(rejected, true);
  const task = f.host.store.state.tasks.find((r) => r.id === started.taskId);
  assert.equal(task.status, "interrupted");
  const receipt = run.receipts.find((r) => r.tool === "project_check");
  assert.equal(receipt.status, "attention");
  assert.equal(f.host.commandProcesses.has(task.id), false);
  assert.ok(!receipt.verification?.verified);
});
