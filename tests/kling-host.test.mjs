import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { NakamaHost } from "../apps/host/host.mjs";
import { initialState } from "../apps/host/store.mjs";
import { ApiError } from "../apps/host/security.mjs";

const catalogue = () => ({
  accountId: "test-account",
  models: [
    {
      id: "fixture-video",
      name: "Fixture",
      parameters: {
        type: "object",
        properties: { duration: { type: "string", enum: ["5", "10"] } },
        additionalProperties: false,
      },
      defaults: { duration: "5" },
      required: [],
    },
  ],
});
const request = {
  prompt: "A blue mascot waves",
  model: "fixture-video",
  parameters: { duration: "5" },
};
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-kling-"));
  const calls = [],
    cli = {
      status: async () => ({ installed: true, detail: "fixture" }),
      discover: async () => {
        calls.push("discover");
        return catalogue();
      },
      account: async () => ({ availableCredits: 100 }),
      submit: async (_, __, { beforeSubmit }) => {
        beforeSubmit();
        calls.push("submit");
        return {
          generationId: "video-1",
          status: "pending",
          terminal: false,
          works: [],
        };
      },
      query: async (id) => {
        calls.push(`query:${id}`);
        return {
          generationId: id,
          status: "success",
          terminal: true,
          works: [
            {
              index: 0,
              url: "https://example.test/video.mp4",
              contentType: "video",
            },
          ],
        };
      },
    };
  const host = await new NakamaHost({ dataDir: dir, klingCli: cli }).init();
  t.after(async () => {
    await host.close();
    assert.ok(
      path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { host, cli, calls, dir };
}
const enable = (host) =>
  host.dispatch("POST", "/api/kling/settings", { enabled: true });
const prepare = (host, principal) =>
  host.dispatch("POST", "/api/kling/prepare", request, principal);
const approve = (host, id) =>
  host.dispatch("POST", `/api/approvals/${id}/resolve`, { approved: true });
async function mcp(host) {
  if (!host.server) await host.listen({ port: 0, host: "127.0.0.1" });
  const value = await host.dispatch("POST", "/api/kling/mcp-config");
  const token = value.config.mcpServers["nakama-kling"].env.NAKAMA_KLING_TOKEN;
  return { token, principal: host.authenticate(`Bearer ${token}`) };
}

test("Kling stays off without remote checks; legacy media routes are gone", async (t) => {
  const { host, calls } = await fixture(t);
  assert.equal(
    (await host.dispatch("GET", "/api/kling/status")).enabled,
    false,
  );
  await assert.rejects(prepare(host), { status: 409 });
  await assert.rejects(host.dispatch("GET", "/api/media/catalogue"), {
    status: 404,
  });
  await assert.rejects(
    host.dispatch("PATCH", "/api/settings", { paidApisEnabled: true }),
    { status: 400 },
  );
  assert.deepEqual(calls, []);
});
test("prepare records an exact approval; only owner submits once", async (t) => {
  const { host, calls } = await fixture(t);
  await enable(host);
  const { principal } = await mcp(host);
  const { job, approval } = await prepare(host, principal);
  assert.equal(job.status, "awaiting_approval");
  assert.match(approval.description, /exact charge is not supplied/);
  assert.equal(calls.includes("submit"), false);
  for (const [method, route, body] of [
    ["POST", `/api/approvals/${approval.id}/resolve`, { approved: true }],
    ["POST", "/api/kling/settings", { enabled: true }],
    ["GET", "/api/state", {}],
    ["POST", "/api/kling/mcp-config", {}],
  ])
    await assert.rejects(host.dispatch(method, route, body, principal), {
      status: 403,
    });
  await approve(host, approval.id);
  await assert.rejects(approve(host, approval.id), { status: 409 });
  assert.equal(calls.filter((s) => s === "submit").length, 1);
  assert.equal(host.store.state.klingJobs[0].status, "running");
  await assert.rejects(prepare(host), { status: 409 });
  const result = await host.dispatch(
    "POST",
    `/api/kling/jobs/${job.id}/poll`,
    {},
    principal,
  );
  assert.equal(result.status, "completed");
  assert.equal(result.results.length, 1);
  assert.equal(calls.filter((s) => s === "submit").length, 1);
});
test("request edits and changed catalogue invalidate approval", async (t) => {
  const { host, cli, calls } = await fixture(t);
  await enable(host);
  const first = await prepare(host);
  host.store.state.klingJobs[0].request.prompt = "tampered";
  await assert.rejects(approve(host, first.approval.id), { status: 409 });
  await host.kling.decline(first.job.id);
  const second = await prepare(host);
  cli.discover = async () => {
    const c = catalogue();
    c.models[0].defaults.duration = "10";
    return c;
  };
  await assert.rejects(approve(host, second.approval.id), { status: 409 });
  assert.equal(host.store.state.klingJobs.at(-1).status, "not_submitted");
  assert.equal(calls.includes("submit"), false);
});
test("decline sends nothing and permits a fresh review", async (t) => {
  const { host, calls } = await fixture(t);
  await enable(host);
  const first = await prepare(host);
  await host.dispatch("POST", `/api/approvals/${first.approval.id}/resolve`, {
    approved: false,
  });
  assert.equal(host.store.state.klingJobs[0].status, "declined");
  await prepare(host);
  assert.equal(calls.includes("submit"), false);
});
test("concurrent requests create only one pending video", async (t) => {
  const { host } = await fixture(t);
  await enable(host);
  const results = await Promise.allSettled([prepare(host), prepare(host)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(host.store.state.klingJobs.length, 1);
});
test("disable or credential revocation during preflight blocks submission", async (t) => {
  for (const revoke of [false, true]) {
    const { host, cli, calls } = await fixture(t);
    await enable(host);
    const { principal } = await mcp(host),
      pending = await prepare(host, principal);
    cli.submit = async (_, __, { beforeSubmit }) => {
      if (revoke) await host.dispatch("DELETE", "/api/kling/mcp-config");
      else
        await host.dispatch("POST", "/api/kling/settings", { enabled: false });
      beforeSubmit();
      calls.push("submit");
    };
    await assert.rejects(approve(host, pending.approval.id), { status: 409 });
    assert.equal(calls.includes("submit"), false);
    assert.equal(host.store.state.klingJobs[0].status, "not_submitted");
  }
});
test("lost paid response is not retried, and restart keeps it blocked", async (t) => {
  const { host, cli, calls, dir } = await fixture(t);
  await enable(host);
  cli.submit = async (_, __, { beforeSubmit }) => {
    beforeSubmit();
    calls.push("submit");
    throw new Error("lost response");
  };
  const pending = await prepare(host);
  await assert.rejects(approve(host, pending.approval.id), { status: 409 });
  await assert.rejects(prepare(host), { status: 409 });
  const restarted = await new NakamaHost({
    dataDir: dir,
    klingCli: cli,
  }).init();
  await assert.rejects(prepare(restarted), { status: 409 });
  await restarted.close();
  assert.equal(calls.filter((s) => s === "submit").length, 1);
});
test("MCP revocation is immediate, job history is scoped and tokens stay private", async (t) => {
  const { host } = await fixture(t);
  await enable(host);
  const a = await mcp(host),
    pending = await prepare(host, a.principal),
    b = await mcp(host);
  await assert.rejects(
    host.dispatch("GET", "/api/kling/jobs", {}, a.principal),
    { status: 403 },
  );
  assert.throws(() => host.authenticate(`Bearer ${a.token}`), { status: 401 });
  assert.deepEqual(
    (await host.dispatch("GET", "/api/kling/jobs", {}, b.principal)).jobs,
    [],
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      `/api/kling/jobs/${pending.job.id}/poll`,
      {},
      b.principal,
    ),
    { status: 404 },
  );
  const state = await host.dispatch("GET", "/api/state");
  assert.equal(state.klingMcp, undefined);
  assert.equal(state.klingJobs, undefined);
  assert.equal(JSON.stringify(state).includes(b.token), false);
});
test("phone credentials cannot access Kling, including with Google disabled", async (t) => {
  const { host } = await fixture(t);
  host.store.state.devices.push({
    id: "phone",
    platform: "android",
    permissions: { googleAccess: false },
  });
  for (const route of [
    "/api/kling/jobs",
    "/api/kling/catalogue",
    "/api/kling/account",
  ])
    await assert.rejects(
      host.dispatch("GET", route, {}, { kind: "device", id: "phone" }),
      { status: 403 },
    );
});
test("MCP credential crosses HTTPS only with its limited scope", async (t) => {
  const { host } = await fixture(t);
  const { token } = await mcp(host);
  const read = (route, origin) =>
    new Promise((resolve, reject) => {
      const req = https.get(
        {
          hostname: "127.0.0.1",
          port: host.server.address().port,
          path: route,
          rejectUnauthorized: false,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(origin ? { Origin: origin } : {}),
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
    });
  assert.equal(await read("/api/kling/status"), 200);
  assert.equal(await read("/api/state"), 403);
  assert.equal(
    await read("/api/kling/status", "chrome-extension://" + "a".repeat(32)),
    403,
  );
});

test("upgrade deletes retired media credentials while preserving Google and owner state", async (t) => {
  const { host, dir, cli } = await fixture(t);
  const old = initialState();
  old.connections.push({
    id: "gemini-media",
    accounts: [{ id: "old-account" }],
  });
  await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(old));
  const values = new Map([
    ["gemini-media:old-account", "fixture-only"],
    ["gemini-media:orphan", "fixture-only"],
    ["google:personal", "preserve-me"],
  ]);
  const vault = {
    delete: async (key) => values.delete(key),
    deletePrefix: async (prefix) => {
      for (const key of values.keys())
        if (key.startsWith(prefix)) values.delete(key);
    },
  };
  const migrated = await new NakamaHost({
    dataDir: dir,
    klingCli: cli,
    vault,
  }).init();
  assert.deepEqual([...values.keys()], ["google:personal"]);
  assert.equal(migrated.store.state.pendingLegacyCredentialRemovals, undefined);
  assert.equal(migrated.store.state.config.klingEnabled, false);
  await migrated.close();
});

test("provider succeed and partial_completed states complete the known job", async (t) => {
  const { host, cli } = await fixture(t);
  await enable(host);
  for (const [status, expected] of [
    ["succeed", "completed"],
    ["partial_completed", "partial"],
  ]) {
    const pending = await prepare(host);
    await approve(host, pending.approval.id);
    cli.query = async (id) => ({
      generationId: id,
      status,
      terminal: true,
      works: [],
    });
    assert.equal(
      (await host.dispatch("POST", `/api/kling/jobs/${pending.job.id}/poll`))
        .status,
      expected,
    );
  }
});
