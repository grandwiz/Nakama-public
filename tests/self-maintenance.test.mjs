import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findGit, gitEnvironment } from "../apps/host/project-git.mjs";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { NakamaHost } from "../apps/host/host.mjs";
import { projectSnapshot } from "../apps/host/build-files.mjs";
import {
  releasePayload,
  stageSource,
  verifyRelease,
  validateTrustedKeys,
  backupPrivateState,
} from "../apps/host/self-maintenance-files.mjs";

const owner = { kind: "owner", id: "desktop" };
const runFile = promisify(execFile);
const sha = (data) => createHash("sha256").update(data).digest("hex");
async function fixture(t, adapter) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "nakama-maintenance-"),
  );
  const source = path.join(root, "source"),
    workspace = path.join(root, "workspace"),
    dataDir = path.join(root, "private");
  await fs.mkdir(path.join(source, "apps", "host"), { recursive: true });
  await fs.mkdir(workspace);
  await fs.writeFile(
    path.join(source, "package.json"),
    JSON.stringify({
      name: "nakama-control-center",
      scripts: { test: "node --test", build: "node build.mjs" },
    }),
  );
  await fs.writeFile(
    path.join(source, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3 }),
  );
  await fs.writeFile(
    path.join(source, "apps", "host", "host.mjs"),
    "export const source = true;\n",
  );
  const git = await findGit(),
    gitOptions = {
      cwd: source,
      env: gitEnvironment(path.join(root, "git-home")),
      windowsHide: true,
      shell: false,
    };
  await runFile(git, ["-c", "core.hooksPath=", "init", "--quiet"], gitOptions);
  await runFile(
    git,
    [
      "-c",
      "core.hooksPath=",
      "add",
      "--",
      "package.json",
      "package-lock.json",
      "apps/host/host.mjs",
    ],
    gitOptions,
  );
  const { publicKey, privateKey } = generateKeyPairSync("ed25519"),
    trustedKeys = [
      {
        id: "fixture",
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
      },
    ];
  let calls = 0;
  const host = await new NakamaHost({
    dataDir,
    runAgent: async () => {
      calls++;
      throw new Error("Live models forbidden in fixture.");
    },
    maintenanceAdapter: adapter,
  }).init();
  await host.store.change((s) => {
    s.config.workspaceRoot = workspace;
  });
  await host.dispatch(
    "PATCH",
    "/api/self-maintenance/settings",
    { sourcePath: source, trustedKeys },
    owner,
  );
  const api = (method, route, body = {}) =>
    host.dispatch(method, `/api/self-maintenance${route}`, body, owner);
  const create = () =>
    api("POST", "", {
      title: "Fixture change",
      request: "Improve the isolated source only.",
    });
  const stage = async () => {
    const r = await create();
    return api("POST", `/${r.id}/stage`, { expectedRevision: r.revision });
  };
  const reviewed = async () => {
    let row = await stage();
    const record = host.selfMaintenance.get(row.id),
      snapshot = await projectSnapshot(record.candidatePath),
      flowId = "flow-fixture";
    await host.store.change((s) => {
      record.workflowId = flowId;
      record.status = "developing";
      const flow = {
        id: flowId,
        projectId: row.projectId,
        projectPath: record.candidatePath,
        status: "completed",
        reviewRound: 0,
        assignments: {
          manager: { providerId: "codex", model: "one" },
          peer: { providerId: "claude", model: "two" },
        },
        snapshot: [...snapshot],
        reviews: [
          { role: "manager", round: 0, verdict: "pass", findings: [] },
          { role: "peer", round: 0, verdict: "pass", findings: [] },
        ],
        checkNames: ["test", "build"],
        checkReceipts: [],
      };
      for (const name of flow.checkNames) {
        const approvalId = `approval-${name}`,
          taskId = `task-${name}`,
          manifestHash = "manifest";
        flow.checkReceipts.push({
          checkName: name,
          round: 0,
          approvalId,
          taskId,
          manifestHash,
          status: "completed",
          exitCode: 0,
        });
        s.tasks.push({
          id: taskId,
          kind: "project_check",
          status: "completed",
          exitCode: 0,
          checkName: name,
          workflowId: flowId,
          projectId: row.projectId,
          approvalId,
          manifestHash,
        });
        s.approvals.push({
          id: approvalId,
          type: "project_check",
          status: "started",
          operation: {
            workflowId: flowId,
            projectId: row.projectId,
            manifestHash,
          },
          result: { taskId },
        });
      }
      s.projectWorkflows.push(flow);
    });
    row = await api("POST", `/${row.id}/refresh`, {});
    assert.equal(row.readiness.ready, true);
    return row;
  };
  const release = async (sourceHash, label = "candidate", changes = {}) => {
    const folder = path.join(root, label);
    await fs.mkdir(folder);
    const data = Buffer.from(`Synthetic ${label}, never executed`),
      artifact = `${label}.exe`;
    const manifest = {
      schema: 1,
      appId: "dev.qodelive.nakama",
      platform: "windows",
      version: label === "candidate" ? "0.2.0" : "0.1.0",
      sourceHash,
      artifact,
      bytes: data.length,
      sha256: sha(data),
      keyId: "fixture",
      dataVersion: 1,
      ...changes,
    };
    manifest.signature = sign(
      null,
      Buffer.from(releasePayload(manifest)),
      privateKey,
    ).toString("base64");
    const manifestPath = path.join(folder, "release.json"),
      artifactPath = path.join(folder, manifest.artifact);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await fs.writeFile(artifactPath, data);
    return { manifestPath, artifactPath, manifest };
  };
  const packaged = async () => {
    const row = await reviewed(),
      current = await release(row.readiness.sourceHash),
      previous = await release("b".repeat(64), "previous");
    return api("POST", `/${row.id}/package`, {
      expectedRevision: row.revision,
      ...current,
      previousManifestPath: previous.manifestPath,
      previousArtifactPath: previous.artifactPath,
    });
  };
  t.after(async () => {
    await host.close();
    await host.store.queue;
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    host,
    source,
    api,
    create,
    stage,
    reviewed,
    release,
    packaged,
    trustedKeys,
    get calls() {
      return calls;
    },
  };
}

test("upgrade requests and isolated staging preserve originals, exclude private material and make no model calls", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.source, "output"));
  await fs.writeFile(
    path.join(f.source, "output", "personal.pdf"),
    "private ticks",
  );
  await fs.writeFile(path.join(f.source, ".env"), "SECRET=value");
  await fs.writeFile(
    path.join(f.source, "apps", "host", "vault.json"),
    "private",
  );
  await fs.writeFile(
    path.join(f.source, "apps", "host", "personal-fixture.json"),
    "private untracked fixture",
  );
  const row = await f.stage(),
    record = f.host.selfMaintenance.get(row.id);
  assert.equal(row.status, "staged");
  assert.equal(f.calls, 0);
  assert.notEqual(record.candidatePath, f.source);
  assert.equal(
    await fs.readFile(path.join(f.source, "output", "personal.pdf"), "utf8"),
    "private ticks",
  );
  for (const name of [
    "output",
    ".env",
    "apps/host/vault.json",
    "apps/host/personal-fixture.json",
  ])
    await assert.rejects(fs.access(path.join(record.candidatePath, name)));
  assert.equal(row.candidatePath, undefined);
  assert.equal(row.sourceFiles, undefined);
  await assert.rejects(
    f.api("POST", `/${row.id}/start`, { expectedRevision: row.revision }),
    /Explicitly confirm/,
  );
  assert.equal(f.calls, 0);
});

test("explicit run uses configured roles and existing manager workflow once", async (t) => {
  const f = await fixture(t),
    row = await f.stage();
  let captured;
  f.host.projectWorkflows.start = async (body, principal, routing) => {
    captured = { body, principal, routing };
    return { workflowId: "actual-workflow" };
  };
  const started = await f.api("POST", `/${row.id}/start`, {
    expectedRevision: row.revision,
    confirmProviderUse: true,
  });
  assert.equal(started.workflowId, "actual-workflow");
  assert.equal(
    captured.routing.model,
    f.host.store.state.config.aiRoles.planning.model,
  );
  assert.equal(
    captured.routing.development.model,
    f.host.store.state.config.aiRoles.development.model,
  );
  assert.match(captured.body.message, /Never install/);
  assert.equal(f.calls, 0);
  await assert.rejects(
    f.api("POST", `/${row.id}/start`, {
      expectedRevision: started.revision,
      confirmProviderUse: true,
    }),
    /freshly staged/,
  );
});

test("phone can request and inspect but cannot release usage or see source/trust/package paths", async (t) => {
  const f = await fixture(t);
  await f.host.store.change((s) =>
    s.devices.push({
      id: "phone",
      platform: "android",
      tokenHash: "token",
      permissions: { projectAccess: true, googleAccess: true },
    }),
  );
  const phone = { kind: "device", id: "phone" };
  const row = await f.host.selfMaintenance.route(
    "POST",
    "/api/self-maintenance",
    { title: "Phone request", request: "Ask the manager later" },
    phone,
  );
  const list = f.host.selfMaintenance.list(phone);
  assert.deepEqual(list.settings, { hold: true });
  await assert.rejects(
    f.host.selfMaintenance.route(
      "POST",
      `/api/self-maintenance/${row.id}/stage`,
      { expectedRevision: row.revision },
      phone,
    ),
    /Windows Control Center/,
  );
  await f.host.store.change((s) => {
    s.devices[0].permissions.googleAccess = false;
  });
  assert.throws(() => f.host.selfMaintenance.list(phone), /unavailable/);
});

test("readiness binds real exact check tasks, two reviewers and unchanged source", async (t) => {
  const f = await fixture(t),
    row = await f.reviewed();
  const record = f.host.selfMaintenance.get(row.id),
    flow = f.host.store.state.projectWorkflows[0];
  flow.reviews[1].verdict = "changes_requested";
  assert.equal((await f.host.selfMaintenance.readiness(record)).ready, false);
  flow.reviews[1].verdict = "pass";
  f.host.store.state.tasks[0].exitCode = 1;
  assert.equal((await f.host.selfMaintenance.readiness(record)).ready, false);
  f.host.store.state.tasks[0].exitCode = 0;
  f.host.store.state.approvals[0].result.taskId = "wrong";
  assert.equal((await f.host.selfMaintenance.readiness(record)).ready, false);
  f.host.store.state.approvals[0].result.taskId = "task-test";
  await fs.appendFile(
    path.join(record.candidatePath, "apps", "host", "host.mjs"),
    "// changed",
  );
  assert.equal((await f.host.selfMaintenance.readiness(record)).ready, false);
});

test("signed manifest trust, schema and exact bytes are enforced", async (t) => {
  const f = await fixture(t),
    release = await f.release("a".repeat(64));
  assert.equal(
    (
      await verifyRelease(
        release.manifestPath,
        release.artifactPath,
        f.trustedKeys,
      )
    ).manifest.platform,
    "windows",
  );
  await assert.rejects(
    verifyRelease(release.manifestPath, release.artifactPath, []),
    /valid signature/,
  );
  await fs.appendFile(release.artifactPath, "tampered");
  await assert.rejects(
    verifyRelease(release.manifestPath, release.artifactPath, f.trustedKeys),
    /size limit|match/,
  );
  const incompatible = await f.release("a".repeat(64), "incompatible", {
    dataVersion: 2,
  });
  await assert.rejects(
    verifyRelease(
      incompatible.manifestPath,
      incompatible.artifactPath,
      f.trustedKeys,
    ),
    /incompatible/,
  );
  assert.throws(
    () => validateTrustedKeys([{ id: "bad", publicKey: "PRIVATE KEY" }]),
    /invalid/,
  );
});

test("package requires current source hash and a separate signed recovery artifact", async (t) => {
  const f = await fixture(t),
    row = await f.reviewed(),
    release = await f.release("a".repeat(64)),
    previous = await f.release("b".repeat(64), "previous");
  await assert.rejects(
    f.api("POST", `/${row.id}/package`, {
      expectedRevision: row.revision,
      ...release,
      previousManifestPath: previous.manifestPath,
      previousArtifactPath: previous.artifactPath,
    }),
    /reviewed source/,
  );
  assert.equal(f.host.selfMaintenance.get(row.id).status, "review_ready");
});

test("exact approval saves verified private recovery before single native handoff and locks new mutations", async (t) => {
  let f,
    handoffs = 0;
  const adapter = {
    preflight: async () => {},
    backup: async ({ destination }) => {
      assert.equal(
        JSON.parse(
          await fs.readFile(path.join(destination, "state.json"), "utf8"),
        ).version,
        1,
      );
      return { complete: true };
    },
    handoff: async () => {
      handoffs++;
      assert.ok(f.host.maintenanceLock);
      return { handedOff: true };
    },
  };
  f = await fixture(t, adapter);
  const row = await f.packaged();
  await fs.writeFile(
    path.join(f.host.store.dir, "vault.bin.json"),
    "encrypted fixture",
  );
  const pending = await f.api("POST", `/${row.id}/install-request`, {
    expectedRevision: row.revision,
  });
  assert.equal(handoffs, 0);
  const result = await f.host.dispatch(
    "POST",
    `/api/approvals/${pending.approvalId}/resolve`,
    { approved: true },
  );
  assert.equal(handoffs, 1);
  const record = f.host.selfMaintenance.get(row.id);
  assert.equal(record.status, "handed_off");
  assert.equal(
    await fs.readFile(path.join(record.backupPath, "vault.bin.json"), "utf8"),
    "encrypted fixture",
  );
  assert.equal(
    f.host.store.state.approvals.find((a) => a.id === pending.approvalId).result
      .installed,
    false,
  );
  await assert.rejects(
    f.api("POST", "", {
      title: "Blocked",
      request: "No mutation during update",
    }),
    /update|maintenance/i,
  );
});

test("revoked trust and stale revision prevent native dispatch and clear pre-dispatch lock", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
      preflight: async () => {},
      backup: async () => ({ complete: true }),
      handoff: async () => {
        calls++;
        return { handedOff: true };
      },
    }),
    row = await f.packaged();
  await assert.rejects(
    f.api("POST", `/${row.id}/install-request`, {
      expectedRevision: row.revision - 1,
    }),
    /changed/,
  );
  const pending = await f.api("POST", `/${row.id}/install-request`, {
    expectedRevision: row.revision,
  });
  await f.api("PATCH", "/settings", { trustedKeys: [] });
  await assert.rejects(
    f.host.dispatch("POST", `/api/approvals/${pending.approvalId}/resolve`, {
      approved: true,
    }),
    /valid signature/,
  );
  assert.equal(calls, 0);
  assert.equal(f.host.maintenanceLock, null);
});

test("backup failure blocks dispatch; restart cancels pending install without replay", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
      preflight: async () => {},
      backup: async () => ({ complete: false }),
      handoff: async () => {
        calls++;
        return { handedOff: true };
      },
    }),
    row = await f.packaged();
  const pending = await f.api("POST", `/${row.id}/install-request`, {
    expectedRevision: row.revision,
  });
  await assert.rejects(
    f.host.dispatch("POST", `/api/approvals/${pending.approvalId}/resolve`, {
      approved: true,
    }),
    /backup/,
  );
  assert.equal(calls, 0);
  assert.equal(f.host.maintenanceLock, null);
  await f.host.store.change((s) => {
    const r = s.selfMaintenance.requests[0];
    r.status = "installing";
    s.approvals.push({
      id: "pending-update",
      type: "self_update",
      status: "pending",
    });
  });
  await f.host.selfMaintenance.init();
  assert.equal(f.host.selfMaintenance.get(row.id).status, "interrupted");
  assert.equal(
    f.host.store.state.approvals.find((a) => a.id === "pending-update").status,
    "cancelled",
  );
  assert.equal(calls, 0);
});

test("private backups exclude their own artifact tree and verify copied data", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.host.store.dir, "self-maintenance"));
  await fs.writeFile(
    path.join(f.host.store.dir, "self-maintenance", "artifact.exe"),
    "omit",
  );
  const dest = path.join(f.host.store.dir, "self-maintenance", "backup");
  const result = await backupPrivateState(f.host.store.dir, dest);
  assert.ok(result.files > 0);
  await assert.rejects(fs.access(path.join(dest, "self-maintenance")));
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(dest, "backup-manifest.json"), "utf8"),
    ).schema,
    1,
  );
});

test("in-flight settings mutation blocks approval until its final state can be backed up", async (t) => {
  let f,
    backups = 0;
  f = await fixture(t, {
    preflight: async () => {},
    backup: async ({ destination }) => {
      backups++;
      const saved = JSON.parse(
        await fs.readFile(path.join(destination, "state.json"), "utf8"),
      );
      assert.equal(saved.config.hostName, "Pending settings completed");
      return { complete: true };
    },
    handoff: async () => ({ handedOff: true }),
  });
  let row = await f.packaged();
  const pending = await f.api("POST", `/${row.id}/install-request`, {
    expectedRevision: row.revision,
  });
  const original = f.host.dispatchRequest.bind(f.host);
  let release, entered;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (entered = resolve));
  f.host.dispatchRequest = async (method, url, body, principal) => {
    if (
      method === "PATCH" &&
      url === "/api/settings" &&
      body.hostName === "Pending settings completed"
    ) {
      entered();
      await gate;
    }
    return original(method, url, body, principal);
  };
  const settings = f.host.dispatch("PATCH", "/api/settings", {
    hostName: "Pending settings completed",
  });
  await started;
  assert.equal(f.host.activeMutations, 1);
  await assert.rejects(
    f.host.dispatch("POST", `/api/approvals/${pending.approvalId}/resolve`, {
      approved: true,
    }),
    /Another request/,
  );
  assert.equal(backups, 0);
  assert.equal(f.host.activeMutations, 1);
  assert.ok(!f.host.maintenanceLock);
  release();
  await settings;
  assert.equal(f.host.activeMutations, 0);
  row = await f.api("POST", `/${row.id}/refresh`);
  assert.equal(row.status, "packaged");
  const renewed = await f.api("POST", `/${row.id}/install-request`, {
    expectedRevision: row.revision,
  });
  await f.host.dispatch(
    "POST",
    `/api/approvals/${renewed.approvalId}/resolve`,
    { approved: true },
  );
  assert.equal(backups, 1);
  assert.equal(f.host.activeMutations, 0);
  await assert.rejects(
    f.host.dispatch("PATCH", "/api/settings", { hostName: "Blocked" }),
    /paused/,
  );
  assert.equal(f.host.activeMutations, 0);
});

test("known background Git, report and credential work prevents an upgrade preparation", async (t) => {
  const f = await fixture(t, {
    preflight: async () => {},
    handoff: async () => ({ handedOff: true }),
  });
  const row = await f.packaged();
  for (const collection of [
    f.host.githubProjects.active,
    f.host.checkpoints.active,
    f.host.reports.active,
    f.host.connectionHandoffs.pending,
    f.host.monitoring.running,
  ]) {
    if (collection instanceof Map) collection.set("fixture", Promise.resolve());
    else collection.add(Promise.resolve());
    try {
      await assert.rejects(
        f.api("POST", `/${row.id}/install-request`, {
          expectedRevision: row.revision,
        }),
        /active work/,
      );
      assert.equal(f.host.activeMutations, 0);
    } finally {
      collection.clear();
    }
  }
  await assert.rejects(
    f.host.dispatch("PATCH", "/api/settings", { invalid: true }),
    /Unknown setting/,
  );
  assert.equal(f.host.activeMutations, 0);
});

test("permitted phones may refresh shared upgrade evidence but cannot stop another request", async (t) => {
  const f = await fixture(t),
    row = await f.create();
  await f.host.store.change((s) =>
    s.devices.push({
      id: "phone",
      platform: "android",
      permissions: { projectAccess: true, googleAccess: true },
    }),
  );
  const phone = { kind: "device", id: "phone" };
  const refreshed = await f.host.selfMaintenance.route(
    "POST",
    `/api/self-maintenance/${row.id}/refresh`,
    {},
    phone,
  );
  assert.equal(refreshed.readiness.ready, false);
  await assert.rejects(
    f.host.selfMaintenance.route(
      "POST",
      `/api/self-maintenance/${row.id}/stop`,
      { expectedRevision: refreshed.revision },
      phone,
    ),
    /only its own/,
  );
});

test("publisher trust cannot be added by remote PC control and concurrent source settings cannot restore revoked trust", async (t) => {
  const f = await fixture(t);
  const second = generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
  f.host.remoteDesktop.assertOwnerApprovalAllowed = () => {
    throw new Error("Remote desktop cannot approve this action.");
  };
  await assert.rejects(
    f.api("PATCH", "/settings", {
      trustedKeys: [...f.trustedKeys, { id: "second", publicKey: second }],
    }),
    /Remote desktop/,
  );
  assert.equal(f.host.selfMaintenance.state.settings.trustedKeys.length, 1);
  await Promise.all([
    f.api("PATCH", "/settings", { sourcePath: f.source }),
    f.api("PATCH", "/settings", { trustedKeys: [] }),
  ]);
  assert.deepEqual(f.host.selfMaintenance.state.settings.trustedKeys, []);
});

test("manual Android artifact reveal keeps signer attestation honest and releases the Windows mutation lock", async (t) => {
  const f = await fixture(t, {
    preflight: async () => {},
    backup: async () => ({ complete: true }),
    handoff: async ({ platform }) => {
      assert.equal(platform, "android");
      return { handedOff: true };
    },
  });
  const row = await f.reviewed(),
    cert = "d".repeat(64),
    base = {
      platform: "android",
      appId: "dev.nakama.companion",
      androidCertificateSha256: cert,
    };
  const current = await f.release(row.readiness.sourceHash, "candidate", {
    ...base,
    artifact: "candidate.apk",
  });
  const previous = await f.release("b".repeat(64), "previous", {
    ...base,
    artifact: "previous.apk",
  });
  const packaged = await f.api("POST", `/${row.id}/package`, {
    expectedRevision: row.revision,
    ...current,
    previousManifestPath: previous.manifestPath,
    previousArtifactPath: previous.artifactPath,
  });
  assert.match(packaged.artifact.signerVerification, /assertion/);
  const pending = await f.api("POST", `/${row.id}/install-request`, {
    expectedRevision: packaged.revision,
  });
  await f.host.dispatch(
    "POST",
    `/api/approvals/${pending.approvalId}/resolve`,
    { approved: true },
  );
  assert.equal(f.host.maintenanceLock, null);
  assert.equal(f.host.selfMaintenance.get(row.id).status, "handed_off");
});
