import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  argumentsFor,
  classifySubscriptionAuth,
  probeProvider,
  runProvider,
  subscriptionEnv,
} from "../apps/host/providers.mjs";

const claudeStatus = (overrides = {}) => ({
  code: 0,
  stdout: JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    subscriptionType: "max",
    ...overrides,
  }),
});

test("Codex accepts only the exact successful ChatGPT login status", () => {
  assert.equal(
    classifySubscriptionAuth("codex", {
      code: 0,
      stderr: "Logged in using ChatGPT\n",
    }).status,
    "connected",
  );
  for (const response of [
    { code: 0, stderr: "Logged in using an API key - sk-example-never-return" },
    { code: 0, stdout: "Logged in using workload identity" },
    { code: 0, stdout: "Logged in" },
    { code: 1, stdout: "Logged in using ChatGPT" },
    { code: 0, stdout: "Logged in using ChatGPT\nAPI key selected" },
  ]) {
    const result = classifySubscriptionAuth("codex", response);
    assert.notEqual(result.status, "connected");
    assert.ok(!JSON.stringify(result).includes("sk-example"));
  }
  assert.equal(
    classifySubscriptionAuth("codex", { code: 1, stderr: "Not logged in" })
      .status,
    "needs_login",
  );
});

test("Claude rejects saved Console keys even when authMethod says claude.ai", () => {
  assert.equal(
    classifySubscriptionAuth("claude", claudeStatus()).status,
    "connected",
  );
  for (const subscriptionType of ["pro", "max", "team", "enterprise"]) {
    assert.equal(
      classifySubscriptionAuth("claude", claudeStatus({ subscriptionType }))
        .status,
      "connected",
    );
  }
  const api = classifySubscriptionAuth(
    "claude",
    claudeStatus({ apiKeySource: "/login managed key" }),
  );
  assert.equal(api.status, "api_configured");
  for (const apiProvider of [
    "bedrock",
    "vertex",
    "foundry",
    "anthropicAws",
    "anthropicGoogleCloud",
    "mantle",
    "gateway",
  ]) {
    assert.equal(
      classifySubscriptionAuth("claude", claudeStatus({ apiProvider })).status,
      "api_configured",
    );
  }
});

test("Claude unknown, unsigned, expired/nonzero and token-only modes fail closed without PII", () => {
  for (const response of [
    claudeStatus({ loggedIn: false }),
    claudeStatus({ authMethod: "oauth_token" }),
    claudeStatus({ subscriptionType: null }),
    claudeStatus({ subscriptionType: "console" }),
    claudeStatus({ apiProvider: undefined }),
    claudeStatus({ forcedLoginMethod: "console" }),
    { ...claudeStatus(), code: 1 },
    { code: 0, stdout: "not JSON" },
    { code: 0, stdout: "null" },
    { code: 0, stdout: "[]" },
  ])
    assert.notEqual(
      classifySubscriptionAuth("claude", response).status,
      "connected",
    );
  const response = classifySubscriptionAuth(
    "claude",
    claudeStatus({
      email: "private@example.test",
      orgId: "private-org",
      apiKeySource: "secret-key-source",
    }),
  );
  assert.ok(!JSON.stringify(response).includes("private"));
  assert.ok(!JSON.stringify(response).includes("secret-key-source"));
});

test("subscription environment removes API, gateway, federation, host and cloud routes without modifying its source", () => {
  const names = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_PROFILE",
    "ANTHROPIC_FEDERATION_RULE_ID",
    "ANTHROPIC_ORGANIZATION_ID",
    "ANTHROPIC_CONFIG_DIR",
    "ANTHROPIC_CUSTOM_HEADERS",
    "OPENAI_FEDERATION_RULE_ID",
    "OPENAI_IDENTITY_TOKEN_FILE",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_HOST_CREDS_FILE",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_MANTLE",
    "GOOGLE_CLOUD_ACCESS_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_GEMINI_BASE_URL",
    "GEMINI_API_KEY",
    "AWS_PROFILE",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AZURE_OPENAI_API_KEY",
    "NODE_OPTIONS",
    "NODE_PATH",
    "CLOUD_SHELL",
  ];
  const source = {
    PATH: "path",
    CODEX_HOME: "codex-account",
    CLAUDE_CONFIG_DIR: "claude-account",
    ...Object.fromEntries(names.map((name) => [name, "test-value"])),
  };
  const clean = subscriptionEnv(source);
  for (const name of names) {
    assert.equal(clean[name], undefined, name);
    assert.equal(source[name], "test-value");
  }
  assert.equal(clean.PATH, "path");
  assert.equal(clean.CODEX_HOME, "codex-account");
  assert.equal(clean.CLAUDE_CONFIG_DIR, "claude-account");
});

test("inference flags pin Codex ChatGPT and omit Claude user/project auth settings", () => {
  const codex = argumentsFor({ id: "codex", connectionType: "subscription" });
  assert.ok(codex.includes('forced_login_method="chatgpt"'));
  assert.ok(codex.includes('model_provider="openai"'));
  assert.ok(codex.includes("--ignore-user-config"));
  const claude = argumentsFor({ id: "claude", connectionType: "subscription" });
  assert.equal(claude[claude.indexOf("--setting-sources") + 1], "");
  assert.deepEqual(JSON.parse(claude[claude.indexOf("--settings") + 1]), {
    forceLoginMethod: "claudeai",
  });
});

async function fixture(id, status, unicodeOutput = null) {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nakama-provider-auth-"),
  );
  const executablePath = path.join(folder, "official-fixture.mjs");
  const events = path.join(folder, "events.jsonl");
  await fs.writeFile(
    executablePath,
    `
import fs from 'node:fs';
const args=process.argv.slice(2);
const auth=args.includes('status');
fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({auth,args,cwd:process.cwd(),apiEnvPresent:Boolean(process.env.ANTHROPIC_API_KEY||process.env.OPENAI_API_KEY)})+'\\n');
if(auth){ const status=${JSON.stringify(status)};if(status.delayMs)await new Promise(resolve=>setTimeout(resolve,status.delayMs));process.stdout.write(status.stdout||'');process.stderr.write(status.stderr||'');process.exit(status.code??0); }
process.stdin.resume();process.stdin.on('end',async()=>{
  const unicode=${JSON.stringify(unicodeOutput)};
  if(!unicode){console.log(JSON.stringify({type:'result',result:'fixture completed'}));return;}
  // Emit each non-ASCII byte separately with a delay, so a multibyte codepoint
  // is deliberately divided between data events rather than merely lines.
  const split=async(stream,value)=>{let ascii=[];for(const byte of Buffer.from(value,'utf8')){if(byte<128){ascii.push(byte);continue;}if(ascii.length){stream.write(Buffer.from(ascii));ascii=[];}stream.write(Buffer.from([byte]));await new Promise(resolve=>setTimeout(resolve,10));}if(ascii.length)stream.write(Buffer.from(ascii));};
  await split(process.stderr,unicode.progress);
  await split(process.stdout,JSON.stringify({type:'result',result:unicode.text})+'\\n');
});
`,
  );
  return {
    folder,
    provider: { id, executablePath, connectionType: "subscription" },
    events,
    readEvents: async () => {
      try {
        return (await fs.readFile(events, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    clean: () => {
      const resolved = path.resolve(folder);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.match(path.basename(resolved), /^nakama-provider-auth-/);
      return fs.rm(resolved, { recursive: true, force: true });
    },
  };
}

test("blocked persisted API key cannot reach the model process", async () => {
  const f = await fixture("codex", {
    code: 0,
    stderr: "Logged in using an API key - do-not-expose",
  });
  try {
    const phases = [];
    const probe = await probeProvider(f.provider);
    assert.equal(probe.status, "api_configured");
    await assert.rejects(
      runProvider(f.provider, {
        cwd: f.folder,
        prompt: "must not run",
        onOutput: () => assert.fail("no output expected"),
        onComplete: () => assert.fail("no generation expected"),
        onPhase: (phase) => phases.push(phase),
      }),
      { status: 409 },
    );
    const events = await f.readEvents();
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.auth));
    assert.deepEqual(phases, ["checking_account"]);
  } finally {
    await f.clean();
  }
});

test("verified subscription is rechecked in the execution folder before inference starts", async () => {
  const f = await fixture("claude", claudeStatus());
  try {
    const phases = [];
    let finish;
    const completed = new Promise((resolve) => {
      finish = resolve;
    });
    await runProvider(f.provider, {
      cwd: f.folder,
      act: { request: "local fixture only" },
      prompt: "local fixture only",
      onOutput: () => {},
      onComplete: finish,
      onPhase: (phase) => phases.push(phase),
    });
    const result = await completed;
    assert.equal(result.code, 0);
    assert.equal(result.text, "fixture completed");
    assert.deepEqual(phases, [
      "checking_account",
      "starting_model",
      "answering",
    ]);
    const events = await f.readEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].auth, true);
    assert.equal(events[1].auth, false);
    assert.ok(events.every((event) => event.cwd === f.folder));
    assert.ok(events.every((event) => event.args.includes("--safe-mode")));
    assert.equal(events[1].args[events[1].args.indexOf("--tools") + 1], "");
    assert.ok(
      events.every(
        (event) =>
          event.args[event.args.indexOf("--setting-sources") + 1] === "",
      ),
    );
  } finally {
    await f.clean();
  }
});

test("split UTF-8 provider output preserves exact Unicode JSON results and stderr progress", async () => {
  const text =
    '```nakama-files\n{"summary":"Café 🦊 日本","files":[{"path":"greeting.txt","content":"Hello 👋 — café"}]}\n```';
  const progress = "Progress: café 🦊 日本\n";
  const f = await fixture(
    "codex",
    { code: 0, stderr: "Logged in using ChatGPT" },
    { text, progress },
  );
  let run;
  try {
    let finish;
    const completed = new Promise((resolve) => {
        finish = resolve;
      }),
      output = [];
    run = await runProvider(f.provider, {
      cwd: f.folder,
      prompt: "Local Unicode fixture",
      onOutput: (chunk) => output.push(chunk),
      onComplete: finish,
    });
    const result = await completed;
    assert.equal(result.code, 0);
    assert.equal(result.text, text);
    assert.equal(output.join(""), progress + text + "\n");
    assert.equal(output.join("").includes("\ufffd"), false);
    const events = await f.readEvents();
    assert.deepEqual(
      events.map((event) => event.auth),
      [true, false],
    );
  } finally {
    run?.stop();
    await f.clean();
  }
});

test("a removed provider cannot probe or execute even with a configured executable", async () => {
  const f = await fixture("gemini", { code: 0, stdout: "oauth-personal" });
  try {
    await assert.rejects(probeProvider(f.provider), { status: 400 });
    assert.throws(
      () =>
        classifySubscriptionAuth("gemini", {
          code: 0,
          stdout: "oauth-personal",
        }),
      { status: 400 },
    );
    await assert.rejects(
      runProvider(f.provider, {
        cwd: f.folder,
        prompt: "never execute",
        onOutput: () => {},
        onComplete: () => {},
      }),
      { status: 400 },
    );
    assert.deepEqual(await f.readEvents(), []);
  } finally {
    await f.clean();
  }
});

test("stop during authentication prevents any later inference process", async () => {
  const f = await fixture("codex", {
    code: 0,
    stderr: "Logged in using ChatGPT",
    delayMs: 350,
  });
  const controller = new AbortController();
  try {
    const launch = runProvider(f.provider, {
      cwd: f.folder,
      prompt: "must never run",
      signal: controller.signal,
      onOutput: () => assert.fail("no model output"),
      onComplete: () => assert.fail("no model completion"),
    });
    const rejected = assert.rejects(launch, { status: 499 });
    for (
      let attempt = 0;
      attempt < 100 && (await f.readEvents()).length === 0;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      (await f.readEvents()).length,
      1,
      "the auth fixture should be running",
    );
    controller.abort();
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 450));
    const events = await f.readEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].auth, true);
  } finally {
    controller.abort();
    await f.clean();
  }
});

test("a task stopped before launch starts neither authentication nor inference", async () => {
  const f = await fixture("codex", {
    code: 0,
    stderr: "Logged in using ChatGPT",
  });
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      runProvider(f.provider, {
        cwd: f.folder,
        prompt: "never run",
        signal: controller.signal,
        onOutput: () => {},
        onComplete: () => {},
      }),
      { status: 499 },
    );
    assert.deepEqual(await f.readEvents(), []);
  } finally {
    await f.clean();
  }
});
