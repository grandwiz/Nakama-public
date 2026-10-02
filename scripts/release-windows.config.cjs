// Opt-in production configuration. The normal engineering-preview signing is unchanged.
// Load only after the owner has provisioned a trusted Windows code-signing identity.
const base = require("../package.json").build;
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const notices = [
  "LICENSE",
  "NOTICE.md",
  "docs/third-party-runtime-notices.txt",
];
const certificateSha1 = process.env.NAKAMA_RELEASE_CERT_SHA1;
const publisherName = process.env.NAKAMA_RELEASE_PUBLISHER;
if (!/^[a-fA-F0-9]{40}$/.test(certificateSha1 || "") || !publisherName?.trim())
  throw new Error(
    "Production signing requires NAKAMA_RELEASE_CERT_SHA1 and NAKAMA_RELEASE_PUBLISHER for the owner's existing certificate-store identity.",
  );
if (process.env.CSC_LINK || process.env.WIN_CSC_LINK)
  throw new Error(
    "This release configuration uses the Windows certificate store; remove file/URL certificate overrides before building.",
  );
module.exports = {
  ...base,
  forceCodeSigning: true,
  files: [...base.files, ...notices],
  beforePack: async () => {
    const root = path.resolve(__dirname, "..");
    const { checkRuntimeNotices } = await import(
      pathToFileURL(path.join(__dirname, "release-notices.mjs")).href
    );
    await checkRuntimeNotices(root);
    for (const file of notices) {
      const stat = fs.lstatSync(path.join(root, file));
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size)
        throw new Error(
          "Production packaging requires ordinary, nonempty license and third-party notice files.",
        );
    }
  },
  directories: { ...base.directories, output: "output/release/windows" },
  win: {
    ...base.win,
    forceCodeSigning: true,
    signExecutable: true,
    signAndEditExecutable: true,
    verifyUpdateCodeSignature: true,
    signtoolOptions: {
      certificateSha1,
      publisherName: publisherName.trim(),
      signingHashAlgorithms: ["sha256"],
    },
  },
};
