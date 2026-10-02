import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import {
  reportSnapshot,
  reportHtml,
  REPORT_LIMITS,
} from "../apps/host/project-reports.mjs";

const PHONE = { kind: "device", id: "report-phone" };
const delay = () => new Promise((resolve) => setImmediate(resolve));
async function fixture(t, adapter) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-report-test-"));
  const workspaceRoot = path.join(dir, "projects");
  await fs.mkdir(workspaceRoot);
  const rendered = [];
  const host = await new NakamaHost({
    dataDir: path.join(dir, "data"),
    reportAdapter:
      adapter === null
        ? undefined
        : adapter || {
            render: async (html) => {
              rendered.push(html);
              return Buffer.from("%PDF-1.7\nsynthetic test fixture\n%%EOF");
            },
            image: async () => "data:image/jpeg;base64,Zml4dHVyZQ==",
          },
    runAgent: () => {
      throw new Error("No model calls in report fixtures");
    },
  }).init();
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Garden project",
    description: "A friendly local garden.",
  });
  await host.store.change((state) =>
    state.devices.push({
      id: PHONE.id,
      platform: "android",
      permissions: { googleAccess: true, projectAccess: true },
    }),
  );
  t.after(async () => {
    await host.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const route = `/api/projects/${project.id}/reports`;
  const settle = async () => {
    await Promise.all([...host.reports.active.values()]);
  };
  return { host, project, route, rendered, settle, dir };
}
test("project reports default on, preserve state, produce bounded downloadable receipts and forget only report", async (t) => {
  const { host, project, route, settle } = await fixture(t);
  assert.equal(
    (await host.dispatch("GET", route, {}, PHONE)).automaticEnabled,
    true,
  );
  await fs.writeFile(path.join(project.path, "keep.txt"), "keep my file");
  const report = await host.dispatch("POST", route, {}, PHONE);
  await settle();
  const ready = (await host.dispatch("GET", route, {}, PHONE)).reports[0];
  assert.equal(ready.status, "ready");
  assert.equal(ready.id, report.id);
  assert.equal(ready.imageCount, 0);
  const data = await host.dispatch(
    "GET",
    `${route}/${ready.id}/file`,
    {},
    PHONE,
  );
  assert.equal(data.mimeType, "application/pdf");
  assert.ok(data.bytes <= REPORT_LIMITS.pdfBytes);
  assert.equal(Buffer.from(data.base64, "base64").length, data.bytes);
  assert.equal(
    JSON.stringify(await host.dispatch("GET", "/api/state")).includes(
      "synthetic test fixture",
    ),
    false,
  );
  await host.dispatch("DELETE", `${route}/${ready.id}`, {}, PHONE);
  assert.equal((await host.dispatch("GET", route)).reports.length, 0);
  assert.equal(
    await fs.readFile(path.join(project.path, "keep.txt"), "utf8"),
    "keep my file",
  );
  await assert.rejects(
    host.dispatch("GET", `${route}/${ready.id}/file`),
    /not found/,
  );
});
test("snapshot separates actual files/check receipts from model prose and escapes all displayed text", () => {
  const state = {
    tasks: [
      {
        id: "writer",
        projectId: "p",
        workflowId: "w",
        filesWritten: ["src/main.js", ".env"],
      },
      {
        projectId: "p",
        kind: "project_check",
        checkName: "test",
        status: "completed",
        exitCode: 0,
        createdAt: "2026-10-02T00:01:00Z",
      },
      {
        projectId: "p",
        kind: "command",
        status: "completed",
        output: "All tests passed",
      },
      {
        projectId: "p",
        workflowId: "w",
        kind: "project_dependencies",
        status: "completed",
        exitCode: 0,
        createdAt: "2026-10-02T00:01:00Z",
      },
    ],
    approvals: [],
  };
  const workflow = {
    id: "w",
    status: "completed",
    createdAt: "2026-10-02T00:00:00Z",
    message: "<script>fetch('https://invalid.test')</script>",
    delivery:
      "Claim: tests passed and deployed.\nAPI_KEY=synthetic-secret-value",
    reviews: [{ role: "manager", verdict: "pass", round: 0, findings: [] }],
  };
  const data = reportSnapshot(
    state,
    { id: "p", name: '<img src="https://invalid.test">' },
    workflow,
  );
  assert.deepEqual(data.files, ["src/main.js"]);
  assert.equal(data.checks.length, 1);
  assert.equal(data.dependencies.length, 1);
  assert.equal(data.deployments.length, 0);
  const html = reportHtml(data);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('src="https://invalid.test"'));
  assert.ok(!html.includes("synthetic-secret-value"));
  assert.match(html, /Manager&#39;s|Manager's recorded summary/);
  assert.match(html, /No deployment receipt/);
  assert.match(html, /npm ci: completed, exit 0/);
  assert.match(
    html,
    /Dependency preparation is separate from application tests/,
  );
  assert.match(html, /not proof that they ran against the final files/);
});
test("reports refuse denied phones, Chrome, malformed body and cross-project report ids", async (t) => {
  const { host, route, project, settle } = await fixture(t);
  const report = await host.dispatch("POST", route, {});
  await settle();
  const other = await host.dispatch("POST", "/api/projects", { name: "Other" });
  await assert.rejects(
    host.dispatch("GET", `/api/projects/${other.id}/reports/${report.id}/file`),
    /not found/,
  );
  await assert.rejects(
    host.dispatch("POST", route, { title: "Injected" }),
    /Unexpected/,
  );
  await host.dispatch("POST", route, {
    images: [{ kind: "project", path: "../outside.png" }],
  });
  await settle();
  const invalidImage = (await host.dispatch("GET", route)).reports[0];
  assert.equal(invalidImage.status, "failed");
  assert.match(invalidImage.error, /path|protected/i);
  host.store.state.devices[0].permissions.googleAccess = false;
  for (const [method, suffix, body] of [
    ["GET", "", {}],
    ["POST", "", {}],
    ["GET", `/${report.id}/file`, {}],
    ["PATCH", "/settings", { automaticEnabled: false }],
    ["DELETE", `/${report.id}`, {}],
  ])
    await assert.rejects(
      host.dispatch(method, route + suffix, body, PHONE),
      /access/,
    );
  host.store.state.devices.push({
    id: "chrome",
    platform: "chrome",
    permissions: {},
  });
  await assert.rejects(
    host.dispatch("GET", route, {}, { kind: "device", id: "chrome" }),
    /Chrome/,
  );
  assert.ok(
    !JSON.stringify(
      await host.dispatch("GET", "/api/state", {}, PHONE),
    ).includes(report.id),
  );
  assert.equal(host.project(project.id).name, "Garden project");
});
test("permission revocation while rendering prevents saved PDF and ready receipt", async (t) => {
  let release, started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const { host, route, settle } = await fixture(t, {
    render: async () => {
      started();
      await waiting;
      return Buffer.from("%PDF-1.7 test");
    },
  });
  await host.dispatch("POST", route, {}, PHONE);
  await began;
  host.store.state.devices[0].permissions.googleAccess = false;
  release();
  await settle();
  const report = (await host.dispatch("GET", route)).reports[0];
  assert.equal(report.status, "failed");
  assert.match(report.error, /access/);
  await assert.rejects(
    host.dispatch("GET", `${route}/${report.id}/file`),
    /not found/,
  );
});
test("automatic workflow completion is idempotent, settings pause it and failures do not change delivered status", async (t) => {
  const { host, project, route, settle } = await fixture(t);
  const workflow = {
    id: "workflow",
    projectId: project.id,
    status: "completed",
    createdAt: new Date().toISOString(),
    startedBy: { kind: "owner", id: "desktop" },
    reviews: [],
    taskIds: [],
  };
  host.store.state.projectWorkflows.push(workflow);
  // Workflow principal is represented as separate host fields, not client input.
  workflow.requestedBy = "desktop";
  workflow.requesterKind = "owner";
  await host.reports.onWorkflowCompleted(workflow);
  await settle();
  await host.reports.onWorkflowCompleted(workflow);
  assert.equal((await host.dispatch("GET", route)).reports.length, 1);
  assert.equal(workflow.status, "completed");
  await host.dispatch("PATCH", `${route}/settings`, {
    automaticEnabled: false,
  });
  await host.reports.onWorkflowCompleted({
    ...workflow,
    id: "paused-workflow",
  });
  assert.equal((await host.dispatch("GET", route)).reports.length, 1);
  host.reports.adapter = {
    render: async () => {
      throw new Error("Renderer failed");
    },
  };
  await host.dispatch("POST", route, {});
  await settle();
  assert.equal((await host.dispatch("GET", route)).reports[0].status, "failed");
  assert.equal(workflow.status, "completed");
});
test("standalone host is honestly unavailable and duplicate generation is reserved before persistence", async (t) => {
  const unavailable = await fixture(t, null);
  assert.equal(
    (await unavailable.host.dispatch("GET", unavailable.route)).available,
    false,
  );
  await assert.rejects(
    unavailable.host.dispatch("POST", unavailable.route, {}),
    /Windows/,
  );
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { host, route, settle } = await fixture(t, {
    render: async () => {
      await gate;
      return Buffer.from("%PDF-1.7 test");
    },
  });
  const first = host.dispatch("POST", route, {});
  await assert.rejects(host.dispatch("POST", route, {}), /already/);
  await first;
  release();
  await settle();
});
test("file previews validate type/size/path and recheck permission after bounded read", async (t) => {
  const { host, project } = await fixture(t);
  const endpoint = (relative) =>
    `/api/projects/${project.id}/file-preview?path=${encodeURIComponent(relative)}`;
  await fs.writeFile(
    path.join(project.path, "sample.pdf"),
    "%PDF-1.7\nfixture\n%%EOF",
  );
  const result = await host.dispatch("GET", endpoint("sample.pdf"), {}, PHONE);
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.path, "sample.pdf");
  for (const relative of [
    "../outside.pdf",
    ".git/config",
    "credentials.pdf",
    "vault.png",
  ])
    await assert.rejects(host.dispatch("GET", endpoint(relative), {}, PHONE));
  await fs.writeFile(
    path.join(project.path, "wrong.png"),
    "<script>not an image</script>",
  );
  await assert.rejects(
    host.dispatch("GET", endpoint("wrong.png")),
    /Preview supports/,
  );
  await fs.writeFile(
    path.join(project.path, "large.pdf"),
    Buffer.alloc(REPORT_LIMITS.pdfBytes + 1),
  );
  await assert.rejects(host.dispatch("GET", endpoint("large.pdf")), /large/);
  host.store.state.devices[0].permissions.googleAccess = false;
  await assert.rejects(
    host.dispatch("GET", endpoint("sample.pdf"), {}, PHONE),
    /access/,
  );
});
test("explicit empty images opts out of automatic preview images and output over limit is failed", async (t) => {
  const { host, project, route, rendered, settle } = await fixture(t);
  let reads = 0;
  host.browserStudio.reportImages = () => {
    reads++;
    return [];
  };
  await host.dispatch("POST", route, { images: [] });
  await settle();
  assert.equal(reads, 0);
  await host.dispatch("POST", route, {});
  await settle();
  assert.equal(reads, 1);
  assert.ok(
    rendered.every((html) => html.includes("No eligible project image")),
  );
  host.reports.adapter = {
    render: async () =>
      Buffer.concat([
        Buffer.from("%PDF-1.7"),
        Buffer.alloc(REPORT_LIMITS.pdfBytes),
      ]),
  };
  await host.dispatch("POST", route, {});
  await settle();
  assert.equal((await host.dispatch("GET", route)).reports[0].status, "failed");
});
