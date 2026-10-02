# Verification

Nakama is an engineering preview. These results establish the listed local and synthetic checks; they do not certify live provider accounts, retailer checkout, production updates or reliable unattended device operation.

## Tested implementation

| Check | Recorded result and scope |
| --- | --- |
| Host suite | 643 passed, zero failures, one optional Chromium-extension case skipped (644 total). Providers were synthetic; local browser and process fixtures were disposable. |
| Build | Strict TypeScript, Vite and the standalone MCP bundle passed. A bundle-size advisory remains. |
| Monitoring | Revision, expiry, Stop, restart pause, exact-device sharing and revocation, sensitive or ambiguous outcomes, single cart attempts and private takeover races passed. |
| Native browser | Isolated Chromium exercised synthetic stock/text/CAPTCHA/queue/cart pages, persistent profile isolation, profile forgetting and existing browser regressions. Release review reproduced service-worker interception; the fix blocks/clears workers and cache during automatic transitions while retaining cookies/localStorage. The native worker regression passed. It did not use a merchant account. |
| Desktop UI | An isolated native fixture checked drafts, paused monitor creation, selected-phone sharing and held upgrade requests, with no provider calls or remote page loads. |
| Dynamic upgrade | Fifteen focused tests within the host suite covered source staging, saved preferences, check and independent review evidence, artifact trust, exact approvals, private backup, cancellation and prevention of replay. No production installer was launched. |
| Android | 120 JVM tests and 51 focused Android 16 emulator tests passed. Lint reported zero errors, 38 warnings and two informational hints. See [Android verification](../apps/android/VERIFICATION.md). |
| Release preparation | Eleven release-gate tests passed, including actual-byte/identity binding and synthetic backup restoration into a fresh directory. Four notice tests are included in the host total. The npm runtime inventory covers 156 production placements in 148 notice groups. Neither result certifies signed installation or complete Android binary notices. |

Code review and regression checks covered privacy revocation, stale navigation, one-use cart dispatch, source export and publisher trust. Successful checks are evidence for their tested paths, not a guarantee that every supported workflow or device has been accepted.

## Reproduce local checks

Install the development dependencies as described in the README, then run from the repository root:

```powershell
npm test
npm run build
node scripts/verify-browser-studio.cjs
node scripts/verify-monitoring-native.cjs
node scripts/verify-monitoring-ui.cjs
node scripts/verify-autonomous-task-ui.cjs
node scripts/verify-project-workflow-ui.cjs
```

Native Electron fixtures require Windows and normal process permissions. Renderer fixtures use Playwright configured through `NAKAMA_PLAYWRIGHT`. Fixtures must use disposable local profiles; do not redirect them to installed application data. Some optional integration checks require additional local tooling and report their absence explicitly.

The source repository does not contain installed packages, private acceptance records, signed release artifacts or personal checklist results. Building from source creates local outputs. Package verification scripts validate locally prepared artifacts and are not evidence of a published release.

## Remaining acceptance

- Live model eligibility, quality, costs and end-to-end autonomous project delivery require a user's accounts and explicit authorization. There is no paid fallback or automatic release of the development hold.
- Website monitoring is best-effort polling. Arbitrary JavaScript storefronts, Pokémon Center stock drops, real login/CAPTCHA/queue behavior and payment handoff have not been accepted. Cart preparation cannot pay or place an order.
- Physical Android voice, background notifications, accessibility observation, battery use and third-party application behavior require separate device acceptance.
- Windows preview builds are unsigned. They cannot pass the signed update gate. Signed installation, restart health and deliberate recovery remain unaccepted; recovery is manual.

Use [Monitoring](monitoring.md), [Dynamic upgrade](dynamic-upgrade.md), [Security](security.md) and the [testing guide](testing-guide.md) for their operational boundaries. Never use a real purchase, message, deployment or billing change as a disposable test fixture.

## App selection and voice preview verification (2026-10-02)

These checks were run in the public checkout for the app-name selectors, Android wake/reply mode and miniature-computer activity changes:

| Check | Actual result |
| --- | --- |
| Host tests | 611 passed, zero failed, one optional skip (612 total); synthetic/disposable fixtures only. |
| Windows build | Strict TypeScript, Vite, standalone MCP bundle and local unsigned NSIS installer passed. The existing bundle-size advisory remains. |
| Desktop selector fixture | Passed friendly labels, duplicate-name selection, exact device/package submission, stale device response, expiry, monitoring and revocation checks. |
| Android JVM/build | 94 tests passed, zero failures/errors; app and instrumentation APK builds passed with cached offline dependencies. |
| Android lint | Zero errors, 34 warnings and two informational hints. |
| Android 16 focused emulator tests | All 35 distinct cases passed after correcting the picker test to scroll its bounded dropdown: nine voice-controller, seven wake-conversation, two voice/text-mode, two voice-settings, two installed-picker, four Mote, five monitoring/upgrade, three autonomous-task and one visible-control case. The first combined run had 34 passes and that one fixture failure; the corrected two-case picker rerun passed. |
| Package identity | APK signature verified; dev.nakama.companion, version 0.1.0, versionCode 2, existing local debug signing configuration. No production release claim. |
| Package contents/integrity | verify-packages.mjs passed for the rebuilt Windows installer, APK and copied blank public checklist. verify-kling-package.mjs passed for 73 packaged source/renderer files and the standalone MCP bundle; no Kling generation occurred. |
| Runtime notices | npm source inventory and packaged Windows notices passed. LF checkout rules fix byte-level notice verification across platforms; dependency versions and notice text were unchanged. Android production notices remain unfinished. |

Only a fresh disposable emulator received instrumentation; no personal phone/tablet profile was a test fixture. Voice playback, recognition and host/model responses used fakes. Actual microphone recognition, background survival, recipe/conversation quality, alarm sound and third-party app outcomes remain owner acceptance. No live model, paid fallback, purchase, message, call, deployment or DNS change was performed. The owner requested manual APK installation; no physical-device installation was performed. This first preview preceded the feedback follow-up below.

## Clock, response latency and wake follow-up (2026-10-02)

The feedback follow-up adds local greetings/time/date, built-in PC and Android timers, actual wake readiness/model diagnostics and continuous on-device wake input to avoid the old timeout/restart chime loop.

| Check | Actual result |
| --- | --- |
| Full host suite | 619 passed, zero failed, one optional skip (620 total). No live models. |
| Desktop | TypeScript/Vite/MCP and unsigned Windows installer built. Native Clock fixture passed all six checks, including response-loss deduplication; installed-app selector regression fixture passed all six checks. |
| Android build/JVM | App and instrumentation APKs built; 114 JVM tests passed without failures or errors. |
| Android lint | Zero errors, 38 warnings and two informational hints. The receiver action-dispatch warning is documented as a delegated check in the nonexported local timer receiver. |
| Android emulator | Final combined run: 41 passed. Three Clock, eleven voice-controller, eight wake-conversation, two reply-mode, two voice-settings, two app-selector, four Mote, five monitoring/upgrade, three autonomous-task and one visible-control case. Crash buffer was empty. |
| APK identity | dev.nakama.companion, versionName 0.1.0, versionCode 3; signature verified against the same local debug certificate used for the earlier preview. |
| Package checks | verify-packages.mjs passed the rebuilt APK/Windows installer and blank public checklist. verify-kling-package.mjs checked 75 packaged source/renderer files and the standalone MCP bundle. Source npm notices and Windows binary notices passed. |
| Source review | Independent reviews checked clock authority/persistence, Android alarm lifecycle and continuous wake cleanup. Encoding, diff and public-source audits passed. |

The first host run exposed six fixtures that used a greeting to expect a model worker; they now use a nonlocal question while retaining their original role/permission assertions. A later loaded run exposed a timed cancellation fixture; it now waits for actual child readiness and uses an explicit release gate, preserving ownership/revocation and file-absence assertions. The final full suite passed.

The first 41-case Android run passed 39 and exposed two Clock fixture defects: scrolling before Compose/accessibility updated, and using the test-package context to persist state. Corrected frame/scroll synchronization and an isolated target-context preference file passed in the final full rerun. Alarm and audio effects remain synthetic; no physical phone/tablet received instrumentation or installation.

Local time/greeting checks prove there is no PC/model dependency; they do not establish end-to-end physical microphone/TTS latency. Continuous segmentation and any recognizer start sound depend on the installed engine. Real wake detection, background survival, battery use and timer sound remain owner acceptance. The owner installs the APK/Windows preview manually. Packages, runtime profiles and generated reports remain outside Git; this does not clear production binary release gates.

## Device isolation, remote targets and browser sessions (2026-10-02)

Replies, speech and ordinary request notifications now carry the authenticated origin. Explicit app/timer destinations are separately validated; multi-device alarms retain an independent current-version receipt per target. Browser control uses one explicit ordinary-tab session. See [device setup and examples](device-routing.md).

| Check | Actual result |
| --- | --- |
| Full host suite | 643 passed, zero failed, one optional Chromium case skipped (644 total). Synthetic providers only. |
| Chrome extension | All 40 focused checks passed with the disposable Chromium fixture enabled: 32 worker policy cases, seven popup/session-race cases and one real MV3 Chromium flow. New tabs, reloads, cross-origin navigation and bounded screenshots were exercised. The native fixture grants the optional permission in its temporary copy; real installation/prompt acceptance remains manual. |
| Desktop UI | Seven new alarm-routing checks passed: explicit destinations, two selected targets, independent pending receipts, preserved edits, revoked-target handling, PC-only reminder edits and no provider work. Existing Clock and installed-app fixtures passed six checks each. |
| Android build/JVM | Final app and instrumentation APK builds passed; all 120 JVM tests passed with no failures/errors. |
| Android lint | Zero errors, 38 warnings, two informational hints. Remote-timer receipts intentionally inspect synchronous commit success; the style suggestion to discard that result is documented and suppressed. |
| Android emulator | Final combined run passed all 51 cases, including six device-isolation cases and four Foundations cases. Other cases cover Clock, voice/wake/reply mode, settings, app selection, Mote, monitoring, autonomous tasks and visible control. Crash buffer was empty. |
| APK identity | dev.nakama.companion, versionName 0.1.0, versionCode 4; verified with the same local debug signing certificate as earlier previews. |
| Packages | TypeScript/Vite/MCP and unsigned Windows NSIS build passed. Integrity manifest matches the final APK, Windows installer and copied blank public checklist. Packaged source verification passed for 77 files; source/Windows runtime notices passed. |
| Review | Independent host, Android, extension and desktop reviews checked origin inheritance, explicit-target authority, lost-response retries, stale sessions, permissions, offline schedules and per-target receipts. |

The first Android run passed 50/51: an older Foundations fixture assumed the Routines category remained visible after the Tools row grew. The corrected fixture scrolls the category row and preserves the original assertions; the complete rerun passed. Native desktop fixture adjustments used the explicit routine-type accessibility label and click semantics for a checkbox that removes itself. The host run also corrected old fixtures whose setup assumed shared delivery, without weakening isolation assertions.

No physical phone/tablet was installed or used as a fixture. Recognition, timer/alarm sound, background survival, third-party app behavior and real Chrome permission prompts remain owner acceptance. Two nearby wake listeners can independently accept the same speech; this change does not implement microphone arbitration. No live model, paid generation, account action, purchase, call or deployment was used. Local packages stay out of Git and are engineering previews; production signing, complete Android notices and clean-install/recovery gates remain open.
