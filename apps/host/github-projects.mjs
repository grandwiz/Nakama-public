import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProjectCheckpoints,
  regularBytes,
  runCheckpointGit,
} from "./project-checkpoints.mjs";
import {
  ApiError,
  digest,
  now,
  projectRoot,
  redact,
  safeFile,
  text,
  uid,
  within,
  workspace,
} from "./security.mjs";
import { findGit, gitEnvironment } from "./project-git.mjs";

const SHA = /^[a-f0-9]{40}$/;
const MAX_AGE = 10 * 60 * 1000;
const ZERO = "0".repeat(40);
const HELPER = fileURLToPath(
  new URL("./github-credential.cjs", import.meta.url),
);
const HELPER_COMMAND =
  '!f() { "$NAKAMA_GIT_NODE" "$NAKAMA_GIT_HELPER" "$@"; }; f';
const COMMIT_DISCLOSURE =
  "Creates a local commit from exactly these reviewed working copies, without filters, line-ending conversion, signing or repository hooks. Only selected index entries are updated; other staged changes and all working files remain untouched. Selected staged changes must be handled in Git directly. This does not push or deploy.";
const PUSH_DISCLOSURE =
  "Pushes this exact reviewed commit to this exact GitHub branch using the selected account. A changed local branch, account, repository or remote branch requires a fresh review. GitHub Actions or connected services may deploy, spend credits or send notifications when pushed. Approve only if you accept those repository automations.";

function fields(body, allowed) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw new ApiError(400, "Unexpected GitHub project fields.");
}
export function githubRepository(value) {
  if (typeof value !== "string")
    throw new ApiError(
      400,
      "Choose a GitHub owner/repository or HTTPS GitHub repository URL.",
    );
  let repository = value.trim();
  if (repository.startsWith("https://")) {
    let url;
    try {
      url = new URL(repository);
    } catch {
      throw new ApiError(400, "Invalid GitHub repository URL.");
    }
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /%/.test(url.pathname)
    )
      throw new ApiError(
        400,
        "Use an HTTPS github.com repository URL without credentials, query or fragment.",
      );
    repository = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  repository = repository.replace(/\.git$/, "");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
      repository,
    ) ||
    repository.split("/").some((p) => /\.\.|\.$/.test(p))
  )
    throw new ApiError(
      400,
      "Use owner/repository or https://github.com/owner/repository. SSH and other Git hosts are not supported.",
    );
  return repository;
}
function branchName(value) {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    /\.\.|\/\/|\/$|\.$|\.lock(?:\/|$)|\/\./i.test(value)
  )
    throw new ApiError(
      409,
      "This branch name is not supported in Nakama. Use Git directly.",
    );
  return value;
}
function changed() {
  throw new ApiError(
    409,
    "The reviewed Git state changed. Refresh and prepare a new review.",
  );
}
function hash(value) {
  return value === null ? null : digest(value);
}
function trackingRef(link, branch) {
  if (!/^[0-9]{1,20}$/.test(link.repositoryId))
    throw new ApiError(
      409,
      "Link this repository again to verify its GitHub identity.",
    );
  return `refs/nakama/github/${link.repositoryId}/${branchName(branch)}`;
}

/** Account-bound Git operations; model tools never receive this interface. */
export class GitHubProjects extends ProjectCheckpoints {
  constructor(host, options = {}) {
    super(host, options);
    this.transport =
      options.transport ||
      ((context, args, extra) =>
        this.run(context.file, args, { ...context.options, ...extra }));
  }
  access(principal) {
    if (this.closed || this.host.closing)
      throw new ApiError(503, "Control Center is shutting down.");
    if (principal?.kind === "owner") return;
    const device =
      principal?.kind === "device" &&
      this.host.store.state.devices.find((d) => d.id === principal.id);
    if (
      !device ||
      device.platform !== "android" ||
      device.permissions?.googleAccess === false ||
      device.permissions?.projectAccess === false
    )
      throw new ApiError(403, "This device cannot access GitHub projects.");
  }
  guard(entry) {
    super.guard(entry);
    if (entry.principal) this.access(entry.principal);
    if (
      entry.link &&
      JSON.stringify(this.host.project(entry.projectId).github) !==
        JSON.stringify(entry.link)
    )
      changed();
  }
  async context(root) {
    const context = await super.context(root);
    const raw = await super.git(
      context,
      ["config", "--local", "--no-includes", "--null", "--list"],
      { maxBytes: 1024 * 1024 },
    );
    // An allowlist, rather than a list of known executable settings, also blocks
    // future transport hooks, URL rewrites, proxies and credential helpers.
    for (const record of raw.split("\0").filter(Boolean)) {
      const key = record.split("\n")[0].toLowerCase();
      if (
        !/^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|safecrlf|protectntfs|protecthfs)|user\.(?:name|email)|remote\.[a-z0-9_-]+\.(?:url|fetch)|branch\..*\.(?:remote|merge))$/.test(
          key,
        )
      )
        throw new ApiError(
          409,
          "This repository has custom Git configuration. Network and commit actions require ordinary Git configuration without hooks, helpers, filters or custom programs. Inspect it with Git directly.",
        );
    }
    for (const marker of ["shallow", "nakama-commit-recovery.json"])
      if (
        await fs
          .lstat(path.join(context.options.gitDir, marker))
          .catch(() => null)
      )
        throw new ApiError(
          409,
          "Shallow repositories or unfinished Nakama commit recovery need Git directly before continuing.",
        );
    return context;
  }
  async git(context, args, extra = {}) {
    return super.git(
      context,
      [
        "-c",
        "core.quotePath=false",
        "-c",
        "merge.autostash=false",
        "-c",
        "fetch.recurseSubmodules=false",
        "-c",
        "submodule.recurse=false",
        ...args,
      ],
      extra,
    );
  }
  account(accountId) {
    return this.host.services.account("github", accountId);
  }
  async identity(accountId, repository) {
    this.account(accountId);
    const result = await this.host.services.githubRepository(
      accountId,
      githubRepository(repository),
    );
    githubRepository(result.repository);
    branchName(result.defaultBranch);
    return { ...result, accountId };
  }
  publicLink(link) {
    if (!link) return undefined;
    let accountLabel = "Account unavailable";
    try {
      const account = this.account(link.accountId);
      accountLabel =
        account.accountLabel || account.name || "Saved GitHub account";
    } catch {
      /* honest stale account label */
    }
    return { ...link, accountLabel };
  }
  async repositories(accountId, page, principal) {
    this.access(principal);
    const result = await this.host.services.list(
      "github",
      accountId,
      "repositories",
      { page },
    );
    this.access(principal);
    return {
      items: result.items,
      nextPage: result.hasMore ? Number(page || 1) + 1 : undefined,
    };
  }
  async snapshot(projectId, principal) {
    this.access(principal);
    const project = this.host.project(projectId);
    const root = await projectRoot(
      this.host.store.state.config.workspaceRoot,
      project,
    );
    const status = await this.host.git.status(root);
    if (project.github && status.repository && status.head && status.branch) {
      const context = await this.context(root);
      const remote = await this.run(
        context.file,
        ["rev-parse", "--verify", trackingRef(project.github, status.branch)],
        context.options,
      );
      if (remote.code === 0 && SHA.test(remote.output.trim())) {
        status.remoteHead = remote.output.trim();
        const counts = (
          await this.git(context, [
            "rev-list",
            "--left-right",
            "--count",
            `${status.head}...${status.remoteHead}`,
          ])
        )
          .trim()
          .split(/\s+/)
          .map(Number);
        [status.ahead, status.behind] = counts;
      }
    }
    this.access(principal);
    let busy = false;
    try {
      this.host.assertCheckAvailable(projectId);
    } catch (error) {
      if (error.status === 409) busy = true;
      else throw error;
    }
    return {
      linked: Boolean(project.github),
      link: this.publicLink(project.github),
      status,
      busy,
    };
  }
  async link(projectId, body, principal) {
    fields(body, ["accountId", "repository"]);
    this.access(principal);
    return this.locked(projectId, async () => {
      const project = this.host.project(projectId);
      const root = await projectRoot(
        this.host.store.state.config.workspaceRoot,
        project,
      );
      const context = await this.context(root);
      const binding = await this.binding(context);
      branchName(binding.branch?.replace(/^refs\/heads\//, ""));
      await this.inspectTree(context, binding.head);
      const link = await this.identity(body.accountId, body.repository);
      // A link never changes origin or local branch configuration.
      const configured = await this.git(context, [
        "config",
        "--local",
        "--get-regexp",
        "^remote\\..*\\.url$",
      ]).catch(() => "");
      for (const line of configured.trim().split("\n").filter(Boolean)) {
        const url = line.slice(line.indexOf(" ") + 1);
        if (
          githubRepository(url).toLowerCase() !== link.repository.toLowerCase()
        )
          throw new ApiError(
            409,
            "An existing remote points to a different repository. Nakama will not retarget it; review the remotes with Git directly.",
          );
      }
      if ((await this.binding(context)).digest !== binding.digest) changed();
      this.access(principal);
      return this.host.store.change((s) => {
        this.access(principal);
        this.account(body.accountId);
        if (this.host.project(projectId) !== project) changed();
        project.github = { ...link, linkedAt: now() };
        this.host.store.audit(
          s,
          "github.project_linked",
          principal,
          `${project.name}: ${link.repository}`,
        );
        return { link: this.publicLink(project.github) };
      });
    });
  }
  async credentials(link, principal) {
    this.access(principal);
    const identity = await this.identity(link.accountId, link.repository);
    if (
      identity.repositoryId !== link.repositoryId ||
      identity.repository.toLowerCase() !== link.repository.toLowerCase()
    )
      changed();
    const token = await this.host.vault?.get(`github:${link.accountId}`);
    if (
      typeof token !== "string" ||
      !token ||
      token.length > 16000 ||
      /[\r\n\0]/.test(token)
    )
      throw new ApiError(
        409,
        "The selected GitHub account has no usable saved credential.",
      );
    this.access(principal);
    this.account(link.accountId);
    return token;
  }
  async network(
    context,
    args,
    link,
    principal,
    { credentialDigest, guard } = {},
  ) {
    const token = await this.credentials(link, principal);
    if (credentialDigest && digest(token) !== credentialDigest) changed();
    await context.guard();
    this.access(principal);
    await guard?.();
    const scratch = await this.scratch(),
      helper = path.join(scratch, "credential.cjs");
    // Electron can read its bundled source; Git's external helper receives a
    // real filesystem script, independent of packed-asar command-line support.
    try {
      await fs.writeFile(helper, await fs.readFile(HELPER), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      await this.removeScratch(scratch);
      throw error;
    }
    const env = {
      ...context.options.env,
      GIT_ALLOW_PROTOCOL: "https",
      GIT_ASKPASS: "",
      SSH_ASKPASS: "",
      GCM_INTERACTIVE: "never",
      ELECTRON_RUN_AS_NODE: "1",
      NAKAMA_GIT_NODE: process.execPath,
      NAKAMA_GIT_HELPER: helper,
      NAKAMA_GITHUB_REPOSITORY: `${link.repository}.git`,
      NAKAMA_GITHUB_CREDENTIAL: token,
    };
    // Disable inherited HTTP proxy/auth configuration as well as Git config.
    for (const key of Object.keys(env))
      if (
        /^(?:https?_proxy|all_proxy|no_proxy|curl_|ssl_cert_|sslkeylogfile$|nakama_git(?:hub)?_)/i.test(
          key,
        ) &&
        ![
          "NAKAMA_GIT_NODE",
          "NAKAMA_GIT_HELPER",
          "NAKAMA_GITHUB_REPOSITORY",
          "NAKAMA_GITHUB_CREDENTIAL",
        ].includes(key)
      )
        delete env[key];
    let result;
    try {
      result = await this.transport(
        context,
        [
          "-c",
          `core.hooksPath=${this.host.git.home}`,
          "-c",
          "credential.helper=",
          "-c",
          `credential.helper=${HELPER_COMMAND}`,
          "-c",
          "credential.useHttpPath=true",
          "-c",
          "http.followRedirects=false",
          "-c",
          "http.sslVerify=true",
          "-c",
          "http.proxy=",
          "-c",
          "protocol.allow=never",
          "-c",
          "protocol.https.allow=always",
          "-c",
          "fetch.recurseSubmodules=false",
          "-c",
          "submodule.recurse=false",
          "-c",
          "gc.auto=0",
          "-c",
          "maintenance.auto=false",
          ...args,
        ],
        { env, timeoutMs: 120000, maxBytes: 1024 * 1024 },
      );
    } catch {
      throw new ApiError(
        502,
        "GitHub transport did not return a confirmed result. Inspect GitHub before retrying a push; no success is claimed.",
      );
    } finally {
      delete env.NAKAMA_GITHUB_CREDENTIAL;
      await this.removeScratch(scratch);
    }
    this.access(principal);
    this.account(link.accountId);
    if (result.code !== 0)
      throw new ApiError(
        409,
        "GitHub rejected the operation or its result is unconfirmed. Check account permissions, branch rules and repository state. Provider output is hidden to protect credentials.",
      );
    return result.output;
  }
  async remote(context, link, branch, principal) {
    const output = await this.network(
      context,
      [
        "ls-remote",
        "--refs",
        `https://github.com/${link.repository}.git`,
        `refs/heads/${branchName(branch)}`,
      ],
      link,
      principal,
    );
    const rows = output.trim().split("\n").filter(Boolean);
    if (!rows.length) return null;
    if (rows.length !== 1)
      throw new ApiError(502, "GitHub returned an ambiguous branch.");
    const [sha, ref] = rows[0].split(/\s+/);
    if (!SHA.test(sha) || ref !== `refs/heads/${branch}`)
      throw new ApiError(502, "GitHub returned an invalid branch identity.");
    return sha;
  }
  async inspectTree(context, sha) {
    const output = await this.git(context, ["ls-tree", "-r", "-z", sha], {
      maxBytes: 4 * 1024 * 1024,
    });
    const seen = new Set();
    for (const row of output.split("\0").filter(Boolean)) {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(
        row,
      );
      if (
        !match ||
        /[\x00-\x1f\x7f\\]/.test(match[3]) ||
        match[3].split("/").some((p) => p.toLowerCase() === ".gitmodules")
      )
        throw new ApiError(
          409,
          "Repositories containing symbolic links, submodules or unsafe paths need Git directly.",
        );
      const key = match[3].toLowerCase();
      if (seen.has(key))
        throw new ApiError(
          409,
          "Case-colliding repository paths cannot be imported safely.",
        );
      seen.add(key);
      await safeFile(context.options.root, match[3], { allowMissing: true });
    }
  }
  async projectContext(projectId, principal) {
    this.access(principal);
    const project = this.host.project(projectId);
    if (!project.github)
      throw new ApiError(
        409,
        "Link this project to a saved GitHub account and repository first.",
      );
    this.account(project.github.accountId);
    const entry = {
      projectId,
      projectPath: project.path,
      workspaceRoot: this.host.store.state.config.workspaceRoot,
      link: structuredClone(project.github),
      principal: { ...principal },
    };
    const root = await projectRoot(entry.workspaceRoot, project);
    const context = await this.context(root);
    const binding = await this.binding(context);
    const branch = branchName(binding.branch?.replace(/^refs\/heads\//, ""));
    this.guard(entry);
    return { entry, context, binding, branch };
  }
  async fetchHead(context, link, branch, principal) {
    await this.network(
      context,
      [
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        "--no-write-fetch-head",
        `https://github.com/${link.repository}.git`,
        `refs/heads/${branch}:${trackingRef(link, branch)}`,
      ],
      link,
      principal,
    );
    const head = (
      await this.git(context, [
        "rev-parse",
        "--verify",
        trackingRef(link, branch),
      ])
    ).trim();
    if (!SHA.test(head))
      throw new ApiError(502, "GitHub returned an unsupported object ID.");
    return head;
  }
  async fetch(projectId, principal, pull = false) {
    this.access(principal);
    return this.locked(projectId, async () => {
      const { entry, context, binding, branch } = await this.projectContext(
        projectId,
        principal,
      );
      if (pull) await this.clean(context.options.root);
      const remoteHead = await this.fetchHead(
        context,
        entry.link,
        branch,
        principal,
      );
      this.guard(entry);
      if ((await this.binding(context)).digest !== binding.digest) changed();
      if (pull && remoteHead !== binding.head) {
        await this.ancestor(context, binding.head, remoteHead);
        await this.inspectTree(context, remoteHead);
        await this.clean(context.options.root);
        this.guard(entry);
        await this.git(
          context,
          ["merge", "--ff-only", "--no-edit", "--no-stat", remoteHead],
          { timeoutMs: 60000 },
        );
        const after = await this.binding(context);
        if (after.head !== remoteHead || after.branch !== binding.branch)
          changed();
      }
      const receipt = {
        projectId,
        status: pull ? "pulled" : "fetched",
        branch,
        head: pull ? remoteHead : binding.head,
        previousHead: binding.head,
        remoteHead,
        completedAt: now(),
      };
      await this.record(projectId, receipt, principal);
      return receipt;
    });
  }
  async clean(root) {
    const status = await this.host.git.status(root);
    if (status.truncated || status.entries.length)
      throw new ApiError(
        409,
        "Pull requires a completely clean working tree and staging area, including untracked files. Commit or handle your changes with Git first; Nakama never stashes them.",
      );
  }
  async ancestor(context, older, newer) {
    await context.guard();
    const result = await this.run(
      context.file,
      ["merge-base", "--is-ancestor", older, newer],
      context.options,
    );
    if (result.code !== 0)
      throw new ApiError(
        409,
        "The branches have diverged. Nakama allows only fast-forward updates; reconcile them with Git directly.",
      );
  }
  async record(projectId, receipt, principal) {
    this.access(principal);
    return this.host.store.change((s) => {
      this.access(principal);
      const project = this.host.project(projectId);
      project.githubLastOperation = receipt;
      project.updatedAt = now();
      this.host.store.audit(
        s,
        `github.${receipt.status || "committed"}`,
        principal,
        `${project.name}: ${receipt.commit || receipt.head || ""}`,
      );
    });
  }
  async prepareCommit(projectId, body, principal) {
    fields(body, ["paths", "message", "authorName", "authorEmail"]);
    this.access(principal);
    const authorName = text(body.authorName, "Commit author name", 100),
      authorEmail = text(body.authorEmail, "Commit author email", 254);
    if (
      /[<>\x00-\x1f\x7f]/.test(authorName) ||
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(
        authorEmail,
      ) ||
      redact(authorName) !== authorName
    )
      throw new ApiError(
        400,
        "Enter a plain commit author name and email address.",
      );
    // The base checkpoint preview contains exact UTF-8 before/after bytes and
    // binds HEAD, index, configuration, project root and selected file versions.
    const preview = await super.prepare(
      projectId,
      { paths: body.paths, message: body.message },
      { kind: "owner", id: "owner" },
    );
    const entry = this.previews.get(preview.id);
    this.access(principal);
    if (!preview.branch)
      throw new ApiError(
        409,
        "Commit needs a named branch; detached HEAD is not supported.",
      );
    branchName(preview.branch);
    await this.inspectTree(await this.context(entry.root), entry.binding.head);
    if (entry.files.some((f) => f.status[0] !== " " && f.status !== "??")) {
      this.previews.delete(entry.id);
      throw new ApiError(
        409,
        "A selected file already has staged changes. Handle that staged or partially staged file in Git directly, or choose other unstaged files. Existing staging is preserved.",
      );
    }
    try {
      this.access(principal);
    } catch (error) {
      this.previews.delete(entry.id);
      throw error;
    }
    Object.assign(entry, {
      kind: "commit",
      principal: { ...principal },
      authorName,
      authorEmail,
    });
    return {
      ...preview,
      authorName,
      authorEmail,
      disclosure: COMMIT_DISCLOSURE,
    };
  }
  preview(projectId, body, principal, kind) {
    fields(body, ["previewId"]);
    this.access(principal);
    const entry = this.previews.get(body.previewId);
    if (
      !entry ||
      entry.projectId !== projectId ||
      entry.kind !== kind ||
      entry.expires <= this.clock() ||
      entry.principal.kind !== principal.kind ||
      entry.principal.id !== principal.id
    )
      throw new ApiError(
        409,
        "This review expired or belongs to another requester. Prepare it again.",
      );
    this.guard(entry);
    return entry;
  }
  async commit(projectId, body, principal) {
    const entry = this.preview(projectId, body, principal, "commit");
    if (entry.status === "created") return structuredClone(entry.receipt);
    if (entry.status !== "prepared")
      throw new ApiError(
        409,
        "This commit review was already used. Inspect Git before retrying.",
      );
    return this.locked(projectId, async () => {
      entry.status = "creating";
      let scratch,
        lockHandle,
        lockFile,
        journal,
        context,
        advanced = false;
      try {
        const currentRoot = await projectRoot(
          entry.workspaceRoot,
          this.host.project(projectId),
        );
        if (currentRoot !== entry.root) changed();
        context = await this.context(currentRoot);
        const verify = async () => {
          this.guard(entry);
          if (
            (await this.binding(context)).digest !== entry.binding.digest ||
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
            changed();
        };
        await verify();
        scratch = await this.scratch();
        const indexFile = path.join(scratch, "commit-index"),
          stagedFile = path.join(scratch, "staging-index");
        const isolated = {
          ...context,
          options: {
            ...context.options,
            env: { ...context.options.env, GIT_INDEX_FILE: indexFile },
          },
        };
        const indexPath = path.join(context.options.gitDir, "index");
        const originalIndex = await regularBytes(indexPath, 32 * 1024 * 1024);
        await fs.writeFile(stagedFile, originalIndex, { flag: "wx" });
        await this.git(isolated, ["read-tree", entry.binding.head]);
        let input = "";
        for (const file of entry.files) {
          const oid =
            file.kind === "deleted"
              ? ZERO
              : (
                  await this.git(
                    isolated,
                    ["hash-object", "-w", "--no-filters", "--stdin"],
                    { input: Buffer.from(file.after, "utf8") },
                  )
                ).trim();
          if (!SHA.test(oid))
            throw new ApiError(409, "Git returned an invalid file object.");
          input += `${file.kind === "deleted" ? "0" : file.mode} ${oid}\t${file.path}\0`;
        }
        await this.git(isolated, ["update-index", "-z", "--index-info"], {
          input,
        });
        const staging = {
          ...context,
          options: {
            ...context.options,
            env: { ...context.options.env, GIT_INDEX_FILE: stagedFile },
          },
        };
        await this.git(staging, ["update-index", "-z", "--index-info"], {
          input,
        });
        const tree = (await this.git(isolated, ["write-tree"])).trim();
        if (!SHA.test(tree))
          throw new ApiError(409, "Git returned an invalid tree.");
        const commit = (
          await this.git(
            isolated,
            [
              "-c",
              `user.name=${entry.authorName}`,
              "-c",
              `user.email=${entry.authorEmail}`,
              "commit-tree",
              tree,
              "-p",
              entry.binding.head,
            ],
            { input: entry.message + "\n" },
          )
        ).trim();
        if (!SHA.test(commit))
          throw new ApiError(409, "Git returned an invalid commit.");
        await verify();
        const candidateLock = path.join(context.options.gitDir, "index.lock");
        lockHandle = await fs.open(candidateLock, "wx");
        lockFile = candidateLock;
        await lockHandle.writeFile(
          await regularBytes(stagedFile, 32 * 1024 * 1024),
        );
        await lockHandle.sync();
        await lockHandle.close();
        lockHandle = null;
        // Recheck the exact index after acquiring Git's own mutation lock.
        if (
          hash(await regularBytes(indexPath, 32 * 1024 * 1024)) !==
          hash(originalIndex)
        )
          changed();
        this.guard(entry);
        await context.guard();
        if (
          (await regularBytes(path.join(context.options.gitDir, "HEAD"), 4096))
            .toString()
            .trim() !== `ref: ${entry.binding.branch}`
        )
          changed();
        const selected = await this.files(
          context,
          entry.files.map((f) => f.path),
          entry.binding.head,
        );
        if (digest(JSON.stringify(selected)) !== entry.filesDigest) changed();
        const candidateJournal = path.join(
          context.options.gitDir,
          "nakama-commit-recovery.json",
        );
        await fs.writeFile(
          candidateJournal,
          JSON.stringify({
            version: 1,
            branch: entry.binding.branch,
            previousHead: entry.binding.head,
            commit,
            indexLock: "index.lock",
            createdAt: now(),
          }),
          { flag: "wx" },
        );
        journal = candidateJournal;
        // A timed-out/erroring process can have performed its ref write. Keep
        // recovery state unless a later read proves the old branch is intact.
        advanced = true;
        await this.git(context, [
          "update-ref",
          entry.binding.branch,
          commit,
          entry.binding.head,
        ]);
        await fs.rename(lockFile, indexPath);
        lockFile = null;
        await fs.unlink(journal);
        journal = null;
        const receipt = {
          id: entry.id,
          projectId,
          commit,
          head: entry.binding.head,
          branch: entry.binding.branch.slice(11),
          message: entry.message,
          files: entry.files.map((f) => f.path),
          createdAt: now(),
        };
        entry.status = "created";
        entry.receipt = receipt;
        await this.record(projectId, receipt, principal);
        return structuredClone(receipt);
      } catch (error) {
        entry.status = "failed";
        if (advanced && lockFile && context) {
          try {
            await context.guard();
            const current = await this.run(
              context.file,
              ["rev-parse", "--verify", entry.binding.branch],
              context.options,
            );
            if (
              current.code === 0 &&
              current.output.trim() === entry.binding.head
            )
              advanced = false;
          } catch {
            /* Unknown means retain recovery; never guess a failed write. */
          }
        }
        if (advanced && lockFile)
          throw new ApiError(
            409,
            "The commit reached the branch but staging finalisation was not confirmed. Keep .git/index.lock and .git/nakama-commit-recovery.json and inspect this repository with Git directly; do not repeat the commit.",
          );
        throw error;
      } finally {
        await lockHandle?.close().catch(() => {});
        if (!advanced) {
          if (lockFile) await fs.unlink(lockFile).catch(() => {});
          if (journal) await fs.unlink(journal).catch(() => {});
        }
        await this.removeScratch(scratch);
      }
    });
  }
  async preparePush(projectId, principal) {
    this.access(principal);
    for (const [id, preview] of this.previews)
      if (preview.expires <= this.clock()) this.previews.delete(id);
    if (this.previews.size >= 20)
      throw new ApiError(
        429,
        "Too many prepared Git reviews. Wait for existing reviews to expire.",
      );
    return this.locked(projectId, async () => {
      const { entry, context, binding, branch } = await this.projectContext(
        projectId,
        principal,
      );
      await this.inspectTree(context, binding.head);
      const remoteHead = await this.remote(
        context,
        entry.link,
        branch,
        principal,
      );
      if (remoteHead) {
        const fetched = await this.fetchHead(
          context,
          entry.link,
          branch,
          principal,
        );
        if (fetched !== remoteHead) changed();
        await this.ancestor(context, remoteHead, binding.head);
      }
      if ((await this.binding(context)).digest !== binding.digest) changed();
      this.guard(entry);
      const credentialDigest = digest(
        await this.credentials(entry.link, principal),
      );
      Object.assign(entry, {
        id: uid(),
        kind: "push",
        binding,
        branch,
        remoteHead,
        credentialDigest,
        expires: this.clock() + MAX_AGE,
        status: "prepared",
      });
      this.previews.set(entry.id, entry);
      return {
        id: entry.id,
        projectId,
        head: binding.head,
        branch,
        remoteHead,
        repository: entry.link.repository,
        accountLabel: this.publicLink(entry.link).accountLabel,
        expiresAt: new Date(entry.expires).toISOString(),
        disclosure: PUSH_DISCLOSURE,
      };
    });
  }
  async requestPush(projectId, body, principal) {
    const entry = this.preview(projectId, body, principal, "push");
    if (entry.status === "requested")
      return { approval: structuredClone(entry.approval) };
    if (entry.status !== "prepared")
      throw new ApiError(409, "This push review was already used.");
    entry.status = "requesting";
    try {
      const approval = await this.host.approval(
        "github_push",
        `Push ${entry.link.repository}: ${entry.branch}`,
        `${PUSH_DISCLOSURE}\nAccount: ${this.publicLink(entry.link).accountLabel}\nCommit: ${entry.binding.head}\nReviewed remote: ${entry.remoteHead || "new branch"}`,
        {
          projectId,
          previewId: entry.id,
          repository: entry.link.repository,
          branch: entry.branch,
          head: entry.binding.head,
          remoteHead: entry.remoteHead,
        },
        principal,
        { guard: () => this.guard(entry) },
      );
      entry.approval = approval;
      entry.status = "requested";
      return { approval };
    } catch (error) {
      entry.status = "failed";
      throw error;
    }
  }
  async approvedPush(operation, approval) {
    const entry = this.previews.get(operation.previewId);
    if (
      !entry ||
      entry.status !== "requested" ||
      entry.approval?.id !== approval.id ||
      entry.expires <= this.clock()
    )
      throw new ApiError(
        409,
        "This push review expired or the host restarted. Prepare and approve a new push.",
      );
    this.guard(entry);
    return this.locked(entry.projectId, async () => {
      entry.status = "pushing";
      try {
        const { context, binding, branch } = await this.projectContext(
          entry.projectId,
          entry.principal,
        );
        if (binding.digest !== entry.binding.digest || branch !== entry.branch)
          changed();
        if (
          (await this.remote(context, entry.link, branch, entry.principal)) !==
          entry.remoteHead
        )
          changed();
        if (entry.remoteHead)
          await this.ancestor(context, entry.remoteHead, binding.head);
        if (
          digest(await this.credentials(entry.link, entry.principal)) !==
          entry.credentialDigest
        )
          changed();
        this.guard(entry);
        // Lease is an exact compare-and-swap, allowed only after proving the
        // reviewed remote is an ancestor. Never +refspec or unconditional force.
        const pushOutput = await this.network(
          context,
          [
            "push",
            "--porcelain",
            "--no-verify",
            "--no-follow-tags",
            `--force-with-lease=refs/heads/${branch}:${entry.remoteHead || ""}`,
            `https://github.com/${entry.link.repository}.git`,
            `${binding.head}:refs/heads/${branch}`,
          ],
          entry.link,
          entry.principal,
          {
            credentialDigest: entry.credentialDigest,
            guard: async () => {
              this.guard(entry);
              if ((await this.binding(context)).digest !== entry.binding.digest)
                changed();
            },
          },
        );
        const upToDate = pushOutput
          .split("\n")
          .some((line) => line.startsWith("=\t"));
        // Git can report an already-equal ref without exercising its lease.
        // If it was not equal in the review, no approved update is confirmed.
        if (upToDate && entry.remoteHead !== binding.head) changed();
        const confirmed = await this.remote(
          context,
          entry.link,
          branch,
          entry.principal,
        );
        if (confirmed !== binding.head)
          throw new ApiError(
            409,
            "GitHub did not confirm the exact pushed commit. Inspect the remote before retrying.",
          );
        await this.git(context, [
          "update-ref",
          trackingRef(entry.link, branch),
          binding.head,
        ]);
        const receipt = {
          projectId: entry.projectId,
          status: upToDate ? "up_to_date" : "pushed",
          repository: entry.link.repository,
          branch,
          head: binding.head,
          previousRemoteHead: entry.remoteHead,
          completedAt: now(),
        };
        entry.status = "pushed";
        entry.receipt = receipt;
        await this.record(entry.projectId, receipt, entry.principal);
        return receipt;
      } catch (error) {
        entry.status = "failed";
        throw error;
      }
    });
  }
  async scratch() {
    const root = path.join(this.host.store.dir, "github-work");
    await fs.mkdir(root, { recursive: true });
    if (
      (await fs.lstat(root)).isSymbolicLink() ||
      !within(await fs.realpath(this.host.store.dir), await fs.realpath(root))
    )
      throw new ApiError(
        403,
        "GitHub work storage must remain inside host data.",
      );
    return fs.mkdtemp(path.join(root, "operation-"));
  }
  async removeScratch(scratch) {
    if (!scratch) return;
    const real = await fs.realpath(scratch).catch(() => null),
      root = await fs
        .realpath(path.join(this.host.store.dir, "github-work"))
        .catch(() => null);
    if (
      real &&
      root &&
      real === scratch &&
      within(root, real) &&
      path.basename(real).startsWith("operation-")
    )
      await fs.rm(real, { recursive: true, force: true }).catch(() => {});
  }
  async import(body, principal) {
    fields(body, ["accountId", "repository", "name"]);
    this.access(principal);
    const task = this.importProject(body, principal);
    this.active.add(task);
    try {
      return await task;
    } finally {
      this.active.delete(task);
    }
  }
  async importProject(body, principal) {
    const link = await this.identity(body.accountId, body.repository);
    const name = text(
      body.name || link.repository.split("/")[1],
      "Project name",
      80,
    );
    const workspaceRoot = this.host.store.state.config.workspaceRoot,
      root = await workspace(workspaceRoot),
      id = uid();
    const project = {
      id,
      name,
      description: `Imported from ${link.repository}`,
      path: path.join(
        root,
        `${
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 45) || "project"
        }-${id.slice(0, 8)}`,
      ),
      updatedAt: now(),
      status: "ready",
      pinned: false,
      github: { ...link, linkedAt: now() },
    };
    let created = false,
      registered = false;
    try {
      const git = await findGit();
      if (!git)
        throw new ApiError(
          409,
          "Install Git for Windows before importing a repository.",
        );
      await fs.mkdir(this.host.git.home, { recursive: true });
      if (
        (await fs.lstat(this.host.git.home)).isSymbolicLink() ||
        (await fs.readdir(this.host.git.home)).length
      )
        throw new ApiError(409, "The isolated Git profile must be empty.");
      this.access(principal);
      await fs.mkdir(project.path);
      created = true;
      const gitDir = path.join(project.path, ".git");
      const env = gitEnvironment(this.host.git.home);
      const initial = {
        file: git,
        options: { root: project.path, gitDir, cwd: this.host.git.home, env },
        guard: async () => {},
      };
      const init = await this.run(
        git,
        [
          "-c",
          `init.templateDir=${this.host.git.home}`,
          "init",
          `--initial-branch=${link.defaultBranch}`,
        ],
        initial.options,
      );
      if (init.code !== 0)
        throw new ApiError(
          409,
          "Git could not initialise the import directory.",
        );
      const context = await this.context(project.path);
      const head = await this.fetchHead(
        context,
        link,
        link.defaultBranch,
        principal,
      );
      await this.inspectTree(context, head);
      this.access(principal);
      if (this.host.store.state.config.workspaceRoot !== workspaceRoot)
        changed();
      await this.git(context, ["read-tree", "--empty"]);
      await this.git(context, ["read-tree", "-m", "-u", head], {
        timeoutMs: 60000,
      });
      await this.git(context, [
        "update-ref",
        `refs/heads/${link.defaultBranch}`,
        head,
        ZERO,
      ]);
      await this.clean(project.path);
      const result = await this.host.store.change((s) => {
        this.access(principal);
        this.account(link.accountId);
        if (s.config.workspaceRoot !== workspaceRoot) changed();
        s.projects.unshift(project);
        this.host.store.audit(
          s,
          "github.imported",
          principal,
          `${name}: ${link.repository}`,
        );
        registered = true;
        return { project };
      });
      return result;
    } finally {
      if (created && !registered) {
        const real = await fs.realpath(project.path).catch(() => null);
        if (
          real === project.path &&
          within(root, real) &&
          path.basename(real).endsWith(id.slice(0, 8))
        )
          await fs.rm(real, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
