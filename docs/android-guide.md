# Nakama for Android

Your phone and tablet are companions to **Nakama Control Center on your Windows PC**. The PC holds your AI connections and development workspace. Android gives you chat, voice, project cards and tools on the device you are holding.

If spoken words appear quickly but the answer is slow, update both apps and configure the separate **fast interaction role** in Windows Settings. Its default is GPT Astra 6 at low effort; detailed project planning/review retains the configured high-effort roles. Android navigation and supported board commands take their local route without an extra model call. While your reply is pending, Android checks more frequently and shows elapsed time; phone-action polling runs separately. Model startup and network time still apply. Read [how faster replies work](automatic-assistant.md#faster-everyday-replies).

The primary targets are your **Android phone and tablet, both on Android 16**. This build targets Android API 36 and accepts Android 15 or later so it can also be checked with the locally available test emulator.

## Project files, reports, browser and questions

**Projects → Files and reports** opens the PC project's folders. Breadcrumbs return to any parent folder. Filter the current folder or use **Search project filenames** for a bounded scan (40 folders, stopping after the directory that reaches 2,000 entries; at most 500 entries per directory). **Project chat** keeps that project's conversation selected. Text previews are read-only, up to 1 MB; PNG, JPEG and PDF previews are limited to 1,363,148 bytes. Binary previews check MIME, size and SHA-256 before display. Oversized images are rejected or downsampled. HTML is shown as text, never executed on the phone.

The Reports tab lists real queued/generating/ready/failed receipts, controls automatic reports and requests a new report. A PDF is a report of recorded work, not proof of deployment or hardware acceptance. Open a ready PDF inside Nakama, then use **Save a copy** to choose a destination in Android's document picker. The app refetches the file through paired HTTPS and checks its hash before writing; changed files require reopening. No bearer token is handed to an external viewer. PDF rendering uses a private, isolated Android service without app permissions; only temporary file descriptors cross its boundary, and preview files are unlinked while open. Rendering is bounded to 500 pages, one page at a time, with a 15-second response timeout. Password-protected or malformed PDFs can fail to render. See Android's [PdfRenderer guidance](https://developer.android.com/reference/android/graphics/pdf/PdfRenderer) and [document-creation picker](https://developer.android.com/training/data-storage/shared/documents-files).

Say **“open browser studio”** or use **Tools → Browser**. Chromium runs on the PC, not an Android WebView. Research sessions visit anonymous public HTTPS pages without form input; project sessions use a registered local preview origin; private sessions are for human login. Choose a session and tab to see permitted frames. Tap **Take human control** before tapping, swiping to scroll, or opening **Keyboard** for text/Tab/Enter/Backspace/Escape. **Address / tabs** exposes navigation and new tabs (four per session). **Release control**, leaving the view or backgrounding clears local input and requests release. If the PC cannot be reached, the app cannot confirm server release. Frames poll only while foreground, normally every 750 ms, and expire after three seconds; gestures use one frame ID, never a substituted image. This is a screenshot-driven control surface, not continuous video or a remote-desktop frame-rate claim.

Private or human-controlled browser screens block Android screenshots. Keyboard text is concealed by default, does not enter chat or saved state, and clears after input or leaving. Taking human control permanently makes that browser session unsuitable for agent/report content; release leaves the agent needing attention. Create a fresh project session for subsequent agent inspection. Agent office can show a live thumbnail for an untouched local project browser and its actual status/attention; private, human-controlled and previously controlled pages never become office thumbnails. Both Google/project access and the PC's browser-control permission are required. Login cookies stay in the PC browser and do not create an API account connection.

Say **“open project setup”** for initial setup and delivery-manager questions, or answer managed-project questions in Chat. Shared questions can be answered by any paired Android with Google/project access; only the originating phone can stop its workflow. **Answer by voice** fills the selected editable answer; review and press Save/Send yourself. Setup writes carry the current revision to catch edits from another device. Delivery questions use their saved question IDs. Answering a question never grants deployment, purchases or service creation. Full delivery and approval controls remain on the PC.

**Device → Project question and login alerts** is opt-in per pairing and needs Android notification permission. Alerts contain generic text and are secret on the lockscreen; saved deduplication stores at most 500 hashed receipt IDs per pairing, not questions or credentials. Open an alert to fetch current authorised state; stale/resolved or old-pairing alerts cannot resume a request. The voice action opens the exact unanswered question and uses the normal foreground microphone permission. While Nakama is open, regular refresh handles alerts. If you explicitly keep Mote visible, its existing foreground service checks every 15 seconds. No hidden boot worker or guaranteed 24-hour delivery was added; an offline PC, Android background limits or stopping Mote can prevent timely alerts. Android/user notification settings remain authoritative. See [notification permissions](https://developer.android.com/develop/ui/views/notifications/notification-permission) and [lockscreen visibility](https://developer.android.com/develop/ui/compose/notifications/create-notification).

**Tools → Account setup** (or **“open account setup”**) handles a ten-minute handoff explicitly issued by the PC to this phone for one provider. Open the private provider dashboard if needed, then explicitly paste its API credential into the secure field and select **Save account on my PC**. Signing in alone is not an API connection. The field disables autofill, blocks screenshots, offers no voice entry and clears on submission/backgrounding. No token is stored in phone preferences, logs or chat. The PC validates the single-use handoff and saves a new named account in its vault. For Namecheap, use the credential JSON specified on the PC; do not paste it in a conversation. Live provider login/token validation, OEM notifications, physical touch/keyboard accuracy and saving through your chosen document provider remain acceptance work.

## Motion, GitHub and reusable skills

Pages enter with a short fade and small vertical movement. Task cards, project cards and office desks keep stable identities when they move, status colours change gently, and Mote blinks and floats using Android's frame scheduler. These effects do not restart for every host poll. Chat avoids moving you away from older messages when a reply arrives, and an unsent draft and pending own-request replies survive internal page changes. Removed private content disappears immediately; it is not kept around for an outgoing crossfade.

Use **Device → Reduce motion** to keep transitions, busy indicators and Mote still. Android's system animation duration setting also applies; setting it to zero disables motion. The app observes changes while open, including for the floating mascot. The frame scheduler is not a frame-rate guarantee: smoothness on the physical phone and tablet devices still needs acceptance testing. See Android's [animator duration scale](https://developer.android.com/reference/android/animation/ValueAnimator) and [stable-key lazy list animation](https://developer.android.com/develop/ui/compose/lists).

**Projects → Import from GitHub** clones an exact `owner/repository` or HTTPS GitHub URL into the PC workspace using the named GitHub account you select. Connect accounts on the PC first; tokens remain there. On a project, **GitHub repository** shows its saved link, branch, HEAD and working changes. An existing Git checkout can be linked to its exact repository. SSH URLs and other Git hosts are not supported by this preview.

**Fetch** updates remote references. **Pull fast-forward** requires a clean tree; divergent branches need Git on the PC. To commit, select individual paths, enter a one-line message and the author name/email that will be recorded in Git history, then review the exact before/after text and create the local commit. Use the file controls and Before/After tabs to inspect every selected file; long text is rendered in lazy chunks without shortening it. Existing selected staged changes require Git on the PC, and unselected staging is preserved. A changed or expired preview requires a fresh review.

**Review push → Request PC approval** submits the exact branch/commit for approval in Control Center's Activity & approvals. Android cannot approve it. The receipt says the push is pending; it is not evidence of a completed push. Pushes can trigger repository automation, so this PC approval applies to every push. Import, link, fetch, pull and commit are explicit user controls, not model tool permissions. Google/project access gates all GitHub controls and hides loaded details if access changes. Say **“open GitHub”** to reach Projects.

**Tools → Skills** contains reusable instructions. Teach a method with a title, when to use it and up to twelve steps. Review a saved skill to inspect its source, edit it, pause reuse or forget it. Automatically learned project candidates remain inactive until **Accept for reuse**. The page also controls learning and reuse preferences; the PC's overall memory setting must be on for automatic learning and reuse. These shared instructions are context, not model training, executable plugins or permission grants. Do not store credentials in them.

Selection counts and recent task receipts mean the skill matched a task; they do not prove that a model followed it. Changed/disabled instructions can be withheld before provider dispatch. Say **“open skills”** or **“open learned skills”** to reach the library without a model call. Skills and open reviews disappear on access loss, and late responses cannot restore private data. Live GitHub networking and physical-device motion remain acceptance work; engineering checks use fake API fixtures only.

## Agent office and getting around

Open **Home → Visit Agent office** or **Tools → Agent office**. Each actual host agent gets a desk with an original mini-Nakama: green for GPT, orange for Claude and neutral for another provider. Names are assigned by your PC and stay attached to their agent records. The app does not invent idle workers or claim that a model is running just because its desk is visible.

Tap a desk to inspect its task, role, recorded status/phase, requested and effective effort, timestamps, output and errors. Labels distinguish workflow coordinators, model tasks and tool executions: a running coordinator represents a saved orchestration stage. **Reports to** and **Delegated work** follow the actual recorded parent/child links; the unfinished filter retains their parent context. Output is a saved result or excerpt, not private reasoning or a live screen. A host restart can leave an interrupted record. Nothing silently retries work from this page. The whole office, including an open detail card, disappears when Google/project access is removed.

**Tools → Core Memory** lets you inspect, add, edit or forget individual notes, including Nakama personality notes. These are shared editable context; learning controls remain on the PC. It uses the same device privacy gates and rejects late results after access changes. Say **“open core memory”** to reach it, or use existing **“remember that…”** chat commands to save a note.

Use **Talk** on any page or type in Chat. These direct navigation commands work without a model call, including while another request is being accepted:

```text
Nakama, open agent office
Take me to projects
Open chat
Show my task board
Open routines
Open core memory
Open remote desktop
Open location
Open wake word
Show AI usage
Open personal
Open Nakama settings
Open home
```

Ordinary work remains active while you visit another Nakama page or ask a follow-up question. Own-request acknowledgements do not consume final replies; multiple finished replies wait for the microphone/playback to be free instead of replacing each other. **Stop**, backgrounding, connection/pairing loss or removal of access ends spoken follow-up. Opening an Android screen backgrounds Nakama and therefore ends that speech association. Returning later shows saved work without reading old results automatically.

For the phone itself, **“go to Android home”** and **“open Android settings”** use normal Android intents. **“Android back”**, **“show recent apps”** and **“show phone notifications”** require a manually started, visible two-minute phone-control session with Accessibility, Mote, notifications, an unlocked device and Stop. Nakama checks Android's currently available system actions before requesting one. These commands do not read notification contents, grant permissions, tap app buttons or bypass a protected screen. See Android's [global navigation API and availability checks](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#performGlobalAction(int)).

Say **“open app”** followed by an exact installed app name or package, for example **“open app WhatsApp”** or **“open app com.discord”**. Nakama resolves only visible launchable apps, asks you to choose if the label is ambiguous, and reports a missing match. Opening an app does not perform an action inside it. The existing launcher intent query follows Android's [package visibility rules](https://developer.android.com/training/package-visibility/declaring); no broad all-packages permission was added. Windows-only pages requested through the host are reported as such. A navigation receipt is handled only in the direct response to your current request, never replayed from shared message history. Editing a newer draft, opening another page or requesting something else invalidates a delayed navigation receipt without discarding your worker's final reply. An unknown/inaccessible project is rejected instead of opening the previous project.

## Foundations: your new Tools tab

**Tools → Tasks** shows the shared task board. Add/edit a personal card, tick it to cross out its title, or remove the card. Marking a card complete does not stop an underlying agent or delete its project. **Clear completed** removes completed cards only. The PC also manages its scheduled completed-card cleanup.

**Tools → Routines** shows recurring reminders, pending occurrences and phone alarms. Choose a title, time, weekdays and timezone. New routines use this phone's current IANA timezone; changing its travel timezone does not silently reinterpret an existing routine. Pending reminder occurrences can be acknowledged here. Host reminders require the PC scheduler; this version does not run a separate background Android reminder poller.

For **phone alarms**, select Alarm when creating a routine on the phone, allow **Alarms & reminders** in Android, and tap **Sync phone alarms**. This opts this paired phone into subsequent routine sync while Nakama is open. Each assigned alarm reports whether Android AlarmManager registered it, the next scheduled instant, or the permission/error that prevented registration. Saved app-owned alarms are restored after Android boot/time changes. A high-priority alarm notification provides **Stop alarm**; **Silence ringing alarms** stops current sounds without removing future schedules. Sound depends on Android alarm volume, notification-channel settings and Do Not Disturb. Real audible delivery remains unverified. A changed/deleted routine on an offline phone remains at its last synced setting until it reconnects and syncs; the PC cannot silently cancel an unreachable phone's alarm.

**Tools → Remote PC** shows your Windows monitor after you enable remote desktop and this phone's access in Control Center. Tap **Connect to PC**, choose a monitor, then use direct touch/drag, click-mode controls, scrolling, explicit keys or the text field. The image is a bounded JPEG refresh, not a high-frame-rate streaming protocol. Every input is tied to a fresh displayed frame; an image change can require another tap. Stop, leaving the screen or backgrounding Nakama ends the session locally and requests a PC stop. PC expiry remains the fallback if the network cannot deliver that request. The PC displays its own visible Stop/countdown. Protected Windows/Nakama approval screens remain excluded. See [remote desktop setup](remote-desktop.md).

**Tools → Location** shares **this phone's** latest Android-provided coordinates with its own paired PC after an explicit Start and Android location/notification grants. Android may grant approximate rather than precise access; the actual accuracy and observation/receipt timestamps are shown. This uses `LocationManager` without a Google Play Services dependency. Start the visible service while Nakama is open; its notification has **Stop sharing**. Background location is a separate optional Android Settings grant, not a hidden permission. The service never starts automatically on boot. After an initially confirmed consent, a temporarily unreachable PC causes bounded retries while only the latest fix is retained. Revocation, lost Android permissions or changed pairing stops it. Stop in Tools also withdraws PC consent; **Forget saved location** removes the host's last fix. The notification Stop always stops local collection immediately; if the PC is offline its saved consent/last-known fix may remain until you reconnect. A last-known fix is not a guarantee of the phone's present position.

Shared boards, routine receipts, remote desktop and location are hidden or blocked when this device's Google or project access is disabled. Observed revocation also cancels app-owned phone alarms and stops location collection. A revocation made while the phone is unreachable cannot be observed until it reconnects.

## Optional local Nakama wake word

Open **Tools → Wake word → Enable Nakama wake word** and allow microphone/notifications. Android must provide an on-device British English recognizer. Nakama never switches this listener to cloud recognition. A persistent **Stop listening** notification makes the active microphone service visible. Say **“Nakama, show my tasks”**, or say **“Nakama”** and then your command within 15 seconds. Pre-wake recognition is discarded; it is not added to chat or saved. Only the captured command enters the normal local-command/assistant path. Stop invalidates recognition callbacks and any pending wake notification.

Wake listening pauses during Talk, hands-free conversations and spoken replies, preventing Nakama's own voice from becoming a command. It resumes after foreground audio is released. Android's recognizer runs in renewed short sessions; this is **not a low-power hardware hotword detector** and may have listening gaps or use significant battery. The screen reports Enabled, Paused, Off or Unavailable honestly. Recognition errors requiring setup pause listening rather than silently switching providers. Nothing enables wake listening on boot.

While Nakama is foreground, a wake command is handled directly. With the floating Mote visible and the phone unlocked, the service also attempts to open its private command screen. Android may restrict background activity launches; its wake notification then lets you tap to continue. Manufacturer-specific screen-off listening, microphone sharing, battery restrictions and wake responsiveness still need acceptance on the phone and tablet devices. The emulator tests use fake recognizers and never open a microphone.

Use **Talk** in Tools for a single command without leaving its current screen. Supported local voice controls include:

```text
Nakama, show my tasks
Open routines
Connect remote desktop
Switch monitor 2
Type on PC Hello, Mote!
Press Enter on PC
Scroll PC down
Stop remote desktop
Start location sharing
Refresh my location
Stop location sharing
Sync phone alarms
Silence ringing alarms
Stop listening for Nakama
```

Task/routine/core-memory commands and ordinary questions also pass through chat's host command handling. Long AI work receives an interim acknowledgement, while its final response remains tracked separately. “Weather here” or a map lookup uses an explicitly shared last-known fix and displays **Open lookup or map**; opening it is your choice and sends the lookup to the selected website. It does not claim a fetched live weather result. Voice cannot silently grant Android permissions or approve deployments/project deletion.

## What this version actually does

| Feature                   | Included behaviour                                                                                                                                                                                                                                | What still needs work or device testing                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secure pairing            | Paste a short-lived pairing JSON from the PC. HTTPS pins the exact host certificate. A revocable device token is encrypted with Android Keystore.                                                                                                 | Camera QR scanning is not yet included; the desktop QR contains the same JSON.                                                                                                                        |
| Project cards             | Loads real host projects, newest activity first. Create a project folder on the PC and open its chat.                                                                                                                                             | A full file editor and terminal on Android are not included. Use Control Center.                                                                                                                      |
| Project checks            | Review existing npm check scripts, request a run, and read its approval state and recorded result from Projects.                                                                                                                                  | Every run needs approval in Windows Control Center. Dependencies must already be installed. Check-review AI drafts remain a desktop feature.                                                          |
| Chat and AI team          | Automatic chat uses the roles saved in Windows Settings. Project builds plan first, then hand off to development. Advanced provider/model/team controls remain optional.                                                                          | Account login and model access are required. Unknown request patterns remain conversation. A real cross-account build still needs owner testing.                                                      |
| Voice                     | Tap to talk, British English speech recognition, spoken replies, voice preview and an explicitly started hands-free session.                                                                                                                      | Android's engine supplies voices; a female voice is a preference, not something Android consistently labels. Recognition and playback need physical-device testing. Optional local wake listening is described under Tools below. |
| Calls                     | Understands `call Mike` and `call +44…`, resolves contacts with an explicit chooser when ambiguous, and starts Android's call action after Phone permission.                                                                                      | A started call is not reported as answered. WhatsApp calling by contact name is not yet implemented.                                                                                                  |
| Messages                  | Understands `message Nayan on WhatsApp Hello`, `message Mike on SMS Hello` and `text Mike: Hello`; resolves a number and opens the exact draft.                                                                                                   | You must tap Send. Automatic sending and Discord username resolution are not implemented.                                                                                                             |
| Contacts                  | Searches matching names after Contacts permission.                                                                                                                                                                                                | Ambiguous contacts are not silently selected.                                                                                                                                                         |
| Gmail and Google Calendar | Personal tab selects separate Google accounts, searches email snippets, lists calendars/upcoming events, and sends explicitly composed email or creates an event through your PC.                                                                 | Connect Google accounts on the desktop first. Natural-language date resolution, email attachments and invitations are not implemented. Live accounts need your own validation.                        |
| Local calendar draft      | Opens a populated event draft, letting you choose the correct personal account in the phone's calendar app.                                                                                                                                       | You must save this local draft. Use Personal for the Google API operation.                                                                                                                            |
| App launching             | Opens an installed app by package name.                                                                                                                                                                                                           | Opening an app does not mean an action inside it completed.                                                                                                                                           |
| Optional accessibility    | Explicit bounded screen-label reads, tap, type, scroll and back actions within a manually enabled, two-minute session for one named app. Password/authentication/payment controls are excluded; publishing and project deletion taps require you. | No autonomous app navigation planner or screen-streaming feature. Safety labels depend on the app exposing accessible information. App layouts vary and real-device validation is required.           |
| Mote mascot               | Original animated blue companion. Home/Device expose permission setup, status and Hide. Drag to move, tap to talk, hold to stop.                                                                                                                  | Permission-return/start/hide tested on Android 16 emulator; battery, gesture and overlay behaviour still need physical-device validation.                                                            |
| AI usage                  | Read-only provider cards with remaining Codex allowances, timestamps and reset times when reported.                                                                                                                                               | Claude percentages are unavailable. Codex quotas do not include every ChatGPT app/media limit.                                                                                                        |
| Home widget               | Add the Nakama widget for one-tap chat or voice entry.                                                                                                                                                                                            | It opens the app; it does not listen in the background.                                                                                                                                               |
| Remote connectivity       | HTTPS works with a reachable private VPN or LAN address.                                                                                                                                                                                          | You must configure the private network and keep the PC awake. No cloud relay or public exposed host is provisioned.                                                                                   |

## Request a project check from your phone

1. Open **Projects** and choose **Project checks** on the project's card.
2. Choose **Refresh checks**. Nakama reads the project's root `package.json` on your PC.
3. Read the main script and any matching pre/post scripts. Choose its request button, such as **Request test approval**.
4. The request waits for you in Windows Control Center's **Activity & approvals**. Nothing runs until you approve it there.
5. Keep the checks screen open and choose **Refresh results** to follow that request and any resulting task. An approval being started is not proof the check passed; read the task's status, exit code and output.

This supports the exact names `test`, `lint`, `typecheck`, `check` and `build`. A new README-only project has no checks yet. If the project or its scripts change, refresh the list and review a new request. The PC must be awake and reachable.

The request receipt is temporary. A minimal reminder survives a connection drop, but leaving the screen, switching projects, changing pairing or changing permissions clears it; revisiting still shows the project's available task history. Check pending approvals on your PC before making another request. If a request times out, its outcome is unconfirmed: Nakama does not retry it automatically, because the PC may already have received it. Clearing a local reminder does not cancel an approval or stop a task.

The phone needs project access. Shared task and approval history also requires that device's Google access setting because those records can contain private account data. Turning that access off hides the shared history; it does not silently grant permission or restore cached output. Manage device permissions on the PC.

Check scripts run under your Windows account and can change files or use other programs. Read the full approval before allowing them. The phone cannot approve deployments, deletion or check execution. See the [project-check guide](project-checks.md) for the development cycle and its limits.

## Install your locally built APK

1. Build your own debug APK using [Android verification](../apps/android/VERIFICATION.md). No prebuilt APK is supplied with this source release.
2. Transfer your locally built `apps/android/app/build/outputs/apk/debug/app-debug.apk` using a trusted method, such as USB. Verify the signing identity before updating any existing installation.
3. Open it on Android. If Android asks, allow the particular file manager to **install unknown apps**.
4. Install **Nakama**, then open it.
5. You can turn the file manager's install permission off again afterward.

The development APK is debug-signed. Keep the same signing key for future updates. An APK signed with another key cannot update that installation; preserve its data and key instead of uninstalling to bypass the mismatch. A release signing key and update distribution flow should be established before treating this as your long-term daily app. The repository never contains private signing keys.

## Pair the phone with your PC

1. Open Nakama Control Center. Finish first-run setup and select your development folder.
2. Enable **Allow paired devices over a private network** in Settings. Use **Quit Nakama and disconnect devices** from the Windows tray, then reopen Control Center. Closing the window alone usually leaves it running.
3. Connect the phone and PC to your chosen private network. For mobile data, use the private VPN addresses from your VPN app.
4. In Control Center, open **Devices → Pair a device**.
5. Enter a clear name such as `Android phone` or `Android tablet`.
6. Choose the PC's detected Wi-Fi/Ethernet address for your home network, or enter its private VPN HTTPS address for mobile data. Avoid virtual-machine adapters. **Check network again** refreshes the desktop's actual listener and addresses. `localhost` refers to the device itself and cannot reach your PC from your phone; both updated apps explain this before pairing. A detected address does not guarantee Windows Firewall or the network permits the connection.
7. Copy the **pairing information**. It is JSON with the URL, ticket, expiry time and certificate fingerprint.
8. In Android, open **Device**, paste it into **Pairing JSON from your PC**, and tap **Pair securely** before the ticket expires.
9. Confirm that the host name and device appear in Control Center.

Treat the pairing ticket like a temporary password. It can be used once. The app checks the pinned certificate **before sending the ticket**. A changed certificate requires new pairing; the app never has a “trust any certificate” mode. Do not expose port 43110 through public router port forwarding.

Pair each device separately. A phone's token cannot become a desktop administrator or approve deployments. You can immediately revoke a device from Control Center. **Forget this PC** on Android removes the local token; use the desktop's remove-device control to revoke that token at the host too.

## Start a project and chat

- Open **Projects → + New**, give the project a name and an optional description, then create it. The PC creates the directory under its chosen workspace.
- Tap a project card to start a conversation scoped to it.
- Choose the AI provider, an available model or exact model ID, and an effort level. Leave the model blank to use the account default.
- Enable **Team mode** to submit the same request to all configured AI providers. Each uses its saved model. Provider setup errors are shown; disconnected accounts are not presented as successful runs.
- Type a request and tap **Send**, or use **Talk**.
- Choose **Discuss** for conversation, **Do a task** for the host's supported project/Google/phone tasks, or **Build project files** when a project is selected. Task mode uses the host's bounded planner and permission checks; it does not imply arbitrary autonomous control of every app. Building uses contained file writes. Neither mode approves raw commands, deletion or deployment.
- Watch running output and tap **Stop task** if necessary.
- Approve deployments, deletion and raw commands only in the desktop Control Center.

The `xhigh`/`max` effort options are advanced provider values, not a promise that every model supports them. Nakama's host validates/translates supported choices. If a provider rejects an effort level, select a supported level. Existing subscriptions and separately billed API access remain distinct.

## Voice and British female speech

The no-extra-spend configuration uses Android's installed speech services. Nakama does not connect to a paid voice API.

1. Open **Device → Your British English voice**. The status tells you whether an installed offline `en-GB` voice is ready.
2. Choose a voice, then tap **Preview voice**. Changing the selection does not play audio. Use **Stop voice** to stop the sample, and choose **Slower**, **Normal** or **Faster** to set its speed. These preferences are saved on this device.
3. Preview the available voices to find a female-sounding British voice you like. Android does not reliably label gender, so Nakama does not guess from the voice's name.
4. If none is usable, choose **Android speech settings** and install English (United Kingdom) voice data through your chosen Android engine. Return and tap **Refresh voices**. Voices needing internet or a download are shown as unavailable and are not silently selected.
5. Leave **Read replies aloud** enabled to hear new assistant replies. In **Chat**, tap **Talk** and grant microphone access when asked. Recognition submits the completed text to the chosen AI or supported local phone-command handler. If the permission result asks you to return, tap Talk again when ready.

Under **Microphone recognition**, Nakama reports the available route. It prefers Android's on-device recognizer. If that is unavailable, you can type, install/configure offline recognition in **Android voice input settings**, or explicitly enable **Allow Android recognition service**. That optional system service may send audio to its provider and use your data connection; the offline preference is not a guarantee. A recognition error never silently switches to that service or a paid API.

**Hands-free** starts a foreground conversation session. After a spoken reply finishes, Nakama listens for the next turn. It stops if the app leaves the foreground, an error occurs or you tap **Stop**. A stopped recognition result cannot submit a later message, and finishing a preview cannot restart a hands-free session. An already-pending host refresh cannot restart speech after Stop or backgrounding. **Read replies aloud** remains a separate preference for future replies; turn it off to mute those too. The separate opt-in Tools wake listener pauses while this conversation owns audio.

Offline availability is reported by your chosen Android engine, not independently audited network isolation. Voice data, recognition support and sound quality still need testing on both physical devices.

## Gmail and Google Calendar on your phone

1. In **Control Center → Connections**, connect your personal Google account with Gmail and/or Calendar access. Follow [Google account setup](google-accounts.md). You can connect more than one Google account and choose the identity used for each action.
2. On Android, open **Personal**. Choose the exact account shown by its email address. No Google passwords or refresh tokens are copied to Android.
3. Choose **Mail**, optionally enter a Gmail search such as `is:unread`, then **Read mail**. Up to ten messages appear with sender, subject, date and snippet. Email text is treated as content and never as authorisation to perform actions.
4. Choose **Calendar → Choose from my calendars** to load the list, select a calendar, then **Upcoming events**. The host returns up to 25 upcoming events. Dates include the timezone offset where available.
5. For a message, tap **Write email** and compose one recipient, subject and exact message. Check the displayed sending account, then tap **Send email**. For an event, select the right calendar, tap **Add event**, and enter explicit start/end times including timezone. Tap **Create event** after reviewing it.

If the desktop's ordinary-action confirmation is enabled, the request waits for desktop approval. Otherwise the host submits it immediately. A successful email result means Google accepted the message, not that the recipient read or received it. A successful event result means Google returned confirmation of creation. Forms do not send invitations or attachments.

If a connection fails during submission, **check Sent mail, Calendar and desktop approvals before submitting again**. The Android app never automatically retries an email or event write. Keep the app open until the result appears. Drafts and snippets are held in memory, so leaving this screen, rotating or restarting can discard them.

If you see a Google permission error, check **Control Center → Devices** for this device's Google access setting and reconnect the account with the necessary Gmail/Calendar scopes. The phone cannot override those desktop restrictions. This Google feature needs no Contacts, SMS or local calendar permission on Android.

## Project planning, questions and handover

Automatic project builds use the team roles configured on your PC. Your manager coordinates two planners, asks the combined questions, sends the agreed tasks to the development workers, and obtains both reviews before handing the result back. Android shows the current stage, review round and full saved plan in a project workflow card in Chat. The role names remain configurable; model/account availability is checked on the PC.

When **Your manager has questions** appears, fill in every displayed answer and choose **Send answers to manager**. Each answer accepts up to 6,000 characters. Development waits for the required answers. A workflow started on this phone can also be stopped from its card. Workflows started on another device must be answered or stopped there or on the PC. Both Google access and project access must be enabled for the phone to see these cards. Removing access clears the forms and their unsent drafts.

Your own active workflow uses the existing faster foreground polling. Its initial acknowledgement, the manager's questions and final handover can be spoken while this foreground interaction remains active, including after a follow-up utterance or a visit to another Nakama page; intermediate planner, worker and review output is not spoken. Stop, leaving the foreground or losing access clears that speech association. Returning later shows the saved workflow without automatically reading old replies. The app does not silently resubmit answers after a network error: check the current workflow on the PC before trying again.

## Everyday phone actions

Open **Device → Phone tools** for direct actions. These tools also provide the execution layer for explicitly queued actions from the paired desktop.

**Call:** supply a full phone number, grant Phone permission and tap Place call. Only ordinary numbers are accepted; dialler control codes are excluded. The result means Android accepted the call request, not that the recipient answered.

**SMS or WhatsApp:** provide the recipient's international phone number and your exact message. Nakama opens a draft and reports `needs_user`. Review it and tap Send. It never claims a draft has been sent.

**Find contact:** allow Contacts and search a name. Matching names/numbers are shown; Nakama does not guess between several people. A desktop-requested search sends only these requested results back to your own host.

**Calendar:** enter an event title and explicit start/end timestamps, including the timezone offset, such as `2026-09-30T14:00:00+01:00`. Nakama opens a calendar draft. Select your personal calendar account and save. The result remains `needs_user` because saving has not been verified.

**Open app:** enter an Android package name such as `com.whatsapp` or `com.discord`. Nakama launches it if installed. This does not automatically send a message or initiate a WhatsApp call.

You can type or speak these direct commands in Chat, even without a PC connection:

```text
Nakama, call Mike
Call +44 7700 900123
Nakama, message Nayan on WhatsApp I'll be there at eight.
Message Mike on SMS Running ten minutes late.
Text Mike: Please call me when you're free.
Open WhatsApp
Open Discord
Open Gmail
Open Calendar
Open Chrome
```

Names use your device contacts. A single exact contact name can be used directly; partial names, several matches or several numbers present a recipient chooser. If contacts access is denied or no match is found, nothing is called or sent. Supply an explicit number or enable Contacts and try again. With **Confirm ordinary phone actions** enabled, these local commands also show a preview before execution. Local tool conversations are kept in memory on Android for that session; they do not silently call an AI provider.

“Message john2000 on Discord” and “call Steve on WhatsApp” produce an explicit explanation of what is not implemented. A WhatsApp call request never falls back to a cellular call. This first build does **not** yet resolve every natural-language request into a verified multi-step action. Review message drafts and use the target app to finish actions it cannot perform yet.

## Permissions and the mascot

Permissions are requested when needed. Denial leaves the rest of the app usable.

| Android permission      | Why Nakama requests it                                          |
| ----------------------- | --------------------------------------------------------------- |
| Microphone              | A voice session you start.                                      |
| Phone                   | Place a normal phone call after an explicit request.            |
| Contacts                | Search people by name when requested.                           |
| Notifications           | Keep mascot and phone-control stop controls visible.            |
| Display over other apps | Draw Mote, the draggable companion.                             |
| Accessibility service   | Optional app-specific taps, typing, scrolling and back actions. |

The app does not request SMS send permission or broad local calendar write permission. Local SMS/calendar tools open drafts. The separate Personal tab uses the host's authorised Google API connection.

To show Mote, open **Home → Enable floating mascot** (also available under **Device**). If Android opens special permissions, enable **Display over other apps**, then return to Nakama. Allow notifications when asked. It starts without a second Enable tap. Drag Mote to reposition it, tap to talk, or hold and release it to stop the mascot and control session. You can also use **Hide**, or **Stop mascot & control** in the persistent notification. Nothing starts automatically on boot.

To add the home widget, long-press a free area of your launcher, choose **Widgets**, then drag the **Nakama** widget onto the home screen. **Talk** opens Nakama and starts an explicit voice conversation after microphone permission; normal widget taps open chat. No provider/model selection is required. Listening resumes after spoken replies while the hands-free session is active. Changing tabs with the navigation bar stops microphone/playback; pending own-request replies remain eligible while Nakama stays foreground. **Stop** or backgrounding ends spoken follow-up. First pairing and a usable installed speech service are still required. Read [automatic roles, usage and voice](automatic-assistant.md).

## Optional control inside another app

This is a private sideloaded app with a user-controlled accessibility service. Android still controls which screens are accessible. Nakama does not bypass lock screens, biometrics, passwords or system permission prompts.

1. Read the **Visible phone control** description in Device.
2. Open **Accessibility settings**, select Nakama and explicitly enable its service.
3. If Android restricts a sideloaded app's accessibility settings, inspect **App info → menu → Allow restricted settings** if your firmware offers that option. Only do this for the APK you built and trust. This is a user decision in Android, not a setting the app can silently enable.
4. Enable notifications and start the mascot.
5. Enter the exact target app package, for example `com.whatsapp`.
6. Tap **Enable control for 2 minutes**, then open the target app. If Mote is still starting, wait until it is visible and tap Enable again.
7. Only explicit structured `ui_read`, `ui_tap`, `ui_type`, `ui_scroll` or `ui_back` jobs assigned to this paired device are accepted during that session.
8. Blue edges show the active session. A blue cursor briefly marks the requested tap, typing field or scroll area. The floating **STOP** button includes the remaining seconds and ends control immediately; the indicator passes other touches through to the app. The Device tab shows the selected package, countdown and last action category, without echoing typed text.
9. Stop using the floating button, the notification, by holding Mote, or in Nakama's Device tab. The session also expires automatically. A locked phone, lost notification/overlay access or a stopped mascot ends the session. An old in-flight request cannot gain authority from a new session, even for the same app. Stop prevents subsequent actions; it cannot undo a tap or text change Android already accepted.

Actions must target the allowed package and its foreground window. The entire screen is blocked if it contains a password field or visible authentication/OTP/payment hints. Protected Android settings/system screens are excluded. Overly complex screens are refused rather than partially inspected for sensitive controls. Text labels must match exactly and unambiguously. Coordinate taps must be inside the screen and overlap a visible accessible clickable control. `ui_type` only uses a focused editable non-password field. Accepted UI gestures report `started`, because the remote app's resulting state is not yet verified. No webpage, email or app text grants additional permission.

`ui_read` sends at most 80 visible controls to your own PC, with labels/descriptions up to 160 characters, roles, bounds and basic control flags. Editable field values are omitted; unlabelled code-like numeric strings are suppressed. It does not send screenshots or video. Its structured JSON result and timestamp are retained in the local action receipt, so a lost acknowledgement re-sends the same observation without rerunning the action. Screen labels are untrusted data, and the feature does not itself launch an AI app-navigation loop.

Visible deployment, publishing and project-deletion labels block automated taps across that screen, including coordinate taps. There is no `force` argument or phone override. Use the desktop approval flow for managed Nakama projects, or review the external app yourself. These checks are conservative label heuristics: arbitrary apps can hide or mislabel controls, and coordinate targets can change after inspection. They do not establish that every external app action is safe or that an accepted gesture succeeded. Only start a session for an app/task you actually intend to control.

Ordinary phone actions poll while Nakama is open. Accessibility jobs are polled by the mascot's visible foreground service while a control session is active. This is not an invisible permanent remote-control service. Android battery management, manufacturer firmware and app-specific UI changes still need practical testing on both devices.

This provides visible, scoped phone interaction. It does not stream the phone's screen or grant unrestricted system access. Streaming the phone's screen would need a separate implementation and Android's consent for each capture session; see [MediaProjection consent](https://developer.android.com/media/grow/media-projection#user-consent). Tools → Remote PC instead receives your Windows monitor. The phone indicator uses Android's [accessibility service overlay and gesture APIs](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService). The verified emulator fixture (private fixture image omitted) contains only test controls, with no personal app content. Physical Android 16 acceptance remains pending on both devices.

## Build it yourself on Windows

Prerequisites: JDK 17, Android SDK platform **android-36**, Build Tools **36.0.0**, and internet for any uncached dependencies. Android Studio is a convenient way to install these.

From PowerShell in `apps/android`:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

Adapt `JAVA_HOME` to your JDK installation. The checked-in Gradle wrapper pins Gradle 8.14.2. Android Gradle Plugin is 8.10.1 and Kotlin/Compose compiler are 2.1.21.

The APK is written to:

```text
C:\Projects\Nakama\apps\android\app\build\outputs\apk\debug\app-debug.apk
```

Unit-test results are under `app/build/reports/tests/testDebugUnitTest`. Lint results are under `app/build/reports/lint-results-debug.html`. Build directories, local SDK configuration and signing secrets are ignored by Git.

## Troubleshooting

| Symptom                                   | What to check                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pairing ticket expired                    | Create a new ticket and paste it before the expiry shown on the PC.                                                                                                                                                      |
| Certificate mismatch                      | Confirm you are connecting to your own PC. Create fresh pairing from that PC if its certificate was intentionally replaced. Never disable certificate checks.                                                            |
| Offline on mobile data                    | Both devices must be on the private VPN, the PC awake, the private listener enabled and the firewall configured for your intended private network.                                                                       |
| PC works locally but phone cannot connect | `localhost` is the phone itself. Use the PC's reachable LAN/VPN address and verify port 43110 is allowed on that private network.                                                                                        |
| Phone removed from desktop                | Pairing was revoked. Create a new pairing ticket if you want to authorise that device again.                                                                                                                             |
| Voice does not respond                    | Check microphone permission, installed recognition service, British English voice data and the Read replies aloud setting.                                                                                               |
| No contact or several matches             | Check Contacts permission and specify a clearer name or explicit number.                                                                                                                                                 |
| WhatsApp/Discord workflow not completed   | Drafts and launches are not completed messages. Use the app to finish; autonomous app-specific workflows remain future work.                                                                                             |
| Mascot stops                              | Check its notification and Android battery settings. Start it again from the foreground app. Nakama intentionally does not restart it without your action.                                                               |
| UI job refused                            | Ensure the accessibility service is enabled, the two-minute session is active, the exact allowed app is foreground and no protected/password screen is present.                                                          |
| Host response is too large                | Very large shared histories can exceed the Android client's response limit. Use Control Center to inspect the project; paginated Android history is not implemented yet. Do not delete app data just to hide this error. |

## Verification notes

Read [Android verification](../apps/android/VERIFICATION.md) for the current aggregate checks, reproduction commands and remaining physical-device acceptance. Private fixture images and historical installation records are not included in this source snapshot.
