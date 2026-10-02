import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import {
  validatePolicy,
  parseAndroid,
  androidProblems,
  windowsProblems,
  verifyProduction,
} from "./release-verify.mjs";
import { prepareManifest, attachSignature } from "./release-manifest.mjs";
import {
  releasePayload,
  verifyRelease,
  backupPrivateState,
} from "../apps/host/self-maintenance-files.mjs";
import { Store } from "../apps/host/store.mjs";
import { collectRuntimeNotices } from "./release-notices.mjs";

const fingerprint = "a".repeat(64);
const android = {
  artifact: "app.apk",
  appId: "dev.nakama.companion",
  version: "0.2.0",
  versionCode: 2,
  previousVersionCode: 1,
  certificateSha256: fingerprint,
};
const actual = {
  appId: android.appId,
  version: android.version,
  versionCode: android.versionCode,
  certificateSha256: fingerprint,
  debugCertificate: false,
  debuggable: false,
};
async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-release-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(folder, "app.apk"),
    "synthetic signed APK bytes",
  );
  return folder;
}
test("release policy rejects unknown fields, non-increasing versions and unpinned identities", () => {
  assert.equal(validatePolicy({ schema: 1, android }).android.versionCode, 2);
  assert.throws(
    () => validatePolicy({ schema: 1, android, privateKey: "never" }),
    /unsupported/,
  );
  assert.throws(
    () =>
      validatePolicy({ schema: 1, android: { ...android, versionCode: 1 } }),
    /higher versionCode/,
  );
  assert.throws(
    () =>
      validatePolicy({
        schema: 1,
        android: { ...android, certificateSha256: "" },
      }),
    /certificate/,
  );
  assert.throws(
    () =>
      validatePolicy({
        schema: 1,
        windows: {
          installer: "a.exe",
          executable: "a.exe",
          certificateSha256: fingerprint,
        },
      }),
    /separate/,
  );
});
test("actual Android metadata rejects debug identities and mismatched release claims", () => {
  const parsed = parseAndroid(
    `Signer #1 certificate DN: CN=Android Debug, O=Android, C=US\nSigner #1 certificate SHA-256 digest: ${fingerprint}\n`,
    "package: name='dev.nakama.companion' versionCode='1' versionName='0.1.0' platformBuildVersionName='16'\napplication-debuggable\n",
  );
  const problems = androidProblems(parsed, android);
  assert.ok(problems.some((message) => message.includes("debug certificate")));
  assert.ok(problems.some((message) => message.includes("debuggable")));
  assert.ok(problems.some((message) => message.includes("versionCode")));
  assert.throws(
    () =>
      parseAndroid(
        `Signer #1 certificate SHA-256 digest: ${fingerprint}\nSigner #2 certificate SHA-256 digest: ${fingerprint}\n`,
        "",
      ),
    /one verified signer/,
  );
});
test("Windows gate requires valid trust, exact publisher pin and timestamp", () => {
  assert.deepEqual(
    windowsProblems(
      { status: "Valid", certificateSha256: fingerprint, timestamped: true },
      fingerprint,
    ),
    [],
  );
  assert.equal(
    windowsProblems(
      { status: "NotSigned", certificateSha256: null, timestamped: false },
      fingerprint,
    ).length,
    3,
  );
  assert.equal(
    windowsProblems(
      { status: "Valid", certificateSha256: "b".repeat(64), timestamped: true },
      fingerprint,
    ).length,
    1,
  );
});
test("read-only production verifier exposes hashes and exact declared scope", async (t) => {
  const folder = await fixture(t);
  const result = await verifyProduction(
    { schema: 1, android },
    { base: folder, androidInspector: async () => actual },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.scope, ["android"]);
  assert.equal(
    result.artifacts[0].sha256,
    createHash("sha256").update("synthetic signed APK bytes").digest("hex"),
  );
  assert.deepEqual(await fs.readdir(folder), ["app.apk"]);
});
test("native artifact changes and inspection failure cannot pass the gate", async (t) => {
  const folder = await fixture(t);
  const result = await verifyProduction(
    { schema: 1, android },
    {
      base: folder,
      androidInspector: async (file) => {
        await fs.writeFile(file, "changed");
        return actual;
      },
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /changed during/);
  const failed = await verifyProduction(
    { schema: 1, android },
    {
      base: folder,
      androidInspector: async () => {
        throw new Error("Rejected signer");
      },
    },
  );
  assert.equal(failed.ok, false);
});
test("both Windows installer and inner application must pass", async (t) => {
  const folder = await fixture(t);
  await fs.writeFile(path.join(folder, "setup.exe"), "installer");
  await fs.writeFile(path.join(folder, "app.exe"), "application");
  const calls = [];
  const result = await verifyProduction(
    {
      schema: 1,
      windows: {
        installer: "setup.exe",
        executable: "app.exe",
        certificateSha256: fingerprint,
      },
    },
    {
      base: folder,
      windowsInspector: async (file) => {
        calls.push(path.basename(file));
        return {
          status: file.endsWith("app.exe") ? "NotSigned" : "Valid",
          certificateSha256: fingerprint,
          timestamped: true,
        };
      },
    },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["setup.exe", "app.exe"]);
  assert.match(result.errors[0], /executable/);
});
test("manifest workflow consumes only public key and detached signature and binds actual bytes", async (t) => {
  const folder = await fixture(t);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519"); // Ephemeral fixture; never a production identity.
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const template = await prepareManifest(
    {
      artifact: "app.apk",
      platform: "android",
      version: android.version,
      sourceHash: "b".repeat(64),
      keyId: "fixture",
      androidCertificateSha256: fingerprint,
    },
    folder,
  );
  const signature = sign(
    null,
    Buffer.from(releasePayload(template)),
    privateKey,
  );
  const signed = await attachSignature(
    template,
    signature,
    pem,
    path.join(folder, "app.apk"),
  );
  const manifestPath = path.join(folder, "release.json");
  await fs.writeFile(manifestPath, JSON.stringify(signed));
  assert.equal(
    (
      await verifyRelease(manifestPath, path.join(folder, "app.apk"), [
        { id: "fixture", publicKey: pem },
      ])
    ).manifest.sha256,
    template.sha256,
  );
  await assert.rejects(
    attachSignature(
      { ...template, sourceHash: "c".repeat(64) },
      signature,
      pem,
      path.join(folder, "app.apk"),
    ),
    /signature/,
  );
  await fs.appendFile(path.join(folder, "app.apk"), "tamper");
  await assert.rejects(
    attachSignature(template, signature, pem, path.join(folder, "app.apk")),
    /differs/,
  );
});
test("production gate binds signed Android assertion to independently inspected APK", async (t) => {
  const folder = await fixture(t);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const template = await prepareManifest(
    {
      artifact: "app.apk",
      platform: "android",
      version: android.version,
      sourceHash: "b".repeat(64),
      keyId: "fixture",
      androidCertificateSha256: "c".repeat(64),
    },
    folder,
  );
  const signed = await attachSignature(
    template,
    sign(null, Buffer.from(releasePayload(template)), privateKey),
    pem,
    path.join(folder, "app.apk"),
  );
  await fs.writeFile(path.join(folder, "release.json"), JSON.stringify(signed));
  await fs.writeFile(
    path.join(folder, "public-keys.json"),
    JSON.stringify([{ id: "fixture", publicKey: pem }]),
  );
  const result = await verifyProduction(
    {
      schema: 1,
      android,
      update: {
        manifest: "release.json",
        trustedKeys: "public-keys.json",
        platform: "android",
        sourceHash: template.sourceHash,
      },
    },
    { base: folder, androidInspector: async () => actual },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /actual APK/);
});
test("production Windows configuration fails closed without an explicitly provisioned identity", () => {
  const require = createRequire(import.meta.url);
  const keys = [
    "NAKAMA_RELEASE_CERT_SHA1",
    "NAKAMA_RELEASE_PUBLISHER",
    "CSC_LINK",
    "WIN_CSC_LINK",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const config = require.resolve("./release-windows.config.cjs");
  try {
    for (const key of keys) delete process.env[key];
    assert.throws(() => require(config), /requires/);
    process.env.NAKAMA_RELEASE_CERT_SHA1 = "a".repeat(40);
    process.env.NAKAMA_RELEASE_PUBLISHER = "Fixture publisher";
    const result = require(config);
    assert.equal(result.forceCodeSigning, true);
    assert.equal(result.win.signExecutable, true);
    assert.equal(result.directories.output, "output/release/windows");
    assert.deepEqual(result.extraFiles.slice(-3), [
      { from: "LICENSE", to: "LICENSE.nakama.txt" },
      { from: "NOTICE.md", to: "NOTICE.nakama.md" },
      {
        from: "docs/third-party-runtime-notices.txt",
        to: "THIRD_PARTY_NOTICES.txt",
      },
    ]);
    assert.equal(
      new Set(result.extraFiles.map((entry) => entry.to)).size,
      result.extraFiles.length,
    );
  } finally {
    delete require.cache[config];
    for (const key of keys)
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

test("Windows production packaging checks notice freshness and preserves inherited extra files", async (t) => {
  const folder = await fixture(t);
  await fs.mkdir(path.join(folder, "scripts"));
  await fs.mkdir(path.join(folder, "docs"));
  await fs.mkdir(path.join(folder, "node_modules", "fixture"), {
    recursive: true,
  });
  await fs.copyFile(
    new URL("./release-windows.config.cjs", import.meta.url),
    path.join(folder, "scripts", "release-windows.config.cjs"),
  );
  await fs.copyFile(
    new URL("./release-notices.mjs", import.meta.url),
    path.join(folder, "scripts", "release-notices.mjs"),
  );
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      build: {
        files: ["fixture"],
        win: { target: "nsis" },
        extraFiles: [{ from: "existing.txt", to: "existing.txt" }],
      },
    }),
  );
  await fs.writeFile(
    path.join(folder, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "fixture-app" },
        "node_modules/fixture": { version: "1.0.0", license: "MIT" },
      },
    }),
  );
  await fs.writeFile(
    path.join(folder, "node_modules", "fixture", "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", license: "MIT" }),
  );
  await fs.writeFile(
    path.join(folder, "node_modules", "fixture", "LICENSE"),
    "Synthetic dependency license",
  );
  await fs.writeFile(
    path.join(folder, "LICENSE"),
    "Synthetic application license",
  );
  await fs.writeFile(
    path.join(folder, "NOTICE.md"),
    "Synthetic application notice",
  );
  const notices = await collectRuntimeNotices(folder);
  await fs.writeFile(
    path.join(folder, "docs", "third-party-runtime-notices.txt"),
    notices.text,
  );
  await fs.writeFile(
    path.join(folder, "docs", "third-party-runtime-inventory.json"),
    JSON.stringify(notices.inventory, null, 2) + "\n",
  );
  const keys = [
    "NAKAMA_RELEASE_CERT_SHA1",
    "NAKAMA_RELEASE_PUBLISHER",
    "CSC_LINK",
    "WIN_CSC_LINK",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const require = createRequire(import.meta.url);
  const configPath = path.join(folder, "scripts", "release-windows.config.cjs");
  try {
    for (const key of keys) delete process.env[key];
    process.env.NAKAMA_RELEASE_CERT_SHA1 = "a".repeat(40);
    process.env.NAKAMA_RELEASE_PUBLISHER = "Fixture publisher";
    const config = require(configPath);
    assert.deepEqual(config.extraFiles[0], {
      from: "existing.txt",
      to: "existing.txt",
    });
    await config.beforePack();
    await fs.appendFile(
      path.join(folder, "docs", "third-party-runtime-notices.txt"),
      "\nStale edited text",
    );
    await assert.rejects(config.beforePack(), /missing or stale/);
  } finally {
    delete require.cache[configPath];
    for (const key of keys)
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

test("synthetic recovery copy preserves state and browser bytes in a fresh disposable profile", async (t) => {
  const folder = await fixture(t);
  const source = path.join(folder, "source");
  const store = new Store(path.join(source, "private"));
  await store.init();
  await store.change((state) => {
    state.config.voice = "fixture-voice";
    state.config.reduceMotion = true;
    state.devices.push({
      id: "fixture-device",
      name: "Synthetic companion",
      platform: "android",
      tokenHash: "synthetic-hash",
    });
    state.projects.push({
      id: "fixture-project",
      name: "Synthetic preserved project",
      path: path.join(folder, "projects"),
    });
    state.monitors = [
      {
        id: "fixture-monitor",
        title: "Synthetic monitor",
        status: "paused",
        sharedDeviceIds: ["fixture-device"],
      },
    ];
  });
  await fs.writeFile(
    path.join(source, "private", "vault.fixture"),
    "synthetic encrypted bytes, no real credential",
  );
  const partition = path.join(source, "Partitions", "nakama-monitor-fixture");
  await fs.mkdir(partition, { recursive: true });
  await fs.writeFile(
    path.join(partition, "Cookies"),
    "synthetic cookies, never a real browser database",
  );
  await fs.writeFile(
    path.join(source, "Local State"),
    "synthetic encryption metadata",
  );
  const backup = path.join(folder, "backup");
  const receipt = await backupPrivateState(source, backup, { excludeRoot: [] });
  assert.equal(receipt.files, 4);
  const restored = path.join(folder, "restored");
  // A fresh directory only. This fixture never restores over a real installation.
  await fs.cp(backup, restored, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  const recovered = new Store(path.join(restored, "private"));
  await recovered.init();
  assert.equal(recovered.state.config.voice, "fixture-voice");
  assert.equal(recovered.state.config.reduceMotion, true);
  assert.equal(recovered.state.devices[0].tokenHash, "synthetic-hash");
  assert.equal(recovered.state.projects[0].id, "fixture-project");
  assert.equal(
    recovered.state.monitors[0].sharedDeviceIds[0],
    "fixture-device",
  );
  for (const file of [
    "private/vault.fixture",
    "Local State",
    "Partitions/nakama-monitor-fixture/Cookies",
  ])
    assert.deepEqual(
      await fs.readFile(path.join(restored, file)),
      await fs.readFile(path.join(source, file)),
    );
});
