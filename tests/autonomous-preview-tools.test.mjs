import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ProjectPreviews } from "../apps/host/project-previews.mjs";
import { BrowserStudio } from "../apps/host/browser-studio.mjs";
import { createAutonomousPreviewTools } from "../apps/host/autonomous-preview-tools.mjs";

const OWNER = { kind: "owner", id: "desktop" },
  PHONE = { kind: "device", id: "phone" },
  HASH = "a".repeat(64),
  request = (tool, args = {}) => ({ tool, arguments: args });
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(t, principal = OWNER) {
  const project = {
    id: "project",
    name: "Synthetic site",
    path: "C:\\synthetic\\project",
  };
  const record = {
    id: "run",
    requestedBy: principal.id,
    projectId: project.id,
    goal: "Build and verify the website locally.",
    status: "running",
    receipts: [],
  };
  const store = new EventEmitter();
  store.state = {
    config: { workspaceRoot: "C:\\synthetic" },
    projects: [project],
    tasks: [
      {
        id: "coordinator",
        projectId: project.id,
        requestedBy: principal.id,
        autonomousRunId: record.id,
        status: "running",
      },
    ],
    approvals: [],
    projectWorkflows: [],
    devices: [
      {
        id: PHONE.id,
        platform: "android",
        permissions: {
          projectAccess: true,
          googleAccess: true,
          browserControl: true,
        },
      },
    ],
  };
  store.change = async (fn) => {
    if (f.saveFails) throw new Error("Synthetic storage failure");
    return fn(store.state);
  };
  const f = {
    record,
    store,
    project,
    principal,
    manifestHash: HASH,
    script: "vite",
    launches: [],
    stops: [],
    saveFails: false,
  };
  const host = {
    store,
    runs: new Map(),
    commandProcesses: new Map(),
    project(id) {
      if (id !== project.id) throw new Error("Wrong project");
      return project;
    },
    autonomousTasks: {
      get(id) {
        if (id !== record.id) throw new Error("Unknown autonomous task");
        return record;
      },
      guard(run) {
        assert.equal(run, record);
        if (!["running", "awaiting_approval"].includes(record.status))
          throw new Error("Stopped autonomous task");
        if (
          principal.kind === "device" &&
          store.state.devices[0].permissions.googleAccess === false
        )
          throw new Error("Revoked personal access");
      },
    },
    async approval(type, title, description, operation, actor, options) {
      options.guard();
      const approval = {
        id: `approval-${store.state.approvals.length}`,
        type,
        title,
        description,
        operation,
        requestedBy: actor.id,
        status: "pending",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
      await store.change((state) => {
        options.guard();
        state.approvals.push(approval);
        options.onCreated(approval);
      });
      return approval;
    },
    async startCommand(op, actor, options) {
      f.launches.push({ op, actor, options });
      await f.beforeSpawn?.();
      options.guard();
      const task = {
        id: `terminal-${f.launches.length}`,
        providerId: "terminal",
        kind: "project_preview",
        projectId: op.projectId,
        requestedBy: actor.id,
        status: "running",
        autonomousRunId: options.autonomousRunId,
        autonomousReceiptId: options.autonomousReceiptId,
        approvalId: options.approvalId,
        previewLaunchId: options.preview?.launchId,
        previewOrigin: options.preview?.origin,
        checkName: op.checkName,
        manifestHash: op.manifestHash,
      };
      store.state.tasks.push(task);
      await f.afterTaskSaved?.();
      await options.beforeSpawn?.();
      options.guard();
      host.commandProcesses.set(task.id, project.id);
      host.runs.set(task.id, {
        stop() {
          f.stops.push(task.id);
          task.status = "stopped";
          host.commandProcesses.delete(task.id);
          host.runs.delete(task.id);
          options.onProcessClose();
        },
      });
      await f.afterSpawn?.();
      return task;
    },
  };
  const checks = {
    async discoverChecks() {
      await f.beforeDiscover?.();
      return {
        supported: true,
        runtime: { available: true },
        manifestHash: f.manifestHash,
        checks: [{ name: "dev", script: f.script, preview: "npm run dev" }],
      };
    },
    async prepareCheck({ project: selected, name, manifestHash }) {
      if (manifestHash !== f.manifestHash) throw new Error("Manifest changed");
      return {
        projectId: selected.id,
        checkName: name,
        manifestHash,
        preview: "npm run dev",
        command: "synthetic",
      };
    },
    async verifyCheck({ operation }) {
      await f.beforeVerify?.();
      if (operation.manifestHash !== f.manifestHash)
        throw new Error("Manifest changed");
      return {
        command: "synthetic",
        args: ["npm-cli", "run", "dev"],
        cwd: project.path,
        env: {
          FIXTURE_PUBLIC: "yes",
          API_KEY: "synthetic-secret",
          DATABASE_URL: "synthetic-db",
        },
      };
    },
  };
  host.projectPreviews = new ProjectPreviews(host, {
    checkTools: checks,
    allocatePort: async () => {
      await f.beforePort?.();
      return 5555;
    },
  });
  const base = {
    catalogue: () => ({ tools: [{ tool: "browser" }] }),
    execute: async () => ({ status: "completed", summary: "Base" }),
    guardApproval: (approval) => {
      f.delegated = approval;
    },
    verify: async () => ({ verified: false }),
    stop: async () => {
      f.baseStopped = true;
    },
  };
  host.autonomyTools = createAutonomousPreviewTools(host, base);
  f.host = host;
  f.ctx = {
    record,
    taskId: "coordinator",
    principal,
    guard: () => host.autonomousTasks.guard(record),
  };
  f.prepare = async () => {
    const receipt = {
      id: `receipt-${record.receipts.length}`,
      tool: "project_preview",
      status: "dispatching",
      request: request("project_preview", { name: "dev", manifestHash: HASH }),
    };
    record.receipts.push(receipt);
    const result = await host.autonomyTools.execute(receipt.request, {
      ...f.ctx,
      receiptId: receipt.id,
    });
    Object.assign(receipt, result);
    return { receipt, approval: store.state.approvals.at(-1) };
  };
  f.approve = async (approval) => {
    approval.status = "executing";
    try {
      const launch = await host.projectPreviews.approved(
        approval.operation,
        approval,
      );
      await store.change(() => {
        approval.result = launch;
        approval.status = "completed";
      });
      return launch;
    } catch (error) {
      approval.status = "failed";
      throw error;
    }
  };
  t.after(() => {
    host.projectPreviews.close();
    f.browser?.close();
  });
  return f;
}

test("preview discovery is bounded and cannot accept command, URL, port or ownership fields", async (t) => {
  const f = fixture(t),
    tools = f.host.autonomyTools;
  assert.deepEqual(
    tools.catalogue(undefined, OWNER).tools.map((row) => row.tool),
    ["browser", "project_previews", "project_preview", "project_preview_stop"],
  );
  f.script = "vite " + "界".repeat(20000);
  const discovery = await tools.execute(request("project_previews"), f.ctx);
  assert.equal(discovery.status, "completed");
  assert.equal(discovery.observation.checks[0].script.length, 300);
  assert.ok(Buffer.byteLength(JSON.stringify(discovery.observation)) < 24000);
  for (const key of [
    "command",
    "args",
    "url",
    "port",
    "projectId",
    "autonomousRunId",
  ])
    await assert.rejects(
      tools.execute(
        request("project_preview", {
          name: "dev",
          manifestHash: HASH,
          [key]: "injected",
        }),
        f.ctx,
      ),
      /Unexpected/,
    );
  await assert.rejects(
    tools.execute(
      request("project_preview", { name: "build", manifestHash: HASH }),
      f.ctx,
    ),
    /dev\/start/,
  );
  assert.equal(f.store.state.approvals.length, 0);
  assert.equal(f.launches.length, 0);
});

test("preview request binds exact PC approval and yields launch-only evidence, never page readiness", async (t) => {
  const f = fixture(t),
    { receipt, approval } = await f.prepare();
  assert.equal(approval.operation.autonomousRunId, f.record.id);
  assert.equal(approval.autonomousReceiptId, receipt.id);
  assert.equal(f.launches.length, 0);
  assert.equal(
    (await f.host.autonomyTools.settle(receipt, f.ctx)).status,
    "awaiting_approval",
  );
  await assert.rejects(
    f.host.projectPreviews.approved(approval.operation, approval),
    /approval/,
  );
  const launch = await f.approve(approval);
  assert.equal(launch.origin, "http://127.0.0.1:5555");
  assert.deepEqual(f.launches[0].options.preview, {
    launchId: launch.id,
    origin: launch.origin,
  });
  assert.deepEqual(f.launches[0].op.args.slice(-6), [
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    "5555",
    "--strictPort",
  ]);
  assert.equal(f.launches[0].options.env.API_KEY, undefined);
  assert.equal(f.launches[0].options.env.DATABASE_URL, undefined);
  Object.assign(receipt, await f.host.autonomyTools.settle(receipt, f.ctx));
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.observation.scope, "approved_process_launch_only");
  assert.match(receipt.summary, /not yet verified/);
  const verification = await f.host.autonomyTools.verify(receipt, f.ctx);
  assert.equal(verification.verified, true);
  assert.equal(verification.completionEligible, false);
  f.host.commandProcesses.delete(launch.taskId);
  assert.equal(
    (await f.host.autonomyTools.verify(receipt, f.ctx)).verified,
    false,
  );
});

test("every autonomous preview approval binding is rechecked before process launch", async (t) => {
  const f = fixture(t),
    { receipt, approval } = await f.prepare();
  approval.status = "executing";
  for (const [object, key, replacement] of [
    [approval, "autonomousRunId", "other"],
    [approval, "autonomousReceiptId", undefined],
    [approval, "requestedBy", "other"],
    [approval.operation, "projectId", "other"],
    [approval.operation, "autonomousRunId", undefined],
    [approval.operation, "autonomousReceiptId", "other"],
    [approval.operation, "manifestHash", "b".repeat(64)],
    [approval.operation, "checkName", "start"],
    [receipt, "approvalId", "other"],
    [receipt, "status", "completed"],
  ]) {
    const old = object[key];
    object[key] = replacement;
    assert.throws(() => f.host.autonomyTools.guardApproval(approval));
    object[key] = old;
  }
  assert.throws(
    () => f.host.autonomyTools.guardApproval(structuredClone(approval)),
    /approval/,
  );
  await assert.rejects(
    f.host.projectPreviews.approved({ ...approval.operation }, approval),
    /exact saved/,
  );
  f.host.autonomyTools.guardApproval(approval);
  assert.equal(f.launches.length, 0);
});

test("manifest changes and unsupported server scripts do not start a preview", async (t) => {
  const f = fixture(t),
    { approval } = await f.prepare();
  f.manifestHash = "b".repeat(64);
  await assert.rejects(f.approve(approval), /Manifest changed/);
  assert.equal(f.host.projectPreviews.entries.size, 0);
  assert.equal(f.launches.length, 0);
  f.manifestHash = HASH;
  f.script = "node arbitrary.cjs";
  await assert.rejects(f.prepare(), /plain vite or next dev/);
  f.script = "vite && node other.cjs";
  await assert.rejects(f.prepare(), /plain vite or next dev/);
});

for (const stage of ["beforeVerify", "beforePort", "beforeSpawn"]) {
  test(`Stop cancels preview during ${stage} and no delayed process survives`, async (t) => {
    const f = fixture(t),
      { approval } = await f.prepare(),
      gate = deferred(),
      entered = deferred();
    f[stage] = () => {
      entered.resolve();
      return gate.promise;
    };
    const attempt = f.approve(approval);
    await entered.promise;
    f.record.status = "stopped";
    await f.host.autonomyTools.stop(f.record);
    gate.resolve();
    await assert.rejects(attempt, /Stopped|stopped/);
    assert.equal(f.host.commandProcesses.size, 0);
    assert.equal(f.host.projectPreviews.entries.size, 0);
  });
}

test("Stop finds an early spawned preview before its task ID has returned", async (t) => {
  const f = fixture(t),
    { approval } = await f.prepare(),
    gate = deferred(),
    entered = deferred();
  f.afterSpawn = () => {
    entered.resolve();
    return gate.promise;
  };
  const attempt = f.approve(approval);
  await entered.promise;
  assert.equal(
    f.host.projectPreviews.entries.get(f.project.id).taskId,
    undefined,
  );
  f.record.status = "stopped";
  await f.host.autonomyTools.stop(f.record);
  gate.resolve();
  await assert.rejects(attempt, /Stopped|stopped/);
  assert.equal(f.host.commandProcesses.size, 0);
  assert.equal(f.stops.length, 1);
});

test("revoked phone access suppresses a late preview launch", async (t) => {
  const f = fixture(t, PHONE),
    { approval } = await f.prepare(),
    gate = deferred(),
    entered = deferred();
  f.beforePort = () => {
    entered.resolve();
    return gate.promise;
  };
  const attempt = f.approve(approval);
  await entered.promise;
  f.store.state.devices[0].permissions.googleAccess = false;
  gate.resolve();
  await assert.rejects(attempt, /disabled|Revoked/);
  assert.equal(f.launches.length, 0);
});

test("Stop cancels pending approval and still terminates owned preview after disk failure", async (t) => {
  const f = fixture(t),
    { approval } = await f.prepare();
  await f.host.autonomyTools.stop(f.record);
  assert.equal(approval.status, "cancelled");
  const second = await f.prepare();
  await f.approve(second.approval);
  f.record.status = "stopped";
  f.saveFails = true;
  await assert.rejects(f.host.autonomyTools.stop(f.record), /storage failure/);
  assert.equal(f.host.commandProcesses.size, 0);
  assert.equal(f.host.projectPreviews.entries.size, 0);
  assert.equal(f.baseStopped, true);
});

test("pre-existing or replacement previews cannot be claimed or stopped by a different task", async (t) => {
  const f = fixture(t);
  f.host.projectPreviews.entries.set(f.project.id, {
    id: "other",
    status: "running",
    origin: "http://127.0.0.1:5555",
    taskId: "other-task",
  });
  let foreignStops = 0;
  f.host.runs.set("other-task", {
    stop() {
      foreignStops++;
    },
  });
  await assert.rejects(f.prepare(), /Stop the current/);
  await f.host.autonomyTools.stop(f.record);
  assert.equal(f.host.projectPreviews.entries.get(f.project.id).id, "other");
  assert.equal(foreignStops, 0);
  f.host.projectPreviews.entries.clear();
  const { receipt, approval } = await f.prepare();
  await f.approve(approval);
  f.host.projectPreviews.entries.get(f.project.id).id = "replacement";
  assert.equal(
    (await f.host.autonomyTools.settle(receipt, f.ctx)).status,
    "attention",
  );
});

test("bound launch enables separate exact-origin browser reads and private content stays withheld", async (t) => {
  const f = fixture(t),
    { receipt, approval } = await f.prepare();
  await f.approve(approval);
  const launch = f.host.projectPreviews.public(f.project.id);
  const navigations = [];
  let sensitive = false;
  const adapter = {
    available: true,
    async create() {},
    async createTab() {},
    async navigate(_id, _tabId, url) {
      navigations.push(url);
    },
    async read() {
      return sensitive
        ? { sensitive: true, text: "NEVER_SHARE" }
        : {
            sensitive: false,
            revision: 1,
            url: launch.origin,
            title: "Synthetic site",
            text: "Local acceptance fixture",
            elements: [],
          };
    },
    destroy() {},
    close() {},
  };
  f.browser = new BrowserStudio(f.host, { adapter, timers: false });
  const act = (body) =>
    f.browser.agentAction(body, { taskId: "coordinator", principal: OWNER });
  const { session } = await act({ action: "create", mode: "project" });
  assert.deepEqual(navigations, [launch.origin + "/"]);
  assert.equal(
    (await act({ action: "read", sessionId: session.id })).text,
    "Local acceptance fixture",
  );
  await assert.rejects(
    act({
      action: "navigate",
      sessionId: session.id,
      url: "http://127.0.0.1:43110/api/state",
    }),
    /approved local preview origin/,
  );
  sensitive = true;
  assert.deepEqual(await act({ action: "read", sessionId: session.id }), {
    status: "attention",
    sessionId: session.id,
    detail: "Login/sensitive content withheld.",
  });
  assert.equal(f.browser.reportImages(f.project.id).length, 0);
  await assert.rejects(
    act({ action: "read", sessionId: session.id }),
    /private/,
  );
  assert.equal(
    (
      await f.host.autonomyTools.verify(
        { ...receipt, status: "completed" },
        f.ctx,
      )
    ).completionEligible,
    false,
  );
});

test("preview re-verifies the original script after the queued task save and before spawning", async (t) => {
  const f = fixture(t),
    { approval } = await f.prepare();
  f.afterTaskSaved = async () => {
    f.manifestHash = "b".repeat(64);
  };
  await assert.rejects(f.approve(approval), /Manifest changed/);
  assert.equal(f.host.commandProcesses.size, 0);
  assert.equal(f.host.projectPreviews.entries.size, 0);
});

test("stop-own-preview retains exact shutdown target and waits for actual process close", async (t) => {
  const f = fixture(t),
    { receipt: source, approval } = await f.prepare();
  const launch = await f.approve(approval);
  Object.assign(source, await f.host.autonomyTools.settle(source, f.ctx));
  const task = f.store.state.tasks.find((row) => row.id === launch.taskId),
    originalStop = f.host.runs.get(task.id).stop;
  f.host.runs.set(task.id, {
    stop() {
      task.status = "stopped";
    },
  });
  const receipt = {
    id: "stop-receipt",
    tool: "project_preview_stop",
    status: "dispatching",
    request: request("project_preview_stop", { launchId: launch.id }),
  };
  f.record.receipts.push(receipt);
  Object.assign(
    receipt,
    await f.host.autonomyTools.execute(receipt.request, {
      ...f.ctx,
      receiptId: receipt.id,
    }),
  );
  assert.equal(receipt.status, "awaiting_result");
  assert.equal(f.host.projectPreviews.public(f.project.id), null);
  assert.deepEqual(receipt.reference, {
    tool: "project_preview_stop",
    launchId: launch.id,
    taskId: task.id,
    sourceReceiptId: source.id,
    approvalId: approval.id,
  });
  assert.equal(
    (await f.host.autonomyTools.settle(receipt, f.ctx)).status,
    "awaiting_result",
  );
  originalStop();
  Object.assign(receipt, await f.host.autonomyTools.settle(receipt, f.ctx));
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.observation.scope, "owned_preview_process_shutdown");
  const verified = await f.host.autonomyTools.verify(receipt, f.ctx);
  assert.equal(verified.verified, true);
  assert.equal(verified.completionEligible, false);
  task.status = "interrupted";
  assert.equal(
    (await f.host.autonomyTools.verify(receipt, f.ctx)).verified,
    false,
  );
});

test("stop-own-preview rejects foreign launches, forged task identity and storage failure before effect", async (t) => {
  const f = fixture(t),
    { receipt: source, approval } = await f.prepare();
  const launch = await f.approve(approval);
  Object.assign(source, await f.host.autonomyTools.settle(source, f.ctx));
  const receipt = {
    id: "stop-receipt",
    tool: "project_preview_stop",
    status: "dispatching",
    request: request("project_preview_stop", { launchId: "foreign" }),
  };
  f.record.receipts.push(receipt);
  const ctx = { ...f.ctx, receiptId: receipt.id };
  await assert.rejects(
    f.host.autonomyTools.execute(receipt.request, ctx),
    /completed preview launch/,
  );
  receipt.request.arguments.launchId = launch.id;
  const task = f.store.state.tasks.find((row) => row.id === launch.taskId);
  task.autonomousRunId = "foreign";
  await assert.rejects(
    f.host.autonomyTools.execute(receipt.request, ctx),
    /no longer running/,
  );
  task.autonomousRunId = f.record.id;
  f.saveFails = true;
  await assert.rejects(
    f.host.autonomyTools.execute(receipt.request, ctx),
    /storage failure/,
  );
  f.saveFails = false;
  assert.equal(f.stops.length, 0);
  assert.equal(f.host.projectPreviews.public(f.project.id).id, launch.id);
  assert.equal(f.store.state.approvals.length, 1);
});
