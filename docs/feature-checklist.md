# Nakama feature checklist

Planning and acceptance baseline: **2 October 2026**.

**222 acceptance checks.** READY = implemented and ready to test; SETUP = needs your account/device permissions; PARTIAL = only a subset is implemented; LATER = not available in the selected plan/current build. Saved PDF ticks are retained independently of readiness. New boxes start unchecked. This Markdown baseline does not sync your PDF ticks.

Blank public template: [Nakama Test Checklist](assets/Nakama-Test-Checklist.pdf). The filled personal copy stays locally at `output/pdf/Nakama-Feature-Checklist.pdf` and is excluded from Git. Click a checkbox to mark an item, click again to clear it, then save the PDF to keep your progress. If your preview cannot edit forms, open the file in a form-capable PDF viewer such as Adobe Acrobat Reader. Save a personal copy for your test results. PDF ticks and Markdown records are stored separately; they do not automatically synchronise. Sequencing: [implementation plan](implementation-plan.md). Account setup: [provider options](provider-options.md).

Start with [the testing guide](testing-guide.md): installation and pairing, local tools, office/navigation, one small project, then optional Android services. Use the fresh RETEST boxes for this update even where an older feature already has your acceptance tick.

No purchases, paid video, real messages/calls, deployments or destructive actions are needed for the update-regression pass. Live model work still requires your eligible accounts and documented billing setup.

## Your Windows workspace

Phases 1, 2 and 6. A friendly development client that keeps projects, tools and progress in one place.

### Make it yours

- [ ] **WIN-01 - Simple first-run setup [READY]:** Choose a project folder, review access and finish setup without developer knowledge.
- [ ] **WIN-02 - Windows installation [PARTIAL]:** Install and launch Control Center on the supported Windows PC; show update status.
- [ ] **WIN-03 - Clear, adaptable interface [READY]:** Use readable light/dark themes, keyboard navigation, accessible contrast and helpful errors.
- [ ] **WIN-04 - Connections at a glance [READY]:** See account, device and tool readiness without fabricated connected states.

### Manage real projects

- [ ] **WIN-05 - Recent project cards [READY]:** List projects with the most recently active first; open the correct saved workspace.
- [ ] **WIN-06 - Create and organise projects [PARTIAL]:** Create projects in the chosen root; find, reopen, rename and archive them safely.
- [ ] **WIN-07 - Project conversation and files [PARTIAL]:** Keep messages, generated files, previews and activity attached to their project.
- [ ] **WIN-08 - Understand ongoing work [READY]:** Show current task, agent progress, errors and a useful outcome with verifiable evidence.

### Build on your PC

- [ ] **WIN-09 - Development command workflow [PARTIAL]:** Propose, approve where required, run and inspect commands inside an enforced permission boundary.
- [ ] **WIN-10 - Review and stop work [PARTIAL]:** Inspect file changes and command output; cancel jobs and resume supported sessions.
- [ ] **WIN-11 - Blender project creation [SETUP]:** Use the local Blender installation, save the scene and return a rendered preview and .blend file.
- [ ] **WIN-12 - Missing-tool guidance [PARTIAL]:** Explain unavailable runtimes or applications and provide actionable setup instructions.

Review note: Chosen folder does not equal an OS sandbox. Full command execution needs enforceable controls; read-only proposals come first.

## Your AI team and media

Phases 2 and 7. Use existing accounts first, then select the right model and team for the task.

### Connect supported accounts

- [ ] **AI-01 - ChatGPT Pro through Codex [READY]:** Complete official sign-in and show the active account, supported models and usage mode.
- [ ] **AI-02 - Claude Max 20x through Claude Code [READY]:** Use the official local client and subscription login; prevent accidental API-key billing.
- [ ] **KLING-01 - Kling account and live models [SETUP]:** Sign in through the official CLI; refresh supported text-to-video models and current credit balance.
- [ ] **AI-04 - Separate subscriptions and API keys [READY]:** Show which connection is billed; never silently fall back to a paid service.

### Coordinate the team

- [ ] **AI-05 - Model and version selection [PARTIAL]:** Select only models/versions supported by the actual connection; explain unavailable choices.
- [ ] **AI-06 - Effort and Ultra preferences [READY]:** Save Astra 6 Ultra and supported provider effort settings; retain optional manual overrides.
- [ ] **AI-07 - Simultaneous provider teamwork [PARTIAL]:** Run bounded parallel work with clear roles, status and individual or automatic team selection.
- [ ] **AI-08 - Integrate without overwriting [PARTIAL]:** Use file ownership or isolated workspaces, review combined output and resolve conflicts.

### Create and remember

- [ ] **AI-09 - Useful personal memory [PARTIAL]:** Save editable preferences and conversation history; view, forget and export remembered information.
- [ ] **KLING-02 - Text-to-video requests [SETUP]:** Choose a live model, options and prompt; review in Activity, then check status and open the returned video.
- [ ] **KLING-03 - Private Kling MCP [SETUP]:** Copy the MCP configuration into a compatible client; prepare requests, check results and revoke access.
- [ ] **KLING-04 - Explicit video spending approval [READY]:** Start disabled. Require approval per video; explain unknown exact cost, empty credits and uncertain submissions.

Review note: Kling uses separate credits. No live video was generated during development; sign-in and an explicitly authorised generation still need your test.

## One conversation, the right AI

New automatic companion workflow. Choose your team once in Settings. Talk normally; override a role only when you want to.

### Save your defaults

- [ ] **AUTO-01 - ChatGPT planning and design [READY]:** Default to Astra 6 Ultra for requirements, architecture, user experience, implementation steps and test criteria.
- [ ] **AUTO-02 - Claude development [READY]:** Default to Opus 4.8 for development, with the completed plan passed into its project build.
- [ ] **AUTO-03 - Configurable AI roles [READY]:** Save role/model choices and Faster everyday replies in Settings; keep detailed work at its saved effort.
- [ ] **AUTO-04 - One-request overrides [READY]:** Say 'plan using Claude' or use advanced controls; keep the saved role preferences unchanged.

### Use one simple conversation

- [ ] **AUTO-05 - Automatic task choice and quick replies [READY]:** Use the separate fast interaction role for ordinary chat and deeper roles for detailed work. On Android, show waiting status and check promptly for replies.
- [ ] **AUTO-06 - Plan before development [READY]:** A selected-project build waits for planning to succeed; stopping or failing planning prevents the handoff.
- [ ] **AUTO-07 - ChatGPT image files [LATER]:** Generate actual image files using included ChatGPT access; text prompts alone do not complete this item.
- [ ] **KLING-05 - Explicit video workflow [READY]:** Keep normal chat with ChatGPT or Claude; a Kling video request directs you to Video studio or the MCP approval flow.

### Understand your allowance

- [ ] **USE-01 - Usage on PC and Android [PARTIAL]:** Open AI usage to see ChatGPT and Claude, checked time, remaining allowance where reported and reset times.
- [ ] **USE-02 - ChatGPT account limits [READY]:** Read official account quota windows; distinguish session and weekly limits, and display unavailable data honestly.
- [ ] **USE-03 - Claude account limits [READY]:** In build 8, read recognized subscription quota windows without inference; when sign-in needs repair, open the official /usage handoff on the PC and refresh. Unknown fields remain unavailable. See [Claude usage](claude-usage.md).
- [ ] **USE-04 - No invented allowance [READY]:** Never present missing, failed or expired quota data as 100% remaining; refreshing does not send a model prompt.

Review note: READY means implemented and ready for your test, not accepted. A real ChatGPT-to-Claude build and physical voice/overlay checks still need your validation.

## Your Android companion

Phases 3 and 4. A comfortable companion on the Android phone and tablet, both Android 16.

### Talk and manage projects

- [ ] **AND-01 - Phone and tablet layouts [READY]:** Adapt to both devices, orientations and larger text without hiding essential controls.
- [ ] **AND-02 - Typed conversation [PARTIAL]:** Send requests, read streamed replies and open attachments or generated results.
- [ ] **AND-03 - Project cards on Android [PARTIAL]:** Create, open and manage PC projects; show most recently active first and reliable job status.
- [ ] **AND-04 - Offline and reconnect behaviour [READY]:** Show PC/device connectivity, retain drafts and avoid replaying actions when reconnecting.

### Voice that feels natural

- [ ] **AND-05 - Tap to talk [READY]:** Tap the widget's Talk button and start speaking once permission is granted; no model selection is required.
- [ ] **AND-06 - British female voice [SETUP]:** Preview available English UK voices and remember the selected female-sounding voice.
- [ ] **AND-07 - Spoken conversation [READY]:** Speak responses, allow interruption and offer a hands-free session the user explicitly starts.
- [ ] **AND-08 - Wake phrase and background limits [LATER]:** Evaluate optional 'Hey Nakama'; show actual support, battery impact and manual alternatives.

### Always within easy reach

- [ ] **AND-09 - Home-screen widget [READY]:** Add the Nakama widget and use its Talk action to open a foreground voice conversation directly.
- [ ] **AND-10 - Original fluid mascot [PARTIAL]:** Animate a lightweight vector companion with idle, listening, thinking and speaking states.
- [ ] **AND-11 - Movable overlay [SETUP]:** Enable the mascot with Android's display-over-other-apps permission; drag, tap to talk and dismiss it.
- [ ] **AND-12 - Visible stop and recovery [PARTIAL]:** Stop speech/control from the active surface; restore widget and overlay state after restarts.

Review note: Voice availability is device-dependent. Android 16 does not by itself guarantee an offline recogniser or a specific installed voice.

## Phone actions you can trust

Phase 5. Tell Nakama what to do in normal language, with the correct recipient, app and device.

### Choose the intended action

- [ ] **ACT-01 - Natural-language requests [PARTIAL]:** Turn a request into a clear action, including message text, recipient, app and target device.
- [ ] **ACT-02 - Resolve names and ambiguity [PARTIAL]:** Use contacts/account identity; ask when 'Mike' or a date could mean more than one thing.
- [ ] **ACT-03 - Configurable routine confirmations [READY]:** Allow ordinary explicit requests to run according to the user's per-action settings.
- [ ] **ACT-04 - Grant phone permissions on device [SETUP]:** Guide microphone, contacts, calendar, calls, messaging, overlay and accessibility permission setup.

### Calls and messages

- [ ] **ACT-05 - Normal phone calls [SETUP]:** Handle 'call Mike' with supported Android calling tools and the correct telephone number.
- [ ] **ACT-06 - SMS messaging [PARTIAL]:** Prepare/send supported SMS actions and distinguish drafted, sent and delivery status.
- [ ] **ACT-07 - WhatsApp messaging [PARTIAL]:** Handle 'message Nayan on WhatsApp [message]' and verify the supported completion step.
- [ ] **ACT-08 - WhatsApp calls [LATER]:** Handle 'call Steve on WhatsApp' and report initiation separately from a connected call.

### Use other apps carefully

- [ ] **ACT-09 - Discord user-directed messages [LATER]:** Support the requested Discord workflow through permitted interfaces; never use self-bot user tokens.
- [ ] **ACT-10 - App opening and interaction [PARTIAL]:** Use app links/intents first; enable scoped accessibility tapping, typing and scrolling where supported.
- [ ] **ACT-11 - Observe actual completion [READY]:** Opening an editor is not sending a message. Report the last verified result and any remaining step.
- [ ] **ACT-12 - Respect device capabilities [READY]:** Detect tablet calling/SMS support, locked screens and protected UI; show manual steps when necessary.

Review note: Private APK installation does not bypass Android security. App updates can change accessible controls; each supported workflow needs device testing.

## Your connected services

Phases 5 and 6. Keep each account and service understandable, with permissions matched to its purpose.

### Personal Google accounts

- [ ] **CON-01 - Multiple Google identities [SETUP]:** Connect several personal or business Google accounts and choose the correct Gmail or calendar identity.
- [ ] **CON-02 - Gmail reading and search [SETUP]:** Find and summarise relevant email using the selected account and consented scopes.
- [ ] **CON-03 - Email composition and sending [SETUP]:** Create drafts and perform explicitly requested sends with clear account and recipient selection.
- [ ] **CON-04 - Google Calendar management [SETUP]:** Create/update events with correct account, timezone, date and reminders; verify saved details.

### Build and publish with permission

- [ ] **CON-05 - GitHub [PARTIAL]:** Connect repositories, inspect changes and manage development workflows with scoped credentials.
- [ ] **CON-06 - Vercel [SETUP]:** Select a project, inspect status and prepare deployment; execution always requires approval.
- [ ] **CON-07 - Render [SETUP]:** Connect services and inspect relevant status/logs; gate every deployment behind approval.
- [ ] **CON-08 - Resend [SETUP]:** Connect email features with sender/domain configuration and a preview of requested outgoing content.

### Data and browser

- [ ] **CON-09 - Neon [PARTIAL]:** Connect database projects safely, show the selected environment and review high-impact changes.
- [ ] **CON-10 - Custom Chrome extension [SETUP]:** Install the unpacked extension, pair it to Control Center and display its connection state.
- [ ] **CON-11 - Browser observation and control [PARTIAL]:** Observe requested tabs and perform authorised navigation, clicking, typing and scrolling.
- [ ] **CON-12 - Browser/session boundaries [READY]:** Expose active control, stop/revoke access and handle protected pages or unsupported frames honestly.

Review note: Building communication tools is not permission to send real messages during development. Tests use fixtures or deliberately authorised targets.

## Security and permissions

Required across every phase. Your approved devices and requests control access. Models cannot grant themselves permission.

### Only your devices

- [ ] **SEC-01 - Desktop-approved pairing [READY]:** Use a short-lived code plus local desktop approval; unpaired clients cannot execute tasks.
- [ ] **SEC-02 - Private encrypted connection [SETUP]:** Verify HTTPS and the pinned host identity on local Wi-Fi and mobile data.
- [ ] **SEC-03 - Per-device management [READY]:** Name devices, inspect last activity and permissions, and select the phone or tablet for an action.
- [ ] **SEC-04 - Immediate revocation [READY]:** Revoke a device credential and reject further requests, including an already reconnected client.

### Permission rules that hold

- [ ] **SEC-05 - Deployments always ask [READY]:** Bind approval to the exact proposed deployment; reject missing, expired or mismatched approval.
- [ ] **SEC-06 - Project deletion always asks [READY]:** Show the resolved target and impact; require a separate approval that routine settings cannot disable.
- [ ] **SEC-07 - Constrained command execution [PARTIAL]:** Enforce filesystem/process access and isolate deployment secrets before enabling general commands.
- [ ] **SEC-08 - Untrusted content stays content [PARTIAL]:** Emails, webpages, app text and project files cannot authorise unrelated actions or change permissions.

### Privacy and resilient jobs

- [ ] **SEC-09 - Protected credentials [READY]:** Store secrets in OS-backed protection, redact logs and keep keys/tokens out of GitHub.
- [ ] **SEC-10 - Explicit context sharing [PARTIAL]:** Show when relevant screenshots or app text are sent to the selected AI; provide retention controls.
- [ ] **SEC-11 - No duplicate actions [READY]:** Use job IDs, expiry, acknowledgements and replay protection; a reconnect cannot send a message twice.
- [ ] **SEC-12 - Audit, recovery and emergency stop [PARTIAL]:** Record authorised actions and outcomes; stop active jobs and recover safely after crashes.

Review note: Initial agent proposals remain read-only. Full execution is accepted only once the mandatory approval rules can actually be enforced.

## Ready to install and continue

Phase 8. Completion means a reproducible package, clear guides and evidence from the real user flows.

### Package and verify

- [ ] **REL-01 - Windows installer [READY]:** Build a reproducible installer; verify fresh setup, relaunch, settings and upgrade behaviour.
- [ ] **REL-02 - Signed private Android APK [PARTIAL]:** Build and install on both Android 16 devices; keep signing keys secure for future updates.
- [ ] **REL-03 - Installable Chrome extension [READY]:** Provide the extension folder/package and exact chrome://extensions installation instructions.
- [ ] **REL-04 - End-to-end acceptance [PARTIAL]:** Verify provider results, mobile pairing, permissions, phone workflows and failure/reconnect cases.

### Make ownership easy

- [ ] **REL-05 - Quick start and full documentation [READY]:** Provide an easy first-use guide plus detailed setup, accounts, permissions and daily-use instructions.
- [ ] **REL-06 - Troubleshooting and capability matrix [READY]:** Document each app/device limit, missing dependency, known issue and unverified feature plainly.
- [ ] **REL-07 - Costs and billing guide [READY]:** Explain included subscriptions, free services, optional paid budgets and current official sources.
- [ ] **REL-08 - GitHub source delivery [READY]:** Publish reviewed code, guides and a blank checklist to the selected repository without secrets or private history.
- [ ] **REL-09 - Rebuildable feature checklist [READY]:** Keep this PDF, matching Markdown, stable feature IDs and the script used to regenerate it.
- [ ] **REL-10 - Seamless continuation [READY]:** Leave verified progress, unfinished work, exact next commands and a copy/paste prompt for a new chat.

Review note: Every box is initially unchecked. A checked box needs evidence from the stated acceptance behaviour, not only a source file or mock screen.

## Your manager, team and companion

October project workflow. One manager keeps questions, development and review connected, while your companion remembers what you choose to share.

### Plan and deliver together

- [ ] **TEAM-01 - Astra and Fable joint planning [SETUP]:** Use Astra 6 Ultra as manager and Fable 5.1 as co-planner; save detailed methodology, tasks, file ownership and acceptance criteria.
- [ ] **TEAM-02 - Questions through your manager [READY]:** Answer the manager's saved questions on Windows or Android; development waits until all required answers are recorded.
- [ ] **TEAM-03 - Opus implementation workers [PARTIAL]:** Use exact Opus 4.8 for bounded tasks; request Ultracode, mapped to xhigh with Nakama orchestration. Native Claude workflows remain disabled.
- [ ] **TEAM-04 - Independent review and fixes [READY]:** Astra and Fable both review the current files. Fixes return to Opus; unresolved findings at the limit must not produce a completed delivery.

### Stay in control

- [ ] **TEAM-05 - Stop, restart and changed files [READY]:** Stop the whole workflow; reject late writes, changed files, revoked permissions and unauthorised phone access. Interrupted active runs do not restart.
- [ ] **MEM-01 - Editable companion learning [READY]:** Remember stated preferences and personal notes without extra model calls. Inspect, edit, pause learning or forget notes; do not infer a hidden personality profile.
- [ ] **REMOTE-01 - Visible phone control session [SETUP]:** Start app-scoped control on the phone; see blue edges, an action cursor, a countdown and immediate Stop. Verify on both Android 16 devices.
- [ ] **REMOTE-02 - Live remote phone desktop [LATER]:** Stream the phone screen with Android capture consent and support broader verified visual control. This is not implemented in this update.

Review note: New acceptance boxes start unchecked. Fable needs your Max plan and usage credits disabled; live account and physical-device acceptance remain unverified.

## Your everyday Nakama foundations

October personal tools. A shared clipboard for your tasks and rhythms, with visible memory and optional phone services.

### Your tasks and routines

- [ ] **BOARD-01 - Shared task clipboard [READY]:** See assistant jobs and project progress on Windows and Android; add personal tasks and cross completed cards out.
- [ ] **BOARD-02 - Daily completed-card cleanup [READY]:** Clear previous-day completions once each host day, catch up after restart, and remove cards manually without deleting source work.
- [ ] **ROUTINE-01 - Shared routines board [READY]:** Add, edit, pause and remove named reminders with repeat days and a saved time zone. Verify daylight-saving behaviour.
- [ ] **ROUTINE-02 - Phone-owned alarm scheduling [SETUP]:** Choose a target Android phone, grant notification/exact-alarm access and verify its scheduling receipt, sound, reboot and cancellation.

### Talk and grow together

- [ ] **CORE-01 - Core Memory and personality [READY]:** Review and edit saved preferences, self-described traits and Nakama personality on PC or Android. Pause learning/reuse and forget notes.
- [ ] **CORE-02 - Fast manager and voice commands [PARTIAL]:** Receive a queued acknowledgement for AI work; ask for actual progress or manage boards/memory by supported local typed or voice commands.
- [ ] **WAKE-01 - Optional Nakama wake word [PARTIAL]:** Enable the visible local-recogniser listener, test wake/command/Stop and speech suspension. Engine and background limits remain device-dependent.

### Your phone and PC

- [ ] **DESK-01 - Android controls Windows [SETUP]:** Enable PC and device permissions; view snapshots, touch/drag/scroll/type, switch monitors at the top and Stop on either device.
- [ ] **LOC-01 - Own-phone location sharing [SETUP]:** Grant phone location consent; verify timestamp, accuracy, offline recovery and last-known display on PC. Confirm Stop and forget.
- [ ] **LOC-02 - Useful location without hidden sharing [PARTIAL]:** Open a chosen map/weather lookup from a saved fix; keep unrelated AI chat and other phones free of private location data.

Review note: No live microphone, GPS, alarm sound or remote input was used as a test. Continuous 24-hour availability is not guaranteed. Physical Android 16 acceptance remains open.

## Your fast companion and office

New checks - leave unchecked until you test. Speak to Nakama while named workers handle deeper tasks. Inspect real progress at their little screens.

### One fast point of contact

- [ ] **FAST-01 - Separate interaction model [READY]:** Save the fast Nakama role independently from planning/research/development. Start with Astra 6 low; retain existing deeper assignments.
- [ ] **FAST-02 - Appropriate question depth [PARTIAL]:** Compare short chat with detailed/current-fact questions. Verify the recorded route/model and answer, not just response speed.
- [ ] **FAST-03 - Responsive during background work [READY]:** While a project runs, ask for status and open another page. Distinguish accepted-work receipts from the eventual completed answer.

### Meet your named workers

- [ ] **OFFICE-01 - Mini Nakama desks [READY]:** Open Agent office on PC and Android. GPT agents are light green; Claude agents orange. Provider/status text remains readable.
- [ ] **OFFICE-02 - Stable, distinct names [READY]:** Newly spawned agents receive unique names; refresh/restart preserves each identity. No name-pool editing control is exposed.
- [ ] **OFFICE-03 - Truthful screen details [READY]:** Select an agent screen and inspect assignment, phase, model, effort, returned output or error. No fabricated thinking or terminal feed.
- [ ] **OFFICE-04 - Manager and child hierarchy [READY]:** See actual project manager/planner/developer/reviewer relationships. Waiting, cancelled, failed and finished states remain distinct.

### Move around by asking

- [ ] **NAV-01 - Nakama page navigation [READY]:** Ask to open Agent office, projects, tasks, routines, memory or settings. Navigate only the requesting client and honour unsaved drafts.
- [ ] **NAV-02 - No replay from old messages [READY]:** Refresh, reopen history and use a second device. Old navigation results must not move either screen again.
- [ ] **NAV-03 - Supported Android navigation [SETUP]:** Use voice/text for app pages and supported Android Home/settings/app opening; verify session/permission rules for global controls.

Review note: Office records show real work, not private model reasoning. No fastest-model or instant-reply guarantee. Current account and physical-device acceptance still matter.

## A fresh check after updating

Start here after installing both updated packages. Older ticks record earlier acceptance. Use these fresh boxes to retest your current setup on both Android devices.

### Keep your existing setup

- [ ] **RETEST-01 - Upgrade without data loss [SETUP]:** Quit PC from its tray; install Windows/APK updates over existing apps. Keep projects, accounts, pairing, settings and signing identity.
- [ ] **RETEST-02 - Boards and memory across devices [READY]:** Add/edit/complete/remove a disposable card and routine from both apps. Check memory edit, learning pause, reuse pause and forget.
- [ ] **RETEST-03 - One complete small project [SETUP]:** Use a disposable project; answer manager questions, inspect workers and both reviews, then distinguish delivered files from unexecuted tests.

### Physical Android 16 checks

- [ ] **RETEST-04 - Talk, widget and mascot [SETUP]:** On phone and tablet, test Talk entry, chosen voice, acknowledgement/final speech, interruption and background Stop.
- [ ] **RETEST-05 - Wake listener on both devices [PARTIAL]:** Check local engine availability, leading Nakama phrase, own-speech pause, visible Stop, background behaviour and battery use.
- [ ] **RETEST-06 - Alarm actually sounds and cancels [SETUP]:** Schedule a harmless test alarm; verify target, time zone, receipt, audible outcome, dismissal and received cancellation before relying on it.
- [ ] **RETEST-07 - Location and remote desktop [SETUP]:** Verify location age/accuracy/Stop/forget; use a harmless PC window for touch, text, monitor switching, disconnect and remote-session Stop.

### Privacy, recovery and evidence

- [ ] **RETEST-08 - Shared-data permission loss [READY]:** Temporarily disable test-phone Google/project access; office/history/boards/memory must disappear. Restore the intended grants afterwards.
- [ ] **RETEST-09 - Offline, Stop and restart [READY]:** Test a disposable job: Stop prevents later stages, PC restart reports interruption and reconnect does not replay commands.
- [ ] **RETEST-10 - Save and report acceptance [READY]:** Save/reopen this PDF. Record device, exact request, agent/task name, expected/actual result and error using docs/testing-guide.md.

Review note: No purchases, paid video, real messages/calls, deployments or destructive actions are needed for this regression pass. Keep account-dependent items unaccepted until observed.

## Bring your GitHub projects home

Existing GitHub projects on Windows and Android. Start with a disposable repository. Keep important dirty work untouched, and review every remote destination.

### Connect and import

- [ ] **GH-01 - Link the intended GitHub account [SETUP]:** Save a labelled token on Windows, verify it and select only intended repositories. Tokens must stay out of chat, Android, URLs and logs.
- [ ] **GH-02 - Import an existing repository [SETUP]:** List repositories or enter an exact GitHub HTTPS repository. Clone to a new managed folder; existing folders and app data stay intact.
- [ ] **GH-03 - Link an existing managed checkout [SETUP]:** Select its account and repository in Git changes. Confirm the displayed branch and destination before any network write.

### Review local and remote work

- [ ] **GH-04 - Fetch and fast-forward pull [SETUP]:** Fetch remote state, then pull a clean disposable checkout. Dirty files or diverged history must block pull without stashing/resetting your work.
- [ ] **GH-05 - Review a real local commit [SETUP]:** Select changed files, author and message; inspect before/after content. Commit exactly reviewed files, preserve unrelated staged work, and do not auto-push.
- [ ] **GH-06 - Changed files invalidate review [SETUP]:** Change a selected test file after preparing a commit. The old review must fail; prepare a fresh one. Existing staged selected files remain protected.
- [ ] **GH-07 - Explicit PC push approval [SETUP]:** Review repository, branch, exact commit and automation implications. Request push from either app; only fresh PC approval may perform it.
- [ ] **GH-08 - Remote changes and failures [SETUP]:** A changed destination, remote/local commit, removed account or revoked phone access must invalidate approval. Uncertain network results must not auto-retry.
- [ ] **GH-09 - No hidden execution or data leak [SETUP]:** Import/pull/commit do not run hooks, project scripts or dependencies. Disabled phones lose GitHub access; concurrent project writes are blocked.

Review note: A push can trigger repository automation or deployment. Review/decline approval without pushing if you do not want that effect. Live account acceptance is separate from fixtures.

## A wiser, smoother companion

Learning and interaction acceptance. Skills preserve useful methods as editable context. Motion should make the app pleasant without slowing down your next action.

### Teach, inspect and reuse

- [ ] **SKILL-01 - Teach a reusable method [READY]:** Save a name, purpose, when-to-use context and steps. Reopen the same skill on Windows and Android.
- [ ] **SKILL-02 - Teach by direct command [READY]:** Use Teach skill: NAME | When: CONTEXT | Steps: FIRST; SECOND. Verify a saved receipt without extra inference.
- [ ] **SKILL-03 - Relevant cross-agent reuse [SETUP]:** Inspect skill-selection records for matching manager/worker tasks. Unrelated, disabled and candidate methods stay out.
- [ ] **SKILL-04 - Reviewed-project candidates [SETUP]:** Inspect a successful project's method candidate and source. It stays unavailable for reuse until you accept it.
- [ ] **SKILL-05 - Edit, pause and forget [READY]:** Correct, disable and forget a test skill. Queued work rechecks permissions and settings before reuse.
- [ ] **SKILL-06 - Separate learning and reuse [READY]:** Pause each independently. Conversation memory off pauses both; saved methods remain editable.
- [ ] **SKILL-07 - Privacy and authority [READY]:** Disabled phones lose skills/receipts. Methods cannot grant permissions or override deployment/video approvals.
- [ ] **SKILL-08 - Honest adaptation [READY]:** Selection counts do not prove a method was followed or tested. No retraining, hidden trait inference or secret storage.

### Android feel on both devices

- [ ] **MOTION-01 - Fluid page and status changes [SETUP]:** Visit Chat, Projects, Tools and Agent office. Check scrolling, forms, readable transitions and immediate taps.
- [ ] **MOTION-02 - Reduce motion [READY]:** Enable Nakama Reduce motion and Android animation controls. Decorative motion should stop while navigation, status and all actions still work.
- [ ] **MOTION-03 - Responsiveness with voice [SETUP]:** While work runs, type, change pages and use Talk/Stop. Keep drafts/replies intact; note jank and battery impact.

Review note: No maximum-smoothness or measured frame-rate claim. Physical-device checks and live skill usefulness remain your acceptance work; new boxes begin unchecked.

## Project reports and easy navigation

Delivery update. Find your project files and take away a clear, honest PDF report.

### A report worth keeping

- [ ] **PDF-01 - Automatic project report [SETUP]:** Finish a small managed project. Confirm a PDF appears without an extra model call and failed rendering does not fabricate success.
- [ ] **PDF-02 - Honest outcomes [READY]:** Check summary, files, review results, executed-check receipts and unfinished acceptance. A submitted deployment is not called a healthy website.
- [ ] **PDF-03 - Useful safe images [SETUP]:** Include a selected project image or an untainted local-preview capture. Confirm private login frames are excluded.
- [ ] **PDF-04 - Open, save and print [READY]:** Open the report on Windows and Android, save a copy and inspect every page. Long descriptions must wrap without clipping.
- [ ] **PDF-05 - Control report generation [READY]:** Disable automatic reports for one project, generate a manual snapshot and delete only a report without deleting project files.

### Find the right file

- [ ] **FILES-01 - Folder navigation [READY]:** Use breadcrumbs, parent folders and filtering on both apps. Changing projects must clear old selections and previews.
- [ ] **FILES-02 - Text editing [READY]:** Read and edit a small text file. Protect unsaved changes when moving away or receiving external updates.
- [ ] **FILES-03 - Images and PDFs [READY]:** Preview bounded PNG/JPEG/PDF files and use Android's save destination. Corrupt or oversized files should fail clearly.
- [ ] **FILES-04 - Path and privacy boundaries [READY]:** Confirm traversal, links and credential-preview paths are rejected. Revoke shared access and check stale content clears.
- [ ] **FILES-05 - Upgrade preservation [SETUP]:** Install over the previous app. Keep projects, accounts, pairing, Android signing and every saved personal PDF checkbox value.

Review note: A local or generated report is evidence of saved receipts, not certification of real-world deployment, payment or physical-device acceptance.

## Nakama's internal browser

Delivery update. Watch browsing, test an approved local website and take over privately when needed.

### Browse and test

- [ ] **BROWSER-01 - Desktop browser sessions [READY]:** Open research and private sessions, use tabs/navigation and close them. Research is anonymous read-only with page JavaScript disabled.
- [ ] **BROWSER-02 - Local preview approval [SETUP]:** Review an installed Vite/Next preview script, start it on its assigned loopback port, open the page and stop the preview.
- [ ] **BROWSER-03 - Agent tools and receipts [SETUP]:** Run a small explicit research/local-test task. Confirm real browser steps and bounded output appear under the same agent; ordinary fast chat adds no browsing calls.
- [ ] **BROWSER-04 - Mini office screens [READY]:** Find the associated agent desk, see its live browser thumbnail and open it. Human/private sessions must stay hidden from agents.
- [ ] **BROWSER-05 - Network limits [READY]:** Confirm project tabs cannot escape their approved origin; research cannot access local/private networks, submit forms, use accounts or download files.

### Step in from Android

- [ ] **BROWSER-06 - Touch and typing [SETUP]:** Grant browser control to the selected Android device. Tap, scroll and type with a fresh frame; reject stale frames and a different controller.
- [ ] **BROWSER-07 - Private takeover [READY]:** Take over a project session, release it and confirm it remains permanently opaque to agents and report capture.
- [ ] **BROWSER-08 - Targeted phone handoff [SETUP]:** Send a session to one allowed Android. Confirm the intended device can act during its lease and another device cannot see private content.
- [ ] **BROWSER-09 - Questions and attention [SETUP]:** Enable notifications. Confirm generic lock-screen text, stable deduplication, an attention highlight and a fresh destination after tapping.
- [ ] **BROWSER-10 - Stop, revoke and reconnect [SETUP]:** Stop control or revoke pairing/shared permissions during work. Check pending callbacks, frames and actions do not revive the old session.

Review note: Sessions are visible bounded snapshots, not a frame-rate promise. Private sign-in cookies are not service API credentials. No live account action is an automatic development test.

## Website setup, service access and publication

Delivery update. Make the intended outcome, accounts and authority explicit before external work.

### Ask and authorize

- [ ] **SETUP-01 - Upfront project questions [READY]:** Describe a hosted website. Confirm repository choice, hosting, domain/email records, budget, shop/admin needs and acceptance questions appear before planning.
- [ ] **SETUP-02 - Answers from either app [READY]:** Answer setup/manager/delivery questions on either app, dictating on Android. Check partial answers and stale/duplicate submissions; unanswered questions block progress.
- [ ] **SETUP-03 - Targeted account setup [SETUP]:** Issue an expiring connection request to one phone. Save credentials only through its protected field; no secrets enter chat, reports, notifications or agent input.
- [ ] **GRANT-01 - Explicit bounded project grant [SETUP]:** Review exact account/action/resource settings, expiry and operation count. Defaults still require PC approval; free-text permission alone grants nothing.
- [ ] **GRANT-02 - Grant limits and revocation [READY]:** Revoke/expire/exhaust a grant. Changed accounts, projects, commits, secret references or DNS targets outside its exact scope must be rejected.

### Inspect actual delivery

- [ ] **DELIVER-01 - Review provider plans [SETUP]:** Prepare plans using saved accounts. Inspect GitHub/Vercel/Render/Neon/Namecheap fields without executing. Service creation may include an initial deploy.
- [ ] **DELIVER-02 - Intent and uncertain receipts [READY]:** Inspect synthetic tests for one-attempt writes, no automatic retry after uncertainty, preserved provider IDs and secret references. Deletion/purchases have no adapter.
- [ ] **DELIVER-03 - Post-review manager [SETUP]:** Start delivery after both reviews. Verify approval pauses, receipt-based continuation, stop/restart behaviour and questions sent to Android.
- [ ] **DELIVER-04 - Real website acceptance [SETUP]:** Only with your deliberate service authorization, verify deployment URL, custom DNS/TLS, frontend/backend/database, admin recovery and test checkout. Mark live acceptance only from actual results.
- [ ] **PUBLIC-01 - Publication privacy [SETUP]:** Check the public blank checklist/license/notices, scan current files and full Git history, and resolve historical personal data before changing visibility.

Review note: The perfume domain in the design request was fictional. Never buy or operate it. Real provider setup, costs, DNS propagation, OAuth and full shop acceptance remain user-controlled live tests.

## Managed build, check and repair

Managed execution update. Use actual command results before the team reviews and delivers your project.

### Approve and observe

- [ ] **EXEC-01 - Exact check approval [SETUP]:** Build a small project with supported root npm scripts. Inspect each script and its pre/post hooks on the PC before it runs; service grants cannot authorize commands.
- [ ] **EXEC-02 - Wait for real completion [SETUP]:** Observe the checking stage and actual task output. Both reviewers must wait for the command to exit, including after Stop.
- [ ] **EXEC-03 - Bounded repair and rerun [SETUP]:** Use a harmless failing test. Confirm the implementation worker receives actual diagnostics and each repaired rerun requires a fresh approval.
- [ ] **EXEC-04 - Both reviewers and final report [SETUP]:** After passing checks, confirm both independent reviewers see the recorded results. The summary and PDF distinguish executed checks from remaining live acceptance.

### Preserve control and honest limits

- [ ] **EXEC-05 - Changed source invalidates approval [SETUP]:** Edit included source while approval is pending. The old request must fail; changed files are preserved and cannot silently become reviewed.
- [ ] **EXEC-06 - Reject, expire, stop and restart [SETUP]:** Reject or expire a request, stop during a check, or restart the host. No later command, repair or delivery may resume from stale authority.
- [ ] **EXEC-07 - Android status and privacy [SETUP]:** See waiting/check results on the requesting Android. Approval remains on the PC; revoked shared access stops further workflow actions.
- [ ] **EXEC-08 - Unsupported and unavailable checks [SETUP]:** Confirm a project without supported scripts explicitly says checks were not executed. Missing runtimes/dependencies or generated source changes must never count as passing tests.

Review note: Local fixture checks do not establish live model eligibility or a working hosted site. Dependencies, migrations, payments and final-domain acceptance remain separate work.

## General autonomous tasks

General task engine update. Give Nakama a bounded outcome and inspect the evidence it gathers through its available tools.

### Run and inspect

- [ ] **TASK-01 - Saved task and actual progress [PARTIAL]:** Start a small research or selected-project task. Confirm one task-board card, actual manager activity, saved decisions and tool receipts.
- [ ] **TASK-02 - Questions before dependent work [PARTIAL]:** Give an incomplete goal. Answer the manager's saved questions and confirm stale answer revisions do not overwrite newer answers.
- [ ] **TASK-03 - Exact project-check approval [PARTIAL]:** Request a harmless existing npm check. Confirm no command starts before its exact PC approval and progress waits for the saved exit result.
- [ ] **TASK-04 - Separate verification [PARTIAL]:** Inspect a fresh verification observation. Reads, accepted clicks and passing scripts must not certify arbitrary goal completion; the result remains reviewable.

### Preserve boundaries

- [ ] **TASK-05 - Stop, restart and explicit resume [PARTIAL]:** Stop before approval or restart during work. Pending commands must not run; explicit Resume uses saved receipts without automatically replaying attempted operations.
- [ ] **TASK-06 - Private content stays private [PARTIAL]:** Confirm login/private browser content, pixels, credentials and protected project files are unavailable to the task manager and reports.
- [ ] **TASK-07 - Android upgrade and privacy [PARTIAL]:** Install the signed APK in place, retain pairing and app data, inspect task questions/results, then verify disabled shared access hides task data.
- [ ] **TASK-08 - General autonomy limits [PARTIAL]:** Confirm readiness distinguishes this bounded engine from future Windows app control, authenticated online forms and hands-off website delivery. Live acceptance remains separate.

Review note: Use synthetic local examples for development tests. Physical devices retain their data. No live or paid model calls, sends, calls, deployments, purchases or DNS writes are acceptance shortcuts.

## Local website preparation

Local website preparation update. The first autonomy benchmark is a locally built and verified website. Keep setup, tests and acceptance distinct.

### Exact dependency preparation

- [ ] **LOCAL-01 - Review locked setup [PARTIAL]:** With model allowance available, inspect the exact package/lockfile approval. npm ci replaces node_modules; lifecycle scripts stay disabled and unsupported configuration is preserved.
- [ ] **LOCAL-02 - Recorded setup outcome [PARTIAL]:** Confirm later checks wait for process close, a saved exit result and unchanged hashes. Missing node_modules after exit zero must stop progress; installation is not a passed website test.
- [ ] **LOCAL-03 - Interrupted and changed setup [PARTIAL]:** Change a reviewed lockfile or cancel before launch. No stale install may start. Failed or uncertain setup must stop for attention without an automatic reinstall.

### Preview and acceptance

- [ ] **LOCAL-04 - Approved task preview [PARTIAL]:** Request a supported local preview from a task. Review its exact PC approval, then inspect a separate fresh browser observation; a launched process alone must not mean ready.
- [ ] **LOCAL-05 - Stop only the owned preview [PARTIAL]:** Stop the task's exact preview and wait for its process to close before another check. A different task's or manually launched preview must remain outside its authority.
- [ ] **LOCAL-06 - Actual website benchmark [PARTIAL]:** After Claude allowance returns, build a small local site through both planners and reviewers, then verify its agreed page behavior. Keep missing lockfiles, generated outputs and unrun functional acceptance marked unfinished.

Review note: Live project-agent acceptance is on hold until Claude usage is available. Local simulated fixtures do not establish model quality, site functionality or hands-off hosting.

## Low-cost monitoring

Monitoring update. Local checks watch an exact website or application without an AI call on each poll.

### Reliable local checks

- [ ] **MON-01 - Save and resume [PARTIAL]:** Create a paused monitor, check its condition and interval, then explicitly start. Pause, expiry and restart must prevent unnoticed work.
- [ ] **MON-02 - Stock and language [PARTIAL]:** Check an exact product's structured availability or text in its own language. Missing, mixed or changed evidence stays unknown.
- [ ] **MON-03 - No hidden cost [PARTIAL]:** Confirm ordinary checks use no model calls and failures back off. The PC must be awake; no paid fallback or retry storm is allowed.

### Private shopping handoff

- [ ] **MON-04 - Dedicated saved login [PARTIAL]:** Sign in privately using only Nakama's isolated profile. Restart retains that profile; Forget removes its cookies. No installed profile is imported.
- [ ] **MON-05 - Check delivery yourself [PARTIAL]:** Privately verify account and delivery details, then attest setup. An out-of-stock product may prevent a checkout rehearsal.
- [ ] **MON-06 - Exact cart recipe [PARTIAL]:** On a supported native-form shop, approve product, variant, quantity one, currency and price cap. Changed or unsupported forms stop; payment and order placement stay human.
- [ ] **MON-07 - Challenge and queue [PARTIAL]:** A CAPTCHA or queue pauses automation in the same session. No bypass, automatic challenge refresh or uncertain cart replay is allowed.
- [ ] **MON-08 - Notifications and voice [PARTIAL]:** Open a current permitted alert on Windows/Android or ask to open the CAPTCHA/checkout. Stale or ambiguous requests must not open another private session.

### Application observation

- [ ] **MON-09 - Windows application [PARTIAL]:** Watch the exact process/window-title condition. Confirm this is read-only and does not claim to understand arbitrary app contents.
- [ ] **MON-10 - Android consent [PARTIAL]:** Explicitly allow the exact foreground app with visible Stop. Locked, sensitive, expired, revoked or offline observation must not share screen text.

Review note: Real shop checkout, Pokemon Center compatibility and physical notification/background behavior require separate acceptance. Fixture checks never purchase or enter payment details.

## Dynamic upgrade

Self-maintenance update. Nakama prepares improvements separately and waits for your exact update approval.

### Private source and model controls

- [ ] **UPG-01 - Saved requests on hold [PARTIAL]:** Save an improvement without inference. Only explicitly release a development run after allowance returns; no date-triggered or paid fallback is allowed.
- [ ] **UPG-02 - Isolated source [PARTIAL]:** Prepare a separate source candidate excluding credentials, runtime state, cookies, personal checklist values and signing keys. Preserve the running installation.
- [ ] **UPG-03 - Existing team and questions [PARTIAL]:** Use saved configurable roles, manager-routed questions, approved checks and both independent reviews. Do not waive either review.
- [ ] **UPG-04 - Actual readiness [PARTIAL]:** Changing the candidate after tests/review must block packaging. Missing, failed or stale receipts must not become a passing update.

### Signed artifacts and recovery

- [ ] **UPG-05 - Trusted signed package [PARTIAL]:** Verify exact artifact hash, signed release manifest and publisher. Reject unsigned, tampered, incompatible and untrusted updates.
- [ ] **UPG-06 - Fresh PC approval [PARTIAL]:** Review the exact update and previous recovery artifact. Finish active work and close browsers before protected backup and installer handoff.
- [ ] **UPG-07 - Preserve identity and data [PARTIAL]:** Retain accounts, projects, pairing, preferences, browser profiles and Android signing identity. Verify the local recovery backup without publishing it.
- [ ] **UPG-08 - Honest installation outcome [PARTIAL]:** Treat installer launch as unverified installation. Check the new installed version and health separately; inspect interrupted outcomes without automatic retry.

Review note: Current Windows packages are unsigned. Production signing, full live development, installed update health and deliberate recovery need acceptance. No installed profile is a disposable fixture.

## Verification record

Use one row per accepted feature. Do not mark a device-dependent feature complete from an emulator alone.

| Feature ID | Build / commit | Device / account | Evidence and result | Verified date |
| --- | --- | --- | --- | --- |
| | | | | |

## Rebuild

Install Python packages `reportlab` and `pypdf`, then run `python scripts/build_checklist.py`. The builder writes Markdown and the PDF from the same feature data. It preserves saved PDF ticks by stable feature ID; new fields start unchecked. Back up annotated personal copies: rebuilding preserves checkbox values, not other annotations. Markdown evidence does not synchronise with PDF ticks. Run `python scripts/verify_checklist.py --roundtrip` to validate fields and saved states using temporary test copies.
