# Talk to Nakama, choose your team once

The default conversation no longer asks you to select an AI, a model or a working mode. Open **Assistant** on Windows, **Chat** on Android, or tap **Talk** on the home-screen widget. Describe what you want. Existing accounts and permissions are still required.

## Your saved roles

Open **Windows Settings → AI roles** to change the assignments. Each role has an AI choice, with its exact model and effort under **Model & effort**. Click **Save AI roles**; the choices apply to new automatic requests from both PC and phone. Existing conversations and running jobs are not restarted. **Restore suggested roles** prepares the defaults below; save to apply them.

| Work                                       | Suggested AI | Model and effort |
| ------------------------------------------ | ------------ | ---------------- |
| Fast Nakama interaction                    | ChatGPT      | Astra 6, low; separate configurable role |
| Planning and design                        | ChatGPT      | Astra 6, Ultra   |
| Development                                | Claude       | Opus 4.8, Ultracode requested; restricted xhigh worker |
| Deeper conversation                        | ChatGPT      | Astra 6, Ultra   |
| Research                                   | ChatGPT      | Astra 6, Ultra   |
| Image ideas and generation prompts         | ChatGPT      | Astra 6, Ultra   |
| Everyday tasks, such as email and calendar | ChatGPT      | Astra 6, Ultra   |
| Technical override/fallback preference     | Claude       | Opus 4.8, max    |

These are requests to your existing subscription clients, not an entitlement upgrade. The actual account must support the model and effort. An unavailable model produces an error; Nakama does not select a paid API or another model automatically. Role preferences are separate from the older per-provider preferences used by manual chats and manually selected teams.

Automatic standalone technical discussion stays with your chat manager, and standalone run/test requests use the general-task manager. The saved technical preference remains available to explicit Claude overrides. Managed project implementation uses the development workers, with a separately configurable Fable co-planner/reviewer. See [the project team guide](project-workflow.md) for the full role settings and Ultracode limit.

## Faster everyday replies

**Settings → AI roles → Fast Nakama interaction** is the separate user-facing assignment. It starts with Astra 6 at low effort, as requested by the owner, until a faster suitable model is verified. Saving it does not replace deeper planning/research/development settings. Existing customised deeper roles are preserved. See [the Agent office guide](agent-office.md).

Short ordinary chat, including a greeting with a project selected, uses the interaction role's exact saved model/effort and concise-answer instructions. Detailed, technical, lengthy and recognised safety-sensitive questions use deeper roles; current-information questions go to research. These are conservative rules, not universal understanding. Say **“answer in detail”** when you need depth. A research worker must identify available current sources or state that it cannot verify the answer.

The existing **Faster everyday replies** toggle remains separate. It can lower eligible routine general tasks to medium effort, never raising a lower saved effort or replacing a provider-managed default. It does not override the separately configured interaction effort. Manual overrides and deep planning/research/development keep their applicable saved/requested settings.

Recognised clipboard, routine, memory and status commands run locally without a model roundtrip. Queued work receives an acknowledgement only after a real job or project workflow exists; the clipboard and “What are you working on?” show its current state. These receipts do not claim that planning or development has finished. See [voice examples and local command limits](foundations.md).

Android waits 750 ms between reply checks initially, then backs off for long tasks and returns to its normal idle rate. Phone-action polling no longer holds up reply checks. Chat shows a waiting state with elapsed time and the selected AI; when available, account-check/model/answer phases explain what it is waiting for. A long wait at high effort includes settings guidance. Acknowledgements and completed answers belonging to your own foreground voice request can be read aloud; an acknowledgement keeps the final answer pending. Stop, backgrounding or permission changes still end that association.

This reduces avoidable delays; it is not a realtime voice API. The official subscription CLI still starts and verifies the account for model requests, cloud response time varies, and generated speech waits for a completed answer. The two original PC test replies took about 8.4 and 8.1 seconds at Ultra, before Android's old up-to-4.5-second polling wait. New end-to-end timings need a real phone test; local fixtures cannot predict provider speed. Compare a short question with a detailed request and inspect the recorded assignment/model/effort, timing the receipt and final answer separately.

## From a project idea to files

Select or create the project first when you want files developed. Then say, for example, **“Build a habit-tracking app with a weekly calendar.”** Nakama starts the managed workflow:

1. Astra and Fable inspect the existing project read-only and prepare detailed proposals. Astra reconciles the methodology, architecture, ordered tasks, file ownership and acceptance criteria.
2. Astra relays unresolved questions to you. Answer on Windows or Android; implementation waits until the questions are resolved.
3. Opus workers propose bounded text-file changes. Nakama validates paths, ownership and conflicts before applying them.
4. Astra and Fable review the resulting files and send blocking fixes back to Opus within the configured round limit. Both must pass before Astra delivers the result. Running tests, installing dependencies and deploying remain separate reviewed actions.

**Stop project work** cancels later stages as well as current workers. A failed or invalid plan does not start development. Files changed outside the workflow require a fresh plan. Restarting Control Center interrupts active jobs; it does not resume writes automatically. Saved unanswered questions remain available. Reviews inspect files statically and never stand in for unexecuted tests. Read [the project workflow guide](project-workflow.md) for scope, account setup and restrictions.

**“Plan a habit tracker”** only creates the detailed plan. **“Plan using Claude”** overrides the planner for that request; the saved default stays unchanged. You can also say **“use ChatGPT to develop…”**. Windows has an optional **Override AI for this chat** control, and Android has advanced controls for explicit selections. Manually selected teams retain the earlier parallel workflow.

Automatic routing recognises supported request patterns; it is not a universal autonomous agent. It distinguishes development, planning, research, prompt writing, technical work and everyday actions. If a request does not match an action pattern, it stays a conversation. A quoted instruction in a document is not a provider override or permission to execute it. The activity shows why a route was selected. Existing deployment, project-deletion and command approval rules remain in force.

## Images and video: current limits

ChatGPT is the default for creative direction and image prompts. **Actual image-file generation through the ChatGPT subscription is not implemented in Nakama yet.** A text prompt is never reported as an image file.

**Kling video generation is a separate, explicit workflow.** Open **Video studio** in Windows Control Center or use the [Nakama Kling MCP](kling-mcp.md). Prepare a text-to-video request with a model returned by the connected CLI, then review the exact request on the PC. Generation starts disabled and each job requires desktop approval; it may use Kling credits and is not covered by ChatGPT or Claude subscriptions. A chat request for a video explains this route without starting a paid generation. Prompt writing remains a normal ChatGPT/Claude task. See [account and costs](provider-options.md).

## Usage without guesswork

Open **AI usage** on Windows or the Android usage panel. Use **Check usage** or **Refresh usage** to request a snapshot. The ChatGPT and Claude cards show remaining allowance when reported, the check time and reset time. Requests within 30 seconds share the same snapshot; there is no background usage polling.

- **ChatGPT / Codex:** reads the official account quota windows, shared with other Codex use. This does not describe every separate ChatGPT app, image or voice limit.
- **Claude:** reads recognized subscription allowance windows from the read-only account endpoint used by Claude Code `/usage`. If its cached sign-in needs repair, use **Open Claude /usage on this PC** in Windows, let the official CLI refresh or complete sign-in, then refresh Nakama. No model prompt is sent. See [Claude usage](claude-usage.md).

Missing or failed data appears as unavailable, never as 0% used or 100% remaining. Windows keeps an explicitly dated previous snapshot when refresh fails; Android clears its readings on refresh and when access changes. Reading usage does not run a model request, buy credits or redeem resets. Shared AI usage is hidden from devices whose shared AI access is disabled.

Sources: [Codex account limits](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt), [Claude Code usage commands](https://support.claude.com/en/articles/14553413-claude-code-cheatsheet).

## What to test first

### Show the floating mascot

On Android, open **Home → Enable floating mascot** (also available under **Device**). Approve **Display over other apps** on Android's settings screen, then return to Nakama. Enable its notification permission when prompted so the running service is visible. The mascot should start without a second Enable tap. Drag it to move it, tap it to talk, and use **Hide** to dismiss it. Manufacturer battery/background controls on the phone and tablet may need device-specific adjustment after testing; the app cannot grant Android permissions on your behalf.

The home-screen widget is separate: long-press your launcher, open its Widgets list, add Nakama, then tap **Talk**. Microphone permission is required on first use. Foreground voice conversation can continue after a spoken reply. Moving between Nakama pages or asking a follow-up does not discard your own queued worker replies; they wait until speech playback is available. **Stop**, changed pairing or lost shared access cancels spoken follow-up. Backgrounding stops foreground capture; accepted voice receipts can continue through the explicitly enabled wake service. Locked-screen wake and requested spoken replies remain active, with a 30-second follow-up window after each reply. Android **Tools → Wake word** offers an optional visible listener using the English recognizer bundled in the APK. No Android model download is needed. Wait for **Microphone ready** and say “Hey Nakama” followed by your request; an exact recognised leading “Nakama” also works. Spoken replies use a separate installed offline Android voice. Wake has no cloud fallback and is not a proven permanent low-power listener. See [Android setup](android-guide.md) before testing background behaviour.

Install the updated Windows and Android previews, keeping the PC awake and reachable. Verify automatic chat, change one role and save it, then request a small project build and inspect the plan and saved files. Test widget Talk and the mascot only after granting their permissions on the phone. Use the [clickable checklist](assets/Nakama-Test-Checklist.pdf): **READY** means implemented and ready for your test, **SETUP** needs account/device setup, **PARTIAL** covers a limited subset, and **LATER** is unfinished. Your saved ticks are independent acceptance notes, not automatically assigned by the app.

## Request and destination devices

Nakama keeps the requesting device separate from an action target. Replies and ordinary notifications return to the request origin. Unnamed app/timer commands remain local; explicit complete paired names select a remote destination. Host-managed one-time and repeating alarms can target multiple Android devices. See [examples, connection requirements and nearby wake listeners](device-routing.md).
