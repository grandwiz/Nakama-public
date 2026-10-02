# Release signing and recovery

The public source repository and production binaries are separate deliverables. A clean source snapshot can be published without uploading development packages, signing material or user data. The normal build still produces an engineering preview; this work does not silently change its signing identity.

## Current boundary

The private Android application is `dev.nakama.companion`, version `0.1.0`, version code `1`. Its established debug signing identity must remain available for private in-place updates. The Windows preview deliberately disables executable signing. Neither package passes the new production-release gate. No production key, certificate, signing-service account or public update feed was created.

`scripts/release-verify.mjs` is a read-only gate. It checks actual Android signatures using SDK 36 `apksigner`, reads package/version/debug flags with `aapt`, and rejects a debug certificate or debuggable APK. For Windows it checks **both** installer and inner application with the system Authenticode verifier, requires the exact configured publisher certificate SHA-256 and a timestamp certificate. An optional Dynamic upgrade manifest must match the checked bytes, trusted Ed25519 key, reviewed source hash and actual Android signer/package/version. Windows certificate validation follows the operating system's trust state; an offline result is not a promise about future revocation.

Passing this script establishes only the declared platform/signature scope. It does not prove application safety, reproducible builds, installer success, recovery, store approval, Android developer registration or a complete legal review. Existing `verify-packages.mjs` and `verify-kling-package.mjs` remain required for the private delivery bundle; their local integrity manifest is not a production signature.

## Keep private Android continuity

Do not delete, regenerate, rename or replace the private debug keystore, change the existing application's ID, uninstall it, clear its data or use its profile as a fixture. Keep an encrypted backup of that existing keystore under the owner's custody without copying it to Git, build candidates, logs or chat. Never read key contents or passwords into application logs or chat.

For public binaries, choose a **separate production application ID and signing key** before the first release. This lets the public app coexist with the private preview and avoids replacing its accounts/pairing/settings. The precise public ID remains an owner decision. There is currently no automatic migration of private Android state to another package; any later migration needs explicit design and review. Dynamic upgrade manifest schema 1 currently targets the existing IDs, so a different production ID also requires a reviewed schema/runtime change before that channel can self-update.

A production Android key can be created locally without buying a code-signing certificate. Keep the encrypted keystore outside the repository and candidate workspace, make two controlled offline backups, and keep its password separately in the owner's password manager. Use a dedicated release workstation or protected signing job, with signing enabled only after review. Do not put passwords in Gradle files, command arguments or build logs. Increment production `versionCode` for every release; retain the previous verified APK and its metadata. These production settings are intentionally not applied to the current private debug build.

Android compares signing identities for ordinary updates; a different key/package strategy must not be treated as an in-place private upgrade. Debug certificates are unsuitable for store publication. See Android's [app signing guidance](https://developer.android.com/studio/publish/app-signing) and [release preparation](https://developer.android.com/studio/publish/preparing).

Before broad APK distribution, the owner must choose and complete the relevant developer-registration/store process. Android's current verification programme has regional requirements and a separate limited-distribution option for up to 20 authorised devices. A free limited-distribution account is not approval for unrestricted distribution; check the current [developer verification guidance](https://developer.android.com/developer-verification) and [FAQ](https://developer.android.com/developer-verification/guides/faq) for the intended users. No account registration or identity submission was performed.

## Windows signing choices

There is no locally generated certificate that automatically becomes a publicly trusted Windows publisher identity. Do not ask users to disable security checks or install an arbitrary root certificate to make a preview appear trusted.

The no-cost candidate after source publication is **SignPath Foundation's open-source programme**. It provides signing for accepted projects and retains the signing key in its service. Acceptance is conditional: source/release reputation, licensing, documented behaviour, MFA, review/approval roles and the required signing/privacy policy must be assessed. Its certificate names the Foundation; do not claim enrolment or add its sponsorship statement before acceptance. See the [programme](https://signpath.org/) and [conditions](https://signpath.org/terms.html). A hosted integration would need separately reviewed credentials, artifact selection and human release approval; none was configured here.

An alternative is a purchased CA certificate or Microsoft's Artifact Signing. Microsoft requires account/subscription setup and identity validation, with eligibility constraints; its published Basic plan is paid. These are owner account/identity/billing decisions, not a no-cost fallback. See Microsoft's [setup requirements](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [trust models](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models) and [pricing](https://azure.microsoft.com/en-us/products/artifact-signing). Prices and eligibility can change.

For an already provisioned Windows certificate-store identity, `scripts/release-windows.config.cjs` enables signing and fails the build if signing cannot happen. It requires only public metadata environment variables `NAKAMA_RELEASE_CERT_SHA1` (40 hex characters, the certificate selector) and `NAKAMA_RELEASE_PUBLISHER` (exact publisher name). It rejects certificate-file/URL overrides and forces SHA-256 signing. The private key stays with the configured Windows key provider, such as an approved hardware-backed provider. Before packing, the config verifies that the generated runtime inventory and notices match the current lockfile and installed dependency license text. Missing or stale notices fail the build. It packages readable `LICENSE.nakama.txt`, `NOTICE.nakama.md` and `THIRD_PARTY_NOTICES.txt` beside the executable, alongside electron-builder's `LICENSE.electron.txt` and `LICENSES.chromium.html`. Existing extra-file mappings are preserved. It writes to `output/release/windows`, separate from private delivery packages.

After provisioning and approving a release, the owner can run:

```powershell
npm run build
npx electron-builder --config scripts/release-windows.config.cjs --win nsis --x64
```

This command **signs**, may contact the selected timestamp service and is not part of the read-only verification. It was not run during this preparation. The configuration matches the installed electron-builder 26 options; consult [version 26 Windows signing options](https://www.electron.build/v26/docs/win/) when changing providers. A hosted service needs its own reviewed integration, not fabricated local certificate-store credentials.

The three Nakama/runtime notice mappings live in the base desktop packaging configuration, so new private preview builds also receive those readable files. Production inherits the mappings without duplicating destinations and adds the inventory-freshness/signing gates; preview signing remains unchanged.

## Exact release verification

Create a local policy containing public metadata only. Relative paths resolve against the policy file's directory. Include each platform being distributed; omitting a platform means it is **not verified**. Placeholder values below must be replaced by independently confirmed public certificate fingerprints and the actual approved version.

```json
{
  "schema": 1,
  "android": {
    "artifact": "android/Nakama.apk",
    "appId": "CHOOSE.THE.PRODUCTION.ID",
    "version": "0.2.0",
    "versionCode": 2,
    "previousVersionCode": 1,
    "certificateSha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"
  },
  "windows": {
    "installer": "windows/Nakama Control Center Setup 0.2.0.exe",
    "executable": "windows/win-unpacked/Nakama Control Center.exe",
    "certificateSha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"
  }
}
```

```powershell
node scripts/release-verify.mjs --policy output/release/policy.json --sdk "$env:ANDROID_SDK_ROOT" --java-home "$env:JAVA_HOME"
node --test scripts/release-verification.test.mjs
```

The verifier reads only artifacts, public metadata and explicitly selected SDK/JDK/system tools. It does not inspect private keystores, sign, install, purchase or call a model. It checks artifact hashes again after native inspection and prints only public identity/version/hash evidence. Missing tools, tool failure, changed files, incorrect fingerprints, debug APKs and unsigned Windows binaries fail closed. [Android apksigner documentation](https://developer.android.com/tools/apksigner) describes the underlying signature verification.

Android binary distribution also remains blocked on shipping the applicable license notices **inside the release APK** and checking them against the final resolved Android dependencies. A source-side inventory alone does not establish notice compliance for a downloaded APK. Do not distribute an APK until its final packaged notices have been verified.

## Dynamic upgrade manifest custody

Use a dedicated Ed25519 release identity, separate from Android and Windows signing. Its private key is an owner-controlled offline/protected signing asset; it must never be installed in Nakama or exposed to the manager, development agents, candidates, general CI, Git or ordinary browser sessions. Back up the encrypted key under the same custody rules. Only its public key and reviewed key ID belong in trusted release metadata. Provision trust through the owner's local approval path; do not accept a replacement key supplied by the same untrusted download it is supposed to verify.

`scripts/release-manifest.mjs` prepares the exact signed input, then assembles a detached signature after validating it with a **public key**. It cannot sign and has no private-key argument. First prepare a metadata JSON with `artifact`, `platform`, `version`, `sourceHash`, `keyId` and, for Android, `androidCertificateSha256`. `sourceHash` must be copied from the actual dual-reviewed candidate evidence, not inferred from a Git commit or invented by the signer.

```powershell
node scripts/release-manifest.mjs prepare output/release/metadata.json output/release/envelope
```

The new directory contains `manifest.template.json` and byte-exact `payload.json`. The owner signs **that unchanged payload** using their separately approved offline/protected Ed25519 signing tool. Transfer back only the 64-byte detached signature and public verification key. Then:

```powershell
node scripts/release-manifest.mjs attach output/release/envelope/manifest.template.json output/release/envelope/signature.bin output/release/public-key.pem output/release/Nakama.exe output/release/release.json
```

All outputs must be new paths. Windows Authenticode must be applied **before** preparing this envelope: later artifact edits change its hash. Add `update` to the verifier policy with `manifest`, `trustedKeys`, `platform` and the reviewed `sourceHash`; the public trust file is an array of `{ "id": "release-key-id", "publicKey": "-----BEGIN PUBLIC KEY-----..." }`. Retain a separately verified previous artifact/manifest. Nakama still requires its exact PC installation approval, quiescence and private backup; signatures do not bypass these gates. Review/revoke compromised public keys locally and define a recovery channel before shipping automatic updates. A source checkout does not provision a trusted signing identity.

## Clean installation and recovery acceptance

Source Electron fixtures use disposable profiles; they are not clean-PC installer tests. A packaged build deliberately ignores the source-only test-profile override. Do not launch it against an installed profile and call that isolation. Use a clean Windows VM/Sandbox with no owner accounts, no copied installed profile and network disabled for the initial setup test. Verify the installer, install through the ordinary platform flow, start, close and restart; use synthetic settings/project/pairing only. Record uninstall/reinstall behaviour separately from upgrade behaviour.

For a signed upgrade/recovery drill, preserve a previous signed installer and create synthetic host state plus a synthetic persistent browser login in the VM. Pause monitors, close private sessions and stop tasks. Make the exact approved backup; record every file/hash and the Electron Local State/partition coverage. Upgrade, restart and verify saved preferences, projects, permissions and synthetic browser continuity. To recover, close every Nakama process, preserve the failed state separately, reinstall the previous compatible binary and restore the matched backup on the **same OS account/machine**. Encrypted browser/vault data may depend on that OS identity. Never automatically overwrite current data or restore a backup from a different schema; investigate before any migration or recovery.

For Android, use a dedicated emulator and synthetic data for ordinary update/recovery tests, with its own fixture signing identity and increasing version code. Verify app ID and certificate equality before an update. Do not uninstall a personal device to test rollback; Android downgrade/data restrictions are not bypassed by an APK hash. Physical device acceptance remains a separately recorded owner operation.

The new local test covers backup, copying into a **new** disposable directory, Store reload and exact preservation of synthetic settings, project/device/monitor records, vault bytes, Local State and cookie bytes. It does not prove Windows credential decryption, Chromium cookie health, real installation rollback or recovery across operating-system accounts. Existing self-maintenance tests cover missing backup, changed signatures/bytes/source, interrupted approval and non-replayed installer handoff. Actual signed clean-install/upgrade/recovery remains a production binary-release blocker until that VM/device evidence is recorded.

## Preparation evidence

Local release tests cover artifact identity and signature failures, debug-build rejection, stale dependency notices, inherited packing configuration and synthetic backup recovery. They use no production keys, installed profiles, devices, network providers or model calls. A debug-signed, debuggable Android artifact was correctly rejected by the production gate. This establishes a negative release check, not signed installation or physical-device acceptance.

Source publication does not require purchasing signing or moving private credentials to a public system. Public binary distribution remains held on the owner's production identity/custody decision, provider enrolment where needed, final notice packaging, actual signed artifact checks and clean-install/recovery acceptance.
