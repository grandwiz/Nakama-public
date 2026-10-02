# Projects with your Nakama team

Your project conversation has one manager. The suggested team is ChatGPT Astra 6 Ultra as manager, Claude Fable 5.1 as co-planner and reviewer, and Claude Opus 4.8 as implementation workers. Change these roles in **Settings → AI roles**. Your fast everyday Nakama uses a separate interaction assignment, initially Astra 6 at low effort. It can report recorded status while deeper workers run. [Agent office](agent-office.md) displays the named manager and its actual child tasks.

## The workflow

1. Select a project in **Assistant**, leave automatic selection on and describe what to build or change. Hosted website requests can first create saved **Project setup** questions. Complete the required answers and choose an existing project or a new local folder before starting planning; this does not create a remote repository.
2. Astra and Fable independently read the project and prepare detailed proposals. The manager reconciles methodology, architecture, ordered tasks, file ownership, risks and acceptance criteria.
3. The manager brings unresolved questions from either planner to you. Answer the fields in the project conversation on Windows, or the project-team panel on Android. Both planners receive the recorded answers. No worker starts while questions remain.
4. The manager assigns bounded implementation tasks to the configured development model. Nakama applies their file proposals in order and enforces each task's declared files. Existing containment, stale-file detection and recovery copies still apply.
5. Nakama inspects [locked dependency preparation](project-dependencies.md), then discovers supported checks in the root `package.json`: `test`, `lint`, `typecheck`, `check` and `build`. Supported setup uses a separate exact PC approval for `npm ci` with lifecycle scripts disabled; failed or unsupported setup needs attention. Each check requests fresh exact PC approval. Review the command and its pre/main/post scripts in **Activity & approvals**. The workflow waits for actual process close and saved output/exit results.
6. A failed check goes back to the configured development workers with its actual diagnostics. A repair consumes one of the workflow's bounded fix rounds. Checks are rediscovered after each repair and every run needs new approval. Stop, declined or expired approval, and interrupted execution leave the result unresolved; they are not a passing check.
7. Astra and Fable independently inspect the resulting files and recorded check evidence. Each must explicitly pass or identify blocking fixes. Opus receives blocking findings, then the checks and both reviews run again. Reviewers cannot turn a failed check into a pass.
8. Only after both reviews pass and the latest discovered checks have passed does the manager deliver the result in your conversation. If no supported checks exist, Nakama records that checks were not run and can deliver a static-review-only result. If the fix-round limit is reached, the workflow stops with unresolved findings and keeps its files, check receipts and review records available.

**Stop project work** stops later stages as well as current workers/checks and invalidates a pending workflow check approval. Stop on an individual workflow task also cancels continuation. The project remains reserved until a launched check process closes. Active work interrupted by closing Control Center never resumes automatically. A saved question stage can continue after reopening, provided the project and permissions are unchanged. Changes made outside the workflow require a fresh plan; Nakama does not overwrite them to continue an old plan.

The project-manager card shows **Project check needs your PC approval** with a link to the exact request on Windows. Android shows the same waiting stage and check results, but cannot approve commands. Recorded check results distinguish pending, running, failed and completed runs, with exit codes when available. An approval being consumed only means a process was started; read its final result.

The workflow has a bounded scope: up to eight ordered work items, up to five clarification rounds, and zero to three automatic fix rounds (two by default), shared by check failures and review findings. Included snapshot files must each be at most 1 MB; larger files block this workflow instead of bypassing stale-file detection. Workers write serially to avoid competing edits. This release coordinates separate restricted worker requests and individually approved project checks; it does not grant workers unrestricted command execution or isolated Git branches.

## Model and effort setup

Fable's exact identifier is `claude-fable-5-1`. The official model documentation confirms this identifier. Nakama requires Claude Code 2.1.257 or later for this route. The locally installed CLI was read-only checked as 2.1.284 during development; this is not proof of account eligibility or a completed model request.

Anthropic includes Fable in Max's regular limits, with a separate Fable limit. Its non-interactive client can spend usage credits without a prompt. For this preview Nakama therefore requires the authentication check to report a Max plan and an owner confirmation under **AI team → Claude → I have disabled usage credits in Claude**. First turn credits off in the Claude account's usage settings. This is an owner attestation, **not a machine-verified billing setting or spending cap**. Clear it if you change accounts or re-enable credits. Nakama never buys credits, enables paid fallback or silently substitutes a different configured model. No paid inference or live Fable test was run during development.

**Ultracode** is a Claude Code workflow setting, not a synonym for maximum reasoning. In the restricted Nakama worker, the request maps to `xhigh`; Nakama coordinates the workers. Claude's native dynamic workflows remain disabled by safe mode. Settings and task receipts distinguish requested and effective effort. If you prefer deepest reasoning without that preset, select Claude's `max` effort. This release does not claim native Ultracode delegation.

New/restored project defaults request Ultracode for Fable as well as Opus, matching the owner's revised flowchart. Existing saved Fable max/custom assignments are preserved on update; review Settings if you want to adopt the new preset.

Sources: [Fable 5.1 identifier](https://platform.claude.com/docs/en/models/fable-5-1/overview), [Claude model and Ultracode configuration](https://code.claude.com/docs/en/model-config), [Fable subscription limits](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan).

## Optional hosted delivery stage

A hosted website started through Project setup requests a separate delivery manager after implementation, both reviews and manager delivery. Explicit local-only setups skip that stage; a completed workflow can also be selected in **Delivery**. The coordinator starts only against unchanged reviewed files, uses typed service plans and actual receipts, and pauses for exact PC approval or required user answers. A pre-approved matching project grant can authorize only its saved exact scope. Stop/revocation and stale files prevent further dispatch.

The delivery manager ends at **review required**. It does not convert provider READY/live metadata into proof that frontend, backend, database, admin, DNS or payment checkout work together. Git publication, dependency installation, migrations, payment onboarding and unsupported DNS work remain separate supported operations or user actions. See [delivery setup, grants and acceptance](project-delivery.md).

Completed managed work defaults to a local PDF report, with per-project opt-out. It records static reviews, actual checks/service receipts and unresolved acceptance without extra inference. Safe project images can be included; private browser sessions cannot. A report error leaves the implementation outcome intact.

## Your companion

Nakama's pet and conversational personality are the interface to your chosen chat model, Astra by default. It can use recent conversation and saved personal notes; it does not train or modify the underlying model.

In **Core Memory** on Windows or **Tools → Core Memory** on Android, inspect, add, edit and forget notes. Pause learning or memory reuse on the Windows PC; these settings are not editable on Android. Windows Settings retains the same companion editor. Standalone statements such as “I prefer short answers”, “I usually work in the morning” and “Remember that I like working in the morning” can become visible local notes. Traits and routines are self-descriptions, not hidden diagnoses or inferred sensitive attributes. No extra model call runs for this capture, preserving everyday latency. The conversation-memory switch disables both reuse and automatic learning. Forgetting notes does not delete old conversation messages.

Saved notes are context for the configured provider, never authority to send messages, spend money or change permissions. Google-disabled phones cannot read memory, project workflows or shared conversation history.

## What completion establishes

Both reviewers perform static review informed by actual check receipts. The implementation workflow can execute discovered project checks only after fresh PC approval for each run; service grants never authorize these commands. A script can perform arbitrary actions, so read its full pre/main/post definitions before approving. The check runner's npm settings do not prevent the project script itself from using the network. See [Project checks](project-checks.md) for boundaries and troubleshooting.

The workflow does not automatically install dependencies, deploy, delete projects, send messages or make calls. The separate hosted delivery stage can request supported service work under its exact approval/grant boundaries. Missing or unrun checks remain explicitly unverified in the manager's delivery. Passing scripts and two static reviews do not establish browser behaviour, a working hosted website, a database migration or payment checkout acceptance.

Live Astra/Fable/Opus account handoffs, quality and limits need acceptance on your accounts. On Android, the visible app-scoped control session has blue edges, a cursor and Stop; streaming the phone screen to the PC and unrestricted autonomous phone control remain unfinished. The separate [Windows remote desktop](remote-desktop.md) feature lets the phone view and control the host and still needs real capture/input acceptance. See [Android setup and limits](android-guide.md).
