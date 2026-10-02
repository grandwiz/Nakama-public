# Android verification

The Android companion is an engineering preview. The following results cover local policy tests and synthetic UI fixtures, not a certification of every physical device or live account.

## Recorded checks

| Check | Result |
| --- | --- |
| Production and instrumentation builds | Passed with SDK 36, JDK 17 and the Gradle wrapper. The recorded run used cached dependencies in offline mode. |
| JVM tests | 77 passed with no failures or errors. |
| Lint | Zero errors, 34 warnings and two informational hints. |
| Focused Android 16 instrumentation | Eight passed: five monitoring/upgrade cases and three autonomous-task cases. |
| Crash buffer | Empty after the focused instrumentation run. |

The monitoring fixtures cover paused creation with an exact rule and cadence, revision-bound resume/pause, failed-save draft retention, rejection of delayed responses after access revocation, private browser navigation and generic attention notices. Upgrade fixtures verify that saving a request leaves it held and does not execute a model or installation. Policy tests cover exact-app exclusions, incomplete or sensitive observations, expiry, pairing/configuration changes and navigation restrictions.

The fixtures used a disposable emulator, synthetic API responses and isolated test state. They made no model or provider calls, visited no shop, submitted no real payment or message and approved no deployment, DNS change or package installation.

## Reproduce the build and JVM checks

Install JDK 17 and Android SDK 36. Configure `JAVA_HOME` and `ANDROID_HOME` for your own installation, or use Android Studio's SDK configuration. From `apps/android`:

```powershell
.\gradlew.bat --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

Add `--offline` only when the Gradle, plugin and dependency caches are already populated. A first build may download the declared build dependencies. The APK outputs are `app/build/outputs/apk/debug/app-debug.apk` and `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`.

To repeat the focused UI suite, start a disposable API 36 emulator and set `NAKAMA_TEST_SERIAL` to its exact ADB serial. Confirm that it is the intended emulator before installing either APK:

```powershell
adb -s $env:NAKAMA_TEST_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s $env:NAKAMA_TEST_SERIAL install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s $env:NAKAMA_TEST_SERIAL shell am instrument -w -e class dev.nakama.companion.MonitoringUpgradePanelTest,dev.nakama.companion.AutonomousTasksPanelTest dev.nakama.companion.test/androidx.test.runner.AndroidJUnitRunner
```

Never run instrumentation against an installation containing real accounts, projects or pairing state. Use a dedicated test device or emulator. Stop the test-owned emulator when finished.

## Operational limits

Android can create paused website and own-device application monitors, inspect status, resume/pause and open a permitted browser handoff. PC-only configuration and approvals remain on the PC. Website sessions run on the awake Windows host; they are not copied into an Android browser profile.

Read-only phone observation requires separate explicit consent for one exact app, at most 30 minutes, with the phone awake and unlocked, accessibility available, Mote visible and the monitoring notification present. Local matching sends an outcome rather than page text, screenshots or editable values. Stopping or dismissing its notice, locking the phone, losing the required service or changing pairing invalidates the lease. It does not grant clicks, typing or unrestricted phone control.

Physical accessibility observation, third-party app behavior, reliable notification delivery, background survival and battery use remain separate acceptance work. Real browser login, touch/keyboard handling, CAPTCHA, queue and payment completion also require human acceptance. The synthetic tests do not establish retailer stock accuracy or instant purchasing.

Android can save a held improvement request, view permitted evidence and stop its own request. It cannot release the development hold, approve an update or install one through this panel. A local debug build uses the builder's development key; updating an existing installation requires the matching signing identity. The public source contains no signing keys or private device data.

## App-selector and voice preview follow-up (2026-10-02)

The earlier public preview build used versionCode 2 while retaining dev.nakama.companion, versionName 0.1.0 and the existing local debug signing configuration. In this checkout, 94 JVM tests, app/instrumentation builds and lint passed (zero errors, 34 warnings, two hints). Thirty-five focused Android 16 emulator cases passed across voice, wake conversations, input-specific replies, settings, app selectors, Mote, monitoring, autonomous tasks and visible control. One initial picker fixture failed to scroll to its target; its corrected two-test rerun passed. The fixture's exported control activity is launcher-visible only in the test APK so it can exercise the real selection guard.

All audio and host/model responses were synthetic. The emulator was newly created with disposable state. No personal device received instrumentation, and the owner chose manual installation of the completed APK. Microphone recognition, force-stop/reboot/vendor lifecycle behavior, alarm sound, conversation quality and third-party app control remain physical/live acceptance. See [the complete run record](../../docs/verification.md).

## Clock and continuous-wake follow-up (2026-10-02)

Preview build 3 preserves the existing application ID, version name and debug signing identity. The final cached/offline build passed 114 JVM tests and lint with zero errors, 38 warnings and two hints. The final combined disposable Android 16 emulator run passed all 41 cases, including three local Clock fixtures and the expanded speech/permission checks; its crash buffer was empty.

An initial run had two Clock fixture failures (Compose scroll timing and test-package preference context). Correcting those test boundaries produced the successful full rerun. Local timer state-machine checks cover deadline restoration, pause/resume/cancel, denied permission/registration failure, stale alarm receipts, bounded history and no model calls. Clock UI tests use synthetic alarm/notification effects. Voice tests use synthetic callbacks/PCM rather than recording a microphone.

Actual phone/tablet audio, recognizer continuous-session support, listening chimes, background reliability, battery impact and audible timer delivery still require manual acceptance. Local package integrity and signing checks passed; no physical-device install or provider inference was performed. See [setup steps](../../docs/android-guide.md#optional-local-nakama-wake-word) and [Clock behavior](../../docs/clock.md).
