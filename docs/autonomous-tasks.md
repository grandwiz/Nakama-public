# Autonomous tasks

The intended product takes an outcome and independently works across the computer, browser and apps, checking results and recovering from failures. Website delivery is one example, not the limit of this feature. This guide separates that target from the current implementation.

## Current task engine

Open **Tasks → Autonomous tasks** on Windows, or **Tasks → Autonomous tasks** on Android. Enter a goal, optionally select a managed project, and start. The task uses the saved general-task role, or the saved project-manager role for a selected project (with the planning role as fallback). The fast conversation role stays separate; the managed Astra/Fable/Opus development and independent review pipeline stays intact.

The engine saves each proposed action before dispatch, records the actual result, then asks its manager for the next step. It can ask questions and preserve answers, observe fresh evidence, and request verification. Runs are bounded to 30 decisions, three tool failures and a 30-minute active deadline. Answering all pending questions or explicitly resuming renews the deadline but not the decision budget. Stop prevents further actions; an operation already in progress may still finish. Restart interrupts active runs. Explicit Resume starts from saved receipts and never automatically replays an attempted operation.

Available adapters cover:

- Anonymous public research in isolated Chromium, and interaction inside a selected project's already-approved local preview. Existing private/login session isolation and fresh-target controls apply. Current model adapters receive text and element IDs, not screenshot pixels.
- Gmail metadata/snippets and Calendar event reads when the original goal requests them. These adapters cannot send messages or change accounts/events. Account labels and returned content are untrusted data.
- Bounded folder listings and non-sensitive UTF-8 files inside the selected project. Credentials, linked files, protected folders and oversized content are excluded.
- Discovery of supported root npm checks, fresh exact PC approval for each requested check, and waiting for actual process close plus the saved terminal result. A successful script receipt does not certify the application.
- [Locked dependency preparation](project-dependencies.md) with fresh exact PC approval, disabled install scripts and saved terminal/hash checks. Missing locks are not generated and failed setup stops for attention.
- Exact PC-approved local preview launch, separate browser observations, and stopping only this run's own preview before another command. Starting a server never counts as application acceptance.

Questions, activity, receipts and Stop are visible in both clients. Commands still require approval on the PC. Shared-access removal stops further work and hides the records from the disabled device. The task board shows one source card per run, while Agent office shows actual coordinator/model activity.

## Evidence and completion

The manager must cite saved receipt IDs when finishing. Verification is a separate operation that performs a fresh observation or inspects a saved command outcome. Seeing a page or receiving an accepted click does not prove the user's objective was achieved. The current adapters retain **review required** for general outcome claims. Missing, failed, interrupted or unconfirmed evidence cannot become a completed outcome by model assertion.

These are local engineering capabilities. Model eligibility, reasoning quality and real task completion through the owner's accounts still require deliberate live acceptance. Synthetic responders used in tests do not establish those results.

The host adapters enforce their documented file and browser scopes. The existing official CLI workers remain read-only clients, not a no-file-read operating-system sandbox. Do not assume that the adapter's protected-path rules constrain all native CLI reads; avoid supplying sensitive project context.

## Remaining work toward general computer autonomy

1. **Delegated browser interaction.** Add explicit task authority for selected sites/tabs, dynamic pages, forms, file uploads and exact submissions, with fresh document/target checks. Existing human-only private sessions must remain opaque; a new delegation mode cannot silently import installed browser profiles or expose login content.
2. **Windows application adapter.** Add scoped accessibility/vision observation and input for selected apps, outcome checks and interruption handling. The existing Android-controlled remote desktop is human control and must not silently become an AI screen feed. Protected/elevated desktops and Nakama approvals remain unavailable.
3. **Execution toolkit.** Extend the initial locked npm preparation and approved-preview adapters with missing-lockfile creation, native package setup, generated-output handling, guarded file/application operations and an integrated browser acceptance flow. Arbitrary commands retain their separate approval boundary. Managed development keeps the required questions and dual independent reviews.
4. **Task authority and recovery.** Design explicit, expiring task scopes for routine reversible operations, durable external operation identities, uncertain-result reconciliation and controlled recovery. A broad goal is not an account grant. Spending, deployment/DNS, deletion, Git pushes and Kling keep their documented separate rules.
5. **Website acceptance.** Connect repository publication, dependencies, migrations, payment-provider test mode, provider domain verification and frontend/backend/database acceptance. A service receipt or live URL alone is insufficient.
6. **Device and live acceptance.** Verify real Windows app tasks and the Android 16 phone/tablet, network loss, lifecycle, voice/wake/location, performance and battery use. No claim of universal phone control or continuous background availability follows from USB debugging or emulator tests.

## Development and installed devices

Use disposable host profiles and synthetic account/browser/command fixtures for regression tests. Keep live providers, paid models, video generation, purchases, messages, calls, deployments and DNS changes out of tests. Physical devices use in-place signed updates only; never clear app data, replace pairing or install destructive instrumentation as an ordinary test. Preserve the owner's private editable checklist values and keep actual device identifiers and private diagnostics outside Git.

The first acceptance benchmark is building and verifying a website locally. Live runs require eligible accounts and explicit user authorisation; no paid fallback or automatic retry is enabled.
