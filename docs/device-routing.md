# Choose where Nakama responds and acts

Update Control Center and every Android companion together. Each pairing has its own device identity. Give devices distinct names in Control Center's **Devices** page and use those complete names in requests.

## Default: the device you are using

A request from your phone returns chat, spoken replies and ordinary request notifications to that phone. A tablet request returns them to that tablet. The PC owner can still inspect recorded work; inspection does not make the PC or another phone speak or execute it. Required PC approvals retain their owner review path.

Without a named destination, opening an Android app or starting a timer stays on the requesting device. Local greetings, time/date and supported timers do not call an AI model. Local countdowns are separate from shared project history.

Examples, with paired devices named **My phone** and **Kitchen tablet**:

- On My phone: **“Open Netflix”** opens the phone's installed Netflix app.
- On My phone: **“Open Netflix on Kitchen tablet”** queues that exact installed app on Kitchen tablet; its result returns to My phone.
- On Kitchen tablet: **“Set a 10 minute timer”** creates a tablet timer.
- On My phone: **“Set a 10 minute timer on Kitchen tablet”** sends the timer to Kitchen tablet. Its completion rings there.

A remote app or timer requires a currently connected, permitted target. App commands also require its fresh installed-app catalog. An unknown, ambiguous, offline or revoked destination produces an error; Nakama does not substitute the source phone or send to all devices. Opening an app does not authorize actions inside that app. Existing Android permissions, lockscreen rules and visible phone-control requirements still apply.

## Alarms on one or several devices

Open **My clipboard → Routines board** on Windows or **Tools → Routines** on Android. Select **Alarm**, enter the time, one-time date or repeat days, and timezone, and choose each phone/tablet that should ring. Android initially selects the device you are holding; the PC requires you to select a destination. Use a Reminder for a PC notification: this preview has no Windows wake-from-sleep alarm service.

Chat alarms default to a single occurrence; a repeat requires an explicit instruction. The host owns the saved alarm, and each assigned Android schedules its own occurrence after permission and sync. A bare **“Set an alarm”** asks for a time and accepts a short answer on that same device.

You can also say **“Set a morning alarm at 7 am on Kitchen tablet”** or **“Set a morning alarm at 7 am on My phone and Kitchen tablet”**. Use the picker if names are ambiguous. Selected alarm devices can be offline while the saved change waits for their next sync. Each destination has its own scheduling receipt. One device reporting **scheduled** does not establish that the other device is ready.

On every selected Android device, allow notifications and **Alarms & reminders**, then open Nakama and use **Sync phone alarms**. The app registers only alarms assigned to that device, including when the requester can inspect a remote alarm. A schedule edit invalidates previous confirmations. Check all selected devices after editing or removing an alarm: an offline device retains its last local schedule until it reconnects. See [alarm setup](android-guide.md#foundations-your-new-tools-tab) and [Clock timers](clock.md).

## Wake word on nearby devices

Pairing identity prevents a request accepted by one device from being broadcast as another device's reply or action. If two microphones independently hear “Nakama,” they can still create two separate requests. This preview has no room-wide microphone arbitration. Use Talk or enable wake listening on one nearby device when testing which device heard you. The [Android wake setup](android-guide.md#optional-local-nakama-wake-word) includes readiness and repeated-listening-sound troubleshooting.

## Browser tabs

Reload the updated unpacked extension, pair it if needed, and select **Enable all ordinary tabs**. Accept Chrome's website-access grant once. The two-hour browser session includes existing, new, reloaded and navigated ordinary HTTP(S) tabs without per-tab prompts. **Stop browser control** stops the whole session. Protected/private/browser-settings pages remain excluded; screenshot capture still requires the requested tab to be visible in the focused window. See [extension installation and limits](chrome-extension.md).
