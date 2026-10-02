import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { within } from "../apps/host/security.mjs";

const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await pause();
  }
}
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-check-host-"));
  const host = await new NakamaHost({
    dataDir: path.join(dir, "state"),
  }).init();
  const root = path.join(dir, "projects");
  await fs.mkdir(root);
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot: root });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Local check fixture",
  });
  const file = path.join(project.path, "package.json");
  const manifest = {
    private: true,
    scripts: {
      pretest: "node pre.cjs",
      test: "node test.cjs",
      posttest: "node post.cjs",
      lint: "node failed.cjs",
      check: "node wait.cjs",
      deploy: "node never.cjs",
    },
  };
  await fs.writeFile(file, JSON.stringify(manifest));
  await fs.writeFile(
    path.join(project.path, "pre.cjs"),
    'console.log("LOCAL_PRE");',
  );
  await fs.writeFile(
    path.join(project.path, "post.cjs"),
    'console.log("LOCAL_POST");',
  );
  await fs.writeFile(
    path.join(project.path, "test.cjs"),
    `
    const fs = require('node:fs');
    fs.writeFileSync('local-marker.txt', 'ran');
    (async () => { for (const byte of Buffer.from('LOCAL_MAIN café 🦊 日本語')) {
      process.stdout.write(Buffer.from([byte]));
      await new Promise(resolve => setTimeout(resolve, 3));
    } console.log(); })();
  `,
  );
  await fs.writeFile(
    path.join(project.path, "failed.cjs"),
    'console.log("EXPECTED_FAILURE");process.exit(7);',
  );
  await fs.writeFile(
    path.join(project.path, "wait.cjs"),
    // Keep the real npm descendant alive until Stop closes it or teardown releases it.
    // A wall-clock deadline can finish before Stop while another test/build is busy.
    `const fs = require("node:fs");
    const waiting = setInterval(() => {
      if (!fs.existsSync("release-wait.txt")) return;
      clearInterval(waiting);
      fs.writeFileSync("natural-exit.txt", "not stopped");
    }, 25);
    console.log("LOCAL_WAIT");`,
  );
  t.after(async () => {
    // Release a surviving fixture descendant even if a Stop assertion failed.
    await fs.writeFile(path.join(project.path, "release-wait.txt"), "teardown");
    await host.close();
    await until(
      () => !host.checking.size,
      "Check child did not exit during fixture cleanup",
    );
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-check-host-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { host, project, file, manifest };
}
const route = (project, suffix = "") =>
  `/api/projects/${project.id}/checks${suffix}`;
async function request(host, project, name = "test", principal) {
  const checks = await host.dispatch("GET", route(project), {}, principal);
  assert.equal(checks.runtime.available, true, checks.runtime.detail);
  return host.dispatch(
    "POST",
    route(project, "/request"),
    { name, manifestHash: checks.manifestHash },
    principal,
  );
}
const resolve = (host, approval, approved = true) =>
  host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, { approved });
async function finished(host, id) {
  await until(
    () => !host.runs.has(id) && !host.checking.size,
    "Project check did not finish",
  );
  await host.store.queue;
  return host.store.state.tasks.find((task) => task.id === id);
}
async function phone(host) {
  const { ticket } = await host.dispatch("POST", "/api/pairing/tickets", {
    platform: "android",
  });
  const paired = await host.dispatch("POST", "/api/pair", {
    ticket,
    platform: "android",
    name: "Fixture phone",
  });
  return { ...paired, principal: host.authenticate("Bearer " + paired.token) };
}

test("project checks discover only supported scripts and wait for fresh desktop approval", async (t) => {
  const { host, project } = await fixture(t);
  const checks = await host.dispatch("GET", route(project));
  assert.deepEqual(checks.checks.map((check) => check.name).sort(), [
    "check",
    "lint",
    "test",
  ]);
  const approval = await request(host, project);
  assert.equal(approval.type, "project_check");
  assert.equal(approval.status, "pending");
  for (const text of ["pre.cjs", "test.cjs", "post.cjs", "not a sandbox"])
    assert.ok(approval.description.includes(text));
  assert.equal(host.store.state.tasks.length, 0);
  await assert.rejects(fs.stat(path.join(project.path, "local-marker.txt")), {
    code: "ENOENT",
  });
  await resolve(host, approval, false);
  assert.equal(host.store.state.tasks.length, 0);
  await assert.rejects(resolve(host, approval), { status: 409 });
  const expired = await request(host, project);
  host.store.state.approvals.find((item) => item.id === expired.id).expiresAt =
    new Date(0).toISOString();
  await assert.rejects(resolve(host, expired), { status: 409 });
  await assert.rejects(
    host.dispatch("POST", route(project, "/request"), {
      name: "test",
      manifestHash: checks.manifestHash,
      args: ["--custom"],
    }),
    { status: 400 },
  );
});

test("approved npm lifecycle preserves Unicode, links task outcomes, and reports failing exits", async (t) => {
  const { host, project } = await fixture(t);
  const approval = await request(host, project);
  const result = await resolve(host, approval);
  assert.equal(result.status, "started");
  const task = await finished(host, result.taskId);
  assert.equal(task.kind, "project_check");
  assert.equal(task.title, "npm run test");
  assert.equal(task.status, "completed", task.error);
  assert.equal(task.exitCode, 0);
  assert.ok(task.output.includes("LOCAL_MAIN café 🦊 日本語"));
  assert.ok(
    task.output.indexOf("LOCAL_PRE") < task.output.indexOf("LOCAL_MAIN"),
  );
  assert.ok(
    task.output.indexOf("LOCAL_MAIN") < task.output.indexOf("LOCAL_POST"),
  );
  assert.equal(
    await fs.readFile(path.join(project.path, "local-marker.txt"), "utf8"),
    "ran",
  );
  const recorded = host.store.state.approvals.find(
    (item) => item.id === approval.id,
  );
  assert.equal(
    recorded.status,
    "started",
    "Approval must not claim the test passed",
  );
  assert.equal(recorded.result.taskId, result.taskId);
  await assert.rejects(resolve(host, approval), { status: 409 });
  const failed = await resolve(host, await request(host, project, "lint"));
  const failure = await finished(host, failed.taskId);
  assert.equal(failure.status, "failed");
  assert.equal(failure.exitCode, 7);
  assert.match(failure.error, /Exit code 7/);
});

test("changed package and unsupported request cannot execute under an older approval", async (t) => {
  const { host, project, file, manifest } = await fixture(t);
  const before = await host.dispatch("GET", route(project));
  const approval = await request(host, project);
  manifest.scripts.test = "node failed.cjs";
  await fs.writeFile(file, JSON.stringify(manifest));
  await assert.rejects(resolve(host, approval), { status: 409 });
  assert.equal(
    host.store.state.approvals.find((item) => item.id === approval.id).status,
    "failed",
  );
  assert.equal(host.store.state.tasks.length, 0);
  assert.equal(host.checking.size, 0);
  await assert.rejects(
    host.dispatch("POST", route(project, "/request"), {
      name: "test",
      manifestHash: before.manifestHash,
    }),
    { status: 409 },
  );
  await assert.rejects(request(host, project, "deploy"), { status: 400 });
});

test("check reservations exclude builders, file mutations and other commands until child close", async (t) => {
  const { host, project } = await fixture(t);
  host.building.add(project.id);
  await assert.rejects(request(host, project), { status: 409 });
  host.building.delete(project.id);
  let release;
  const mutation = host.withProjectMutation(
    project.id,
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  await assert.rejects(request(host, project), { status: 409 });
  release();
  await mutation;
  const waiting = await request(host, project, "check");
  const duplicate = await request(host, project, "check");
  const outcomes = await Promise.allSettled([
    resolve(host, waiting),
    resolve(host, duplicate),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const result = outcomes.find(
    (outcome) => outcome.status === "fulfilled",
  ).value;
  await until(
    () =>
      host.store.state.tasks.some(
        (task) =>
          task.id === result.taskId && task.output.includes("LOCAL_WAIT"),
      ),
    "Local waiting child did not start",
  );
  await assert.rejects(request(host, project), { status: 409 });
  await assert.rejects(
    host.dispatch("PUT", `/api/projects/${project.id}/file`, {
      path: "blocked.txt",
      content: "no",
    }),
    { status: 409 },
  );
  await assert.rejects(
    host.dispatch("POST", "/api/chat", {
      projectId: project.id,
      mode: "build",
      message: "Must not launch a provider",
    }),
    { status: 409 },
  );
  const deletion = await host.dispatch(
    "POST",
    `/api/projects/${project.id}/delete-request`,
  );
  await assert.rejects(resolve(host, deletion), { status: 409 });
  const command = await host.dispatch("POST", "/api/commands", {
    projectId: project.id,
    command: process.execPath,
    args: ["--version"],
  });
  await assert.rejects(resolve(host, command), { status: 409 });
  await host.dispatch("POST", `/api/tasks/${result.taskId}/stop`);
  const stopped = await finished(host, result.taskId);
  assert.equal(stopped.status, "stopped");
  await assert.rejects(fs.stat(path.join(project.path, "natural-exit.txt")), {
    code: "ENOENT",
  });
  assert.equal(host.checking.size, 0);
  assert.equal((await host.dispatch("GET", route(project))).active, false);
});

test("phone permissions, ownership and revocation during task registration are enforced", async (t) => {
  const { host, project } = await fixture(t);
  const one = await phone(host),
    two = await phone(host);
  await host.dispatch("PATCH", `/api/devices/${one.deviceId}`, {
    projectAccess: false,
  });
  await assert.rejects(
    host.dispatch("GET", route(project), {}, one.principal),
    { status: 403 },
  );
  await host.dispatch("PATCH", `/api/devices/${one.deviceId}`, {
    projectAccess: true,
  });
  const approval = await request(host, project, "check", one.principal);
  await assert.rejects(
    host.dispatch(
      "POST",
      `/api/approvals/${approval.id}/resolve`,
      { approved: true },
      one.principal,
    ),
    { status: 403 },
  );
  const running = await resolve(host, approval);
  await until(
    () => host.store.state.tasks.some(
      (task) => task.id === running.taskId && task.output.includes("LOCAL_WAIT"),
    ),
    "Owned check child did not reach its release gate",
  );
  await assert.rejects(
    host.dispatch(
      "POST",
      `/api/tasks/${running.taskId}/stop`,
      {},
      two.principal,
    ),
    { status: 403 },
  );
  await host.dispatch(
    "POST",
    `/api/tasks/${running.taskId}/stop`,
    {},
    one.principal,
  );
  const stopped = await finished(host, running.taskId);
  assert.equal(stopped.status, "stopped");
  assert.equal(host.commandProcesses.has(running.taskId), false);
  await assert.rejects(fs.stat(path.join(project.path, "natural-exit.txt")), {
    code: "ENOENT",
  });

  const revoked = await request(host, project, "test", one.principal);
  const change = host.store.change.bind(host.store);
  let armed = true;
  host.store.change = async (operation) => {
    const result = await change(operation);
    if (
      armed &&
      host.store.state.tasks.some(
        (task) => task.checkName === "test" && task.status === "running",
      )
    ) {
      armed = false;
      await host.dispatch("DELETE", `/api/devices/${one.deviceId}`);
    }
    return result;
  };
  await assert.rejects(resolve(host, revoked), { status: 409 });
  assert.equal(host.checking.size, 0);
  await assert.rejects(fs.stat(path.join(project.path, "local-marker.txt")), {
    code: "ENOENT",
  });
  const interrupted = host.store.state.tasks.find(
    (task) => task.checkName === "test",
  );
  assert.equal(interrupted.status, "stopped");
  assert.equal(host.commandProcesses.has(interrupted.id), false);
});

test("a queued generic command rechecks a newly claimed project check reservation", async (t) => {
  const { host, project } = await fixture(t);
  let release;
  const barrier = host.store.change(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  await until(() => release, "Store barrier did not start");
  const change = host.store.change.bind(host.store);
  let registrationQueued = false;
  host.store.change = (operation) => {
    registrationQueued = true;
    return change(operation);
  };
  const command = host.startCommand(
    { projectId: project.id, command: process.execPath, args: ["--version"] },
    { kind: "owner", id: "desktop" },
  );
  await until(() => registrationQueued, "Command registration did not queue");
  host.checking.add(project.id);
  release();
  await barrier;
  await assert.rejects(command, { status: 409 });
  host.checking.delete(project.id);
  assert.equal(host.store.state.tasks.length, 0);
});
