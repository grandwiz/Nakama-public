# Contributor continuation notes

Read the [capability status](implementation-status.md), [verification record](verification.md), [security boundaries](security.md) and current Git diff before changing behavior. This public repository starts from a clean source snapshot; older private development objects and personal acceptance records are not included.

The host owns saved local state and permission checks. Electron provides the private browser, Windows observation and user-controlled adapters. Android uses pinned host connections and explicit device permissions. Preserve existing roles, preferences, accounts and project identities when evolving schemas.

Monitoring and self-maintenance have dedicated [monitoring](monitoring.md), [upgrade](dynamic-upgrade.md) and [signing](release-signing.md) guides. Review asynchronous permission checks after captures and network operations, single-use write receipts, expiry/restart behavior and maintenance quiescence whenever extending them.

Use disposable synthetic fixtures for development. Live accounts, models, shopping, deployment, billing and physical-device input require their own explicit authorization. A successful local test, provider receipt, installer launch or static review is not functional acceptance.

Keep generated output and private acceptance data out of Git. Public binaries need production signing, dependency notices and deliberate clean-install/recovery acceptance; source publication does not establish those checks. See [contribution guidance](../CONTRIBUTING.md).

## App selection and Android voice preview

The current local change adds app-name dropdowns, per-request voice/text replies, a background wake conversation path and Mote's miniature-computer work indicator. Desktop app catalogs are volatile, owner-only and device scoped; Android launcher queries add no new package permission. Keep exact-app observation and two-minute control consent separate from selection.

Wake opt-in remains explicit and saved. The unlocked-device service uses only local recognition and the existing scoped host chat route. It never retries a lost submission; foreground handoff carries accepted receipt IDs only. Stop, screen-off, changed pairing and access loss invalidate playback. Hardware hotword, guaranteed 24-hour listening and locked-device interaction are not implemented. Physical voice recognition, recipe/conversation quality, app-control outcomes and alarm sound remain owner acceptance.

Android preview build number is 4 with the existing application ID and local signing configuration. Local APK/Windows installer outputs and their integrity manifest stay ignored. Windows runtime notice files and the lockfile now have explicit LF checkout rules so notice hashes verify consistently; dependency versions and notice text are unchanged.

Owner feedback reported slow basic replies, unsupported duration timers and repeated wake-listener sounds. This follow-up implements local replies, built-in clocks/timers and continuous wake readiness diagnostics, with installation steps in README/quick-start/Android guide. Reviewed public-source publication is authorized after these checks; local packages remain excluded. Do not infer live model authorization from an allowance reset or an available package. Keep Kling disabled and preserve all saved profiles/accounts/pairing and personal checklist values.

Current verification: 643 host passes plus one optional skip; 120 Android JVM passes; all 51 focused emulator cases passed after correcting an older Foundations scrolling fixture; zero Android lint errors (38 warnings, two hints). The 40 focused extension checks passed with disposable real Chromium enabled, and the new desktop alarm routing fixture passed seven checks. Windows/APK package verification and Windows notices passed. See verification.md for scope and limits. The owner will install both previews manually; do not infer installation or acceptance from a successful build.

PC timers persist in host state and require a running awake PC. Android Clock timers use separate local storage, explicit alarm/notification grants and Android alarm-clock scheduling; no host duplicate is created. Local greeting/time/date/timer commands precede host access. Continuous wake input uses an in-memory PCM pipe and pauses unsupported engines instead of repeating timeout chimes; it does not mute device audio. Physical engine support and alarm sound remain owner acceptance. Do not replace this with cloud fallback or pretend permission alone proves recognition readiness.

## Device delivery follow-up

Conversation/task/attention delivery is now scoped to the authenticated origin; Android also filters its own speech, notifications and action inbox. Explicit named app/timer requests have a deterministic destination route with no fallback. Alarms select one or several Android IDs and preserve independent version-bound scheduling receipts. Offline alarm edits remain pending until sync. Chrome ordinary tabs share one opt-in session rather than per-tab grants. Read [device routing](device-routing.md) and the latest verification entry before changing these contracts. Nearby wake listeners can still independently submit separate requests; room-wide microphone arbitration is not implemented.
