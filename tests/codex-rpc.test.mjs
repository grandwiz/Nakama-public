import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexRpc, readCodexModels } from "../apps/host/codex-rpc.mjs";

function fixture(t, timeoutMs = 1000) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit("close");
    return true;
  };
  const client = new CodexRpc("fake-codex", {
    spawnImpl: () => child,
    timeoutMs,
  });
  t.after(() => client.close());
  return { client, child };
}
test("Codex startup/stream failures reject pending and future requests immediately", async (t) => {
  for (const source of ["child", "stdin", "stdout"]) {
    const f = fixture(t),
      pending = f.client.request("model/list");
    const rejection = assert.rejects(pending, { status: 409 });
    (source === "child" ? f.child : f.child[source]).emit(
      "error",
      new Error("private process details"),
    );
    await rejection;
    await assert.rejects(f.client.request("model/list"), /closed/);
    assert.equal(f.client.pending.size, 0);
  }
});
test("Codex metadata preserves UTF-8 across chunks and matches response IDs", async (t) => {
  const f = fixture(t),
    pending = f.client.request("model/list");
  const raw = Buffer.from(
      JSON.stringify({ id: 1, result: { name: "Nakama 🌙" } }) + "\n",
    ),
    split = raw.indexOf(Buffer.from("🌙")) + 2;
  f.child.stdout.write(raw.subarray(0, split));
  f.child.stdout.write(raw.subarray(split));
  assert.deepEqual(await pending, { name: "Nakama 🌙" });
  assert.equal(f.client.pending.size, 0);
});
test("Codex timeouts, malformed JSON and oversize messages cannot leave dangling requests", async (t) => {
  const f = fixture(t, 10);
  f.client.receive("not-json\n");
  await assert.rejects(f.client.request("model/list"), { status: 504 });
  assert.equal(f.client.pending.size, 0);
  const large = fixture(t),
    waiting = large.client.request("model/list"),
    rejected = assert.rejects(waiting, { status: 409 });
  large.client.receive("x".repeat(8 * 1024 * 1024 + 1));
  await rejected;
  assert.equal(large.client.closed, true);
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(f.client.request("bad", cyclic), { status: 400 });
  assert.equal(f.client.pending.size, 0);
});
test("Codex provider errors are redacted and close can be called repeatedly", async (t) => {
  const f = fixture(t),
    waiting = f.client.request("model/list");
  f.client.receive(
    JSON.stringify({ id: 1, error: { message: "API_KEY=private-value" } }) +
      "\n",
  );
  await assert.rejects(
    waiting,
    (error) => !error.message.includes("private-value") && error.status === 409,
  );
  f.client.close();
  f.client.close();
  await assert.rejects(f.client.request("model/list"), /closed/);
});
test("Codex model pagination deduplicates models and rejects repeated or malformed cursors", async () => {
  const calls = [],
    pages = [
      {
        data: [
          {
            id: "one",
            displayName: "One",
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          },
        ],
        nextCursor: "page2",
      },
      { data: [{ id: "one" }, { model: "two" }] },
    ];
  const result = await readCodexModels({
    request: async (method, params) => {
      calls.push({ method, params });
      return pages.shift();
    },
  });
  assert.deepEqual(result.models, ["one", "two"]);
  assert.deepEqual(result.modelDetails[0].efforts, ["high"]);
  assert.equal(calls[1].params.cursor, "page2");
  assert.equal(result.truncated, false);
  let count = 0;
  await assert.rejects(
    readCodexModels({
      request: async () => {
        count++;
        return { data: [], nextCursor: "same" };
      },
    }),
    /repeated/,
  );
  assert.equal(count, 2);
  await assert.rejects(
    readCodexModels({ request: async () => ({ data: null }) }),
    /invalid/,
  );
  await assert.rejects(
    readCodexModels({ request: async () => ({ data: [{ id: 42 }] }) }),
    /invalid/,
  );
});
test("empty changing model cursors stop at a fixed page limit", async () => {
  let calls = 0;
  const result = await readCodexModels({
    request: async () => ({ data: [], nextCursor: `cursor-${++calls}` }),
  });
  assert.equal(calls, 10);
  assert.equal(result.truncated, true);
});
