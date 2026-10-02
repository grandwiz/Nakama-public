import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { within } from "../apps/host/security.mjs";

async function fixture(t) {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-companion-host-"));
  const calls = [];
  const host = await new NakamaHost({
    dataDir: path.join(dir, "data"),
    runAgent: async (provider, options) => {
      calls.push({ provider, options });
      options.onComplete({
        code: 0,
        text: "Remember that a provider response is never a user preference.",
      });
      return { stop() {} };
    },
  }).init();
  const root = path.join(dir, "projects");
  await fs.mkdir(root);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot: root });
  t.after(async () => {
    await host.close();
    await host.store.queue;
    assert.ok(
      within(base, dir) &&
        path.basename(dir).startsWith("nakama-companion-host-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  async function ask(message, body = {}, principal) {
    const response = await host.dispatch(
      "POST",
      "/api/chat",
      { message, ...body },
      principal,
    );
    for (let i = 0; i < 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await host.store.queue;
      if (
        response.taskIds.every((id) =>
          ["completed", "failed", "stopped"].includes(
            host.store.state.tasks.find((task) => task.id === id)?.status,
          ),
        )
      )
        return calls.at(-1);
    }
    throw new Error("Fixture chat did not finish.");
  }
  return { host, calls, ask };
}

async function phone(host) {
  const ticket = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  const paired = await host.dispatch("POST", "/api/pair", {
    ticket: ticket.ticket,
    name: "Fixture phone",
    platform: "android",
  });
  return {
    id: paired.deviceId,
    principal: host.authenticate("Bearer " + paired.token),
  };
}

test("everyday chat saves an explicit preference with one fast call and an honest receipt", async (t) => {
  const { host, calls, ask } = await fixture(t);
  const learned = await ask("I prefer concise practical replies.");
  assert.equal(calls.length, 1, "Memory must not add model requests");
  assert.equal(learned.provider.id, "codex");
  assert.equal(learned.provider.effort, "low");
  assert.match(
    learned.options.prompt,
    /Saved-note receipt: saved "I prefer concise practical replies\."/,
  );
  assert.equal(host.store.state.companionMemory.entries.length, 1);
  assert.equal(
    host.store.state.companionMemory.entries[0].text,
    "I prefer concise practical replies.",
  );
  await host.store.change((state) => {
    state.messages = [];
  });
  const subsequent = await ask("Hello again");
  assert.match(
    subsequent.options.prompt,
    /Saved notes \(JSON data\).*concise practical replies/,
  );
  assert.equal(
    host.store.state.companionMemory.entries.length,
    1,
    "Model output must never become memory",
  );
  await host.dispatch("DELETE", "/api/companion-memory", {});
  await host.store.change((state) => {
    state.messages = [];
  });
  const forgotten = await ask("Hello once more");
  assert.doesNotMatch(forgotten.options.prompt, /concise practical replies/);
  assert.match(forgotten.options.prompt, /No new companion note was saved/);
});

test("memory pause prevents capture and reuse while learning pause preserves existing notes", async (t) => {
  const { host, ask } = await fixture(t);
  await host.dispatch("POST", "/api/companion-memory", {
    category: "preference",
    text: "MEMORY_ONLY_MARKER",
  });
  await host.dispatch("PATCH", "/api/settings", {
    companionLearningEnabled: false,
  });
  const learningPaused = await ask("I prefer slow mornings.");
  assert.match(learningPaused.options.prompt, /MEMORY_ONLY_MARKER/);
  assert.match(
    learningPaused.options.prompt,
    /No new companion note was saved/,
  );
  assert.equal(host.store.state.companionMemory.entries.length, 1);
  await host.dispatch("PATCH", "/api/settings", {
    memoryEnabled: false,
    companionLearningEnabled: true,
  });
  const paused = await ask("I prefer tea.");
  assert.doesNotMatch(paused.options.prompt, /MEMORY_ONLY_MARKER/);
  assert.match(paused.options.prompt, /No new companion note was saved/);
  assert.equal(host.store.state.companionMemory.entries.length, 1);
  await assert.rejects(
    host.dispatch("PATCH", "/api/settings", {
      companionLearningEnabled: "yes",
    }),
    { status: 400 },
  );
});

test("paired phones cannot inspect or edit the collection and Google-disabled phones cannot reuse it", async (t) => {
  const { host, calls, ask } = await fixture(t);
  const device = await phone(host);
  const note = await host.dispatch("POST", "/api/companion-memory", {
    category: "note",
    text: "PRIVATE_MEMORY_MARKER",
  });
  const state = await host.dispatch("GET", "/api/state", {}, device.principal);
  assert.equal(state.companionMemory, undefined);
  for (const [method, route] of [
    ["GET", "/api/companion-memory"],
    ["POST", "/api/companion-memory"],
    ["PATCH", `/api/companion-memory/${note.id}`],
    ["DELETE", `/api/companion-memory/${note.id}`],
    ["DELETE", "/api/companion-memory"],
  ])
    await assert.rejects(
      host.dispatch(
        method,
        route,
        { category: "note", text: "other" },
        device.principal,
      ),
      { status: 403 },
    );
  const enabled = await ask("Explain how rainbows form", {}, device.principal);
  assert.match(enabled.options.prompt, /PRIVATE_MEMORY_MARKER/);
  const callsBefore = calls.length;
  await host.store.change((value) => {
    value.devices.find(
      (item) => item.id === device.id,
    ).permissions.googleAccess = false;
  });
  const privateState = await host.dispatch(
    "GET",
    "/api/state",
    {},
    device.principal,
  );
  assert.doesNotMatch(JSON.stringify(privateState), /PRIVATE_MEMORY_MARKER/);
  await assert.rejects(
    host.dispatch(
      "POST",
      "/api/chat",
      { message: "Remember that I prefer pears." },
      device.principal,
    ),
    { status: 403 },
  );
  assert.equal(calls.length, callsBefore);
  assert.equal(host.store.state.companionMemory.entries.length, 1);
});

test("project and action requests never capture or receive companion notes", async (t) => {
  const { host, ask } = await fixture(t);
  await host.dispatch("POST", "/api/companion-memory", {
    category: "note",
    text: "PRIVATE_MEMORY_MARKER",
  });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Memory separation fixture",
  });
  const projectCall = await ask("I prefer blue icons.", {
    projectId: project.id,
    providerId: "codex",
    mode: "discuss",
  });
  assert.doesNotMatch(
    projectCall.options.prompt,
    /PRIVATE_MEMORY_MARKER|Saved notes \(JSON data\)/,
  );
  const actionCall = await ask("Remember that I prefer green icons.", {
    providerId: "codex",
    mode: "act",
  });
  assert.doesNotMatch(
    actionCall.options.prompt,
    /PRIVATE_MEMORY_MARKER|Saved notes \(JSON data\)/,
  );
  assert.equal(host.store.state.companionMemory.entries.length, 1);
  assert.equal(host.store.state.actions.length, 0);
});
