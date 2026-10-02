# Using Nakama Control Center

The Windows app is your main workspace and the place where you manage accounts, pair devices, and approve important actions. The interface uses an original animated blue companion, a quiet blue and teal palette, and light and dark themes. Choose the sun or moon button in the top bar to change theme.

## First five minutes

1. Open **Overview** and choose a workspace folder. Nakama creates new projects inside this folder.
2. Open **AI team**. Install and sign into the official clients described in the account setup guide, then select **Check connection** for each provider.
3. For Codex, choose **Discover account models** to retrieve the models and reasoning settings available to your installed client. Model availability is not hard-coded into the interface.
4. Select **New project**, add a name and a short description, and create it.
5. Open the project's assistant and describe what you want. A managed build uses Astra/Fable planning, questions through the manager, Opus implementation and dual review. Ordinary conversation uses the separate **Fast Nakama interaction** role. Manual Discuss/Build controls remain available as an optional override.

For a personal-assistant request, describe the task in automatic mode or choose **Do a task** in the manual override. This can use supported project, email, calendar, and phone tools through the host. A project is optional. The selected task AI prepares the bounded action plan; in a manual team, other selected AIs review. Missing information can produce a clarification instead of an action. Your connected accounts, device permissions, and ordinary-action confirmation setting still apply; deployments and project deletion always require approval.

A local connection check does not guarantee that a subscription session is still usable. An expired login, exhausted allowance, or provider-side restriction can become apparent on the first run. Nakama displays the returned error rather than inventing a successful result or silently moving to paid APIs.

## Where everything lives

| Screen               | What you can do                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview             | See linked accounts, devices, and your most recently active projects. Start a project or conversation.                                                                        |
| Projects             | Create or import projects from GitHub, review files and Git changes, and request commands, push, deployment or deletion approvals. |
| Assistant            | Talk normally with saved AI roles, choose a project when needed, read replies and stop tasks. Optional overrides expose models, effort and manual teams.                      |
| Agent office         | Meet named mini Nakamas at their desks. Open a screen for actual assignment, status, output and parent/child work. GPT is light green; Claude is orange. |
| My clipboard         | Add and manage tasks and routines, see source progress and cross off completed cards. Earlier completed cards clear once per host calendar day. |
| Core Memory          | Add, edit and forget saved preferences, personality instructions and other short notes. Learning and reuse are controlled in Settings. |
| Learned skills       | Teach reusable methods, review project-derived candidates, edit or forget entries, and control learning and reuse independently. |
| AI team              | Connect ChatGPT and Claude, configure their manual model defaults, and discover available Codex models.                                                                       |
| AI usage             | Inspect available subscription-usage information and clearly unavailable limits. |
| Video studio         | Set up optional Kling video generation, prepare exact requests for desktop approval, and inspect existing jobs.                                                               |
| Devices              | Pair phones, tablets, or the Chrome extension; revoke access; request supported device actions and read their results.                                                        |
| Connections          | Store labelled service credentials, verify service access, and connect multiple Google accounts.                                                                              |
| Activity & approvals | Approve or decline the exact requested operation and inspect task results.                                                                                                    |
| Settings             | Select the workspace, listener, voice preference, confirmation settings, memory preference, and saved AI roles. Optional Kling generation has separate Video studio controls. |

## Projects and files

Project cards are sorted by their latest recorded activity. The star is a saved pin marker; it does not override the recent-activity ordering. Use the search box in the top bar to find a project by name or description.

**Import from GitHub** opens a separate import form. Choose a saved GitHub account, explicitly load its repository list or enter an HTTPS GitHub repository, and optionally name the local project. **Clone project** creates a new folder under the selected workspace; it does not run installation scripts or deploy. The GitHub credential is configured in Connections and remains in the Windows vault. Existing folders are preserved.

Inside a project:

- **Files & editor** lists project folders and eligible text files. Choose a file to read or edit it. Select **New text file** to enter a relative path. Save with the button or **Ctrl+S**.
- Unsaved editor changes are protected when switching files, leaving the project, or closing the page. Save them before asking another worker to change the same file.
- **Open folder** opens the validated project folder in Windows Explorer.
- **Tasks & commands** shows provider output and a command form. Enter the executable and a JSON array of separate arguments, such as `git` and `["status", "--short"]`. A command request is sent to the approvals inbox; it is not executed by submitting the form.
- **Run Blender script** requests approval for a saved Python scene script. Ask the AI to write `scene.py` in Build mode, inspect the file, save it, then request the run. Blender runs on the Windows host after approval.
- **Deploy** creates an approval request for an exact pushed Git commit. Select the saved service account and remote target. Render needs its service ID; Vercel needs the project ID/name, linked numeric GitHub repository ID, branch or tag, and preview/production target. This action does not upload uncommitted local files. Provider acceptance does not prove the deployment is healthy.
- **Request deletion** creates a fresh approval request. It does not immediately remove the project.

### GitHub work and local checkpoints

In **Git changes**, **Your GitHub project** can link an existing ordinary checkout to one saved account and repository. **Refresh GitHub state** reads local state; **Fetch** contacts that repository without changing working files. **Pull fast-forward** requires a completely clean checkout and refuses divergent history. Reload an already open editor file after a pull before editing it again.

**Commit selected changes** asks for files, a message and your explicit author identity. **Review commit** shows complete before/after text; tick the review confirmation, then **Create local commit**. Selected staged files are rejected, while other staging and working files are preserved. **Review push** shows the exact destination and commit. **Request PC approval** only creates an approval; inspect it in Activity & approvals before any push. GitHub automation may run when a branch changes, so every push needs fresh approval.

The separate **Save a local checkpoint** panel saves a recovery reference without advancing your branch or changing staging. Checkpoints are not uploaded by an ordinary branch push. Git forms retain their leave-page guard, and unsaved editor work or an active project operation blocks conflicting mutations. If a result is uncertain, refresh and inspect it before retrying. Read [commit versus checkpoint](git-changes.md) and [GitHub setup and limitations](github-projects.md).

## Learned skills

Open **Learned skills** to save repeatable methods separately from Core Memory's personal notes. Enter a title, description, when the method applies, one step per line and optional comma-separated tags. Explicitly taught entries are ready unless disabled. Project-derived **candidates** stay disabled after edits until you inspect their steps/source and choose **Accept for reuse**.

Each card shows its provenance and how often it was selected for a task. Selection does not prove the model followed it or that a check ran. **Learn useful methods** controls automatic teaching capture and candidate creation; **Reuse relevant skills** independently controls prompt context. The overall conversation-memory setting also pauses both automatic paths without deleting the library. You can edit or forget methods while paused, and unsaved editor changes trigger the normal leave-page guard.

“Open learned skills” navigates locally. The exact `Teach skill: TITLE | When: CONTEXT | Steps: FIRST; SECOND` command saves a method without an extra model call. Use methods rather than passwords, private tokens or permission instructions. Only a small relevant selection is reused by the configured agents; this is saved context, not model training. See [the skill guide](learned-skills.md).

## Fast conversation, navigation and the office

**Settings → AI roles → Fast Nakama interaction** has its own account, exact model and effort. It starts with GPT-6 Astra at low effort while a faster suitable model remains unverified. **Detailed conversation**, planning, research and development retain their independent assignments. Changing the front-facing role does not change your project team.

Ask “open agent office”, “open the task board”, “open routines”, “open core memory”, “open learned skills” or “go to projects” in the assistant. Only the direct response to that request can move your current screen. A later response cannot discard a newer draft or replay navigation from old history. Save or cancel unsaved settings, file, Git form, Core Memory or skill edits when the existing leave-page prompt appears.

The office shows real recorded work. Select **Current work** or **Including history**, then open an agent's screen. The project manager desk represents workflow coordination; its child desks represent actual task receipts. Generated names stay stable across restart. An empty screen means no recorded output yet, not an invented live feed. Read [the office guide](agent-office.md) for the complete flow and limits.

## Working with a team

In **Assistant**, the project selector chooses the conversation and the project context. Opening the assistant from a project preserves that selection. Automatic project development uses the [managed project workflow](project-workflow.md): dual planning, complete answers, ordered implementation and bounded review/fix cycles. The controls below describe the optional manual override.

**Discuss** runs planning and review. **Build** is available only with a project selected. It lets the primary writer submit contained file changes for the host to apply. Other selected team members work as reviewers. Commands and deployment/deletion operations remain separate approval-gated actions.

Select team members under **Parallel team**. The primary selector is restricted to the selected team. Each member uses its saved model and effort settings; a single shared model ID is not passed to incompatible providers.

Codex effort choices follow the discovered model's metadata where available. Claude has its own choices, including its native `max` setting. Nakama does not claim that the same marketing label means the same capability across providers.

Use **Ctrl+Enter** to send a message. Task output and provider failures remain visible. Stopping a task requests that the host terminate that run; inspect its resulting status.

## Pairing a device

1. Open **Devices → Pair a device**.
2. Choose Android or Chrome and give it a recognisable name.
3. For Android, enter the Windows host's reachable HTTPS address. For mobile data, use the private VPN address and enable the private-network listener in Settings. Restart the Windows app after changing the listener setting.
4. For Chrome on this PC, use `http://127.0.0.1:43111`. This is a separate, authenticated loopback-only bridge; it does not require a LAN listener.
5. Generate the ticket and paste the pairing information into the companion or extension. A QR is also displayed for clients that support scanning.

Tickets are single-use and short-lived. The Android payload contains the certificate fingerprint used for pinning. The ordinary `localhost` address refers to the current device, so a phone cannot reach the Windows host using its own `localhost`.

**Remove device access** revokes that device's key. Re-pair it to reconnect later.

Each Android card also has **Project access**, **Google account access**, and **Control paired browsers** switches. The browser-control permission starts off. Chrome keys have a fixed narrow scope: their own queued browser actions and results, without project or Google account access.

The device action composer exposes supported actions with labelled fields. Phone SMS, WhatsApp messages, and device calendar actions currently open drafts for completion in the relevant app. App-control commands require the explicitly enabled foreground control session. Browser controls require a permitted Chrome tab. Results distinguish queued, started, completed, blocked, unsupported, and failed states; starting an action is not represented as proof that its final goal succeeded.

**Read visible controls** requests a bounded set of visible labels and control positions from an enabled Android control session. Sensitive screens are blocked. It does not read hidden app data.

## Keeping Windows available

Under **Settings → Keep Nakama close**, **Keep running when I close the window** is on by default. Closing the window leaves the host in the Windows notification area so paired devices can continue connecting. Use the tray's **Quit** action to stop it completely.

**Start with Windows** is off by default. Enabling it applies to the installed Windows application; source development runs ignore that preference.

## Accounts, email, and calendars

Development service tokens are stored in the Windows host's protected vault. Add a clear label for each account. **Verify** makes a read-only request to that service and does not deploy or publish anything.

Choose **Explore** beside an account to load its supported resources. GitHub supports repositories and deployment records; Vercel supports projects and deployments; Render supports services and deployments; Neon supports projects, branches, and databases; Resend supports sending domains. Resource lists show provider IDs you can use in related forms. Listing a resource does not change it.

Vercel project rows and Render service rows offer **Prepare deployment**, which fills in the target details it knows. You still enter the exact Git commit and approve the resulting request. The Resend explorer includes a plain-text email composer for a verified sending domain; an accepted request is not represented as proof of delivery.

For Gmail and Google Calendar, use **Connect Google**. Enter your own Google Desktop OAuth client information, select the services, then finish Google's consent screen in the browser. The label and account selector let you keep multiple personal and business Google accounts distinct.

The inbox view displays message metadata and snippets for up to ten matching messages. The calendar view displays upcoming primary-calendar events. **Write email** and **New event** are explicit action forms. If ordinary-action confirmation is enabled, the host places them in the approval inbox. A connected account is required before these forms can perform real actions.

## Kling video

Open **Video studio** for optional text-to-video generation. Kling is separate from your AI workers and subscriptions; generation starts disabled.

1. Follow [Kling setup](kling-mcp.md) for the official pinned CLI and your own account sign-in.
2. Refresh the connection and available model information. Use the model identifiers actually returned by that connection.
3. Prepare the requested video with its prompt and supported settings. Preparation does not generate or approve a video.
4. Review the exact request on the PC. Each video needs a new desktop approval, even when ordinary-action confirmation is off.
5. Inspect the existing job's status and result links. Do not create another job to retry an uncertain submission.

Kling uses its own credits. A reported balance is not a guaranteed job quote; unknown cost remains unknown. ChatGPT and Claude subscriptions do not cover this generation. No live credit-spending generation was used to test the integration. The MCP can prepare and inspect jobs but cannot enable spending or approve itself. See [video capabilities and limits](media-generation.md) for current supported inputs, results and setup requirements.

## Browser preview and testing

Running `npm run dev` opens a clearly labelled **design preview** when the Electron bridge is absent. Preview projects and preferences are stored under a separate browser local-storage key. The preview never runs provider inference, real commands, account connections, phone actions, or paid media generation. It reports that the Windows app is required for those actions.

The production renderer uses only the isolated `window.nakama` bridge. It does not import Node.js or expose stored account secrets. QR generation is loaded on demand. The interface has labelled form controls, native modal focus handling, keyboard focus states, responsive layouts, and a reduced-motion mode for the mascot and transitions.

### Renderer verification performed

The latest native Agent office fixture checks real renderer interaction with synthetic receipts: hierarchy, green/orange desks, keyboard focus, current/history, empty/unavailable states, direct navigation, late responses and draft protection. Existing automatic-role and project-workflow fixtures also remain regression checks. Screenshots are fixture evidence, not live model activity; see [current verification](verification.md) for completed counts and packages.

`scripts/verify-github-skills-ui.cjs` covers the new native Skills and GitHub forms with disposable renderer data and intercepted requests. It does not connect a real account, publish a repository or exercise physical Android hardware. Host tests separately use disposable local Git repositories for actual ref/index operations. Consult current verification for the latest run result.

- TypeScript strict compilation and production Vite build passed.
- An additional unused-symbol TypeScript check passed.
- Browser preview home, project creation, recent project display, and assistant navigation were exercised.
- The project-to-assistant link retained project context; Discuss/Build and team primary-writer controls were checked.
- Native Electron tests used an isolated temporary profile: project creation, editor save, project context, Build selection, pairing ticket creation, tray/startup defaults, and paid APIs disabled all passed.
- The native **Copy pairing information** button was verified against its displayed value. Clipboard writes are excluded from the smoke test by default.
- Missing desktop capability produced an explicit error instead of a fabricated chat response.
- Light/dark themes were visually checked; a dark-background inheritance issue was found and corrected.
- Google OAuth form fields and scope selections, Chrome pairing address switching, and media spending gates were inspected.
- Browser console inspection reported no warnings or errors during those flows.

Preview tests are separate from real account/device tests. Gmail delivery, Google consent, paid generation, Android actions, and Chrome page control need their actual connected environments for end-to-end acceptance. See the main feature checklist and release notes for the broader host and device verification status.

### Optional clipboard test

`node scripts/verify-electron.cjs` skips clipboard writes by default. Setting `NAKAMA_TEST_CLIPBOARD=1` explicitly opts into the native Copy-button test. This temporarily replaces the Windows clipboard, so avoid copying other content while it runs. The test eagerly reads the existing items, constructs writable copies, and validates restoration before pressing Copy. It restores those items in its cleanup handler. A crashed process can still interrupt cleanup; only opt in when losing the current clipboard would be acceptable.
