import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  ApiError,
  digest,
  now,
  uid,
  text,
  requireOwner,
  workspace,
  within,
} from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { projectSnapshot } from "./build-files.mjs";
import {
  stageSource,
  ordinaryPath,
  validateTrustedKeys,
  verifyRelease,
  backupPrivateState,
} from "./self-maintenance-files.mjs";

const OWNER = { kind: "owner", id: "desktop" };
const active = new Set([
  "running",
  "queued",
  "awaiting_answers",
  "awaiting_approval",
  "awaiting_result",
]);
const reject = (message) => {
  throw new ApiError(409, message);
};
const sourceDigest = (snapshot) =>
  digest(JSON.stringify([...snapshot].sort(([a], [b]) => a.localeCompare(b))));

export class SelfMaintenance {
  constructor(host, { adapter } = {}) {
    this.host = host;
    this.adapter = adapter;
    this.locks = new Set();
  }
  async init() {
    await this.host.store.change((state) => {
      state.selfMaintenance ||= {
        settings: { sourcePath: "", trustedKeys: [] },
        requests: [],
      };
      for (const row of state.selfMaintenance.requests)
        if (
          [
            "staging",
            "starting",
            "packaging",
            "installing",
            "awaiting_install_approval",
          ].includes(row.status)
        ) {
          row.status = "interrupted";
          row.detail =
            "Interrupted by restart. Inspect saved files and receipts; no model work or installer is replayed.";
          row.revision++;
          row.updatedAt = now();
        }
      for (const approval of state.approvals)
        if (
          approval.type === "self_update" &&
          ["pending", "executing"].includes(approval.status)
        ) {
          approval.status = "cancelled";
          approval.error =
            "Update interrupted by restart; request a fresh exact approval.";
        }
    });
    return this;
  }
  get state() {
    return this.host.store.state.selfMaintenance;
  }
  get(id) {
    const row = this.state.requests.find((r) => r.id === id);
    if (!row) throw new ApiError(404, "Upgrade request not found.");
    return row;
  }
  access(principal, row, write = false) {
    assertPersonalAccess(this.host.store.state, principal);
    if (write && principal.kind !== "owner" && row.requestedBy !== principal.id)
      throw new ApiError(403, "A phone can stop only its own upgrade request.");
  }
  checkRevision(row, body) {
    if (body.expectedRevision !== row.revision)
      reject("This upgrade request changed. Refresh it before continuing.");
  }
  async change(row, patch) {
    await this.host.store.change(() =>
      Object.assign(row, patch, {
        revision: row.revision + 1,
        updatedAt: now(),
      }),
    );
  }
  public(row) {
    const {
      candidatePath,
      sourcePath,
      sourceFiles,
      packages,
      backupPath,
      assignments,
      ...safe
    } = structuredClone(row);
    const flow = this.host.store.state.projectWorkflows.find(
      (w) => w.id === row.workflowId,
    );
    if (flow) {
      safe.workflowStatus = flow.status;
      safe.questions = (flow.questions || []).map(({ id, text, answer }) => ({
        id,
        text,
        answer,
      }));
    }
    return safe;
  }
  list(principal) {
    this.access(principal);
    return {
      requests: this.state.requests.map((r) => this.public(r)),
      settings: {
        hold: true,
        ...(principal.kind === "owner"
          ? structuredClone(this.state.settings)
          : {}),
      },
      capabilities: {
        available: true,
        installer: !!this.adapter?.handoff,
        detail:
          "Save requests without model usage. Each development run requires explicit Windows release after allowance returns. Signed packages require exact PC approval; installer handoff does not prove installation or health. Recovery backups require manual review.",
      },
    };
  }
  async locked(id, fn) {
    if (this.locks.has(id)) reject("This upgrade request is busy.");
    this.locks.add(id);
    try {
      return await fn();
    } finally {
      this.locks.delete(id);
    }
  }
  async route(method, route, body = {}, principal = OWNER) {
    if (route === "/api/self-maintenance" && method === "GET")
      return this.list(principal);
    if (route === "/api/self-maintenance" && method === "POST") {
      this.access(principal);
      const row = {
        id: uid(),
        title: text(body.title, "Title", 160),
        request: text(body.request, "Requested improvement", 16000),
        requestedBy: principal.id,
        status: "held",
        revision: 1,
        createdAt: now(),
        updatedAt: now(),
        detail:
          "Saved. Provider use remains on hold until you explicitly start this request in Windows after allowance returns.",
      };
      await this.host.store.change(() => {
        this.access(principal);
        if (this.state.requests.length >= 50)
          reject("Keep at most 50 upgrade requests.");
        this.state.requests.push(row);
      });
      return this.public(row);
    }
    if (route === "/api/self-maintenance/settings" && method === "PATCH") {
      requireOwner(principal);
      if (
        Object.keys(body).some(
          (k) => !["sourcePath", "trustedKeys"].includes(k),
        )
      )
        throw new ApiError(400, "Unknown upgrade setting.");
      const settings = {};
      if (body.sourcePath !== undefined) {
        settings.sourcePath = await ordinaryPath(
          text(body.sourcePath, "Source folder", 2000),
          true,
        );
        if (
          within(settings.sourcePath, this.host.store.dir) ||
          within(this.host.store.dir, settings.sourcePath)
        )
          reject("Runtime private data cannot be used as source.");
      }
      if (body.trustedKeys !== undefined)
        settings.trustedKeys = validateTrustedKeys(body.trustedKeys);
      const addsTrust = () =>
        (settings.trustedKeys || []).some(
          (next) =>
            !this.state.settings.trustedKeys.some(
              (old) => old.id === next.id && old.publicKey === next.publicKey,
            ),
        );
      if (body.trustedKeys !== undefined && addsTrust())
        this.host.remoteDesktop?.assertOwnerApprovalAllowed();
      await this.host.store.change(() => {
        if (body.trustedKeys !== undefined && addsTrust())
          this.host.remoteDesktop?.assertOwnerApprovalAllowed();
        this.state.settings = { ...this.state.settings, ...settings };
      });
      return this.list(principal);
    }
    const match =
      /^\/api\/self-maintenance\/([^/]+)\/(stage|start|refresh|stop|package|install-request|recovery)$/.exec(
        route,
      );
    if (
      !match ||
      (method !== "POST" && !(method === "GET" && match[2] === "recovery"))
    )
      throw new ApiError(404, "Upgrade route not found.");
    const row = this.get(match[1]),
      action = match[2];
    this.access(principal, row, action === "stop");
    if (!["refresh", "stop"].includes(action)) requireOwner(principal);
    if (action === "recovery" && method === "GET") return this.recovery(row);
    return this.locked(row.id, async () => {
      if (action !== "refresh") this.checkRevision(row, body);
      if (action === "stage") return this.stage(row);
      if (action === "start") return this.start(row, body);
      if (action === "refresh") return this.refresh(row);
      if (action === "stop") return this.stop(row);
      if (action === "package") return this.package(row, body);
      if (action === "install-request")
        return this.requestInstall(row, principal);
      return this.recovery(row);
    });
  }
  async stage(row) {
    if (!["held", "staging_failed"].includes(row.status))
      reject("Create a new request to stage a new source candidate.");
    if (!this.state.settings.sourcePath)
      reject("Choose the reviewed Nakama source folder in Windows first.");
    const root = await workspace(this.host.store.state.config.workspaceRoot);
    const destination = path.join(root, `Nakama-upgrade-${uid()}`);
    const source = this.state.settings.sourcePath;
    await this.change(row, {
      status: "staging",
      sourcePath: source,
      candidatePath: destination,
      detail: "Creating a separate source copy. No model is running.",
    });
    try {
      const result = await stageSource(source, destination);
      const project = {
        id: uid(),
        name: `Nakama upgrade: ${row.title}`,
        path: destination,
        createdAt: now(),
        updatedAt: now(),
        reportEnabled: false,
      };
      await this.host.store.change((state) => {
        if (
          state.config.workspaceRoot !== root &&
          path.resolve(state.config.workspaceRoot) !== root
        )
          reject("Workspace changed while source was staged.");
        state.projects.push(project);
        Object.assign(row, {
          status: "staged",
          candidatePath: destination,
          projectId: project.id,
          sourceFiles: result.files,
          exportHash: result.sourceHash,
          revision: row.revision + 1,
          updatedAt: now(),
          detail: `Isolated ${result.files.length} tracked source working copies. Ignored and untracked files were excluded. Model usage remains on hold. The original source and installed data are unchanged.`,
        });
      });
    } catch (error) {
      await this.change(row, {
        status: "staging_failed",
        detail:
          "Source staging failed; partial candidate files are retained for inspection.",
        error: error.message,
      });
      throw error;
    }
    return this.public(row);
  }
  async start(row, body) {
    if (row.status !== "staged" || row.workflowId)
      reject(
        "Only a freshly staged request can start. Interrupted runs need a new reviewed request.",
      );
    if (body.confirmProviderUse !== true)
      reject(
        "Explicitly confirm that allowance is restored and this development run may use the saved providers.",
      );
    const roles = structuredClone(this.host.store.state.config.aiRoles),
      team = structuredClone(this.host.store.state.config.projectTeam);
    await this.change(row, {
      status: "starting",
      assignments: {
        manager: roles.planning,
        development: roles.development,
        peer: team.peer,
      },
      detail:
        "Explicitly released for one managed development run; no paid fallback or automatic retry.",
    });
    try {
      const result = await this.host.projectWorkflows.start(
        {
          projectId: row.projectId,
          message: `Maintain Nakama itself in this isolated candidate. Requested change: ${row.request}\nPreserve configurable roles, manager-routed questions, independent reviews, approval/privacy boundaries, compatibility with data schema 1 and Android signing identity. Never read installed profiles/runtime data or signing keys. Never install, publish, deploy or replace the running app. Do not weaken tests, alter signing identity, remove safety checks or infer live acceptance. Preserve package test and build checks. Build/signing and installation are later explicit operations.`,
          deliveryRequested: false,
        },
        OWNER,
        {
          ...roles.planning,
          development: roles.development,
          role: "planning",
          mode: "build",
        },
      );
      await this.change(row, {
        status: "developing",
        workflowId: result.workflowId,
        error: "",
        detail:
          "The configured managed team owns the isolated candidate. Questions and exact check approvals use the existing workflow.",
      });
    } catch (error) {
      await this.change(row, {
        status: "interrupted",
        error: error.message,
        detail:
          "No automatic retry. Inspect any saved workflow before creating a new request.",
      });
      throw error;
    }
    return this.public(row);
  }
  async readiness(row) {
    const flow = this.host.store.state.projectWorkflows.find(
      (w) => w.id === row.workflowId,
    );
    if (!flow || flow.status !== "completed")
      return {
        ready: false,
        detail: flow
          ? `Managed workflow is ${flow.status}; both reviews and executed checks must finish.`
          : "No managed development workflow has completed.",
      };
    if (
      flow.projectId !== row.projectId ||
      flow.projectPath !== row.candidatePath
    )
      reject("The candidate/workflow association changed.");
    const root = await ordinaryPath(row.candidatePath, true),
      snapshot = await projectSnapshot(root);
    if (!isDeepStrictEqual(snapshot, new Map(flow.snapshot)))
      return {
        ready: false,
        detail:
          "Candidate source changed after review. A new managed review is required.",
      };
    const round = flow.reviewRound;
    const reviews = (flow.reviews || []).filter((r) => r.round === round);
    const manager = reviews.find((r) => r.role === "manager"),
      peer = reviews.find((r) => r.role === "peer");
    if (
      !manager ||
      !peer ||
      manager.verdict !== "pass" ||
      peer.verdict !== "pass" ||
      manager.findings?.length ||
      peer.findings?.length ||
      !flow.assignments?.manager ||
      !flow.assignments?.peer ||
      (flow.assignments.manager.providerId ===
        flow.assignments.peer.providerId &&
        flow.assignments.manager.model === flow.assignments.peer.model)
    )
      return {
        ready: false,
        detail: "Two independent passing reviews are required.",
      };
    const names = flow.checkNames || [];
    if (!names.includes("test") || !names.includes("build"))
      return {
        ready: false,
        detail:
          "Self-upgrades require actual test and build checks; static-only completion is insufficient.",
      };
    const checks = [];
    for (const name of names) {
      const receipts = (flow.checkReceipts || []).filter(
        (r) =>
          r.round === round &&
          r.checkName === name &&
          (!r.kind || r.kind === "project_check"),
      );
      const receipt = receipts.at(-1),
        task = this.host.store.state.tasks.find(
          (t) => t.id === receipt?.taskId,
        ),
        approval = this.host.store.state.approvals.find(
          (a) => a.id === receipt?.approvalId,
        );
      if (
        !receipt ||
        receipt.status !== "completed" ||
        receipt.exitCode !== 0 ||
        receipt.signal ||
        !task ||
        task.status !== "completed" ||
        task.exitCode !== 0 ||
        task.signal ||
        task.kind !== "project_check" ||
        task.workflowId !== flow.id ||
        task.projectId !== row.projectId ||
        task.approvalId !== receipt.approvalId ||
        task.checkName !== name ||
        task.manifestHash !== receipt.manifestHash ||
        !approval ||
        approval.status !== "started" ||
        approval.type !== "project_check" ||
        approval.result?.taskId !== task.id ||
        approval.operation?.workflowId !== flow.id ||
        approval.operation?.projectId !== row.projectId ||
        approval.operation?.manifestHash !== receipt.manifestHash
      )
        return {
          ready: false,
          detail: `The ${name} check has no matching executed, approved success receipt.`,
        };
      checks.push({ name, taskId: task.id, approvalId: approval.id });
    }
    return {
      ready: true,
      detail:
        "The current candidate matches both independent reviews and actual approved test/build receipts. Live/device acceptance remains separate.",
      sourceHash: sourceDigest(snapshot),
      checks,
      reviews: reviews.map(({ role, verdict, summary }) => ({
        role,
        verdict,
        summary,
      })),
    };
  }
  async refresh(row) {
    const readiness = await this.readiness(row);
    const approval = this.host.store.state.approvals.find(
      (a) => a.id === row.approvalId,
    );
    const unattempted =
      row.status === "awaiting_install_approval" &&
      approval &&
      (["rejected", "cancelled", "failed"].includes(approval.status) ||
        (approval.status === "pending" &&
          Date.parse(approval.expiresAt) <= Date.now()));
    if (unattempted) {
      await this.change(row, {
        status: "packaged",
        readiness,
        approvalId: null,
        detail:
          "The previous approval did not hand off an installer. Review the prepared packages and request a fresh exact approval when ready.",
      });
      return this.public(row);
    }
    if (!isDeepStrictEqual(row.readiness, readiness))
      await this.change(row, {
        readiness,
        ...(["developing", "review_ready"].includes(row.status)
          ? { status: readiness.ready ? "review_ready" : "developing" }
          : {}),
      });
    return this.public(row);
  }
  async stop(row) {
    if (["installing", "handed_off"].includes(row.status))
      reject(
        "Installer handoff cannot be undone by Stop. Use the saved recovery information.",
      );
    const flow = this.host.store.state.projectWorkflows.find(
      (w) => w.id === row.workflowId,
    );
    if (flow && ["running", "awaiting_answers"].includes(flow.status))
      await this.host.projectWorkflows.stop(flow.id, OWNER);
    await this.host.store.change((state) => {
      for (const a of state.approvals)
        if (
          a.type === "self_update" &&
          a.operation?.requestId === row.id &&
          a.status === "pending"
        ) {
          a.status = "cancelled";
          a.error = "Upgrade stopped.";
        }
    });
    await this.change(row, {
      status: "stopped",
      detail:
        "Stopped. Saved source, artifacts and receipts remain available. Nothing retries automatically.",
    });
    return this.public(row);
  }
  async package(row, body) {
    if (!["review_ready", "packaged"].includes(row.status))
      reject("Finish the isolated managed workflow before attaching packages.");
    const readiness = await this.readiness(row);
    if (!readiness.ready) reject(readiness.detail);
    const keys = this.state.settings.trustedKeys;
    const current = await verifyRelease(
      text(body.manifestPath, "Signed manifest path", 2000),
      text(body.artifactPath, "Artifact path", 2000),
      keys,
    );
    const previous = await verifyRelease(
      text(body.previousManifestPath, "Previous signed manifest path", 2000),
      text(body.previousArtifactPath, "Previous artifact path", 2000),
      keys,
    );
    if (current.manifest.sourceHash !== readiness.sourceHash)
      reject(
        "The signed artifact does not identify this reviewed source snapshot.",
      );
    if (
      current.manifest.platform !== previous.manifest.platform ||
      current.manifest.appId !== previous.manifest.appId ||
      current.manifest.sha256 === previous.manifest.sha256
    )
      reject(
        "Keep a distinct, compatible signed previous artifact for recovery.",
      );
    if (
      current.manifest.platform === "android" &&
      current.manifest.androidCertificateSha256 !==
        previous.manifest.androidCertificateSha256
    )
      reject("Android signing identity must remain unchanged.");
    const directory = path.join(
      this.host.store.dir,
      "self-maintenance",
      row.id,
      uid(),
    );
    await fs.mkdir(directory, { recursive: true });
    await ordinaryPath(directory, true);
    const packages = {};
    for (const [label, item] of [
      ["candidate", current],
      ["previous", previous],
    ]) {
      const folder = path.join(directory, label);
      await fs.mkdir(folder);
      const artifactPath = path.join(folder, item.manifest.artifact),
        manifestPath = path.join(folder, "release.json");
      await fs.writeFile(artifactPath, item.data, { flag: "wx", mode: 0o600 });
      await fs.writeFile(manifestPath, JSON.stringify(item.manifest), {
        flag: "wx",
        mode: 0o600,
      });
      await verifyRelease(manifestPath, artifactPath, keys);
      packages[label] = { manifestPath, artifactPath };
    }
    await this.change(row, {
      status: "packaged",
      readiness,
      packages,
      artifact: {
        platform: current.manifest.platform,
        version: current.manifest.version,
        sha256: current.manifest.sha256,
        keyId: current.manifest.keyId,
        ...(current.manifest.platform === "android"
          ? {
              signerVerification:
                "Trusted signed manifest assertion; Android verifies the actual APK signer during manual installation.",
            }
          : {}),
      },
      detail:
        "Signed current and previous artifacts verified and copied into private staging. Installation requires a fresh PC approval.",
    });
    return this.public(row);
  }
  assertIdle() {
    const state = this.host.store.state;
    if ((this.host.activeMutations || 0) > 1)
      reject(
        "Another request is still changing Nakama. Wait for it to finish before updating.",
      );
    if (
      this.host.closing ||
      state.tasks.some((t) => ["running", "queued"].includes(t.status)) ||
      state.projectWorkflows.some((w) => active.has(w.status)) ||
      state.autonomousTasks.some((w) => active.has(w.status)) ||
      state.projectDeliveries.some((w) => active.has(w.status)) ||
      this.host.commandProcesses?.size ||
      this.host.projectPreviews?.entries?.size ||
      this.host.githubProjects?.active?.size ||
      this.host.checkpoints?.active?.size ||
      this.host.checkpointing?.size ||
      this.host.checking?.size ||
      this.host.building?.size ||
      this.host.projectMutations?.size ||
      this.host.reports?.active?.size ||
      this.host.connectionHandoffs?.pending?.size ||
      this.host.monitoring?.running?.size ||
      this.host.kling?.polls?.size
    )
      reject(
        "Finish or stop active work and previews before preparing an update.",
      );
    if (
      state.approvals.some(
        (a) => a.status === "executing" && a.type !== "self_update",
      )
    )
      reject("Another approved operation is executing.");
    if (this.host.browserStudio?.sessions?.size)
      reject("Close internal browser sessions before preparing an update.");
    if (
      this.host.store.state.monitors?.some((m) =>
        ["active", "checking"].includes(m.status),
      )
    )
      reject("Pause monitors before preparing an update.");
  }
  async verifyPackages(row) {
    if (!row.packages) reject("No signed packages are prepared.");
    const candidate = await verifyRelease(
      row.packages.candidate.manifestPath,
      row.packages.candidate.artifactPath,
      this.state.settings.trustedKeys,
    );
    const previous = await verifyRelease(
      row.packages.previous.manifestPath,
      row.packages.previous.artifactPath,
      this.state.settings.trustedKeys,
    );
    const readiness = await this.readiness(row);
    if (
      !readiness.ready ||
      candidate.manifest.sourceHash !== readiness.sourceHash
    )
      reject(
        "The reviewed candidate changed; prepare a newly reviewed release.",
      );
    await this.adapter?.verifyArtifact?.({
      artifactPath: row.packages.candidate.artifactPath,
      platform: candidate.manifest.platform,
    });
    await this.adapter?.verifyArtifact?.({
      artifactPath: row.packages.previous.artifactPath,
      platform: previous.manifest.platform,
    });
    return { candidate, previous };
  }
  async requestInstall(row, principal) {
    if (row.status !== "packaged")
      reject("Prepare a verified signed package first.");
    if (!this.adapter?.handoff)
      reject("Native update handoff is unavailable on this host.");
    this.assertIdle();
    await this.adapter.preflight?.();
    const { candidate, previous } = await this.verifyPackages(row);
    const operation = {
      requestId: row.id,
      revision: row.revision + 1,
      sha256: candidate.manifest.sha256,
      previousSha256: previous.manifest.sha256,
      sourceHash: candidate.manifest.sourceHash,
      platform: candidate.manifest.platform,
    };
    const approval = await this.host.approval(
      "self_update",
      `Review Nakama ${candidate.manifest.version} update`,
      "Hand off this exact signed artifact after private backup. Review the operating system installer yourself. Launch is not successful installation. Previous signed artifact and a local private-state backup are retained; automatic data rollback is not provided.",
      operation,
      principal,
      {
        onCreated: (a) => {
          Object.assign(row, {
            status: "awaiting_install_approval",
            approvalId: a.id,
            revision: operation.revision,
            updatedAt: now(),
          });
        },
      },
    );
    return { ...this.public(row), approval };
  }
  async approved(operation, approval) {
    const row = this.get(operation.requestId);
    return this.locked(row.id, async () => {
      if (
        row.status !== "awaiting_install_approval" ||
        row.approvalId !== approval.id ||
        row.revision !== operation.revision
      )
        reject("The approved update request is stale.");
      this.assertIdle();
      if (this.host.maintenanceLock)
        reject("Another maintenance handoff owns this host.");
      this.host.maintenanceLock = { id: row.id };
      let dispatched = false;
      try {
        this.assertIdle();
        await this.adapter?.preflight?.();
        const { candidate, previous } = await this.verifyPackages(row);
        if (
          candidate.manifest.sha256 !== operation.sha256 ||
          previous.manifest.sha256 !== operation.previousSha256 ||
          candidate.manifest.sourceHash !== operation.sourceHash ||
          candidate.manifest.platform !== operation.platform
        )
          reject("The exact approved update changed.");
        const backupPath = path.join(
          this.host.store.dir,
          "self-maintenance",
          row.id,
          `backup-${uid()}`,
        );
        await this.change(row, {
          status: "installing",
          backupPath,
          detail:
            "Saving recovery data before the single installer handoff. An interruption is not automatically retried.",
        });
        try {
          const backup = await backupPrivateState(
            this.host.store.dir,
            backupPath,
          );
          const nativeBackup = await this.adapter?.backup?.({
            destination: backupPath,
          });
          if (nativeBackup?.complete !== true)
            reject(
              "A complete native browser-profile backup is required before update handoff.",
            );
          this.assertIdle();
          await this.adapter.preflight?.();
          await this.verifyPackages(row);
          await this.change(row, {
            recovery: {
              detail:
                "Private host data and dedicated browser data backed up locally, with the previous signed artifact retained. Close Nakama before manual recovery; do not overwrite newer state blindly. No automatic schema rollback or installed health verification is implied.",
              files: backup.files,
              bytes: backup.bytes,
            },
            detail:
              "Recovery data saved. The exact artifact is about to be handed to the platform; uncertain outcomes must be inspected.",
          });
          dispatched = true;
          const result = await this.adapter.handoff({
            artifactPath: row.packages.candidate.artifactPath,
            platform: operation.platform,
            sha256: operation.sha256,
          });
          if (result?.handedOff !== true)
            reject("Native handoff did not confirm launch.");
          await this.change(row, {
            status: "handed_off",
            detail:
              "The platform received the verified update. Installation and post-restart health are unverified; complete the operating system flow yourself.",
          });
          return { status: "handed_off", installed: false, detail: row.detail };
        } catch (error) {
          await this.change(row, {
            status: "interrupted",
            error: error.message,
            detail:
              "Update handoff interrupted or unconfirmed. Inspect the platform and recovery files before another request; no automatic retry.",
          });
          throw error;
        }
      } finally {
        if (
          (!dispatched || operation.platform === "android") &&
          this.host.maintenanceLock?.id === row.id
        )
          this.host.maintenanceLock = null;
      }
    });
  }
  async recovery(row) {
    if (!row.backupPath || !row.recovery)
      reject("No completed recovery backup is available.");
    await ordinaryPath(row.backupPath, true);
    return {
      backupPath: row.backupPath,
      previousArtifactPath: row.packages?.previous.artifactPath,
      detail: row.recovery.detail,
    };
  }
  async close() {
    /* Workflows own cancellation. No automatic maintenance scheduler exists. */
  }
}
