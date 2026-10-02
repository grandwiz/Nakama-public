import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCodexUsage,
  readCodexUsage,
  createProviderUsageReader,
} from "../apps/host/provider-usage.mjs";

const time = Date.parse("2026-09-29T18:00:00Z");
const now = () => time;
const provider = {
  id: "codex",
  connectionType: "subscription",
  status: "connected",
};
const quota = {
  rateLimits: {
    primary: {
      usedPercent: 24,
      windowDurationMins: 300,
      resetsAt: (time + 3600000) / 1000,
    },
    secondary: { usedPercent: 63.5, windowDurationMins: 10080, resetsAt: null },
  },
};
function fixture({
  account = { type: "chatgpt", email: "private@example.com" },
  result = quota,
  fail,
} = {}) {
  const calls = [];
  let closed = 0;
  const client = {
    async initialize() {
      calls.push(["initialize"]);
      if (fail === "initialize") throw new Error("SECRET-initialize");
    },
    async request(method, params) {
      calls.push([method, params]);
      if (method === fail) throw new Error("SECRET-provider-error");
      return method === "account/read" ? { account } : result;
    },
    close() {
      closed++;
    },
  };
  return {
    calls,
    options: {
      now,
      locate: async () => "fixture-codex.exe",
      createClient: () => client,
    },
    get closed() {
      return closed;
    },
  };
}

test("quota windows prefer multi-bucket data, clamp percentages and exclude null or invalid usage", () => {
  const windows = normalizeCodexUsage({
    ...quota,
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: -20, windowDurationMins: 60, resetsAt: 0 },
        secondary: {
          usedPercent: 120,
          windowDurationMins: 1440,
          resetsAt: NaN,
        },
      },
      other: {
        limitName: "Code review",
        primary: {
          usedPercent: 25.5,
          windowDurationMins: 15,
          resetsAt: (time + 60000) / 1000,
        },
      },
      empty: {
        primary: { usedPercent: null },
        secondary: { usedPercent: "17" },
      },
      malformed: {
        primary: { usedPercent: Infinity },
        secondary: { usedPercent: NaN },
      },
    },
  });
  assert.deepEqual(
    windows.map((item) => item.remainingPercent),
    [100, 0, 74.5],
  );
  assert.equal(windows[0].label, "Codex · 1-hour allowance");
  assert.equal(windows[1].label, "Codex · 1-day allowance");
  assert.equal(windows[0].resetsAt, null);
  assert.equal(windows[2].resetsAt, "2026-09-29T18:01:00.000Z");
  assert.deepEqual(
    normalizeCodexUsage({ ...quota, rateLimitsByLimitId: {} }),
    [],
  );
  for (const invalid of [
    null,
    false,
    [],
    { rateLimits: null },
    { rateLimits: [] },
  ])
    assert.deepEqual(normalizeCodexUsage(invalid), []);
});

test("legacy windows retain expired timestamps and do not guess a reset or missing duration", () => {
  const windows = normalizeCodexUsage({
    rateLimits: {
      primary: { usedPercent: 100, resetsAt: 1 },
      secondary: { usedPercent: 12, windowDurationMins: -5, resetsAt: 1e30 },
    },
  });
  assert.equal(windows[0].remainingPercent, 0);
  assert.equal(windows[0].resetsAt, "1970-01-01T00:00:01.000Z");
  assert.equal(windows[0].label, "Codex · Primary allowance");
  assert.equal(windows[1].resetsAt, null);
  assert.equal(windows[1].label, "Codex · Secondary allowance");
});

test("usage only reads a verified ChatGPT account and closes its metadata client", async () => {
  const f = fixture();
  const value = await readCodexUsage(provider, f.options);
  assert.equal(value.status, "available");
  assert.equal(value.checkedAt, new Date(time).toISOString());
  assert.equal(value.windows[1].remainingPercent, 36.5);
  assert.deepEqual(f.calls, [
    ["initialize"],
    ["account/read", { refreshToken: false }],
    ["account/rateLimits/read", undefined],
  ]);
  assert.equal(f.closed, 1);
  assert.equal(JSON.stringify(value).includes("private@example.com"), false);
});

test("API keys, Bedrock, absent and unrecognised account types never request quotas", async () => {
  for (const account of [
    null,
    { type: "apiKey" },
    { type: "amazonBedrock" },
    { type: "chatgptAuthTokens" },
    { type: "new-type" },
  ]) {
    const f = fixture({ account });
    const result = await readCodexUsage(provider, f.options);
    assert.equal(result.status, "unavailable");
    assert.equal(result.windows.length, 0);
    assert.equal(
      f.calls.some(([method]) => method === "account/rateLimits/read"),
      false,
    );
    assert.equal(f.closed, 1);
  }
});

test("missing install or subscription mode cannot launch a metadata process", async () => {
  let launches = 0;
  const options = {
    now,
    locate: async () => null,
    createClient: () => {
      launches++;
    },
  };
  assert.equal((await readCodexUsage(provider, options)).status, "unavailable");
  assert.equal(
    (await readCodexUsage({ ...provider, connectionType: "api" }, options))
      .status,
    "unavailable",
  );
  assert.equal(
    (await readCodexUsage(undefined, options)).status,
    "unavailable",
  );
  assert.equal(launches, 0);
});

test("provider failures are generic and empty quotas are unavailable, never zero", async () => {
  for (const fail of [
    "initialize",
    "account/read",
    "account/rateLimits/read",
  ]) {
    const f = fixture({ fail });
    const result = await readCodexUsage(provider, f.options);
    assert.equal(result.status, "error");
    assert.deepEqual(result.windows, []);
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
    assert.equal(f.closed, 1);
  }
  const f = fixture({ result: { rateLimits: null } });
  assert.equal(
    (await readCodexUsage(provider, f.options)).status,
    "unavailable",
  );
});

test("overall time limit closes stalled clients and never launches after a late lookup", async () => {
  let closed = 0;
  const result = await readCodexUsage(provider, {
    now,
    timeoutMs: 10,
    locate: async () => "fixture-codex.exe",
    createClient: () => ({
      initialize: () => new Promise(() => {}),
      close: () => {
        closed++;
      },
    }),
  });
  assert.equal(result.status, "error");
  assert.equal(closed, 1);
  let finishLookup;
  let launched = false;
  const timeout = readCodexUsage(provider, {
    now,
    timeoutMs: 10,
    locate: () =>
      new Promise((resolve) => {
        finishLookup = resolve;
      }),
    createClient: () => {
      launched = true;
    },
  });
  assert.equal((await timeout).status, "error");
  finishLookup("late.exe");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launched, false);
});

test("explicit snapshots share one in-flight read and cache the original timestamp without polling", async () => {
  let at = time;
  let count = 0;
  let complete;
  const reader = createProviderUsageReader({
    now: () => at,
    readCodex: async () => {
      count++;
      await new Promise((resolve) => {
        complete = resolve;
      });
      return {
        id: "codex",
        status: "available",
        windows: normalizeCodexUsage(quota),
      };
    },
  });
  const first = reader.read([provider]);
  const concurrent = reader.read([provider]);
  assert.equal(count, 1);
  complete();
  const initial = await first;
  assert.deepEqual(await concurrent, initial);
  assert.deepEqual(
    initial.providers.map((item) => item.id),
    ["codex", "claude"],
  );
  assert.equal(initial.providers[1].checkedAt, null);
  assert.equal(initial.providers[1].status, "unavailable");
  initial.providers[0].windows[0].remainingPercent = -100;
  at += 10000;
  const cached = await reader.read([provider]);
  assert.equal(count, 1);
  assert.equal(cached.checkedAt, new Date(time).toISOString());
  assert.equal(cached.providers[0].windows[0].remainingPercent, 76);
  at += 30000;
  const refreshed = reader.read([provider]);
  assert.equal(count, 2);
  complete();
  assert.equal((await refreshed).checkedAt, new Date(at).toISOString());
});

test("expired cache failure removes old percentages, and configuration changes invalidate a snapshot", async () => {
  let at = time;
  let count = 0;
  const reader = createProviderUsageReader({
    now: () => at,
    readCodex: async () => {
      if (++count > 1) throw new Error("PRIVATE");
      return {
        id: "codex",
        status: "available",
        windows: normalizeCodexUsage(quota),
      };
    },
  });
  await reader.read([provider]);
  at += 31000;
  const failed = await reader.read([provider]);
  assert.equal(failed.providers[0].status, "error");
  assert.deepEqual(failed.providers[0].windows, []);
  assert.equal(JSON.stringify(failed).includes("PRIVATE"), false);
  await reader.read([{ ...provider, executablePath: "different.exe" }]);
  assert.equal(count, 3);
});
