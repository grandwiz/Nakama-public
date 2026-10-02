import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  ApiError,
  digest,
  projectRoot,
  safeFile,
  within,
} from "./security.mjs";
import {
  boundedFile,
  installedCheckRuntime,
  isolatedConfig,
  runtimeSnapshot,
} from "./project-checks.mjs";

const REGISTRY = "https://registry.npmjs.org/";
const MAX_MANIFEST = 256 * 1024,
  MAX_LOCK = 8 * 1024 * 1024;
const MAPS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;
export const DEPENDENCY_WARNING =
  "Fetches the reviewed public npm packages and replaces the project's existing node_modules using npm ci. Package and lockfile bytes must remain unchanged. Lifecycle scripts are disabled (--ignore-scripts); packages needing native builds or postinstall setup may not work. This is not a sandbox or proof the website works. Private registries, credentials, local/git dependencies and workspace installs are unsupported.";

function failure(reason, detail) {
  const error = new ApiError(409, detail);
  error.dependencyReason = reason;
  return error;
}
function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function parse(raw, label) {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
    );
    if (plain(value)) return value;
  } catch {
    /* Return a content-free error; manifests may contain private values. */
  }
  throw failure(
    "invalid_manifest",
    `${label} must contain a JSON object in UTF-8.`,
  );
}
function dependencyMap(value) {
  if (value === undefined) return {};
  if (!plain(value) || Object.keys(value).length > 2000)
    throw failure(
      "unsupported_dependencies",
      "Dependency maps must be bounded package-name and registry-version objects.",
    );
  for (const [name, spec] of Object.entries(value))
    if (
      !PACKAGE.test(name) ||
      typeof spec !== "string" ||
      !spec.length ||
      spec.length > 200 ||
      !/^[a-zA-Z0-9*^~<>=|+.\s-]+$/.test(spec)
    )
      throw failure(
        "unsupported_dependencies",
        "Only ordinary public-registry dependency names and version ranges are supported; local, git, URL and alias sources are unavailable.",
      );
  return value;
}
function packageLocation(location) {
  const parts = location.split("/");
  let index = 0;
  while (index < parts.length) {
    if (parts[index++] !== "node_modules") return false;
    let name = parts[index++];
    if (name?.startsWith("@")) name += "/" + parts[index++];
    if (typeof name !== "string" || !PACKAGE.test(name)) return false;
  }
  return index === parts.length;
}
function registryPackage(entry) {
  if (
    !plain(entry) ||
    entry.link ||
    entry.inBundle ||
    entry.bundled ||
    !VERSION.test(entry.version || "")
  )
    throw failure(
      "unsupported_lockfile",
      "The lockfile contains a link, bundled package or unsupported package version.",
    );
  let url;
  try {
    url = new URL(entry.resolved);
  } catch {
    /* checked below */
  }
  if (
    !url ||
    url.protocol !== "https:" ||
    url.hostname !== "registry.npmjs.org" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(".tgz")
  )
    throw failure(
      "unsupported_registry",
      "Every locked package must use an unauthenticated HTTPS tarball from registry.npmjs.org.",
    );
  if (
    typeof entry.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity) ||
    Buffer.from(entry.integrity.slice(7), "base64").length !== 64
  )
    throw failure(
      "missing_integrity",
      "Every locked package must have one SHA-512 integrity value.",
    );
  for (const key of MAPS) dependencyMap(entry[key]);
}
async function exists(file) {
  return fs.lstat(file).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}
async function inspect({ workspaceRoot, project }) {
  const root = await projectRoot(workspaceRoot, project),
    workspace = await fs.realpath(workspaceRoot);
  if (
    !path.isAbsolute(project.path) ||
    !within(workspace, path.resolve(project.path))
  )
    throw failure(
      "outside_workspace",
      "The dependency project must be inside the selected workspace.",
    );
  await safeFile(workspace, path.relative(workspace, project.path));
  const modules = await exists(path.join(root, "node_modules"));
  if (
    modules &&
    (!modules.isDirectory() ||
      modules.isSymbolicLink() ||
      (await fs.realpath(path.join(root, "node_modules"))) !==
        path.join(root, "node_modules"))
  )
    throw failure(
      "linked_modules",
      "Existing node_modules must be an ordinary directory, not a link.",
    );
  for (const name of [
    ".npmrc",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ])
    if (await exists(path.join(root, name)))
      throw failure(
        "unsupported_configuration",
        "Dependency preparation requires only a root package-lock.json and no root .npmrc, shrinkwrap or other package-manager lockfile. Review existing configuration without deleting it blindly.",
      );
  const read = async (name, limit) => {
    if (!(await exists(path.join(root, name))))
      throw failure(
        name === "package.json" ? "missing_manifest" : "missing_lockfile",
        `A root ${name} is required. No lockfile will be generated automatically.`,
      );
    return boundedFile(await safeFile(root, name), limit, name);
  };
  const manifestRaw = await read("package.json", MAX_MANIFEST);
  const manifest = parse(manifestRaw, "package.json");
  if (
    manifest.workspaces !== undefined ||
    manifest.overrides !== undefined ||
    (manifest.packageManager !== undefined &&
      !/^npm@\d/.test(manifest.packageManager))
  )
    throw failure(
      "unsupported_configuration",
      "Workspace, override and non-npm package-manager configurations require a separate reviewed workflow.",
    );
  const declared = MAPS.flatMap((key) =>
    Object.keys(dependencyMap(manifest[key])),
  );
  if (!declared.length) {
    const error = failure(
      "no_dependencies",
      "The root package declares no npm dependencies; no dependency preparation was run.",
    );
    Object.assign(error, {
      manifestHash: digest(manifestRaw),
      nodeModulesPresent: Boolean(modules),
    });
    throw error;
  }
  if (!(await exists(path.join(root, "package-lock.json")))) {
    const error = failure(
      "missing_lockfile",
      "A root package-lock.json is required. No lockfile will be generated automatically.",
    );
    Object.assign(error, {
      manifestHash: digest(manifestRaw),
      nodeModulesPresent: Boolean(modules),
      manualDependenciesAvailable: Boolean(modules),
    });
    throw error;
  }
  const lockRaw = await read("package-lock.json", MAX_LOCK),
    lock = parse(lockRaw, "package-lock.json");
  if (lock.packages?.[""]?.workspaces !== undefined)
    throw failure(
      "unsupported_configuration",
      "Workspace package-lock files require a separate reviewed workflow.",
    );
  if (
    ![2, 3].includes(lock.lockfileVersion) ||
    !plain(lock.packages) ||
    !plain(lock.packages[""])
  )
    throw failure(
      "unsupported_lockfile",
      "Use a package-lock.json with lockfileVersion 2 or 3 and a root packages entry.",
    );
  for (const key of MAPS)
    if (
      !isDeepStrictEqual(
        dependencyMap(manifest[key]),
        dependencyMap(lock.packages[""][key]),
      )
    )
      throw failure(
        "lockfile_mismatch",
        "package.json and the lockfile root dependencies differ. Prepare a matching lockfile through a separate reviewed workflow.",
      );
  const entries = Object.entries(lock.packages).filter(
    ([location]) => location !== "",
  );
  if (entries.length > 10000)
    throw failure(
      "unsupported_lockfile",
      "This lockfile exceeds the 10,000-package limit.",
    );
  for (const [location, entry] of entries) {
    if (!packageLocation(location))
      throw failure(
        "unsupported_lockfile",
        "The lockfile contains an unsupported package location.",
      );
    registryPackage(entry);
  }
  // v2 retains an older dependency graph. Check its source-bearing entries too;
  // the installed npm must still support the authoritative packages map.
  // Legacy entry.dependencies is a nested graph, not a version map.
  if (lock.dependencies !== undefined) {
    const validateLegacy = (dependencies, depth = 0) => {
      if (!plain(dependencies) || depth > 30)
        throw failure(
          "unsupported_lockfile",
          "The legacy lockfile dependency graph is unsupported.",
        );
      for (const [name, entry] of Object.entries(dependencies)) {
        if (!PACKAGE.test(name) || !plain(entry))
          throw failure(
            "unsupported_lockfile",
            "The legacy lockfile contains an unsupported dependency.",
          );
        const { dependencies: nested, requires, ...fields } = entry;
        registryPackage(fields);
        dependencyMap(requires);
        if (nested !== undefined) validateLegacy(nested, depth + 1);
      }
    };
    validateLegacy(lock.dependencies);
  }
  return {
    root,
    workspace,
    manifestHash: digest(manifestRaw),
    lockHash: digest(lockRaw),
    packageCount: entries.length,
    lifecycleScriptCount:
      entries.filter(([, entry]) => entry.hasInstallScript === true).length +
      [
        "preinstall",
        "install",
        "postinstall",
        "prepublish",
        "preprepare",
        "prepare",
        "postprepare",
      ].filter((key) => typeof manifest.scripts?.[key] === "string").length,
    nodeModulesPresent: Boolean(modules),
  };
}
async function dependencyRuntime(resolveRuntime, workspace) {
  const runtime = await runtimeSnapshot(await resolveRuntime(), workspace);
  const manifest = parse(
    await boundedFile(
      path.join(runtime.npmRoot, "package.json"),
      MAX_MANIFEST,
      "Installed npm package",
    ),
    "Installed npm package",
  );
  if (
    manifest.name !== "npm" ||
    !/^\d+\./.test(manifest.version || "") ||
    Number(manifest.version.split(".")[0]) < 7
  )
    throw failure(
      "unsupported_runtime",
      "Dependency preparation requires an installed npm version 7 or later.",
    );
  const builtin = path.join(runtime.npmRoot, "npmrc");
  if (await exists(builtin)) {
    const content = (
      await boundedFile(builtin, 64 * 1024, "Installed npm configuration")
    ).toString("utf8");
    if (
      content
        .split(/\r?\n/)
        .some(
          (line) =>
            line.trim() &&
            !/^\s*[#;]/.test(line) &&
            !/^\s*(?:prefix|globalconfig)\s*=/.test(line),
        )
    )
      throw failure(
        "unsupported_configuration",
        "Installed npm configuration contains custom settings. Dependency preparation does not inherit registry credentials or account configuration.",
      );
  }
  return runtime;
}
async function privateDirectories(dataDir, workspace, create) {
  const config = await isolatedConfig(dataDir, workspace, create),
    base = await fs.realpath(dataDir);
  const directory = path.join(base, "npm-dependencies");
  const result = { ...config };
  for (const [key, dir] of [
    ["base", directory],
    ["cache", path.join(directory, "cache")],
    ["temp", path.join(directory, "temp")],
  ]) {
    if (create)
      await fs.mkdir(dir, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    const stat = await fs.lstat(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await fs.realpath(dir)) !== dir
    )
      throw failure(
        "unsupported_configuration",
        "Private dependency folders must remain ordinary directories outside the workspace.",
      );
    if (key !== "base") result[key] = dir;
  }
  return result;
}
function argsFor(runtime, root, config) {
  return [
    runtime.npmCli,
    `--prefix=${root}`,
    `--userconfig=${config.user}`,
    `--globalconfig=${config.global}`,
    `--cache=${config.cache}`,
    `--registry=${REGISTRY}`,
    "--ignore-scripts=true",
    "--workspaces=false",
    "--include-workspace-root=false",
    "--include=dev",
    "--include=optional",
    "--include=peer",
    "--audit=false",
    "--fund=false",
    "--update-notifier=false",
    "--logs-max=0",
    "--progress=false",
    "--strict-ssl=true",
    "--node-options=",
    "--fetch-retries=0",
    "--fetch-timeout=30000",
    "ci",
  ];
}
export function dependencyEnvironment(runtime, config, source = process.env) {
  const env = {};
  // A narrow OS allowlist deliberately omits HOME/USERPROFILE, account secrets,
  // proxies, certificate overrides, npm configuration and arbitrary PATH entries.
  for (const [key, value] of Object.entries(source))
    if (
      /^(?:SystemRoot|WINDIR|SystemDrive|OS|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|LANG|LC_ALL)$/i.test(
        key,
      ) &&
      typeof value === "string"
    )
      env[key] = value;
  Object.assign(env, {
    PATH: path.dirname(runtime.node),
    TEMP: config.temp,
    TMP: config.temp,
    TMPDIR: config.temp,
    npm_config_userconfig: config.user,
    npm_config_globalconfig: config.global,
    npm_config_cache: config.cache,
    npm_config_registry: REGISTRY,
    npm_config_ignore_scripts: "true",
    npm_config_workspaces: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    npm_config_logs_max: "0",
    npm_config_node_options: "",
  });
  return env;
}
function sameProject(inspected, operation) {
  return (
    inspected.root === operation.projectRoot &&
    inspected.workspace === operation.workspaceRoot &&
    inspected.manifestHash === operation.manifestHash &&
    inspected.lockHash === operation.lockHash
  );
}
function requester(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 100 ||
    /[\0\r\n]/.test(value)
  )
    throw new ApiError(
      400,
      "A recorded requester is required for dependency preparation.",
    );
  return value;
}
export function createProjectDependencyTools({
  resolveRuntime = installedCheckRuntime,
  environment = () => process.env,
} = {}) {
  async function discoverDependencies(context) {
    const runtime = { available: Boolean(await resolveRuntime()) };
    try {
      const value = await inspect(context);
      return {
        supported: true,
        preparationNeeded: true,
        runtime,
        manifestHash: value.manifestHash,
        lockHash: value.lockHash,
        packageCount: value.packageCount,
        lifecycleScriptCount: value.lifecycleScriptCount,
        nodeModulesPresent: value.nodeModulesPresent,
        warning: DEPENDENCY_WARNING,
      };
    } catch (error) {
      if (!(error instanceof ApiError) && error.code !== "ENOENT") throw error;
      return {
        supported: false,
        preparationNeeded: !["missing_manifest", "no_dependencies"].includes(
          error.dependencyReason,
        ),
        manualDependenciesAvailable:
          error.dependencyReason === "missing_lockfile" &&
          error.manualDependenciesAvailable === true,
        nodeModulesPresent: error.nodeModulesPresent === true,
        ...(error.manifestHash ? { manifestHash: error.manifestHash } : {}),
        runtime,
        reason: error.dependencyReason || "unavailable",
        detail:
          error instanceof ApiError
            ? error.message
            : "Required project files or folders are unavailable.",
        warning: DEPENDENCY_WARNING,
      };
    }
  }
  async function prepareDependencies({
    workspaceRoot,
    project,
    dataDir,
    manifestHash,
    lockHash,
    requestedBy,
  }) {
    requester(requestedBy);
    const inspected = await inspect({ workspaceRoot, project });
    if (
      manifestHash !== inspected.manifestHash ||
      lockHash !== inspected.lockHash
    )
      throw failure(
        "changed",
        "Package or lockfile changed. Discover dependencies and review a fresh request.",
      );
    const runtime = await dependencyRuntime(
        resolveRuntime,
        inspected.workspace,
      ),
      config = await privateDirectories(dataDir, inspected.workspace, true);
    const current = await inspect({ workspaceRoot, project });
    if (
      current.manifestHash !== manifestHash ||
      current.lockHash !== lockHash ||
      current.root !== inspected.root ||
      current.workspace !== inspected.workspace
    )
      throw failure(
        "changed",
        "Project files changed during dependency preparation.",
      );
    return {
      kind: "npm_ci",
      projectId: project.id,
      requestedBy,
      projectRoot: inspected.root,
      workspaceRoot: inspected.workspace,
      manifestHash,
      lockHash,
      command: runtime.node,
      args: argsFor(runtime, inspected.root, config),
      runtime,
      config,
      packageCount: inspected.packageCount,
      lifecycleScriptCount: inspected.lifecycleScriptCount,
      preview: DEPENDENCY_WARNING,
      registry: REGISTRY,
      ignoreScripts: true,
    };
  }
  async function verifyDependencies({
    workspaceRoot,
    project,
    dataDir,
    operation,
    requestedBy,
  }) {
    requester(requestedBy);
    if (
      !operation ||
      operation.kind !== "npm_ci" ||
      operation.projectId !== project.id ||
      operation.requestedBy !== requestedBy ||
      operation.registry !== REGISTRY ||
      operation.ignoreScripts !== true
    )
      throw failure(
        "changed",
        "The dependency request does not match this project and requester.",
      );
    const inspected = await inspect({ workspaceRoot, project });
    if (!sameProject(inspected, operation))
      throw failure(
        "changed",
        "Project, package or lockfile changed. Review a fresh dependency request.",
      );
    const runtime = await dependencyRuntime(
        resolveRuntime,
        inspected.workspace,
      ),
      config = await privateDirectories(dataDir, inspected.workspace, false),
      args = argsFor(runtime, inspected.root, config);
    if (
      !isDeepStrictEqual(runtime, operation.runtime) ||
      !isDeepStrictEqual(config, operation.config) ||
      operation.command !== runtime.node ||
      !isDeepStrictEqual(args, operation.args)
    )
      throw failure(
        "changed",
        "The dependency runtime or exact configuration changed. Review a fresh request.",
      );
    if (!sameProject(await inspect({ workspaceRoot, project }), operation))
      throw failure(
        "changed",
        "Project files changed during dependency verification.",
      );
    return {
      command: runtime.node,
      args,
      cwd: inspected.root,
      env: dependencyEnvironment(runtime, config, environment()),
    };
  }
  async function verifyDependencyResult({
    workspaceRoot,
    project,
    operation,
    task,
    approvalId,
    requestedBy,
    processClosed = false,
  }) {
    requester(requestedBy);
    if (
      !operation ||
      operation.kind !== "npm_ci" ||
      operation.projectId !== project.id ||
      operation.requestedBy !== requestedBy ||
      !task ||
      task.kind !== "project_dependencies" ||
      task.projectId !== project.id ||
      task.requestedBy !== requestedBy ||
      !approvalId ||
      task.approvalId !== approvalId ||
      task.manifestHash !== operation.manifestHash ||
      task.lockHash !== operation.lockHash
    )
      throw failure(
        "mismatched_result",
        "The dependency outcome does not match the exact approved project, hashes and requester.",
      );
    if (!processClosed || task.status !== "completed" || task.exitCode !== 0)
      return {
        verified: false,
        completionEligible: false,
        summary:
          "Dependency preparation has no successful saved terminal outcome. Inspect its task; do not assume packages are ready.",
      };
    const inspected = await inspect({ workspaceRoot, project });
    if (!sameProject(inspected, operation))
      throw failure(
        "changed",
        "Package or lockfile changed after preparation; the result does not verify the current project.",
      );
    if (inspected.packageCount && !inspected.nodeModulesPresent)
      return {
        verified: false,
        completionEligible: false,
        summary:
          "npm reported success but node_modules is unavailable. Dependency preparation is not verified.",
      };
    return {
      verified: true,
      completionEligible: false,
      summary:
        "The exact npm ci process exited successfully and package/lockfile hashes are unchanged. Lifecycle scripts were disabled; builds and application acceptance remain separate.",
      taskId: task.id,
      approvalId,
      manifestHash: operation.manifestHash,
      lockHash: operation.lockHash,
      packageCount: inspected.packageCount,
      ignoreScripts: true,
    };
  }
  return {
    discoverDependencies,
    prepareDependencies,
    verifyDependencies,
    verifyDependencyResult,
  };
}
export const {
  discoverDependencies,
  prepareDependencies,
  verifyDependencies,
  verifyDependencyResult,
} = createProjectDependencyTools();
