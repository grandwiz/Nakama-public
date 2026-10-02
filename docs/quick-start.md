# Nakama quick start

This guide describes the current source-only engineering preview. Check [implementation status](implementation-status.md) for unfinished or unverified features, and use [the testing guide](testing-guide.md) to work through this update.

**Updating an existing installation:** use a locally built package only after verifying its source, identity and signing key. Finish or stop active work and quit Nakama from its Windows tray menu before updating. Preserve projects, accounts, pairing and memory. Never uninstall Android or clear its data to bypass a signing mismatch. This source release provides no prebuilt packages or private package manifest.

## 1. Start Control Center

This source release provides no installer or APK download. Build and run the application locally using the commands below. `npm run dist:win` optionally creates an unsigned development installer; Android builds use your own development key. Production binary distribution requires the separate [release process](release-signing.md).

From the repository, install dependencies, build, and launch:

```powershell
npm ci
npm run build
npm start
```

Choose a dedicated folder when prompted. This is where Nakama creates projects. The source repository and your runtime project folder can be different locations. Avoid selecting the root of a drive.

The desktop home screen shows recent projects and activity. Create a small test project, open it, and try its file editor before connecting accounts. Closing the window keeps the host in the Windows tray by default. Use the tray's Quit command to stop it, or change Close to tray in Settings. Start with Windows is optional and applies to the installed app.

## 2. Connect your assistants

Start with Codex, then connect Claude through its official login screen. Do not paste account passwords into Nakama. Nakama checks the authentication method before each provider task; an installed CLI or saved login is not enough by itself.

CLI sign-in can be run from any folder in ordinary PowerShell under the same Windows user as Nakama. For Claude, use `claude auth login --claudeai`, finish the browser sign-in, then press **Check connection**. There is no need to keep the CLI window open. See [connection troubleshooting](troubleshooting.md#claude-works-in-powershell-but-nakama-cannot-connect) if the status differs between PowerShell and Nakama.

| Provider        | First setup                                                              | In Nakama                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT / Codex | Install Codex and run `codex login` with your ChatGPT account            | Open AI team, check the connection, and choose an available model. Account eligibility and exact model access need verification in your installation.                   |
| Claude          | Use Claude Code's official login flow and choose your Claude Max account | Check the connection again. API-key, Console/external-provider and unrecognised authentication cannot run as a Nakama subscription connection. |

Open **Assistant** and describe what you want. Nakama's user-facing interaction role is separate from the deeper project roles, starting with **Astra 6 at low effort**. Configure it under **Settings → AI roles**; exact account support still needs verification. Simple local commands return without a model call. Longer work receives a receipt once accepted and runs in the background. No model has been verified as the fastest available, and response time is not guaranteed. See [conversation and Agent office](agent-office.md).

Select or create a project before requesting file development. The default managed project team uses Astra 6 Ultra as manager, Astra and Fable for planning/review, then Opus implementation workers. Your answers gate implementation; both reviews gate delivery. Fable needs the supported CLI/Max login and your confirmation that usage credits are disabled in Claude's own settings. Read [project team setup](project-workflow.md) before the first live run. Saved role settings and one-request provider overrides remain available.

You do not need to choose models before chatting. To change an automatic role's exact model or effort, expand **Model & effort** in **Settings → AI roles**. For the older manual workflow, enable **Override AI for this chat**; **AI team → Claude → Preferred model** controls manual defaults. Manual teams use each AI's saved model. See [model setup and availability](provider-options.md#choose-an-exact-claude-version).

In an explicitly selected manual team, the first provider builds files or plans actions while others review. Automatic managed projects use the staged team described above. Both paths check file containment/conflicts and preserve recovery copies. Static review does not prove that code ran; executing checks is a separate reviewed action and deployment always requires approval.

If the project has its own Git repository, open **Git changes** to review saved edits and staged changes. **Save a local checkpoint** lets you select text files, review their full before/after contents and save a local recovery commit. Your branch, staging and working files remain unchanged; nothing is uploaded. See the [Git review and checkpoint guide](git-changes.md) for limits and how to find saved checkpoints.

For a Node.js project with existing test, lint, type-check or build scripts, open **Tasks & commands → Project checks**. Review its scripts and request a run, then approve it in **Activity & approvals**. The task records the actual exit result. **Review this check** prepares an editable Discuss draft from a finished result; you choose when to send it. See the [development cycle](project-checks.md) before running unfamiliar project code.

ChatGPT and Claude are the two supported AI workers. Check both connections, then verify the configured models with a deliberate first task. An expired session can still need re-login after an earlier successful connection check.

Nakama can use **your existing eligible subscriptions** without automatic paid API fallback. No API key is needed for Codex or Claude subscription tasks, and those tasks never fall back to paid APIs. **Video studio** adds an optional Kling connection, separate from both subscriptions. Leave Kling generation disabled to keep the current no-extra-spend setup. Connecting or preparing a request does not authorise spending; every submitted video requires a new desktop approval. See [account and cost guidance](provider-options.md) and [Kling setup](kling-mcp.md).

## 3. Pair Android

1. Build and install your own locally signed APK on a 64-bit arm64-v8a or x86_64 phone/tablet running Android 15 or later. Windows Android builds need JDK 17, SDK 36, Python 3.11+, NDK 28.2.13676358 and CMake 3.22.1. Gradle prepares the bundled speech runtime automatically; see [build and installation instructions](android-guide.md#build-android-with-bundled-speech).
2. Put the phone and PC on a reachable private network. For mobile data, configure a private network such as Tailscale first.
3. In desktop Settings, enable **Allow paired devices over a private network**. Fully quit using **Quit Nakama and disconnect devices** in the Windows tray, then reopen Control Center. Closing the window alone can leave the old listener running.
4. Open **Devices → Pair a device** and choose Android. Select the detected Wi-Fi/Ethernet address for your home network, or enter the PC's private VPN HTTPS address. Use **Check network again** after changing the connection. Do not use a virtual-machine adapter or `localhost`: on the phone, that means the phone itself. The screen blocks ticket creation while the PC is listening locally only or needs a restart.
5. Copy the complete pairing details into Android. The payload carries a one-time ticket and the host certificate fingerprint.
6. Confirm that the expected device appears in Control Center. Pair the tablet separately.

Each Android device has separate project, Google-account, browser-control and remote-desktop switches in Devices. Browser and remote desktop control start off; enable each deliberately for the intended phone. Windows remote desktop also needs its overall PC setting enabled. A Chrome token itself only receives and reports browser actions.

For this preview, turning off Google access also hides shared AI history and disables AI chat on that device. The coding CLIs can read local files, so this restriction protects saved mailbox history. Agent office, boards, Core Memory and location/remote desktop sharing also require the relevant shared access. Project browsing and direct local phone controls have their own permissions. See [security](security.md) for the full boundaries.

Never replace the fingerprint with an arbitrary value or disable certificate checks. A new host certificate requires deliberate re-pairing. Do not forward this port from a public router.

Grant phone permissions only as needed. The Android guide explains microphone, calls, contacts, overlay, and accessibility. Ordinary actions follow your settings; operating-system prompts still require you to act on the phone.

## 4. Connect Chrome

Follow the [Chrome extension guide](chrome-extension.md). It uses its own Chrome ticket and the local address `http://127.0.0.1:43111`. This address is only for the browser on the PC. Android uses pinned HTTPS instead.

Select **Enable all ordinary tabs** and accept Chrome's website-access grant once. The two-hour session covers existing and new ordinary tabs without per-tab prompts. Stop the session in the extension or revoke the browser in Control Center.

The extension supports explicit page actions and guarded screenshots of the focused eligible tab. It does not yet provide a continuous autonomous browsing agent or complete coverage of every website. Recognised deployment/deletion controls require you to finish the action directly. See [capture limits](chrome-extension.md#capture-the-visible-tab).

## 5. Set up your services

For an existing GitHub project, first add a labelled GitHub account in **Connections**. Then use **Projects → Import from GitHub**, choose that account and repository, and clone into a new managed workspace folder. In the project, **Git changes** provides fetch, fast-forward pull, reviewed selected-file commit and push preparation. Android provides the same host-backed operations; credentials and final push approval stay on the PC. [Step-by-step GitHub workflow](github-projects.md).

Connections hold separately labelled accounts. Provider tokens are saved in the Windows-protected vault, and a connection is only shown as verified after a successful provider check. Gmail/Calendar use a Google desktop OAuth setup and can hold several personal accounts. These Google connections are independent of your AI and Kling accounts.

Open a service's account to browse its supported resources. Vercel/Render deployments target existing provider projects and an exact Git commit, with a mandatory approval. Follow [Google setup](google-accounts.md), [service connections](service-connections.md), [media generation](media-generation.md), and [Blender](blender.md). Credentials alone do not mean every provider action is implemented; the [status table](implementation-status.md) identifies the limits.

## 6. Try your everyday tools

On Windows open **My clipboard**, **Core Memory** or **Agent office**. Android exposes the corresponding tools alongside Chat and Projects. Start with “add task try my Nakama”, “show my tasks”, “open agent office” and “what are you working on?”. Supported navigation changes only the requesting app; it does not move another device's screen.

Select an agent's little screen to inspect its actual assignment and available output. Light green means GPT and orange means Claude; text labels identify the provider too. The project manager record represents orchestration, while child records represent actual worker requests. A sleeping/empty office does not mean a worker is secretly running.

Tasks finish according to recorded work; manually checking a card never finishes an underlying agent. Routines can be edited, paused and removed. **Core Memory** lets you inspect and correct saved preferences and Nakama personality; pause learning or reuse whenever you want. [Personal foundations](foundations.md).

Open **Learned skills** on Windows or **Tools → Learned skills** on Android to teach a reusable method. Include when it is useful and concrete steps. You can also say or type `Teach skill: NAME | When: CONTEXT | Steps: FIRST; SECOND`. Successful reviewed projects can suggest disabled candidates; inspect and accept each before future agents can reuse it. Learning and reuse can be paused separately. [Skill controls and limits](learned-skills.md).

In Android **Device → Make it yours**, use **Reduce motion** if you prefer still pages and mascot. Android's animation settings also apply. Check the feel on each physical device; a successful emulator test is not a frame-rate guarantee.

For voice, tap **Talk** first and grant microphone permission. The APK includes its offline English recognizer; first use prepares a local copy without an Android model download. Set up an offline British English text-to-speech voice separately for spoken replies. Voice requests are answered aloud; typed requests stay silent. Set up the home-screen widget or **Home → Enable floating mascot** for quick entry. Follow the [Android wake-word setup steps](android-guide.md#optional-local-nakama-wake-word) on each device, wait for **Microphone ready**, then try **“Hey Nakama, what time is it?”**. Granting permissions alone does not start listening. The larger APK includes approximately 74 MB of model files, and first use requires additional private storage.

Open **Clock** on Windows or **Tools → Clock** on Android to create, pause, resume or cancel a countdown. Android timers run on the phone/tablet; Windows timers require the PC host to stay running and awake. Ask “what time is it?” or “set a 10 minute timer” for a local response without an AI call. See [timer permissions and delivery limits](clock.md).

Enable additional device features one at a time:

| Feature | Setup | Acceptance to perform |
| --- | --- | --- |
| Phone alarms | Select one or more phones/tablets, grant notification/exact-alarm access and enable sync on each | Correct time/zone, schedule receipt, actual sound and cancellation |
| Location | Explicit phone consent and Android permission | Accuracy, timestamps, stale/offline state, reconnect and Stop/forget |
| Windows remote desktop | Overall PC setting and intended phone permission | Correct monitor, harmless touch/typing, switcher, Stop and expiry |
| Android app navigation | Direct local command; visible app-control session/accessibility for supported global actions | Correct destination, denied permission, protected screens and Stop |

These are optional features with [documented Android limits](android-guide.md). Continuous 24-hour listening/location and real hardware behaviour remain acceptance work. [Remote desktop guide](remote-desktop.md).

## 7. Try one small project

Use a disposable project with a narrow request, such as a simple offline notes page. Watch the plan and manager questions, answer them, then inspect files and both reviews. While workers are running, ask Nakama for an update and check Agent office. Stop should cancel later stages too. An unresolved question, interrupted task or failed review must remain unfinished.

Use **Project checks** for an intentionally approved test run when appropriate. A code review is not an executed test. Record the result in the [editable checklist](feature-checklist.md) and [testing guide](testing-guide.md).

## Approval rules

- Routine explicitly requested actions do not require repeated confirmation by default. You can change this setting.
- **Deployments and project deletion always require approval.** Remote devices cannot approve their own high-impact operations.
- General commands need exact-command approval because a shell command can indirectly delete or deploy.
- Project deletion moves the validated project folder to the workspace recovery folder when supported; the approval screen must show the operation.

## When the PC is offline

The Android app can show local controls and retained drafts, but PC execution and cloud-provider sessions hosted on Windows cannot proceed until it reconnects. A private network is a connection, not an always-on replacement PC.
