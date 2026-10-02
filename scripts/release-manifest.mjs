// Prepare/assemble an Ed25519 update envelope. Private keys never enter this tool.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, verify } from "node:crypto";
import {
  ordinaryPath,
  readOrdinary,
  releasePayload,
  validateTrustedKeys,
} from "../apps/host/self-maintenance-files.mjs";

const fail = (message) => {
  throw new Error(message);
};
export async function prepareManifest(metadata, base = ".") {
  const names = [
    "artifact",
    "platform",
    "version",
    "sourceHash",
    "keyId",
    "androidCertificateSha256",
  ];
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    Object.keys(metadata).some((key) => !names.includes(key)) ||
    !["windows", "android"].includes(metadata.platform) ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(metadata.version || "") ||
    !/^[a-f0-9]{64}$/.test(metadata.sourceHash || "") ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(metadata.keyId || "") ||
    typeof metadata.artifact !== "string"
  )
    fail(
      "Choose an artifact, platform, semantic version, reviewed source hash and public key ID.",
    );
  if (
    metadata.platform === "android"
      ? !/^[a-f0-9]{64}$/.test(metadata.androidCertificateSha256 || "")
      : metadata.androidCertificateSha256 != null
  )
    fail(
      "Only Android requires its actual public signing certificate SHA-256.",
    );
  const file = await ordinaryPath(path.resolve(base, metadata.artifact));
  const artifact = path.basename(file);
  if (
    !artifact.endsWith(metadata.platform === "android" ? ".apk" : ".exe") ||
    /[\\/:]/.test(artifact)
  )
    fail("The artifact extension must match its platform.");
  const data = await readOrdinary(file, 768 * 1024 * 1024);
  if (!data.length) fail("The release artifact is empty.");
  return {
    schema: 1,
    appId:
      metadata.platform === "android"
        ? "dev.nakama.companion"
        : "dev.qodelive.nakama",
    platform: metadata.platform,
    version: metadata.version,
    sourceHash: metadata.sourceHash,
    artifact,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    keyId: metadata.keyId,
    dataVersion: 1,
    androidCertificateSha256: metadata.androidCertificateSha256 ?? null,
  };
}

export async function attachSignature(
  template,
  signature,
  publicKey,
  artifactPath,
) {
  const expected = await prepareManifest({
    artifact: artifactPath,
    platform: template.platform,
    version: template.version,
    sourceHash: template.sourceHash,
    keyId: template.keyId,
    androidCertificateSha256: template.androidCertificateSha256,
  });
  if (
    Object.keys(template).length !== Object.keys(expected).length ||
    Object.keys(expected).some((key) => expected[key] !== template[key])
  )
    fail(
      "The template differs from the current artifact or supported update schema.",
    );
  if (
    typeof publicKey !== "string" ||
    !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(
      publicKey,
    )
  )
    fail(
      "Provide only an Ed25519 SPKI public key; private-key encodings are not accepted.",
    );
  const [trusted] = validateTrustedKeys([{ id: template.keyId, publicKey }]);
  if (
    !Buffer.isBuffer(signature) ||
    signature.length !== 64 ||
    !verify(
      null,
      Buffer.from(releasePayload(expected)),
      trusted.publicKey,
      signature,
    )
  )
    fail(
      "The detached Ed25519 signature does not match this exact payload/public key.",
    );
  return { ...expected, signature: signature.toString("base64") };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "prepare" && args.length === 2) {
      const metadataPath = await ordinaryPath(args[0]);
      const template = await prepareManifest(
        JSON.parse((await readOrdinary(metadataPath, 16384)).toString()),
        path.dirname(metadataPath),
      );
      const output = path.resolve(args[1]);
      await ordinaryPath(path.dirname(output), true);
      await fs.mkdir(output, { recursive: false });
      await fs.writeFile(
        path.join(output, "manifest.template.json"),
        JSON.stringify(template, null, 2) + "\n",
        { flag: "wx" },
      );
      await fs.writeFile(
        path.join(output, "payload.json"),
        releasePayload(template),
        { flag: "wx" },
      );
      console.log(
        "Unsigned manifest and exact payload prepared. The owner must sign payload.json separately; no private key was read.",
      );
    } else if (mode === "attach" && args.length === 5) {
      const [template, signature, publicKey, artifact, output] = args;
      const result = await attachSignature(
        JSON.parse((await readOrdinary(template, 16384)).toString()),
        await readOrdinary(signature, 64),
        (await readOrdinary(publicKey, 4096)).toString(),
        artifact,
      );
      await ordinaryPath(path.dirname(path.resolve(output)), true);
      await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n", {
        flag: "wx",
      });
      console.log(
        "Signed update manifest assembled and verified with the public key. No artifact was installed or published.",
      );
    } else
      fail(
        "Usage: release-manifest.mjs prepare <metadata.json> <new-directory> | attach <template.json> <signature.bin> <public-key.pem> <artifact> <new-release.json>",
      );
  } catch (error) {
    console.error(
      error.code
        ? "A required public file is unavailable or the output already exists."
        : error.message,
    );
    process.exitCode = 1;
  }
}
