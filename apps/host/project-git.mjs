import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { ApiError, safeFile, redact, within } from "./security.mjs";
import { stopProcess } from "./providers.mjs";

const MAX_ENTRIES = 1000,
  MAX_METADATA = 20000,
  MAX_DIFF = 256 * 1024;
const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";

export async function findGit() {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env.ProgramFiles || "C:\\Program Files",
            "Git",
            "cmd",
            "git.exe",
          ),
          path.join(
            process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
            "Git",
            "cmd",
            "git.exe",
          ),
          path.join(
            process.env.LOCALAPPDATA ||
              path.join(os.homedir(), "AppData", "Local"),
            "Programs",
            "Git",
            "cmd",
            "git.exe",
          ),
        ]
      : ["/usr/bin/git", "/usr/local/bin/git"];
  for (const dir of (process.env.PATH || "").split(path.delimiter))
    if (path.isAbsolute(dir))
      candidates.push(
        path.join(dir, process.platform === "win32" ? "git.exe" : "git"),
      );
  for (const file of candidates)
    if ((await fs.stat(file).catch(() => null))?.isFile())
      return await fs.realpath(file);
  return null;
}

export function gitEnvironment(isolatedHome, source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source))
    if (
      !/^(GIT_|HOME$|USERPROFILE$|XDG_CONFIG_HOME$|PAGER$|LESS$|NODE_OPTIONS$|LD_PRELOAD$|DYLD_)/i.test(
        key,
      )
    )
      env[key] = value;
  // These are child-only home directories, not changes to the user's profile.
  // Git 2.29 does not honour the newer CONFIG_GLOBAL/SYSTEM overrides alone.
  return {
    ...env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: isolatedHome,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: nullFile,
    GIT_CONFIG_GLOBAL: nullFile,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "",
    LANG: "C",
    LC_ALL: "C",
  };
}

export function runReadOnlyGit(
  file,
  args,
  {
    cwd,
    env,
    root,
    gitDir,
    maxBytes = 2 * 1024 * 1024,
    timeoutMs = 15000,
    spawnImpl = spawn,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const base = ["--no-pager", "--no-optional-locks", "--literal-pathspecs"];
    if (gitDir) base.push(`--git-dir=${gitDir}`, `--work-tree=${root}`);
    const child = spawnImpl(file, [...base, ...args], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      error = "",
      bytes = 0,
      settled = false,
      truncated = false;
    const decoder = new StringDecoder("utf8");
    const finish = (failure, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      failure ? reject(failure) : resolve(result);
    };
    const timer = setTimeout(() => {
      stopProcess(child);
      finish(
        new ApiError(
          408,
          "Git inspection took too long. Try a smaller repository.",
        ),
      );
    }, timeoutMs);
    child.on("error", () =>
      finish(new ApiError(409, "Git could not start. Check its installation.")),
    );
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      const remaining = Math.max(0, maxBytes - bytes);
      bytes += chunk.length;
      output += decoder.write(chunk.subarray(0, remaining));
      if (bytes > maxBytes && !truncated) {
        truncated = true;
        stopProcess(child);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (error.length < 4000)
        error += chunk.toString("utf8").slice(0, 4000 - error.length);
    });
    child.on("close", (code) => {
      if (!truncated) output += decoder.end();
      finish(null, { code, output, error: redact(error), truncated });
    });
  });
}

export function parseStatus(output, { truncated = false } = {}) {
  const parts = output.split("\0"),
    entries = [];
  if (parts.at(-1) === "") parts.pop();
  else if (truncated) parts.pop();
  else if (output)
    throw new ApiError(409, "Git returned an incomplete status record.");
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    if (
      record.length < 4 ||
      record[2] !== " " ||
      !/^[ MTADRCU?!]{2}$/.test(record.slice(0, 2))
    )
      throw new ApiError(409, "Git returned an unrecognised status record.");
    const entry = {
      path: record.slice(3),
      indexStatus: record[0],
      worktreeStatus: record[1],
    };
    if (/[RC]/.test(record.slice(0, 2))) {
      if (!parts[i + 1])
        throw new ApiError(409, "Git returned an incomplete rename record.");
      entry.originalPath = parts[++i];
    }
    if (entries.length < MAX_ENTRIES) entries.push(entry);
    else truncated = true;
  }
  return { entries, truncated };
}

async function inspectMetadata(gitDir) {
  let count = 0;
  const deadline = Date.now() + 15000;
  const walk = async (dir, depth) => {
    if (depth > 24)
      throw new ApiError(
        409,
        "This repository has unusually deep Git metadata and cannot be inspected here.",
      );
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (Date.now() > deadline)
        throw new ApiError(
          408,
          "Git metadata inspection took too long. Use Git directly for this repository.",
        );
      if (++count > MAX_METADATA)
        throw new ApiError(
          409,
          "This repository has more than 20,000 Git metadata entries. Use Git directly for this repository.",
        );
      const file = path.join(dir, entry.name),
        info = await fs.lstat(file),
        relative = path
          .relative(gitDir, file)
          .replaceAll("\\", "/")
          .toLowerCase();
      if (
        info.isSymbolicLink() ||
        (!info.isFile() && !info.isDirectory()) ||
        !within(gitDir, await fs.realpath(file)) ||
        (info.isFile() && info.nlink > 1)
      )
        throw new ApiError(
          403,
          "Linked Git metadata is not supported. Use an ordinary independent clone.",
        );
      if (
        [
          "commondir",
          "gitdir",
          "config.worktree",
          "objects/info/alternates",
          "objects/info/http-alternates",
        ].includes(relative) ||
        relative.endsWith(".promisor")
      )
        throw new ApiError(
          409,
          "Linked worktrees, shared objects and partial clones are not supported in this preview.",
        );
      if (info.isDirectory()) await walk(file, depth + 1);
    }
  };
  await walk(gitDir, 0);
  for (const [name, directory] of [
    ["config", false],
    ["HEAD", false],
    ["objects", true],
    ["refs", true],
  ]) {
    const stat = await fs.lstat(path.join(gitDir, name)).catch(() => null);
    if (!stat || (directory ? !stat.isDirectory() : !stat.isFile()))
      throw new ApiError(409, "The project Git metadata is incomplete.");
  }
  if ((await fs.stat(path.join(gitDir, "config"))).size > 1024 * 1024)
    throw new ApiError(409, "The Git configuration is too large.");
}

export class ProjectGit {
  constructor(dataDir, { locate = findGit, run = runReadOnlyGit } = {}) {
    this.home = path.join(dataDir, "git-reader-home");
    this.locate = locate;
    this.run = run;
  }
  async context(root) {
    const file = await this.locate();
    if (!file) return { available: false, repository: false };
    const gitDir = path.join(root, ".git"),
      info = await fs.lstat(gitDir).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (!info) return { available: true, repository: false };
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      path.relative(gitDir, await fs.realpath(gitDir)) !== ""
    )
      throw new ApiError(
        409,
        "Git inspection supports a project-root .git directory. Linked worktrees and nested repositories must be opened with Git directly.",
      );
    await inspectMetadata(gitDir);
    await fs.mkdir(this.home, { recursive: true });
    if (
      (await fs.lstat(this.home)).isSymbolicLink() ||
      (await fs.readdir(this.home)).length
    )
      throw new ApiError(
        409,
        "The isolated Git reader profile is not empty. Inspect the host data folder before continuing.",
      );
    const env = gitEnvironment(this.home),
      options = { cwd: this.home, env, root, gitDir };
    const configuration = path.join(gitDir, "config"),
      fingerprint = await fs.lstat(configuration);
    const guard = async () => {
      const current = await fs.lstat(gitDir),
        configStat = await fs.lstat(configuration);
      if (
        current.isSymbolicLink() ||
        current.ino !== info.ino ||
        configStat.isSymbolicLink() ||
        configStat.nlink > 1 ||
        configStat.ino !== fingerprint.ino ||
        configStat.size !== fingerprint.size ||
        configStat.mtimeMs !== fingerprint.mtimeMs
      )
        throw new ApiError(
          409,
          "Git metadata changed during inspection. Refresh and try again.",
        );
    };
    const config = await this.run(
      file,
      [
        "config",
        "--file",
        path.join(gitDir, "config"),
        "--no-includes",
        "--null",
        "--list",
      ],
      { ...options, gitDir: undefined, maxBytes: 1024 * 1024 },
    );
    if (config.code !== 0 || config.truncated)
      throw new ApiError(
        409,
        "Git configuration could not be inspected safely.",
      );
    for (const record of config.output.split("\0").filter(Boolean)) {
      const separator = record.indexOf("\n"),
        key = (
          separator < 0 ? record : record.slice(0, separator)
        ).toLowerCase(),
        value = separator < 0 ? "" : record.slice(separator + 1);
      if (
        /^include(?:if\..*)?\.path$|^filter\..*\.(clean|smudge|process)$|^core\.(fsmonitor|fsmonitorhookversion|worktree|attributesfile|excludesfile)$|^diff\.orderfile$|^extensions\.|^remote\..*\.promisor$/.test(
          key,
        ) ||
        (key === "core.bare" &&
          !["false", "no", "off", "0"].includes(value.toLowerCase().trim()))
      )
        throw new ApiError(
          409,
          "This repository uses external filters, monitors, configuration includes or shared/partial storage. Use Git directly for this repository.",
        );
    }
    // No true/false fsmonitor override: old Git treats those values as hook names.
    // Do not allow repository replacement during the checks above.
    await guard();
    return { available: true, repository: true, file, options, guard };
  }
  async invoke(context, args, options = {}) {
    await context.guard();
    const result = await this.run(
      context.file,
      [
        "-c",
        "color.ui=false",
        "-c",
        "core.pager=",
        "-c",
        "diff.renames=false",
        "-c",
        "status.submoduleSummary=false",
        ...args,
      ],
      { ...context.options, ...options },
    );
    if (result.code !== 0 && !result.truncated)
      throw new ApiError(
        409,
        "Git could not inspect this repository. Check it with Git directly.",
      );
    return result;
  }
  async status(root) {
    const context = await this.context(root);
    const empty = {
      available: context.available,
      repository: context.repository,
      branch: null,
      head: null,
      entries: [],
      truncated: false,
    };
    if (!context.repository) return empty;
    const result = await this.invoke(context, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=all",
      "--no-renames",
    ]);
    const parsed = parseStatus(result.output, result);
    await context.guard();
    const branch = await this.run(
      context.file,
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { ...context.options, maxBytes: 4096 },
    );
    await context.guard();
    const head = await this.run(
      context.file,
      ["rev-parse", "--verify", "HEAD"],
      { ...context.options, maxBytes: 4096 },
    );
    return {
      ...empty,
      ...parsed,
      branch: branch.code === 0 ? redact(branch.output.trim()) : null,
      head:
        head.code === 0 && /^[a-f0-9]{40,64}$/i.test(head.output.trim())
          ? head.output.trim()
          : null,
    };
  }
  async diff(root, relative, staged = false) {
    if (
      typeof relative !== "string" ||
      !relative ||
      relative.length > 2000 ||
      /[\x00-\x1f]/.test(relative)
    )
      throw new ApiError(400, "Choose one project file.");
    const target = await safeFile(root, relative, { allowMissing: true }),
      stat = await fs.lstat(target).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (stat && !stat.isFile())
      throw new ApiError(400, "Choose a file rather than a folder.");
    const context = await this.context(root);
    if (!context.repository)
      throw new ApiError(
        409,
        context.available
          ? "This project is not a Git repository."
          : "Install Git to inspect changes.",
      );
    const filePath = path.relative(root, target).replaceAll("\\", "/");
    const status = await this.invoke(context, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=all",
      "--no-renames",
      "--",
      filePath,
    ]);
    const entry = parseStatus(status.output, status).entries.find(
      (item) => item.path === filePath,
    );
    const base = {
      path: filePath,
      staged,
      content: "",
      truncated: false,
      binary: false,
      untracked: entry?.indexStatus === "?",
    };
    if (base.untracked) {
      if (staged) return base;
      if (!stat)
        throw new ApiError(404, "The file disappeared. Refresh changes.");
      await safeFile(root, relative);
      const handle = await fs.open(target, "r");
      try {
        const buffer = Buffer.alloc(MAX_DIFF + 1),
          { bytesRead } = await handle.read(buffer, 0, buffer.length, 0),
          data = buffer.subarray(0, bytesRead);
        if (data.includes(0)) return { ...base, binary: true };
        return {
          ...base,
          content: redact(
            new StringDecoder("utf8").write(data.subarray(0, MAX_DIFF)),
          ),
          truncated: bytesRead > MAX_DIFF,
        };
      } finally {
        await handle.close();
      }
    }
    if (!stat && !entry)
      throw new ApiError(
        404,
        "The requested file is not present in these changes.",
      );
    await safeFile(root, relative, { allowMissing: true });
    const result = await this.invoke(
      context,
      [
        "diff",
        ...(staged ? ["--cached"] : []),
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-renames",
        "--ignore-submodules=all",
        "--no-relative",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--",
        filePath,
      ],
      { maxBytes: MAX_DIFF },
    );
    return {
      ...base,
      content: redact(result.output),
      truncated: result.truncated,
      binary: /^Binary files .+ differ$/m.test(result.output),
    };
  }
}
