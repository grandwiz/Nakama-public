import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { Store, initialState } from "../apps/host/store.mjs";
import {
  defaultInteractionRole,
  resolveAiRouting,
} from "../apps/host/ai-routing.mjs";
import {
  syncAgentOffice,
  publicAgentOffice,
} from "../apps/host/agent-office.mjs";
import {
  navigationRequest,
  NAVIGATION_TARGETS,
} from "../apps/host/local-navigation.mjs";
import { within } from "../apps/host/security.mjs";

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for fixture receipts");
    await pause();
  }
}
async function directory(t) {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-office-"));
  if (t)
    t.after(async () => {
      assert.ok(
        within(base, dir) && path.basename(dir).startsWith("nakama-office-"),
      );
      await fs.rm(dir, { recursive: true, force: true });
    });
  return dir;
}
async function fixture(t) {
  const dir = await directory(),
    calls = [];
  const host = await new NakamaHost({
    dataDir: path.join(dir, "state"),
    runAgent: async (provider, options) => {
      const call = { provider, options, stopped: false };
      calls.push(call);
      return {
        stop: () => {
          call.stopped = true;
        },
      };
    },
  }).init();
  t.after(async () => {
    await host.close();
    await until(() => !host.runs.size && !host.building.size);
    await host.store.queue;
    assert.equal(path.dirname(dir), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("nakama-office-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const root = path.join(dir, "projects");
  await fs.mkdir(root);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot: root });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Office fixture",
  });
  return { host, calls, project };
}
const ask = (host, message, extra = {}, principal) =>
  host.dispatch(
    "POST",
    "/api/chat",
    { routing: "auto", message, ...extra },
    principal,
  );
const office = (host) => host.dispatch("GET", "/api/agent-office");
async function paired(host, platform = "android") {
  const { ticket } = await host.dispatch("POST", "/api/pairing/tickets", {
    platform,
  });
  const result = await host.dispatch("POST", "/api/pair", {
    ticket,
    platform,
    name: "Office fixture phone",
  });
  return host.authenticate(`Bearer ${result.token}`);
}

test("interaction migration preserves deep assignments, paired devices and stable interrupted agent identities", async (t) => {
  const dir = await directory(t),
    old = initialState();
  delete old.config.interactionRole;
  delete old.agentOffice;
  old.projectTeamMigrationVersion = 1;
  old.config.aiRoles.chat = {
    providerId: "claude",
    model: "owner-detail-model",
    effort: "high",
  };
  old.config.projectTeam.peer.effort = "max";
  old.devices.push({
    id: "fixture-device",
    platform: "android",
    name: "Saved phone",
    tokenHash: "preserved-fixture-hash",
    permissions: { googleAccess: false },
  });
  old.tasks.push({
    id: "legacy",
    providerId: "codex",
    title: "Interrupted research",
    status: "running",
    phase: "answering",
    createdAt: "2026-01-01T00:00:00Z",
    output: "Actual old output",
  });
  old.connections[0].accounts.push({
    id: "account-fixture",
    label: "Saved account",
  });
  await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(old));
  const store = await new Store(dir).init();
  assert.deepEqual(
    store.state.config.interactionRole,
    defaultInteractionRole(),
  );
  assert.deepEqual(store.state.config.aiRoles, old.config.aiRoles);
  assert.deepEqual(store.state.config.projectTeam, old.config.projectTeam);
  assert.deepEqual(store.state.devices, old.devices);
  assert.deepEqual(store.state.connections, old.connections);
  const first = structuredClone(store.state.agentOffice.agents[0]);
  assert.equal(first.status, "interrupted");
  assert.equal(first.phase, "interrupted");
  assert.equal(first.output, "Actual old output");
  await store.change((state) => {
    state.config.interactionRole = {
      providerId: "claude",
      model: "owner-fast-model",
      effort: "medium",
    };
  });
  const reopened = await new Store(dir).init();
  assert.deepEqual(reopened.state.agentOffice.agents[0], first);
  assert.deepEqual(
    reopened.state.config.interactionRole,
    store.state.config.interactionRole,
  );
  assert.deepEqual(reopened.state.config.aiRoles, old.config.aiRoles);
});

test("simple interaction is independent, while research, technical and high-stakes questions retain deep roles", () => {
  const interactionRole = {
    providerId: "claude",
    model: "owner-fast-model",
    effort: "medium",
  };
  for (const message of [
    "Hello",
    "Hello, how are you today?",
    "What is the capital of France?",
  ]) {
    const route = resolveAiRouting(message, {
      interactionRole,
      projectId: "selected",
      fastReplies: false,
    });
    assert.equal(route.assignmentRole, "interaction", message);
    assert.equal(route.model, interactionRole.model);
    assert.equal(route.effort, "medium");
  }
  for (const message of [
    "What is the latest Android release?",
    "Who is the prime minister?",
    "Compare current laptop choices",
    "What is today's weather in London?",
    "Research accessible keyboards",
  ]) {
    const route = resolveAiRouting(message, {
      interactionRole,
      fastReplies: true,
    });
    assert.equal(route.role, "research", message);
    assert.equal(route.model, "gpt-6-astra");
    assert.equal(route.effort, "ultra");
    assert.equal(route.assignmentRole, undefined);
  }
  for (const message of [
    "Why does my app crash?",
    "Explain OAuth security",
    "What should I do about chest pain and trouble breathing?",
    "What medication dosage is appropriate?",
    "How should I invest my savings?",
    "Explain black holes in detail",
  ]) {
    const route = resolveAiRouting(message, {
      interactionRole,
      fastReplies: true,
    });
    assert.equal(route.role, "chat", message);
    assert.equal(route.effort, "ultra", message);
    assert.equal(route.assignmentRole, undefined, message);
  }
});

test("interaction changes produce one real task and unsupported exact effort fails without substitution", async (t) => {
  const { host, calls } = await fixture(t),
    before = structuredClone(host.store.state.config.aiRoles);
  const custom = { providerId: "claude", model: "sonnet", effort: "medium" };
  await host.dispatch("PATCH", "/api/settings", { interactionRole: custom });
  assert.deepEqual(host.store.state.config.aiRoles, before);
  for (const invalid of [
    { ...custom, providerId: "gemini" },
    { ...custom, effort: "ultra" },
    { ...custom, extra: true },
    { model: "sonnet" },
  ])
    await assert.rejects(
      host.dispatch("PATCH", "/api/settings", { interactionRole: invalid }),
      { status: 400 },
    );
  const phone = await paired(host);
  await assert.rejects(
    host.dispatch(
      "PATCH",
      "/api/settings",
      { interactionRole: defaultInteractionRole() },
      phone,
    ),
    { status: 403 },
  );
  const result = await ask(host, "Hello");
  await until(() => calls.length === 1);
  assert.equal(calls[0].provider.selectedModel, "sonnet");
  assert.equal(calls[0].provider.effort, "medium");
  assert.equal((await office(host)).agents.length, 1);
  assert.equal((await office(host)).agents[0].taskId, result.taskIds[0]);
  assert.equal((await office(host)).agents[0].role, "Nakama interaction");
  assert.equal(
    host.store.state.messages.some((message) => message.kind === "task_ack"),
    false,
  );
  calls[0].options.onComplete({
    code: 0,
    text: "Hello from the selected interaction model.",
  });
  await until(() => host.store.state.tasks[0].status === "completed");
  await host.dispatch("PATCH", "/api/settings", {
    interactionRole: defaultInteractionRole(),
  });
  host.store.state.providers.find(
    (provider) => provider.id === "codex",
  ).modelDetails = [{ id: "gpt-6-astra", efforts: ["high", "ultra"] }];
  await assert.rejects(ask(host, "Hello again"), {
    status: 400,
    message: /does not support/,
  });
  assert.equal(calls.length, 1);
  assert.equal((await office(host)).agents.length, 1);
});

test("agent names survive phase, output and stop receipts; late callbacks cannot revive a stopped worker", async (t) => {
  const { host, calls } = await fixture(t);
  const results = await Promise.all([
    ask(host, "Hello"),
    ask(host, "Research accessible keyboards"),
  ]);
  await until(() => calls.length === 2);
  let agents = (await office(host)).agents;
  assert.equal(new Set(agents.map((agent) => agent.name)).size, 2);
  const names = Object.fromEntries(
    agents.map((agent) => [agent.taskId, agent.name]),
  );
  const research = host.store.state.tasks.find(
    (task) => task.routingRole === "research",
  );
  assert.ok(
    host.store.state.messages.some(
      (message) =>
        message.kind === "task_ack" && message.taskIds.includes(research.id),
    ),
  );
  assert.equal(
    host.store.state.messages.some((message) => message.taskId === research.id),
    false,
    "No fabricated final before completion",
  );
  const call = calls.find((item) =>
    item.options.prompt.includes("Research accessible keyboards"),
  );
  assert.match(call.options.prompt, /cannot verify the current answer/);
  call.options.onPhase("checking_account");
  call.options.onOutput("Actual provider output. " + "x".repeat(18000));
  await host.store.queue;
  let receipt = (await office(host)).agents.find(
    (agent) => agent.taskId === research.id,
  );
  assert.equal(receipt.phase, "checking_account");
  assert.equal(receipt.output.length, 16000);
  assert.equal(receipt.outputTruncated, true);
  assert.equal(receipt.name, names[research.id]);
  await host.dispatch("POST", `/api/tasks/${research.id}/stop`, {});
  await until(() => research.status === "stopped");
  call.options.onPhase("answering");
  call.options.onOutput("UNACCEPTED LATE OUTPUT");
  call.options.onComplete({ code: 0, text: "UNACCEPTED LATE FINAL" });
  await host.store.queue;
  receipt = (await office(host)).agents.find(
    (agent) => agent.taskId === research.id,
  );
  assert.equal(receipt.status, "stopped");
  assert.equal(receipt.phase, "stopped");
  assert.equal(receipt.name, names[research.id]);
  assert.doesNotMatch(JSON.stringify(receipt), /UNACCEPTED/);
  assert.equal(calls.length, 2);
  assert.equal(results.flatMap((result) => result.taskIds).length, 2);
});

test("busy project planning does not block local status, navigation or an independent fast reply", async (t) => {
  const { host, calls, project } = await fixture(t);
  const result = await ask(host, "Build an accessible app", {
    projectId: project.id,
  });
  await until(() => calls.length === 2);
  const status = await ask(host, "What are you working on?");
  assert.equal(status.outcome.type, "status_read");
  assert.equal(status.outcome.active, 1);
  assert.match(status.reply, /planning/);
  const navigation = await ask(host, "Open agent office");
  assert.equal(navigation.outcome.target, "agent-office");
  const hello = await ask(host, "Hello", { projectId: project.id });
  await until(() => calls.length === 3);
  const agents = (await office(host)).agents;
  const manager = agents.find(
    (agent) => agent.id === `workflow:${result.workflowId}`,
  );
  assert.equal(manager.receiptKind, "workflow_orchestration");
  assert.equal(manager.status, "running");
  assert.equal(
    agents.filter((agent) => agent.parentId === manager.id).length,
    2,
  );
  assert.equal(
    agents.length,
    4,
    "One actual workflow and three actual calls, no idle invented workers",
  );
  assert.equal(
    agents.find((agent) => agent.taskId === hello.taskIds[0]).parentId,
    undefined,
  );
  assert.equal(
    agents.find((agent) => agent.taskId === hello.taskIds[0]).requestedEffort,
    "low",
  );
  await host.dispatch(
    "POST",
    `/api/project-workflows/${result.workflowId}/stop`,
    {},
  );
  await until(() =>
    host.store.state.tasks
      .filter((task) => task.workflowId === result.workflowId)
      .every((task) => task.status === "stopped"),
  );
  const stopped = (await office(host)).agents;
  assert.equal(
    stopped.find((agent) => agent.id === manager.id).status,
    "stopped",
  );
  assert.ok(
    stopped
      .filter((agent) => agent.parentId === manager.id)
      .every((agent) => agent.status === "stopped"),
  );
  assert.equal(
    stopped.find((agent) => agent.taskId === hello.taskIds[0]).status,
    "running",
  );
});

test("office privacy follows both shared-data grants and unrelated Chrome credentials cannot read it", async (t) => {
  const { host, calls } = await fixture(t);
  await ask(host, "Hello");
  await until(() => calls.length === 1);
  const phone = await paired(host),
    chrome = await paired(host, "chrome");
  assert.equal(
    (await host.dispatch("GET", "/api/agent-office", {}, phone)).agents.length,
    1,
  );
  for (const grant of ["googleAccess", "projectAccess"]) {
    await host.dispatch("PATCH", `/api/devices/${phone.id}`, {
      [grant]: false,
    });
    await assert.rejects(host.dispatch("GET", "/api/agent-office", {}, phone), {
      status: 403,
    });
    assert.deepEqual(
      (await host.dispatch("GET", "/api/state", {}, phone)).agentOffice,
      { version: 1, agents: [] },
    );
    await assert.rejects(ask(host, "Open agent office", {}, phone), {
      status: 403,
    });
    await host.dispatch("PATCH", `/api/devices/${phone.id}`, { [grant]: true });
  }
  await assert.rejects(host.dispatch("GET", "/api/agent-office", {}, chrome), {
    status: 403,
  });
  await host.dispatch("DELETE", `/api/devices/${phone.id}`, {});
  await assert.rejects(host.dispatch("GET", "/api/agent-office", {}, phone), {
    status: 404,
  });
});

test("name collisions stay unique beyond the private pool and source clearing cannot create active ghost agents", () => {
  const state = initialState();
  state.tasks = Array.from({ length: 110 }, (_, index) => ({
    id: `fixture-${index}`,
    providerId: "codex",
    title: `Recorded task ${index}`,
    status: "running",
    createdAt: "2026-01-01T00:00:00Z",
  }));
  syncAgentOffice(state);
  const names = state.agentOffice.agents.map((agent) => agent.name);
  assert.equal(new Set(names).size, 110);
  assert.ok(names.some((name) => / 2$/.test(name)));
  syncAgentOffice(state);
  assert.deepEqual(
    state.agentOffice.agents.map((agent) => agent.name),
    names,
  );
  const snapshot = publicAgentOffice(state, { kind: "owner" });
  assert.deepEqual(Object.keys(snapshot).sort(), ["agents", "version"]);
  assert.equal(
    snapshot.agents.some((agent) => "pool" in agent || "names" in agent),
    false,
  );
  state.tasks = [];
  syncAgentOffice(state);
  assert.ok(
    state.agentOffice.agents.every((agent) => agent.status === "unavailable"),
  );
  assert.deepEqual(
    state.agentOffice.agents.map((agent) => agent.name),
    names,
  );
});

test("cached receipt projections preserve latest output and recover after a rejected state save", async (t) => {
  const dir = await directory(t),
    store = await new Store(dir).init();
  await store.change((state) => {
    state.tasks.push({
      id: "fixture",
      providerId: "codex",
      title: "Sensitive old title",
      status: "running",
      phase: "working",
      output: "old output",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });
  const identity = store.state.agentOffice.agents[0].name;
  const save = store.save.bind(store);
  store.save = async () => {
    throw new Error("Fixture disk failure");
  };
  await assert.rejects(
    store.change((state) => {
      state.tasks[0].output = "prefix " + "x".repeat(17000) + " NEWEST";
    }),
    /Fixture disk failure/,
  );
  assert.equal(store.state.agentOffice.agents[0].output, "old output");
  store.save = save;
  await store.change((state) => {
    state.tasks[0].output = "prefix " + "x".repeat(17000) + " NEWEST";
  });
  assert.equal(store.state.agentOffice.agents[0].output.length, 16000);
  assert.match(store.state.agentOffice.agents[0].output, /NEWEST$/);
  assert.equal(store.state.agentOffice.agents[0].name, identity);
  await store.change((state) => {
    state.tasks = [];
  });
  const orphan = store.state.agentOffice.agents[0];
  assert.equal(orphan.name, identity);
  assert.equal(orphan.status, "unavailable");
  assert.equal(orphan.output, undefined);
  assert.equal(orphan.error, undefined);
  assert.equal(orphan.title, "Original task unavailable");
});

test("navigation is a direct fixed destination receipt; local changes create no fake agents or replayable navigation", async (t) => {
  const { host, calls, project } = await fixture(t);
  for (const [message, target] of [
    ["Open agent office", "agent-office"],
    ["go to projects", "projects"],
    ["Please open the task board", "boards"],
    ["open core memory", "core-memory"],
    ["take me to settings", "settings"],
    ["go to the overview", "home"],
  ]) {
    const result = await ask(host, message);
    assert.deepEqual(result.outcome, { type: "navigate", target });
    const stored = host.store.state.messages.find(
      (item) => item.id === result.messageId,
    );
    assert.equal(stored.localOutcome, undefined);
    assert.equal(stored.outcome, undefined);
  }
  assert.deepEqual(
    (await ask(host, "Open this project", { projectId: project.id })).outcome,
    { type: "navigate", target: "projects", projectId: project.id },
  );
  assert.equal(
    (await ask(host, "Open project Office fixture")).outcome.projectId,
    project.id,
  );
  assert.equal(
    (await ask(host, "Open project Missing project")).outcome.type,
    "needs_clarification",
  );
  assert.equal(
    (await ask(host, "show my routines")).outcome.type,
    "routines_listed",
  );
  assert.equal(
    (await ask(host, "add task buy tea")).outcome.type,
    "task_created",
  );
  assert.equal(
    (await ask(host, "Remember that I prefer short answers")).outcome.type,
    "memory_saved",
  );
  assert.equal((await office(host)).agents.length, 0);
  assert.equal(calls.length, 0);
  for (const message of [
    'Explain "open agent office"',
    "Do not open settings",
    "open https://example.com",
    "open javascript:alert(1)",
    "open agent office and delete a project",
    "open agent office\nthen run a command",
  ])
    assert.equal(navigationRequest(message, host.store.state), null, message);
  for (const target of NAVIGATION_TARGETS) assert.ok(!target.includes(":"));
  assert.throws(
    () =>
      navigationRequest("open this project", host.store.state, "fabricated-id"),
    { status: 409 },
  );
});
