import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ApiError, within } from "./security.mjs";
import { findGit, gitEnvironment } from "./project-git.mjs";

const runFile = promisify(execFile);

const fail = (message) => {
  throw new ApiError(409, message);
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) =>
  a.ino === b.ino &&
  a.dev === b.dev &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
export async function ordinaryPath(file, directory = false) {
  const resolved = path.resolve(file),
    root = path.parse(resolved).root;
  let cursor = root;
  for (const part of path
    .relative(root, resolved)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (
      stat.isSymbolicLink() ||
      (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))
    )
      fail("Linked or special update paths are not accepted.");
  }
  const stat = await fs.lstat(resolved);
  if (directory ? !stat.isDirectory() : !stat.isFile())
    fail("The update path has the wrong file type.");
  if (path.relative(resolved, await fs.realpath(resolved)))
    fail("The update path was redirected.");
  return resolved;
}
export async function readOrdinary(file, max = 1024 * 1024) {
  file = await ordinaryPath(file);
  const before = await fs.lstat(file);
  if (before.size > max) fail("Update file exceeds its size limit.");
  const handle = await fs.open(file, "r");
  try {
    if (!same(before, await handle.stat()))
      fail("Update file changed before reading.");
    const value = await handle.readFile();
    await ordinaryPath(file);
    if (
      !same(before, await handle.stat()) ||
      !same(before, await fs.lstat(file)) ||
      value.length > max
    )
      fail("Update file changed during reading.");
    return value;
  } finally {
    await handle.close();
  }
}
const rootFiles = new Set([
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "NOTICE.md",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.mjs",
  ".gitignore",
  ".gitattributes",
  ".prettierrc",
  "index.html",
]);
const sourceBinaries = new Set([
  "apps/android/gradlew",
  "apps/android/gradle/wrapper/gradle-wrapper.jar",
  "docs/assets/Nakama-Test-Checklist.pdf",
]);
const rootFolders = new Set(["apps", "scripts", "tests", "docs"]);
const skipped =
  /^(?:\.git|\.nakama|\.codex|\.agents|node_modules|output|dist|build|\.gradle|\.idea|\.next|coverage|private|profiles|browser-profiles|file-recovery|local\.properties)$/i;
const sensitive =
  /(?:^|\/)(?:\.env(?:\.|$)|[^/]*(?:credentials|secrets|signing|vault)[^/]*$)|\.(?:pem|key|p12|pfx|jks|keystore|exe|apk|aab|pdf|log|zip|asar)$/i;
const sourceExtension =
  /\.(?:mjs|cjs|js|jsx|ts|tsx|json|md|txt|html|css|xml|kt|kts|java|properties|ps1|sh|cmd|bat|yml|yaml|svg|png|ico|jpg|jpeg|webp|pro|toml|gradle)$/i;

/** A new copy only; neither Git history nor arbitrary user workspace data is exported. */
export async function stageSource(source, destination) {
  source = await ordinaryPath(source, true);
  if (within(source, destination) || within(destination, source))
    fail("The candidate must be separate from the original source.");
  const pkg = JSON.parse(
    (await readOrdinary(path.join(source, "package.json"))).toString(),
  );
  if (pkg.name !== "nakama-control-center")
    fail("Choose the Nakama source repository.");
  // Export tracked working copies only. Ignored personal fixtures/screenshots
  // must never silently become model context. History and hooks are not copied.
  const gitDir = path.join(source, ".git");
  try {
    await ordinaryPath(gitDir, true);
    await ordinaryPath(path.join(gitDir, "index"));
  } catch {
    fail(
      "Choose an ordinary Nakama Git checkout with tracked source files. Linked worktrees and folders without an index need a reviewed checkout first.",
    );
  }
  const git = await findGit();
  if (!git) fail("Git is required to export only tracked Nakama source files.");
  const { stdout } = await runFile(
    git,
    [
      "--git-dir",
      gitDir,
      "--work-tree",
      source,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=",
      "ls-files",
      "--cached",
      "-z",
    ],
    {
      cwd: source,
      env: gitEnvironment(path.join(gitDir, "nakama-unused-home")),
      windowsHide: true,
      shell: false,
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const tracked = new Set(stdout.split("\0").filter(Boolean));
  if (
    tracked.size > 4000 ||
    [...tracked].some(
      (name) =>
        name.includes("\\") ||
        name.split("/").some((part) => !part || part === "." || part === ".."),
    )
  )
    fail("The tracked source list is invalid or exceeds its bound.");
  await fs.mkdir(destination, { recursive: false });
  const files = [];
  let total = 0,
    scanned = 0;
  async function walk(relative = "") {
    for (const entry of await fs.readdir(path.join(source, relative), {
      withFileTypes: true,
    })) {
      if (++scanned > 12000) fail("Source export exceeds 12,000 entries.");
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (
        skipped.test(entry.name) ||
        (sensitive.test(name) && !sourceBinaries.has(name))
      )
        continue;
      if (!relative && !rootFiles.has(name) && !rootFolders.has(name)) continue;
      if (
        entry.isDirectory() &&
        ![...tracked].some((file) => file.startsWith(`${name}/`))
      )
        continue;
      if (!entry.isDirectory() && !tracked.has(name)) continue;
      if (entry.isSymbolicLink())
        fail(
          "Source export refuses links; remove the link from this source candidate first.",
        );
      if (entry.isDirectory()) {
        await fs.mkdir(path.join(destination, name));
        await walk(name);
      } else if (
        entry.isFile() &&
        (rootFiles.has(name) ||
          sourceBinaries.has(name) ||
          sourceExtension.test(name))
      ) {
        const data = await readOrdinary(
          path.join(source, name),
          4 * 1024 * 1024,
        );
        total += data.length;
        if (total > 64 * 1024 * 1024 || files.length >= 4000)
          fail("Source export exceeds its 64 MB / 4,000 file bound.");
        await fs.writeFile(path.join(destination, name), data, {
          flag: "wx",
          mode: 0o600,
        });
        files.push({ path: name, sha256: sha(data), bytes: data.length });
      }
    }
  }
  await walk();
  if (
    !files.some((f) => f.path === "package-lock.json") ||
    !files.some((f) => f.path === "apps/host/host.mjs")
  )
    fail("The selected source is incomplete.");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, bytes: total, sourceHash: sha(JSON.stringify(files)) };
}

export function validateTrustedKeys(keys) {
  if (!Array.isArray(keys) || keys.length > 8)
    fail("Configure at most eight publisher keys.");
  const ids = new Set();
  return keys.map((item) => {
    if (
      !item ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.publicKey !== "string" ||
      item.publicKey.length > 4096
    )
      fail("Publisher key metadata is invalid.");
    ids.add(item.id);
    let key;
    try {
      key = createPublicKey(item.publicKey);
    } catch {
      fail("Publisher public key is invalid.");
    }
    if (key.asymmetricKeyType !== "ed25519")
      fail("Publisher keys must use Ed25519.");
    return {
      id: item.id,
      publicKey: key.export({ type: "spki", format: "pem" }).toString(),
    };
  });
}
/** Signing input has a fixed field order. The signature never signs its own property. */
export function releasePayload(manifest) {
  return JSON.stringify({
    schema: manifest.schema,
    appId: manifest.appId,
    platform: manifest.platform,
    version: manifest.version,
    sourceHash: manifest.sourceHash,
    artifact: manifest.artifact,
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    keyId: manifest.keyId,
    dataVersion: manifest.dataVersion,
    androidCertificateSha256: manifest.androidCertificateSha256 ?? null,
  });
}
export async function verifyRelease(manifestPath, artifactPath, keys) {
  const manifest = JSON.parse(
    (await readOrdinary(manifestPath, 16384)).toString(),
  );
  const allowed = [
    "schema",
    "appId",
    "platform",
    "version",
    "sourceHash",
    "artifact",
    "bytes",
    "sha256",
    "keyId",
    "dataVersion",
    "androidCertificateSha256",
    "signature",
  ];
  if (
    !manifest ||
    Object.keys(manifest).some((k) => !allowed.includes(k)) ||
    manifest.schema !== 1 ||
    !["windows", "android"].includes(manifest.platform) ||
    manifest.appId !==
      (manifest.platform === "windows"
        ? "dev.qodelive.nakama"
        : "dev.nakama.companion") ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version) ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceHash) ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes < 1 ||
    manifest.bytes > 768 * 1024 * 1024 ||
    manifest.dataVersion !== 1 ||
    typeof manifest.artifact !== "string" ||
    path.basename(manifest.artifact) !== manifest.artifact ||
    /[\\/:]/.test(manifest.artifact) ||
    !manifest.artifact.endsWith(
      manifest.platform === "windows" ? ".exe" : ".apk",
    ) ||
    typeof manifest.signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature)
  )
    fail("The signed release manifest is invalid or incompatible.");
  if (
    manifest.platform === "android" &&
    !/^[a-f0-9]{64}$/.test(manifest.androidCertificateSha256 || "")
  )
    fail("Android updates must identify the existing signing certificate.");
  const trusted = validateTrustedKeys(keys).find(
    (k) => k.id === manifest.keyId,
  );
  if (
    !trusted ||
    !verify(
      null,
      Buffer.from(releasePayload(manifest)),
      trusted.publicKey,
      Buffer.from(manifest.signature, "base64"),
    )
  )
    fail("This release has no valid signature from a configured publisher.");
  if (path.basename(artifactPath) !== manifest.artifact)
    fail("The artifact filename differs from its signed manifest.");
  const data = await readOrdinary(artifactPath, manifest.bytes);
  if (data.length !== manifest.bytes || sha(data) !== manifest.sha256)
    fail("The artifact does not match its signed hash and length.");
  return { manifest, data };
}

export async function backupPrivateState(
  source,
  destination,
  { excludeRoot = ["self-maintenance"] } = {},
) {
  source = await ordinaryPath(source, true);
  await fs.mkdir(destination, { recursive: false });
  const files = [];
  let total = 0;
  async function walk(relative = "") {
    for (const entry of await fs.readdir(path.join(source, relative), {
      withFileTypes: true,
    })) {
      if (
        !relative &&
        excludeRoot.some(
          (name) => name.toLowerCase() === entry.name.toLowerCase(),
        )
      )
        continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) fail("Private backup refuses linked data.");
      if (entry.isDirectory()) {
        await fs.mkdir(path.join(destination, name));
        await walk(name);
      } else if (entry.isFile()) {
        const data = await readOrdinary(
          path.join(source, name),
          128 * 1024 * 1024,
        );
        total += data.length;
        if (total > 512 * 1024 * 1024 || files.length >= 10000)
          fail(
            "Private backup exceeds its bound; prepare a manual backup before updating.",
          );
        await fs.writeFile(path.join(destination, name), data, {
          flag: "wx",
          mode: 0o600,
        });
        if (
          sha(await readOrdinary(path.join(destination, name), data.length)) !==
          sha(data)
        )
          fail("Backup verification failed.");
        files.push({ path: name, bytes: data.length, sha256: sha(data) });
      } else fail("Private backup refuses special files.");
    }
  }
  await walk();
  await fs.writeFile(
    path.join(destination, "backup-manifest.json"),
    JSON.stringify({ schema: 1, createdAt: new Date().toISOString(), files }),
    { flag: "wx", mode: 0o600 },
  );
  return { files: files.length, bytes: total };
}
