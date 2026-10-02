import test from "node:test";
import assert from "node:assert/strict";
import {
  checkpointCandidates,
  checkpointRequest,
  validCheckpointPreparation,
  validCheckpointReceipt,
  CheckpointRequestGate,
} from "../apps/desktop/renderer/src/git-checkpoint-model.ts";

const entry = (path, indexStatus = " ", worktreeStatus = "M", extra = {}) => ({
  path,
  indexStatus,
  worktreeStatus,
  ...extra,
});
const candidates = [entry("README.md"), entry("new.txt", "?", "?")];
const request = {
  paths: ["README.md", "new.txt"],
  message: "Keep this change",
};
const now = Date.now();
const preview = {
  id: "12345678-1234-1234-1234-123456789abc",
  projectId: "fixture",
  head: "a".repeat(40),
  branch: "main",
  message: request.message,
  expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
  disclosure: "Local only",
  files: [
    {
      path: "README.md",
      kind: "modified",
      before: "Before\n",
      after: "After\n",
      bytes: 6,
    },
    { path: "new.txt", kind: "added", before: "", after: "Hello\n", bytes: 6 },
  ],
};
const receipt = {
  id: preview.id,
  projectId: preview.projectId,
  head: preview.head,
  commit: "b".repeat(40),
  ref: `refs/nakama/checkpoints/${preview.id}`,
  message: preview.message,
  files: request.paths,
  createdAt: new Date(now).toISOString(),
};

test("candidates exclude private paths, conflicts, renames, linked types and invalid paths", () => {
  const excluded = [
    entry(".env"),
    entry("src/.env.local"),
    entry(".aws/config"),
    entry(".npmrc"),
    entry("credentials.json"),
    entry("secret.json"),
    entry("id_ed25519"),
    entry("server.pem"),
    entry("src/.git/config"),
    entry("../outside.txt"),
    entry("C:/outside.txt"),
    entry("file\nname"),
    entry("same", "U", "U"),
    entry("new", "R", " ", { originalPath: "old" }),
    entry("link", "T", " "),
    entry("copy", "C", " "),
  ];
  assert.deepEqual(
    checkpointCandidates([...candidates, ...excluded]),
    candidates,
  );
  assert.equal(
    checkpointCandidates([entry("deleted.txt", " ", "D")]).length,
    1,
  );
});
test("request requires explicit eligible files and message and never includes file contents", () => {
  assert.deepEqual(
    checkpointRequest(candidates, request.paths, " Keep this change "),
    request,
  );
  for (const paths of [
    [],
    ["foreign"],
    ["README.md", "README.md"],
    Array(21).fill("README.md"),
  ])
    assert.throws(() => checkpointRequest(candidates, paths, "Keep"), /Choose/);
  for (const message of ["", "  ", "Line\nbreak", "tab\tname", "a".repeat(501)])
    assert.throws(
      () => checkpointRequest(candidates, request.paths, message),
      /message/,
    );
  assert.equal(
    JSON.stringify(
      checkpointRequest(candidates, request.paths, request.message),
    ).includes("before"),
    false,
  );
});
test("review must bind exact project, ordered files, message and valid deadline", () => {
  assert.equal(
    validCheckpointPreparation(preview, "fixture", request, now),
    true,
  );
  for (const patch of [
    { id: "invalid" },
    { projectId: "other" },
    { head: "bad" },
    { message: "Different" },
    { branch: 7 },
    { expiresAt: "bad" },
    { expiresAt: new Date(now).toISOString() },
    { expiresAt: new Date(now + 12 * 60 * 1000).toISOString() },
    { files: [...preview.files].reverse() },
    { files: preview.files.slice(0, 1) },
  ])
    assert.equal(
      validCheckpointPreparation(
        { ...preview, ...patch },
        "fixture",
        request,
        now,
      ),
      false,
      JSON.stringify(patch),
    );
});
test("review rejects truncated, oversized or inconsistent snapshots and accepts exact Unicode bytes", () => {
  const single = { paths: ["README.md"], message: request.message };
  const file = preview.files[0];
  for (const patch of [
    { after: null },
    { before: null },
    { bytes: 1 },
    { bytes: -1 },
    { kind: "rename" },
    { before: "x".repeat(256 * 1024 + 1) },
    { after: "é".repeat(256 * 1024), bytes: 512 * 1024 },
    { kind: "added", before: "Exists" },
    { kind: "deleted", after: "Exists" },
  ])
    assert.equal(
      validCheckpointPreparation(
        { ...preview, files: [{ ...file, ...patch }] },
        "fixture",
        single,
        now,
      ),
      false,
    );
  assert.equal(
    validCheckpointPreparation(
      { ...preview, files: [{ ...file, after: "£", bytes: 2 }] },
      "fixture",
      single,
      now,
    ),
    true,
  );
  assert.equal(
    validCheckpointPreparation(
      {
        ...preview,
        head: null,
        branch: null,
        files: [{ ...file, kind: "deleted", after: "", bytes: 0 }],
      },
      "fixture",
      single,
      now,
    ),
    true,
  );
});
test("receipt matches the exact preview, commit reference, files and project", () => {
  assert.equal(validCheckpointReceipt(receipt, preview), true);
  for (const patch of [
    { id: "different" },
    { projectId: "other" },
    { ref: "refs/heads/main" },
    { commit: "bad" },
    { head: "c".repeat(40) },
    { message: "Other" },
    { createdAt: "bad" },
    { files: [...request.paths].reverse() },
    { files: ["README.md"] },
  ])
    assert.equal(
      validCheckpointReceipt({ ...receipt, ...patch }, preview),
      false,
      JSON.stringify(patch),
    );
});
test("request gate blocks double clicks and responses from refreshed or abandoned reviews", () => {
  const gate = new CheckpointRequestGate();
  const first = gate.begin();
  assert.equal(gate.begin(), null);
  gate.invalidate();
  const second = gate.begin();
  assert.equal(gate.finish(first), false);
  assert.equal(gate.begin(), null);
  assert.equal(gate.finish(second), true);
  assert.equal(gate.finish(second), false);
  const third = gate.begin();
  gate.invalidate();
  assert.equal(gate.finish(third), false);
});
