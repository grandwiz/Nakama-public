import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { NakamaHost } from "../apps/host/host.mjs";
const dir = path.resolve("tmp", `blender-${Date.now()}`),
  workspaceRoot = path.join(dir, "projects");
await fs.mkdir(workspaceRoot, { recursive: true });
const host = await new NakamaHost({
  dataDir: path.join(dir, "profile"),
}).init();
try {
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot });
  const project = await host.dispatch("POST", "/api/projects", {
    name: "Blender integration fixture",
  });
  await host.dispatch("PUT", `/api/projects/${project.id}/file`, {
    path: "scene.py",
    content: await fs.readFile("examples/blender/scene.py", "utf8"),
  });
  const approval = await host.dispatch(
    "POST",
    "/api/tools/blender/run-request",
    { projectId: project.id, scriptPath: "scene.py" },
  );
  assert.equal(approval.type, "blender_script");
  await host.dispatch("POST", `/api/approvals/${approval.id}/resolve`, {
    approved: true,
  });
  const until = Date.now() + 120000;
  while (host.runs.size && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 500));
  await host.store.queue;
  const task = host.store.state.tasks.at(-1);
  assert.equal(task.status, "completed", task.output + "\n" + task.error);
  for (const name of ["nakama-scene.blend", "nakama-scene.png"])
    assert.ok((await fs.stat(path.join(project.path, name))).size > 100);
  await fs.copyFile(
    path.join(project.path, "nakama-scene.png"),
    "output/blender-integration.png",
  );
  console.log(
    JSON.stringify({
      passed: true,
      project: project.path,
      outputs: ["nakama-scene.blend", "nakama-scene.png"],
      taskStatus: task.status,
    }),
  );
} finally {
  await host.close();
}
