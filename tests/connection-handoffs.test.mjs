import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";

const OWNER = { kind: "owner", id: "desktop" },
  PHONE = { kind: "device", id: "phone" };
async function fixture(t) {
  const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nakama-connection-handoff-"),
    ),
    secrets = new Map();
  const vault = {
    async get(key) {
      return secrets.get(key) || null;
    },
    async set(key, value) {
      secrets.set(key, value);
    },
    async delete(key) {
      secrets.delete(key);
    },
  };
  const host = await new NakamaHost({ dataDir: dir, vault }).init();
  await host.store.change((state) =>
    state.devices.push({
      id: "phone",
      platform: "android",
      permissions: {
        browserControl: true,
        googleAccess: true,
        projectAccess: true,
      },
    }),
  );
  t.after(async () => {
    await host.close();
    await host.store.queue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { host, secrets, vault };
}
test("cancel or device revocation during connection vault save removes orphan credentials and leaves accounts unchanged", async (t) => {
  const f = await fixture(t),
    request = await f.host.connectionHandoffs.request(
      {
        provider: "github",
        deviceId: "phone",
        accountLabel: "Synthetic fixture",
      },
      OWNER,
    );
  let release;
  const original = f.vault.set;
  f.vault.set = async (key, value) => {
    await original(key, value);
    if (key.startsWith("github:"))
      await new Promise((resolve) => {
        release = resolve;
      });
  };
  const pending = f.host.connectionHandoffs.complete(
    request.id,
    { token: "SYNTHETIC-CREDENTIAL-NOT-AN-ACCOUNT" },
    PHONE,
  );
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  f.host.connectionHandoffs.cancel(request.id, OWNER);
  f.host.store.state.devices[0].permissions.googleAccess = false;
  release();
  await assert.rejects(pending, /disabled|unavailable|used/);
  assert.equal(
    [...f.secrets.keys()].some((key) => key.startsWith("github:")),
    false,
  );
  assert.equal(
    f.host.store.state.connections.find((row) => row.id === "github").accounts
      .length,
    0,
  );
});
test("one-use provider/device handoff saves only protected account metadata and never returns credential material", async (t) => {
  const f = await fixture(t),
    request = await f.host.connectionHandoffs.request(
      {
        provider: "github",
        deviceId: "phone",
        accountLabel: "Synthetic fixture",
      },
      OWNER,
    );
  const result = await f.host.connectionHandoffs.complete(
    request.id,
    { token: "SYNTHETIC-CREDENTIAL-NOT-AN-ACCOUNT" },
    PHONE,
  );
  assert.equal(result.saved, true);
  assert.ok(f.secrets.has(`github:${result.accountId}`));
  assert.ok(
    !JSON.stringify(f.host.connectionHandoffs.public(PHONE)).includes(
      "SYNTHETIC-CREDENTIAL",
    ),
  );
  await assert.rejects(
    f.host.connectionHandoffs.complete(request.id, { token: "SECOND" }, PHONE),
    /already used/,
  );
  await assert.rejects(
    f.host.connectionHandoffs.request(
      {
        provider: "github",
        deviceId: "phone",
        accountLabel: "Forbidden self grant",
      },
      PHONE,
    ),
    /Windows/,
  );
});
