# Nakama local protocol - implementation contract

Version: 1. This is the shared implementation contract for the Windows host, desktop UI, Android client, and Chrome extension. Implementation and test status belong in the checklist, not this contract.

## Transport and identity

The host uses HTTPS on port 43110. It defaults to loopback; the owner can enable a private-network listener for paired devices. Remote use is intended over a private VPN, with no public port forwarding. Android pins the host certificate fingerprint shared by the desktop during pairing. Each device gets a revocable bearer token; only its hash is persisted. Pairing tickets have a short expiry and can be redeemed once. The desktop UI uses an isolated preload IPC bridge and never receives provider secrets.

Chrome uses a separate HTTP bridge bound strictly to `127.0.0.1:43111`, with Host/Origin checks. Android and Chrome tokens are not interchangeable across transports. Chrome tokens can only poll and report their assigned browser actions; they cannot access project, Google, or settings APIs.

`Authorization: Bearer <device token>` is required for device API calls except pairing. The desktop's internal principal is available only through Electron IPC. A paired phone is not a desktop administrator. Responses are JSON; failures use `{ "error": "human readable message" }` and the appropriate HTTP status.

## Desktop bridge

`window.nakama.api(method, path, body?)` returns parsed JSON or throws an Error. `window.nakama.chooseFolder()` returns a selected absolute path or null. `window.nakama.openExternal(url)` opens an allowed HTTPS documentation or provider login URL. `window.nakama.onEvent(callback)` subscribes to state changes and returns an unsubscribe function. The renderer can refresh `GET /api/state` when notified.

`copyText(text)` writes bounded text to the Windows clipboard. `openProjectFolder(projectId)` opens only a validated project under the configured root. These native operations check that the caller is the main renderer frame.

## State and routes

### Website setup and delivery

These routes require the Windows owner or a paired Android device with both project and Google access. Browser sessions and private account handoffs additionally require the device's explicit `browserControl` permission. Chrome credentials do not grant these capabilities. `state.projectIntakes`, `projectDeliveries`, `projectGrants`, `connectionHandoffs`, `browserStudio` and `attention` are permission-filtered projections; raw credentials, internal snapshots and private storage paths are excluded. Reports and provisioning details use their project-scoped routes.

| Route | Request/result |
| --- | --- |
| `GET /api/project-intakes` | `{intakes:[...]}` with saved setup questions and revisions. |
| `POST /api/project-intakes` | `{message,projectId?}` → `{intake,intakeId,taskIds:[]}`; no provider call or remote creation. |
| `POST /api/project-intakes/:id/answers` | `{revision,answers:[{id,answer}]}` → updated intake. A stale revision fails with 409. |
| `POST /api/project-intakes/:id/start` | `{revision,projectId?,name?}` → managed-workflow start result. All required answers must be saved. New `name` creates a local managed folder, not a remote repository. |
| `POST /api/project-intakes/:id/cancel` | `{}` → cancelled intake; does not erase project files. |
| `GET /api/projects/:id/delivery` | `{runs:[...]}` with coordinator receipts, questions, task IDs and status. |
| `POST /api/projects/:id/delivery/start` | `{workflowId}` starts against a completed dual-reviewed workflow in this project and unchanged reviewed files. |
| `POST /api/project-deliveries/:id/answers` | `{answers:[{id,answer}]}` saves answers and resumes only when complete and still authorized/current. |
| `POST /api/project-deliveries/:id/stop` | `{}` stops later steps and pending linked approvals; applied external effects are not undone. |

An intake has `id`, `message`, optional `projectId`, `requestedBy`, `status`, `revision`, timestamps and `questions:[{id,key,question,answer,answeredBy?,answeredAt?}]`. Answers allow 1–12 entries per request, at most 2,000 characters each; recognized credentials are rejected. At most 20 unfinished setups are retained as active. States include `awaiting_answers`, `ready`, `planning` and `cancelled`. Hosted setup can request a post-review delivery stage; an explicit local-only setup skips it.

Delivery statuses include `running`, `awaiting_approval`, `awaiting_answers`, `review_required`, `needs_attention`, `stopped` and `interrupted`. Approval completion starts a fresh guarded continuation; no model silently waits for the user. Active runs are interrupted on restart. The manager never supplies a trusted `liveVerified` flag. Git publication, dependencies, migrations, payment setup and end-to-end acceptance remain separate operations. See [delivery behavior](project-delivery.md).

### Typed service provisioning and project grants

`GET /api/provisioning/schemas` returns `{actions}` containing the fixed action-to-field allowlists. `action` in a plan is fully qualified, for example `vercel.project.create`; its `provider` must agree. Payload fields outside the schema are rejected.

| Route | Request/result |
| --- | --- |
| `GET /api/projects/:id/provisioning` | `{version:1,plans,operations,secrets,limits}`; secrets are references/metadata only. |
| `POST /api/projects/:id/provisioning/prepare` | `{provider,accountId,action,settings}` → frozen public plan with `id,hash,projectId,provider,accountId,action,settings,includesDeployment,summary,createdAt,expiresAt`. No write. |
| `POST /api/projects/:id/provisioning/secrets` | Owner-only `{name,value}` → immutable project secret reference. Raw value is vault-only. |
| `POST /api/projects/:id/provisioning/request` | `{planId,planHash}` → pending `service_provision` PC approval for those exact settings. |
| `POST /api/projects/:id/provisioning/execute` | `{planId,planHash,grantId}` executes only under a matching existing active grant. |
| `POST /api/projects/:id/provisioning/verify` | `{operationId}` performs supported read-only receipt verification for an operation in this project. |
| `GET /api/project-grants` | `{grants:[...]}` without host paths. |
| `POST /api/project-grants` | `{projectId,scopes:[{provider,accountId,action,match}],hours,maxOperations}` → pending `project_grant` PC approval, not an active grant. |
| `DELETE /api/project-grants/:id` | Revokes an existing grant. |

Supported plan actions are `github.repository.create`; `vercel.project.create`, `vercel.deployment.create`, `vercel.environment.set`, `vercel.domain.add`; `render.service.create`, `render.environment.set`, `render.deployment.create`; `neon.project.create`, `neon.connection.store`; and `namecheap.nameservers.set`. Consult the schema and labelled UI for exact fields. Environment operations require a project `secretRef`. Neon connections remain in the vault. There is no arbitrary URL, service-delete, purchase or upgrade action.

Grant scope `action` omits its provider prefix, for example `project.create` for Vercel; `match` must equal the canonical prepared settings. Grants allow 1–12 scopes, 1–24 hours and 1–30 operations. Project/account/location, exact settings, expiry, quota and requester permissions are checked again at dispatch. Existing generic commands, Git pushes, local deletion and Kling do not consume these grants.

Plans expire after 30 minutes and are single-attempt. Attempts are durably recorded before dispatch. Operation statuses distinguish `started`, `submitted`, `unconfirmed` and `blocked`; restart converts uncertain started attempts to unconfirmed, not a replay. Verification can update provider metadata without claiming application health. Render service creation includes initial deployment; Vercel project creation alone does not deploy/link Git. Provider READY/live metadata is not certification of the whole website.

### Private connection handoffs and attention

- `GET /api/connection-handoffs` returns `{requests:[...]}` scoped to the owner/selected device.
- Owner `POST /api/connection-handoffs` accepts `{provider,deviceId,accountLabel}` and returns a ten-minute, one-use request for a new account.
- `POST /api/connection-handoffs/:id/complete` accepts `{token,accountLabel?}` only from the owner or selected permitted device and returns `{saved:true,accountId}`. This cannot read/overwrite existing credentials. Credential fields must not use voice/history/report storage.
- `DELETE /api/connection-handoffs/:id` cancels the request. Revocation, expiry and cancellation are rechecked during credential saving.
- `GET /api/attention` and `state.attention` return `{version:1,items:[...]}` with generic `title`, stable `id`, `kind` and applicable record IDs. Kinds include `question`, `login` and `approval`. No question text, URL or credential is a notification payload. Clients refresh current state before navigation; stale notifications do not replay completed questions or actions.

### Internal Chromium browser and local previews

`GET /api/browser-studio` and `state.browserStudio` return `{available,permitted,detail,sessions}`. Each session includes `id,mode,status,tainted,hasFrame,activeTabId,tabs,createdAt,updatedAt`, optional `projectId,taskId,workflowId`, `attentionId,attentionReason`, `controller:{kind,id}` and `sharedDeviceId`. Tabs expose `{id,title,url,loading}`; tainted URL/title/pixels are hidden unless the caller is its current human controller. A stable `attentionId` identifies an attention episode.

At most four temporary sessions and four tabs per session are supported. Sessions never import an installed browser profile and do not survive host closure. Research permits anonymous public HTTPS GET/HEAD and link navigation with page JavaScript/auth/cookies/forms disabled. Project mode stays inside a held approved preview's exact origin. Private mode is human-only. Human takeover or sensitive content permanently taints a session; release never restores agent access.

All session mutation results below are `{session}`, except where specified. Paths are relative to `/api/browser-studio`.

| Route | Request/result |
| --- | --- |
| `POST /sessions` | `{mode,projectId?,taskId?,workflowId?,url?}` where mode is `project`, `research` or `private`; associations must match real saved tasks/projects. |
| `POST /sessions/:id/tabs` | `{url?}` adds a tab; individual tab deletion is not exposed. |
| `POST /sessions/:id/activate` | `{tabId}` chooses an existing tab. |
| `POST /sessions/:id/navigate` | `{tabId?,url}` with mode-specific URL policy. |
| `POST /sessions/:id/frame` | `{tabId?}` → `{sessionId,tabId,frameId,width,height,image,capturedAt,expiresAt}`; `image` is a bounded JPEG data URI. |
| `POST /sessions/:id/control` | `{tabId?,frameId,kind,x?,y?,deltaY?,key?,text?}` → `{applied:true}` under current human control. |
| `POST /sessions/:id/takeover` or `/release` | `{}` acquires/releases human control. |
| `POST /sessions/:id/attention` | `{reason?}` marks a human-attention request. |
| `POST /sessions/:id/handoff` | Owner-only `{deviceId}` explicitly shares/assigns control to the selected permitted Android device. |
| `DELETE /sessions/:id` | Closes the session → `{closed:true}`. |

Control kinds are `tap`, `scroll`, `key` and `text`. Tap coordinates are normalized 0–1; scroll is an integer `deltaY` of ±1–10 steps (100 pixels per step). Text is 1–1,000 characters, single-line. Keys are `Enter`, `Escape`, `Backspace`, `Tab`, the four arrows, `Home`, `End`, `PageUp`, `PageDown` and `Delete`. A frame is single-use and valid for three seconds; capture is rate-limited to one per 350 ms. A human-control lease lasts two minutes of inactivity; sessions expire after 30 idle minutes. Revocation/permission changes invalidate access. Clients must discard late frames after selection/controller/privacy changes.

`GET /api/projects/:id/preview` discovers eligible root Vite/Next dev scripts and current launch status. `POST /preview/start` with `{name,manifestHash}` creates a `project_preview` PC approval; `POST /preview/stop` stops the held preview. Dependencies must already be installed. A started process is not proof of port ownership, sandboxing or application health.

Research/project agents may request bounded `nakama-browser` tools associated with their actual task. Only the opt-in post-review delivery manager can request `nakama-service` tools. They share a maximum of 12 steps; no private session or screenshot bytes enter model transcripts. Tool errors are receipts, not permission to bypass a policy. Everyday fast conversation does not automatically add a tool loop.

### Project reports and file previews

These routes require owner or shared project/Google-enabled Android access and recheck permission after delayed work. PDFs are private host artifacts, not automatically written into project source or published.

| Route | Request/result |
| --- | --- |
| `GET /api/projects/:id/reports` | `{version:1,available,automaticEnabled,busy,reports,limits}`. |
| `POST /api/projects/:id/reports` | `{workflowId?,images?:[{kind:'project',path,caption?}]}` → report record; poll for `ready` or `failed`. |
| `PATCH /api/projects/:id/reports/settings` | `{automaticEnabled:boolean}` changes the project preference. Default is enabled. |
| `GET /api/projects/:id/reports/:reportId/file` | Ready `{fileName,mimeType:'application/pdf',bytes,base64,sha256}`. |
| `DELETE /api/projects/:id/reports/:reportId` | Removes an inactive report and its file → `{removed:true}`; source history stays intact. |
| `GET /api/projects/:id/file-preview?path=...` | Eligible PNG/JPEG/PDF `{path,fileName,mimeType,base64,bytes,sha256}` after containment/link/header/size checks. |

Report limits are 50 records per project, two images, 256 KiB per image and 1,363,148 output bytes. Explicit `images:[]` opts out of images. Omitting `images` may include already-captured safe untainted local-project browser frames; it never triggers a fresh/private capture. PDF rendering uses escaped offline data without scripts or remote resources. Reports contain recorded reviews/checks/service receipts and unresolved acceptance; report failure does not falsify the project outcome.

### Managed projects and companion notes

`config.projectTeam` holds `{peer:{providerId,model,effort},maxFixCycles}`. The existing `aiRoles.planning` role is manager; `aiRoles.development` is worker. Automatic project builds return `{workflowId,taskIds,routing}`; the initial task ID list can be empty because the persisted workflow is the tracking identity. `projectWorkflows` state holds status/stage, assignments, questions, plan, ordered work items, task IDs, review rounds and findings. Internal snapshot hashes and host paths are removed from public workflow records.

- `GET /api/project-workflows/:id`: read a workflow. Phones require both Google and project access.
- `POST /api/project-workflows/:id/answers`: `{answers:[{id,answer}]}`; each answer is bounded to 6,000 characters. Partial answers persist, all outstanding answers are required to resume. Only the desktop owner or the phone that started the workflow may answer/stop it.
- `POST /api/project-workflows/:id/stop`: stop all continuation and current worker tasks while preserving applied files. Stopping a task attached to a workflow also stops that workflow.
- Active workflow status is `running` or `awaiting_answers`; terminal outcomes include `completed`, `needs_attention`, `failed`, `stopped` and `interrupted`. A host restart interrupts active stages; it preserves answer-waiting stages. Clients must not equate successful HTTP submission with completed development.
- Tasks record `requestedEffort`, `effectiveEffort` and any `effortDetail`; Claude Ultracode requests use restricted xhigh workers coordinated by Nakama.
- `POST /api/providers/claude/settings` accepts the boolean `usageCreditsDisabledConfirmed`. This is an owner attestation, not live billing discovery. Clearing it stops active Claude work and Claude-dependent workflows. Fable preflight also requires Max authentication and supported CLI version.

Core Memory uses `GET/POST /api/core-memory`, `PATCH/DELETE /api/core-memory/:id`, and `DELETE /api/core-memory` (forget all notes). The desktop owner and paired Android devices with both Google and project access may read/edit notes through these routes; other device state excludes them. The legacy `/api/companion-memory` routes address the same notes but remain owner-only. Create/edit payload is `{category,text}`, where category is `note`, `preference`, `trait`, `routine` or `personality`. Notes have stable IDs, source and timestamps, with a maximum of 50 notes of 500 characters each. Owner settings `memoryEnabled` and `companionLearningEnabled` gate reuse and automatic explicit preference capture. Neither notes nor their text grant action authority. Forgetting notes leaves conversation history intact.

### Fast interaction, Agent office and navigation

`config.interactionRole` is a separate `{providerId,model,effort}` assignment, defaulting to `codex`, `gpt-6-astra`, `low`. Owner-only `PATCH /api/settings` validates it independently from saved deeper `aiRoles` and `projectTeam`. No migration overwrites those existing roles. Eligible short conversation uses the interaction assignment; detailed/research/action/project routes retain their appropriate roles. The `fastReplies` preference does not rewrite the exact interaction assignment.

`GET /api/agent-office` returns `{version:1,agents:[...]}`. The same projection is present as `agentOffice` in permitted state. Each record has stable `id` and generated `name`, `sourceKind`, `receiptKind`, provider, role, title, status, phase and timestamps; available relationships use `parentId`, `taskId`, `workflowId` and `projectId`. Model/effort, summary, output and error fields are optional. Output is redacted and bounded to its latest 16,000 characters, with `outputTruncated` when applicable. A workflow coordinator is `workflow_orchestration`; actual provider and terminal tasks use `model_task` and `tool_task`. These are receipts, not hidden reasoning or proof of a running model call.

The owner and paired Android devices with both Google and project access may use the office. A denied device receives empty office state and cannot call the route. Chrome credentials have no access. Missing original sources become unavailable, lose old output/title/error, and retain reserved names. Names persist across restart; the name pool has no public endpoint or UI editor. Local deterministic commands do not invent model-agent records.

Supported direct local chat commands can return `outcome:{type:'navigate',target,projectId?}`. Targets are exactly `agent-office`, `home`, `projects`, `boards`, `routines`, `core-memory`, `skills`, `browser`, `project-setup`, `delivery`, `assistant`, `agents`, `usage`, `devices`, `connections`, `activity` and `settings`. “Open skills”, “open learned skills” and “open skill library” address `skills`; “open Nakama browser” addresses `browser`. Project destinations resolve a unique saved name or the selected valid project. Clients consume only their own current response, validate the destination and known project, and discard late results after newer navigation/input. Outcomes are not replayed from shared chat history. Each client retains its unsaved-edit guard; arbitrary URLs, scripts and model-generated instructions are not navigation authority.

Android additionally handles its local destination aliases and exact installed-app requests without host inference. Home/settings use normal Android intents. Back/recents/notifications require the existing explicit, visible accessibility control session and available system action. These local operations do not expand host or device permissions. See [Android commands](android-guide.md) and [Agent office behaviour](agent-office.md).

### Learned skills

The owner and paired Android devices with both Google and project access share the library. Denied devices receive no skill content or selection receipts; Chrome/MCP credentials cannot use these routes. `GET /api/skills` and permitted `state.skillLibrary` return `{version:1,learningEnabled,reuseEnabled,skills,receipts,limits}`. The two preferences are saved independently; owner `config.memoryEnabled:false` also pauses automatic learning and reuse without deleting entries.

An entry contains `{id,title,description,whenToUse,steps,tags,enabled,status,source,createdAt,updatedAt,useCount,reviewedAt?,lastUsedAt?}`. Status is `ready` or `candidate`. Host-controlled source records `kind`, `detail`, and optional workflow/project/task IDs and review round. Clients cannot assign status, provenance or counts. A receipt contains `{id,taskId,workflowId?,role,skillIds,createdAt}` and means selected context, not proof of use or success.

| Route | Request/result |
| --- | --- |
| `GET /api/skills/:id` | One saved entry. |
| `POST /api/skills` | `{title,description?,whenToUse,steps,tags?,enabled?}`; creates an explicitly taught ready entry. |
| `PATCH /api/skills/:id` | A subset of the editable fields above; preserves candidate status and provenance. |
| `POST /api/skills/:id/accept` | `{}`; marks the inspected candidate ready, enabled and reviewed. |
| `DELETE /api/skills/:id` or `DELETE /api/skills` | Forget one/all entries and their retained selection receipts. |
| `PATCH /api/skills/settings` | `{learningEnabled?,reuseEnabled?}` with boolean values. |

Bounds are 50 entries, title 80 characters, description/whenToUse 500 each, 1–12 steps of 500 characters each and up to eight tags of 40 characters each. At most 100 receipts remain. Duplicate titles, unknown fields and recognised credentials are rejected. Candidates cannot be enabled through an ordinary edit. Completed dual-reviewed workflows may produce disabled candidates; no extra learning inference occurs. Relevant reuse selects at most three ready methods within a 4,200-character JSON payload and rechecks permission, pause, edits and deletion before starting the provider. See [learning, direct teaching syntax and provenance](learned-skills.md).

### Account-bound GitHub projects

These routes require owner access or a paired Android device with both Google and project access. `project.github` stores the selected account and repository link; `project.githubLastOperation` stores a receipt. Both fields are omitted from Google-disabled device state. Tokens stay in the host vault. All push approvals require the Windows owner, independently of ordinary-action confirmation.

| Route | Request/result |
| --- | --- |
| `GET /api/github/repositories?accountId=...&page=1` | `{items:[{id,name,url,private,defaultBranch,updatedAt}],nextPage?}` for the exact selected account. |
| `POST /api/github/import` | `{accountId,repository,name?}` → `{project}` in a new managed workspace folder. |
| `GET /api/projects/:id/github` | `{linked,link?,status,busy}`; link includes account ID/label, repository ID/name/URL, default branch, privacy and linkedAt. Status extends local Git status with optional last-fetched `remoteHead,ahead,behind`. |
| `POST /api/projects/:id/github/link` | `{accountId,repository}` → `{link}`; preserves files and existing origin. |
| `POST /api/projects/:id/github/fetch` or `POST /api/projects/:id/github/pull` | `{}` → `{projectId,status,branch,head,previousHead,remoteHead,completedAt}`; status is `fetched` or `pulled`. Pull requires clean files/index and a fast-forward. |
| `POST /api/projects/:id/github/commit/prepare` | `{paths,message,authorName,authorEmail}` → `{id,projectId,head,branch,message,authorName,authorEmail,files,expiresAt,disclosure}`. Each file has `{path,kind,before,after,bytes}`. |
| `POST /api/projects/:id/github/commit` | `{previewId}` → `{id,projectId,commit,head,branch,message,files,createdAt}`; `commit` is the new SHA and `head` its parent. |
| `POST /api/projects/:id/github/push/prepare` | `{}` → `{id,projectId,head,branch,remoteHead,repository,accountLabel,expiresAt,disclosure}`. No remote write. |
| `POST /api/projects/:id/github/push` | `{previewId}` → `{approval}`; no push until fresh PC approval. |

The existing owner-only approval resolution stores a confirmed push result `{projectId,status,repository,branch,head,previousRemoteHead,completedAt}`, with status `pushed` or `up_to_date`. Changed local/remote state, account/link, credentials or requester permissions invalidate review. Previews last ten minutes and are lost on restart. Local commit selection allows 1–20 UTF-8 text files, 256 KiB per version, 2 MiB total and a 500-character one-line message. Selected staged files are rejected; unselected staging and working files are preserved. A local checkpoint is a separate recovery ref and never moves the branch. See [GitHub scope, transport and recovery](github-projects.md) and [checkpoint comparison](git-changes.md).

### Base state

`GET /api/state` returns:

```
{
  config: { workspaceRoot, hostName, allowLan, port, voice, confirmOrdinaryActions },
  projects: [{ id, name, description, path, updatedAt, status, pinned }],
  devices: [{ id, name, platform, pairedAt, lastSeen, capabilities }],
  providers: [{ id, name, status, connectionType, models, selectedModel, effort, detail }],
  tasks: [{ id, projectId, providerId, title, status, createdAt, updatedAt, output, error }],
  approvals: [{ id, type, title, description, createdAt, status }],
  connections: [{ id, name, category, status, accountLabel, detail }],
  messages: [{ id, role, content, createdAt, projectId }]
}
```

- `PATCH /api/settings`: owner-only configuration changes, including workspaceRoot, allowLan, confirmOrdinaryActions, voice. Restart may be needed for listener changes.
- `POST /api/projects`: `{name,description?}` creates a directory under the chosen root and returns the project.
- `PATCH /api/projects/:id`: `{name?,description?,pinned?}` changes metadata.
- `POST /api/projects/:id/delete-request`: creates a mandatory approval; it does not immediately remove files.
- `GET /api/projects/:id/files?path=`: directory listing relative to that project.
- `GET /api/projects/:id/file?path=`: `{path,content}` for an eligible text file.
- `PUT /api/projects/:id/file`: `{path,content}` writes a bounded text file after path validation.
- `GET /api/projects/:id/git`: read-only `{available,repository,branch,head,entries,truncated}`; entries contain literal `path`, `indexStatus`, `worktreeStatus` and optional `originalPath`.
- `GET /api/projects/:id/git/diff?path=&staged=0|1`: bounded `{path,staged,content,truncated,binary,untracked}`. Ordinary project-root repositories only; no stage/commit/push side effects. See [Git scope](git-changes.md).
- `GET /api/projects/:id/checks`: root npm check catalogue `{supported,detail?,runtime:{available,detail?},manifestHash?,checks:[{name,script,preScript?,postScript?}],active}`. Script display text is redacted; discovery never executes code.
- `POST /api/projects/:id/checks/request`: `{name,manifestHash}` creates a mandatory `project_check` desktop approval. Only exact `test`, `lint`, `typecheck`, `check` and `build` names are supported; custom arguments are rejected. Resolution returns `{status:'started',taskId}` and leaves the approval marked `started`; the linked task reports `kind:'project_check'`, `checkName`, manifest hash, bounded output, final status and `exitCode`. See [project checks](project-checks.md).
- `POST /api/chat`: `{message,projectId?,providerId?,model?,effort?,team?,mode?:'discuss'|'build'|'act'}` stores the user message and starts provider runs, returning `{taskIds}`. Build mode requires a project and applies one validated file proposal with conflict checks and backups. Act mode validates one bounded action plan against the current request before calling supported project, Google or phone tools. Only the first team member can propose writes or actions; other members review. Team requests should omit shared model/effort to use each provider's saved settings.
- `POST /api/tasks/:id/stop`: stops a running provider and prevents remaining action-plan steps. Phones need project access and may stop only their own tasks. An operation already in flight may finish; retained action outcomes describe what actually happened.
- `POST /api/commands`: `{projectId,command,args}` requests an explicit command execution. Commands run through approval; the executor never treats model-generated text as approval.
- `POST /api/deployments`: an exact configured Git deployment target creates a mandatory deployment approval. See [service payloads](service-connections.md). The legacy project/provider-only shape produces a setup-required request and cannot execute a deployment.
- `POST /api/approvals/:id/resolve`: desktop-only `{approved:boolean}` resolves the stored operation once. Request payload cannot be changed during approval.
- `POST /api/pairing/tickets`: desktop-only `{name?,platform?}` returns `{ticket,expiresAt,port,fingerprint,hostName}`. The UI combines this with the user-selected reachable host URL into pairing JSON/QR.
- `POST /api/pair`: unauthenticated `{ticket,name,platform,capabilities?}` returns `{deviceId,token,hostName}` exactly once. The client pins the certificate before sending the ticket.
- `DELETE /api/devices/:id`: desktop-only immediate device revocation.
- `PATCH /api/devices/:id`: desktop-only Android `{projectAccess?,googleAccess?,browserControl?}` switches. Disabling project or Google access stops that device's active AI tasks. Google-disabled devices cannot start CLI chats and cannot see shared chat/task/approval history; only their own device-result messages remain. A phone cannot change its own authority or control another phone.
- `POST /api/providers/:id/settings`: `{selectedModel?,effort?,connectionType?}` updates provider selection. Secrets use a separate desktop-only vault endpoint.
- `POST /api/providers/:id/probe`: probes local CLI availability and supported connection state without performing inference.
- `GET /api/providers/codex/models`: desktop-only live installed CLI model/effort metadata; does not perform inference.
- `POST /api/connections/:id`: desktop-only `{accountLabel,token?}` stores an integration credential in the OS-protected vault. State returns no secrets.
- `POST /api/device/actions`: `{deviceId,type,args}` queues an explicitly requested operation, or creates an ordinary-action approval when configured. Android can relay browser requests only with its owner-enabled permission.
- Chrome `browser_select` arguments are exactly `{tabId,selector,value}`: positive safe-integer tab ID, nonblank selector up to 300 characters, and exact string option value up to 200 characters (empty is valid); NUL and extra fields are rejected. Only one native single-select control and one enabled matching option can be chosen. A `browser_read` select control adds `{multiple,disabled,options:[{value,label,selected,disabled}],optionsTruncated}`; values are never silently shortened. The extension enforces protected/destructive-context rules and reports observed selection rather than external task completion.
- `GET /api/device/actions?types=...` or `?excludeTypes=...`: paired device polls for assigned actions, with five-minute expiry and redelivery until acknowledged. A durable receipt must precede each side effect.
- `POST /api/device/actions/:id/result`: device reports `{status,message,data?}`. Result ownership, data bounds and identical-ack idempotency are verified.
- Device-action authority is rechecked when queued and when a delayed approval is consumed. Removing a phone's browser-control permission or revoking it stops undelivered relays and further redelivery of already dispatched relays; a result from an action already executing may still be recorded. Approval does not restore revoked requester authority.
- `GET /api/actions`: owner sees action history; a phone sees its own actions. Result statuses distinguish completed, started, needs_user, needs_permission, blocked, unsupported, failed and interrupted. Only the newest ten completed screenshot payloads are retained globally. Older entries have `resultDataOmitted: true`, bounded `resultDataMetadata` and a canonical `dataDigest` for identical-ack detection; their pixel data is removed.

## Additional capabilities

- Google accounts: `GET /api/google/accounts`, owner `POST /api/google/connect`, owner `DELETE /api/google/accounts/:id`; account-bound messages/calendars/events reads and send-email/create-event writes. See [Google setup](google-accounts.md).
- Services: `GET /api/services/:provider/:accountId/:resource` and explicit Resend sending. See [service payloads](service-connections.md).
- Kling: `GET /api/kling/status`, `/api/kling/catalogue`, `/api/kling/account` and `/api/kling/jobs`; `POST /api/kling/prepare` prepares an exact approval; `POST /api/kling/jobs/:id/poll` checks an existing job. Owner-only `/api/kling/settings` controls enablement and `/api/kling/mcp-config` manages the scoped local connection. Generation starts disabled, each submission needs a fresh PC approval, and an unknown credit balance blocks submission. Legacy `/api/media/*` and its budget/currency settings are retired. See [Kling setup and MCP scope](kling-mcp.md).
- Blender: `GET /api/tools/blender`; `POST /api/tools/blender/run-request` with `{projectId,scriptPath}` creates a hash-bound script approval.

## Action policy

Deployments and project deletion always require explicit owner approval. Only typed service provisioning can consume an already PC-approved exact matching bounded project grant. Legacy deployments, local deletion, Git pushes and Kling keep their separate fresh approvals. Generic phone actions can execute after the user's clear request, subject to Android permission and the optional confirmation setting. General shell access can perform destructive or deployment work, so raw command execution requires approval rather than claiming keyword filters guarantee safety. Initial CLI workers operate in read-only/planning modes; controlled host operations own mutations.

No browser, phone, email, or document content grants new authority. Provider instructions treat it as untrusted data. No connection is shown as verified until it has actually been tested. Media generation uses explicitly configured APIs and spend controls; Workspace consumer access is not assumed to be an API entitlement.

## Installed Android app selectors

- `POST /api/device/apps`: a paired Android device with project and Google access supplies its own `{apps:[{packageName,label}]}` launcher-visible list (maximum 1,000). It cannot name another device.
- `GET /api/devices/:id/apps`: Windows owner only; returns `{deviceId,apps,available,expiresAt?}`. Permission loss, revocation and a 90-second expiry remove availability. Catalogs are memory-only and excluded from shared state and model context.
- These routes do not grant app control, observation, notification or microphone permission. Selected package IDs remain the exact execution/consent identity; labels are display data.

## Built-in PC clock

- `GET /api/clock` returns `{now,timeZone,timers}`, settling expired countdowns first. Timer records expose identity, title, status, revision and remaining seconds. Private request-deduplication hashes stay out of shared state.
- `POST /api/clock/timers` accepts `{durationSeconds,title?,requestId?}`. Duration is an integer from 1 to 604800 seconds. A repeated request ID with the same caller/body returns the existing timer; changing its meaning is rejected.
- `POST /api/clock/timers/:id/pause|resume|cancel|dismiss` accepts the current `{revision}`. A stale revision or invalid state transition fails without applying the requested change.
- The Windows owner can manage all PC timers. A paired Android API caller requires shared personal access and can only see/change its own records. Clock-related chat receipts and timer attention items retain that scope. Browser tokens cannot use these routes.
- Timer expiry creates a persistent generic attention notice; opening it navigates to Clock. The host must run and stay awake for timely delivery. On restart, past deadlines finish and paused timers stay paused.

Android's new direct Clock/voice path schedules phone timers locally. Those records stay in Android storage and are not mirrored into the PC timer collection. Clock/navigation commands do not grant permissions or call a model.
