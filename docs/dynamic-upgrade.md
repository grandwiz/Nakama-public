# Dynamic upgrade

Dynamic upgrade lets Nakama save self-improvement requests and prepare a separate source candidate through its existing managed development team. It does not rewrite the running installation. Open **Dynamic upgrade** on Windows or **Tools → Dynamic upgrade** on Android. You can also say `upgrade yourself with a clearer settings page` to save a request without inference.

## Requests and allowance

Requests start **held**. Saving, viewing and staging source make no model call. There is no date-based reset trigger, scheduled retry or paid fallback. A provider allowance reset never authorises a development run. Only **Release hold and start team** on Windows, with an explicit confirmation that allowance is restored and this one run is authorised, can start development.

Configure the reviewed Nakama source folder and an ordinary managed-project workspace on Windows. The source must be an ordinary Git checkout. **Prepare isolated source** creates a new candidate project from tracked working files only: untracked and ignored fixtures never enter the candidate, so track reviewed new source files before staging. A bounded allowlist copies source, tests, build configuration and the blank public checklist, excluding Git history, runtime profiles, accounts/vaults, cookies, personal filled checklists, reports, generated installers and signing keys. Local Git enumeration disables hooks, external configuration, fsmonitor, prompts and network protocols. Linked/special paths and oversized exports are refused. Existing source and installed data are preserved. A failed partial candidate stays available for inspection.

Android can save a held request, view and refresh permitted shared evidence, and stop its own request. Source staging, releasing the provider hold, publisher trust, package attachment and installation approval remain Windows controls.

The candidate uses saved configurable planning/development/peer roles. All questions use the existing manager; workers wait for answers. Exact PC-approved checks and the existing bounded repair loop apply. Both independent reviewers must pass. Opening the candidate project shows questions, tasks and check approvals. Stop does not silently retry a model run.

## What qualifies as ready

Readiness checks the exact candidate/workflow association, unchanged reviewed source, two independent passing final-round reviews and actual approved successful `test` and `build` tasks. Static-only output, missing receipts, failures, signals and changed source cannot qualify. A candidate being ready does not prove a live site, app behavior on physical devices or a successful installed update.

Build and sign release artifacts separately. This version does not automatically discover a production signing identity, issue certificates, copy a private signing key into the candidate, or certify that an externally built artifact reproducibly matches its signed source claim. Android building/signing needs the established external key and SDK setup; these are deliberately not part of the source export.

## Signed artifacts and exact approval

Configure trusted **Ed25519 public keys** on Windows from a trusted source. Adding or replacing trust requires local PC authority, including while remote desktop is connected. Never enter a private key in this screen. Attach a candidate release manifest/artifact and a distinct previous signed release for recovery. Both signatures, hashes, sizes, identities, platform and supported data schema must pass. The candidate's signed source hash must match the current reviewed source. Android manifests retain the previous certificate identity as a trusted publisher assertion; this implementation does not independently parse the APK certificate. Android's package installer remains the authority for actual package signature/update compatibility.

Windows additionally requires valid Authenticode signatures on both installers. **The current unsigned engineering preview cannot pass this signed installation gate.** This feature does not quietly disable signature checks to install the current build.

The signed JSON manifest has these fields: `schema: 1`, `appId`, `platform` (`windows` or `android`), semantic `version`, `sourceHash`, artifact basename, byte count, SHA-256, trusted `keyId`, `dataVersion: 1`, optional `androidCertificateSha256`, and base64 `signature`. Signing uses the fixed canonical field order exported by `releasePayload` in `apps/host/self-maintenance-files.mjs`. The signature covers all release identity/integrity fields; it is not an approval. Configure trust before attaching a package, and revoke a key if it should no longer authorise releases.

**Request exact update approval** creates a PC approval for those exact bytes and reviewed source. Finish active work/previews, pause monitors and close browser/remote-control sessions first. Approval rechecks everything before taking recovery copies. New mutations pause while backup/handoff owns the host. No remote device or model can approve an update.

## Backup, handoff and recovery

Before handoff, Nakama saves and verifies private host data plus the relevant Electron user data, including dedicated browser partitions, Local State and local preferences. Rebuildable caches and the self-maintenance artifact tree are excluded. Linked paths, incompatible custom session storage or backup limits block handoff. The previous signed artifact is retained separately. Recovery data is private; never put it in Git, a public archive or a report.

Windows opens the exact verified installer for your platform installation flow and retains the maintenance lock until restart. Android reveals the verified APK for deliberate transfer and installation, then releases the Windows lock; it does not connect to or modify a phone. Preserve Android application identity/signature and install over the existing app without clearing data.

An installer launch is recorded as **handed off, installation unverified**. Nakama does not claim installed version/health from a successful launch. Restart interrupts pending authority and never retries an uncertain handoff. Recovery paths remain readable while new mutations are locked. Close Nakama and review backup timestamps/schema before any manual recovery; automatic state rollback and automatic post-update health acceptance are not implemented. Do not overwrite newer personal data blindly.

Synthetic tests cover isolation, preserved preferences, required reviews/checks, signature/hash tampering, exact approvals, backups, cancellation and no replay. Live Claude development remains on hold; production signing, actual installation, restart health and deliberate recovery still need separate acceptance. See [verification](verification.md) and [public-release preparation](public-release-roadmap.md).
