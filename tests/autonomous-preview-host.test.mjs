import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";

const HASH = "a".repeat(64);
const block = (value) => "```nakama-task\n" + JSON.stringify(value) + "\n```";
async function until(predicate) {
  const end = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Local preview fixture timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-preview-host-")),
    calls = [];
  const host = await new NakamaHost({
    dataDir: path.join(dir, "state"),
    runAgent: async (_provider, options) => {
      calls.push(options);
      return { stop() {} };
    },
  }).init();
  const workspaceRoot = path.join(dir, "projects");
  await fs.mkdir(workspaceRoot);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Synthetic preview host",
  });
  const serverFile = path.join(project.path, "fixture-server.cjs");
  await fs.writeFile(
    path.join(project.path, "package.json"),
    JSON.stringify({
      private: true,
      scripts: { dev: "vite", test: "node test.cjs" },
    }),
  );
  await fs.writeFile(
    path.join(project.path, "test.cjs"),
    "console.log('PREVIEW_STOP_CHECK');",
  );
  await fs.writeFile(
    serverFile,
    `const http=require('node:http');
const port=Number(process.argv[process.argv.indexOf('--port')+1]);
http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>LOCAL_PREVIEW_FIXTURE</h1>');}).listen(port,'127.0.0.1',()=>console.log('LOCAL_PREVIEW_READY'));
`,
  );
  // Substitute only command discovery/verification. The real host still owns
  // approval resolution, metadata, spawn, persistence, process close and Stop.
  host.projectPreviews.tools = {
    async discoverChecks() {
      return {
        supported: true,
        runtime: { available: true },
        manifestHash: HASH,
        checks: [
          {
            name: "dev",
            script: "vite",
            preview: "Synthetic local Node server; no package/network calls",
          },
        ],
      };
    },
    async prepareCheck({ project: selected, name, manifestHash }) {
      assert.equal(name, "dev");
      assert.equal(manifestHash, HASH);
      return {
        projectId: selected.id,
        checkName: name,
        manifestHash,
        command: process.execPath,
        args: [serverFile],
        preview: "Synthetic local Node server; no package/network calls",
      };
    },
    async verifyCheck({ operation }) {
      assert.equal(operation.command, process.execPath);
      assert.equal(operation.manifestHash, HASH);
      return {
        command: process.execPath,
        args: [serverFile],
        cwd: project.path,
        env: {},
      };
    },
  };
  t.after(async () => {
    await host.close();
    await until(() => host.commandProcesses.size === 0);
    await host.store.queue;
    assert.equal(path.dirname(dir), base);
    assert.ok(path.basename(dir).startsWith("nakama-preview-host-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  await host.dispatch("POST", "/api/autonomous-tasks", {
    projectId: project.id,
    goal: "Launch the local website preview only after exact PC approval, then inspect its actual page.",
  });
  await until(() => calls.length === 1);
  const run = host.store.state.autonomousTasks.at(-1);
  const respond = async (value) =>
    calls.at(-1).onComplete({ code: 0, text: block(value) });
  await respond({ kind: "tool", tool: "project_previews", arguments: {} });
  await until(() => calls.length === 2);
  await respond({
    kind: "tool",
    tool: "project_preview",
    arguments: { name: "dev", manifestHash: HASH },
  });
  await until(() => run.status === "awaiting_approval");
  const receipt = run.receipts.at(-1),
    approval = host.store.state.approvals.find(
      (row) => row.id === receipt.approvalId,
    );
  return { host, run, receipt, approval, project, calls, respond };
}

test("real host preview approval preserves exact metadata and remains launch-only until separate acceptance", async (t) => {
  const f = await fixture(t);
  assert.equal(f.host.commandProcesses.size, 0);
  const resolved = await f.host.dispatch(
    "POST",
    `/api/approvals/${f.approval.id}/resolve`,
    { approved: true },
  );
  assert.equal(resolved.status, "completed");
  await until(() => f.calls.length === 3);
  assert.equal(f.receipt.status, "completed");
  const task = f.host.store.state.tasks.find(
      (row) => row.id === f.receipt.taskId,
    ),
    launch = f.host.projectPreviews.public(f.project.id);
  assert.equal(task.kind, "project_preview");
  assert.equal(task.autonomousRunId, f.run.id);
  assert.equal(task.autonomousReceiptId, f.receipt.id);
  assert.equal(task.approvalId, f.approval.id);
  assert.equal(task.previewLaunchId, launch.id);
  assert.equal(task.previewOrigin, launch.origin);
  assert.equal(task.checkName, "dev");
  assert.equal(task.manifestHash, HASH);
  assert.equal(f.receipt.observation.scope, "approved_process_launch_only");
  await until(() => task.output.includes("LOCAL_PREVIEW_READY"));
  const response = await fetch(launch.origin, {
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<h1>LOCAL_PREVIEW_FIXTURE</h1>");
  // A real local HTTP probe is test evidence, never silently attached as a
  // product acceptance result: the preview tool itself certifies only launch.
  await f.respond({ kind: "verify", receiptId: f.receipt.id });
  await until(() => f.calls.length === 4);
  assert.equal(f.receipt.verification.verified, true);
  assert.equal(f.receipt.verification.completionEligible, false);
  await f.respond({
    kind: "tool",
    tool: "project_preview_stop",
    arguments: { launchId: launch.id },
  });
  await until(() => f.calls.length === 5);
  const stopped = f.run.receipts.at(-1);
  assert.equal(stopped.tool, "project_preview_stop");
  assert.equal(stopped.status, "completed");
  assert.equal(stopped.reference.taskId, task.id);
  assert.equal(f.host.commandProcesses.size, 0);
  assert.equal(f.host.projectPreviews.public(f.project.id), null);
  assert.doesNotThrow(() => f.host.assertCheckAvailable(f.project.id));
  await f.respond({ kind: "tool", tool: "project_checks", arguments: {} });
  await until(() => f.calls.length === 6);
  const checks = f.run.receipts.at(-1).observation;
  assert.equal(checks.supported, true);
  await f.respond({
    kind: "tool",
    tool: "project_check",
    arguments: { name: "test", manifestHash: checks.manifestHash },
  });
  await until(() => f.run.status === "awaiting_approval");
  const checkReceipt = f.run.receipts.at(-1);
  await f.host.dispatch(
    "POST",
    `/api/approvals/${checkReceipt.approvalId}/resolve`,
    { approved: true },
  );
  await until(() => f.calls.length === 7);
  assert.equal(checkReceipt.status, "completed");
  assert.equal(checkReceipt.observation.exitCode, 0);
  assert.match(checkReceipt.observation.output, /PREVIEW_STOP_CHECK/);
  await f.host.dispatch("POST", `/api/autonomous-tasks/${f.run.id}/stop`, {});
  await until(() => f.host.commandProcesses.size === 0);
  assert.equal(f.run.status, "stopped");
  assert.equal(task.status, "stopped");
  assert.equal(f.host.projectPreviews.public(f.project.id), null);
});

test("real host rejects HTTP-supplied preview ownership and cancelled approval cannot spawn", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.host.dispatch("POST", `/api/projects/${f.project.id}/preview/start`, {
      name: "dev",
      manifestHash: HASH,
      autonomousRunId: f.run.id,
    }),
    /Unexpected preview fields/,
  );
  await f.host.dispatch("POST", `/api/autonomous-tasks/${f.run.id}/stop`, {});
  assert.equal(f.approval.status, "cancelled");
  await assert.rejects(
    f.host.dispatch("POST", `/api/approvals/${f.approval.id}/resolve`, {
      approved: true,
    }),
    /already resolved/,
  );
  assert.equal(f.host.commandProcesses.size, 0);
  assert.equal(f.host.projectPreviews.public(f.project.id), null);
});
