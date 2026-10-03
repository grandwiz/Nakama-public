import test from "node:test";
import assert from "node:assert/strict";
import {
  officeForest,
  officeIsCurrent,
  navigationOutcome,
} from "../apps/desktop/renderer/src/agent-office-model.ts";

const desk = (id, status = "running", parentId) => ({
  id,
  name: id,
  status,
  parentId,
  providerId: "codex",
  role: "worker",
  sourceKind: "task",
  title: id,
  createdAt: "2026-10-02T00:00:00Z",
});
const flatten = (roots) =>
  roots.flatMap((node) => [node.agent.id, ...flatten(node.children)]);
test("current office hides finished desks while retaining their active children", () => {
  const agents = [
    desk("manager", "completed"),
    desk("worker", "queued", "manager"),
    desk("old", "failed"),
  ];
  const before = structuredClone(agents);
  const roots = officeForest(agents, false);
  assert.deepEqual(flatten(roots), ["worker"]);
  assert.equal(roots[0].agent.parentId, "manager");
  assert.deepEqual(agents, before);
});
test("history includes completed failed interrupted and unavailable receipts", () => {
  const agents = ["completed", "failed", "interrupted", "unavailable"].map(
    (status) => desk(status, status),
  );
  assert.deepEqual(officeForest(agents, false), []);
  assert.deepEqual(
    flatten(officeForest(agents, true)),
    agents.map((agent) => agent.id),
  );
});
test("waiting and unknown statuses remain visible without claiming completion", () => {
  for (const status of [
    "awaiting_answers",
    "awaiting_approval",
    "needs_attention",
    "queued",
    "unknown",
  ])
    assert.equal(officeIsCurrent(desk(status, status)), true);
});
test("dangling parents and corrupt cycles cannot hide receipts or recurse indefinitely", () => {
  const agents = [
    desk("a", "running", "b"),
    desk("b", "running", "a"),
    desk("c", "running", "a"),
    desk("d", "running", "missing"),
    desk("self", "running", "self"),
  ];
  const ids = flatten(officeForest(agents, false));
  assert.equal(ids.length, 5);
  assert.deepEqual(new Set(ids), new Set(agents.map((agent) => agent.id)));
});
test("duplicate ids cannot create multiple screens and empty history stays empty", () => {
  assert.deepEqual(officeForest([], true), []);
  assert.deepEqual(flatten(officeForest([desk("a"), desk("a")], true)), ["a"]);
});
test("navigation accepts only exact internal destinations and current project identities", () => {
  const projects = [{ id: "saved" }];
  for (const target of [
    "agent-office",
    "home",
    "projects",
    "boards",
    "routines",
    "core-memory",
    "assistant",
    "agents",
    "usage",
    "devices",
    "connections",
    "activity",
    "settings",
  ])
    assert.deepEqual(
      navigationOutcome({ type: "navigate", target }, projects),
      { target },
    );
  assert.deepEqual(
    navigationOutcome(
      { type: "navigate", target: "projects", projectId: "saved" },
      projects,
    ),
    { target: "projects", projectId: "saved" },
  );
  for (const value of [
    null,
    "agent-office",
    { type: "navigate", target: "https://example.com" },
    { type: "navigate", target: "javascript:alert(1)" },
    { type: "navigate", target: "Agent-office" },
    { type: "other", target: "home" },
    { type: "navigate", target: "projects", projectId: "missing" },
    { type: "navigate", target: "agent-office", projectId: "saved" },
    { type: "navigate", target: "projects", projectId: [] },
  ])
    assert.equal(navigationOutcome(value, projects), null);
});
