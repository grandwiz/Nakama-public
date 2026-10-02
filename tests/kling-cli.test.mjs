import test from "node:test";
import assert from "node:assert/strict";
import {
  KlingCli,
  KLING_PACKAGE,
  normalizeCatalogue,
  normalizeAccount,
  normalizeTask,
  validateVideoRequest,
  klingEnvironment,
} from "../apps/host/kling-cli.mjs";

const who = () => ({
  user_id: "owner-fixture",
  available_models: {
    text_to_video: [
      {
        model: "fixture-video",
        alias: "Fixture video",
        arguments: [
          { name: "prompt", required: true },
          {
            name: "duration",
            required: true,
            default: "5",
            allowed_values: ["5", "10"],
          },
          {
            name: "enable_audio",
            default: "false",
            allowed_values: ["false", "true"],
          },
          { name: "negative_prompt" },
        ],
      },
    ],
  },
});
const tools = () => ({
  tools: [
    {
      name: "text_to_video",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string" },
          arguments: { type: "array", items: { type: "object" } },
          rationale: { type: "string" },
        },
        required: ["model", "arguments"],
      },
    },
  ],
});
const catalogue = () => normalizeCatalogue(who(), tools());
const reply = (body) => ({
  code: 0,
  stdout: JSON.stringify({ ok: true, status: 200, body }),
});
const input = (extra = {}) => ({
  prompt: "A wave rises; the camera tracks it; foam settles.",
  model: "fixture-video",
  parameters: {},
  ...extra,
});

test("pinned Global package and live schema are preserved without identity disclosure", () => {
  assert.equal(KLING_PACKAGE, "@klingai/cli-global@0.2.0");
  const result = catalogue();
  assert.equal(result.models[0].id, "fixture-video");
  assert.deepEqual(result.models[0].defaults, {
    duration: "5",
    enable_audio: "false",
  });
  assert.match(result.accountId, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes("owner-fixture"));
});

test("discovery uses who_am_i then tool_list and does not submit or expose raw account data", async () => {
  const calls = [];
  const cli = new KlingCli({
    run: async (args) => {
      calls.push(args);
      return reply(
        args[0] === "who_am_i"
          ? { ...who(), access_token: "private-fixture" }
          : tools(),
      );
    },
  });
  const result = await cli.discover();
  assert.deepEqual(
    calls.map((v) => v[0]),
    ["who_am_i", "tool_list"],
  );
  assert.ok(
    calls.every(
      (v) =>
        v.slice(-5).join(" ") ===
        "--skill-name kling-ai-cli --skill-version 1.0.5 --quiet",
    ),
  );
  assert.ok(!JSON.stringify(result).includes("private-fixture"));
});

test("default parameters use provider values and overrides must match the model declaration", () => {
  assert.deepEqual(validateVideoRequest(input(), catalogue()).parameters, {
    duration: "5",
    enable_audio: "false",
  });
  assert.equal(
    validateVideoRequest(input({ parameters: { duration: 10 } }), catalogue())
      .parameters.duration,
    "10",
  );
  for (const request of [
    input({ model: "invented" }),
    input({ parameters: { duration: 6 } }),
    input({ parameters: { resolution: "4k" } }),
    input({ parameters: { poll: 20 } }),
    input({ parameters: { negative_prompt: { bad: true } } }),
    input({ prompt: "--model=other" }),
    input({ projectId: "../secret" }),
    { ...input(), apiKey: "unwanted" },
  ])
    assert.throws(() => validateVideoRequest(request, catalogue()));
});

test("Windows prompts are canonicalised before review, and option-like prompts and unsafe defaults are rejected", () => {
  const prepared = validateVideoRequest(
    input({ prompt: "Opening scene.\r\nCamera moves.\n\tEnding scene." }),
    catalogue(),
  );
  assert.equal(prepared.prompt, "Opening scene. Camera moves. Ending scene.");
  for (const prompt of ["-h", "-q", "-v", "--help", "line\u000bsecond"])
    assert.throws(() => validateVideoRequest(input({ prompt }), catalogue()));
  const raw = who();
  raw.available_models.text_to_video[0].arguments.push({
    name: "bad_default",
    default: "line\nsecond",
  });
  assert.throws(() => normalizeCatalogue(raw, tools()), /no supported/);
});

test("required parameters without defaults, invalid schemas and input-dependent models fail closed", () => {
  const raw = who();
  raw.available_models.text_to_video[0].arguments.push({
    name: "duration_extra",
    required: true,
  });
  assert.throws(
    () => validateVideoRequest(input(), normalizeCatalogue(raw, tools())),
    /requires duration_extra/,
  );
  for (const change of [
    (v) =>
      v.available_models.text_to_video[0].arguments.push({ name: "model" }),
    (v) =>
      (v.available_models.text_to_video[0].inputs = [
        { name: "first_frame", required: true },
      ]),
    (v) => (v.available_models.text_to_video[0].arguments[1].default = "30"),
  ]) {
    const bad = who();
    change(bad);
    assert.throws(() => normalizeCatalogue(bad, tools()));
  }
  assert.throws(() =>
    normalizeCatalogue(who(), {
      tools: [{ name: "text_to_video", inputSchema: { type: "object" } }],
    }),
  );
  const limited = tools();
  limited.tools[0].inputSchema.properties.model.enum = ["other"];
  assert.throws(() => normalizeCatalogue(who(), limited));
});

test("one submit checks credits immediately and passes inert arguments to the runner", async () => {
  const calls = [],
    boundaries = [];
  const cli = new KlingCli({
    run: async (args, options) => {
      calls.push(args);
      if (args[0] === "account") return reply({ available_credits: 50 });
      options.beforeSpawn?.();
      return reply({ generation_id: "task_123", status: "queued" });
    },
  });
  const prompt = 'A flag says "hello"; $(never_run) & powershell';
  const result = await cli.submit(
    input({ prompt, parameters: { negative_prompt: "--model=evil & exit" } }),
    catalogue(),
    { beforeSubmit: () => boundaries.push("guard") },
  );
  assert.deepEqual(
    calls.map((v) => v[0]),
    ["account", "text_to_video"],
  );
  assert.deepEqual(boundaries, ["guard"]);
  assert.ok(calls[1].includes(prompt));
  assert.ok(calls[1].includes("--negative_prompt=--model=evil & exit"));
  assert.deepEqual(
    calls[1].slice(calls[1].indexOf("--poll"), calls[1].indexOf("--poll") + 2),
    ["--poll", "0"],
  );
  assert.equal(result.generationId, "task_123");
});

test("unknown or zero credits stop before the generation boundary", async () => {
  for (const body of [
    { availableCredits: 0 },
    { availableCredits: -5 },
    {},
    { availableCredits: "unknown" },
  ]) {
    const calls = [];
    const cli = new KlingCli({
      run: async (args) => {
        calls.push(args[0]);
        return reply(body);
      },
    });
    await assert.rejects(
      cli.submit(input(), catalogue(), {
        beforeSubmit: () => assert.fail("must not cross boundary"),
      }),
      /credits/,
    );
    assert.deepEqual(calls, ["account"]);
  }
});

test("changed approval policy can stop generation at the runner boundary", async () => {
  let submissions = 0;
  const cli = new KlingCli({
    run: async (args, options) => {
      if (args[0] === "account") return reply({ availableCredits: 100 });
      options.beforeSpawn?.();
      submissions++;
      return reply({ generationId: "never" });
    },
  });
  await assert.rejects(
    cli.submit(input(), catalogue(), {
      beforeSubmit: () => {
        throw new Error("Permission revoked");
      },
    }),
    /revoked/,
  );
  assert.equal(submissions, 0);
});

test("ambiguous submission failures never retry and never expose CLI diagnostics", async () => {
  const calls = [];
  const cli = new KlingCli({
    run: async (args, options) => {
      calls.push(args[0]);
      if (args[0] === "account") return reply({ availableCredits: 50 });
      options.beforeSpawn?.();
      return {
        code: 1,
        stdout: "access_token=secret-fixture",
        stderr: "private-data",
      };
    },
  });
  await assert.rejects(
    cli.submit(input(), catalogue()),
    (error) =>
      !error.message.includes("secret-fixture") &&
      /uncertain/.test(error.message),
  );
  assert.deepEqual(calls, ["account", "text_to_video"]);
});

test("task normalization preserves indexes, primary URLs and credits, omitting secret fields", () => {
  const result = normalizeTask(
    {
      generation_id: "one",
      status: "SUCCEEDED",
      credits_consumed: "8",
      token: "never-expose",
      works: [
        { url: "file:///private" },
        {
          url: "https://cdn.example/video.mp4",
          content_type: "video/mp4",
          url_without_watermark: "https://cdn.example/paid.mp4",
        },
      ],
    },
    "one",
  );
  assert.equal(result.terminal, true);
  assert.equal(result.creditsConsumed, 8);
  assert.deepEqual(result.works, [
    {
      index: 1,
      url: "https://cdn.example/video.mp4",
      contentType: "video/mp4",
    },
  ]);
  assert.ok(!JSON.stringify(result).includes("never-expose"));
  assert.throws(
    () => normalizeTask({ generationId: "other", status: "success" }, "one"),
    /different task/,
  );
  assert.throws(
    () =>
      normalizeTask(
        {
          generations: [
            { generationId: "other", result: { status: "success" } },
          ],
        },
        "one",
      ),
    /different task/,
  );
  assert.equal(
    normalizeTask({ status: "new_provider_status" }, "one").terminal,
    false,
  );
  assert.equal(normalizeTask({}).generationId, null);
});

test("query refreshes the known ID once and blocks argument injection", async () => {
  const calls = [];
  const cli = new KlingCli({
    run: async (args) => {
      calls.push(args);
      return reply({ status: "running" });
    },
  });
  assert.equal((await cli.query("task-123")).generationId, "task-123");
  assert.equal(calls.length, 1);
  await assert.rejects(cli.query("--model=other"));
  assert.equal(calls.length, 1);
});

test("terminal status aliases declared by the pinned CLI are recognised", () => {
  for (const status of [
    "succeed",
    "succeeded",
    "success",
    "completed",
    "partial_completed",
  ]) {
    const task = normalizeTask(
      { generation_id: "fixture", status, works: [] },
      "fixture",
    );
    assert.equal(task.terminal, true, status);
    assert.equal(task.status, status);
  }
  for (const status of [
    "submitted",
    "pending",
    "queuing",
    "queueing",
    "processing",
    "running",
  ])
    assert.equal(normalizeTask({ status }, "fixture").terminal, false, status);
});

test("account fields and CLI environment do not expose credentials or unrelated MCP tokens", () => {
  assert.equal(
    normalizeAccount({
      available_points: "15",
      membership_type: "Free",
      token: "hidden",
    }).availableCredits,
    15,
  );
  assert.equal(normalizeAccount({ credits: {} }).availableCredits, null);
  const env = klingEnvironment({
    PATH: "safe",
    NAKAMA_KLING_TOKEN: "secret",
    NODE_OPTIONS: "--require bad",
    KLING_BASE_URL: "https://evil.invalid",
    KLING_HOME: "saved-login-location",
    npm_config_registry: "https://evil.invalid",
  });
  assert.equal(env.KLING_HOME, "saved-login-location");
  assert.equal(env.NAKAMA_KLING_TOKEN, undefined);
  assert.equal(env.KLING_BASE_URL, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.npm_config_registry, undefined);
});
