import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeClaudeUsage,
  readClaudeUsage,
} from "../apps/host/claude-usage.mjs";
import { createProviderUsageReader } from "../apps/host/provider-usage.mjs";
const at = Date.parse("2026-10-03T08:00:00Z"),
  now = () => at;
const provider = {
  id: "claude",
  connectionType: "subscription",
  status: "connected",
};
const auth = {
  accessToken: "fixture-token-do-not-expose",
  expiresAt: at + 60000,
  scopes: ["user:profile", "user:inference"],
  subscriptionType: "max",
  refreshToken: "NEVER_USE_REFRESH",
};
const payload = {
  five_hour: { utilization: 21, resets_at: "2026-10-03T13:00:00Z" },
  seven_day: { utilization: 43, resets_at: null },
  seven_day_sonnet: { utilization: 5, resets_at: "invalid" },
  extra_usage: { is_enabled: true, monthly_limit: 999, used_credits: 42 },
  account: { email: "PRIVATE_ACCOUNT" },
};
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
test("Claude quota normalizer allows only known percentage windows and valid reset times", () => {
  const windows = normalizeClaudeUsage(payload);
  assert.equal(windows.length, 3);
  assert.equal(windows[0].remainingPercent, 79);
  assert.equal(windows[0].resetsAt, "2026-10-03T13:00:00.000Z");
  assert.equal(windows[2].resetsAt, null);
  assert.doesNotMatch(JSON.stringify(windows), /PRIVATE|credits|999/);
  assert.deepEqual(
    normalizeClaudeUsage({
      five_hour: { utilization: null },
      seven_day: { utilization: "10" },
      seven_day_sonnet: { utilization: Infinity },
    }),
    [],
  );
  assert.equal(
    normalizeClaudeUsage({ five_hour: { utilization: 101 } })[0]
      .remainingPercent,
    0,
  );
  assert.equal(
    normalizeClaudeUsage({ five_hour: { utilization: -1 } })[0]
      .remainingPercent,
    100,
  );
  for (const value of [null, [], false, "fixture"])
    assert.deepEqual(normalizeClaudeUsage(value), []);
});
test("usage performs exactly one fixed HTTPS GET without redirects, model prompt or billing fields", async () => {
  const calls = [];
  const result = await readClaudeUsage(provider, {
    now,
    credentials: async () => auth,
    request: async (...args) => {
      calls.push(args);
      return response(payload);
    },
  });
  assert.equal(result.status, "available");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://api.anthropic.com/api/oauth/usage");
  const options = calls[0][1];
  assert.equal(options.method, "GET");
  assert.equal(options.redirect, "error");
  assert.equal(options.body, undefined);
  assert.equal(options.headers.Authorization, `Bearer ${auth.accessToken}`);
  assert.equal(options.headers["anthropic-beta"], "oauth-2025-04-20");
  assert.ok(options.signal.aborted);
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture-token|NEVER_USE|PRIVATE_ACCOUNT|used_credits/,
  );
});
test("expired, API-only, missing-scope and malformed credentials never reach a network", async () => {
  const invalid = [
    null,
    {},
    { ...auth, expiresAt: at },
    { ...auth, subscriptionType: "api" },
    { ...auth, scopes: ["user:inference"] },
    { ...auth, accessToken: "invalid\r\nAuthorization: x" },
    { ...auth, expiresAt: "later" },
  ];
  let requests = 0;
  for (const value of invalid)
    assert.equal(
      (
        await readClaudeUsage(provider, {
          now,
          credentials: async () => value,
          request: async () => {
            requests++;
            throw Error("must not request");
          },
        })
      ).status,
      "unavailable",
    );
  for (const value of [null, { ...provider, connectionType: "api" }])
    assert.equal(
      (
        await readClaudeUsage(value, {
          now,
          credentials: async () => {
            throw Error("must not read");
          },
        })
      ).status,
      "unavailable",
    );
  assert.equal(requests, 0);
});
test("unknown response, auth errors, redirects and failures never become zero quotas or expose private error text", async () => {
  for (const status of [401, 403, 429, 500]) {
    const result = await readClaudeUsage(provider, {
      now,
      credentials: async () => auth,
      request: async () => new Response("PRIVATE PROVIDER ERROR", { status }),
    });
    assert.equal(
      result.status,
      status === 401 || status === 403 ? "unavailable" : "error",
    );
    assert.deepEqual(result.windows, []);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
  const empty = await readClaudeUsage(provider, {
    now,
    credentials: async () => auth,
    request: async () => response({ five_hour: null }),
  });
  assert.equal(empty.status, "unavailable");
  const fail = await readClaudeUsage(provider, {
    now,
    credentials: async () => auth,
    request: async () => {
      throw Error("SECRET REDIRECT");
    },
  });
  assert.equal(fail.status, "error");
  assert.doesNotMatch(JSON.stringify(fail), /SECRET/);
});
test("response size and overall deadline are bounded including delayed credentials", async () => {
  const options = { now, credentials: async () => auth };
  const huge = await readClaudeUsage(provider, {
    ...options,
    request: async () => new Response("x".repeat(66000)),
  });
  assert.equal(huge.status, "error");
  let signal;
  const timeout = await readClaudeUsage(provider, {
    ...options,
    timeoutMs: 5,
    request: async (_, args) => {
      signal = args.signal;
      return new Promise(() => {});
    },
  });
  assert.equal(timeout.status, "error");
  assert.ok(signal.aborted);
  let resolve,
    requests = 0;
  const pending = readClaudeUsage(provider, {
    now,
    timeoutMs: 5,
    credentials: () => new Promise((r) => (resolve = r)),
    request: async () => {
      requests++;
      return response(payload);
    },
  });
  assert.equal((await pending).status, "error");
  resolve(auth);
  await new Promise((r) => setImmediate(r));
  assert.equal(requests, 0);
});
test("combined reader caches Claude separately by connection settings and makes no background reads", async () => {
  let requests = 0;
  const reader = createProviderUsageReader({
    now,
    readCodex: async () => ({ id: "codex", windows: [] }),
    readClaude: async () => {
      requests++;
      return {
        id: "claude",
        status: "available",
        windows: normalizeClaudeUsage(payload),
      };
    },
  });
  const first = await reader.read([provider]);
  await reader.read([provider]);
  assert.equal(requests, 1);
  assert.equal(first.providers[1].windows[0].remainingPercent, 79);
  await reader.read([{ ...provider, status: "signed_out" }]);
  assert.equal(requests, 2);
});


test("current Fable typed weekly window is allowlisted without exposing opaque or billing fields", () => {
  const fable = { kind: "weekly_scoped", group: "weekly", percent: 18,
    resets_at: "2026-10-10T08:00:00Z", scope: {model: {id: null, display_name: "Fable"}, surface: null},
    used_dollars: 123, remaining_dollars: 456, account: "PRIVATE" };
  const windows = normalizeClaudeUsage({ limits: [fable, {...fable}], opaque_alias: {utilization: 99} });
  assert.deepEqual(windows, [{ label: "Claude · Fable weekly allowance", usedPercent: 18,
    remainingPercent: 82, resetsAt: "2026-10-10T08:00:00.000Z" }]);
  for (const invalid of [ {...fable,kind:"spend"}, {...fable,group:"credits"}, {...fable,percent:"18"},
    {...fable,scope:{model:{display_name:"Unknown private model"},surface:null}},
    {...fable,scope:{model:{display_name:"Fable"},surface:"private-surface"}} ])
    assert.deepEqual(normalizeClaudeUsage({limits:[invalid]}), []);
  assert.doesNotMatch(JSON.stringify(windows), /PRIVATE|dollars|123|456|opaque/);
});
