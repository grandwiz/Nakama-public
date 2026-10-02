import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  argumentsFor,
  assertClaudeProjectAccess,
  classifySubscriptionAuth,
  runProvider,
} from "../apps/host/providers.mjs";

const fable = {
  id: "claude",
  connectionType: "subscription",
  selectedModel: "claude-fable-5-1",
  effort: "max",
  usageCreditsDisabledConfirmed: true,
};
test("Fable requires the exact Max plan, confirmed billing switch and supported CLI before inference", () => {
  assert.doesNotThrow(() =>
    assertClaudeProjectAccess(
      fable,
      { subscriptionType: "max" },
      "2.1.284 (Claude Code)",
    ),
  );
  for (const subscriptionType of ["pro", "team", "enterprise", undefined])
    assert.throws(
      () => assertClaudeProjectAccess(fable, { subscriptionType }, "2.1.284"),
      /verified Max/,
    );
  for (const confirmed of [undefined, false, "true"])
    assert.throws(
      () =>
        assertClaudeProjectAccess(
          { ...fable, usageCreditsDisabledConfirmed: confirmed },
          { subscriptionType: "max" },
          "2.1.284",
        ),
      /confirmation/,
    );
  for (const version of ["unknown", "2.1.256", "1.9.999", "2.0.999"])
    assert.throws(
      () =>
        assertClaudeProjectAccess(fable, { subscriptionType: "max" }, version),
      /2.1.257/,
    );
});
test("Ultracode requests preserve exact Opus and expose restricted xhigh mapping without enabling native workflows", () => {
  const provider = {
    ...fable,
    selectedModel: "claude-opus-4-8",
    effort: "ultracode",
    usageCreditsDisabledConfirmed: false,
  };
  const args = argumentsFor(provider);
  assert.equal(args[args.indexOf("--model") + 1], "claude-opus-4-8");
  assert.equal(args[args.indexOf("--effort") + 1], "xhigh");
  assert.ok(args.includes("--safe-mode"));
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert.doesNotThrow(() => assertClaudeProjectAccess(provider, {}, "2.1.203"));
  assert.throws(
    () => assertClaudeProjectAccess(provider, {}, "2.1.202"),
    /2.1.203/,
  );
  assert.throws(
    () =>
      argumentsFor({
        id: "codex",
        connectionType: "subscription",
        effort: "ultracode",
      }),
    /Claude setting/,
  );
});
test("Auth classification retains only the plan needed for included-model checks, without identity details", () => {
  const result = classifySubscriptionAuth("claude", {
    code: 0,
    stdout: JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      subscriptionType: "max",
      email: "secret@example.test",
      orgId: "private-id",
    }),
  });
  assert.equal(result.subscriptionType, "max");
  assert.equal(result.status, "connected");
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.ok(!JSON.stringify(result).includes("private-id"));
});

async function fixture(version) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-claude-team-"));
  const executablePath = path.join(root, "fixture.mjs");
  await fs.writeFile(
    executablePath,
    `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(root, "calls.jsonl"))}, JSON.stringify(args)+'\\n');
if (args.includes('auth')) console.log(JSON.stringify({loggedIn:true, authMethod:'claude.ai', apiProvider:'firstParty',subscriptionType:'max'}));
else if(args.includes('--version')) console.log(${JSON.stringify(version)});
else { process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'result',result:'Fixture completed'}))); }
`,
  );
  return {
    root,
    provider: { ...fable, executablePath },
    calls: async () =>
      (await fs.readFile(path.join(root, "calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse),
    clean: async () => {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith("nakama-claude-team-"));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
test("Actual local preflight blocks Fable before model subprocess when billing confirmation or client version is missing", async () => {
  for (const [version, confirmed] of [
    ["2.1.256 (Claude Code)", true],
    ["2.1.284 (Claude Code)", false],
  ]) {
    const f = await fixture(version);
    try {
      await assert.rejects(
        runProvider(
          { ...f.provider, usageCreditsDisabledConfirmed: confirmed },
          {
            cwd: f.root,
            prompt: "fixture",
            onOutput: () => assert.fail("No model output allowed"),
            onComplete: () => assert.fail("No model completion allowed"),
          },
        ),
        { status: 409 },
      );
      const calls = await f.calls();
      assert.equal(calls.length, 2);
      assert.ok(calls[0].includes("auth"));
      assert.deepEqual(calls[1], ["--version"]);
    } finally {
      await f.clean();
    }
  }
});
test("Verified Fable preflight launches the exact fixture model once with restricted flags", async () => {
  const f = await fixture("2.1.284 (Claude Code)");
  try {
    let complete;
    const done = new Promise((resolve) => {
      complete = resolve;
    });
    await runProvider(f.provider, {
      cwd: f.root,
      prompt: "local fixture only",
      onOutput: () => {},
      onComplete: complete,
    });
    assert.equal((await done).code, 0);
    const calls = await f.calls();
    assert.equal(calls.length, 3);
    const args = calls[2];
    assert.equal(args[args.indexOf("--model") + 1], "claude-fable-5-1");
    assert.ok(args.includes("--safe-mode"));
    assert.ok(!args.includes("--fallback-model"));
  } finally {
    await f.clean();
  }
});
