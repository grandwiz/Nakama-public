import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
  ApiError,
  digest,
  now,
  redact,
  requireOwner,
  safeFile,
  uid,
  projectRoot,
  within,
} from "./security.mjs";
import { stopProcess } from "./providers.mjs";

const MAX_FILE = 256 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;
const MAX_AGE = 10 * 60 * 1000;
const objectId = /^[a-f0-9]{40}$/;
const disclosure =
  "This creates a local checkpoint of the selected working copies on top of the current HEAD. It leaves your branch, staging area and working files unchanged. It does not push, merge, restore, run hooks or sign a commit. Contents are stored exactly as reviewed, without Git filters or line-ending conversion. Existing HEAD files and history remain part of the checkpoint.";

function failChanged() {
  throw new ApiError(
    409,
    "The project, Git state or selected files changed. Prepare and review a fresh checkpoint.",
  );
}

function validateRequest(body) {
  if (
    !body ||
    Object.keys(body).some((key) => !["paths", "message"].includes(key)) ||
    !Array.isArray(body.paths) ||
    !body.paths.length ||
    body.paths.length > 20 ||
    typeof body.message !== "string" ||
    !body.message.trim() ||
    body.message.length > 500 ||
    /[\x00-\x1f\x7f]/.test(body.message)
  )
    throw new ApiError(
      400,
      "Select 1–20 changed text files and enter a one-line checkpoint message of 1–500 characters.",
    );
  const names = new Set();
  for (const relative of body.paths) {
    if (
      typeof relative !== "string" ||
      !relative ||
      relative.length > 500 ||
      /[\\\x00-\x1f\x7f]/.test(relative) ||
      relative.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new ApiError(400, "Choose canonical project-relative file paths.");
    if (names.has(relative.toLowerCase()))
      throw new ApiError(400, "Choose each file once.");
    names.add(relative.toLowerCase());
    if (
      relative
        .split("/")
        .some((part) =>
          /^\.env(?:\.|$)|^\.(?:ssh|aws|azure|kube|npmrc|pypirc|netrc|gitmodules)$|^(?:credentials|secrets?|auth)(?:\.|$)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|p12|pfx|jks|keystore)$/i.test(
            part,
          ),
        )
    )
      throw new ApiError(
        403,
        "Credential files cannot be included in Nakama checkpoints. Review them with Git directly if necessary.",
      );
  }
  if (redact(body.message) !== body.message)
    throw new ApiError(
      403,
      "The checkpoint message contains a possible credential.",
    );
  return { paths: [...body.paths], message: body.message.trim() };
}

function plainText(buffer) {
  if (buffer.length > MAX_FILE)
    throw new ApiError(
      413,
      "Checkpoint previews support text files up to 256 KiB per version.",
    );
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer,
    );
  } catch {
    throw new ApiError(415, "Checkpoint files must be UTF-8 text.");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content))
    throw new ApiError(
      415,
      "Binary or control-character files cannot be checkpointed here.",
    );
  if (
    redact(content) !== content ||
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/.test(content)
  )
    throw new ApiError(
      403,
      "A selected file contains a possible credential. Remove it and prepare a fresh checkpoint. Secret detection is not exhaustive; review every selected file.",
    );
  return content;
}

export async function regularBytes(file, maxBytes, { missing = false } = {}) {
  const info = await fs.lstat(file).catch((error) => {
    if (missing && error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1)
    throw new ApiError(
      403,
      "Linked or non-regular checkpoint files are not supported.",
    );
  if (info.size > maxBytes)
    throw new ApiError(413, "A checkpoint file or Git state is too large.");
  const handle = await fs.open(file, "r");
  try {
    const opened = await handle.stat();
    if (
      opened.ino !== info.ino ||
      opened.size !== info.size ||
      opened.mtimeMs !== info.mtimeMs ||
      opened.nlink > 1
    )
      failChanged();
    const data = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    const after = await handle.stat();
    if (
      bytesRead !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ino !== info.ino
    )
      failChanged();
    return data.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Unlike the read-only runner, a mutation retains its reservation until close. */
export function runCheckpointGit(
  file,
  args,
  {
    cwd,
    env,
    root,
    gitDir,
    input,
    binary = false,
    maxBytes = MAX_FILE + 1,
    timeoutMs = 15000,
    spawnImpl = spawn,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(
      file,
      [
        "--no-pager",
        "--no-optional-locks",
        "--literal-pathspecs",
        `--git-dir=${gitDir}`,
        `--work-tree=${root}`,
        ...args,
      ],
      {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      },
    );
    let output = "",
      error = "",
      bytes = 0,
      failure = null;
    const decoder = new StringDecoder("utf8"),
      chunks = [];
    const timer = setTimeout(() => {
      failure ||= new ApiError(
        408,
        "Git checkpoint processing took too long. Inspect local checkpoint refs before retrying.",
      );
      stopProcess(child);
    }, timeoutMs);
    child.on("error", () => {
      failure ||= new ApiError(
        409,
        "Git could not start. Check its installation.",
      );
    });
    child.stdout.on("data", (chunk) => {
      const remaining = Math.max(0, maxBytes - bytes);
      bytes += chunk.length;
      if (binary) chunks.push(chunk.subarray(0, remaining));
      else output += decoder.write(chunk.subarray(0, remaining));
      if (bytes > maxBytes && !failure) {
        failure = new ApiError(
          413,
          "Git returned more checkpoint data than can be reviewed safely.",
        );
        stopProcess(child);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (error.length < 4000)
        error += chunk.toString("utf8").slice(0, 4000 - error.length);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else
        resolve({
          code,
          output: binary ? Buffer.concat(chunks) : output + decoder.end(),
          error: redact(error),
        });
    });
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

export class ProjectCheckpoints {
  constructor(host, { run = runCheckpointGit, clock = Date.now } = {}) {
    this.host = host;
    this.run = run;
    this.clock = clock;
    this.previews = new Map();
    this.active = new Set();
    this.closed = false;
  }
  assertAvailable(projectId) {
    if (this.host.checkpointing.has(projectId))
      throw new ApiError(
        409,
        "A Git operation (checkpoint or repository update) is in progress. Wait for it to finish before changing this project.",
      );
  }
  guard(entry) {
    if (this.closed || this.host.closing)
      throw new ApiError(503, "Control Center is shutting down.");
    const project = this.host.project(entry.projectId);
    if (
      project.path !== entry.projectPath ||
      this.host.store.state.config.workspaceRoot !== entry.workspaceRoot
    )
      failChanged();
  }
  async locked(projectId, operation) {
    if (this.closed || this.host.closing)
      throw new ApiError(503, "Control Center is shutting down.");
    this.host.assertCheckAvailable(projectId);
    this.host.checkpointing.add(projectId);
    const task = Promise.resolve().then(operation);
    this.active.add(task);
    try {
      return await task;
    } finally {
      this.active.delete(task);
      this.host.checkpointing.delete(projectId);
    }
  }
  async context(root) {
    const context = await this.host.git.context(root);
    if (!context.repository)
      throw new ApiError(
        409,
        "Checkpoints need an ordinary project-root Git repository and an installed Git executable.",
      );
    // Replacement objects/grafts change the meaning of pinned commit IDs.
    if (
      await fs
        .lstat(path.join(context.options.gitDir, "info", "grafts"))
        .catch(() => null)
    )
      throw new ApiError(
        409,
        "Repositories using grafts cannot be checkpointed here.",
      );
    context.options.env = {
      ...context.options.env,
      GIT_NO_REPLACE_OBJECTS: "1",
    };
    return context;
  }
  async git(context, args, extra = {}) {
    await context.guard();
    const result = await this.run(
      context.file,
      [
        "-c",
        `core.hooksPath=${this.host.git.home}`,
        "-c",
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.safecrlf=false",
        "-c",
        "core.untrackedCache=false",
        "-c",
        "gc.auto=0",
        "-c",
        "maintenance.auto=false",
        "-c",
        "user.name=Nakama checkpoint",
        "-c",
        "user.email=checkpoint@nakama.invalid",
        ...args,
      ],
      { ...context.options, ...extra },
    );
    if (result.code !== 0)
      throw new ApiError(
        409,
        "Git could not create a safe local checkpoint. Inspect this repository with Git directly; no checkpoint is reported as created.",
      );
    return result.output;
  }
  async binding(context) {
    const gitDir = context.options.gitDir;
    const bytes = await Promise.all(
      ["HEAD", "index", "config"].map((name) =>
        regularBytes(path.join(gitDir, name), 32 * 1024 * 1024, {
          missing: name === "index",
        }),
      ),
    );
    const headText = bytes[0].toString("utf8");
    if (!/^(?:ref: refs\/heads\/[^\s]+|[a-f0-9]{40})\r?\n?$/.test(headText))
      throw new ApiError(
        409,
        "This repository HEAD format is not supported for checkpoints.",
      );
    const branch = headText.startsWith("ref: ")
      ? headText.trim().slice(5)
      : null;
    const result = await this.run(
      context.file,
      ["rev-parse", "--verify", "HEAD"],
      context.options,
    );
    const head = result.code === 0 ? result.output.trim() : null;
    if (head !== null && !objectId.test(head))
      throw new ApiError(
        409,
        "Only ordinary SHA-1 Git repositories are supported for checkpoints.",
      );
    if (!head)
      throw new ApiError(
        409,
        "Create the repository's first ordinary Git commit before making a Nakama checkpoint.",
      );
    for (const name of [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "rebase-merge",
      "rebase-apply",
      "index.lock",
      "HEAD.lock",
    ])
      if (await fs.lstat(path.join(gitDir, name)).catch(() => null))
        throw new ApiError(
          409,
          "Finish the active Git operation before preparing a checkpoint.",
        );
    return {
      head,
      branch,
      digest: digest(
        JSON.stringify([head, ...bytes.map((b) => (b ? digest(b) : null))]),
      ),
    };
  }
  async files(context, paths, head) {
    const root = context.options.root;
    const status = await this.host.git.status(root);
    if (status.truncated)
      throw new ApiError(
        409,
        "This repository has too many changes for a complete checkpoint review.",
      );
    const tree = head
      ? await this.git(context, ["ls-tree", "-r", "-z", head, "--", ...paths], {
          maxBytes: 64 * 1024,
        })
      : "";
    const original = new Map();
    for (const line of tree.split("\0").filter(Boolean)) {
      const match = line.match(/^(\d{6}) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/);
      if (
        !match ||
        !paths.includes(match[4]) ||
        match[2] !== "blob" ||
        !["100644", "100755"].includes(match[1])
      )
        throw new ApiError(
          409,
          "Only ordinary text files can be checkpointed; linked files, folders and submodules need Git directly.",
        );
      original.set(match[4], { mode: match[1], oid: match[3] });
    }
    const files = [];
    let total = 0;
    for (const relative of paths) {
      const entry = status.entries.find((item) => item.path === relative);
      if (
        !entry ||
        /[URC!]/.test(entry.indexStatus + entry.worktreeStatus) ||
        ["AA", "DD"].includes(entry.indexStatus + entry.worktreeStatus)
      )
        throw new ApiError(
          409,
          "Choose listed changed files without conflicts or renames. Refresh the Git changes first.",
        );
      const target = await safeFile(root, relative, { allowMissing: true });
      const afterBytes = await regularBytes(target, MAX_FILE, {
        missing: true,
      });
      await safeFile(root, relative, { allowMissing: true });
      const base = original.get(relative);
      const before = base
        ? plainText(
            await this.git(context, ["cat-file", "blob", base.oid], {
              binary: true,
            }),
          )
        : "";
      const after = afterBytes === null ? "" : plainText(afterBytes);
      total += Buffer.byteLength(before) + Buffer.byteLength(after);
      if (total > MAX_TOTAL)
        throw new ApiError(
          413,
          "Selected checkpoint versions exceed 2 MiB. Select fewer files.",
        );
      if (
        (!base && afterBytes === null) ||
        (base && afterBytes !== null && before === after)
      )
        throw new ApiError(
          409,
          "A selected working copy has no content change from HEAD. Deselect it; mode-only changes need Git directly.",
        );
      const fileStat = afterBytes === null ? null : await fs.lstat(target);
      const mode = base?.mode || "100644";
      if (
        process.platform !== "win32" &&
        fileStat &&
        (fileStat.mode & 0o111 ? "100755" : "100644") !== mode
      )
        throw new ApiError(409, "Executable-mode changes need Git directly.");
      files.push({
        path: relative,
        kind: !base ? "added" : afterBytes === null ? "deleted" : "modified",
        before,
        after,
        bytes: afterBytes?.length || 0,
        mode,
        status: `${entry.indexStatus}${entry.worktreeStatus}`,
      });
    }
    return files;
  }
  async prepare(projectId, body, principal) {
    requireOwner(principal);
    const request = validateRequest(body);
    for (const [key, entry] of this.previews)
      if (entry.expires <= this.clock()) this.previews.delete(key);
    if (this.previews.size >= 20)
      throw new ApiError(
        429,
        "Too many prepared checkpoints. Wait ten minutes for old previews to expire.",
      );
    return this.locked(projectId, async () => {
      const project = this.host.project(projectId);
      const entry = {
        id: uid(),
        projectId,
        projectPath: project.path,
        workspaceRoot: this.host.store.state.config.workspaceRoot,
        message: request.message,
        expires: this.clock() + MAX_AGE,
        status: "prepared",
      };
      const root = await projectRoot(entry.workspaceRoot, project);
      const context = await this.context(root);
      entry.root = root;
      entry.binding = await this.binding(context);
      entry.files = await this.files(
        context,
        request.paths,
        entry.binding.head,
      );
      this.guard(entry);
      if ((await this.binding(context)).digest !== entry.binding.digest)
        failChanged();
      entry.filesDigest = digest(JSON.stringify(entry.files));
      this.previews.set(entry.id, entry);
      return {
        id: entry.id,
        projectId,
        head: entry.binding.head,
        branch: entry.binding.branch?.replace(/^refs\/heads\//, "") || null,
        message: entry.message,
        expiresAt: new Date(entry.expires).toISOString(),
        files: entry.files.map(({ mode, status, ...file }) => file),
        disclosure,
      };
    });
  }
  async create(projectId, body, principal) {
    requireOwner(principal);
    if (
      !body ||
      Object.keys(body).some((key) => key !== "previewId") ||
      typeof body.previewId !== "string"
    )
      throw new ApiError(
        400,
        "Create one explicitly reviewed checkpoint preview.",
      );
    const entry = this.previews.get(body.previewId);
    if (
      !entry ||
      entry.projectId !== projectId ||
      entry.expires <= this.clock()
    )
      throw new ApiError(
        409,
        "This checkpoint preview expired or is unavailable. Prepare it again.",
      );
    try {
      this.guard(entry);
    } catch (error) {
      entry.status = "failed";
      throw error;
    }
    if (entry.status === "created") return structuredClone(entry.receipt);
    if (entry.status !== "prepared")
      throw new ApiError(
        409,
        "This checkpoint request was already used. Inspect local checkpoint refs before preparing another.",
      );
    return this.locked(projectId, async () => {
      entry.status = "creating";
      let scratch;
      try {
        const root = await projectRoot(
          entry.workspaceRoot,
          this.host.project(projectId),
        );
        if (root !== entry.root) failChanged();
        const context = await this.context(root);
        const verify = async () => {
          this.guard(entry);
          if ((await this.binding(context)).digest !== entry.binding.digest)
            failChanged();
          if (
            digest(
              JSON.stringify(
                await this.files(
                  context,
                  entry.files.map((f) => f.path),
                  entry.binding.head,
                ),
              ),
            ) !== entry.filesDigest
          )
            failChanged();
        };
        await verify();
        const scratchRoot = path.join(
          this.host.store.dir,
          "git-checkpoint-work",
        );
        await fs.mkdir(scratchRoot, { recursive: true });
        if (
          (await fs.lstat(scratchRoot)).isSymbolicLink() ||
          !within(
            await fs.realpath(this.host.store.dir),
            await fs.realpath(scratchRoot),
          )
        )
          throw new ApiError(
            403,
            "The checkpoint work folder must stay inside the host data directory.",
          );
        scratch = await fs.mkdtemp(path.join(scratchRoot, "checkpoint-"));
        const indexFile = path.join(scratch, "index");
        const env = { ...context.options.env, GIT_INDEX_FILE: indexFile };
        const isolated = { ...context, options: { ...context.options, env } };
        await this.git(isolated, [
          "read-tree",
          ...(entry.binding.head ? [entry.binding.head] : ["--empty"]),
        ]);
        let input = "";
        for (const file of entry.files) {
          this.guard(entry);
          if (file.kind === "deleted")
            input += `0 ${"0".repeat(40)}\t${file.path}\0`;
          else {
            const oid = (
              await this.git(
                isolated,
                ["hash-object", "-w", "--no-filters", "--stdin"],
                { input: Buffer.from(file.after, "utf8") },
              )
            ).trim();
            if (!objectId.test(oid))
              throw new ApiError(409, "Git returned an invalid file object.");
            input += `${file.mode} ${oid}\t${file.path}\0`;
          }
        }
        await this.git(isolated, ["update-index", "-z", "--index-info"], {
          input,
        });
        const tree = (await this.git(isolated, ["write-tree"])).trim();
        if (!objectId.test(tree))
          throw new ApiError(409, "Git returned an invalid tree object.");
        await verify();
        const commit = (
          await this.git(
            isolated,
            [
              "commit-tree",
              tree,
              ...(entry.binding.head ? ["-p", entry.binding.head] : []),
            ],
            { input: entry.message + "\n" },
          )
        ).trim();
        if (!objectId.test(commit))
          throw new ApiError(409, "Git returned an invalid checkpoint commit.");
        await verify();
        const ref = `refs/nakama/checkpoints/${entry.id}`;
        // A ref transaction also refuses a concurrently advanced HEAD. All
        // checkpoint refs are unique and created, never updated or overwritten.
        await this.git(isolated, ["update-ref", "--stdin"], {
          input: `verify HEAD ${entry.binding.head}\ncreate ${ref} ${commit}\n`,
        });
        const receipt = {
          id: entry.id,
          projectId,
          ref,
          commit,
          head: entry.binding.head,
          message: entry.message,
          files: entry.files.map((file) => file.path),
          createdAt: now(),
        };
        entry.status = "created";
        entry.receipt = receipt;
        return structuredClone(receipt);
      } catch (error) {
        entry.status = "failed";
        throw error;
      } finally {
        if (scratch) {
          const expected = path.join(
            this.host.store.dir,
            "git-checkpoint-work",
          );
          const resolved = await fs.realpath(scratch).catch(() => null);
          const expectedReal = await fs.realpath(expected).catch(() => null);
          if (
            expectedReal &&
            resolved === scratch &&
            within(expectedReal, resolved) &&
            path.basename(resolved).startsWith("checkpoint-")
          )
            await fs
              .rm(resolved, { recursive: true, force: true })
              .catch(() => {});
        }
      }
    });
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.active]);
    this.previews.clear();
  }
}
