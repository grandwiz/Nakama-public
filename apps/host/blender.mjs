import fs from "node:fs/promises";
import path from "node:path";
import { ApiError, projectRoot, safeFile, digest } from "./security.mjs";
export async function findBlender() {
  const candidates = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) =>
      path.join(dir, process.platform === "win32" ? "blender.exe" : "blender"),
    );
  if (process.platform === "win32")
    for (const base of [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
    ].filter(Boolean)) {
      const foundation = path.join(base, "Blender Foundation");
      for (const name of (await fs.readdir(foundation).catch(() => []))
        .sort()
        .reverse())
        candidates.unshift(path.join(foundation, name, "blender.exe"));
    }
  for (const candidate of candidates)
    if ((await fs.stat(candidate).catch(() => null))?.isFile())
      return candidate;
  return null;
}
export async function prepareBlender({ workspaceRoot, project, scriptPath }) {
  const command = await findBlender();
  if (!command)
    throw new ApiError(
      409,
      "Install Blender on this PC first, then try again.",
    );
  if (
    typeof scriptPath !== "string" ||
    !scriptPath.toLowerCase().endsWith(".py")
  )
    throw new ApiError(
      400,
      "Choose a Python scene script inside this project.",
    );
  const root = await projectRoot(workspaceRoot, project),
    file = await safeFile(root, scriptPath),
    info = await fs.stat(file);
  if (!info.isFile() || info.size > 1024 * 1024)
    throw new ApiError(400, "Choose a Python script smaller than 1 MB.");
  const source = await fs.readFile(file, "utf8");
  if (source.includes("\0"))
    throw new ApiError(400, "Scene scripts must be text.");
  return {
    projectId: project.id,
    command,
    args: [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--python-exit-code",
      "1",
      "--python",
      file,
    ],
    scriptPath,
    scriptHash: digest(source),
    preview: source.slice(0, 10000),
  };
}
export async function verifyBlender({ workspaceRoot, project, operation }) {
  const root = await projectRoot(workspaceRoot, project),
    file = await safeFile(root, operation.scriptPath);
  if (digest(await fs.readFile(file)) !== operation.scriptHash)
    throw new ApiError(
      409,
      "The Blender script changed after approval was requested. Review a new request.",
    );
  return operation;
}
