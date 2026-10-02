import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  safeFile,
  projectRoot,
  within,
  redact,
  boundedJson,
  RateGate,
} from "../apps/host/security.mjs";
import { Store } from "../apps/host/store.mjs";
import { subscriptionEnv, argumentsFor } from "../apps/host/providers.mjs";

async function temporary(t) {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-security-"));
  t.after(async () => {
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-security-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("relative file access rejects traversal, Windows aliases and protected directories", async (t) => {
  const dir = await temporary(t);
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(path.join(dir, "src", "index.js"), "safe");
  assert.equal(
    await safeFile(dir, "src/index.js"),
    path.join(dir, "src", "index.js"),
  );
  assert.equal(
    await safeFile(dir, "future/nested.txt", { allowMissing: true }),
    path.join(dir, "future", "nested.txt"),
  );
  for (const file of [
    "../outside",
    "..\\outside",
    ".git/config",
    ".GIT/config",
    "node_modules/a",
    ".nakama-trash/a",
    "a:stream",
    "C:relative",
    "C:\\absolute",
    "CON.txt",
    "file.",
    "file ",
    "a\0b",
    "",
  ])
    await assert.rejects(
      safeFile(dir, file),
      (e) => e.status === 400 || e.status === 403,
      file,
    );
  assert.equal(await safeFile(dir, "", { allowRoot: true }), dir);
  assert.equal(within(dir, dir + "-sibling"), false);
});

test("symlinks and directory junctions cannot escape file/project containment", async (t) => {
  const dir = await temporary(t),
    root = path.join(dir, "workspace"),
    external = path.join(dir, "external");
  await fs.mkdir(root);
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "secret.txt"), "not in project");
  const link = path.join(root, "linked");
  await fs.symlink(
    external,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(safeFile(root, "linked/secret.txt"), { status: 403 });
  await assert.rejects(
    safeFile(root, "linked/new.txt", { allowMissing: true }),
    { status: 403 },
  );
  await assert.rejects(projectRoot(root, { path: link }), { status: 403 });
  await assert.rejects(projectRoot(root, { path: root }), { status: 403 });
});

test("hard-linked files cannot modify an outside-workspace inode", async (t) => {
  const dir = await temporary(t),
    project = path.join(dir, "project"),
    outside = path.join(dir, "outside.txt");
  await fs.mkdir(project);
  await fs.writeFile(outside, "keep");
  await fs.link(outside, path.join(project, "linked.txt"));
  await assert.rejects(safeFile(project, "linked.txt"), { status: 403 });
  assert.equal(await fs.readFile(outside, "utf8"), "keep");
});

test("store rolls back failed validation and failed persistence without breaking live references", async (t) => {
  const store = await new Store(await temporary(t)).init(),
    config = store.state.config,
    providers = store.state.providers,
    provider = providers[0];
  const before = await fs.readFile(store.file, "utf8");
  await assert.rejects(
    store.change((s) => {
      s.config.hostName = "partial";
      s.providers[0].selectedModel = "partial";
      s.providers = [];
      s.extra = true;
      throw new Error("invalid");
    }),
    /invalid/,
  );
  assert.equal(store.state.config, config);
  assert.equal(store.state.providers, providers);
  assert.equal(store.state.providers[0], provider);
  assert.notEqual(config.hostName, "partial");
  assert.equal(provider.selectedModel, "");
  assert.equal(store.state.extra, undefined);
  assert.equal(await fs.readFile(store.file, "utf8"), before);
  const save = store.save;
  store.save = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    store.change((s) => {
      s.config.hostName = "unsaved";
    }),
    /disk full/,
  );
  assert.notEqual(config.hostName, "unsaved");
  store.save = save;
  await store.change((s) => {
    s.config.hostName = "recovered";
  });
  assert.equal(
    JSON.parse(await fs.readFile(store.file, "utf8")).config.hostName,
    "recovered",
  );
});

test("restart marks running work and side effects interrupted without resuming", async (t) => {
  const dir = await temporary(t),
    store = await new Store(dir).init();
  await store.change((s) => {
    s.tasks.push({ id: "task", status: "running" });
    s.approvals.push({ id: "approval", status: "executing" });
  });
  const restored = await new Store(dir).init();
  assert.equal(restored.state.tasks[0].status, "interrupted");
  assert.equal(restored.state.approvals[0].status, "interrupted");
});

test("public state strips credential hashes, executables and private approval operations", async (t) => {
  const store = await new Store(await temporary(t)).init();
  store.state.devices.push({
    id: "d",
    name: "phone",
    tokenHash: "private hash",
  });
  store.state.providers[0].executablePath = "private path";
  store.state.approvals.push({
    id: "a",
    operation: { token: "private value" },
    description: "public",
  });
  const publicState = store.publicState(false),
    ownerState = store.publicState(true);
  for (const state of [publicState, ownerState]) {
    assert.equal(state.devices[0].tokenHash, undefined);
    assert.equal(state.providers[0].executablePath, undefined);
    assert.equal(state.approvals[0].operation, undefined);
    assert.equal(state.actions, undefined);
  }
  assert.equal(publicState.audit, undefined);
  assert.ok(ownerState.audit);
});

test("redaction and bounded structured results remove common credential formats", () => {
  const samples = [
    "sk-ant-12345678901234567890",
    "ghp_12345678901234567890",
    "github_pat_12345678901234567890",
    "AIza1234567890123456789012345",
    "ya29.12345678901234567890",
    "Bearer abcdefghijklmnopqrst",
    "ANTHROPIC_API_KEY=private-value",
    'token: "private-token"',
  ];
  for (const sample of samples) {
    const result = redact(sample);
    assert.ok(result.includes("[redacted]"), sample);
    assert.ok(!result.includes("12345678901234567890"));
  }
  assert.deepEqual(
    boundedJson({ text: "normal", nested: ["Bearer abcdefghijklmnopqrst"] }),
    { text: "normal", nested: ["Bearer [redacted]"] },
  );
  assert.throws(() => boundedJson({ large: "x".repeat(262144) }), {
    status: 400,
  });
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => boundedJson(cycle), { status: 400 });
});

test("subscription child environment excludes alternate paid credentials without mutating parent", () => {
  const names = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_ACCESS_TOKEN",
    "OPENAI_IDENTITY_TOKEN_FILE",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "AWS_SECRET_ACCESS_KEY",
    "ELECTRON_RUN_AS_NODE",
  ];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    for (const name of names) process.env[name] = "test-secret";
    const env = subscriptionEnv();
    for (const name of names) {
      assert.equal(env[name], undefined, name);
      assert.equal(process.env[name], "test-secret");
    }
    // Windows process.env resolves names without case, but the copied child
    // object retains the actual key spelling (commonly Path rather than PATH).
    const pathName = Object.keys(process.env).find(
      (name) => name.toUpperCase() === "PATH",
    );
    assert.ok(pathName);
    assert.equal(env[pathName], process.env[pathName]);
  } finally {
    for (const name of names)
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
  }
});

test("provider arguments fail closed for paid mode, invalid effort and model injection", () => {
  const provider = {
    id: "codex",
    connectionType: "subscription",
    effort: "high",
    selectedModel: "approved-model",
  };
  assert.ok(argumentsFor(provider).includes("read-only"));
  assert.throws(() => argumentsFor({ ...provider, connectionType: "api" }), {
    status: 409,
  });
  assert.throws(
    () => argumentsFor({ ...provider, selectedModel: "model --unsafe" }),
    { status: 400 },
  );
  assert.throws(() => argumentsFor({ ...provider, effort: "anything" }), {
    status: 400,
  });
  assert.throws(() => argumentsFor({ ...provider, id: "unknown" }), {
    status: 400,
  });
});

test("rate limiting counts attempts independently per principal/IP key", () => {
  const gate = new RateGate();
  assert.equal(gate.allow("first", 2), true);
  assert.equal(gate.allow("first", 2), true);
  assert.equal(gate.allow("first", 2), false);
  assert.equal(gate.allow("second", 2), true);
});
