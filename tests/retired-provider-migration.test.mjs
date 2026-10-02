import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, initialState } from "../apps/host/store.mjs";

test("an upgrade retires the removed provider and pending media without changing account roles or Google access", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nakama-retired-provider-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^nakama-retired-provider-/);
    await fs.rm(root, { recursive: true, force: true });
  });
  const old = initialState();
  old.config.aiRoles.geminiMediaExplicitOnly = true;
  old.config.aiRoles.planning = {
    providerId: "claude",
    model: "opus",
    effort: "high",
  };
  old.config.fastReplies = false;
  old.config.paidApisEnabled = true;
  old.config.monthlyBudgetGbp = 20;
  old.config.monthlyBudgetUsd = 25;
  old.config.usdToGbp = 0.8;
  old.config.workspaceRoot = "C:\\Owner\\Projects";
  old.providers.find((p) => p.id === "codex").selectedModel = "owner-model";
  old.providers.push({ id: "gemini", status: "unverified" });
  old.connections.push({
    id: "gemini-media",
    accounts: [{ id: "personal" }, { id: "business" }],
  });
  old.connections.find((c) => c.id === "gmail").accounts = [
    { id: "gmail-account", accountLabel: "Owner" },
  ];
  old.devices = [
    { id: "phone", tokenHash: "private", permissions: { googleAccess: false } },
  ];
  old.mediaJobs = [
    {
      id: "quoted",
      status: "quoted",
      request: { prompt: "PRIVATE old prompt" },
    },
    {
      id: "submitted",
      status: "running",
      operation: "PRIVATE remote operation",
    },
    { id: "finished", status: "completed", output: "media/owner-file.mp4" },
  ];
  old.approvals = [
    {
      id: "media-pending",
      type: "media_generation",
      status: "pending",
      operation: { jobId: "quoted" },
    },
    {
      id: "media-executing",
      type: "media_generation",
      status: "executing",
      operation: { jobId: "submitted" },
    },
    {
      id: "media-done",
      type: "media_generation",
      status: "completed",
      operation: { jobId: "finished" },
    },
    { id: "deployment", type: "deployment", status: "pending" },
  ];
  old.audit = [
    { id: "historical", type: "media.completed", detail: "Historical receipt" },
  ];
  await fs.writeFile(path.join(root, "state.json"), JSON.stringify(old));
  const store = await new Store(root).init();
  assert.deepEqual(
    store.state.providers.map((p) => p.id),
    ["codex", "claude"],
  );
  assert.equal(store.state.providers[0].selectedModel, "owner-model");
  assert.equal(
    store.state.connections.some((c) => c.id === "gemini-media"),
    false,
  );
  assert.deepEqual(
    store.state.connections.find((c) => c.id === "gmail").accounts,
    [{ id: "gmail-account", accountLabel: "Owner" }],
  );
  assert.deepEqual(
    store.state.config.aiRoles.planning,
    old.config.aiRoles.planning,
  );
  assert.equal(store.state.config.fastReplies, false);
  assert.equal(store.state.config.workspaceRoot, old.config.workspaceRoot);
  assert.equal(store.state.devices[0].permissions.googleAccess, false);
  for (const key of [
    "paidApisEnabled",
    "monthlyBudgetUsd",
    "monthlyBudgetGbp",
    "usdToGbp",
  ])
    assert.equal(Object.hasOwn(store.state.config, key), false);
  assert.equal(
    Object.hasOwn(store.state.config.aiRoles, "geminiMediaExplicitOnly"),
    false,
  );
  assert.equal(Object.hasOwn(store.state, "mediaJobs"), false);
  assert.deepEqual(
    store.state.retiredMediaJobs.map((job) => [
      job.id,
      job.status,
      job.priorStatus,
    ]),
    [
      ["quoted", "cancelled", "quoted"],
      ["submitted", "unconfirmed", "running"],
      ["finished", "completed", "completed"],
    ],
  );
  assert.equal(store.state.retiredMediaJobs[2].output, "media/owner-file.mp4");
  assert.deepEqual(
    store.state.approvals.map((item) => item.status),
    ["cancelled", "interrupted", "completed", "pending"],
  );
  assert.deepEqual(store.state.audit, old.audit);
  assert.deepEqual(store.state.pendingLegacyCredentialRemovals, [
    "gemini-media:personal",
    "gemini-media:business",
  ]);
  for (const owner of [false, true]) {
    const publicState = store.publicState(owner);
    assert.equal(Object.hasOwn(publicState, "retiredMediaJobs"), false);
    assert.equal(
      Object.hasOwn(publicState, "pendingLegacyCredentialRemovals"),
      false,
    );
    assert.equal(JSON.stringify(publicState).includes("PRIVATE"), false);
  }
  const reopened = await new Store(root).init();
  assert.deepEqual(reopened.state, store.state);
});

test("fresh installations expose only ChatGPT and Claude and no retired paid-media configuration", () => {
  const state = initialState();
  assert.deepEqual(
    state.providers.map((p) => p.id),
    ["codex", "claude"],
  );
  assert.equal(
    state.connections.some((c) => c.category === "Media"),
    false,
  );
  assert.equal(Object.hasOwn(state.config, "paidApisEnabled"), false);
  assert.equal(
    Object.hasOwn(state.config.aiRoles, "geminiMediaExplicitOnly"),
    false,
  );
});
