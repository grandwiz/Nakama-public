import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_ARTIFACT_PATHS = Object.freeze([
  "output/installers/Nakama Control Center Setup 0.1.0.exe",
  "output/apk/Nakama-0.1.0-debug.apk",
  "output/pdf/Nakama-Feature-Checklist.pdf",
]);
const MANIFEST = "output/package-manifest.json";
const MAX_MANIFEST = 64 * 1024;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

class VerificationError extends Error {}
const fail = (message) => {
  throw new VerificationError(message);
};
const sameFile = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

// Only fixed relative paths reach this helper. Check each component so a
// junction/symlink cannot redirect a manifest or artifact outside the root.
async function checkedPath(root, relative) {
  let current = root;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink())
      fail("Linked files or directories are not accepted.");
    if (index < parts.length - 1 && !stat.isDirectory())
      fail("A package path component is not a directory.");
    if (index === parts.length - 1 && (!stat.isFile() || stat.nlink !== 1))
      fail("Expected an ordinary file with no links.");
  }
  if (path.relative(current, await fs.realpath(current)) !== "")
    fail("The package path was redirected.");
  return current;
}

async function openChecked(root, relative, maxSize = Number.MAX_SAFE_INTEGER) {
  const file = await checkedPath(root, relative);
  const before = await fs.lstat(file);
  if (!Number.isSafeInteger(before.size) || before.size > maxSize)
    fail("File exceeds the permitted size.");
  const flags =
    constants.O_RDONLY |
    (process.platform === "win32" ? 0 : constants.O_NOFOLLOW || 0);
  const handle = await fs.open(file, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameFile(before, opened))
      fail("File changed while it was opened.");
    await checkedPath(root, relative);
    return { handle, stat: opened };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function unchanged(root, relative, opened) {
  const file = await checkedPath(root, relative);
  if (
    !sameFile(opened.stat, await opened.handle.stat()) ||
    !sameFile(opened.stat, await fs.lstat(file))
  )
    fail("File changed during verification.");
}

function schema(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.version !== "0.1.0" ||
    manifest.status !== "engineering-preview" ||
    typeof manifest.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.generatedAt))
  )
    fail("Manifest metadata is invalid.");
  if (
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== EXPECTED_ARTIFACT_PATHS.length
  )
    fail("Manifest must list exactly the three expected packages.");
  const seen = new Set();
  for (const artifact of manifest.artifacts) {
    if (
      !artifact ||
      typeof artifact !== "object" ||
      Array.isArray(artifact) ||
      Object.keys(artifact).some(
        (key) => !["path", "bytes", "sha256"].includes(key),
      )
    )
      fail("Manifest artifact schema is invalid.");
    if (!EXPECTED_ARTIFACT_PATHS.includes(artifact.path))
      fail("Manifest contains an unexpected package path.");
    if (seen.has(artifact.path))
      fail("Manifest contains a duplicate package path.");
    seen.add(artifact.path);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0)
      fail("Manifest byte counts must be nonnegative safe integers.");
    if (
      typeof artifact.sha256 !== "string" ||
      artifact.sha256.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    )
      fail("Manifest hashes must be lowercase SHA-256 values.");
  }
  return EXPECTED_ARTIFACT_PATHS.map((relative) =>
    manifest.artifacts.find((artifact) => artifact.path === relative),
  );
}

function safeError(error) {
  if (error instanceof VerificationError) return error.message;
  if (error instanceof SyntaxError) return "Manifest is not valid JSON.";
  if (error?.code === "ENOENT") return "File or directory is missing.";
  if (["EACCES", "EPERM"].includes(error?.code))
    return "File or directory is not readable.";
  return "Could not verify this file.";
}

/** Read-only, offline integrity check against the local manifest. No package is launched. */
export async function verifyPackages(root = repositoryRoot) {
  const result = {
    ok: false,
    manifestPath: MANIFEST,
    artifacts: [],
    errors: [],
  };
  let manifestFile;
  try {
    if (typeof root !== "string" || !root.trim())
      fail("Choose a repository folder.");
    const canonicalRoot = await fs.realpath(path.resolve(root));
    if (!(await fs.stat(canonicalRoot)).isDirectory())
      fail("Choose a repository folder.");
    manifestFile = await openChecked(canonicalRoot, MANIFEST, MAX_MANIFEST);
    const buffer = Buffer.alloc(MAX_MANIFEST + 1);
    let length = 0;
    while (length < buffer.length) {
      const part = await manifestFile.handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > MAX_MANIFEST) fail("Manifest exceeds the permitted size.");
    const artifacts = schema(
      JSON.parse(buffer.subarray(0, length).toString("utf8")),
    );
    for (const expected of artifacts) {
      let file;
      try {
        file = await openChecked(canonicalRoot, expected.path);
        if (file.stat.size !== expected.bytes)
          fail("Byte count does not match the manifest.");
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of file.handle.createReadStream({
          autoClose: false,
        })) {
          bytes += chunk.length;
          if (bytes > expected.bytes) fail("File grew during verification.");
          hash.update(chunk);
        }
        await unchanged(canonicalRoot, expected.path, file);
        if (bytes !== expected.bytes)
          fail("Byte count changed during verification.");
        const sha256 = hash.digest("hex");
        if (sha256 !== expected.sha256)
          fail("SHA-256 does not match the manifest.");
        result.artifacts.push({ path: expected.path, ok: true, bytes, sha256 });
      } catch (error) {
        result.artifacts.push({
          path: expected.path,
          ok: false,
          error: safeError(error),
        });
      } finally {
        await file?.handle.close();
      }
    }
    await unchanged(canonicalRoot, MANIFEST, manifestFile);
    result.ok = result.artifacts.every((artifact) => artifact.ok);
  } catch (error) {
    result.errors.push(safeError(error));
  } finally {
    await manifestFile?.handle.close();
  }
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg.startsWith("-"))) {
    console.log("Usage: node scripts/verify-packages.mjs [repository-folder]");
    process.exitCode = args.length === 1 && args[0] === "--help" ? 0 : 2;
  } else {
    const result = await verifyPackages(args[0]);
    for (const error of result.errors) console.log(`FAIL manifest: ${error}`);
    for (const artifact of result.artifacts)
      console.log(
        `${artifact.ok ? "OK" : "FAIL"} ${artifact.path}${artifact.ok ? ` (${artifact.bytes} bytes)` : `: ${artifact.error}`}`,
      );
    console.log(
      result.ok
        ? "All three packages match the local manifest."
        : "Package verification failed. No packages were launched or changed.",
    );
    process.exitCode = result.ok ? 0 : 1;
  }
}
