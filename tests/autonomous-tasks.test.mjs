import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../apps/host/store.mjs";
import {
  AutonomousTasks,
  parseAutonomousDecision,
} from "../apps/host/autonomous-tasks.mjs";
import { uid } from "../apps/host/security.mjs";

const OWNER = { kind: "owner", id: "desktop" };
const block = (value) => "```nakama-task\n" + JSON.stringify(value) + "\n```";
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(predicate) {
  const end = Date.now() + 6000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Autonomous fixture timed out");
    await pause();
  }
}
async function fixture(t, decide, tools = {}, options = {}) {
  const dir = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "nakama-autonomy-core-"),
  );
  const store = await new Store(dir).init();
  const calls = [],
    executions = [];
  const host = {
    store,
    runs: new Map(),
    closing: false,
    project: (id) => {
      const project = store.state.projects.find((row) => row.id === id);
      if (!project) throw new Error("Unknown project");
      return project;
    },
    autonomyTools: {
      catalogue: () => ({
        tools: [{ tool: "project_read", name: "Read fixture" }],
      }),
      execute: async (request, context) => {
        executions.push({ request, context });
        context.guard();
        return {
          status: "completed",
          summary: "Read the exact fixture",
          data: { content: "Fixture evidence", image: "private pixels" },
          reference: { tool: request.tool, path: "README.md" },
        };
      },
      verify: async () => ({
        verified: true,
        summary: "Separate fixture observation matches",
        completionEligible: true,
      }),
      ...tools,
    },
    chat: async (body, principal, control) => {
      const task = {
        id: uid(),
        requestedBy: principal.id,
        projectId: body.projectId,
        providerId: body.providerId,
        status: "running",
        ...control.taskMeta,
      };
      calls.push({ body, control, task });
      await store.change((state) => {
        control.guard();
        state.tasks.push(task);
        control.onTasks([task]);
      });
      host.runs.set(task.id, {
        stop() {
          task.status = "stopped";
          host.runs.delete(task.id);
          control.onFinished(task, "");
        },
      });
      setTimeout(async () => {
        try {
          const value = await decide(
            store.state.autonomousTasks.at(-1),
            calls,
            task,
          );
          if (value === undefined) return;
          await store.change(() => {
            if (task.status === "running") task.status = "completed";
          });
          host.runs.delete(task.id);
          control.onFinished(
            task,
            typeof value === "string" ? value : block(value),
          );
        } catch (error) {
          task.status = "failed";
          task.error = error.message;
          control.onFinished(task, "");
        }
      }, 0);
      return { taskIds: [task.id] };
    },
  };
  const runner = new AutonomousTasks(host, options);
  t.after(async () => {
    await runner.close();
    await store.queue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    host,
    runner,
    calls,
    executions,
    dir,
    record: () => store.state.autonomousTasks.at(-1),
    start: (principal = OWNER) =>
      runner.start(
        { goal: "Read the current fixture and report its evidence" },
        principal,
      ),
  };
}
const evidenceFlow = (record) =>
  !record.receipts.length
    ? { kind: "tool", tool: "project_read", arguments: { path: "README.md" } }
    : !record.receipts[0].verification
      ? { kind: "verify", receiptId: record.receipts[0].id }
      : {
          kind: "finish",
          summary: "Observed fixture result; no external effects claimed.",
          evidence: [record.receipts[0].id],
        };

test("task protocol rejects unsupported tools, forged verification and mixed output", () => {
  assert.equal(
    parseAutonomousDecision(
      block({ kind: "tool", tool: "browser", arguments: { action: "read" } }),
    ).kind,
    "tool",
  );
  for (const value of [
    block({ kind: "tool", tool: "shell", arguments: { command: "anything" } }),
    block({ kind: "tool", tool: "project_deploy", arguments: {} }),
    block({ kind: "verify", receiptId: "receipt", verified: true }),
    block({ kind: "finish", summary: "Done", evidence: ["same", "same"] }),
    "Done.\n" + block({ kind: "ask", questions: ["Which source?"] }),
  ])
    assert.throws(() => parseAutonomousDecision(value));
  for (const args of [
    { image: "private" },
    { text: "password=private-value" },
    { nested: { apiKey: "hidden" } },
    { text: "data:image/png;base64,AAA" },
  ])
    assert.throws(
      () =>
        parseAutonomousDecision(
          block({ kind: "tool", tool: "browser", arguments: args }),
        ),
      { status: 400 },
    );
});

test("a durable attempt precedes tool dispatch and independent verification precedes completion", async (t) => {
  const f = await fixture(t, evidenceFlow);
  const execute = f.host.autonomyTools.execute;
  f.host.autonomyTools.execute = async (request, context) => {
    const disk = JSON.parse(
      await fs.readFile(path.join(f.dir, "state.json"), "utf8"),
    );
    assert.equal(disk.autonomousTasks[0].receipts[0].status, "dispatching");
    assert.equal(disk.autonomousTasks[0].receipts[0].id, context.receiptId);
    assert.equal(
      f.host.store.state.tasks.find((task) => task.id === context.taskId)
        .status,
      "running",
    );
    return execute(request, context);
  };
  await f.start();
  await until(() => f.record().status === "completed");
  assert.equal(f.calls.length, 3);
  assert.equal(f.record().step, 3);
  assert.equal(f.record().receipts[0].verification.verified, true);
  assert.equal(f.record().receipts[0].data.content, "Fixture evidence");
  assert.equal(f.record().receipts[0].observation.image, undefined);
  assert.ok(f.calls.every((call) => call.control.managedToolsOnly));
  assert.ok(
    f.calls.every(
      (call) => call.task.parentTaskId === f.record().coordinatorTaskId,
    ),
  );
  assert.equal(f.calls[0].body.effort, "ultra");
});

test("observational evidence alone finishes at review required and unknown evidence cannot finish", async (t) => {
  const f = await fixture(t, evidenceFlow, {
    verify: async () => ({
      verified: true,
      summary: "Only a fresh source read is established",
    }),
  });
  await f.start();
  await until(() => f.record().status === "review_required");
  assert.equal(f.record().completionVerified, false);
  assert.equal(
    f.host.store.state.tasks.find(
      (task) => task.id === f.record().coordinatorTaskId,
    ).status,
    "review_required",
  );
  const forged = await fixture(t, () => ({
    kind: "finish",
    summary: "I sent something",
    evidence: ["not-a-receipt"],
  }));
  await forged.start();
  await until(() => forged.record().status === "needs_attention");
  assert.match(forged.record().error, /unknown receipt/);
  assert.equal(
    forged.host.store.state.messages.some(
      (message) => message.kind === "autonomous_result",
    ),
    false,
  );
});

test("questions require current revisions and all required answers before dependent tools", async (t) => {
  const f = await fixture(t, (record) =>
    !record.questions.length
      ? { kind: "ask", questions: ["Which source?", "Which format?"] }
      : evidenceFlow(record),
  );
  await f.start();
  await until(() => f.record().status === "awaiting_answers");
  const record = f.record();
  assert.equal(f.executions.length, 0);
  await assert.rejects(
    f.runner.answers(
      record.id,
      {
        revision: 0,
        answers: [{ id: record.questions[0].id, answer: "README" }],
      },
      OWNER,
    ),
    { status: 409 },
  );
  await f.runner.answers(
    record.id,
    {
      revision: record.revision,
      answers: [{ id: record.questions[0].id, answer: "README" }],
    },
    OWNER,
  );
  assert.equal(record.status, "awaiting_answers");
  assert.equal(f.calls.length, 1);
  await f.runner.answers(
    record.id,
    {
      revision: record.revision,
      answers: [{ id: record.questions[1].id, answer: "Brief" }],
    },
    OWNER,
  );
  await until(() => record.status === "completed");
  assert.equal(f.executions.length, 1);
  assert.match(f.calls.at(-1).control.promptContext, /README/);
});

test("pending approvals wait for actual settlement, keep coordinator identity and stop cancels exact pending approval", async (t) => {
  let settled = false;
  const ids = [];
  const f = await fixture(t, evidenceFlow, {
    execute: async (_request, context) => {
      ids.push(context.taskId);
      (await context.record) &&
        f.host.store.change((state) =>
          state.approvals.push({ id: "approval-fixture", status: "pending" }),
        );
      return {
        status: "pending",
        pendingApprovalId: "approval-fixture",
        summary: "Needs PC approval",
        data: { check: "test" },
      };
    },
    settle: async (_receipt, context) => {
      ids.push(context.taskId);
      return settled
        ? {
            status: "completed",
            summary: "Terminal exit zero",
            data: { exitCode: 0 },
          }
        : null;
    },
  });
  await f.start();
  await until(() => f.record().status === "awaiting_approval");
  assert.equal(f.calls.length, 1);
  settled = true;
  f.runner.onApproval({ id: "approval-fixture" });
  await until(() => f.record().status === "completed");
  assert.equal(new Set(ids).size, 1);
  const stop = await fixture(t, evidenceFlow, {
    execute: async () => {
      await stop.host.store.change((state) =>
        state.approvals.push({ id: "pending-stop", status: "pending" }),
      );
      return {
        status: "pending",
        pendingApprovalId: "pending-stop",
        summary: "Needs PC approval",
      };
    },
    settle: async () => null,
  });
  await stop.start();
  await until(() => stop.record().status === "awaiting_approval");
  await stop.runner.stop(stop.record().id, OWNER);
  assert.equal(stop.record().status, "stopped");
  assert.equal(stop.host.store.state.approvals[0].status, "cancelled");
  assert.equal(stop.calls.length, 1);
});

test("late tool results after Stop cannot revive a task or claim a completed receipt", async (t) => {
  let release;
  const f = await fixture(t, evidenceFlow, {
    execute: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await f.start();
  await until(() => release);
  await f.runner.stop(f.record().id, OWNER);
  release({ status: "completed", summary: "Late result" });
  await until(() => !f.runner.entries.size);
  assert.equal(f.record().status, "stopped");
  assert.equal(f.record().receipts[0].status, "unconfirmed");
  assert.equal(f.calls.length, 1);
});

test("pre-dispatch and outcome persistence failures fail closed without another model or tool step", async (t) => {
  for (const phase of ["dispatching", "completed"]) {
    const f = await fixture(t, evidenceFlow);
    const save = f.host.store.save.bind(f.host.store);
    let failed = false;
    f.host.store.save = async () => {
      if (
        !failed &&
        f.record()?.receipts.some((receipt) => receipt.status === phase)
      ) {
        failed = true;
        throw new Error("Fixture disk failure");
      }
      return save();
    };
    await f.start();
    await until(() => f.record().status === "needs_attention");
    assert.equal(f.executions.length, phase === "dispatching" ? 0 : 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.record().completionVerified, undefined);
    if (phase === "completed")
      assert.equal(f.record().receipts[0].status, "unconfirmed");
  }
});

test("resuming interrupted work retains uncertain attempts and refuses replay with reordered argument keys", async (t) => {
  const f = await fixture(t, () => undefined);
  await f.start();
  await until(() => f.calls.length === 1);
  await f.runner.close();
  assert.equal(f.record().status, "interrupted");
  f.record().receipts.push({
    id: "uncertain",
    tool: "browser",
    request: {
      tool: "browser",
      arguments: { action: "read", sessionId: "saved-session" },
    },
    status: "dispatching",
    summary: "Interrupted before outcome",
  });
  const { digest } = await import("../apps/host/security.mjs");
  f.record().receipts[0].requestHash = digest(
    JSON.stringify(f.record().receipts[0].request),
  );
  const next = new AutonomousTasks(f.host);
  t.after(() => next.close());
  f.host.chat = async (_body, _principal, control) => {
    queueMicrotask(() =>
      control.onFinished(
        { status: "completed" },
        block({
          kind: "tool",
          tool: "browser",
          arguments: { sessionId: "saved-session", action: "read" },
        }),
      ),
    );
    return { taskIds: [] };
  };
  await next.resume(f.record().id, { revision: f.record().revision }, OWNER);
  await until(() => f.record().status === "needs_attention");
  assert.equal(f.record().receipts[0].status, "unconfirmed");
  assert.match(f.record().error, /will not replay/);
  assert.equal(f.executions.length, 0);
});

test("device revocation and wall deadline stop delayed managers without late dispatch", async (t) => {
  const f = await fixture(t, () => undefined);
  const phone = { kind: "device", id: "phone" };
  f.host.store.state.devices.push({
    id: "phone",
    platform: "android",
    permissions: { projectAccess: true, googleAccess: true },
  });
  await f.start(phone);
  await until(() => f.calls.length === 1);
  f.host.store.state.devices[0].permissions.googleAccess = false;
  await until(() => f.record().status === "needs_attention");
  assert.equal(f.executions.length, 0);
  assert.throws(() => f.runner.list(phone), { status: 403 });
  const deadline = await fixture(t, () => undefined, {}, { maxRuntimeMs: 30 });
  await deadline.start();
  await until(() => deadline.record().status === "needs_attention");
  assert.equal(deadline.executions.length, 0);
});

test("credential answers never enter durable question state or trigger dependent work", async (t) => {
  const f = await fixture(t, () => ({
    kind: "ask",
    questions: ["Which source should be used?"],
  }));
  await f.start();
  await until(() => f.record().status === "awaiting_answers");
  await assert.rejects(
    f.runner.answers(
      f.record().id,
      {
        revision: f.record().revision,
        answers: [
          {
            id: f.record().questions[0].id,
            answer: "password=keep-this-private",
          },
        ],
      },
      OWNER,
    ),
    { status: 400 },
  );
  assert.equal(f.record().questions[0].answer, undefined);
  assert.equal(f.executions.length, 0);
  assert.doesNotMatch(
    await fs.readFile(path.join(f.dir, "state.json"), "utf8"),
    /keep-this-private/,
  );
});

test("Stop terminates owned work even when persisting its stopped state fails", async (t) => {
  let stopCalls = 0,
    release;
  const f = await fixture(t, evidenceFlow, {
    execute: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    stop: async () => {
      stopCalls++;
    },
  });
  await f.start();
  await until(() => release);
  const save = f.host.store.save.bind(f.host.store);
  let failed = false;
  f.host.store.save = async () => {
    if (!failed && f.record().status === "stopped") {
      failed = true;
      throw new Error("Fixture Stop save failed");
    }
    return save();
  };
  await assert.rejects(f.runner.stop(f.record().id, OWNER), /Stop save failed/);
  assert.ok(stopCalls >= 1);
  assert.equal(f.record().status, "stopped");
  release({ status: "completed", summary: "Late tool result" });
  await until(() => !f.runner.entries.size);
  assert.equal(f.calls.length, 1);
  assert.equal(f.record().completionVerified, undefined);
});

test("Stop and shutdown release unresolved tool hooks without assuming their outcomes", async (t) => {
  for (const hook of ["execute", "verify", "settle", "catalogue"]) {
    await t.test(hook, async (t) => {
      let entered = false,
        signal;
      const tools = {
        [hook]: (...args) => {
          entered = true;
          signal = hook === "catalogue" ? undefined : args[1].signal;
          return new Promise(() => {});
        },
        ...(hook === "settle"
          ? {
              execute: async () => ({
                status: "pending",
                summary: "Waiting for actual outcome",
              }),
            }
          : {}),
      };
      const f = await fixture(t, evidenceFlow, tools);
      await f.start();
      await until(() => entered);
      if (hook === "verify") await f.runner.close();
      else await f.runner.stop(f.record().id, OWNER);
      await until(() => !f.runner.entries.size);
      await f.runner.close();
      assert.equal(
        f.record().status,
        hook === "verify" ? "interrupted" : "stopped",
      );
      if (signal) assert.equal(signal.aborted, true);
      assert.equal(f.record().completionVerified, undefined);
      if (["execute", "settle"].includes(hook))
        assert.equal(f.record().receipts[0].status, "unconfirmed");
      if (hook === "verify") {
        assert.equal(f.record().receipts[0].verification.status, "interrupted");
        assert.equal(f.record().receipts[0].verification.verified, false);
      }
      assert.equal(
        f.calls.length,
        hook === "catalogue" ? 0 : hook === "verify" ? 2 : 1,
      );
    });
  }
});

test("wall deadline interrupts an unresolved tool without waiting for its reply", async (t) => {
  let entered = false;
  let now = Date.now();
  const f = await fixture(
    t,
    evidenceFlow,
    {
      execute: () => {
        entered = true;
        return new Promise(() => {});
      },
    },
    { clock: () => now, maxRuntimeMs: 100 },
  );
  await f.start();
  await until(() => entered);
  // Start the deadline assertion only after the unresolved tool has begun;
  // disk contention must not consume the fixture's tiny setup allowance.
  now += 101;
  await until(
    () => f.record().status === "needs_attention" && !f.runner.entries.size,
  );
  assert.equal(f.record().receipts[0].status, "unconfirmed");
  assert.match(f.record().error, /deadline/);
  assert.equal(f.calls.length, 1);
});
