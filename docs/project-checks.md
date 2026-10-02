# Build, review and check a project

Nakama can discover common checks already defined in a Node.js project's root `package.json`. It presents their scripts, asks for desktop approval, and records their output and exit result. This gives you a repeatable way to check generated code without typing a command and JSON arguments each time.

## Checks inside a managed project

The [managed project workflow](project-workflow.md) now requests these checks after implementation and after each repair. The manager card links to the exact pending approval on Windows; Android displays the waiting state and results but cannot approve. Approval of one run never authorizes the next, including an unchanged script after a repair. Project service grants do not apply to commands.

Nakama waits for each launched process to close before deciding what to do next. Actual failures and bounded diagnostic output go back to the configured development workers. Check failures and review fixes share the configured limit of zero to three automatic fix rounds (two by default). Both independent reviewers receive recorded check evidence and cannot overrule a failed check. At the limit, work stops for your attention with its files and evidence preserved.

Before checks, the workflow inspects [dependency preparation](project-dependencies.md). A supported matching public npm lockfile can request exact PC approval for `npm ci` with install scripts disabled. Unsupported or failed preparation stops for attention; no blind reinstall occurs. When there are no supported scripts, the workflow explicitly records checks as unrun; a static-review-only handover can still be produced. It does not invent tests. A declined or expired approval, runner/configuration error, stopped check or interruption cannot be reported as a successful run. Restarting Control Center does not silently resume this work.

Workflow check results show the check, round, status and exit result, with bounded recorded output available on Windows. **Stop project work** cancels continuation and any pending workflow approval and requests termination of an active check. The project remains reserved until the process closes. A completed script establishes only that script's recorded outcome, not full application or hosted-site acceptance.

## A useful development cycle

1. Open your project and use **Build files** to ask a connected AI to make changes.
2. Read the saved files. If the project has a Git repository, use **Git changes** to review the diff.
3. Open **Tasks & commands → Project checks** and choose **Refresh checks**.
4. Choose an available check and request approval. Nothing runs yet.
5. In **Activity & approvals**, read the main script, any `pre…` and `post…` scripts, and the exact command. Approve only when you intend all their effects.
6. Return to project activity for output, completion status and exit code. Choose **Review this check** to prepare an editable AI discussion about the result. For a failed check, **Repair this failed check** can make one deliberate file-repair attempt and prepare a fresh check approval.

The panel recognises the exact script names `test`, `lint`, `typecheck`, `check` and `build`. It does not invent missing checks. A new project with only a README has no checks until a suitable `package.json` and scripts exist. The standalone check panel requires dependencies already prepared; managed workflows and general tasks can request the separate exact-approved locked setup operation.

## What the result means

| Result                    | Meaning                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Pending approval          | The script has not started.                                                             |
| Started on the approval   | The approval has been consumed and a task was started. Read that task for the outcome.  |
| Running                   | The process is still active; output may continue to arrive.                             |
| Completed, exit code 0    | The script reported success. This alone does not prove your whole application works.    |
| Failed, nonzero exit code | Read the output and error. A failed test is recorded as failed.                         |
| Stopped or interrupted    | The run did not finish normally. Files or external effects already produced may remain. |

Use **Stop** on the task when needed. Commands have a 30-minute deadline and bounded output history. Nakama requests process-tree termination; it cannot undo work already done. The project check reservation stays until the launched child has actually closed.

## Ask an AI to explain the result

Finished project-check cards offer **Review this check**. This opens the same project's assistant in **Discuss**, with a draft containing the check name, recorded status, exit code or signal, and a bounded excerpt of its output. The draft asks for an explanation and a minimal suggested fix. It does not start an AI request, change files or rerun the check.

Read and edit the draft, choose your provider or team, then press **Send** when ready. Remove anything you do not want to share with that provider. Host output redaction is a useful precaution, not a guarantee that logs contain no private information. Sending uses your existing configured provider connection and its normal subscription limits.

The draft includes at most the last 12,000 characters of output and up to 2,000 characters of the recorded error, with further shortening if needed to keep the whole message bounded. A notice identifies omitted content. Terminal escape sequences are removed to keep the draft readable. The check's metadata describes that particular run; it does not claim that the current project files still match it.

Check output is labelled as untrusted diagnostic data. The model is asked to explain it rather than follow commands found inside it. Review the answer before applying it. Discussion never changes files. Use the separate **Build files** mode or the explicit repair action below when you want changes; every subsequent check still needs its own approval.

## Ask an AI for one repair

On Windows, an eligible failed project check offers **Repair this failed check**. Save any editor changes first. Select the connected provider, model and effort you want, read the explanation, then start the repair. Opening the form alone sends nothing.

Nakama gives the selected provider a bounded excerpt of the recorded failure and asks it to repair the **current project files**. The original task remains unchanged. Those files may have changed since the failure: this is not a replay of a saved historical project. Diagnostic text is treated as untrusted evidence, and the normal file-builder validation and recovery copies apply.

The recorded failure must still match the current `package.json`. If the manifest changed, request and run a fresh check before repairing it. This guards the check definition; it does not freeze every source file or dependency.

One request allows **one AI repair attempt**. When files have been saved, Nakama rediscovers the same check and prepares a **new desktop approval**. Review the changed files and the complete pre/main/post scripts in **Activity & approvals** before approving. The scripts can change during a repair; an earlier approval never carries over.

The file editor becomes read-only while a repair owns the project. An already-open file shows **Reload required** when repair activity changes; choose **Reload file** to read the latest saved version before editing or saving. Unsaved text is preserved until you explicitly agree to discard it. This prevents an old editor buffer from overwriting the repair.

The repair record links the original failed task, file-building task, new approval and rerun result. Read the linked check's exit status to judge the outcome. A completed file edit is not evidence that the check passed. If it still fails, needs more context, or cannot prepare a valid check, the flow stops for your review. Starting another attempt is a new deliberate action; Nakama does not retry or install dependencies automatically.

Use the repair's **Stop** control to cancel its pending work and invalidate its pending rerun approval. Work or external effects already completed cannot be undone by Stop; inspect saved files and recorded results before trying again. A host restart marks an unfinished repair as interrupted instead of resuming it silently.

This feature is started and stopped in Windows Control Center. The Android app continues to offer ordinary check requests and results; it cannot approve or start a repair. Google-disabled devices still receive no shared AI/task/approval history. Sending a repair consumes the selected provider's normal usage allowance; the fixture tests use simulated provider responses.

## Approval and changed files

Every check requires a fresh desktop approval, even when ordinary-action confirmation is switched off. Approval requests expire after ten minutes and cannot be reused. Paired phones with project access can request a check from **Projects → Project checks**, but cannot approve it. The Android screen shows script previews, pending requests and recorded results; shared history is hidden when that device's Google access is disabled. See the [Android guide](android-guide.md).

Nakama binds the request to the chosen project, the complete `package.json` bytes, and the reviewed runner configuration. If these change, refresh and request a new approval. Save unsaved editor changes before requesting a check.

Only one check runs per project. Nakama prevents a check from overlapping its own file builder, command launch or file-save/deletion operation. While a check runs, finish or stop it before saving files through Nakama, starting another project command, or applying a project deletion.

This is not a snapshot of every source file or installed dependency. Other editors and programs can still change those files. The project folder and process run under your Windows account; they are not an operating-system sandbox.

## Read scripts before approving

A script named `test` or `build` can run arbitrary code, including deployment or deletion. npm runs the selected script and its matching pre/post scripts through a shell. Review their source and approve only the intended work. Deployment and project deletion do not gain an automatic exception through this panel.

Running a check does not install dependencies or call an AI. Its npm invocation disables npm's own online fetching, update checks, audit and funding requests. The separate locked setup operation explicitly downloads packages only after its own approval. **The project script itself can still use the network or other programs.** These settings are not a network firewall or a paid-service budget cap. The local verification fixtures use only known scripts with no external requests.

## Setup and troubleshooting

- **Node.js/npm unavailable:** install the standard Node.js distribution with npm and restart Control Center. This preview discovers fixed installation locations such as `C:\Program Files\nodejs`; custom version-manager installations may need the existing reviewed command form instead.
- **No supported scripts:** check the root `package.json`. Nested workspace checks and arbitrary script names are not selected automatically. Workspace-wide npm execution is disabled.
- **Root `.npmrc` present:** this panel declines the project rather than silently using its custom settings. Review the configuration and use the general command workflow when it is needed; do not remove it blindly.
- **Configuration changed:** request a fresh approval after an intentional Node/npm update or package change. Private runner configuration must remain empty and outside the selected project workspace.
- **Check fails immediately:** inspect the task output. A missing dependency or unsuitable script is a real failure, not a reason to install anything automatically.
- **The script waits for input:** command input is closed. Configure a suitable non-interactive script and request a fresh run.

The standalone check panel provides a guided build → check → review → one repair cycle. Managed projects add a bounded build → approved dependency preparation/checks → repair → independent review loop. Fully unattended commands, broader dependency setup and multi-agent Git merging remain unfinished; each preparation/check execution still needs fresh PC approval.

Implementation references: [npm run and lifecycle behaviour](https://docs.npmjs.com/cli/v11/commands/npm-run/), [npm configuration sources](https://docs.npmjs.com/cli/v11/configuring-npm/npmrc/).
