// Optional: uses a little existing Codex subscription allowance, never an API key.
// The only effects are project/text-file creation inside a disposable local folder.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { NakamaHost } from "../apps/host/host.mjs";
const dir = path.resolve("tmp", `assistant-${Date.now()}`),
  workspaceRoot = path.join(dir, "projects");
await fs.mkdir(workspaceRoot, { recursive: true });
const host = await new NakamaHost({
  dataDir: path.join(dir, "profile"),
}).init();
async function wait(id) {
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const task = host.store.state.tasks.find((task) => task.id === id);
    if (!["queued", "running"].includes(task.status)) {
      assert.equal(task.status, "completed", task.error + "\n" + task.output);
      return task;
    }
  }
  throw new Error("Provider smoke test timed out.");
}
try {
  await host.dispatch("PATCH", "/api/settings", { workspaceRoot });
  await host.dispatch("POST", "/api/providers/codex/settings", {
    selectedModel: "gpt-6-luna",
    effort: "low",
  });
  const action = await host.dispatch("POST", "/api/chat", {
    mode: "act",
    message:
      "Create a project called Live smoke, with description A disposable local integration check.",
    providerId: "codex",
  });
  const actionTask = await wait(action.taskIds[0]);
  const project = host.store.state.projects.find(
    (p) => p.name === "Live smoke",
  );
  assert.ok(project, "The project must actually exist.");
  const build = await host.dispatch("POST", "/api/chat", {
    mode: "build",
    projectId: project.id,
    message:
      "Create greeting.txt containing exactly the single line Nakama build verified followed by a newline. Return the required nakama-files JSON block. Do not read files, run commands, install anything, or change any other files.",
    providerId: "codex",
  });
  const buildTask = await wait(build.taskIds[0]);
  assert.equal(
    await fs.readFile(path.join(project.path, "greeting.txt"), "utf8"),
    "Nakama build verified\n",
  );
  console.log(
    JSON.stringify({
      passed: true,
      project: project.path,
      actionOutcomes: actionTask.actionOutcomes,
      filesWritten: buildTask.filesWritten,
      paidApisEnabled: host.store.state.config.paidApisEnabled,
    }),
  );
} finally {
  await host.close();
}
