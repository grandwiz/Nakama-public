import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import crypto from "node:crypto";
import selfsigned from "selfsigned";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createKlingMcpServer } from "../apps/kling-mcp/server.mjs";
import {
  bridgeConfig,
  createBridgeClient,
  verifyPinnedCertificate,
} from "../apps/kling-mcp/client.mjs";

const env = (url = "https://127.0.0.1:43110") => ({
  NAKAMA_KLING_URL: url,
  NAKAMA_KLING_TOKEN: "a".repeat(43),
  NAKAMA_KLING_FINGERPRINT: "ab".repeat(32),
});

test("MCP accepts only pinned loopback HTTPS without URL credentials, paths or fragments", () => {
  assert.equal(bridgeConfig(env()).host, "127.0.0.1");
  assert.equal(bridgeConfig(env("https://localhost:43110")).host, "127.0.0.1");
  assert.equal(bridgeConfig(env("https://[::1]:43110")).host, "::1");
  for (const url of [
    "http://127.0.0.1:43110",
    "https://example.org",
    "https://192.168.1.5",
    "https://user:pass@localhost",
    "https://localhost/path",
    "https://localhost/#hidden",
    "https://localhost/?token=hidden",
  ])
    assert.throws(() => bridgeConfig(env(url)));
  assert.throws(() =>
    bridgeConfig({ ...env(), NAKAMA_KLING_TOKEN: "bad\r\nheader" }),
  );
  assert.throws(() => bridgeConfig({ ...env(), NAKAMA_KLING_FINGERPRINT: "" }));
});

test("MCP certificate checks exact SHA256 and validity dates", () => {
  const raw = Buffer.from("certificate-fixture");
  const fingerprint = crypto.createHash("sha256").update(raw).digest("hex");
  const cert = { raw, valid_from: "2026-01-01", valid_to: "2026-12-31" };
  verifyPinnedCertificate(cert, fingerprint, Date.parse("2026-09-30"));
  assert.throws(() =>
    verifyPinnedCertificate(cert, "00".repeat(32), Date.parse("2026-09-30")),
  );
  assert.throws(() =>
    verifyPinnedCertificate(cert, fingerprint, Date.parse("2027-01-01")),
  );
  assert.throws(() =>
    verifyPinnedCertificate(cert, fingerprint, Date.parse("2025-01-01")),
  );
});

test("MCP protocol exposes bounded tools and preparing never grants approval", async () => {
  const calls = [];
  const server = createKlingMcpServer({
    request: async (...args) => {
      calls.push(args);
      return { job: { id: "job-1", status: "awaiting_approval" } };
    },
  });
  const client = new Client({ name: "fixture-client", version: "1.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const list = await client.listTools();
    assert.deepEqual(list.tools.map((v) => v.name).sort(), [
      "kling_account",
      "kling_catalogue",
      "kling_job_status",
      "kling_jobs",
      "kling_prepare_video",
      "kling_status",
    ]);
    assert.ok(!JSON.stringify(list).includes("approve_video"));
    assert.equal(
      list.tools.find((v) => v.name === "kling_prepare_video").annotations
        .readOnlyHint,
      false,
    );
    assert.equal(
      list.tools.find((v) => v.name === "kling_prepare_video").annotations
        .idempotentHint,
      false,
    );
    // Polling reads Kling but persists refreshed Nakama job state.
    assert.equal(
      list.tools.find((v) => v.name === "kling_job_status").annotations
        .readOnlyHint,
      false,
    );
    assert.equal(
      list.tools.find((v) => v.name === "kling_job_status").annotations
        .idempotentHint,
      true,
    );
    const result = await client.callTool({
      name: "kling_prepare_video",
      arguments: {
        prompt: "A gentle wave.",
        model: "fixture-video",
        parameters: { duration: 5 },
      },
    });
    assert.equal(result.structuredContent.job.status, "awaiting_approval");
    assert.equal(calls[0][0], "POST");
    assert.equal(calls[0][1], "/api/kling/prepare");
    const bad = await client.callTool({
      name: "kling_job_status",
      arguments: { jobId: "../../approvals/yes" },
    });
    assert.equal(bad.isError, true);
    assert.equal(calls.length, 1);
  } finally {
    await client.close();
    await server.close();
  }
});

test("TLS pin is checked before the bearer token reaches a localhost server", async () => {
  const cert = await selfsigned.generate(
    [{ name: "commonName", value: "localhost" }],
    { days: 1, keySize: 2048 },
  );
  const x509 = new crypto.X509Certificate(cert.cert);
  let received = 0,
    lastToken;
  const server = https.createServer(
    { key: cert.private, cert: cert.cert },
    (req, res) => {
      received++;
      lastToken = req.headers.authorization;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ connected: true, token: "private-do-not-return" }),
      );
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    host: "127.0.0.1",
    port: server.address().port,
    token: "fixture-token",
    fingerprint: x509.fingerprint256.replaceAll(":", "").toLowerCase(),
  };
  const good = createBridgeClient(config, { timeoutMs: 5000 });
  const wrong = createBridgeClient(
    { ...config, fingerprint: "00".repeat(32) },
    { timeoutMs: 5000 },
  );
  try {
    await assert.rejects(wrong.request("GET", "/api/kling/status"), /securely/);
    assert.equal(received, 0);
    assert.deepEqual(await good.request("GET", "/api/kling/status"), {
      connected: true,
    });
    assert.equal(received, 1);
    assert.equal(lastToken, "Bearer fixture-token");
    await assert.rejects(
      good.request("POST", "/api/approvals/one/approve", {}),
      /cannot access/,
    );
    assert.equal(received, 1);
  } finally {
    good.close();
    wrong.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
