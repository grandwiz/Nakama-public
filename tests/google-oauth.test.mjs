import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { Store } from "../apps/host/store.mjs";
import { GoogleAccounts } from "../apps/host/google.mjs";
const scopes =
  "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
const tokens = {
  access_token: "access-secret",
  refresh_token: "refresh-secret",
  token_type: "Bearer",
  expires_in: 3600,
  scope: scopes,
};
async function fixture(t, fetchImpl) {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "nakama-google-test-"),
    ),
    store = await new Store(directory).init(),
    saved = new Map(),
    calls = [];
  const google = new GoogleAccounts({
    store,
    vault: {
      get: async (key) => saved.get(key),
      set: async (key, value) => saved.set(key, value),
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return fetchImpl
        ? fetchImpl(url, options)
        : Response.json(
            String(url).includes("/token")
              ? tokens
              : {
                  sub: "google-user",
                  email: "personal@example.com",
                  email_verified: true,
                },
          );
    },
  });
  t.after(async () => {
    google.close();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^nakama-google-test-/);
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const connected = async () => {
    await store.change((s) => {
      s.googleAccounts = [
        {
          id: "account",
          email: "personal@example.com",
          services: ["gmail", "calendar"],
        },
      ];
    });
    saved.set(
      "google:account",
      JSON.stringify({
        ...tokens,
        clientId: "client.apps.googleusercontent.com",
        expiresAt: 0,
      }),
    );
  };
  return { google, store, saved, calls, connected };
}
async function begin(f) {
  const result = await f.google.connect({
      clientId: "client.apps.googleusercontent.com",
      services: ["gmail"],
    }),
    url = new URL(result.url),
    callback = new URL(url.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    state: url.searchParams.get("state"),
    code: "authorization-code",
  }).toString();
  return { url, callback };
}
function localRequest(url, { host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      { headers: { Connection: "close", ...(host ? { Host: host } : {}) } },
      (res) => {
        let body = "";
        res.on("data", (data) => (body += data));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
  });
}

test("Google OAuth uses PKCE and a single-use loopback callback with verified account identity", async (t) => {
  const f = await fixture(t),
    { url, callback } = await begin(f);
  assert.equal(callback.hostname, "127.0.0.1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const wrong = new URL(callback);
  wrong.searchParams.set("state", "wrong");
  assert.equal((await localRequest(wrong)).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await localRequest(callback, { host: "evil.example" })).status,
    400,
  );
  assert.equal(f.calls.length, 0);
  const result = await localRequest(callback);
  assert.equal(result.status, 200);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].options.redirect, "error");
  assert.equal(f.calls[1].options.redirect, "error");
  const params = f.calls[0].options.body,
    verifier = params.get("code_verifier");
  assert.equal(
    crypto.createHash("sha256").update(verifier).digest("base64url"),
    url.searchParams.get("code_challenge"),
  );
  assert.equal(
    params.get("redirect_uri"),
    url.searchParams.get("redirect_uri"),
  );
  assert.equal(f.google.accounts().length, 1);
  assert.equal(JSON.stringify(f.store.state).includes("access-secret"), false);
  assert.ok(
    [...f.saved.values()].some((value) => value.includes("refresh-secret")),
  );
  await assert.rejects(localRequest(callback));
  assert.equal(f.calls.length, 2);
});

test("OAuth refuses duplicate state, unverified profiles and oversized token responses", async (t) => {
  const f = await fixture(t),
    flow = await begin(f),
    duplicated = new URL(flow.callback);
  duplicated.searchParams.append("state", flow.url.searchParams.get("state"));
  assert.equal((await localRequest(duplicated)).status, 400);
  assert.equal(f.calls.length, 0);
  const unverified = await fixture(t, (url) =>
      Response.json(
        String(url).includes("/token")
          ? tokens
          : { sub: "user", email: "user@example.com", email_verified: false },
      ),
    ),
    second = await begin(unverified);
  assert.equal((await localRequest(second.callback)).status, 400);
  assert.equal(unverified.google.accounts().length, 0);
  assert.equal(unverified.saved.size, 0);
  const huge = await fixture(
      t,
      () => new Response("{}", { headers: { "content-length": "1000000" } }),
    ),
    third = await begin(huge);
  assert.equal((await localRequest(third.callback)).status, 400);
  assert.equal(huge.saved.size, 0);
});

test("concurrent refresh uses one token exchange and preserves an existing refresh token", async (t) => {
  const f = await fixture(t, () =>
    Response.json({
      access_token: "fresh-access",
      token_type: "Bearer",
      expires_in: 3600,
    }),
  );
  await f.connected();
  const values = await Promise.all([
    f.google.accessToken("account", "gmail"),
    f.google.accessToken("account", "calendar"),
    f.google.accessToken("account", "gmail"),
  ]);
  assert.deepEqual(values, ["fresh-access", "fresh-access", "fresh-access"]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.redirect, "error");
  assert.equal(
    JSON.parse(f.saved.get("google:account")).refresh_token,
    "refresh-secret",
  );
});

test("disconnect during refresh cannot resurrect removed credentials", async (t) => {
  let resolve, started;
  const waiting = new Promise((r) => (started = r)),
    f = await fixture(t, () => {
      started();
      return new Promise((r) => (resolve = r));
    });
  await f.connected();
  const pending = f.google.accessToken("account", "gmail"),
    failure = assert.rejects(pending, /stopped/);
  await waiting;
  const disconnected = f.google.disconnect("account");
  resolve(Response.json(tokens));
  await failure;
  await disconnected;
  assert.equal(f.saved.get("google:account"), "");
  assert.equal(f.google.accounts().length, 0);
});

test("API destinations reject arbitrary URLs and errors never echo provider credentials", async (t) => {
  const f = await fixture(t, () => {
    throw new Error("Authorization Bearer secret");
  });
  await f.connected();
  await assert.rejects(
    f.google.request("account", "gmail", "https://attacker.invalid/steal"),
    /not allowed/,
  );
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    f.google.accessToken("account", "gmail"),
    (error) => !error.message.includes("Bearer secret"),
  );
  assert.equal(f.calls.length, 1);
  assert.throws(
    () => f.google.events("account", "../settings"),
    /valid calendar/,
  );
});

test("closing Google connections aborts new work and clears unused OAuth listeners", async (t) => {
  const f = await fixture(t),
    { callback } = await begin(f);
  f.google.close();
  await assert.rejects(localRequest(callback));
  await assert.rejects(
    f.google.connect({ clientId: "client.apps.googleusercontent.com" }),
    /closed/,
  );
  assert.equal(f.calls.length, 0);
});
