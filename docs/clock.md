# Clock and timers

Nakama includes a clock and one-shot countdown timers. Basic greetings, current time/date questions and supported duration-timer commands are handled locally without starting an AI provider. Android answers using that device's clock, so these requests work without a paired PC connection. This removes the host/model round trip; speech recognition and voice playback still depend on Android's engine.

## Windows Control Center

Open **Clock** to see the PC's local time and create a named countdown. You can also type “set a 10 minute timer” or “what time is it?” in Assistant. Pause, resume or cancel running timers, and dismiss a finished timer in Clock.

PC timers are saved on the Windows host and use its clock. Keep Nakama running and the PC awake to receive the notification at the deadline. If Nakama was closed or the PC asleep, an elapsed timer appears finished when the host next runs; this is not a Windows wake alarm. Timer completion appears in Nakama's attention notifications. Notification delivery and sound depend on Windows settings.

## Android phone or tablet

Open **Tools → Clock**. Timers created here, or by saying “Nakama, set a 10 minute timer”, belong to this device and use Android's local alarm scheduler. They do not create a second PC timer and do not require a provider account. Pairing and shared-tool access are not required for these local timers.

Allow **Notifications** and **Alarms & reminders** when prompted. Check the Nakama timer notification channel and alarm volume in Android Settings. A timer is only reported as started after Android accepts its schedule. If permission is missing, the timer stays paused with a “not scheduled to ring” explanation. Use **Allow notifications**, **Alarms & reminders** or **Timer alert settings**, return to Clock and tap **Resume** on that timer. Do not create a duplicate. Android's general app permission screen does not include every special-access switch.

Use Clock to pause, resume or cancel a timer. Dismiss its completion notice when finished. Running timer state survives app restarts; Android reschedules saved timers after reboot. Force-stop prevents Android receivers from running until you reopen Nakama. Battery restrictions, notification settings and manufacturer firmware can affect delivery, so verify one short timer on each device before relying on it.

Voice requests receive a spoken result; typed requests receive silent text. Wake mode can handle these local requests without connecting to the PC. Recurring alarms and reminders remain in **Routines**; creating a countdown does not alter them.

## Scope and troubleshooting

Use a clear duration such as “set a timer for 10 minutes”. Ambiguous or unsupported phrases must not be treated as a successfully scheduled timer. Check Clock for the actual timer before repeating a request after an uncertain result.

The Windows and Android lists are separate because each device schedules and delivers its own timer. Android's direct local path uses its own clock, regardless of the paired PC's timezone. Changing the device's date/time is not a timer control; use the timer buttons.

All verification uses disposable state, synthetic provider responses and an emulator. It does not establish audible notification delivery or exact background timing on a physical phone or tablet.

## Choosing the device

An unnamed timer stays on the requesting device. Append an exact paired name, for example “set a 10 minute timer on Kitchen tablet,” to send it there; the queued/result reply stays on the requester while the countdown rings on the destination. An unavailable or ambiguous device is rejected without local fallback. Remote timer dispatch requires the destination to be connected and able to process its action inbox. Repeating alarms use the Routines board and can select several Android destinations, each with its own schedule confirmation. See [device routing](device-routing.md).
