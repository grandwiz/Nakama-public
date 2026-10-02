import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  ApiError,
  digest,
  projectRoot,
  safeFile,
  redact,
  within,
} from "./security.mjs";

const CHECK_NAMES = ["test", "lint", "typecheck", "check", "build"];
const MAX_MANIFEST = 256 * 1024,
  MAX_SCRIPT = 4096;
const WARNING =
  "Runs the displayed npm script and its pre/post scripts with your Windows account permissions. Scripts can change files, run other programs and use the network. Review their source before approving.";

// Only installation locations are considered. In particular, Electron's
// process.execPath, project executables, npm.cmd and PATH lookup are not used.
export async function installedCheckRuntime() {
  const candidates =
    process.platform === "win32"
      ? [
          ...new Set(
            [
              process.env.ProgramFiles,
              process.env["ProgramFiles(x86)"],
              "C:\\Program Files",
              "C:\\Program Files (x86)",
            ].filter((p) => p && path.isAbsolute(p)),
          ),
        ].map((base) => ({
          node: path.join(base, "nodejs", "node.exe"),
          npmRoot: path.join(base, "nodejs", "node_modules", "npm"),
        }))
      : [
          { node: "/usr/bin/node", npmRoot: "/usr/share/nodejs/npm" },
          {
            node: "/usr/local/bin/node",
            npmRoot: "/usr/local/lib/node_modules/npm",
          },
        ];
  const shell =
    process.platform === "win32"
      ? path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "cmd.exe",
        )
      : "/bin/sh";
  if (!path.isAbsolute(shell)) return null;
  for (const candidate of candidates) {
    try {
      const npmCli = path.join(candidate.npmRoot, "bin", "npm-cli.js");
      for (const file of [candidate.node, npmCli, shell])
        if (!(await fs.stat(file)).isFile()) throw new Error("missing");
      return {
        node: await fs.realpath(candidate.node),
        npmCli: await fs.realpath(npmCli),
        npmRoot: await fs.realpath(candidate.npmRoot),
        shell: await fs.realpath(shell),
      };
    } catch {
      /* try the next fixed installation */
    }
  }
  return null;
}

export async function boundedFile(file, max, label) {
  const before = await fs.lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink > 1 ||
    before.size > max
  )
    throw new ApiError(
      409,
      `${label} must be an ordinary, unlinked file within the size limit.`,
    );
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink > 1 ||
      stat.ino !== before.ino ||
      stat.size > max
    )
      throw new ApiError(409, `${label} changed while it was being checked.`);
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, size);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size > max) throw new ApiError(409, `${label} is too large.`);
    const after = await handle.stat();
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw new ApiError(409, `${label} changed while it was being checked.`);
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}

async function inspectProject(
  workspaceRoot,
  project,
  checkNames = CHECK_NAMES,
) {
  const root = await projectRoot(workspaceRoot, project);
  // Check every project path component, including intermediate junctions.
  const workspace = await fs.realpath(workspaceRoot);
  if (
    !path.isAbsolute(project.path) ||
    !within(workspace, path.resolve(project.path))
  )
    throw new ApiError(403, "Project is outside the selected workspace.");
  await safeFile(workspace, path.relative(workspace, project.path));
  if (
    await fs.lstat(path.join(root, ".npmrc")).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    })
  )
    throw new ApiError(
      409,
      "Project checks are unavailable while a root .npmrc is present. Review its settings manually first.",
    );
  let manifest;
  try {
    manifest = await safeFile(root, "package.json");
  } catch (error) {
    if (error.status === 404) {
      const missing = new ApiError(
        409,
        "This project has no root package.json.",
      );
      missing.checkDiscoveryReason = "missing_manifest";
      throw missing;
    }
    throw error;
  }
  const raw = await boundedFile(manifest, MAX_MANIFEST, "package.json");
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new ApiError(409, "package.json must contain valid UTF-8 JSON.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed.scripts !== undefined &&
      (!parsed.scripts ||
        typeof parsed.scripts !== "object" ||
        Array.isArray(parsed.scripts)))
  )
    throw new ApiError(409, "package.json must contain a scripts object.");
  const scripts = parsed.scripts || {},
    checks = [];
  for (const [name, script] of Object.entries(scripts))
    if (typeof script !== "string" || script.includes("\0"))
      throw new ApiError(
        409,
        "Every package script must be a text command without null characters.",
      );
  for (const name of checkNames) {
    if (!Object.hasOwn(scripts, name) || !scripts[name].trim()) continue;
    const lifecycle = [
      scripts[`pre${name}`],
      scripts[name],
      scripts[`post${name}`],
    ].filter((s) => s !== undefined);
    if (
      lifecycle.some((s) => Buffer.byteLength(s) > MAX_SCRIPT) ||
      lifecycle.reduce((n, s) => n + Buffer.byteLength(s), 0) > 12 * 1024
    )
      throw new ApiError(
        409,
        "Check scripts must be at most 4 KiB each and 12 KiB including pre/post scripts.",
      );
    checks.push({
      name,
      script: redact(scripts[name]),
      ...(scripts[`pre${name}`]
        ? { preScript: redact(scripts[`pre${name}`]) }
        : {}),
      ...(scripts[`post${name}`]
        ? { postScript: redact(scripts[`post${name}`]) }
        : {}),
    });
  }
  return { root, workspace, manifestHash: digest(raw), checks };
}

export async function isolatedConfig(dataDir, workspace, create) {
  if (!dataDir || !path.isAbsolute(dataDir))
    throw new ApiError(409, "The private app data folder is unavailable.");
  const base = await fs.realpath(dataDir);
  if (
    !(await fs.stat(base)).isDirectory() ||
    (await fs.lstat(dataDir)).isSymbolicLink() ||
    within(workspace, base)
  )
    throw new ApiError(
      409,
      "npm config files require a private app folder outside the workspace.",
    );
  const dir = path.join(base, "npm-checks");
  if (create)
    await fs.mkdir(dir, { recursive: false, mode: 0o700 }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
  if (
    !(await fs.lstat(dir)).isDirectory() ||
    (await fs.lstat(dir)).isSymbolicLink() ||
    (await fs.realpath(dir)) !== dir
  )
    throw new ApiError(
      409,
      "The private npm config folder must not be linked.",
    );
  const result = {};
  for (const name of ["user", "global"]) {
    const file = path.join(dir, `${name}.npmrc`);
    if (create)
      await fs.writeFile(file, "", { flag: "wx", mode: 0o600 }).catch((e) => {
        if (e.code !== "EEXIST") throw e;
      });
    if ((await boundedFile(file, 0, "Private npm configuration")).length)
      throw new ApiError(409, "Private npm configuration must remain empty.");
    result[name] = file;
  }
  return result;
}

async function hashFile(file, max) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max)
    throw new ApiError(
      409,
      "The installed Node/npm runtime is unsupported or has changed.",
    );
  const hash = createHash("sha256");
  let size = 0;
  for await (const part of createReadStream(file)) {
    size += part.length;
    if (size > max)
      throw new ApiError(
        409,
        "The installed runtime exceeds the supported size.",
      );
    hash.update(part);
  }
  const after = await fs.lstat(file);
  if (
    size !== stat.size ||
    after.ino !== stat.ino ||
    after.mtimeMs !== stat.mtimeMs ||
    after.ctimeMs !== stat.ctimeMs
  )
    throw new ApiError(409, "The installed runtime changed during review.");
  return hash.digest("hex");
}

export async function runtimeSnapshot(runtime, workspace) {
  if (
    !runtime ||
    ![runtime.node, runtime.npmCli, runtime.npmRoot, runtime.shell].every(
      (p) => typeof p === "string" && path.isAbsolute(p),
    )
  )
    throw new ApiError(
      409,
      "Install Node.js with npm on this PC before running project checks.",
    );
  const resolved = {};
  for (const name of ["node", "npmCli", "npmRoot", "shell"]) {
    resolved[name] = await fs.realpath(runtime[name]);
    if (resolved[name] !== runtime[name] || within(workspace, resolved[name]))
      throw new ApiError(
        409,
        "Project checks require a trusted runtime installed outside the workspace.",
      );
  }
  if (
    !within(resolved.npmRoot, resolved.npmCli) ||
    resolved.npmCli !== path.join(resolved.npmRoot, "bin", "npm-cli.js")
  )
    throw new ApiError(
      409,
      "The npm entry point is not from the installed npm package.",
    );
  const hashes = [
    ["node", await hashFile(resolved.node, 256 * 1024 * 1024)],
    ["shell", await hashFile(resolved.shell, 64 * 1024 * 1024)],
  ];
  // Bind primary runtime files and configuration. The installed toolchain is
  // trusted: this is not code signing or a freeze of every imported dependency
  // (and project script source can also change independently of package.json).
  for (const relative of [
    "bin/npm-cli.js",
    "package.json",
    "npmrc",
    "lib/cli.js",
    "lib/cli/entry.js",
  ]) {
    const file = path.join(resolved.npmRoot, relative);
    const info = await fs.lstat(file).catch((error) => {
      if (
        error.code === "ENOENT" &&
        relative !== "bin/npm-cli.js" &&
        relative !== "package.json"
      )
        return null;
      throw error;
    });
    hashes.push([
      relative,
      info ? await hashFile(file, 16 * 1024 * 1024) : null,
    ]);
  }
  return { ...resolved, hash: digest(JSON.stringify(hashes)) };
}

function argumentsFor(runtime, root, config, name) {
  return [
    runtime.npmCli,
    `--prefix=${root}`,
    `--userconfig=${config.user}`,
    `--globalconfig=${config.global}`,
    `--script-shell=${runtime.shell}`,
    "--workspaces=false",
    "--include-workspace-root=false",
    "--ignore-scripts=false",
    "--if-present=false",
    "--node-options=",
    "--offline=true",
    "--update-notifier=false",
    "--audit=false",
    "--fund=false",
    "--logs-max=0",
    "--progress=false",
    "run",
    name,
  ];
}

export function checkEnvironment(runtime, config, source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source))
    if (
      !/^(?:NODE(?:_|$)|NPM(?:_|$)|ELECTRON_|COREPACK_|LD_|DYLD_|BASH_ENV$|ENV$|COMSPEC$|SHELL$|PATH$|PATHEXT$|INIT_CWD$)/i.test(
        key,
      )
    )
      env[key] = value;
  const inheritedPath =
    Object.entries(source).find(([k]) => k.toUpperCase() === "PATH")?.[1] || "";
  env.PATH = [
    path.dirname(runtime.node),
    ...inheritedPath
      .split(path.delimiter)
      .filter((p) => p && path.isAbsolute(p)),
  ].join(path.delimiter);
  if (process.platform === "win32") {
    env.ComSpec = runtime.shell;
    env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
  } else env.SHELL = runtime.shell;
  Object.assign(env, {
    npm_config_userconfig: config.user,
    npm_config_globalconfig: config.global,
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_logs_max: "0",
    npm_config_script_shell: runtime.shell,
    npm_config_workspaces: "false",
    npm_config_node_options: "",
    npm_config_if_present: "false",
  });
  return env;
}

// Dependency injection is for offline tests. HTTP callers never supply a
// runtime resolver or environment; the exported default functions use the
// installed-runtime resolver above.
export function createProjectCheckTools({
  resolveRuntime = installedCheckRuntime,
  environment = () => process.env,
  checkNames = CHECK_NAMES,
} = {}) {
  async function discoverChecks({ workspaceRoot, project }) {
    const runtime = await resolveRuntime();
    const available = Boolean(runtime);
    const runtimeStatus = {
      available,
      ...(!available
        ? { detail: "Install Node.js with npm on this PC to run checks." }
        : {}),
    };
    try {
      const inspected = await inspectProject(
        workspaceRoot,
        project,
        checkNames,
      );
      return {
        supported: inspected.checks.length > 0,
        ...(!inspected.checks.length
          ? {
              reason: "no_scripts",
              detail:
                "No test, lint, typecheck, check or build scripts are defined in the root package.json.",
            }
          : {}),
        runtime: runtimeStatus,
        manifestHash: inspected.manifestHash,
        checks: inspected.checks,
      };
    } catch (error) {
      if (!(error instanceof ApiError) && error.code !== "ENOENT") throw error;
      return {
        supported: false,
        reason: error.checkDiscoveryReason || "unavailable",
        detail:
          error instanceof ApiError
            ? error.message
            : "This project has no root package.json.",
        runtime: runtimeStatus,
        checks: [],
      };
    }
  }

  async function prepareCheck({
    workspaceRoot,
    project,
    dataDir,
    name,
    manifestHash,
  }) {
    if (!checkNames.includes(name))
      throw new ApiError(400, "Choose test, lint, typecheck, check or build.");
    const inspected = await inspectProject(workspaceRoot, project, checkNames);
    if (
      typeof manifestHash !== "string" ||
      inspected.manifestHash !== manifestHash
    )
      throw new ApiError(
        409,
        "package.json changed. Refresh the checks and review a new request.",
      );
    const check = inspected.checks.find((check) => check.name === name);
    if (!check)
      throw new ApiError(
        409,
        "That check is not defined in the root package.json.",
      );
    const runtime = await runtimeSnapshot(
      await resolveRuntime(),
      inspected.workspace,
    );
    const config = await isolatedConfig(dataDir, inspected.workspace, true);
    const args = argumentsFor(runtime, inspected.root, config, name);
    return {
      projectId: project.id,
      command: runtime.node,
      args,
      projectRoot: inspected.root,
      workspaceRoot: inspected.workspace,
      manifestHash,
      checkName: name,
      preview: [
        WARNING,
        "",
        check.preScript && `pre${name}: ${check.preScript}`,
        `${name}: ${check.script}`,
        check.postScript && `post${name}: ${check.postScript}`,
      ]
        .filter((s) => s !== undefined && s !== false)
        .join("\n"),
      runtime,
      config,
    };
  }

  async function verifyCheck({ workspaceRoot, project, dataDir, operation }) {
    if (
      !operation ||
      operation.projectId !== project.id ||
      !checkNames.includes(operation.checkName)
    )
      throw new ApiError(409, "The check request does not match this project.");
    const inspected = await inspectProject(workspaceRoot, project, checkNames);
    if (
      inspected.root !== operation.projectRoot ||
      inspected.workspace !== operation.workspaceRoot ||
      inspected.manifestHash !== operation.manifestHash ||
      !inspected.checks.some((c) => c.name === operation.checkName)
    )
      throw new ApiError(
        409,
        "The project or package.json changed. Review a new check request.",
      );
    const runtime = await runtimeSnapshot(
      await resolveRuntime(),
      inspected.workspace,
    );
    const config = await isolatedConfig(dataDir, inspected.workspace, false);
    const args = argumentsFor(
      runtime,
      inspected.root,
      config,
      operation.checkName,
    );
    if (
      JSON.stringify(runtime) !== JSON.stringify(operation.runtime) ||
      JSON.stringify(config) !== JSON.stringify(operation.config) ||
      operation.command !== runtime.node ||
      JSON.stringify(args) !== JSON.stringify(operation.args)
    )
      throw new ApiError(
        409,
        "The runtime or check configuration changed. Review a new request.",
      );
    // Close the relatively long runtime-fingerprinting window. As with any
    // external process launch this cannot eliminate a concurrent local change
    // between the last check and npm reading its files.
    const current = await inspectProject(workspaceRoot, project, checkNames);
    if (
      current.root !== inspected.root ||
      current.workspace !== inspected.workspace ||
      current.manifestHash !== inspected.manifestHash
    )
      throw new ApiError(
        409,
        "The project changed during verification. Review a new check request.",
      );
    return {
      command: runtime.node,
      args,
      cwd: inspected.root,
      env: checkEnvironment(runtime, config, environment()),
    };
  }
  return { discoverChecks, prepareCheck, verifyCheck };
}

export const { discoverChecks, prepareCheck, verifyCheck } =
  createProjectCheckTools();
