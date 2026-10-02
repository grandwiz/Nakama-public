import fs from "node:fs/promises";
import path from "node:path";
import {
  ApiError,
  digest,
  now,
  projectRoot,
  redact,
  safeFile,
  uid,
  within,
} from "./security.mjs";
import { regularBytes } from "./project-checkpoints.mjs";

export const REPORT_LIMITS = Object.freeze({
  pdfBytes: 1363148,
  images: 2,
  imageBytes: 262144,
  reportsPerProject: 50,
});
const ACTIVE = new Set(["queued", "generating"]);
const clean = (value, max = 1000) =>
  redact(String(value ?? ""))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .slice(0, max);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const keys = (body, allowed) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "Unexpected project report fields.");
};

export function reportAccess(host, principal) {
  if (host.closing) throw new ApiError(503, "Control Center is closing.");
  if (principal?.kind === "owner") return;
  const device =
    principal?.kind === "device" &&
    host.store.state.devices.find((item) => item.id === principal.id);
  if (
    !device ||
    device.platform !== "android" ||
    device.permissions?.googleAccess === false ||
    device.permissions?.projectAccess === false
  )
    throw new ApiError(
      403,
      "Project reports and file previews require Google and project access on a paired Android device.",
    );
}

export function protectedPreviewPath(value) {
  return (
    typeof value !== "string" ||
    !value ||
    value.length > 500 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    value
      .replaceAll("\\", "/")
      .split("/")
      .some((part) =>
        /^\.env(?:\.|$)|^\.(?:ssh|aws|azure|kube|npmrc|pypirc|netrc)$|^(?:credentials?|secrets?|auth|vault)(?:\.|$)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|p12|pfx|jks|keystore|key)$/i.test(
          part,
        ),
      )
  );
}

export function previewMime(bytes, name) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".pdf" && bytes.subarray(0, 5).toString() === "%PDF-")
    return "application/pdf";
  if (
    extension === ".png" &&
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (
      width > 0 &&
      height > 0 &&
      width <= 8192 &&
      height <= 8192 &&
      width * height <= 8_000_000
    )
      return "image/png";
  }
  if (
    [".jpg", ".jpeg"].includes(extension) &&
    bytes.length > 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  ) {
    let at = 2;
    while (at + 4 < bytes.length) {
      if (bytes[at++] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++],
        length = bytes.readUInt16BE(at);
      if (length < 2 || at + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        const height = bytes.readUInt16BE(at + 3),
          width = bytes.readUInt16BE(at + 5);
        if (
          width > 0 &&
          height > 0 &&
          width <= 8192 &&
          height <= 8192 &&
          width * height <= 8_000_000
        )
          return "image/jpeg";
        break;
      }
      at += length;
    }
  }
  throw new ApiError(
    415,
    "Preview supports bounded PDF, PNG and JPEG files with valid headers and image dimensions.",
  );
}

export async function readProjectPreview(host, projectId, relative, principal) {
  reportAccess(host, principal);
  if (protectedPreviewPath(relative))
    throw new ApiError(
      403,
      "Protected or credential paths cannot be previewed.",
    );
  const project = host.project(projectId),
    originalPath = project.path,
    workspaceRoot = host.store.state.config.workspaceRoot;
  const root = await projectRoot(workspaceRoot, project);
  const target = await safeFile(root, relative);
  const bytes = await regularBytes(target, REPORT_LIMITS.pdfBytes);
  await safeFile(root, relative);
  reportAccess(host, principal);
  if (
    host.project(projectId).path !== originalPath ||
    host.store.state.config.workspaceRoot !== workspaceRoot
  )
    throw new ApiError(409, "Project folder changed during preview.");
  const mimeType = previewMime(bytes, relative);
  return {
    path: relative,
    fileName: path.basename(relative),
    mimeType,
    base64: bytes.toString("base64"),
    bytes: bytes.length,
    sha256: digest(bytes),
  };
}

/** Snapshot only retained host receipts. Model prose is labelled, never parsed as test evidence. */
export function reportSnapshot(state, project, workflow, createdAt = now()) {
  const since = workflow ? Date.parse(workflow.createdAt) : 0;
  const tasks = state.tasks.filter(
    (task) =>
      task.projectId === project.id &&
      (!workflow || task.workflowId === workflow.id),
  );
  const files = [
    ...new Set(
      tasks.flatMap((task) =>
        Array.isArray(task.filesWritten) ? task.filesWritten : [],
      ),
    ),
  ]
    .filter((file) => !protectedPreviewPath(file))
    .slice(0, 100)
    .map((file) => clean(file, 500));
  const checks = state.tasks
    .filter(
      (task) =>
        task.projectId === project.id &&
        task.kind === "project_check" &&
        Date.parse(task.createdAt) >= since,
    )
    .slice(-20)
    .map((task) => ({
      name: clean(task.checkName || task.title, 100),
      status: clean(task.status, 40),
      exitCode: Number.isInteger(task.exitCode) ? task.exitCode : null,
      at: task.updatedAt || task.createdAt,
    }));
  const deployments = [
    ...state.approvals
      .filter(
        (item) =>
          item.type === "deploy" &&
          item.operation?.projectId === project.id &&
          Date.parse(item.createdAt) >= since,
      )
      .slice(-10)
      .map((item) => ({
        provider: clean(item.operation?.provider, 40),
        status: clean(
          item.result?.status || item.serviceExecution?.status || item.status,
          60,
        ),
        at: item.serviceExecution?.finishedAt || item.createdAt,
      })),
    ...(state.provisioningOperations || [])
      .filter(
        (item) =>
          item.projectId === project.id && Date.parse(item.startedAt) >= since,
      )
      .slice(-10)
      .map((item) => ({
        provider: clean(item.provider, 40),
        status: clean(
          `${item.action}: ${item.status}${item.verification?.providerStatus ? `; provider reports ${item.verification.providerStatus}` : item.result?.providerStatus ? `; provider receipt ${item.result.providerStatus}` : ""}`,
          240,
        ),
        at: item.verification?.checkedAt || item.finishedAt || item.startedAt,
      })),
  ]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-10);
  const reviews = (workflow?.reviews || []).slice(-2).map((item) => ({
    role: clean(item.role, 40),
    verdict: clean(item.verdict, 40),
    round: item.round,
    findings: Array.isArray(item.findings) ? item.findings.length : 0,
  }));
  return {
    version: 1,
    projectName: clean(project.name, 100),
    description: clean(project.description, 700),
    createdAt,
    workflowId: workflow?.id,
    status: clean(workflow?.status || "snapshot", 40),
    request: clean(
      workflow?.message || "Project snapshot requested by the user.",
      1800,
    ),
    summary: clean(
      workflow?.delivery ||
        "No manager delivery is recorded for this snapshot.",
      3600,
    ),
    deliverySummary: clean(
      (state.projectDeliveries || [])
        .filter(
          (item) =>
            item.projectId === project.id &&
            (!workflow || item.workflowId === workflow.id),
        )
        .at(-1)?.summary || "",
      3600,
    ),
    files,
    checks,
    dependencySummary: clean(workflow?.dependencySummary || "", 2000),
    dependencies: tasks
      .filter(
        (task) =>
          task.kind === "project_dependencies" &&
          Date.parse(task.createdAt) >= since,
      )
      .slice(-10)
      .map((task) => ({
        status: clean(task.status, 40),
        exitCode: Number.isInteger(task.exitCode) ? task.exitCode : null,
        at: task.updatedAt || task.createdAt,
      })),
    deployments,
    reviews,
    taskCount: tasks.length,
    evidenceNote:
      "This is a snapshot of saved Nakama receipts. Static review and model prose do not establish executed tests, deployment health or live device acceptance. Checks listed here are project receipts since this workflow began, not proof that they ran against the final files.",
  };
}

export function reportHtml(snapshot, images = []) {
  const e = (value) => escape(clean(value, 5000));
  const rows = (items, render, empty) =>
    items.length
      ? items.map(render).join("")
      : `<p class="quiet">${e(empty)}</p>`;
  const count = snapshot.checks.filter(
    (item) => item.status === "completed" && item.exitCode === 0,
  ).length;
  const date = Number.isFinite(Date.parse(snapshot.createdAt))
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(snapshot.createdAt))
    : snapshot.createdAt;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>Nakama project report</title><style>
  @page{size:A4;margin:17mm 16mm 20mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#26384a;font-size:10pt;line-height:1.48;margin:0}h1{font-size:28pt;line-height:1.13;margin:12px 0;color:#163650;overflow-wrap:anywhere}h2{font-size:15pt;color:#24485f;margin:26px 0 10px;break-after:avoid}h3{font-size:11pt;margin:0 0 8px}p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}header{background:#eaf5fa;border:1px solid #d3e9f1;border-radius:20px;padding:27px 30px;margin-bottom:20px;break-inside:avoid}.brand{font-size:10pt;letter-spacing:2px;text-transform:uppercase;color:#48778b;font-weight:bold}.stamp{display:inline-block;background:#fff;padding:5px 12px;border-radius:14px;font-size:9pt;color:#306658}.date{color:#567484;font-size:9pt}.stats{display:flex;gap:12px;margin:18px 0}.stat{flex:1;padding:12px 14px;border:1px solid #d8e7eb;border-radius:12px}.stat b{display:block;font-size:21pt;color:#3c718a}.stat span{font-size:8pt;color:#617684}.card{background:#f7fafc;border:1px solid #e0e8ee;padding:17px 20px;border-radius:12px;margin:10px 0;break-inside:avoid}.quiet{color:#6d7e8c;font-size:9pt}.note{border-left:4px solid #76b1ca;background:#eff8fc;padding:14px 18px;break-inside:avoid}ul{padding-left:20px;margin:7px 0}li{padding:3px 0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:9pt}th{text-align:left;color:#536e7f;background:#eef5f8}th,td{padding:9px 10px;border-bottom:1px solid #e0e9ee;overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}.files{columns:2;column-gap:26px;font-family:Consolas,monospace;font-size:9pt}figure{margin:16px 0;break-inside:avoid}img{display:block;max-width:100%;max-height:390px;margin:0 auto;border:1px solid #dce7ec;border-radius:10px}figcaption{font-size:8pt;color:#657b89;margin:7px 0;overflow-wrap:anywhere}.end{margin-top:26px;border-top:1px solid #dbe7ed;padding-top:10px;font-size:8pt;color:#718391}
  .review-heading{break-inside:avoid;break-after:avoid}figure img{background:#f0f7fa}
  </style></head><body><header><div class="brand">Nakama / project journal</div><h1>${e(snapshot.projectName)}</h1><p>${e(snapshot.description || "A little help. A lot possible.")}</p><p class="date">Created ${e(date)} UTC</p><span class="stamp">${e(snapshot.status === "completed" ? "Managed workflow delivered" : "Recorded project snapshot")}</span></header>
  <div class="stats"><div class="stat"><b>${snapshot.files.length}</b><span>saved file receipts</span></div><div class="stat"><b>${snapshot.taskCount}</b><span>recorded tasks</span></div><div class="stat"><b>${count}</b><span>successful check receipts</span></div></div>
  <h2>What you asked for</h2><p>${e(snapshot.request)}</p><h2>Outcome</h2><div class="card"><h3>Manager's recorded summary</h3><p>${e(snapshot.summary)}</p></div><p class="note">${e(snapshot.evidenceNote)}</p>
  ${snapshot.deliverySummary ? `<h2>Delivery manager update</h2><div class="card"><p>${e(snapshot.deliverySummary)}</p></div><p class="quiet">Recorded manager prose. Provider receipts and actual acceptance checks remain the evidence for external results.</p>` : ""}
  <h2>Files saved</h2>${rows(snapshot.files, () => "", "No eligible saved-file receipts are recorded.")}${snapshot.files.length ? `<ul class="files">${snapshot.files.map((file) => `<li>${e(file)}</li>`).join("")}</ul>` : ""}
  <div class="review-heading"><h2>Review and verification</h2>${rows(snapshot.reviews, (item) => `<p>${e(item.role)}: ${e(item.verdict)} - static review round ${e(item.round)}, ${item.findings} recorded findings.</p>`, "No managed static-review receipts are recorded.")}</div>
  ${snapshot.dependencies?.length || snapshot.dependencySummary ? `<h3>Dependency preparation</h3><p>${e(snapshot.dependencySummary || "Recorded npm ci execution with lifecycle scripts disabled.")}</p>${rows(snapshot.dependencies || [], (item) => `<p>npm ci: ${e(item.status)}, exit ${item.exitCode === null ? "not recorded" : item.exitCode} (${e(item.at)}).</p>`, "No dependency installation receipt is recorded.")}<p class="quiet">Dependency preparation is separate from application tests. A saved exit result does not prove installed packages are still unchanged or usable.</p>` : ""}
  ${snapshot.checks.length ? `<table><thead><tr><th>Recorded check</th><th>Outcome</th><th>Exit</th></tr></thead><tbody>${snapshot.checks.map((item) => `<tr><td>${e(item.name)}<br><span class="quiet">${e(item.at)}</span></td><td>${e(item.status)}</td><td>${item.exitCode === null ? "Not recorded" : item.exitCode}</td></tr>`).join("")}</tbody></table>` : '<p class="quiet">No executed project-check receipts are recorded for this reporting period. Tests are not claimed as passed.</p>'}
  <h2>Services and deployment</h2>${rows(snapshot.deployments, (item) => `<p>${e(item.provider)}: ${e(item.status)} (${e(item.at)}). Provider acceptance does not establish live health.</p>`, "No deployment receipt is recorded. This report does not deploy or publish the project.")}
  <h2>Visual evidence</h2>${rows(images, (item) => `<figure><img src="${item.dataUrl}" alt="${e(item.caption)}"><figcaption>${e(item.caption)}<br>${e(item.provenance)}</figcaption></figure>`, "No eligible project image was included. Reports never capture private browser sessions or invent screenshots.")}
  <div class="end">Saved locally by Nakama. Review before sharing: project descriptions and images may contain private information.${snapshot.workflowId ? `<br>Workflow receipt: ${e(snapshot.workflowId)}` : ""}</div></body></html>`;
}

export class ProjectReports {
  constructor(host, adapter) {
    this.host = host;
    this.adapter = adapter;
    this.active = new Map();
    this.closed = false;
  }
  entries() {
    return (this.host.store.state.projectReports ||= []);
  }
  access(principal, projectId) {
    if (this.closed) throw new ApiError(503, "Report service is closing.");
    reportAccess(this.host, principal);
    return this.host.project(projectId);
  }
  public(record) {
    const { principal, projectPath, workspaceRoot, ...data } = record;
    return structuredClone(data);
  }
  list(projectId, principal) {
    const project = this.access(principal, projectId);
    return {
      version: 1,
      available: Boolean(this.adapter),
      automaticEnabled: project.reportSettings?.automaticEnabled !== false,
      busy: this.active.has(projectId),
      reports: this.entries()
        .filter((item) => item.projectId === projectId)
        .map((item) => this.public(item))
        .reverse(),
      limits: REPORT_LIMITS,
    };
  }
  async settings(projectId, body, principal) {
    keys(body, ["automaticEnabled"]);
    if (typeof body.automaticEnabled !== "boolean")
      throw new ApiError(400, "Choose an automatic report preference.");
    return this.host.store.change(() => {
      const project = this.access(principal, projectId);
      project.reportSettings = { automaticEnabled: body.automaticEnabled };
      return project.reportSettings;
    });
  }
  async storage() {
    const dir = path.join(this.host.store.dir, "project-reports");
    await fs.mkdir(dir, { recursive: true });
    if (
      (await fs.lstat(dir)).isSymbolicLink() ||
      !within(await fs.realpath(this.host.store.dir), await fs.realpath(dir))
    )
      throw new ApiError(403, "Report storage must stay inside host data.");
    return dir;
  }
  async file(projectId, reportId, principal) {
    this.access(principal, projectId);
    const record = this.entries().find(
      (item) => item.id === reportId && item.projectId === projectId,
    );
    if (!record || record.status !== "ready")
      throw new ApiError(404, "A ready project report was not found.");
    const file = path.join(await this.storage(), `${record.id}.pdf`);
    const bytes = await regularBytes(file, REPORT_LIMITS.pdfBytes);
    this.access(principal, projectId);
    if (
      bytes.length !== record.bytes ||
      digest(bytes) !== record.sha256 ||
      bytes.subarray(0, 5).toString() !== "%PDF-"
    )
      throw new ApiError(
        409,
        "Saved report changed or is incomplete. Generate a new report.",
      );
    return {
      fileName: record.fileName,
      mimeType: "application/pdf",
      bytes: bytes.length,
      base64: bytes.toString("base64"),
      sha256: record.sha256,
    };
  }
  async remove(projectId, reportId, principal) {
    this.access(principal, projectId);
    const record = this.entries().find(
      (item) => item.id === reportId && item.projectId === projectId,
    );
    if (!record) throw new ApiError(404, "Report not found.");
    if (ACTIVE.has(record.status))
      throw new ApiError(409, "Wait for report generation to finish.");
    await this.host.store.change(() => {
      this.access(principal, projectId);
      this.host.store.state.projectReports = this.entries().filter(
        (item) => item !== record,
      );
    });
    const file = path.join(await this.storage(), `${record.id}.pdf`);
    const stat = await fs.lstat(file).catch(() => null);
    if (stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1)
      await fs.unlink(file);
    return { removed: true };
  }
  async request(projectId, body, principal, automatic = false) {
    keys(body, ["workflowId", "images"]);
    const project = this.access(principal, projectId);
    if (!this.adapter)
      throw new ApiError(
        503,
        "PDF reports need the Windows Control Center renderer.",
      );
    if (this.active.has(projectId))
      throw new ApiError(
        409,
        "A report for this project is already being prepared.",
      );
    if (
      body.images !== undefined &&
      (!Array.isArray(body.images) || body.images.length > REPORT_LIMITS.images)
    )
      throw new ApiError(400, "Choose at most two project images.");
    for (const item of body.images || []) {
      keys(item, ["kind", "path", "caption"]);
      if (
        item.kind !== "project" ||
        protectedPreviewPath(item.path) ||
        (item.caption !== undefined &&
          (typeof item.caption !== "string" || item.caption.length > 200))
      )
        throw new ApiError(400, "Choose a project image with a short caption.");
    }
    const workflow =
      body.workflowId === undefined
        ? this.host.store.state.projectWorkflows
            .filter((item) => item.projectId === projectId)
            .at(-1)
        : this.host.store.state.projectWorkflows.find(
            (item) =>
              item.id === body.workflowId && item.projectId === projectId,
          );
    if (body.workflowId !== undefined && !workflow)
      throw new ApiError(404, "Workflow does not belong to this project.");
    const record = {
      id: uid(),
      projectId,
      workflowId: workflow?.id,
      status: "queued",
      createdAt: now(),
      fileName: `${clean(project.name, 60).replace(/[^a-zA-Z0-9_-]+/g, "-") || "project"}-report.pdf`,
      imageCount: 0,
      automatic,
      principal: { ...principal },
      projectPath: project.path,
      workspaceRoot: this.host.store.state.config.workspaceRoot,
    };
    // Reserve before the queued state change so simultaneous requests cannot both start.
    this.active.set(projectId, Promise.resolve());
    try {
      await this.host.store.change(() => {
        this.access(principal, projectId);
        if (
          this.entries().filter((item) => item.projectId === projectId)
            .length >= REPORT_LIMITS.reportsPerProject
        )
          throw new ApiError(
            409,
            "This project has 50 reports. Forget an older report before creating another.",
          );
        this.entries().push(record);
      });
    } catch (error) {
      this.active.delete(projectId);
      throw error;
    }
    const snapshot = reportSnapshot(
      this.host.store.state,
      project,
      workflow,
      record.createdAt,
    );
    const task = this.generate(record, snapshot, body.images).finally(() =>
      this.active.delete(projectId),
    );
    this.active.set(projectId, task);
    return this.public(record);
  }
  async generate(record, snapshot, chosenImages) {
    let file;
    const guard = () => {
      const project = this.access(record.principal, record.projectId);
      if (
        project.path !== record.projectPath ||
        this.host.store.state.config.workspaceRoot !== record.workspaceRoot
      )
        throw new ApiError(
          409,
          "Project folder changed during report generation.",
        );
    };
    try {
      await this.host.store.change(() => {
        guard();
        record.status = "generating";
      });
      const images = [];
      if (chosenImages !== undefined)
        for (const item of chosenImages) {
          const result = await readProjectPreview(
            this.host,
            record.projectId,
            item.path,
            record.principal,
          );
          if (
            !result.mimeType.startsWith("image/") ||
            result.bytes > REPORT_LIMITS.imageBytes
          )
            throw new ApiError(
              413,
              "Report images must be PNG/JPEG and at most 256 KiB each.",
            );
          const dataUrl = await this.adapter.image(
            Buffer.from(result.base64, "base64"),
          );
          images.push({
            dataUrl,
            caption: clean(item.caption || path.basename(item.path), 200),
            provenance: `User-selected project file: ${clean(item.path, 500)}; SHA-256 ${result.sha256}. Read ${record.createdAt}. This image is not proof of a live test.`,
          });
        }
      else
        for (const image of (
          this.host.browserStudio?.reportImages?.(record.projectId) || []
        ).slice(0, REPORT_LIMITS.images)) {
          try {
            if (
              !Buffer.isBuffer(image.bytes) ||
              image.bytes.length > REPORT_LIMITS.imageBytes ||
              !Number.isFinite(Date.parse(image.capturedAt))
            )
              continue;
            const target = new URL(image.url);
            if (
              !["http:", "https:"].includes(target.protocol) ||
              !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
              target.username ||
              target.password ||
              target.search ||
              target.hash
            )
              continue;
            previewMime(
              image.bytes,
              image.mimeType === "image/png" ? "preview.png" : "preview.jpg",
            );
            images.push({
              dataUrl: await this.adapter.image(image.bytes),
              caption: clean(
                image.caption || "Saved local project preview",
                200,
              ),
              provenance: `Previously captured local project preview: ${clean(image.url, 400)}; captured ${image.capturedAt}; SHA-256 ${digest(image.bytes)}. No new browser capture or live acceptance was performed for this report.`,
            });
          } catch {
            /* Optional visual evidence must never block the recorded project outcome. */
          }
        }
      guard();
      const bytes = await this.adapter.render(reportHtml(snapshot, images));
      guard();
      if (
        !Buffer.isBuffer(bytes) ||
        bytes.length > REPORT_LIMITS.pdfBytes ||
        bytes.subarray(0, 5).toString() !== "%PDF-"
      )
        throw new ApiError(
          413,
          "PDF output is invalid or exceeds the report size limit. Try fewer images.",
        );
      file = path.join(await this.storage(), `${record.id}.pdf`);
      await fs.writeFile(file, bytes, { flag: "wx" });
      await this.host.store.change(() => {
        guard();
        Object.assign(record, {
          status: "ready",
          completedAt: now(),
          bytes: bytes.length,
          sha256: digest(bytes),
          imageCount: images.length,
        });
      });
    } catch (error) {
      if (file) await fs.unlink(file).catch(() => {});
      await this.host.store
        .change(() => {
          Object.assign(record, {
            status: "failed",
            completedAt: now(),
            error: clean(
              error.status
                ? error.message
                : "The PDF renderer did not complete. The project outcome is unchanged.",
              500,
            ),
          });
        })
        .catch(() => {});
    }
  }
  async onWorkflowCompleted(workflow) {
    try {
      const project = this.host.project(workflow.projectId);
      if (
        project.reportSettings?.automaticEnabled === false ||
        this.entries().some(
          (item) => item.workflowId === workflow.id && item.automatic,
        )
      )
        return;
      const principal = this.host.projectWorkflows.principal(workflow);
      if (!this.adapter) {
        await this.host.store.change(() => {
          workflow.reportError =
            "Automatic PDF needs Windows Control Center; project delivery is unchanged.";
        });
        return;
      }
      const report = await this.request(
        project.id,
        { workflowId: workflow.id },
        principal,
        true,
      );
      await this.host.store.change(() => {
        workflow.reportId = report.id;
      });
    } catch (error) {
      await this.host.store
        .change(() => {
          workflow.reportError = clean(
            error.status
              ? error.message
              : "Automatic report was not generated. Project delivery is unchanged.",
            500,
          );
        })
        .catch(() => {});
    }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.active.values()]);
    await this.adapter?.close?.();
  }
}
