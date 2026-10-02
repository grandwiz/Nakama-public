import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  ProjectGit,
  findGit,
  gitEnvironment,
  parseStatus,
  runReadOnlyGit,
} from "../apps/host/project-git.mjs";
import { NakamaHost } from "../apps/host/host.mjs";
import { within } from "../apps/host/security.mjs";
const exec = promisify(execFile),
  git = await findGit();
async function fixture(t, { initialize = true } = {}) {
  assert.ok(git, "Git is required for these actual repository tests.");
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-git-")),
    root = path.join(dir, "project"),
    isolation = path.join(dir, "fixture-home");
  await fs.mkdir(root);
  await fs.mkdir(isolation);
  const command = (...args) =>
    exec(
      git,
      [
        "-C",
        root,
        "-c",
        "user.name=Nakama fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      { env: gitEnvironment(isolation), windowsHide: true },
    );
  if (initialize) await command("init", "-b", "main");
  t.after(async () => {
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-git-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    root,
    command,
    reader: new ProjectGit(path.join(dir, "host")),
    isolation,
  };
}
async function commitFixture(command, root) {
  for (const [name, content] of Object.entries({
    "tracked.txt": "base\n",
    "deleted.txt": "keep until deleted\n",
    "café file.txt": "unicode base\n",
    "-leading.txt": "leading base\n",
  }))
    await fs.writeFile(path.join(root, name), content);
  await fs.writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2]));
  await command("add", "--", ".");
  await command("commit", "-m", "Local fixture");
}

test("actual Git status and staged/worktree previews preserve the index and handle deletion, Unicode, binary and untracked files", async (t) => {
  const { reader, root, command } = await fixture(t);
  await commitFixture(command, root);
  await fs.writeFile(path.join(root, "tracked.txt"), "staged\n");
  await command("add", "--", "tracked.txt");
  await fs.appendFile(path.join(root, "tracked.txt"), "worktree\n");
  await fs.unlink(path.join(root, "deleted.txt"));
  await fs.appendFile(path.join(root, "café file.txt"), "bonjour\n");
  await fs.appendFile(path.join(root, "-leading.txt"), "dash\n");
  await fs.writeFile(path.join(root, "binary.dat"), Buffer.from([0, 9, 8]));
  await fs.writeFile(path.join(root, "new file.txt"), "new untracked text\n");
  const index = path.join(root, ".git", "index"),
    before = await fs.readFile(index),
    mtime = (await fs.stat(index)).mtimeMs;
  const state = await reader.status(root);
  assert.equal(state.repository, true);
  assert.equal(state.branch, "main");
  assert.match(state.head, /^[a-f0-9]{40}$/);
  assert.deepEqual(
    state.entries.find((e) => e.path === "tracked.txt"),
    { path: "tracked.txt", indexStatus: "M", worktreeStatus: "M" },
  );
  assert.equal(
    state.entries.find((e) => e.path === "deleted.txt").worktreeStatus,
    "D",
  );
  assert.match(
    (await reader.diff(root, "tracked.txt", true)).content,
    /\+staged/,
  );
  assert.doesNotMatch(
    (await reader.diff(root, "tracked.txt", true)).content,
    /\+worktree/,
  );
  assert.match((await reader.diff(root, "tracked.txt")).content, /\+worktree/);
  assert.match(
    (await reader.diff(root, "deleted.txt")).content,
    /-keep until deleted/,
  );
  assert.match((await reader.diff(root, "café file.txt")).content, /bonjour/);
  assert.match((await reader.diff(root, "-leading.txt")).content, /dash/);
  assert.equal((await reader.diff(root, "binary.dat")).binary, true);
  assert.equal(
    (await reader.diff(root, "new file.txt")).content,
    "new untracked text\n",
  );
  assert.equal((await reader.diff(root, "new file.txt", true)).content, "");
  assert.deepEqual(await fs.readFile(index), before);
  assert.equal((await fs.stat(index)).mtimeMs, mtime);
});

test("ordinary folder, absent Git and an unborn branch have explicit states", async (t) => {
  const { reader, root, command, dir } = await fixture(t, {
    initialize: false,
  });
  assert.equal((await reader.status(root)).repository, false);
  assert.equal(
    (
      await new ProjectGit(path.join(dir, "none"), {
        locate: async () => null,
      }).status(root)
    ).available,
    false,
  );
  await command("init", "-b", "main");
  await fs.writeFile(path.join(root, "first.txt"), "first\n");
  await command("add", "--", "first.txt");
  const state = await reader.status(root);
  assert.equal(state.head, null);
  assert.equal(state.branch, "main");
  assert.equal(state.entries[0].indexStatus, "A");
  assert.match((await reader.diff(root, "first.txt", true)).content, /\+first/);
});

test("external diff, text conversion and pager commands never execute during inspection", async (t) => {
  const { reader, root, command, dir } = await fixture(t);
  await commitFixture(command, root);
  const marker = path.join(dir, "unexpected.txt"),
    script = path.join(dir, "marker.cjs");
  await fs.writeFile(
    script,
    `require('fs').writeFileSync(${JSON.stringify(marker)},'unexpected');`,
  );
  const external = `"${process.execPath.replaceAll("\\", "/")}" "${script.replaceAll("\\", "/")}"`;
  await command("config", "diff.external", external);
  await command("config", "diff.poison.textconv", external);
  await command("config", "core.pager", external);
  await fs.writeFile(path.join(root, ".gitattributes"), "*.txt diff=poison\n");
  await fs.appendFile(path.join(root, "tracked.txt"), "changed\n");
  await reader.status(root);
  assert.match((await reader.diff(root, "tracked.txt")).content, /changed/);
  await assert.rejects(fs.stat(marker), { code: "ENOENT" });
});

test("repository filter, monitor, includes, external ordering and partial-clone settings are rejected before status", async (t) => {
  const { reader, root, command, dir } = await fixture(t);
  await commitFixture(command, root);
  const config = path.join(root, ".git", "config"),
    original = await fs.readFile(config);
  const marker = path.join(dir, "must-not-run.txt"),
    script = path.join(dir, "poison.cjs");
  await fs.writeFile(
    script,
    `require('fs').writeFileSync(${JSON.stringify(marker)},'bad');`,
  );
  const external = `"${process.execPath.replaceAll("\\", "/")}" "${script.replaceAll("\\", "/")}"`;
  for (const key of [
    "filter.bad.clean",
    "filter.bad.process",
    "core.fsmonitor",
    "include.path",
    "includeIf.onbranch:main.path",
    "core.attributesFile",
    "core.excludesFile",
    "diff.orderFile",
    "remote.origin.promisor",
    "extensions.partialClone",
    "core.worktree",
    "core.bare",
  ]) {
    await fs.writeFile(config, original);
    await command("config", key, key === "core.bare" ? "true" : external);
    await assert.rejects(reader.status(root), { status: 409 }, key);
  }
  await assert.rejects(fs.stat(marker), { code: "ENOENT" });
});

test("child Git profile ignores malicious global settings and inherited Git routing", async (t) => {
  const { root, command, dir, isolation } = await fixture(t);
  await commitFixture(command, root);
  const poison = path.join(dir, "poison-home");
  await fs.mkdir(poison);
  await fs.writeFile(
    path.join(poison, ".gitconfig"),
    "[core]\n fsmonitor = should-never-execute\n[include]\n path = outside-secret\n",
  );
  const source = {
    ...process.env,
    HOME: poison,
    USERPROFILE: poison,
    GIT_DIR: "outside",
    git_work_tree: "outside",
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor=should-never-execute'",
    GIT_EXTERNAL_DIFF: "outside",
  };
  const env = gitEnvironment(isolation, source);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.git_work_tree, undefined);
  assert.equal(env.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(source.GIT_DIR, "outside");
  const result = await runReadOnlyGit(git, ["status", "--porcelain=v1", "-z"], {
    cwd: isolation,
    env,
    root,
    gitDir: path.join(root, ".git"),
  });
  assert.equal(result.code, 0);
  assert.equal(result.output, "");
  assert.equal(result.error, "");
});

test("linked metadata, external object stores, gitfiles and partial clone markers are refused", async (t) => {
  const { reader, root, dir } = await fixture(t),
    gitDir = path.join(root, ".git");
  for (const name of [
    "commondir",
    "objects/info/alternates",
    "objects/info/http-alternates",
    "objects/pack/test.promisor",
    "config.worktree",
  ]) {
    const file = path.join(gitDir, name);
    await fs.writeFile(file, "outside");
    await assert.rejects(reader.status(root), { status: 409 });
    await fs.unlink(file);
  }
  const outside = path.join(dir, "outside.txt");
  await fs.writeFile(outside, "data");
  const linked = path.join(gitDir, "linked");
  await fs.link(outside, linked);
  await assert.rejects(reader.status(root), { status: 403 });
  await fs.unlink(linked);
  await fs.symlink(
    dir,
    linked,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(reader.status(root), { status: 403 });
  await fs.unlink(linked);
  const moved = path.join(dir, "saved-git");
  await fs.rename(gitDir, moved);
  await fs.writeFile(gitDir, `gitdir: ${moved}`);
  await assert.rejects(reader.status(root), { status: 409 });
});

test("diff paths cannot escape, select a directory, traverse a link or expand a magic pathspec", async (t) => {
  const { reader, root, command, dir } = await fixture(t);
  await commitFixture(command, root);
  await fs.mkdir(path.join(root, "folder"));
  for (const relative of [
    "../outside",
    dir,
    "tracked.txt:stream",
    ":(glob)*",
    "folder",
    ".git/config",
    "",
  ])
    await assert.rejects(reader.diff(root, relative));
  const outside = path.join(dir, "outside.txt");
  await fs.writeFile(outside, "outside");
  await fs.link(outside, path.join(root, "hardlink.txt"));
  await assert.rejects(reader.diff(root, "hardlink.txt"), { status: 403 });
  await fs.symlink(
    dir,
    path.join(root, "junction"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(reader.diff(root, "junction/outside.txt"), {
    status: 403,
  });
});

test("large text previews are bounded and parser retains literal filenames and type changes", async (t) => {
  const { reader, root } = await fixture(t);
  await fs.writeFile(path.join(root, "large.txt"), "long-line\n".repeat(40000));
  const diff = await reader.diff(root, "large.txt");
  assert.equal(diff.truncated, true);
  assert.ok(Buffer.byteLength(diff.content) <= 256 * 1024);
  assert.deepEqual(
    parseStatus(" T café name\0?? -dash\0").entries.map((e) => e.path),
    ["café name", "-dash"],
  );
  assert.equal(
    parseStatus("R  new name\0old name\0").entries[0].originalPath,
    "old name",
  );
  assert.throws(() => parseStatus(" M missing terminator"), { status: 409 });
});

test("a config change during inspection prevents the next Git child from starting", async (t) => {
  const { root, dir } = await fixture(t);
  let calls = 0;
  const reader = new ProjectGit(path.join(dir, "host"), {
    run: async (file, args, options) => {
      calls++;
      const result = await runReadOnlyGit(file, args, options);
      if (args.includes("--no-includes"))
        await fs.appendFile(
          path.join(root, ".git", "config"),
          "\n[core]\n fsmonitor = poison\n",
        );
      return result;
    },
  });
  await assert.rejects(reader.status(root), { status: 409 });
  assert.equal(calls, 1);
});

test("host Git endpoints preserve the project permission boundary", async (t) => {
  const { dir } = await fixture(t);
  const host = await new NakamaHost({ dataDir: path.join(dir, "host") }).init();
  t.after(() => host.close());
  const workspaceRoot = path.join(dir, "workspace");
  await fs.mkdir(workspaceRoot);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot });
  const project = await host.dispatch("POST", "/api/projects", {
      name: "Versioned project",
    }),
    ticket = await host.dispatch("POST", "/api/pairing/tickets", {
      platform: "android",
    }),
    pair = await host.dispatch("POST", "/api/pair", {
      platform: "android",
      name: "Phone",
      ticket: ticket.ticket,
    }),
    principal = host.authenticate("Bearer " + pair.token);
  assert.equal(
    (await host.dispatch("GET", `/api/projects/${project.id}/git`)).repository,
    false,
  );
  await host.dispatch("PATCH", `/api/devices/${pair.deviceId}`, {
    projectAccess: false,
  });
  for (const url of [
    `/api/projects/${project.id}/git`,
    `/api/projects/${project.id}/git/diff?path=README.md`,
  ])
    await assert.rejects(host.dispatch("GET", url, {}, principal), {
      status: 403,
    });
});

test("large Git diff output is truncated and a stalled Git process has a deadline", async (t) => {
  const { reader, root, command } = await fixture(t);
  await fs.writeFile(
    path.join(root, "large.txt"),
    "before line\n".repeat(30000),
  );
  await command("add", "--", "large.txt");
  await command("commit", "-m", "Large local fixture");
  await fs.writeFile(
    path.join(root, "large.txt"),
    "after line\n".repeat(30000),
  );
  const diff = await reader.diff(root, "large.txt");
  assert.equal(diff.truncated, true);
  assert.ok(Buffer.byteLength(diff.content) <= 256 * 1024);
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  await assert.rejects(
    runReadOnlyGit("fixture", [], { spawnImpl: () => child, timeoutMs: 10 }),
    { status: 408 },
  );
  child.stdout.destroy();
  child.stderr.destroy();
});
