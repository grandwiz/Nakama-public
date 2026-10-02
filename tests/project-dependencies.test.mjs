import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createProjectDependencyTools,
  dependencyEnvironment,
} from "../apps/host/project-dependencies.mjs";

const integrity = "sha512-" + Buffer.alloc(64, 1).toString("base64");
const locked = () => ({
  version: "1.0.0",
  resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
  integrity,
});
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-dependencies-"));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(dir)), base);
    assert.ok(path.basename(dir).startsWith("nakama-dependencies-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const workspaceRoot = path.join(dir, "workspace"),
    dataDir = path.join(dir, "private"),
    project = { id: "fixture-project", path: path.join(workspaceRoot, "demo") };
  await fs.mkdir(project.path, { recursive: true });
  await fs.mkdir(dataDir);
  const manifest = {
    name: "fixture",
    version: "1.0.0",
    dependencies: { example: "^1.0.0" },
    scripts: { postinstall: "never-run-this-fixture" },
  };
  const lock = {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "fixture",
        version: "1.0.0",
        dependencies: { example: "^1.0.0" },
      },
      "node_modules/example": locked(),
    },
  };
  const write = async (a = manifest, b = lock) => {
    await fs.writeFile(
      path.join(project.path, "package.json"),
      JSON.stringify(a),
    );
    await fs.writeFile(
      path.join(project.path, "package-lock.json"),
      JSON.stringify(b),
    );
  };
  await write();
  const runtimeDir = path.join(dir, "installed"),
    npmRoot = path.join(runtimeDir, "npm");
  await fs.mkdir(path.join(npmRoot, "bin"), { recursive: true });
  const runtime = {
    node: path.join(runtimeDir, "node.exe"),
    npmCli: path.join(npmRoot, "bin", "npm-cli.js"),
    npmRoot,
    shell: path.join(runtimeDir, "cmd.exe"),
  };
  await Promise.all([
    fs.writeFile(runtime.node, "fixture-node"),
    fs.writeFile(runtime.shell, "fixture-shell"),
    fs.writeFile(runtime.npmCli, "// fixture only"),
    fs.writeFile(
      path.join(npmRoot, "package.json"),
      JSON.stringify({ name: "npm", version: "11.0.0" }),
    ),
    fs.writeFile(path.join(npmRoot, "npmrc"), "prefix=${APPDATA}/npm\n"),
  ]);
  const tools = createProjectDependencyTools({
    resolveRuntime: async () => runtime,
    environment: () => ({
      SystemRoot: "C:\\Windows",
      API_KEY: "NEVER_INHERIT",
      NPM_TOKEN: "NEVER_INHERIT",
      HTTPS_PROXY: "NEVER_INHERIT",
      NODE_OPTIONS: "NEVER_INHERIT",
    }),
  });
  const context = { workspaceRoot, dataDir, project, requestedBy: "desktop" };
  const prepare = async () => {
    const found = await tools.discoverDependencies(context);
    return tools.prepareDependencies({
      ...context,
      manifestHash: found.manifestHash,
      lockHash: found.lockHash,
    });
  };
  return {
    dir,
    context,
    project,
    manifest,
    lock,
    runtime,
    tools,
    write,
    prepare,
  };
}

test("discovery describes a lockfile-bound public install without executing or exposing package metadata", async (t) => {
  const f = await fixture(t);
  f.manifest.privateMetadata = "SECRET_METADATA";
  f.lock.packages["node_modules/example"].hasInstallScript = true;
  await f.write();
  const found = await f.tools.discoverDependencies(f.context);
  assert.equal(found.supported, true);
  assert.equal(found.packageCount, 1);
  assert.equal(found.lifecycleScriptCount, 2);
  assert.match(found.manifestHash, /^[a-f0-9]{64}$/);
  assert.match(found.lockHash, /^[a-f0-9]{64}$/);
  assert.match(found.warning, /replaces.*node_modules/);
  assert.match(found.warning, /Lifecycle scripts are disabled/);
  assert.doesNotMatch(
    JSON.stringify(found),
    /SECRET_METADATA|never-run-this-fixture/,
  );
  assert.equal(found.nodeModulesPresent, false);
  assert.equal(
    await fs.stat(path.join(f.project.path, "node_modules")).catch(() => null),
    null,
  );
});

test("typed operation fixes npm ci flags, isolated paths and requester; no command or install executes", async (t) => {
  const f = await fixture(t),
    op = await f.prepare();
  assert.equal(op.kind, "npm_ci");
  assert.equal(op.requestedBy, "desktop");
  assert.equal(op.ignoreScripts, true);
  assert.equal(op.command, f.runtime.node);
  assert.equal(op.args.at(-1), "ci");
  for (const flag of [
    "--ignore-scripts=true",
    "--workspaces=false",
    "--audit=false",
    "--fund=false",
    "--registry=https://registry.npmjs.org/",
    "--strict-ssl=true",
    "--fetch-retries=0",
  ])
    assert.ok(op.args.includes(flag), flag);
  const verified = await f.tools.verifyDependencies({
    ...f.context,
    operation: op,
  });
  assert.equal(verified.cwd, f.project.path);
  assert.deepEqual(verified.args, op.args);
  assert.doesNotMatch(JSON.stringify(verified.env), /NEVER_INHERIT/);
  assert.equal(verified.env.npm_config_ignore_scripts, "true");
  assert.equal((await fs.readFile(op.config.user)).length, 0);
  assert.equal((await fs.readFile(op.config.global)).length, 0);
  assert.equal(
    await fs.stat(path.join(f.project.path, "node_modules")).catch(() => null),
    null,
  );
});

test("package, lockfile, root, requester and exact execution tampering invalidate preparation", async (t) => {
  const f = await fixture(t),
    op = await f.prepare();
  for (const patch of [
    { command: "npm" },
    { args: [...op.args, "--ignore-scripts=false"] },
    { projectId: "other" },
    { requestedBy: "another" },
    { kind: "install" },
    { ignoreScripts: false },
    { registry: "https://other.invalid/" },
    { projectRoot: f.dir },
    { workspaceRoot: f.dir },
    { manifestHash: "0".repeat(64) },
    { lockHash: "0".repeat(64) },
  ])
    await assert.rejects(
      f.tools.verifyDependencies({
        ...f.context,
        operation: { ...op, ...patch },
      }),
      { status: 409 },
    );
  await assert.rejects(
    f.tools.verifyDependencies({
      ...f.context,
      operation: op,
      requestedBy: "phone",
    }),
    { status: 409 },
  );
  await assert.rejects(
    f.tools.prepareDependencies({
      ...f.context,
      manifestHash: op.manifestHash,
      lockHash: "0".repeat(64),
    }),
    /changed/,
  );
  await fs.appendFile(path.join(f.project.path, "package-lock.json"), "\n");
  await assert.rejects(
    f.tools.verifyDependencies({ ...f.context, operation: op }),
    /changed/,
  );
  await f.write();
  await fs.appendFile(path.join(f.project.path, "package.json"), "\n");
  await assert.rejects(
    f.tools.verifyDependencies({ ...f.context, operation: op }),
    /changed/,
  );
});

test("unsupported dependency sources, integrity, paths and configuration fail without leaking values", async (t) => {
  const f = await fixture(t);
  const cases = [
    () => {
      f.manifest.dependencies.example = "file:../secret";
      f.lock.packages[""].dependencies.example = "file:../secret";
    },
    () => {
      f.lock.packages["node_modules/example"].resolved =
        "https://token:PRIVATE_CREDENTIAL@registry.npmjs.org/example.tgz";
    },
    () => {
      f.lock.packages["node_modules/example"].resolved =
        "https://127.0.0.1/example.tgz";
    },
    () => {
      f.lock.packages["node_modules/example"].resolved =
        "https://registry.npmjs.org/example.tgz?token=PRIVATE_CREDENTIAL";
    },
    () => {
      f.lock.packages["node_modules/example"].integrity = "sha1-fixture";
    },
    () => {
      f.lock.packages["node_modules/example"].link = true;
    },
    () => {
      f.lock.packages["../outside"] = locked();
    },
    () => {
      f.lock.packages["node_modules/example"].dependencies = {
        other: "git+https://example.invalid/source",
      };
    },
    () => {
      f.manifest.workspaces = ["packages/*"];
    },
    () => {
      f.manifest.overrides = { example: "2.0.0" };
    },
    () => {
      f.lock.packages[""].dependencies.example = "2.0.0";
    },
    () => {
      f.lock.lockfileVersion = 1;
    },
  ];
  const manifest = structuredClone(f.manifest),
    lock = structuredClone(f.lock);
  for (const change of cases) {
    for (const key of Object.keys(f.manifest)) delete f.manifest[key];
    Object.assign(f.manifest, structuredClone(manifest));
    for (const key of Object.keys(f.lock)) delete f.lock[key];
    Object.assign(f.lock, structuredClone(lock));
    change();
    await f.write();
    const result = await f.tools.discoverDependencies(f.context);
    assert.equal(result.supported, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CREDENTIAL/);
  }
  await f.write(manifest, lock);
  for (const name of [
    ".npmrc",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
  ]) {
    await fs.writeFile(path.join(f.project.path, name), "PRIVATE_CREDENTIAL");
    const found = await f.tools.discoverDependencies(f.context);
    assert.equal(found.supported, false);
    assert.equal(found.reason, "unsupported_configuration");
    assert.doesNotMatch(JSON.stringify(found), /PRIVATE_CREDENTIAL/);
    await fs.unlink(path.join(f.project.path, name));
  }
});

test("missing, malformed and linked inputs or node_modules never become install candidates", async (t) => {
  const f = await fixture(t),
    lockPath = path.join(f.project.path, "package-lock.json");
  await fs.unlink(lockPath);
  assert.equal(
    (await f.tools.discoverDependencies(f.context)).reason,
    "missing_lockfile",
  );
  for (const raw of ["null", "[]", "{bad", Buffer.from([0xff, 0xfe])]) {
    await fs.writeFile(lockPath, raw);
    assert.equal(
      (await f.tools.discoverDependencies(f.context)).supported,
      false,
    );
  }
  await f.write();
  const hard = path.join(f.dir, "linked-lock.json");
  await fs.link(lockPath, hard);
  assert.equal(
    (await f.tools.discoverDependencies(f.context)).supported,
    false,
  );
  await fs.unlink(hard);
  const elsewhere = path.join(f.dir, "elsewhere");
  await fs.mkdir(elsewhere);
  const modules = path.join(f.project.path, "node_modules");
  await fs.symlink(
    elsewhere,
    modules,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    (await f.tools.discoverDependencies(f.context)).reason,
    "linked_modules",
  );
  await fs.unlink(modules);
  const found = await f.tools.discoverDependencies(f.context);
  await assert.rejects(
    f.tools.prepareDependencies({
      ...f.context,
      dataDir: f.context.workspaceRoot,
      manifestHash: found.manifestHash,
      lockHash: found.lockHash,
    }),
    /outside the workspace/,
  );
});

test("runtime, builtin account configuration and private config changes invalidate approval", async (t) => {
  const f = await fixture(t);
  for (const file of [f.runtime.node, f.runtime.npmCli, f.runtime.shell]) {
    const op = await f.prepare(),
      before = await fs.readFile(file);
    await fs.appendFile(file, "changed");
    await assert.rejects(
      f.tools.verifyDependencies({ ...f.context, operation: op }),
      /configuration changed/,
    );
    await fs.writeFile(file, before);
  }
  const op = await f.prepare();
  await fs.writeFile(
    op.config.user,
    "//registry.npmjs.org/:_authToken=PRIVATE_TOKEN",
  );
  await assert.rejects(
    f.tools.verifyDependencies({ ...f.context, operation: op }),
    /Private npm configuration/,
  );
  await fs.writeFile(op.config.user, "");
  await fs.writeFile(
    path.join(f.runtime.npmRoot, "npmrc"),
    "//registry.npmjs.org/:_authToken=PRIVATE_TOKEN",
  );
  await assert.rejects(f.prepare(), (error) => {
    assert.doesNotMatch(error.message, /PRIVATE_TOKEN/);
    return /custom settings/.test(error.message);
  });
  await fs.writeFile(path.join(f.runtime.npmRoot, "npmrc"), "");
  await fs.writeFile(
    path.join(f.runtime.npmRoot, "package.json"),
    '{"name":"npm","version":"6.0.0"}',
  );
  await assert.rejects(f.prepare(), /7 or later/);
});

test("legacy lockfile v2 nested graph is validated and cannot smuggle another registry", async (t) => {
  const f = await fixture(t);
  f.lock.lockfileVersion = 2;
  f.lock.dependencies = {
    example: {
      ...locked(),
      requires: { child: "^1.0.0" },
      dependencies: { child: locked() },
    },
  };
  await f.write();
  assert.equal((await f.tools.discoverDependencies(f.context)).supported, true);
  f.lock.dependencies.example.dependencies.child.resolved =
    "git+ssh://example.invalid/repo";
  await f.write();
  assert.equal(
    (await f.tools.discoverDependencies(f.context)).supported,
    false,
  );
});

test("result verification requires exact saved terminal identity, real close and unchanged source", async (t) => {
  const f = await fixture(t),
    operation = await f.prepare();
  const task = {
    id: "task",
    kind: "project_dependencies",
    projectId: f.project.id,
    requestedBy: "desktop",
    approvalId: "approval",
    manifestHash: operation.manifestHash,
    lockHash: operation.lockHash,
    status: "completed",
    exitCode: 0,
  };
  const context = {
    ...f.context,
    operation,
    task,
    approvalId: "approval",
    processClosed: true,
  };
  assert.equal(
    (await f.tools.verifyDependencyResult(context)).verified,
    false,
    "success with no installed directory is not verified",
  );
  await fs.mkdir(path.join(f.project.path, "node_modules"));
  const receipt = await f.tools.verifyDependencyResult(context);
  assert.equal(receipt.verified, true);
  assert.equal(receipt.completionEligible, false);
  assert.equal(receipt.ignoreScripts, true);
  for (const patch of [
    { processClosed: false },
    { task: { ...task, status: "running" } },
    { task: { ...task, exitCode: 1 } },
    { task: { ...task, status: "interrupted" } },
  ])
    assert.equal(
      (await f.tools.verifyDependencyResult({ ...context, ...patch })).verified,
      false,
    );
  for (const patch of [
    { approvalId: "other" },
    { requestedBy: "phone" },
    { task: { ...task, kind: "project_check" } },
    { task: { ...task, lockHash: "wrong" } },
    { task: { ...task, manifestHash: "wrong" } },
  ])
    await assert.rejects(
      f.tools.verifyDependencyResult({ ...context, ...patch }),
      { status: 409 },
    );
  await fs.appendFile(path.join(f.project.path, "package-lock.json"), "\n");
  await assert.rejects(f.tools.verifyDependencyResult(context), /changed/);
});

test("dependency environment is an OS allowlist and does not inherit secrets, proxies or executables", () => {
  const source = {
    SystemRoot: "C:\\Windows",
    Path: "malicious",
    HOME: "private-profile",
    USERPROFILE: "private-profile",
    NODE_OPTIONS: "inject",
    NPM_TOKEN: "secret",
    OPENAI_API_KEY: "secret",
    CUSTOM_ACCOUNT_SECRET: "secret",
    HTTPS_PROXY: "secret",
    NODE_EXTRA_CA_CERTS: "private",
    npm_config_registry: "evil",
    LANG: "en_US.UTF-8",
  };
  const before = { ...source },
    runtime = { node: path.resolve("installed/node.exe") },
    config = {
      user: "empty-user",
      global: "empty-global",
      temp: "private-temp",
      cache: "private-cache",
    };
  const env = dependencyEnvironment(runtime, config, source);
  assert.deepEqual(source, before);
  assert.doesNotMatch(
    JSON.stringify(env),
    /malicious|private-profile|inject|secret|evil/,
  );
  assert.equal(env.SystemRoot, source.SystemRoot);
  assert.equal(env.PATH, path.dirname(runtime.node));
  assert.equal(env.TEMP, config.temp);
  assert.equal(env.npm_config_registry, "https://registry.npmjs.org/");
});

test("plain projects skip preparation explicitly and only missing-lock ordinary modules allow an unverified manual fallback", async (t) => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.project.path, "package-lock.json"));
  let found = await f.tools.discoverDependencies(f.context);
  assert.equal(found.reason, "missing_lockfile");
  assert.equal(found.preparationNeeded, true);
  assert.equal(found.manualDependenciesAvailable, false);
  await fs.mkdir(path.join(f.project.path, "node_modules"));
  found = await f.tools.discoverDependencies(f.context);
  assert.equal(found.reason, "missing_lockfile");
  assert.equal(found.supported, false);
  assert.equal(found.manualDependenciesAvailable, true);
  assert.equal(found.nodeModulesPresent, true);
  await fs.writeFile(
    path.join(f.project.path, "package-lock.json"),
    "malformed",
  );
  found = await f.tools.discoverDependencies(f.context);
  assert.equal(found.preparationNeeded, true);
  assert.equal(found.manualDependenciesAvailable, false);
  await fs.unlink(path.join(f.project.path, "package-lock.json"));
  await fs.writeFile(
    path.join(f.project.path, "package.json"),
    JSON.stringify({ name: "static", scripts: { build: "node build.cjs" } }),
  );
  found = await f.tools.discoverDependencies(f.context);
  assert.equal(found.reason, "no_dependencies");
  assert.equal(found.preparationNeeded, false);
  assert.equal(found.supported, false);
  assert.match(found.manifestHash, /^[a-f0-9]{64}$/);
  await fs.unlink(path.join(f.project.path, "package.json"));
  found = await f.tools.discoverDependencies(f.context);
  assert.equal(found.reason, "missing_manifest");
  assert.equal(found.preparationNeeded, false);
  await fs.writeFile(
    path.join(f.project.path, "package.json"),
    JSON.stringify({ workspaces: ["packages/*"] }),
  );
  found = await f.tools.discoverDependencies(f.context);
  assert.equal(found.reason, "unsupported_configuration");
  assert.equal(found.preparationNeeded, true);
  assert.equal(found.manualDependenciesAvailable, false);
});

test("verification closes the runtime-inspection race and does not recreate missing private configuration", async (t) => {
  const f = await fixture(t),
    operation = await f.prepare();
  const changed = createProjectDependencyTools({
    resolveRuntime: async () => {
      await fs.appendFile(path.join(f.project.path, "package-lock.json"), "\n");
      return f.runtime;
    },
  });
  await assert.rejects(
    changed.verifyDependencies({ ...f.context, operation }),
    /changed during dependency verification/,
  );
  await f.write();
  await fs.unlink(operation.config.global);
  await assert.rejects(f.tools.verifyDependencies({ ...f.context, operation }));
  assert.equal(await fs.stat(operation.config.global).catch(() => null), null);
});
