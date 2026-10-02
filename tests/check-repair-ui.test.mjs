import test from "node:test";
import assert from "node:assert/strict";
import {
  eligibleRepairSource,
  activeProjectRepair,
  repairRequest,
  repairResult,
  repairFileRevision,
} from "../apps/desktop/renderer/src/check-repair-model.ts";
import {
  effortChoices,
  normalizedEffort,
} from "../apps/desktop/renderer/src/provider-options.ts";

const project = { id: "project-one", name: "Fixture" };
const source = {
  id: "failed-check",
  projectId: project.id,
  kind: "project_check",
  checkName: "test",
  status: "failed",
  exitCode: 7,
  manifestHash: "a".repeat(64),
  output: "UNTRUSTED LOG",
  error: "Recorded failure",
};
const provider = {
  id: "codex",
  connectionType: "subscription",
  selectedModel: "fixture-model",
  effort: "high",
  modelDetails: [
    { id: "fixture-model", efforts: ["low", "high", "ultra"], isDefault: true },
  ],
};
const repair = {
  id: "repair-one",
  projectId: project.id,
  sourceTaskId: source.id,
  checkName: "test",
  status: "preparing",
  checkTaskId: "new-check",
};
const passed = {
  id: "new-check",
  projectId: project.id,
  kind: "project_check",
  checkName: "test",
  status: "completed",
  exitCode: 0,
};

test("repair requires matching project, known check and a recorded positive failed exit", () => {
  assert.equal(eligibleRepairSource(project, source), true);
  for (const patch of [
    { projectId: "foreign" },
    { projectId: undefined },
    { id: "" },
    { kind: "command" },
    { checkName: "deploy" },
    { status: "completed" },
    { status: "running" },
    { status: "stopped" },
    { status: "interrupted" },
    { exitCode: null },
    { exitCode: undefined },
    { exitCode: 0 },
    { exitCode: -1 },
    { exitCode: "7" },
    { exitCode: 1.5 },
    { exitCode: Infinity },
    { manifestHash: undefined },
    { manifestHash: "ABC" },
    { manifestHash: "a".repeat(63) },
  ])
    assert.equal(
      eligibleRepairSource(project, { ...source, ...patch }),
      false,
      JSON.stringify(patch),
    );
  assert.equal(eligibleRepairSource(project, undefined), false);
});

test("repair file revision catches completed attempts missed between polls and ignores other projects", () => {
  const before = repairFileRevision([], project.id);
  const after = repairFileRevision(
    [{ ...repair, status: "completed", buildTaskId: "build-one" }],
    project.id,
  );
  assert.notEqual(before, after);
  assert.equal(
    repairFileRevision([{ ...repair, projectId: "other" }], project.id),
    before,
  );
  assert.notEqual(
    repairFileRevision([{ ...repair, status: "building" }], project.id),
    after,
  );
});

test("repair request sends only host-owned source identity and explicit provider settings", () => {
  const body = repairRequest(source, provider, " fixture-model ", "ultra");
  assert.deepEqual(body, {
    sourceTaskId: source.id,
    providerId: "codex",
    model: "fixture-model",
    effort: "ultra",
  });
  assert.equal(JSON.stringify(body).includes("UNTRUSTED"), false);
  assert.deepEqual(repairRequest(source, provider, " ", ""), {
    sourceTaskId: source.id,
    providerId: "codex",
  });
  assert.throws(
    () =>
      repairRequest(source, { ...provider, connectionType: "api" }, "", "high"),
    /subscription/,
  );
  assert.throws(
    () => repairRequest({ ...source, exitCode: null }, provider, "", "high"),
    /failed project check/,
  );
});

test("only active repair for the exact project blocks a new attempt", () => {
  for (const status of [
    "preparing",
    "building",
    "awaiting_approval",
    "checking",
  ]) {
    const active = { ...repair, status };
    assert.equal(activeProjectRepair([active], project.id), active);
    assert.equal(activeProjectRepair([active], "foreign"), undefined);
  }
  for (const status of ["completed", "needs_review", "stopped", "interrupted"])
    assert.equal(
      activeProjectRepair([{ ...repair, status }], project.id),
      undefined,
    );
  assert.equal(activeProjectRepair(undefined, project.id), undefined);
});

test("success requires the exact linked rerun, matching project/check, completed with exit zero", () => {
  const done = { ...repair, status: "completed" };
  assert.equal(repairResult(done, [passed]).title, "Check passed after repair");
  for (const patch of [
    { id: source.id },
    { projectId: "foreign" },
    { kind: "command" },
    { checkName: "build" },
    { status: "failed" },
    { exitCode: null },
    { exitCode: 1 },
    { exitCode: "0" },
  ]) {
    assert.notEqual(
      repairResult(done, [{ ...passed, ...patch }]).tone,
      "completed",
    );
  }
  assert.notEqual(repairResult(done, [source]).tone, "completed");
  assert.notEqual(repairResult(done, []).tone, "completed");
});

test("file repairs, pending approval and failed/stopped attempts never imply check success", () => {
  for (const status of [
    "preparing",
    "building",
    "awaiting_approval",
    "checking",
    "needs_review",
    "stopped",
    "interrupted",
    "unknown",
  ]) {
    const result = repairResult({ ...repair, status }, [passed]);
    assert.notEqual(result.tone, "completed", status);
  }
  assert.equal(
    repairResult({ ...repair, status: "awaiting_approval" }, []).title,
    "Rerun needs desktop approval",
  );
  assert.equal(
    repairResult({ ...repair, status: "needs_review" }, [
      { ...passed, status: "failed", exitCode: 9 },
    ]).check.exitCode,
    9,
  );
});

test("model effort controls use discovered provider metadata without inventing extra modes", () => {
  assert.deepEqual(
    effortChoices(provider, "fixture-model").map((item) => item.value),
    ["low", "high", "ultra"],
  );
  assert.equal(normalizedEffort(provider), "high");
  assert.equal(
    effortChoices({ id: "claude" }).some((item) => item.value === "ultra"),
    false,
  );
});
