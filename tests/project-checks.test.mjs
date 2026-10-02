import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  createProjectCheckTools,
  checkEnvironment,
  installedCheckRuntime,
  discoverChecks,
  prepareCheck,
  verifyCheck,
} from "../apps/host/project-checks.mjs";
import { within } from "../apps/host/security.mjs";

async function fixture(
  t,
  scripts = {
    pretest: "echo before",
    test: "echo main",
    posttest: "echo after",
  },
) {
  const temp = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(temp, "nakama-checks-"));
  t.after(async () => {
    assert.equal(path.dirname(dir), temp);
    assert.ok(
      within(temp, dir) && path.basename(dir).startsWith("nakama-checks-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  const workspaceRoot = path.join(dir, "workspace"),
    dataDir = path.join(dir, "private"),
    project = { id: "project-one", path: path.join(workspaceRoot, "demo") };
  await fs.mkdir(project.path, { recursive: true });
  await fs.mkdir(dataDir);
  const manifest = path.join(project.path, "package.json");
  const write = (value) => fs.writeFile(manifest, JSON.stringify(value));
  await write({ name: "local-check-fixture", version: "1.0.0", scripts });
  const runtimeDir = path.join(dir, "installed"),
    npmRoot = path.join(runtimeDir, "npm");
  await fs.mkdir(path.join(npmRoot, "bin"), { recursive: true });
  const runtime = {
    node: path.join(
      runtimeDir,
      process.platform === "win32" ? "node.exe" : "node",
    ),
    npmCli: path.join(npmRoot, "bin", "npm-cli.js"),
    npmRoot,
    shell: path.join(
      runtimeDir,
      process.platform === "win32" ? "cmd.exe" : "sh",
    ),
  };
  await Promise.all([
    fs.writeFile(runtime.node, "installed-node-test-fixture"),
    fs.writeFile(runtime.shell, "installed-shell-test-fixture"),
    fs.writeFile(runtime.npmCli, "// npm entry point"),
    fs.writeFile(
      path.join(npmRoot, "package.json"),
      '{"name":"npm","version":"11.0.0"}',
    ),
    fs.writeFile(path.join(npmRoot, "npmrc"), ""),
  ]);
  const tools = createProjectCheckTools({
    resolveRuntime: async () => runtime,
  });
  const context = { workspaceRoot, dataDir, project };
  const prepare = async (name = "test") => {
    const found = await tools.discoverChecks(context);
    return tools.prepareCheck({
      ...context,
      name,
      manifestHash: found.manifestHash,
    });
  };
  return { dir, manifest, write, runtime, tools, context, prepare };
}

test("discovery exposes only supported scripts, includes lifecycle and redacts secrets", async (t) => {
  const f = await fixture(t, {
    test: "echo API_KEY=supersecret12345678",
    pretest: "echo before",
    posttest: "echo after",
    lint: "eslint .",
    typecheck: "tsc --noEmit",
    check: "node check.js",
    build: "vite build",
    deploy: "echo PRIVATE_UNRELATED_SCRIPT",
    start: "echo start",
  });
  await f.write({
    scripts: {
      test: "echo API_KEY=supersecret12345678",
      pretest: "echo before",
      posttest: "echo after",
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      check: "node check.js",
      build: "vite build",
      deploy: "PRIVATE_UNRELATED_SCRIPT",
    },
    _authToken: "PRIVATE_MANIFEST_VALUE",
  });
  const found = await f.tools.discoverChecks(f.context);
  assert.equal(found.supported, true);
  assert.equal(found.runtime.available, true);
  assert.deepEqual(
    found.checks.map((c) => c.name),
    ["test", "lint", "typecheck", "check", "build"],
  );
  assert.equal(found.checks[0].preScript, "echo before");
  assert.equal(found.checks[0].postScript, "echo after");
  assert.match(found.checks[0].script, /\[redacted\]/);
  for (const hidden of [
    "supersecret12345678",
    "PRIVATE_UNRELATED_SCRIPT",
    "PRIVATE_MANIFEST_VALUE",
  ])
    assert.ok(!JSON.stringify(found).includes(hidden));
  assert.match(found.manifestHash, /^[a-f0-9]{64}$/);
  const operation = await f.prepare();
  assert.match(operation.preview, /pretest: echo before/);
  assert.match(operation.preview, /posttest: echo after/);
  assert.match(operation.preview, /network/);
  assert.ok(!JSON.stringify(operation).includes("supersecret12345678"));
  assert.deepEqual(JSON.parse(JSON.stringify(operation)), operation);
});

test("unsupported, malformed, oversized and non-text package files fail without execution", async (t) => {
  const f = await fixture(t, { deploy: "echo unrelated" });
  assert.equal((await f.tools.discoverChecks(f.context)).supported, false);
  for (const raw of [
    "null",
    "[]",
    '{"scripts":[]}',
    '{"scripts":{"test":42}}',
    '{"scripts":{"test":"a\\u0000b"}}',
    "{broken",
    JSON.stringify({ scripts: { test: "x".repeat(4097) } }),
    JSON.stringify({
      scripts: { test: "echo fine", pretest: "x".repeat(4097) },
    }),
    JSON.stringify({
      scripts: { test: "echo fine" },
      metadata: "x".repeat(256 * 1024),
    }),
  ]) {
    await fs.writeFile(f.manifest, raw);
    const found = await f.tools.discoverChecks(f.context);
    assert.equal(found.supported, false);
    assert.deepEqual(found.checks, []);
  }
  await fs.writeFile(f.manifest, Buffer.from([0xff, 0xfe]));
  assert.equal((await f.tools.discoverChecks(f.context)).supported, false);
  await fs.unlink(f.manifest);
  assert.equal((await f.tools.discoverChecks(f.context)).supported, false);
});

test("missing runtime, unsupported names and stale manifest previews cannot prepare", async (t) => {
  const f = await fixture(t);
  const unavailable = createProjectCheckTools({
    resolveRuntime: async () => null,
  });
  const found = await unavailable.discoverChecks(f.context);
  assert.equal(found.supported, true);
  assert.equal(found.runtime.available, false);
  await assert.rejects(
    unavailable.prepareCheck({
      ...f.context,
      name: "test",
      manifestHash: found.manifestHash,
    }),
    /Install Node.js/,
  );
  for (const name of [
    "install",
    "deploy",
    "test -- --danger",
    "../test",
    "pretest",
  ])
    await assert.rejects(
      f.tools.prepareCheck({
        ...f.context,
        name,
        manifestHash: found.manifestHash,
      }),
      { status: 400 },
    );
  await assert.rejects(
    f.tools.prepareCheck({
      ...f.context,
      name: "lint",
      manifestHash: found.manifestHash,
    }),
    /not defined/,
  );
  await assert.rejects(
    f.tools.prepareCheck({
      ...f.context,
      name: "test",
      manifestHash: "0".repeat(64),
    }),
    /package.json changed/,
  );
  await assert.rejects(
    f.tools.prepareCheck({ ...f.context, name: "test" }),
    /package.json changed/,
  );
});

test("approval binds package content, canonical workspace/project and exact executable arguments", async (t) => {
  const f = await fixture(t),
    operation = await f.prepare();
  const verified = await f.tools.verifyCheck({ ...f.context, operation });
  assert.equal(verified.command, f.runtime.node);
  assert.equal(verified.cwd, f.context.project.path);
  assert.deepEqual(verified.args.slice(-2), ["run", "test"]);
  for (const flag of [
    "--workspaces=false",
    "--ignore-scripts=false",
    "--offline=true",
    "--update-notifier=false",
    "--fund=false",
    "--audit=false",
    "--if-present=false",
    "--node-options=",
  ])
    assert.ok(verified.args.includes(flag));
  for (const override of [
    { command: "node" },
    { args: [...operation.args, "--evil"] },
    { projectId: "other" },
    { projectRoot: path.join(f.dir, "other") },
    { workspaceRoot: f.dir },
    { checkName: "deploy" },
  ])
    await assert.rejects(
      f.tools.verifyCheck({
        ...f.context,
        operation: { ...operation, ...override },
      }),
      { status: 409 },
    );
  await f.write({ scripts: { test: "echo changed" } });
  await assert.rejects(
    f.tools.verifyCheck({ ...f.context, operation }),
    /package.json changed/,
  );
});

test("runtime code, built-in npm config, private config and missing config invalidate approvals", async (t) => {
  const f = await fixture(t);
  for (const file of [
    f.runtime.node,
    f.runtime.shell,
    f.runtime.npmCli,
    path.join(f.runtime.npmRoot, "npmrc"),
  ]) {
    const operation = await f.prepare(),
      original = await fs.readFile(file);
    await fs.appendFile(file, "\nchanged");
    await assert.rejects(
      f.tools.verifyCheck({ ...f.context, operation }),
      /runtime or check configuration changed/,
    );
    await fs.writeFile(file, original);
  }
  const modulePath = path.join(f.runtime.npmRoot, "lib", "cli.js");
  await fs.mkdir(path.dirname(modulePath));
  await fs.writeFile(modulePath, "// initial installed npm primary CLI module");
  const operation = await f.prepare();
  await fs.writeFile(modulePath, "// changed installed npm primary CLI module");
  await assert.rejects(
    f.tools.verifyCheck({ ...f.context, operation }),
    /runtime or check configuration changed/,
  );
  const updated = await f.prepare();
  assert.notEqual(updated.config.user, updated.config.global);
  await fs.writeFile(updated.config.user, "script-shell=untrusted\n");
  await assert.rejects(
    f.tools.verifyCheck({ ...f.context, operation: updated }),
    /Private npm configuration/,
  );
  await fs.writeFile(updated.config.user, "");
  await fs.unlink(updated.config.global);
  await assert.rejects(
    f.tools.verifyCheck({ ...f.context, operation: updated }),
  );
  assert.equal(
    await fs.stat(updated.config.global).catch(() => null),
    null,
    "verify does not recreate a missing config",
  );
});

test("root npmrc at preview or after approval is rejected without exposing its credentials", async (t) => {
  const f = await fixture(t),
    operation = await f.prepare();
  await fs.writeFile(
    path.join(f.context.project.path, ".npmrc"),
    "//registry.example/:_authToken=private-do-not-display\n",
  );
  const found = await f.tools.discoverChecks(f.context);
  assert.equal(found.supported, false);
  assert.match(found.detail, /root .npmrc/);
  assert.ok(!JSON.stringify(found).includes("private-do-not-display"));
  await assert.rejects(
    f.tools.verifyCheck({ ...f.context, operation }),
    /root .npmrc/,
  );
  await assert.rejects(f.prepare(), /root .npmrc/);
});

test("outside projects, linked manifests and private configs inside the workspace are rejected", async (t) => {
  const f = await fixture(t);
  const outside = {
    ...f.context,
    project: { ...f.context.project, path: path.join(f.dir, "outside") },
  };
  await fs.mkdir(outside.project.path);
  await fs.writeFile(
    path.join(outside.project.path, "package.json"),
    '{"scripts":{"test":"echo outside"}}',
  );
  assert.equal((await f.tools.discoverChecks(outside)).supported, false);
  const found = await f.tools.discoverChecks(f.context);
  await assert.rejects(
    f.tools.prepareCheck({
      ...f.context,
      dataDir: f.context.workspaceRoot,
      name: "test",
      manifestHash: found.manifestHash,
    }),
    /outside the workspace/,
  );
  const copy = path.join(f.dir, "linked-package.json");
  await fs.link(f.manifest, copy);
  assert.equal((await f.tools.discoverChecks(f.context)).supported, false);
  await fs.unlink(copy);
  const runtimeInProject = { ...f.runtime, node: f.manifest };
  const untrusted = createProjectCheckTools({
    resolveRuntime: async () => runtimeInProject,
  });
  await assert.rejects(
    untrusted.prepareCheck({
      ...f.context,
      name: "test",
      manifestHash: found.manifestHash,
    }),
    /trusted runtime/,
  );
});

test("environment removes case-insensitive injection and npm config routes without changing its source", () => {
  const source = {
    Path: `${process.cwd()}${path.delimiter}.${path.delimiter}relative`,
    NODE_OPTIONS: "--require evil.cjs",
    node_path: "evil",
    npm_config_script_shell: "evil",
    NPM_CONFIG_WORKSPACE: "other",
    npm_lifecycle_script: "evil",
    npm_execpath: "evil",
    ELECTRON_RUN_AS_NODE: "1",
    COREPACK_HOME: "evil",
    LD_PRELOAD: "evil",
    DYLD_INSERT_LIBRARIES: "evil",
    BASH_ENV: "evil",
    ENV: "evil",
    ComSpec: "evil",
    SHELL: "evil",
    INIT_CWD: "evil",
    KEEP_ME: "ordinary",
    API_KEY: "root-must-filter-this-separately",
  };
  const runtime = {
      node: path.resolve("installed/node.exe"),
      shell: path.resolve("installed/cmd.exe"),
    },
    config = { user: "empty-user", global: "empty-global" };
  const before = { ...source },
    env = checkEnvironment(runtime, config, source);
  assert.deepEqual(source, before);
  for (const [key, value] of Object.entries(env))
    assert.notEqual(value, "evil", key);
  assert.equal(env.KEEP_ME, "ordinary");
  assert.equal(env.npm_config_script_shell, runtime.shell);
  assert.equal(env.npm_config_userconfig, config.user);
  assert.equal(env.npm_config_globalconfig, config.global);
  assert.equal(env.npm_config_offline, "true");
  assert.equal(env.npm_config_node_options, "");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.npm_execpath, undefined);
  assert.ok(env.PATH.startsWith(path.dirname(runtime.node)));
  assert.ok(!env.PATH.split(path.delimiter).includes("."));
});

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("fixture npm timed out"));
    }, 20000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test(
  "installed npm runs only reviewed root pre/main/post scripts using isolated configuration",
  { timeout: 60000 },
  async (t) => {
    if (!(await installedCheckRuntime()))
      return t.skip(
        "No fixed-location Node/npm installation is available on this test machine.",
      );
    const f = await fixture(t, {
      pretest: "node check.cjs before",
      test: "node check.cjs main",
      posttest: "node check.cjs after",
      install: "node check.cjs MUST_NOT_INSTALL",
    });
    await fs.writeFile(
      path.join(f.context.project.path, "check.cjs"),
      `console.log('CHECK_EVENT:' + process.argv[2]); console.log('CHECK_CWD:' + process.cwd()); console.log('CHECK_OFFLINE:' + process.env.npm_config_offline); console.log('CHECK_NODE_OPTIONS:' + (process.env.NODE_OPTIONS || '')); console.log('CHECK_CONFIG:' + process.env.npm_config_userconfig);`,
    );
    await fs.mkdir(path.join(f.context.project.path, "packages", "child"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(f.context.project.path, "packages", "child", "package.json"),
      JSON.stringify({
        name: "child",
        scripts: { test: "echo MUST_NOT_RUN_WORKSPACE" },
      }),
    );
    const parentNpmrc = path.join(f.context.workspaceRoot, ".npmrc");
    await fs.writeFile(parentNpmrc, "script-shell=DO_NOT_USE_PARENT_CONFIG\n");
    const original = JSON.parse(await fs.readFile(f.manifest, "utf8"));
    await f.write({ ...original, workspaces: ["packages/*"] });
    const found = await discoverChecks(f.context);
    assert.equal(found.runtime.available, true);
    const operation = await prepareCheck({
      ...f.context,
      name: "test",
      manifestHash: found.manifestHash,
    });
    const verified = await verifyCheck({ ...f.context, operation });
    assert.ok(path.isAbsolute(verified.command));
    assert.ok(path.isAbsolute(verified.args[0]));
    assert.notEqual(
      path.basename(verified.command).toLowerCase(),
      "electron.exe",
    );
    const result = await run(verified.command, verified.args, {
      cwd: verified.cwd,
      env: verified.env,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      [...result.stdout.matchAll(/CHECK_EVENT:(\w+)/g)].map((m) => m[1]),
      ["before", "main", "after"],
    );
    assert.ok(result.stdout.includes(`CHECK_CWD:${f.context.project.path}`));
    assert.ok(result.stdout.includes("CHECK_OFFLINE:true"));
    assert.ok(!result.stdout.includes("MUST_NOT_INSTALL"));
    assert.ok(!result.stdout.includes("MUST_NOT_RUN_WORKSPACE"));
    assert.ok(!result.stderr.includes("DO_NOT_USE_PARENT_CONFIG"));
    assert.equal(
      await fs
        .stat(path.join(f.context.project.path, "node_modules"))
        .catch(() => null),
      null,
    );
    assert.equal((await fs.readFile(operation.config.user)).length, 0);
    assert.equal((await fs.readFile(operation.config.global)).length, 0);
  },
);
