import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  projectSnapshot,
  parseFileProposal,
  applyFileProposal,
} from "../apps/host/build-files.mjs";
import { NakamaHost } from "../apps/host/host.mjs";
import { within } from "../apps/host/security.mjs";
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-build-")),
    root = path.join(dir, "project");
  await fs.mkdir(root);
  t.after(async () => {
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-build-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, root, backupRoot: path.join(dir, "backups") };
}
const proposal = (files) =>
  parseFileProposal(
    "```nakama-files\n" +
      JSON.stringify({ summary: "Built the requested page.", files }) +
      "\n```",
  );
test("generated files are applied together after validation with recoverable originals", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "index.html"), "before");
  const snapshot = await projectSnapshot(f.root),
    result = await applyFileProposal({
      ...f,
      snapshot,
      proposal: proposal([
        { path: "index.html", content: "after" },
        { path: "src/main.js", content: "console.log(1)" },
      ]),
    });
  assert.equal(
    await fs.readFile(path.join(f.root, "index.html"), "utf8"),
    "after",
  );
  assert.equal(
    await fs.readFile(path.join(result.backupDir, "0.txt"), "utf8"),
    "before",
  );
  assert.deepEqual(result.files, ["index.html", "src/main.js"]);
});
test("an edit made during generation rejects the whole proposal before any writes", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "keep.txt"), "before");
  const snapshot = await projectSnapshot(f.root);
  await fs.writeFile(path.join(f.root, "keep.txt"), "user edit");
  await assert.rejects(
    applyFileProposal({
      ...f,
      snapshot,
      proposal: proposal([
        { path: "new.txt", content: "new" },
        { path: "keep.txt", content: "overwrite" },
      ]),
    }),
    { status: 409 },
  );
  await assert.rejects(fs.stat(path.join(f.root, "new.txt")), {
    code: "ENOENT",
  });
  assert.equal(
    await fs.readFile(path.join(f.root, "keep.txt"), "utf8"),
    "user edit",
  );
});
test("malicious or ambiguous model output cannot escape a project or overwrite credentials", async (t) => {
  const f = await fixture(t),
    snapshot = await projectSnapshot(f.root);
  for (const invalid of ["../escape.txt", "C:/escape.txt"])
    await assert.rejects(async () =>
      applyFileProposal({
        ...f,
        snapshot,
        proposal: proposal([{ path: invalid, content: "bad" }]),
      }),
    );
  for (const invalid of [".env", ".git/config", "private.pem"])
    assert.throws(() => proposal([{ path: invalid, content: "bad" }]), {
      status: 403,
    });
  assert.throws(
    () =>
      proposal([
        { path: "Test.txt", content: "a" },
        { path: "test.txt", content: "b" },
      ]),
    { status: 409 },
  );
  assert.throws(() => parseFileProposal("No actual JSON"), { status: 409 });
});
test("only explicit build mode applies provider files; discussion output cannot mutate", async (t) => {
  const f = await fixture(t),
    completions = [];
  async function completeWhenStarted(result) {
    const deadline = Date.now() + 5000;
    while (!completions.length) {
      assert.ok(Date.now() < deadline, "Fixture provider did not start");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await completions.shift()(result);
  }
  const host = await new NakamaHost({
    dataDir: path.join(f.dir, "host"),
    runAgent: async (_provider, options) => {
      completions.push(options.onComplete);
      return { stop() {} };
    },
  }).init();
  t.after(() => host.close());
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot: f.root });
  const project = await host.dispatch("POST", "/api/projects", {
      name: "Example",
    }),
    answer =
      "```nakama-files\n" +
      JSON.stringify({
        summary: "Created file.",
        files: [{ path: "hello.txt", content: "hello" }],
      }) +
      "\n```";
  await host.dispatch("POST", "/api/chat", {
    projectId: project.id,
    message: "Explain",
    mode: "discuss",
  });
  await completeWhenStarted({ code: 0, text: answer });
  await assert.rejects(fs.stat(path.join(project.path, "hello.txt")), {
    code: "ENOENT",
  });
  await host.dispatch("POST", "/api/chat", {
    projectId: project.id,
    message: "Create a hello file",
    mode: "build",
  });
  await assert.rejects(
    host.dispatch("POST", "/api/chat", {
      projectId: project.id,
      message: "Another writer",
      mode: "build",
    }),
    { status: 409 },
  );
  await completeWhenStarted({ code: 0, text: answer });
  await host.store.queue;
  assert.equal(
    await fs.readFile(path.join(project.path, "hello.txt"), "utf8"),
    "hello",
  );
  assert.equal(host.building.size, 0);
  assert.equal(host.store.state.tasks.at(-1).status, "completed");
});

test("builder rejects path aliases, file/directory collisions, oversized output and direct validation bypasses", async (t) => {
  const f = await fixture(t),
    snapshot = await projectSnapshot(f.root);
  for (const name of ["a/./b.txt", "a//b.txt", "/root.txt", "a/../b.txt"])
    assert.throws(() => proposal([{ path: name, content: "x" }]));
  assert.throws(
    () =>
      proposal([
        { path: "thing", content: "x" },
        { path: "thing/child.txt", content: "y" },
      ]),
    /directory/,
  );
  assert.throws(() => parseFileProposal("x".repeat(8 * 1024 * 1024 + 1)), {
    status: 413,
  });
  await assert.rejects(
    applyFileProposal({
      ...f,
      snapshot,
      proposal: {
        summary: "bad",
        files: [{ path: ".env", content: "secret" }],
      },
    }),
    { status: 403 },
  );
  await assert.rejects(
    applyFileProposal({
      ...f,
      snapshot,
      proposal: {
        summary: "x".repeat(3001),
        files: [{ path: "ok.txt", content: "safe" }],
      },
    }),
  );
});

test("concurrent applications to one project serialize and reject a stale snapshot", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "shared.txt"), "before");
  const snapshot = await projectSnapshot(f.root);
  const results = await Promise.allSettled(
    ["first", "second"].map((content) =>
      applyFileProposal({
        ...f,
        snapshot,
        proposal: proposal([{ path: "shared.txt", content }]),
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(
    await fs.readFile(path.join(f.root, "shared.txt"), "utf8"),
    // Root canonicalisation is asynchronous; either request can acquire the
    // reservation first. The saved content must belong to the sole winner.
    results[0].status === "fulfilled" ? "first" : "second",
  );
});

test("a recovery copy changed during backup aborts the proposal before project writes", async (t) => {
  const f = await fixture(t),
    file = path.join(f.root, "existing.txt");
  await fs.writeFile(file, "before");
  const snapshot = await projectSnapshot(f.root),
    copy = fs.copyFile;
  t.mock.method(fs, "copyFile", async (source, target, ...args) => {
    if (source === file) await fs.writeFile(file, "external edit");
    return copy(source, target, ...args);
  });
  await assert.rejects(
    applyFileProposal({
      ...f,
      snapshot,
      proposal: proposal([
        { path: "new.txt", content: "new" },
        { path: "existing.txt", content: "after" },
      ]),
    }),
    /recovery copy/,
  );
  assert.equal(await fs.readFile(file, "utf8"), "external edit");
  await assert.rejects(fs.stat(path.join(f.root, "new.txt")), {
    code: "ENOENT",
  });
});

test("rollback continues after a user-changed file and preserves that edit plus recovery copies", async (t) => {
  const f = await fixture(t);
  for (const name of ["a", "b", "c"])
    await fs.writeFile(path.join(f.root, `${name}.txt`), `old-${name}`);
  const snapshot = await projectSnapshot(f.root),
    rename = fs.rename;
  t.mock.method(fs, "rename", async (source, target) => {
    if (target === path.join(f.root, "c.txt")) {
      await fs.writeFile(path.join(f.root, "b.txt"), "user edit");
      throw Object.assign(new Error("Simulated disk error"), { code: "EPERM" });
    }
    return rename(source, target);
  });
  await assert.rejects(
    applyFileProposal({
      ...f,
      snapshot,
      proposal: proposal(
        ["a", "b", "c"].map((name) => ({
          path: `${name}.txt`,
          content: `new-${name}`,
        })),
      ),
    }),
    /Manual recovery needed for 1/,
  );
  assert.equal(await fs.readFile(path.join(f.root, "a.txt"), "utf8"), "old-a");
  assert.equal(
    await fs.readFile(path.join(f.root, "b.txt"), "utf8"),
    "user edit",
  );
  assert.equal(await fs.readFile(path.join(f.root, "c.txt"), "utf8"), "old-c");
  const backup = (await fs.readdir(f.backupRoot))[0];
  assert.equal(
    await fs.readFile(path.join(f.backupRoot, backup, "1.txt"), "utf8"),
    "old-b",
  );
});

test("existing files over the build limit cannot be overwritten through a too-large snapshot marker", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.root, "large.txt"),
    "x".repeat(1024 * 1024 + 1),
  );
  const snapshot = await projectSnapshot(f.root);
  await assert.rejects(
    applyFileProposal({
      ...f,
      snapshot,
      proposal: proposal([{ path: "large.txt", content: "small" }]),
    }),
    /exceeds the build limit/,
  );
  assert.equal(
    (await fs.stat(path.join(f.root, "large.txt"))).size,
    1024 * 1024 + 1,
  );
});
