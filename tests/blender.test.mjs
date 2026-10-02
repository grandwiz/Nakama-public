import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyBlender } from "../apps/host/blender.mjs";
import { digest, within } from "../apps/host/security.mjs";
test("Blender rejects a scene script changed after its approval was requested", async (t) => {
  const base = await fs.realpath(os.tmpdir()),
    dir = await fs.mkdtemp(path.join(base, "nakama-blender-")),
    project = { path: path.join(dir, "project") };
  await fs.mkdir(project.path);
  t.after(async () => {
    assert.ok(
      within(base, dir) && path.basename(dir).startsWith("nakama-blender-"),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(project.path, "scene.py"),
    source = 'print("reviewed script")';
  await fs.writeFile(file, source);
  const operation = { scriptPath: "scene.py", scriptHash: digest(source) };
  await verifyBlender({ workspaceRoot: dir, project, operation });
  await fs.writeFile(file, 'print("changed")');
  await assert.rejects(
    verifyBlender({ workspaceRoot: dir, project, operation }),
    { status: 409 },
  );
});
