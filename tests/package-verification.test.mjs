import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_ARTIFACT_PATHS,
  verifyPackages,
} from "../scripts/verify-packages.mjs";

const script = fileURLToPath(
  new URL("../scripts/verify-packages.mjs", import.meta.url),
);
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-package-verification-"));
  t.after(async () => {
    assert.equal(path.dirname(dir), base);
    assert.ok(path.basename(dir).startsWith("nakama-package-verification-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const root = path.join(dir, "repo");
  const artifacts = [];
  for (const [index, relative] of EXPECTED_ARTIFACT_PATHS.entries()) {
    const file = path.join(root, relative),
      data = Buffer.from(`Fixture package ${index}: café 🦊\n`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    artifacts.push({
      path: relative,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  const manifestPath = path.join(root, "output/package-manifest.json");
  const manifest = {
    version: "0.1.0",
    status: "engineering-preview",
    generatedAt: "2026-09-29T00:00:00.000Z",
    artifacts,
  };
  const write = (value = manifest) =>
    fs.writeFile(manifestPath, JSON.stringify(value));
  await write();
  return { root, dir, manifest, manifestPath, write };
}

test("all three ordinary packages match and verification leaves files unchanged", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.manifestPath);
  const result = await verifyPackages(f.root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.manifestPath, "output/package-manifest.json");
  assert.deepEqual(
    result.artifacts.map(({ ok, ...artifact }) => artifact),
    f.manifest.artifacts,
  );
  assert.ok(result.artifacts.every((artifact) => artifact.ok));
  assert.deepEqual(await fs.readFile(f.manifestPath), before);
});

test("same-size tampering and length changes fail without hiding intact packages", async (t) => {
  const f = await fixture(t),
    first = f.manifest.artifacts[0];
  await fs.writeFile(
    path.join(f.root, first.path),
    Buffer.alloc(first.bytes, 65),
  );
  let result = await verifyPackages(f.root);
  assert.equal(result.ok, false);
  assert.match(result.artifacts[0].error, /SHA-256/);
  assert.equal(result.artifacts.filter((item) => item.ok).length, 2);
  await fs.appendFile(path.join(f.root, first.path), "extra");
  result = await verifyPackages(f.root);
  assert.match(result.artifacts[0].error, /Byte count/);
});

test("missing artifacts and missing, malformed, or oversized manifests fail clearly", async (t) => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.root, EXPECTED_ARTIFACT_PATHS[2]));
  let result = await verifyPackages(f.root);
  assert.equal(result.ok, false);
  assert.match(result.artifacts[2].error, /missing/);
  for (const raw of ["{invalid", " ".repeat(65537)]) {
    await fs.writeFile(f.manifestPath, raw);
    result = await verifyPackages(f.root);
    assert.equal(result.ok, false);
    assert.equal(result.artifacts.length, 0);
    assert.ok(result.errors.length > 0);
  }
  await fs.unlink(f.manifestPath);
  result = await verifyPackages(f.root);
  assert.match(result.errors[0], /missing/);
});

test("manifest requires exactly the three fixed paths and rejects traversal, absolute, duplicate, and unknown entries", async (t) => {
  const f = await fixture(t);
  const badPaths = [
    "../private.txt",
    "/etc/passwd",
    "C:\\private.txt",
    "\\\\server\\share\\private.txt",
    "output/apk/../private.txt",
    "output\\apk\\Nakama-0.1.0-debug.apk",
    "output/apk/another.apk",
    EXPECTED_ARTIFACT_PATHS[1],
  ];
  for (const value of badPaths) {
    const manifest = structuredClone(f.manifest);
    manifest.artifacts[0].path = value;
    await f.write(manifest);
    const result = await verifyPackages(f.root);
    assert.equal(result.ok, false, value);
    assert.equal(result.artifacts.length, 0);
    assert.ok(result.errors.length > 0);
    assert.ok(
      !JSON.stringify(result).includes("private.txt"),
      "Untrusted paths must not be echoed",
    );
  }
  for (const entries of [
    [],
    f.manifest.artifacts.slice(1),
    [...f.manifest.artifacts, f.manifest.artifacts[0]],
  ]) {
    await f.write({ ...f.manifest, artifacts: entries });
    assert.equal((await verifyPackages(f.root)).ok, false);
  }
});

test("byte counts and lowercase SHA-256 values have a strict safe schema", async (t) => {
  const f = await fixture(t);
  const invalid = [
    { bytes: -1 },
    { bytes: 1.5 },
    { bytes: "25" },
    { bytes: null },
    { bytes: Number.MAX_SAFE_INTEGER + 1 },
    { sha256: "A".repeat(64) },
    { sha256: "g".repeat(64) },
    { sha256: "a".repeat(63) },
    { sha256: "a".repeat(64) + "\n" },
    { sha256: "a".repeat(64) + "\r\n" },
    { sha256: null },
    { extra: "not an artifact field" },
  ];
  for (const patch of invalid) {
    const manifest = structuredClone(f.manifest);
    Object.assign(manifest.artifacts[0], patch);
    await f.write(manifest);
    const result = await verifyPackages(f.root);
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(result.artifacts.length, 0);
  }
  for (const patch of [
    { version: "other" },
    { status: "released" },
    { generatedAt: "not a date" },
    { artifacts: {} },
  ]) {
    await f.write({ ...f.manifest, ...patch });
    assert.equal((await verifyPackages(f.root)).ok, false);
  }
});

test("directory junctions or symlinks cannot redirect artifacts or the manifest outside the root", async (t) => {
  const f = await fixture(t);
  const original = path.join(f.root, "output/apk"),
    outside = path.join(f.dir, "outside-apk");
  // Both paths are fixture-owned children; move the one directory before replacing it with a link.
  assert.equal(path.dirname(outside), f.dir);
  assert.equal(path.dirname(original), path.join(f.root, "output"));
  await fs.rename(original, outside);
  await fs.symlink(
    outside,
    original,
    process.platform === "win32" ? "junction" : "dir",
  );
  let result = await verifyPackages(f.root);
  assert.equal(result.ok, false);
  assert.match(result.artifacts[1].error, /Linked/);
  await fs.unlink(original);
  await fs.rename(outside, original);
  const output = path.join(f.root, "output"),
    externalOutput = path.join(f.dir, "outside-output");
  assert.equal(path.dirname(output), f.root);
  assert.equal(path.dirname(externalOutput), f.dir);
  await fs.rename(output, externalOutput);
  await fs.symlink(
    externalOutput,
    output,
    process.platform === "win32" ? "junction" : "dir",
  );
  result = await verifyPackages(f.root);
  assert.equal(result.ok, false);
  assert.equal(result.artifacts.length, 0);
  assert.match(result.errors[0], /Linked/);
});

test("linked files and directories in place of artifacts are refused", async (t) => {
  const f = await fixture(t),
    relative = EXPECTED_ARTIFACT_PATHS[0],
    target = path.join(f.root, relative);
  const outside = path.join(f.dir, "linked-package");
  await fs.link(target, outside);
  let result = await verifyPackages(f.root);
  assert.equal(result.ok, false);
  assert.match(result.artifacts[0].error, /no links/);
  await fs.unlink(outside);
  await fs.unlink(target);
  await fs.mkdir(target);
  result = await verifyPackages(f.root);
  assert.equal(result.ok, false);
  assert.match(result.artifacts[0].error, /ordinary file/);
});

async function cli(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, root], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

test("CLI reports concise success or nonzero failure without outputting package content", async (t) => {
  const f = await fixture(t);
  let result = await cli(f.root);
  assert.equal(result.code, 0);
  assert.match(result.output, /All three packages match/);
  assert.equal(
    result.output.split("\n").filter((line) => line.startsWith("OK ")).length,
    3,
  );
  assert.ok(!result.output.includes("café"));
  await fs.writeFile(
    path.join(f.root, EXPECTED_ARTIFACT_PATHS[0]),
    "PRIVATE_TEST_CONTENT",
  );
  result = await cli(f.root);
  assert.equal(result.code, 1);
  assert.match(result.output, /FAIL output\/installers/);
  assert.ok(!result.output.includes("PRIVATE_TEST_CONTENT"));
});
