import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { extractFile, listPackage } from "@electron/asar";

// Check the generated Windows package without launching the installed profile.
const resources = path.resolve("output/installers/win-unpacked/resources");
const archive = path.join(resources, "app.asar");
async function filesIn(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}
const files = [
  "apps/desktop/main.cjs",
  "apps/desktop/preload.cjs",
  ...(await fs.readdir("apps/desktop"))
    .filter(
      (name) =>
        name.startsWith("remote-") ||
        name.startsWith("browser-") ||
        name.startsWith("self-maintenance") ||
        name === "alarm-audio.cjs" ||
        name === "desktop-attention.cjs" ||
        name === "project-reports.cjs",
    )
    .map((name) => `apps/desktop/${name}`),
  ...(await filesIn("apps/host")),
  ...(await filesIn("apps/desktop/dist")),
];
for (const file of files)
  assert.deepEqual(
    extractFile(archive, file.replaceAll("/", path.sep)),
    await fs.readFile(file),
    `Packaged source mismatch: ${file}`,
  );
assert.equal(
  listPackage(archive).some((file) =>
    /[/\\]apps[/\\]host[/\\]media\.mjs$/.test(file),
  ),
  false,
  "Retired media adapter must not ship.",
);
assert.deepEqual(
  await fs.readFile(path.join(resources, "kling-mcp/server.mjs")),
  await fs.readFile("output/kling-mcp/server.mjs"),
  "Packaged MCP bundle differs from the tested build.",
);
console.log(
  `Verified ${files.length} packaged source/renderer files, retired-adapter removal and the standalone MCP bundle.`,
);
