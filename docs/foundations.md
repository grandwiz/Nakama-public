# Your clipboard, routines and Core Memory

Nakama now has shared personal tools alongside its project workspace. On Windows, open **My clipboard** for the task and routine boards, **Core Memory** for your saved preferences, or **Devices** for location and remote desktop. On Android, open **Tools**. These tools use your existing private, certificate-pinned PC connection and pairing.

## Tasks and progress

New assistant jobs appear automatically on the task board. A managed Astra/Fable/Opus project has one card for the whole workflow; its individual workers remain in the activity history. You can also add a personal task without starting an AI job.

Completed cards are crossed out. Once each host calendar day, completed cards from earlier days are removed. If the host was asleep, the next startup catches up. **Clear completed** does this immediately, and individual cards can be removed whenever you want. Removing or ticking a board card never deletes a project or changes the actual worker's completion state. The source status remains visible, and removed cards do not reappear on the next refresh. Completing or reopening a routine card acknowledges or reopens its existing due reminder; it never reschedules or retriggers an alarm.

Use **View progress** on a project card, the project manager panel, or ask “what are you working on?” to read real running and waiting states. Supported board/status commands are handled locally without a provider call. Other accepted requests get a quick queued acknowledgement while the configured AI starts; an acknowledgement is not a finished answer. Real model response time still depends on the official CLI, your account and the request. No near-instant model latency has been measured for this release.

Ordinary short conversation uses the separate **Fast Nakama interaction** assignment, Astra 6 at low effort by default, including with a project selected. Detailed conversation/planning/research keep their saved roles; implementation uses the managed project pipeline. Explicit provider overrides remain available. Open **Agent office** to see the manager and actual workers as named green GPT/orange Claude mini Nakamas with selectable screens. The [office guide](agent-office.md) explains the fast front-facing role and navigation; the [project workflow guide](project-workflow.md) covers dual planning, questions, Opus workers and independent reviews.

## Routines and alarms

Add a name, time, repeat days and time zone on the routines board. Use **Reminder** for the requesting device by default or **Alarm** with one or more selected Android devices. On the PC, an unassigned reminder stays on this PC; alarms require explicit destinations. Pause, edit or remove a routine from either permitted app. The host stores the routine immediately; an alarm also needs the target phone to register its schedule with Android.

The host checks routines while running and records a due reminder on the task board. It catches up with at most the most recent missed occurrence per routine, rather than creating an entire backlog. Repeat times use the saved IANA time zone, such as `Europe/London`. A nonexistent time during the spring clock change is skipped; the first instance of a repeated autumn time is used once.

Android synchronises routine changes while connected and schedules app-owned alarms. Grant notification and exact-alarm access when asked. Each selected phone/tablet independently reports **scheduled**, **permission required**, **failed** or **cancelled** against the specific routine version. Editing the schedule invalidates the old receipt. A successful registration is evidence of a scheduled alarm, not evidence that it actually sounded. An offline phone cannot receive edits/removals until it reconnects; previously scheduled local alarms may still fire. Check every selected device's status after changing an alarm. See [device targeting examples](device-routing.md).

Routines currently produce reminders/alarms. They do not schedule automatic purchases, messages, calls, deployments or arbitrary device actions. A routine saved in Core Memory is only a personal note; it does not create an alarm.

## Voice commands

Android typed and spoken commands use the same host routes. Examples:

- “Nakama, add task buy oat milk.”
- “Show my tasks.” / “Complete task buy oat milk.” / “Clear completed tasks.”
- “Add routine morning stretch at 7:30 am on weekdays.”
- “Set a morning alarm at 7 am on weekdays.”
- “Pause routine morning stretch.” / “Remove routine morning stretch.”
- “What are you working on?”
- “Show my core memory.” / “Nakama personality: Keep replies playful and practical.”
- “Find my phone.” / “Weather here.”

Use exact saved titles for completion, removal and time changes. If several cards have the same name, Nakama asks you to choose the exact card instead of guessing. The Android Tools screens also handle local voice navigation for location, wake listening and remote desktop. Android permission prompts still require the device owner's interaction.

## Wake word

Enable **Nakama wake word** on Android to start its bundled offline English recognizer with an ongoing notification and Stop. First use prepares model files already in the APK; there is no Android model download or cloud recognizer fallback. Wait for **Microphone ready**, then say “Hey Nakama” followed by your request. Only exact recognised utterances beginning with “Nakama” or “Hey Nakama” start command handling. It pauses around ordinary voice input and spoken responses, and reports preparation, unavailable, paused and error states.

This uses continuous local decoding within Nakama, not a dedicated low-power hotword chip or the Android `SpeechRecognizer` service. Recognition accuracy, battery use and manufacturer service restrictions need physical tests on both devices. Nakama cannot promise uninterrupted 24-hour listening after force-stop, restart, microphone denial, battery restrictions or device shutdown. Where Android blocks opening the command activity from the background, a notification tap is required. Existing widget Talk, mascot Talk and foreground voice remain available. See [Android setup](android-guide.md).

Primary references: [foreground-service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [Android 16 service behaviour](https://developer.android.com/develop/background-work/services/fgs/changes), and [alarm scheduling](https://developer.android.com/develop/background-work/services/alarms).

## Own-device location

Enable location sharing on the intended Android device. Nakama uses Android's platform LocationManager, without adding a Google Play Services dependency. A visible foreground service requests location fixes and sends the latest valid coordinates, observation time and accuracy to the paired PC. It retains a latest fix, not a movement history. Stop from the phone, or **Forget location & stop sharing** on Windows to revoke consent and erase the host's saved fix.

Windows **Devices → Find my devices** displays last-known coordinates with observed/received times and accuracy; older fixes are clearly stale. Location cannot stay live while the phone is off, lacks permission or signal, or cannot reach the PC. Network reconnection and actual GPS accuracy remain physical acceptance checks. The service does not silently restart after reboot or force-stop.

**Open map** deliberately opens the saved coordinates in OpenStreetMap. “Weather here” returns an explicit location-based lookup link with the saved fix's timestamp; Nakama does not invent current weather or send every location update to an AI/weather provider. Opening a map or weather link shares the coordinates with that service. Unrelated conversation does not include location.

Location permission is granted on the phone. A phone can upload only its own location and retrieve only its own record; the desktop owner can see paired-device records. Revoking pairing or shared access clears host location consent and cached coordinates. Google-disabled and project-disabled devices cannot use shared boards, Core Memory or location sharing; their existing privacy restrictions also cover remote desktop.

## Core Memory

Core Memory contains editable local preferences, self-described traits, routine notes and Nakama personality instructions. Nakama learns from supported first-person statements and explicit “Remember that…” requests, with a saved-note receipt. There is no extra model call to learn a note and no hidden personality inference or model training.

Use the Windows or Android editor to add, correct or forget individual notes. Pause **Remember preferences I share in conversation** to stop new automatic capture. Turn conversation memory off to pause both learning and reuse. Saved notes stay editable while paused. Forgetting a note does not erase past conversation or information already sent to an AI account. Notes are context, never permission to act; credentials are rejected.

The current store holds up to 50 notes of 500 characters, and up to the latest 12 notes can be included in relevant conversation. This is a visible foundation for personalisation, not an unlimited autobiographical memory or learned personality model.

For reusable ways of doing things, use **Learned skills**. Teach an explicit method or review a candidate saved from successful project work. Relevant ready methods can be supplied to the fast assistant and project agents, with their source and selection history. Learning and reuse can be paused independently; conversation memory off pauses both. Skills never grant action authority. See [the learning guide](learned-skills.md).

Remote desktop has its own [setup, touch controls and acceptance guide](remote-desktop.md). All new physical microphone, wake-word, GPS, alarm and touchscreen behaviours remain unaccepted until tested on the owner's devices. Existing accounts, projects, pairing and Android signing identity must survive updates.
