import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NakamaHost } from "../apps/host/host.mjs";
import { githubRepository } from "../apps/host/github-projects.mjs";
import { runCheckpointGit } from "../apps/host/project-checkpoints.mjs";
import { findGit, gitEnvironment } from "../apps/host/project-git.mjs";
import { within } from "../apps/host/security.mjs";

const exec = promisify(execFile),
  git = await findGit();
const OWNER = { kind: "owner", id: "desktop" };
const PHONE = { kind: "device", id: "fixture-phone" };
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-github-"));
  const home = path.join(dir, "home"),
    workspaceRoot = path.join(dir, "projects"),
    remote = path.join(dir, "remote.git");
  await fs.mkdir(home);
  await fs.mkdir(workspaceRoot);
  const token = "fixture-credential-do-not-expose";
  const host = await new NakamaHost({
    dataDir: path.join(dir, "state"),
    vault: { get: async () => token },
    runAgent: () => {
      throw new Error("No AI in Git fixtures");
    },
  }).init();
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot });
  await host.store.change((s) => {
    s.connections.find((c) => c.id === "github").accounts = [
      {
        id: "fixture-account",
        accountLabel: "Private fixture account",
        status: "configured",
      },
    ];
    s.devices.push({
      id: PHONE.id,
      platform: "android",
      permissions: { googleAccess: true, projectAccess: true },
    });
  });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Git fixture",
  });
  const commandAt = async (root, ...args) =>
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
        {
          env: { ...gitEnvironment(home), GIT_ALLOW_PROTOCOL: "file" },
          windowsHide: true,
        },
      )
    ).stdout.trim();
  const command = (...args) => commandAt(project.path, ...args);
  await command("init", "-b", "main");
  await fs.writeFile(path.join(project.path, "selected.txt"), "original\n");
  await fs.writeFile(path.join(project.path, "other.txt"), "original other\n");
  await command("add", ".");
  await command("commit", "-m", "Initial fixture");
  await fs.mkdir(remote);
  await commandAt(remote, "init", "--bare");
  await command("push", remote, "HEAD:refs/heads/main");
  host.services.githubRepository = async (accountId, repository) => {
    host.services.account("github", accountId);
    assert.equal(repository.toLowerCase(), "fixture/repository");
    return {
      repositoryId: "42",
      repository: "fixture/repository",
      defaultBranch: "main",
      private: true,
      url: "https://github.com/fixture/repository",
    };
  };
  const calls = [];
  host.githubProjects.transport = async (context, args, options) => {
    calls.push({ args: [...args], envKeys: Object.keys(options.env) });
    assert.ok(!args.join(" ").includes(token));
    assert.equal(options.env.NAKAMA_GITHUB_CREDENTIAL, token);
    assert.ok(args.includes("http.followRedirects=false"));
    const replaced = args.map((a) =>
      a === "https://github.com/fixture/repository.git" ? remote : a,
    );
    return runCheckpointGit(context.file, replaced, {
      ...context.options,
      ...options,
      env: { ...options.env, GIT_ALLOW_PROTOCOL: "file" },
    });
  };
  const route = `/api/projects/${project.id}/github`;
  const link = () =>
    host.dispatch("POST", route + "/link", {
      accountId: "fixture-account",
      repository: "fixture/repository",
    });
  const prepare = (paths = ["selected.txt"], principal = OWNER) =>
    host.dispatch(
      "POST",
      route + "/commit/prepare",
      {
        paths,
        message: "Reviewed selected change",
        authorName: "Fixture author",
        authorEmail: "author@example.invalid",
      },
      principal,
    );
  t.after(async () => {
    await host.close();
    assert.ok(
      within(base, dir) &&
        path.basename(dir).startsWith("nakama-github-") &&
        (await fs.realpath(dir)) === dir,
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    host,
    dir,
    project,
    route,
    remote,
    command,
    commandAt,
    calls,
    prepare,
    link,
    token,
  };
}

test("GitHub repository input accepts fixed HTTPS/plain identities and rejects SSH, credentials, escapes and other hosts", () => {
  assert.equal(
    githubRepository("https://github.com/Owner/Repo.git"),
    "Owner/Repo",
  );
  assert.equal(githubRepository("Owner/Repo"), "Owner/Repo");
  for (const input of [
    "git@github.com:owner/repo.git",
    "https://user:pass@github.com/a/b",
    "https://github.com.evil/a/b",
    "https://github.com/a/b?token=x",
    "https://github.com/a/%62",
    "../repo",
    "https://github.com/a/b/tree/main",
    "file:///tmp/repo",
  ])
    assert.throws(() => githubRepository(input));
});

test("reviewed selected commit preserves unselected staged entries and working copies, author, exact UTF8 and idempotent receipt", async (t) => {
  const { host, project, route, command, prepare } = await fixture(t);
  await fs.writeFile(
    path.join(project.path, "selected.txt"),
    "reviewed ☕\r\n",
  );
  await fs.writeFile(path.join(project.path, "other.txt"), "staged other\n");
  await command("add", "other.txt");
  await fs.writeFile(path.join(project.path, "other.txt"), "working other\n");
  const staged = await command("show", ":other.txt"),
    headOther = await command("show", "HEAD:other.txt");
  const preview = await prepare();
  assert.equal(preview.files[0].after, "reviewed ☕\r\n");
  const result = await host.dispatch("POST", route + "/commit", {
    previewId: preview.id,
  });
  assert.equal(await command("rev-parse", "HEAD"), result.commit);
  assert.equal(await command("show", "HEAD:selected.txt"), "reviewed ☕");
  assert.equal(await command("show", "HEAD:other.txt"), headOther);
  assert.equal(await command("show", ":other.txt"), staged);
  assert.equal(
    await fs.readFile(path.join(project.path, "other.txt"), "utf8"),
    "working other\n",
  );
  assert.equal(
    await command("show", "-s", "--format=%an <%ae>", "HEAD"),
    "Fixture author <author@example.invalid>",
  );
  assert.deepEqual(
    await host.dispatch("POST", route + "/commit", { previewId: preview.id }),
    result,
  );
});

test("selected staged files and stale file/index/branch reviews fail without changing existing work", async (t) => {
  const { host, project, route, command, prepare } = await fixture(t);
  await fs.writeFile(path.join(project.path, "selected.txt"), "staged\n");
  await command("add", "selected.txt");
  await assert.rejects(prepare(), /staged/);
  await command("restore", "--staged", "selected.txt");
  const preview = await prepare(),
    head = await command("rev-parse", "HEAD");
  await fs.writeFile(
    path.join(project.path, "selected.txt"),
    "later user edit\n",
  );
  await assert.rejects(
    host.dispatch("POST", route + "/commit", { previewId: preview.id }),
    /changed/,
  );
  assert.equal(await command("rev-parse", "HEAD"), head);
  assert.equal(
    await fs.readFile(path.join(project.path, "selected.txt"), "utf8"),
    "later user edit\n",
  );
});

test("link account, fetch and fast-forward pull use fixed safe transport; dirty work and divergent histories are preserved", async (t) => {
  const { host, project, route, command, commandAt, remote, link, calls } =
    await fixture(t);
  await link();
  assert.equal(
    (await host.dispatch("GET", route)).link.repository,
    "fixture/repository",
  );
  await fs.writeFile(path.join(project.path, "new.txt"), "remote change\n");
  await command("add", "new.txt");
  await command("commit", "-m", "remote fixture update");
  const next = await command("rev-parse", "HEAD"),
    old = await command("rev-parse", "HEAD^");
  await command("push", remote, "HEAD:refs/heads/main");
  // Disposable fixture setup only, independent of product mutation code.
  await command("checkout", "-b", "old", old);
  await command("branch", "-D", "main");
  await command("branch", "-m", "main");
  const fetched = await host.dispatch("POST", route + "/fetch", {});
  assert.equal(fetched.remoteHead, next);
  assert.equal(await command("rev-parse", "HEAD"), old);
  await fs.writeFile(path.join(project.path, "dirty.txt"), "keep me");
  await assert.rejects(host.dispatch("POST", route + "/pull", {}), /clean/);
  await fs.unlink(path.join(project.path, "dirty.txt"));
  const pulled = await host.dispatch("POST", route + "/pull", {});
  assert.equal(pulled.head, next);
  assert.equal(await command("rev-parse", "HEAD"), next);
  assert.equal(await commandAt(remote, "rev-parse", "refs/heads/main"), next);
  assert.ok(
    calls.every(
      (c) =>
        !c.args.includes("--force") && !c.args.includes("--recurse-submodules"),
    ),
  );
});

test("import fetches existing default branch into a new managed project without account credentials in state or Git config", async (t) => {
  const { host, token, command } = await fixture(t);
  const imported = await host.dispatch(
    "POST",
    "/api/github/import",
    {
      accountId: "fixture-account",
      repository: "https://github.com/fixture/repository.git",
      name: "Imported",
    },
    PHONE,
  );
  assert.notEqual(imported.project.path, host.store.state.projects[1].path);
  assert.equal(imported.project.github.repository, "fixture/repository");
  assert.equal(
    (
      await host.dispatch(
        "GET",
        `/api/projects/${imported.project.id}/github`,
        {},
        PHONE,
      )
    ).status.head,
    await command("rev-parse", "HEAD"),
  );
  assert.ok(!JSON.stringify(host.store.state).includes(token));
  assert.ok(
    !(
      await fs.readFile(
        path.join(imported.project.path, ".git", "config"),
        "utf8",
      )
    ).includes(token),
  );
});

test("push requires PC approval and uses proven-ancestor exact lease; changed remote refuses without writes", async (t) => {
  const { host, project, route, command, remote, commandAt, link, calls } =
    await fixture(t);
  await link();
  await fs.writeFile(path.join(project.path, "selected.txt"), "to push\n");
  await command("add", "selected.txt");
  await command("commit", "-m", "Push fixture");
  const review = await host.dispatch(
    "POST",
    route + "/push/prepare",
    {},
    PHONE,
  );
  const { approval } = await host.dispatch(
    "POST",
    route + "/push",
    { previewId: review.id },
    PHONE,
  );
  assert.equal(approval.status, "pending");
  assert.ok(!calls.some((c) => c.args.includes("push")));
  await assert.rejects(
    host.dispatch(
      "POST",
      `/api/approvals/${approval.id}/resolve`,
      { approved: true },
      PHONE,
    ),
    /Windows|owner|approval/i,
  );
  await host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
    approved: true,
  });
  assert.equal(
    await commandAt(remote, "rev-parse", "refs/heads/main"),
    review.head,
  );
  const push = calls.find((c) => c.args.includes("push"));
  assert.ok(
    push.args.includes(
      `--force-with-lease=refs/heads/main:${review.remoteHead}`,
    ),
  );
  assert.ok(push.args.includes(`${review.head}:refs/heads/main`));
  const nextReview = await host.dispatch("POST", route + "/push/prepare", {});
  const next = await host.dispatch("POST", route + "/push", {
    previewId: nextReview.id,
  });
  await commandAt(
    remote,
    "update-ref",
    "refs/heads/main",
    await command("rev-parse", "HEAD^"),
  );
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${next.approval.id}/resolve`, {
      approved: true,
    }),
    /changed/,
  );
  assert.equal(calls.filter((c) => c.args.includes("push")).length, 1);
});

test("custom config, submodules, concurrent project work and disabled device privacy fail closed", async (t) => {
  const { host, project, route, command, link } = await fixture(t);
  await command("config", "credential.helper", "!echo forbidden");
  await assert.rejects(link(), /custom Git/);
  await command("config", "--unset", "credential.helper");
  host.checking.add(project.id);
  await assert.rejects(link(), /running|check|finish/i);
  host.checking.delete(project.id);
  host.store.state.devices.find(
    (d) => d.id === PHONE.id,
  ).permissions.googleAccess = false;
  for (const [method, endpoint, body] of [
    ["GET", route, {}],
    [
      "POST",
      route + "/link",
      { accountId: "fixture-account", repository: "fixture/repository" },
    ],
    ["GET", "/api/github/repositories?accountId=fixture-account", {}],
    [
      "POST",
      "/api/github/import",
      { accountId: "fixture-account", repository: "fixture/repository" },
    ],
  ])
    await assert.rejects(
      host.dispatch(method, endpoint, body, PHONE),
      /disabled|access|permission/i,
    );
});

test("an index lock acquired by another Git process during review is never removed", async (t) => {
  const { host, project, route, command, prepare } = await fixture(t);
  await fs.writeFile(path.join(project.path, "selected.txt"), "review\n");
  const preview = await prepare(),
    head = await command("rev-parse", "HEAD");
  const files = host.githubProjects.files.bind(host.githubProjects);
  let count = 0;
  host.githubProjects.files = async (...args) => {
    const result = await files(...args);
    if (++count === 2)
      await fs.writeFile(
        path.join(project.path, ".git", "index.lock"),
        "foreign Git lock",
        { flag: "wx" },
      );
    return result;
  };
  await assert.rejects(
    host.dispatch("POST", route + "/commit", { previewId: preview.id }),
  );
  assert.equal(
    await fs.readFile(path.join(project.path, ".git", "index.lock"), "utf8"),
    "foreign Git lock",
  );
  assert.equal(await command("rev-parse", "HEAD"), head);
});

test("uncertain update-ref completion retains the staging lock and recovery journal rather than losing staged intent", async (t) => {
  const { host, project, route, command, prepare } = await fixture(t);
  await fs.writeFile(path.join(project.path, "selected.txt"), "review\n");
  const preview = await prepare(),
    previous = await command("rev-parse", "HEAD");
  const run = host.githubProjects.run;
  host.githubProjects.run = async (file, args, options) => {
    const result = await run(file, args, options);
    if (args.includes("update-ref"))
      throw new Error(
        "Synthetic lost subprocess result after real local ref update",
      );
    return result;
  };
  await assert.rejects(
    host.dispatch("POST", route + "/commit", { previewId: preview.id }),
    /staging finalisation/,
  );
  assert.notEqual(await command("rev-parse", "HEAD"), previous);
  assert.ok(
    (await fs.stat(path.join(project.path, ".git", "index.lock"))).isFile(),
  );
  const journal = JSON.parse(
    await fs.readFile(
      path.join(project.path, ".git", "nakama-commit-recovery.json"),
      "utf8",
    ),
  );
  assert.equal(journal.previousHead, previous);
  await assert.rejects(prepare(), /recovery/);
});

test("bundled credential helper uses Git private protocol and refuses wrong repository without logging or storing tokens", async (t) => {
  const { host, route, link, token } = await fixture(t);
  await link();
  const transport = host.githubProjects.transport;
  let verified = false,
    helperPath;
  host.githubProjects.transport = async (context, args, options) => {
    helperPath = options.env.NAKAMA_GIT_HELPER;
    assert.ok(!helperPath.includes(".asar"));
    assert.ok(!(await fs.readFile(helperPath, "utf8")).includes(token));
    const configArgs = args.slice(0, args.indexOf("ls-remote"));
    if (args.includes("ls-remote")) {
      const good = await runCheckpointGit(
        context.file,
        [...configArgs, "credential", "fill"],
        {
          ...context.options,
          ...options,
          input:
            "protocol=https\nhost=github.com\npath=fixture/repository.git\n\n",
        },
      );
      assert.equal(good.code, 0);
      assert.ok(good.output.includes(token));
      const wrong = await runCheckpointGit(
        context.file,
        [...configArgs, "credential", "fill"],
        {
          ...context.options,
          ...options,
          input: "protocol=https\nhost=github.com\npath=someone/else.git\n\n",
        },
      );
      assert.notEqual(wrong.code, 0);
      assert.ok(!wrong.output.includes(token) && !wrong.error.includes(token));
      verified = true;
    }
    return transport(context, args, options);
  };
  await host.dispatch("POST", route + "/push/prepare", {});
  assert.equal(verified, true);
  assert.equal(await fs.stat(helperPath).catch(() => null), null);
});

test("approved pushes reject changed local heads, revoked phones/accounts and changed saved credentials", async (t) => {
  const { host, project, route, command, link, calls } = await fixture(t);
  await link();
  async function request(principal = OWNER) {
    const review = await host.dispatch(
      "POST",
      route + "/push/prepare",
      {},
      principal,
    );
    return (
      await host.dispatch(
        "POST",
        route + "/push",
        { previewId: review.id },
        principal,
      )
    ).approval;
  }
  const local = await request();
  await fs.writeFile(
    path.join(project.path, "selected.txt"),
    "local advance\n",
  );
  await command("add", "selected.txt");
  await command("commit", "-m", "Changed after approval review");
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${local.id}/resolve`, {
      approved: true,
    }),
    /changed/,
  );
  const phone = await request(PHONE);
  host.store.state.devices.find(
    (d) => d.id === PHONE.id,
  ).permissions.projectAccess = false;
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${phone.id}/resolve`, {
      approved: true,
    }),
    /access/,
  );
  const revoked = await request();
  const accounts = host.store.state.connections.find(
    (c) => c.id === "github",
  ).accounts;
  host.store.state.connections.find((c) => c.id === "github").accounts = [];
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${revoked.id}/resolve`, {
      approved: true,
    }),
    /saved account/,
  );
  host.store.state.connections.find((c) => c.id === "github").accounts =
    accounts;
  const credentials = await request();
  host.vault.get = async () => "changed-fixture-credential";
  await assert.rejects(
    host.dispatch("POST", `/api/approvals/${credentials.id}/resolve`, {
      approved: true,
    }),
  );
  assert.equal(calls.filter((c) => c.args.includes("push")).length, 0);
});

test("a remote deletion or new-branch creation at push time fails its exact lease including already-equal no-op races", async (t) => {
  const { host, project, route, command, commandAt, remote, link } =
    await fixture(t);
  await link();
  await fs.writeFile(path.join(project.path, "selected.txt"), "advance\n");
  await command("add", "selected.txt");
  await command("commit", "-m", "advance");
  const transport = host.githubProjects.transport;
  for (const mode of ["delete", "new-equal"]) {
    if (mode === "new-equal")
      await command("checkout", "-b", "feature", "HEAD^");
    const review = await host.dispatch("POST", route + "/push/prepare", {});
    const { approval } = await host.dispatch("POST", route + "/push", {
      previewId: review.id,
    });
    host.githubProjects.transport = async (context, args, options) => {
      if (args.includes("push")) {
        if (mode === "delete")
          await commandAt(remote, "update-ref", "-d", "refs/heads/main");
        else
          await commandAt(
            remote,
            "update-ref",
            "refs/heads/feature",
            review.head,
          );
      }
      return transport(context, args, options);
    };
    await assert.rejects(
      host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
        approved: true,
      }),
      /rejected|changed/,
    );
    if (mode === "delete")
      await assert.rejects(
        commandAt(remote, "rev-parse", "--verify", "refs/heads/main"),
      );
    host.githubProjects.transport = transport;
  }
});

test("disabled Google access strips GitHub link/receipt metadata and revocation during the final commit preview read denies the response", async (t) => {
  const { host, project, route, link, prepare } = await fixture(t);
  await link();
  project.githubLastOperation = { status: "pushed", head: "private receipt" };
  const phone = host.store.state.devices.find((d) => d.id === PHONE.id);
  phone.permissions.googleAccess = false;
  const state = await host.dispatch("GET", "/api/state", {}, PHONE);
  const visible = state.projects.find((p) => p.id === project.id);
  assert.ok(
    !Object.hasOwn(visible, "github") &&
      !Object.hasOwn(visible, "githubLastOperation"),
  );
  phone.permissions.googleAccess = true;
  await fs.writeFile(path.join(project.path, "selected.txt"), "review\n");
  const inspect = host.githubProjects.inspectTree.bind(host.githubProjects);
  host.githubProjects.inspectTree = async (...args) => {
    await inspect(...args);
    phone.permissions.googleAccess = false;
  };
  await assert.rejects(prepare(["selected.txt"], PHONE), /access/);
  assert.equal(host.githubProjects.previews.size, 0);
});

test("diverged remote history and submodule trees are rejected before any push, pull or link mutation", async (t) => {
  const { host, project, route, command, commandAt, remote, link, calls } =
    await fixture(t);
  await link();
  await fs.writeFile(
    path.join(project.path, "selected.txt"),
    "remote only change\n",
  );
  await command("add", "selected.txt");
  await command("commit", "-m", "Remote child");
  const remoteChild = await command("rev-parse", "HEAD"),
    parent = await command("rev-parse", "HEAD^");
  await command("push", remote, "HEAD:refs/heads/main");
  await command("checkout", "-b", "divergent", parent);
  await fs.writeFile(
    path.join(project.path, "selected.txt"),
    "local divergence\n",
  );
  await command("add", "selected.txt");
  await command("commit", "-m", "Divergent child");
  await command("branch", "-D", "main");
  await command("branch", "-m", "main");
  const localHead = await command("rev-parse", "HEAD");
  await assert.rejects(
    host.dispatch("POST", route + "/push/prepare", {}),
    /diverged/,
  );
  await assert.rejects(host.dispatch("POST", route + "/pull", {}), /diverged/);
  assert.equal(await command("rev-parse", "HEAD"), localHead);
  assert.equal(
    await commandAt(remote, "rev-parse", "refs/heads/main"),
    remoteChild,
  );
  assert.equal(calls.filter((c) => c.args.includes("push")).length, 0);
  await command(
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${parent},submodule`,
  );
  await command("commit", "-m", "Local fixture submodule metadata");
  await assert.rejects(link(), /submodules|symbolic links/);
});
