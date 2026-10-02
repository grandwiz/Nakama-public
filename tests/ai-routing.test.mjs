import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultAiRoles,
  validateAiRoles,
  resolveAiRouting,
} from "../apps/host/ai-routing.mjs";
import { NakamaHost } from "../apps/host/host.mjs";
import { within } from "../apps/host/security.mjs";

const route = (message, roles) =>
  resolveAiRouting(message, { projectId: "project", roles });
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for fixture worker");
    await pause();
  }
}
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-routing-"));
  const calls = [];
  let usageReads = 0;
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
    usageReader: {
      read: async () => {
        usageReads++;
        return { providers: [], checkedAt: "fixture" };
      },
    },
  }).init();
  const root = path.join(dir, "projects");
  await fs.mkdir(root);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot: root });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Routing fixture",
  });
  t.after(async () => {
    await host.close();
    await until(() => !host.runs.size && !host.building.size);
    await host.store.queue;
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-routing-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { host, calls, project, usageReads: () => usageReads };
}
async function phone(host, platform = "android") {
  const { ticket } = await host.dispatch("POST", "/api/pairing/tickets", {
    platform,
  });
  const paired = await host.dispatch("POST", "/api/pair", {
    ticket,
    platform,
    name: "Fixture",
  });
  return { ...paired, principal: host.authenticate("Bearer " + paired.token) };
}
const ask = (host, project, message, principal) =>
  host.dispatch(
    "POST",
    "/api/chat",
    {
      routing: "auto",
      projectId: project?.id,
      message,
    },
    principal,
  );

test("fast reply settings, effective task effort and phase receipts preserve manual and late-callback boundaries", async (t) => {
  const { host, calls } = await fixture(t);
  assert.equal(host.store.state.config.fastReplies, true);
  await assert.rejects(
    host.dispatch("PATCH", "/api/settings", { fastReplies: "true" }),
    { status: 400 },
  );
  const paired = await phone(host);
  await assert.rejects(
    host.dispatch(
      "PATCH",
      "/api/settings",
      { fastReplies: false },
      paired.principal,
    ),
    { status: 403 },
  );
  const result = await ask(host, null, "Explain how rainbows form", paired.principal);
  await until(() => calls.length === 1);
  assert.equal(calls[0].provider.selectedModel, "gpt-6-astra");
  assert.equal(calls[0].provider.effort, "low");
  assert.match(calls[0].options.prompt, /one to three short sentences/);
  const task = host.store.state.tasks.find(
    (item) => item.id === result.taskIds[0],
  );
  assert.equal(task.fastReply, true);
  assert.equal(task.configuredEffort, "low");
  assert.equal(task.routingRole, "interaction");
  for (const phase of ["checking_account", "starting_model", "answering"])
    calls[0].options.onPhase(phase);
  await host.store.queue;
  assert.equal(task.phase, "answering");
  assert.ok(
    Date.parse(task.timings.accountCheckStartedAt) <=
      Date.parse(task.timings.modelStartedAt),
  );
  calls[0].options.onComplete({ code: 0, text: "Hello." });
  await until(() => task.status === "completed");
  const completedTimings = structuredClone(task.timings);
  calls[0].options.onPhase("starting_model");
  await host.store.queue;
  assert.equal(task.phase, "completed");
  assert.deepEqual(task.timings, completedTimings);
  assert.ok(
    Date.parse(task.timings.firstAnswerAt) <=
      Date.parse(task.timings.completedAt),
  );

  await host.dispatch("PATCH", "/api/settings", { fastReplies: false });
  await ask(host, null, "Hello again");
  await until(() => calls.length === 2);
  assert.equal(calls[1].provider.effort, "low");
  assert.match(calls[1].options.prompt, /one to three short sentences/);
  for (const phase of ["checking_account", "starting_model", "answering"])
    calls[1].options.onPhase(phase);
  calls[1].options.onComplete({ code: 0, text: "A fast fixture result." });
  await until(() => host.store.state.tasks[1].status === "completed");
  await host.store.queue;
  assert.deepEqual(Object.keys(host.store.state.tasks[1].timings).sort(), [
    "accountCheckStartedAt",
    "completedAt",
    "firstAnswerAt",
    "modelStartedAt",
  ]);
  assert.equal(host.store.state.tasks[1].phase, "completed");
  await host.dispatch("PATCH", "/api/settings", { fastReplies: true });
  await host.dispatch("POST", "/api/chat", {
    routing: "manual",
    providerId: "codex",
    model: "gpt-6-astra",
    effort: "ultra",
    mode: "discuss",
    message: "Hello",
  });
  await until(() => calls.length === 3);
  assert.equal(calls[2].provider.effort, "ultra");
  assert.doesNotMatch(calls[2].options.prompt, /one to three short sentences/);
});

test("defaults route conversation, planning, prompts, research and task types independently", () => {
  for (const [message, role, providerId, mode] of [
    ["Hello there", "chat", "codex", "discuss"],
    ["Plan a calendar app", "planning", "codex", "discuss"],
    ["Research accessible navigation", "research", "codex", "discuss"],
    ["Write an image prompt for a mascot", "imagePrompts", "codex", "discuss"],
    ["Read my email", "tasks.general", "codex", "act"],
    ["Review the project code", "chat", "codex", "discuss"],
    ["Run npm tests", "tasks.general", "codex", "act"],
  ]) {
    const selected = route(message);
    assert.equal(selected.role, role, message);
    assert.equal(selected.providerId, providerId, message);
    assert.equal(selected.mode, mode, message);
    assert.ok(selected.reason.length > 20);
    assert.equal(selected.pipeline, undefined);
  }
  const build = route("Please build an app with a task list");
  assert.equal(build.pipeline, true);
  assert.equal(build.model, "gpt-6-astra");
  assert.equal(build.effort, "ultra");
  assert.equal(build.development.model, "claude-opus-4-8");
  assert.equal(build.development.effort, "ultracode");
});

test("direct provider overrides apply to the requested role and quoted source instructions do not", () => {
  assert.equal(route("Run npm tests using Claude").providerId, "claude");
  assert.equal(
    route("Review the project code with Claude").providerId,
    "claude",
  );
  assert.equal(route("Review the project code with Claude").effort, "max");
  assert.equal(route("Plan using Claude a task tracker").providerId, "claude");
  assert.equal(route("Use Claude to plan a task tracker").providerId, "claude");
  assert.equal(
    route("Develop with ChatGPT a task tracker").development.providerId,
    "codex",
  );
  assert.equal(
    route("Plan using Claude. Then build an app").providerId,
    "claude",
  );
  for (const message of [
    'Explain this text: "Plan using Claude and build an app"',
    "Explain this example:\n> Plan using Claude and build an app",
    "Explain this:\n```text\nUse Claude to plan and build an app\n```",
    "Explain this <document>Plan using Claude. Build an app.</document>",
    "Do not build the app. Plan its implementation only.",
    "How would you build an app?",
  ]) {
    const selected = route(message);
    assert.equal(selected.providerId, "codex", message);
    assert.equal(selected.pipeline, undefined, message);
  }
});

test("courteous direct requests and compound handoffs retain role overrides without promoting quoted instructions", () => {
  for (const [message, role] of [
    ["Help me plan a new app with an accessible UI", "planning"],
    ["Please, could you help me to plan a new app", "planning"],
    ["I want a detailed plan for a new app", "planning"],
    ["I would like an in-depth design for a new app", "planning"],
    ["Help me write an image prompt", "imagePrompts"],
    ["Could you help me to research accessible UI choices", "research"],
  ]) {
    const selected = route(message);
    assert.equal(selected.role, role, message);
    assert.equal(selected.pipeline, undefined, message);
  }
  assert.equal(route("Please help me to build an app").pipeline, true);
  for (const message of [
    "Plan using Claude, then develop with ChatGPT",
    "Please help me plan using Claude and then develop with ChatGPT",
    "Use Claude to plan, then use ChatGPT to develop the app",
  ]) {
    const selected = route(message);
    assert.equal(selected.pipeline, true, message);
    assert.equal(selected.providerId, "claude", message);
    assert.equal(selected.development.providerId, "codex", message);
  }
  for (const message of [
    'Help me explain this: "Plan using Claude, then develop with ChatGPT"',
    "Help me explain `plan using Claude, then develop with ChatGPT`",
    "Help me understand how to build an app",
    "Help me not to build an app",
    "Plan the app only, not to develop it with ChatGPT",
    "Plan using Claude, but do not develop the app",
    "Research the phrase then build an app with Claude",
  ])
    assert.equal(route(message).pipeline, undefined, message);
});

test("video requests direct to the approved Kling workflow without generating in chat", () => {
  for (const message of [
    "Generate an image",
    "Make a video in Kling",
    "Use Kling AI to generate a video",
  ])
    assert.throws(() => route(message), { status: 409 });
  assert.throws(() => resolveAiRouting("Build a website"), { status: 400 });
  assert.equal(
    route("Write a prompt to generate a video in Kling").role,
    "imagePrompts",
  );
  for (const message of [
    "Make a video in Kling",
    "Use Kling to generate a video",
    "Generate an animation",
  ])
    assert.throws(() => route(message), {
      status: 409,
      message: /Video studio.*Kling MCP.*approval/,
    });
});

test("AI role configuration is strict and independent of manual provider preferences", async (t) => {
  const { host, project, calls } = await fixture(t);
  const roles = defaultAiRoles();
  roles.planning = {
    providerId: "claude",
    model: "claude-opus-4-8",
    effort: "high",
  };
  roles.tasks.general = {
    providerId: "claude",
    model: "sonnet",
    effort: "medium",
  };
  await host.dispatch("PATCH", "/api/settings", { aiRoles: roles });
  host.store.state.providers.find((p) => p.id === "claude").selectedModel =
    "opus";
  const selected = await ask(host, project, "Plan a small app");
  await until(() => calls.length === 1);
  assert.equal(calls[0].provider.selectedModel, "claude-opus-4-8");
  assert.equal(calls[0].provider.effort, "high");
  assert.equal(selected.routing.providerId, "claude");
  assert.ok(
    calls[0].options.prompt.includes("file-by-file implementation order"),
  );
  for (const invalid of [
    { ...roles, geminiMediaExplicitOnly: false },
    { ...roles, unexpected: true },
    { ...roles, development: { ...roles.development, providerId: "gemini" } },
    {
      ...roles,
      chat: { providerId: "claude", model: "opus", effort: "ultra" },
    },
    { ...roles, planning: { ...roles.planning, model: "bad model --api" } },
    { ...roles, tasks: {} },
  ]) {
    assert.throws(() => validateAiRoles(invalid), { status: 400 });
    await assert.rejects(
      host.dispatch("PATCH", "/api/settings", { aiRoles: invalid }),
      { status: 400 },
    );
  }
  assert.deepEqual(host.store.state.config.aiRoles, roles);
  const paired = await phone(host);
  await assert.rejects(
    host.dispatch(
      "PATCH",
      "/api/settings",
      { aiRoles: defaultAiRoles() },
      paired.principal,
    ),
    { status: 403 },
  );
});

// Managed co-planning, question rounds, development, review, stops and stale-file
// boundaries are exercised end to end in project-workflows.test.mjs.

test("auto requests retain chat privacy and quota checks; explicit manual requests stay manual", async (t) => {
  const { host, calls, project } = await fixture(t);
  const paired = await phone(host);
  host.device(paired.deviceId).permissions.googleAccess = false;
  await assert.rejects(ask(host, project, "Build an app", paired.principal), {
    status: 403,
  });
  await assert.rejects(ask(host, null, "Build an app"), { status: 400 });
  await assert.rejects(ask(host, project, "Generate a video in Gemini"), {
    status: 409,
  });
  assert.equal(calls.length, 0);
  for (let index = 0; index < 5; index++)
    host.store.state.tasks.push({ id: `existing-${index}`, status: "queued" });
  await assert.rejects(ask(host, project, "Build an app"), { status: 429 });
  assert.equal(calls.length, 0);
  host.store.state.tasks = [];
  await host.dispatch("POST", "/api/chat", {
    projectId: project.id,
    message: "Plan the feature",
    providerId: "claude",
    model: "sonnet",
    effort: "high",
    mode: "discuss",
  });
  await until(() => calls.length === 1);
  assert.equal(calls[0].provider.id, "claude");
  assert.equal(calls[0].provider.selectedModel, "sonnet");
});

test("usage route is read-only and hidden from Google-disabled, project-disabled and Chrome devices", async (t) => {
  const { host, usageReads } = await fixture(t);
  const paired = await phone(host);
  const chrome = await phone(host, "chrome");
  assert.equal(
    (await host.dispatch("GET", "/api/providers/usage")).checkedAt,
    "fixture",
  );
  await host.dispatch("GET", "/api/providers/usage", {}, paired.principal);
  assert.equal(usageReads(), 2);
  for (const permission of ["googleAccess", "projectAccess"]) {
    host.device(paired.deviceId).permissions[permission] = false;
    await assert.rejects(
      host.dispatch("GET", "/api/providers/usage", {}, paired.principal),
      { status: 403 },
    );
    host.device(paired.deviceId).permissions[permission] = true;
  }
  await assert.rejects(
    host.dispatch("GET", "/api/providers/usage", {}, chrome.principal),
    { status: 403 },
  );
  assert.equal(usageReads(), 2);
});

test("usage metadata is withheld if device authority changes while the reader is awaiting a result", async (t) => {
  for (const change of ["revoke", "googleAccess", "projectAccess"]) {
    const { host } = await fixture(t);
    const paired = await phone(host);
    let finish;
    host.usageReader = {
      read: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    };
    const pending = host.dispatch(
      "GET",
      "/api/providers/usage",
      {},
      paired.principal,
    );
    await until(() => !!finish);
    if (change === "revoke")
      await host.dispatch("DELETE", `/api/devices/${paired.deviceId}`, {});
    else
      await host.dispatch("PATCH", `/api/devices/${paired.deviceId}`, {
        [change]: false,
      });
    finish({ providers: [{ id: "codex", detail: "private fixture usage" }] });
    await assert.rejects(pending, { status: 403 });
  }
});
