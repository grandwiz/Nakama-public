# Android verification

The Android companion is an engineering preview. The following results cover local policy tests and synthetic UI fixtures, not a certification of every physical device or live account.

## Recorded checks

| Check | Result |
| --- | --- |
| Production and instrumentation builds | Passed with SDK 36, JDK 17 and the Gradle wrapper. The recorded run used cached dependencies in offline mode. |
| JVM tests | 181 passed with no failures or errors. |
| Lint | Zero errors, 43 warnings and two informational hints. |
| Focused Android 16 instrumentation | 97 distinct cases verified: the combined final-production run passed 95/97; the corrected Clock/Monitoring fixture rerun passed 8/8. Details below distinguish fixture corrections from application changes. |
| Crash buffer | Empty after the focused instrumentation run. |

The monitoring fixtures cover paused creation with an exact rule and cadence, revision-bound resume/pause, failed-save draft retention, rejection of delayed responses after access revocation, private browser navigation and generic attention notices. Upgrade fixtures verify that saving a request leaves it held and does not execute a model or installation. Policy tests cover exact-app exclusions, incomplete or sensitive observations, expiry, pairing/configuration changes and navigation restrictions.

The fixtures used a disposable emulator, synthetic API responses and isolated test state. The bundled-recognition checks ran the local ASR model on synthetic PCM. No assistant/paid provider calls, shops, real payments, messages, deployments or DNS changes were used. Only the disposable emulator received app/test APK installation.

## Continuous companion, build 8 (2026-10-03)

This is the current record; build 2–7 entries below are historical. Build 8 removes the intentional pause when the screen locks. It permits spoken replies while locked, keeps the OS unlock boundary for actual on-screen actions, and adds a 30-second follow-up window after each completed reply. Stop/cancel, changed pairing or lost access end that window. Foreground microphone permission, explicit wake opt-in and Android's service-start restrictions still apply: force-stop or reboot requires reopening the app. A locked-service lifecycle fixture uses the real service with fake capture; it does not establish vendor background reliability.

The final cached/offline production and instrumentation builds passed, with **181 JVM tests, zero lint errors, 43 warnings and two hints**. The two warnings added since build 7 concern explicit preference persistence and listener SAM identity. On the disposable API 36 x86_64 emulator at 1080×1920/420 dpi, **97 distinct instrumentation cases were verified**. The final combined production run passed **95/97 in 197.87 seconds**. Two older component fixtures needed Android's measured native system-bar insets and fresh UiAutomation accessibility nodes after scrolling. Their production controls were present; the cached node coordinates were stale. After changing only those test boundaries, all **8/8 Clock and Monitoring cases passed in 53.67 seconds**, retaining the original pause/resume/cancel and revocation assertions. An earlier combined run also identified stale receipt mocks and screenshot interactions; corrected device-isolation, archived-receipt and Foundations assertions passed in the final production run. This is aggregate evidence, not a claim that a single 97-case invocation was clean.

The exact stop path uses a dedicated local keyword graph and bounded Whisper confirmation of the stop word. It stops active Nakama speech and ringing Nakama alarms without a host round trip; it does not cancel future alarms. Initial direct-keyword experiments falsely detected “stock” or “start”, so those results are not accepted as stop authority. The final real-native synthetic corpus passed **4/4 exact stop recordings and 14/14 negative recordings**, including stock/start, near phrases, bare “stop”, ordinary reply text and follow-up requests. Silence, noise and alarm-tone controls produced no stop. Two further native recordings delivered five-minute timer requests during an authorized follow-up window without a wake phrase. Tests also cover capture ownership, stale callbacks, follow-up expiry, rejected-stop decode readiness beyond 90 seconds, TTS cleanup, and revocation.

With models warm, stop-word confirmation took **540–919 ms** in the final run. The keyword detector needed approximately **400–620 ms of PCM after the synthetic phrase's final strong samples**. Together this estimates approximately **1.0–1.6 seconds after the phrase**, excluding actual microphone transport, device audio processing and scheduling. Model preparation runs when the stop listener arms; cold preparation can add delay. These are synthetic emulator measurements, not zero-latency or physical microphone/echo performance guarantees. Hardware echo cancellation is requested when available and Nakama avoids speaking its own literal stop phrase, but noisy-room interruption and speaker echo still require phone/tablet acceptance.

Three custom-sound cases verify assigned-device manifest download, immutable hash/length/WAV validation, pair-scoped private storage, rejection of changed pairing or bytes, explicit-null default sound, and actual native MediaPlayer playback of a synthetic silent clip. The exact-stop callback silences that playback while retaining future routine definitions. Android only plays verified local WAV files; the Windows host handles licensed sound discovery and clipping. Source, attribution, license and modification notice are visible beside sound selection. Download completion is followed by a fresh identity/access check before scheduling.

Three actual HTTPS transport cases verify trusted-alternate recovery, wrong-certificate failure without fallback, and one POST dispatch when the response is lost after accepting its body. The final request uses fixed-length streaming, separate pinned TLS probes and a bounded successful-endpoint preference scoped to the pin/token. Removed or empty advertised alternatives clear that preference. Archived voice receipts remain origin-bound; fresh recipient changes take precedence over stale archived copies. Five on-device local-history cases and three rendered chat cases cover retention, originals, search/paging, concurrent storage, explicit clear, timestamp taps, submission scrolling and completed-work filtering. These fixtures use no assistant provider.

The crash-buffer queries returned no entries. After the successful focused rerun, force-stop left no Nakama service. Only the owned **NakamaPublicVoice8** emulator and its isolated ADB server were stopped; a process recheck found neither. No physical device received an APK or instrumentation. Documentation images use synthetic state; the chat image is the actual MainActivity screen, including timestamp, composer and navigation.

APK identity remains **dev.nakama.companion**, versionName **0.1.0**, versionCode **8**, minimum API 35, target API 36, arm64-v8a/x86_64. Signature verification passed; certificate SHA-256 **4c5cf5c6c8f559b5387ee2d0f61ca4aea5a6131547831374ac3ce72bcaccc482** matches archived build 6. The ten-file speech manifest adds a 43-byte stop-keyword graph; the original acoustic weights, vocabulary, native libraries and notices remain byte-identical to build 6. Final APK SHA-256: **c62ad9d4930e9c5e47b29063f97c971e081063a30cb10503aaf0ba0cb9f252bb**. The named output is `output/apk/Nakama-0.1.0-build8-continuous-companion.apk`; build 6 and 7 archives are preserved.

This evidence does not replace physical speech, microphone/TTS echo, audible alarms, battery, lock-screen/vendor lifecycle or real-app acceptance. No live or paid assistant/model-provider inference, personal account, physical-device installation, purchase or message was used for Android verification.

## Reproduce the build and JVM checks

Install JDK 17, Android SDK 36, Python 3.11+, NDK 28.2.13676358 and SDK CMake 3.22.1 on Windows. Set NAKAMA_PYTHON if python is not the correct executable; see the [native build instructions](../../docs/android-guide.md). Configure `JAVA_HOME` and `ANDROID_HOME` for your own installation, or use Android Studio's SDK configuration. From `apps/android`:

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

Android can create paused website and own-device application monitors, inspect status, resume/pause and open a permitted browser handoff. Direct chat requests with an exact HTTPS URL and supported condition can create and start a read-only website monitor through the host. PC-only configuration and approvals remain on the PC. Website sessions run on the awake Windows host; they are not copied into an Android browser profile.

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

## Device routing preview (2026-10-02)

Build 4 preserves dev.nakama.companion and the existing local debug signing identity. Full JVM tests: 120 passed. Final lint: zero errors, 38 warnings, two hints. The final disposable Android 16 emulator run passed all 51 cases, including six device-isolation tests and four Foundations tests. The initial run passed 50/51; the older Foundations fixture needed to scroll the expanded category row before selecting Routines. After correcting only that test interaction, the full rerun passed and the crash buffer was empty.

Checks cover foreign/unstamped voice and attention suppression, execution target distinct from reply recipient, exact alarm membership, version-bound independent scheduling receipts, multi-target edits, remote timer redelivery and conflicting request IDs. Tests use fake responses and timer adapters; they do not prove audible hardware delivery or actual Netflix launch. See the [complete current verification](../../docs/verification.md#device-isolation-remote-targets-and-browser-sessions-2026-10-02) and [installation/targeting guide](../../docs/device-routing.md). The owner installs the APK manually; no personal phone/tablet was a fixture.

## Bundled English recognition preview (2026-10-02)

Build 5 packages Sherpa-ONNX 1.13.8, ONNX Runtime 1.28.2 and the pinned English streaming Zipformer 2023-06-26 model. It supports arm64-v8a and x86_64 on Android 15+. Talk and wake load verified APK assets rather than an Android recognition-service language download. The native runtime is built with TTS disabled; spoken replies still use Android's separately installed offline voice.

The final offline build passed 136 JVM tests, lint (zero errors, 37 warnings, two hints), app and instrumentation packaging. All 59 focused emulator cases passed and the crash buffer was empty. Six Python runtime-packaging checks also passed. APK checks verified all six model/config files, all 21 notice-source hashes, four speech native libraries, 16 KB native/load and ZIP alignment, versionCode 5, and the unchanged application ID/debug certificate. This is an engineering preview, not a production signing or hardware acceptance claim.

The four native cases load the actual packaged model without opening a microphone. They cover silence, DC/quiet noise/hiss/tone false wakes, 18 generated British/US recordings, and identical meaning for a time request delivered in 100 ms, 400 ms and whole-buffer chunks. The measured corpus result was 7/8 wake positives, 10/10 non-wake recordings rejected, and 4/4 time requests recognized. One British bare-name recording was missed; use **Hey Nakama**. All four timer recordings had wording errors and produced no deterministic timer action. These are explicit ASR quality limits, not timer success claims or reasons to loosen the command parser. Typed Clock commands and the earlier timer policy/UI checks remain separate evidence.

Initial native tests exposed text from digital silence and a lost word sequence with four decoding paths. Acoustic evidence now blocks silence/DC/click transcripts; eight decoding paths retain the complete request on Android. A controlled comparison isolated beam pruning from endpoint handling. Temporary endpoint delays and diagnostic variants were removed; the final native tests passed with default endpoint timing. Recognition accuracy, real microphone/TTS latency, background survival, battery use and physical timer sound still require owner acceptance.

To reproduce the speech corpus on Windows, run `powershell -File scripts/generate-bundled-speech-fixtures.ps1` from the repository root with the installed Microsoft Hazel Desktop and Zira Desktop voices. This renders files without recording or playing audio. The Android test build stages only its WAVs/manifest from the ignored cache; they are never in the app APK. Build again, install both APKs only on a disposable emulator, and run `dev.nakama.companion.BundledSpeechNativeTest` with the instrumentation command above. Missing fixtures fail that explicit corpus test rather than silently skipping it. No personal phone/tablet was installed or used for testing.

## Separate wake detection and English transcription, build 6 (2026-10-02)

Build 6 bundles Whisper base.en int8, the GigaSpeech 3.3M keyword detector and Silero VAD: nine verified model/config files totalling 175,154,862 bytes. The keyword model alone grants one bounded post-wake request; it does not transcribe ambient conversation. An independent microphone producer keeps capture running during decoding. Overflow and requests exceeding the 20-second audio bound fail without submitting a partial command. Exact command and device-recipient checks remain unchanged.

Final offline JVM/lint/app/test builds passed: **158 JVM tests**, **zero lint errors, 38 warnings and two hints**. The final combined disposable API 36 x86_64 emulator run passed **71/71 tests** in 150 seconds. Its crash buffer was empty and no app service remained after cleanup. The emulator had 2 GiB RAM and four virtual CPU cores; it was not a personal device. Seven Python runtime-packaging tests passed. Independent reviews covered audio bounds and cleanup, wake authority, native timestamps, playback cancellation, service lifecycle, pairing and device isolation.

The native checks use the real packaged models with synthetic PCM, without opening a microphone or executing the recognized timer/app actions:

- The 72-recording British corpus uses Hazel, George and Susan. All 15 basic timer durations, 12 app requests, three time requests, three explicit device destinations, three greetings and three date requests passed strict production parsing/text assertions. All 12 negative examples remained noncommands; all nine conversational requests had zero normalized word error in this corpus.
- Named-timer phrases were measured separately: **9/12 exact**. All three creation phrases containing the name “tea” had wording/name errors, including “T”. No homophone substitution or fuzzy command aliases hide these misses. Named timers remain a manual speech-quality acceptance item.
- Silence, DC, quiet noise, hiss and a tone produced no command text. Timer meaning remained correct with 512-, 1,600- and 6,400-sample reads.
- Eight original wake positives, eight additional short/rate variants, ordinary speech and near-name negatives exercise the dedicated detector and complete wake-to-request handover. Separate wake/request speech, bare wake without an invented command, 12 seconds of idle audio and several read sizes pass. Windows keyword calibration also passed 16 clean positives and 29 negative/acoustic controls; only 12/16 quiet/noisy stress positives were detected. This calibration does not establish noisy physical-device reliability.
- Real foreground-service tests use fake audio and confirm Home/Recents survival, notification Stop, late-callback suppression and playback cleanup after completion, cancellation or timeout. Physical microphone capture and vendor battery behavior remain separate acceptance.

Among 75 spoken decodes, warm median inference was **752 ms**, warm maximum **1,181 ms**. The first request took **2,187 ms** including preparation, with model loading accounting for 786 ms of its 1,599 ms inference path. These are emulator measurements excluding real speaking time, endpoint wait, TTS and host/model work. Sampled process PSS was about 417–484 MiB under instrumentation, not a measured peak or a phone benchmark.

The first combined run passed 68/71 and exposed short wake requests decoded as only “What”. Controlled native diagnostics showed sensitivity to excess surrounding silence. The corrected endpoint still waits about 608 ms, but passes only 192 ms of confirmed trailing quiet to Whisper. Pre-roll is capped at 160 ms; a separate bug that retained oversized audio after rejected short fragments now contracts and zeroes that buffer. Tests preserve quiet word beginnings, internal pauses and manual partial-frame finishes, and repeat 500 rejected fragments without buffer growth. The original strict failing handover assertions now pass. An earlier idle test also caught native keyword timestamps resetting after silence; the source-built runtime now preserves the frame counter and exposes absolute stream time through JNI. No acoustic weights or command permissions changed to resolve either defect.

APK verification checked versionCode 6, dev.nakama.companion, Android 15+, arm64-v8a/x86_64 and the unchanged local debug certificate. All nine model hashes and 24 indexed notice/provenance records match source. The four speech libraries match the rebuilt ASR-only runtime; those libraries and AndroidX graphics libraries pass 16 KB ELF/ZIP alignment. No synthetic WAVs, old model vocabulary or test fixtures are present in the application APK. Both package-integrity scripts passed; the Windows installer is unchanged from the earlier routing preview. APKs, model weights, recordings and diagnostic logs remain ignored local outputs.

To reproduce the native fixtures on Windows, use the installed offline Microsoft Hazel Desktop, Zira Desktop, George and Susan voices:

```powershell
powershell -File scripts/generate-bundled-speech-fixtures.ps1
powershell -File scripts/generate-wake-handover-fixtures.ps1
powershell -File scripts/generate-bundled-command-fixtures.ps1
python scripts/test-bundled-speech-runtime.py
```

Rebuild both APKs, verify the exact disposable emulator serial as above, and install both there. Add `BundledSpeechNativeTest`, `BundledKeywordSpotterTest`, `BundledWakeNativeTest`, `WakeReplyPlaybackTest` and `WakeServiceLifecycleTest` (each prefixed `dev.nakama.companion.`) to the focused instrumentation class list. Missing fixture assets fail the native tests. The optional Windows model-comparison helper is exploratory; its approximate metrics do not replace the strict Android parser checks.

Install over the existing matching-signature app, then reopen it and check **Tools → Wake word → Restart wake listening → Microphone ready**. The [Android guide](../../docs/android-guide.md#optional-local-nakama-wake-word) includes battery settings. Home/Recents dismissal is supported while unlocked; force-stop/reboot require reopening. Locked-device listening, uninterrupted vendor background survival, real British-accent accuracy, microphone/TTS latency, battery use and physical alarm/app outcomes remain owner acceptance. No physical installation, live assistant/provider call or paid inference was performed. Public production-release gates remain open.

## Host alarms, app launch and website delegation, build 7 (2026-10-03)

Build 7 handles the reported alarm/app/monitor requests while retaining build 6's speech models and capture pipeline. Alarm records live on the Windows host; their default destination is the requesting Android. A missing repeat instruction means one-time, with an explicit local date/timezone. Android sync is opt-in, and confirmation requires the exact alarm version's scheduling receipt. Short setup feedback is limited to the current request's origin and destination. Natural Chrome launch uses the installed-app path; named remote targets reach the exact-device host route without local fallback.

The final cached/offline app and instrumentation builds passed with **168 JVM tests**, **zero lint errors, 41 warnings and two hints**. The three added warnings are two UseKtx style suggestions and an ApplySharedPref warning for explicit persistence. The synchronous restore invalidation/generation commit intentionally prevents interrupted restoration from retaining an old confirmed receipt.

The final disposable API 36 x86_64 emulator run passed **77/77 tests in 196.979 seconds**, including real bundled speech/keyword/wake inference on synthetic PCM, voice and service/playback lifecycle, app selection, device isolation, Clock, Foundations, monitoring and autonomous-task UI. New alarm cases cover exact origin/version/setup feedback and failed restoration without a false scheduling receipt. Policy tests cover one-time dates, DST, persistent consumption and preserving the unchanged registered alarm while Android delivers it during its due minute. Lost receipt uploads retry; observed access revocation clears synced alarms and reaches pairing cleanup. These tests do not record a microphone or prove physical alarm sound.

The fresh emulator used 2 GiB RAM and four virtual CPU cores. Its first 320×640/160 dpi run passed 75/77: two existing UI fixtures could not find the wake-enable control and autonomous-task answer field. At 1080×1920/420 dpi, the complete rerun passed with unchanged assertions and production code. The successful run's crash buffer was empty, and no Nakama service remained after force-stop. Only this test-owned emulator and its isolated ADB server were stopped; personal devices were not used.

APK identity is dev.nakama.companion, versionName 0.1.0, versionCode 7, minimum API 35, target API 36, arm64-v8a/x86_64. APK signature verification passed and the signing certificate matches archived build 6. All 41 compared speech asset/notice/native-library entries are byte-identical to build 6. The final APK SHA-256 is c9e215971dbff8c9d6dc6b1f66ac74a56b07bf27f9c2dd7fcd9cfac166ea42a2. Final APK/Windows/checklist integrity, 79 packaged source/renderer files and npm/Windows notices passed; this does not clear production signing or complete Android release-notice gates.

Update both previews and enable Tools → Routines → Sync phone alarms once on each destination, with notifications and Alarms & reminders granted. Test "Set an alarm", answer with its time, and inspect the destination's current scheduling receipt. Also test "Control my phone and open up Google Chrome" and an exact-URL stock request. Repeat wording, explicitly named remote devices, offline edits, background survival and audible phone/tablet delivery still need owner acceptance. General interaction inside arbitrary apps remains limited to implemented adapters and separate permissions. No live assistant/provider, paid inference, real account, purchase, message, physical-device installation or deployment was used.
