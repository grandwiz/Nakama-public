import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultAiRoles, resolveAiRouting } from "../apps/host/ai-routing.mjs";
import { Store, initialState } from "../apps/host/store.mjs";

const quick = (message, options = {}) =>
  resolveAiRouting(message, { fastReplies: true, ...options });

test("fast everyday replies lower effort without changing model, provider, mode or saved roles", () => {
  const roles = defaultAiRoles();
  const before = structuredClone(roles);
  for (const [message, effort] of [
    ["Hello, how are you?", "low"],
    ["What is the capital of France?", "low"],
    ["Read my latest email", "medium"],
  ]) {
    const expected = resolveAiRouting(message, { roles });
    const actual = quick(message, { roles });
    assert.equal(actual.providerId, expected.providerId);
    assert.equal(actual.model, expected.model);
    assert.equal(actual.mode, expected.mode);
    assert.equal(actual.role, expected.role);
    assert.equal(actual.effort, effort);
    assert.equal(
      actual.configuredEffort,
      actual.assignmentRole === "interaction" ? "low" : "ultra",
    );
    assert.equal(actual.fastReply, true);
  }
  assert.deepEqual(roles, before);
  const override = quick("Use Claude to answer hello");
  assert.equal(override.providerId, "claude");
  assert.equal(override.model, "claude-opus-4-8");
  assert.equal(override.effort, "low");
});

test("detailed, technical, long and project requests retain saved effort", () => {
  for (const message of [
    "Explain black holes in detail",
    "Think carefully before answering",
    "Give an in-depth answer",
    "Please expand that answer",
    "Give me an extensive analysis of the trade-offs",
    "Tell me every possible cause of database deadlocks",
    "Explain the security implications of OAuth PKCE",
    "Tell me how this works in full",
    "What should I do about chest pain and trouble breathing?",
    "Use Ultra for this answer",
    "Solve this equation",
    "Explain this source code",
    "How should I invest my savings?",
    "What medication dosage is appropriate?",
    "Explain `some code`",
    "Explain <document>this source</document>",
    "What? ".repeat(75),
    "a".repeat(501),
    "Plan a calendar app",
    "Research the history of London",
    "Write an image prompt for a castle",
  ]) {
    assert.equal(quick(message).fastReply, undefined, message);
    assert.equal(quick(message).effort, "ultra", message);
  }
  assert.equal(quick("Hello", { projectId: "chosen-project" }).effort, "low");
  assert.equal(
    quick("Review the app code", { projectId: "chosen-project" }).effort,
    "ultra",
  );
  assert.equal(quick("Review the app code").providerId, "codex");
  assert.equal(quick("Run npm tests").providerId, "codex");
  assert.equal(
    quick("Build an app", { projectId: "chosen-project" }).development.effort,
    "ultracode",
  );
  assert.equal(quick("Hello", { fastReplies: false }).effort, "low");
});

test("fast effort never raises a lower preference or substitutes unsupported effort", () => {
  const roles = defaultAiRoles();
  roles.tasks.general.effort = "low";
  roles.chat.effort = "default";
  assert.equal(quick("Read my email", { roles }).effort, "low");
  const interactionRole = {
    providerId: "codex",
    model: "gpt-6-astra",
    effort: "default",
  };
  assert.equal(quick("Hello", { roles, interactionRole }).effort, "default");
  const providers = [
    {
      id: "codex",
      modelDetails: [{ id: "gpt-6-astra", efforts: ["high", "ultra"] }],
    },
  ];
  assert.equal(
    quick("Hello", { providers }).effort,
    "low",
    "Exact interaction role is retained; provider preflight rejects unsupported effort rather than substituting it",
  );
  assert.equal(quick("Hello", { providers }).assignmentRole, "interaction");
});

test("upgrading enables quick replies without overwriting saved role choices or explicit opt-out", async (t) => {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-reply-settings-"));
  t.after(async () => {
    assert.equal(path.dirname(dir), base);
    assert.ok(path.basename(dir).startsWith("nakama-reply-settings-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const old = initialState();
  delete old.config.fastReplies;
  old.config.aiRoles.chat = {
    providerId: "claude",
    model: "owner-custom-model",
    effort: "high",
  };
  await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(old));
  const upgraded = await new Store(dir).init();
  assert.equal(upgraded.state.config.fastReplies, true);
  assert.deepEqual(upgraded.state.config.aiRoles, old.config.aiRoles);
  const optedOut = new Store(dir);
  await optedOut.init();
  await optedOut.change((s) => {
    s.config.fastReplies = false;
  });
  const reopened = await new Store(dir).init();
  assert.equal(reopened.state.config.fastReplies, false);
  assert.deepEqual(reopened.state.config.aiRoles, old.config.aiRoles);
});
