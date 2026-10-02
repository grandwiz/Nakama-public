# Permissions, connections, and private data

Nakama is a personal tool with powerful intended capabilities. This guide describes the actual design boundaries so permissions remain understandable.

## Two different identities

The desktop owner can configure the workspace, connect accounts, issue pairing tickets, revoke devices, and approve high-impact operations. A paired phone or browser has its own device identity and token. Pairing does not grant the right to approve its own deployment or project-deletion request.

The owner can disable each Android device's project or Google access and explicitly enable browser relay. Chrome credentials are restricted to receiving/reporting that browser's actions; they have no general project or Google API access.

Agent office follows the shared project/Google data boundary. Its names and coloured desks are labels for actual workflow/task records; they do not create new credentials or permissions. The internal name pool has no editing API. A generated name is not a security identity.

App navigation accepts only recognised direct requests to fixed destinations. The immediate response applies only to the requesting client, respects draft guards and is not replayed from saved messages. Android system navigation uses explicit local commands and existing permission/session boundaries. A request to open settings never grants a permission itself.

Learned skills follow the same owner/permitted-Android boundary as Core Memory. Google-disabled and project-disabled devices cannot read, teach, edit or reuse shared skills; queued mutations and provider startup recheck access. These methods are ordinary local data, not executable plugins or permissions. Explicit teaching uses a narrow direct command or editor. Workflow-derived candidates start disabled and require inspection and acceptance before reuse. Their source and static reviews do not prove tests or actions ran. Relevant prompt references are bounded, labelled untrusted and subordinate to current instructions and approval rules. Recognised credentials are rejected, but the library is not a secret store or a complete prompt-injection defence. See [skill controls and retention](learned-skills.md).

Browser relay authority is checked again after a queued host mutation or delayed approval. Revoking a phone or disabling its browser-control permission removes its undelivered relays and stops redelivery of dispatched ones; an already executing browser action can still report its outcome. Re-enabling permission does not automatically restart those stopped deliveries.

Turning off Google access hides shared conversations, task output, approvals and Google account details from that device. AI chat is also disabled for that device in this preview: the current CLI workers have local file-reading tools, so hiding API responses alone would not protect saved mailbox history. Project browsing and the phone's own direct-action results remain available when project access is enabled. Revocation or disabling project/Google access stops that device's active AI tasks; an operation already in flight may still finish. A phone can stop only tasks it started. Information deliberately saved inside a shared project remains available through project access.

Tickets expire quickly and can be used once. Device tokens are stored as hashes on the host. Revoking a device invalidates its next authenticated request; a command that already reached a device may have started and must be checked rather than blindly repeated.

## Network boundaries

Android connects to the HTTPS service on port 43110 and pins the exact host certificate received during pairing. The private-network listener is off by default. Use a private network for mobile access and explicitly configure Windows Firewall for that network if needed. No router port forwarding is required or recommended.

Chrome on the PC uses a separate HTTP bridge bound only to 127.0.0.1:43111. It accepts Chrome device credentials and cannot be reached directly from the phone's network. Browser control requires an explicit, pairing-bound two-hour session and Chrome's optional website grant; eligible ordinary tabs are included automatically.

The provider CLIs are local child processes. Nakama does not expose a raw provider app-server or unrestricted terminal socket on the network.

## Why commands need approval

A selected project folder is not a Windows sandbox. Arbitrary commands can access anything the current Windows account can access, including files outside that folder. A command can also deploy or delete indirectly, so a keyword filter would not make an always-ask promise reliable.

CLI workers use restricted analysis/planning modes. Host operations validate paths and handle writes. Raw commands are stored as exact executable/argument requests and require desktop approval. Approvals cannot be changed into a different operation when accepted and cannot be replayed.

The Project checks panel also requires approval for every run. It shows the selected npm script and its pre/post scripts, binds the root package manifest and runner configuration, and rejects stale requests. npm invokes project code through a shell with Windows-account access. Script names do not prove safety: a `test` script can deploy, delete or contact a paid API. The installed toolchain is trusted, referenced source and dependencies are not frozen, and npm offline settings do not prevent a script's own network access. See [the check workflow](project-checks.md).

Windows **Repair this failed check** is a separate, explicit request for one file-building attempt using a server-recorded failure. It does not trust client-supplied logs or let a diagnostic message authorise commands. The resulting rerun gets a new pending desktop approval; the original task and approval are not reused. Stop invalidates a pending linked approval and prevents later repair steps, but cannot undo an operation already committed. Restarted repairs are interrupted and need review. This is a guided single attempt, not an unattended repair loop.

In Do a task mode, the model proposes a bounded plan; it does not grant itself permission. Nakama validates every step and checks account/device identities before the first effect, then dispatches with the original caller's permissions. Claude's action planner has built-in tools disabled. Codex retains read-only tools, so its prompt instruction not to read files is not a hard no-file-access boundary. An empty assistant folder is used when no project is selected; this does not turn the CLI into a full Windows sandbox.

Stopping an action plan prevents later steps. An external request already in flight, or a phone action already queued, may still complete. Check its result before retrying. These plans do not run a continuous autonomous browser or phone-control loop.

Project paths are canonicalised. Traversal, symbolic links/junctions, protected metadata, alternate data stream syntax, and invalid device filenames are rejected by file operations. This is defence against remote input, not a claim that an already-compromised local administrator can be contained.

## Credentials and accounts

Windows stores provider credentials and transport private keys through Electron safeStorage, backed by Windows protection. Android uses its Keystore-backed pairing store. Chrome stores only its scoped pairing credential in extension storage, never your AI account password or API key.

Google account sign-in uses a desktop OAuth flow with a loopback callback, a state token, and PKCE. Personal and business Gmail/Calendar accounts can be kept as separately labelled records. Choose the account for each action.

Before every provider task, Nakama removes inherited API-key and alternate-provider environment settings and checks the official client's selected authentication method in the same working directory. Codex must report the recognised ChatGPT login; its task configuration pins that login and the OpenAI provider. Claude must report a first-party subscription with no API-key source; worker settings pin Claude-account login and disable user/project settings. Unknown or API-based authentication is rejected, rather than treated as a subscription connection. Saved credentials can still expire and need re-login.

Kling is a separate optional video integration. The official CLI retains its own sign-in; Nakama does not ask for your Kling password or copy browser cookies. The MCP may prepare and inspect video jobs but cannot approve one. Generation remains disabled until the owner enables it, and every job still requires an exact desktop approval. These protections apply to Nakama's adapters, not to unrelated applications you run on Windows. Provider quotas and account terms still apply.

Subscription sign-in does not disable a provider's account-level extra-usage purchases. Keep those provider-dashboard controls off if you want no additional charges.

GitHub network requests bind an explicitly selected saved account and repository; local commit reviews bind the checkout and selected bytes. Both Google and project access are required on Android; restricted device state omits the new link and operation metadata. HTTPS `github.com` is the only Git transport destination. Repository helpers, custom programs, includes, URL rewrites and proxies are rejected. An isolated Git profile and fixed bundled credential helper keep the vault token out of URLs, argv, repository configuration and persisted state. The token exists briefly in the child environment/private helper pipe; another process with sufficient local account access is outside this boundary. Import does not run repository scripts or install dependencies.

Every GitHub push requires fresh PC approval because repository automation can deploy, spend credits or notify others. The request pins the account credential, link, exact commit, branch and remote state. It proves an existing remote commit is an ancestor before using an exact conditional lease, then confirms the remote result. It does not allow unconditional force pushes. Changed state or uncertain transport requires inspection and a fresh review, never a silent retry. Fetch only updates local objects/tracking refs; pull accepts only clean, fast-forward updates. See [GitHub operation boundaries](github-projects.md).

## Phone and browser observations

Accessibility/overlay/microphone capabilities need explicit Android enablement. A visible active session and stop control accompany broader app interaction. Protected screens, authentication, and inaccessible controls may need manual input.

Content read from a page, app, email, or document is untrusted data, not fresh authorisation. Do a task does not automatically feed retrieved email or calendar results back into another planning round. Normal discussions can include conversation context; a prompt instruction alone is not a general defence against all malicious content a model may read.

The separate Chrome extension uses an explicit browser-wide session over eligible ordinary tabs; private/incognito, internal and recognised protected pages are excluded. Protected inputs and recognised publish/deploy/delete controls are blocked for automatic operation. Label and URL checks cannot establish every possible effect of arbitrary website JavaScript, so this is not a guarantee of safe unattended control on every site. Visible-tab screenshots check the active tab, document, focus, session and permission throughout capture and block recognised sensitive fields and detected uninspectable content. Closed shadow roots on ordinary elements can remain undetected; visible secrets can still appear in captures. This is not guaranteed secret redaction. Only ten recent image payloads remain in host history; compact receipt digests preserve duplicate-result checks after older images are omitted. Extension full-page capture, complete cross-frame coverage and unrestricted autonomous browsing are unfinished. The internal browser has a separate bounded research/local-test loop described below. Android control also depends on OS permissions and app-specific behaviour; automated WhatsApp calls and Discord username sending are unfinished.

The app distinguishes prepared, started, needs-user, completed, failed, and unverified results. Opening a composer does not mean a message was sent; opening a call intent does not mean a call was answered.

Chrome-extension native dropdown selection uses an exact option value, rejects disabled/protected/ambiguous targets, and applies the destructive-action guard to the control, selected option and associated form. Selecting an already chosen value does not emit duplicate input/change events. Website event handlers may still save data or perform other actions; a verified selection only describes the observed control state. Custom dropdowns and multiple-selection controls remain manual.

## Internal browser, private handoffs and reports

The bundled Chromium browser uses isolated temporary sessions by default; explicitly created website monitors use dedicated persistent private sessions. It imports no installed browser profile, disables Node integration, enables context isolation and denies page permissions. Popups, downloads and file pickers are blocked. Research strips cookies/authentication, disables page JavaScript, permits only GET/HEAD and disallows form input. Its proxy resolves a public HTTPS hostname, validates the addresses and dials the checked address; private/link-local/loopback destinations are blocked. Dynamic/account-only websites can fail under these limits.

Local project browser traffic is confined to the exact loopback origin of a held, approved preview, including subrequests. Preview launch executes project code with the Windows account's authority; it is not an OS sandbox or proof that the approved child owns the chosen port. Browser containment does not make arbitrary project scripts safe.

Agent browser tools are bound to a real task and a bounded step budget. Page content is untrusted evidence. Sensitive-page detection pauses the session, and human takeover permanently makes it opaque to agents. Releasing control does not undo this taint; further automation needs a fresh session. Agents receive bounded text/element references, never private login images or stored cookies. Authenticated dashboard mutations are not exposed through this agent route; scoped service APIs handle supported writes instead. Detection cannot guarantee that arbitrary page text never contains private data, so review content before choosing to share it.

Human desktop/Android controls require an active controller and fresh single-use frame. An explicit owner handoff shares a private session only with the selected paired Android device, with browser/project/Google access and a short inactivity lease. Permission loss, revoke, Stop and session closure end access. No passive state request captures a screenshot.

Account connection handoffs are separate ten-minute, one-use requests. They can add a new labelled connection, never retrieve or overwrite an existing secret. User-entered credentials travel directly over pinned transport to the Windows vault and are cleared from the client field. Permissions are rechecked during save; cancellation/revocation removes a newly written orphan key. Browser login by itself does not connect an API account. Notifications contain generic attention text and IDs, not credentials, questions or URLs.

Reports are escaped data-only HTML rendered offline in an isolated window with scripts/remote resources disabled. They may use bounded selected project PNG/JPEG files or already-captured untainted project-browser images; private/login sessions are excluded. Files are path-contained with link, size and header checks and fresh permissions. Reports reside in private host data, and may still contain private project content. A report is a receipt summary, not a certification of unrun checks or live acceptance.

## Typed service plans and bounded grants

Provisioning uses fixed provider origins, strict action/field allowlists and selected account/project identities. Raw credential values never enter plans, model context or public state. Protected environment values use immutable project-scoped vault references. There are no generic URL, service-delete, purchase or upgrade actions.

An exact PC approval authorizes a prepared plan. Alternatively, the PC owner may explicitly approve a project grant bound to the project location, account, action, exact settings, expiry and quota. Maximums are 24 hours and 30 operations; the UI starts with one hour/one operation. Changed commits, secrets, nameservers, account or project do not inherit permission. Grants do not cover local deletion, Git pushes, Kling or general shell commands. Service deletion is unsupported regardless of grants.

Dispatch rechecks authority and records the attempt durably before the write. A plan is attempted at most once; a lost response remains unconfirmed and must not trigger automatic retry. In-flight operations may finish after Stop, which prevents subsequent dispatch but cannot undo external effects. The post-review delivery coordinator also checks the reviewed workspace before each effect and approval continuation; restart interrupts active coordination. Provider metadata is not proof of application health, DNS propagation, schema correctness or payment acceptance.

## Spending and irreversible actions

Kling generation starts disabled. A signed-in Kling account and owner enablement do not replace the separate desktop approval required for every video. Kling credits are separate from ChatGPT and Claude subscriptions. Account credit availability is not an exact job quote or guaranteed spending cap; unknown cost stays unknown. No credit purchase or automatic paid fallback is built into this workflow. An uncertain submission must be checked using its existing task identifier when available, never automatically retried as a new generation.

Deployments and project deletion always need explicit approval. Typed service provisioning may consume a previously PC-approved exact matching project grant; it cannot infer one from chat. Legacy deployment routes, Git pushes and local deletion retain fresh PC approvals. A model response, a remote device, or the ordinary-action setting cannot switch off these rules.

## Data lifecycle

History and preferences remain local unless relevant context is sent to the selected AI provider for a task. Model-provider processing follows that provider's account and service terms. Android uses its bundled offline recognizer by default and identifies the optional Android-service Talk route if explicitly enabled and needed; that optional service may send audio to its provider.

Credentials are encrypted; general local history and project metadata are ordinary files protected by your Windows account's filesystem access, not a separately encrypted database. Disconnecting Google removes local credentials but does not revoke the grant in your Google account; use Google's account security page to revoke that grant as well.

File-build recovery is designed to preserve edits, but an unrelated Windows process can race the final filesystem operation. A crash mid-batch requires checking the recovery manifest. The current exclusive new-file operation requires a filesystem that supports hard links, such as a normal NTFS project drive; unsupported filesystems fail safely.

Local Git checkpoints are owner-only and require an exact file/message review. The host binds the workspace, HEAD, index, Git configuration and selected content, then rechecks them before creating a unique local ref. A temporary index preserves the user's staging; hooks, signing, automatic maintenance, external filters and network Git protocols are disabled. Prepared reviews expire after ten minutes and each is used at most once; a confirmed duplicate request returns the same receipt. A ref transaction also checks HEAD before creating the ref. These controls coordinate Nakama operations, but do not isolate Git from unrelated local processes.

Checkpoint previews reject recognised credential paths/content rather than silently hiding content that would still be committed. Detection is incomplete, and existing HEAD/history remain in the resulting commit. No checkpoint is uploaded automatically. A lost result must be inspected using its local ref before retrying. Checkpoint restore and general merge controls remain unfinished; see the [checkpoint guide](git-changes.md). An explicitly approved GitHub branch push is available separately and does not automatically include checkpoint refs.

Reviewed local commits use the same bounded text inspection but advance the selected branch and update only selected index entries. Already-staged selected files are rejected; unrelated staging and all working files remain untouched. Git ref/index guards complement Nakama's project-operation reservation. If branch advancement or index finalisation is uncertain, the recovery journal and owned index lock are retained; further mutations stop until manually inspected. Do not remove those records or repeat the commit blindly. These checks preserve ordinary user changes; they are not an OS sandbox against another local process.

Forgetting a skill removes its retained selection receipts and task-to-skill references, while original project files and history remain. Completed-workflow markers prevent the same delivery from recreating a forgotten candidate. Learning and reuse can be paused separately; the global conversation-memory switch pauses both automatic paths without deleting the library. Only relevant accepted methods are sent to the configured provider, not the whole skill collection.

Repository ignore rules exclude runtime app data, keys, caches, and build products. Never copy a vault or signing key into GitHub. Back up signing keys securely outside the repository if you intend to keep updating a privately signed APK.

Personal filled checklists and runtime data must remain local. This source snapshot excludes private history, screenshots, reports and generated packages; inspect your own changes before publishing them.

## Monitoring and self-maintenance

Website monitors retain cookies/site storage in private per-monitor Chromium partitions. Models receive no private DOM, pixels, address, password or payment information. Paired-device sharing is explicit and revocable; alerts carry generic record identities and resolve fresh authority before opening a private session. Polls disable page JavaScript and writes. An optional exact PC-approved native cart recipe permits one pre-recorded cart attempt, validates an empty then exact cart, blocks POST redirect replay and never pays or orders. Unsupported evidence stops with human attention. App observation is read-only and scoped; Android adds visible expiring consent and local-only text matching. See [monitoring](monitoring.md) for capability limits.

Self-maintenance stages tracked working source into a separate candidate, excluding Git history and private runtime data. Provider execution remains held until explicit owner release. Readiness requires unchanged reviewed source, actual approved checks and both independent reviews. Trusted signed manifests, Windows Authenticode, exact PC installation approval and verified private recovery copies guard handoff. Adding publisher trust itself requires local PC authority. A publisher's Android certificate field is an attestation; Android verifies actual installation compatibility. Backup/handoff blocks concurrent host mutations, and an uncertain dispatch is never replayed. Backup copies contain sensitive host/browser data and must stay private. Installed health and automatic rollback remain unimplemented; see [Dynamic upgrade](dynamic-upgrade.md).

This is an early implementation. Consult the status report and tests for verified boundaries; security testing on actual devices and provider connections is still necessary before broad unattended use.

## Android voice and app-name selectors

The wake listener remains explicitly enabled, local-recognizer-only, visible and stoppable. Captured background questions use the normal paired host route and existing account/approval boundaries, with no automatic resubmission after an uncertain POST. Only reply IDs from that request are eligible for speech. Stop, locking and pairing changes cancel the wake conversation; phone-control requests still require their existing foreground handoff and exact-app consent. No microphone starts merely because the app is installed.

Installed-app lists contain bounded launcher-visible labels and package IDs, supplied by the authenticated Android itself. Windows-owner picker access is short-lived and volatile; catalogs are excluded from shared state, model prompts and persisted history. Labels never grant authority. The miniature computer is a generic activity illustration and does not capture any private screen.

## Local clock, timers and continuous wake input

Android handles exact local greeting, current-time/date and supported timer requests before the paired-host route. Phone timers use separate app-private storage, revision-bound alarm/dismissal intents and Android's explicit notification/exact-alarm grants. They do not gain remote control or shared-account access. Permission failure is displayed as a paused timer, not a claim that an alarm was scheduled. PC timer records, chat receipts and attention events remain scoped to the owner or originating permitted Android caller.

Wake and default Talk input use a bundled native English recognizer. Build-time model assets are pinned and checksum-verified; first use verifies and extracts APK assets into bounded private app storage without a runtime download. Live microphone PCM is decoded in memory; no audio file or pre-wake transcript is retained. Only completed recognition results can enter command handling, and Stop, audio takeover or screen lock closes capture and invalidates queued callbacks. Wake authority comes only from the dedicated detector's configured Nakama/Hey Nakama keyword labels, not arbitrary ASR output or fuzzy spelling aliases. The bounded audio handover preserves the request after that event. Capture has a separate worker; a full queue fails the request rather than silently dropping words. Capture or decoder failure pauses instead of switching to a network recognizer. Android text-to-speech remains separate and uses only the chosen available offline voice. Nakama does not mute system audio. Physical recognition accuracy, battery use and device lifecycle behavior remain acceptance work.

## Device delivery and explicit remote targets

Conversation receipts, tasks and ordinary attention derive their delivery identity from the authenticated requesting principal. Android filters speech, notifications and its action inbox by exact identity; unknown legacy message ownership defaults to PC inspection rather than broadcasting. The PC can inspect work without creating Android delivery authority. Mandatory owner approvals retain their PC route.

Remote app/timer commands use a separate deterministic route: unique paired names or exact IDs, current permissions/connection, and a fresh target app catalog where needed. Model-selected action arguments cannot grant another Android identity. Execution targets and reply recipients are separate. Multi-device alarms carry explicit target IDs and independent version-bound schedule receipts; clients schedule only their own membership. See [routing behavior](device-routing.md).
