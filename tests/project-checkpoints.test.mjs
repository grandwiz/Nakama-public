import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { NakamaHost } from "../apps/host/host.mjs";
import { findGit, gitEnvironment } from "../apps/host/project-git.mjs";
import { runCheckpointGit } from "../apps/host/project-checkpoints.mjs";
import { within } from "../apps/host/security.mjs";

const exec = promisify(execFile),
  git = await findGit();
async function fixture(t, { commit = true } = {}) {
  assert.ok(git);
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-checkpoint-"));
  const host = await new NakamaHost({
    dataDir: path.join(dir, "state"),
    runAgent: () => {
      throw new Error("No inference in checkpoint tests");
    },
  }).init();
  const workspaceRoot = path.join(dir, "projects"),
    isolation = path.join(dir, "home");
  await fs.mkdir(workspaceRoot);
  await fs.mkdir(isolation);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Checkpoint fixture",
  });
  const root = project.path;
  const command = async (...args) =>
    (
      await exec(
        git,
        [
          "-C",
          root,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "core.autocrlf=false",
          ...args,
        ],
        { env: gitEnvironment(isolation), windowsHide: true },
      )
    ).stdout;
  await command("init", "-b", "main");
  await fs.writeFile(path.join(root, "tracked.txt"), "base\n");
  await fs.writeFile(path.join(root, "other.txt"), "unselected base\n");
  await fs.writeFile(path.join(root, "deleted.txt"), "deleted base\n");
  if (commit) {
    await command("add", "--", ".");
    await command("commit", "-m", "Fixture baseline");
  }
  const prepare = (paths = ["tracked.txt"], message = "Save reviewed edits") =>
    host.dispatch(
      "POST",
      `/api/projects/${project.id}/git/checkpoints/prepare`,
      { paths, message },
    );
  const create = (preview) =>
    host.dispatch(
      "POST",
      `/api/projects/${project.id}/git/checkpoints/create`,
      { previewId: preview.id },
    );
  t.after(async () => {
    await host.close();
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-checkpoint-"),
    );
    assert.equal(await fs.realpath(dir), dir);
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, root, host, project, command, prepare, create };
}

test("exact selected working copies become a local checkpoint while HEAD, index and unrelated work remain unchanged; retry returns same receipt", async (t) => {
  const { root, command, prepare, create, project } = await fixture(t);
  await fs.writeFile(path.join(root, "tracked.txt"), "staged\n");
  await command("add", "--", "tracked.txt");
  await fs.writeFile(path.join(root, "tracked.txt"), "working copy\r\n");
  await fs.writeFile(path.join(root, "other.txt"), "unselected staged\n");
  await command("add", "--", "other.txt");
  await fs.writeFile(path.join(root, "other.txt"), "unselected working\n");
  await fs.unlink(path.join(root, "deleted.txt"));
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, "nested", "café.txt"), "new ☕\n");
  await fs.writeFile(path.join(root, "-leading.txt"), "leading\n");
  const beforeHead = await command("rev-parse", "HEAD"),
    beforeBranch = await command("symbolic-ref", "HEAD");
  const index = path.join(root, ".git", "index"),
    beforeIndex = await fs.readFile(index),
    beforeIndexStat = await fs.stat(index);
  const status = await command("status", "--porcelain=v1");
  const paths = [
    "tracked.txt",
    "deleted.txt",
    "nested/café.txt",
    "-leading.txt",
  ];
  const preview = await prepare(paths);
  assert.equal(preview.projectId, project.id);
  assert.equal(preview.head, beforeHead.trim());
  assert.equal(preview.branch, "main");
  assert.deepEqual(
    preview.files.map((file) => file.path),
    paths,
  );
  assert.deepEqual(preview.files[0], {
    path: "tracked.txt",
    kind: "modified",
    before: "base\n",
    after: "working copy\r\n",
    bytes: 14,
  });
  assert.equal(preview.files[1].kind, "deleted");
  assert.equal(preview.files[1].bytes, 0);
  assert.match(preview.disclosure, /without Git filters/);
  const result = await create(preview);
  assert.equal(result.id, preview.id);
  assert.equal(result.projectId, project.id);
  assert.equal(result.ref, `refs/nakama/checkpoints/${preview.id}`);
  assert.deepEqual(result.files, paths);
  assert.deepEqual(await create(preview), result);
  assert.equal(
    await command("show", `${result.ref}:tracked.txt`),
    "working copy\r\n",
  );
  assert.equal(
    await command("show", `${result.ref}:nested/café.txt`),
    "new ☕\n",
  );
  assert.equal(
    await command("show", `${result.ref}:other.txt`),
    "unselected base\n",
  );
  await assert.rejects(command("show", `${result.ref}:deleted.txt`));
  assert.equal(
    (await command("rev-parse", `${result.ref}^`)).trim(),
    beforeHead.trim(),
  );
  assert.equal(await command("rev-parse", "HEAD"), beforeHead);
  assert.equal(await command("symbolic-ref", "HEAD"), beforeBranch);
  assert.deepEqual(await fs.readFile(index), beforeIndex);
  assert.equal((await fs.stat(index)).mtimeMs, beforeIndexStat.mtimeMs);
  assert.equal(await command("status", "--porcelain=v1"), status);
  assert.equal(
    (
      await command(
        "for-each-ref",
        "--format=%(refname)",
        "refs/nakama/checkpoints/",
      )
    ).trim(),
    result.ref,
  );
});

test("a checkpoint includes staged-only changed working content, rejects staging that differs while the working copy equals HEAD", async (t) => {
  const { root, command, prepare, create } = await fixture(t);
  await fs.writeFile(path.join(root, "tracked.txt"), "staged-only\n");
  await command("add", "--", "tracked.txt");
  const preview = await prepare();
  assert.equal(preview.files[0].after, "staged-only\n");
  assert.ok((await create(preview)).commit);
  await fs.writeFile(path.join(root, "tracked.txt"), "base\n");
  await assert.rejects(prepare(), /no content change from HEAD/);
});

test("changed selected content, index, HEAD and configuration invalidate a preview permanently", async (t) => {
  const { root, command, prepare, create } = await fixture(t);
  for (const kind of ["source", "index", "head", "configuration"]) {
    await fs.writeFile(path.join(root, "tracked.txt"), `${kind} proposed\n`);
    const preview = await prepare();
    if (kind === "source")
      await fs.appendFile(path.join(root, "tracked.txt"), "later\n");
    if (kind === "index") {
      await fs.appendFile(path.join(root, "other.txt"), "stage\n");
      await command("add", "--", "other.txt");
    }
    if (kind === "head")
      await command("commit", "--allow-empty", "-m", "Another local commit");
    if (kind === "configuration")
      await command("config", "checkpoint.fixture", "changed");
    await assert.rejects(create(preview), { status: 409 });
    await assert.rejects(create(preview), /already used/);
  }
  assert.equal(
    (await command("for-each-ref", "refs/nakama/checkpoints/")).trim(),
    "",
  );
});

test("expiry, restart, forged payload, wrong project and phone principals cannot create checkpoints", async (t) => {
  const { root, host, project, prepare, create } = await fixture(t);
  await fs.writeFile(path.join(root, "tracked.txt"), "changed\n");
  const preview = await prepare();
  await assert.rejects(
    host.checkpoints.create(
      "different",
      { previewId: preview.id },
      { kind: "owner", id: "desktop" },
    ),
    { status: 409 },
  );
  await assert.rejects(
    host.checkpoints.create(
      project.id,
      { previewId: preview.id, message: "substitute" },
      { kind: "owner", id: "desktop" },
    ),
    { status: 400 },
  );
  const ticket = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  const pair = await host.dispatch("POST", "/api/pair", {
    platform: "android",
    name: "Phone",
    ticket: ticket.ticket,
  });
  const phone = host.authenticate("Bearer " + pair.token);
  for (const action of ["prepare", "create"])
    await assert.rejects(
      host.dispatch(
        "POST",
        `/api/projects/${project.id}/git/checkpoints/${action}`,
        action === "create"
          ? { previewId: preview.id }
          : { paths: ["tracked.txt"], message: "phone" },
        phone,
      ),
      { status: 403 },
    );
  host.checkpoints.clock = () => Date.parse(preview.expiresAt) + 1;
  await assert.rejects(create(preview), /expired/);
  host.checkpoints.previews.clear();
  await assert.rejects(create(preview), /unavailable/);
});

test("unborn repositories, active Git operations and malformed selections are rejected", async (t) => {
  const f = await fixture(t, { commit: false });
  await assert.rejects(f.prepare(), /first ordinary Git commit/);
  await f.command("add", "--", ".");
  await f.command("commit", "-m", "Start");
  await fs.writeFile(path.join(f.root, "tracked.txt"), "changed\n");
  for (const paths of [
    [],
    ["tracked.txt", "TRACKED.TXT"],
    ["../escape"],
    ["nested\\file"],
    [".git/config"],
    [".env"],
    ["auth.json"],
    [".ssh/id_rsa"],
    ["ignored.txt"],
    Array(21).fill("tracked.txt"),
  ])
    await assert.rejects(f.prepare(paths));
  for (const message of [
    "",
    "\nsecond",
    "x".repeat(501),
    "token=some-credential-value",
  ])
    await assert.rejects(f.prepare(["tracked.txt"], message));
  await fs.writeFile(path.join(f.root, ".git", "MERGE_HEAD"), "0".repeat(40));
  await assert.rejects(f.prepare(), /active Git operation/);
});

test("binary, invalid UTF8, oversized and possible credential versions cannot be hidden inside a preview", async (t) => {
  const { root, prepare, command } = await fixture(t);
  for (const data of [
    Buffer.from([0, 1, 2]),
    Buffer.from([0xc3, 0x28]),
    Buffer.alloc(256 * 1024 + 1, 65),
    "API_KEY=not-a-real-fixture-secret\n",
    "-----BEGIN PRIVATE KEY-----\nfixture",
  ]) {
    await fs.writeFile(path.join(root, "tracked.txt"), data);
    await assert.rejects(prepare());
  }
  await fs.writeFile(path.join(root, "tracked.txt"), Buffer.from([0xc3, 0x28]));
  await command("add", "--", "tracked.txt");
  await command("commit", "-m", "Invalid UTF8 fixture baseline");
  await fs.writeFile(path.join(root, "tracked.txt"), "now text\n");
  await assert.rejects(prepare(), /UTF-8/);
});

test("configured commit/reference hooks and signing are not run; configured clean filters are rejected", async (t) => {
  const { root, dir, command, prepare, create } = await fixture(t);
  const hooks = path.join(dir, "hostile-hooks"),
    marker = path.join(dir, "must-not-exist");
  await fs.mkdir(hooks);
  for (const name of [
    "pre-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "reference-transaction",
  ]) {
    const file = path.join(hooks, name);
    await fs.writeFile(
      file,
      `#!/bin/sh\nprintf unsafe > '${marker.replaceAll("\\", "/")}'\nexit 1\n`,
    );
    await fs.chmod(file, 0o755);
  }
  await command("config", "core.hooksPath", hooks);
  await command("config", "commit.gpgsign", "true");
  await command("config", "gpg.program", path.join(hooks, "pre-commit"));
  await command("config", "gc.auto", "1");
  await fs.writeFile(path.join(root, "tracked.txt"), "safe changed\n");
  const result = await create(await prepare());
  assert.ok(result.commit);
  assert.equal(await fs.stat(marker).catch(() => null), null);
  await command(
    "config",
    "filter.poison.clean",
    path.join(hooks, "pre-commit"),
  );
  await assert.rejects(prepare(), /external filters/);
  assert.equal(await fs.stat(marker).catch(() => null), null);
});

test("a concurrent HEAD advance at final ref transaction leaves no checkpoint ref", async (t) => {
  const { root, host, command, prepare, create } = await fixture(t);
  await fs.writeFile(path.join(root, "tracked.txt"), "changed\n");
  const preview = await prepare();
  const run = host.checkpoints.run;
  host.checkpoints.run = async (file, args, options) => {
    if (args.includes("update-ref"))
      await command("commit", "--allow-empty", "-m", "Concurrent commit");
    return run(file, args, options);
  };
  await assert.rejects(create(preview), { status: 409 });
  assert.equal(
    (await command("for-each-ref", "refs/nakama/checkpoints/")).trim(),
    "",
  );
});

test("checkpoint reservation interlocks builders, source writes, commands, checks, repairs and deletion; active operations block preparation", async (t) => {
  const { root, host, project, prepare } = await fixture(t);
  await fs.writeFile(path.join(root, "tracked.txt"), "changed\n");
  for (const kind of [
    "building",
    "checking",
    "projectMutations",
    "commandProcesses",
  ]) {
    if (kind === "projectMutations") host[kind].set(project.id, 1);
    else if (kind === "commandProcesses")
      host[kind].set("fake-process", project.id);
    else host[kind].add(project.id);
    await assert.rejects(prepare(), { status: 409 });
    host[kind].clear();
  }
  host.repairs.entries.set("repair", {
    record: { id: "repair", projectId: project.id },
  });
  await assert.rejects(prepare(), /repair workflow/);
  host.repairs.entries.clear();
  let release, reached;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    reached = resolve;
  });
  const context = host.checkpoints.context.bind(host.checkpoints);
  host.checkpoints.context = async (...args) => {
    reached();
    await gate;
    return context(...args);
  };
  const pending = prepare();
  await started;
  assert.equal(host.checkpointing.has(project.id), true);
  await assert.rejects(
    host.dispatch("PUT", `/api/projects/${project.id}/file`, {
      path: "tracked.txt",
      content: "blocked",
    }),
    /checkpoint/,
  );
  await assert.rejects(
    host.dispatch("POST", "/api/chat", {
      projectId: project.id,
      message: "build",
      mode: "build",
      providerId: "codex",
    }),
    /checkpoint/,
  );
  await assert.rejects(
    host.startCommand(
      { projectId: project.id, command: "must-not-run" },
      { kind: "owner", id: "desktop" },
    ),
    /checkpoint/,
  );
  await assert.rejects(
    host.requestProjectCheck(
      project,
      { name: "test", manifestHash: "f".repeat(64) },
      { kind: "owner", id: "desktop" },
    ),
    /checkpoint/,
  );
  const deletion = await host.dispatch(
    "POST",
    `/api/projects/${project.id}/delete-request`,
  );
  await assert.rejects(
    host.resolveApproval(
      deletion.id,
      { approved: true },
      { kind: "owner", id: "desktop" },
    ),
    /checkpoint/,
  );
  await assert.rejects(prepare(), /checkpoint/);
  release();
  await pending;
  assert.equal(host.checkpointing.has(project.id), false);
});

test("checkpoint subprocess timeout keeps the operation pending until the process closes", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let settled = false;
  const run = runCheckpointGit("fixture", [], {
    root: "fixture",
    gitDir: "fixture/.git",
    spawnImpl: () => child,
    timeoutMs: 10,
  }).finally(() => {
    settled = true;
  });
  const rejection = assert.rejects(run, { status: 408 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false);
  child.emit("close", 1);
  await rejection;
  child.stdout.destroy();
  child.stderr.destroy();
});

test("add/add and delete/delete unmerged index entries cannot be checkpointed", async (t) => {
  const { root, host, prepare } = await fixture(t);
  await fs.writeFile(path.join(root, "tracked.txt"), "conflicted\n");
  const original = host.git.status.bind(host.git);
  for (const state of ["AA", "DD"]) {
    host.git.status = async (...args) => {
      const result = await original(...args);
      result.entries = result.entries.map((entry) =>
        entry.path === "tracked.txt"
          ? { ...entry, indexStatus: state[0], worktreeStatus: state[1] }
          : entry,
      );
      return result;
    };
    await assert.rejects(prepare(), /without conflicts/);
  }
});

test("changed project identity consumes the preview even if it is later restored", async (t) => {
  const { root, project, prepare, create } = await fixture(t);
  await fs.writeFile(path.join(root, "tracked.txt"), "changed\n");
  const preview = await prepare();
  project.path += "-moved";
  await assert.rejects(create(preview), /changed/);
  project.path = root;
  await assert.rejects(create(preview), /already used/);
});
