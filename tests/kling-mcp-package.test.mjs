import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import selfsigned from "selfsigned";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("bundled Kling MCP negotiates stdio and prepares only a pinned local approval", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nakama-kling-mcp-test-"),
  );
  const output = path.join(directory, "server.mjs");
  await build({
    entryPoints: ["apps/kling-mcp/server.mjs"],
    outfile: output,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    logLevel: "silent",
  });
  const cert = await selfsigned.generate(
    [{ name: "commonName", value: "localhost" }],
    { days: 1, keySize: 2048 },
  );
  const fingerprint = new crypto.X509Certificate(cert.cert).fingerprint256;
  const token = crypto.randomBytes(32).toString("base64url");
  const requests = [];
  const http = https.createServer(
    { key: cert.private, cert: cert.cert },
    async (req, res) => {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({
        method: req.method,
        path: req.url,
        body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null,
      });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          req.url === "/api/kling/prepare"
            ? {
                job: { id: "preview-only", status: "awaiting_approval" },
                approval: { status: "pending" },
              }
            : { enabled: false, installed: true },
        ),
      );
    },
  );
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [output],
    cwd: directory,
    stderr: "pipe",
    env: {
      NAKAMA_KLING_URL: `https://127.0.0.1:${http.address().port}`,
      NAKAMA_KLING_FINGERPRINT: fingerprint,
      NAKAMA_KLING_TOKEN: token,
    },
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const client = new Client({ name: "nakama-bundle-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 6);
    const status = await client.callTool({
      name: "kling_status",
      arguments: {},
    });
    assert.equal(status.structuredContent.enabled, false);
    const prepared = await client.callTool({
      name: "kling_prepare_video",
      arguments: {
        prompt: "A short fixture scene. No provider request is allowed.",
        model: "fixture-only",
        parameters: {},
      },
    });
    assert.equal(prepared.structuredContent.job.status, "awaiting_approval");
    assert.deepEqual(
      requests.map((v) => `${v.method} ${v.path}`),
      ["GET /api/kling/status", "POST /api/kling/prepare"],
    );
    assert.ok(!stderr.includes(token));
    assert.equal(stderr, "");
  } finally {
    await client.close();
    await transport.close();
    await new Promise((resolve) => http.close(resolve));
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("nakama-kling-mcp-test-"));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
