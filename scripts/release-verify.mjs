// Read-only release gate. Never signs, installs, reads a keystore or contacts a device.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ordinaryPath,
  readOrdinary,
  verifyRelease,
} from "../apps/host/self-maintenance-files.mjs";

const exec = promisify(execFile);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => {
  throw new Error(message);
};
const safeError = (error) =>
  error?.code
    ? "A required public artifact, policy or verification tool is unavailable."
    : error instanceof SyntaxError
      ? "A public metadata file or verification response is not valid JSON."
      : error.message;
const isHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isPath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length < 4096 &&
  !/[\x00-\x1f]/.test(value);
function fields(value, names, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !names.includes(key))
  )
    fail(`${label} has unsupported fields.`);
}
export function validatePolicy(policy) {
  fields(policy, ["schema", "android", "windows", "update"], "Release policy");
  if (policy.schema !== 1 || (!policy.android && !policy.windows))
    fail("Release policy needs schema 1 and at least one platform.");
  if (policy.android) {
    const a = policy.android;
    fields(
      a,
      [
        "artifact",
        "appId",
        "version",
        "versionCode",
        "previousVersionCode",
        "certificateSha256",
      ],
      "Android policy",
    );
    if (
      !isPath(a.artifact) ||
      !a.artifact.endsWith(".apk") ||
      !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(a.appId || "") ||
      !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(a.version || "") ||
      !isHash(a.certificateSha256) ||
      !Number.isSafeInteger(a.versionCode) ||
      !Number.isSafeInteger(a.previousVersionCode) ||
      a.previousVersionCode < 0 ||
      a.versionCode <= a.previousVersionCode ||
      a.versionCode > 2100000000
    )
      fail(
        "Android policy requires exact package/version, a higher versionCode and a public certificate SHA-256 pin.",
      );
  }
  if (policy.windows) {
    const w = policy.windows;
    fields(
      w,
      ["installer", "executable", "certificateSha256"],
      "Windows policy",
    );
    if (
      ![w.installer, w.executable].every(
        (value) => isPath(value) && value.endsWith(".exe"),
      ) ||
      w.installer === w.executable ||
      !isHash(w.certificateSha256)
    )
      fail(
        "Windows policy requires separate installer/executable paths and an exact public certificate SHA-256 pin.",
      );
  }
  if (policy.update) {
    const u = policy.update;
    fields(
      u,
      ["manifest", "trustedKeys", "platform", "sourceHash"],
      "Update policy",
    );
    if (
      !isPath(u.manifest) ||
      !isPath(u.trustedKeys) ||
      !["android", "windows"].includes(u.platform) ||
      !policy[u.platform] ||
      !isHash(u.sourceHash)
    )
      fail(
        "Update policy requires a reviewed source hash, manifest and public trust file for an included platform.",
      );
  }
  return policy;
}

export function parseAndroid(signatures, badging) {
  const digests = [
    ...signatures.matchAll(
      /^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})\r?$/gm,
    ),
  ].map((match) => match[1].toLowerCase());
  const names = [
    ...signatures.matchAll(/^Signer #\d+ certificate DN: (.+)\r?$/gm),
  ].map((match) => match[1]);
  const pkg = badging.match(
    /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m,
  );
  if (digests.length !== 1 || names.length !== 1 || !pkg)
    fail(
      "Android tool output must identify one verified signer and one package.",
    );
  return {
    certificateSha256: digests[0],
    debugCertificate: /(?:^|,)\s*CN\s*=\s*Android Debug\s*(?:,|$)/i.test(
      names[0],
    ),
    debuggable: /^application-debuggable(?:\s|$)/m.test(badging),
    appId: pkg[1],
    versionCode: Number(pkg[2]),
    version: pkg[3],
  };
}

export function androidProblems(actual, expected) {
  const problems = [];
  for (const key of ["certificateSha256", "appId", "versionCode", "version"])
    if (actual[key] !== expected[key])
      problems.push(`Android ${key} differs from the reviewed release policy.`);
  if (actual.debugCertificate)
    problems.push(
      "Android uses a debug certificate; preserve it for private previews and choose a separate production identity strategy.",
    );
  if (actual.debuggable)
    problems.push(
      "Android is debuggable; a production release must disable debugging.",
    );
  return problems;
}

export function windowsProblems(actual, certificateSha256) {
  const problems = [];
  if (actual.status !== "Valid")
    problems.push("Windows Authenticode status is not Valid.");
  if (actual.certificateSha256 !== certificateSha256)
    problems.push(
      "Windows publisher certificate differs from the reviewed release policy.",
    );
  if (actual.timestamped !== true)
    problems.push(
      "Windows release signature has no verified timestamp certificate.",
    );
  return problems;
}

async function run(file, args) {
  try {
    const result = await exec(file, args, {
      shell: false,
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        JAVA_TOOL_OPTIONS: "",
        JDK_JAVA_OPTIONS: "",
        _JAVA_OPTIONS: "",
      },
    });
    return result.stdout;
  } catch {
    // Tool diagnostics may contain local paths. Do not replay them into release logs.
    fail(
      "A release verification tool failed, timed out or rejected the artifact.",
    );
  }
}

async function nativeAndroid(artifact, { sdk, javaHome }) {
  if (!sdk || !javaHome)
    fail(
      "Android verification requires ANDROID_SDK_ROOT and JAVA_HOME (or --sdk / --java-home).",
    );
  const tools = path.join(
    await ordinaryPath(sdk, true),
    "build-tools",
    "36.0.0",
  );
  const java = await ordinaryPath(
    path.join(
      javaHome,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    ),
  );
  const signer = await ordinaryPath(path.join(tools, "lib", "apksigner.jar"));
  const aapt = await ordinaryPath(
    path.join(tools, process.platform === "win32" ? "aapt.exe" : "aapt"),
  );
  const signatures = await run(java, [
    "-jar",
    signer,
    "verify",
    "--verbose",
    "--print-certs",
    artifact,
  ]);
  const badging = await run(aapt, ["dump", "badging", artifact]);
  return parseAndroid(signatures, badging);
}

async function nativeWindows(artifact) {
  if (process.platform !== "win32")
    fail("Windows Authenticode release verification requires Windows.");
  const powershell = await ordinaryPath(
    path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
  );
  const literal = artifact.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath '${literal}'; $pin=$null; if($s.SignerCertificate){$h=[Security.Cryptography.SHA256]::Create(); try {$pin=([BitConverter]::ToString($h.ComputeHash($s.SignerCertificate.RawData))).Replace('-','').ToLowerInvariant()} finally {$h.Dispose()}}; @{status=$s.Status.ToString();certificateSha256=$pin;timestamped=($null -ne $s.TimeStamperCertificate)} | ConvertTo-Json -Compress`;
  return JSON.parse(
    await run(powershell, [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ]),
  );
}

export async function verifyProduction(policy, options = {}) {
  validatePolicy(policy);
  const base = path.resolve(options.base || ".");
  const result = {
    ok: false,
    scope: Object.keys(policy).filter((key) =>
      ["android", "windows", "update"].includes(key),
    ),
    artifacts: [],
    errors: [],
  };
  const verified = new Map();
  async function artifact(relative, platform, check) {
    const file = await ordinaryPath(path.resolve(base, relative));
    const before = await readOrdinary(file, 768 * 1024 * 1024);
    const fingerprint = hash(before);
    const actual = await check(file);
    if (hash(await readOrdinary(file, 768 * 1024 * 1024)) !== fingerprint)
      fail("Artifact changed during native verification.");
    verified.set(file, { sha256: fingerprint, bytes: before.length, actual });
    result.artifacts.push({
      platform,
      sha256: fingerprint,
      bytes: before.length,
      ...actual,
    });
    return actual;
  }
  const checks = [];
  if (policy.android)
    checks.push(async () => {
      const actual = await artifact(
        policy.android.artifact,
        "android",
        (file) => (options.androidInspector || nativeAndroid)(file, options),
      );
      result.errors.push(...androidProblems(actual, policy.android));
    });
  if (policy.windows)
    for (const field of ["installer", "executable"])
      checks.push(async () => {
        const actual = await artifact(
          policy.windows[field],
          `windows-${field}`,
          options.windowsInspector || nativeWindows,
        );
        result.errors.push(
          ...windowsProblems(actual, policy.windows.certificateSha256).map(
            (message) => `${field}: ${message}`,
          ),
        );
      });
  for (const check of checks) {
    try {
      await check();
    } catch (error) {
      result.errors.push(safeError(error));
    }
  }
  if (policy.update) {
    try {
      const u = policy.update;
      const file = path.resolve(
        base,
        u.platform === "android"
          ? policy.android.artifact
          : policy.windows.installer,
      );
      const native = verified.get(file);
      if (!native)
        fail("Update artifact did not complete native verification.");
      const keys = JSON.parse(
        (
          await readOrdinary(path.resolve(base, u.trustedKeys), 40000)
        ).toString(),
      );
      const { manifest } = await verifyRelease(
        path.resolve(base, u.manifest),
        file,
        keys,
      );
      if (
        manifest.platform !== u.platform ||
        manifest.sourceHash !== u.sourceHash ||
        manifest.sha256 !== native.sha256 ||
        manifest.bytes !== native.bytes
      )
        fail(
          "Update manifest differs from the reviewed source/native artifact.",
        );
      if (
        u.platform === "android" &&
        (manifest.androidCertificateSha256 !==
          native.actual.certificateSha256 ||
          manifest.appId !== native.actual.appId ||
          manifest.version !== native.actual.version)
      )
        fail(
          "Android update manifest differs from the actual APK identity/version.",
        );
      result.updateVerified = true;
    } catch (error) {
      result.errors.push(safeError(error));
    }
  }
  result.ok = result.errors.length === 0;
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2),
      parsed = {};
    for (let i = 0; i < args.length; i += 2) {
      if (
        !["--policy", "--sdk", "--java-home"].includes(args[i]) ||
        !args[i + 1] ||
        parsed[args[i]]
      )
        fail(
          "Usage: node scripts/release-verify.mjs --policy <public-metadata.json> [--sdk <SDK>] [--java-home <JDK>]",
        );
      parsed[args[i]] = args[i + 1];
    }
    if (!parsed["--policy"])
      fail(
        "Choose an explicit release policy with public identity pins; see docs/release-signing.md.",
      );
    const policyFile = await ordinaryPath(parsed["--policy"]);
    const policy = JSON.parse(
      (await readOrdinary(policyFile, 40000)).toString(),
    );
    const result = await verifyProduction(policy, {
      base: path.dirname(policyFile),
      sdk: parsed["--sdk"] || process.env.ANDROID_SDK_ROOT,
      javaHome: parsed["--java-home"] || process.env.JAVA_HOME,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error: error.code
          ? "A required public artifact, policy or verification tool is unavailable."
          : error.message,
      }),
    );
    process.exitCode = 1;
  }
}
