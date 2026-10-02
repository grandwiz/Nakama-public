# Review Git changes, commits and local checkpoints

Open a project and choose **Git changes**. Nakama shows the current branch, commit and changed files. Choose **Worktree** for edits that have not been staged, or **Staged** for the changes prepared for the next commit. Select a file to read its diff, and use **Refresh** after editing or running a command.



New, untracked text files show their current contents. Binary files are identified without rendering binary data. A deleted tracked file can still show the lines being removed. A clean project shows an empty state instead of a blank diff.

Opening this view only reads Git state. Its **Your GitHub project** controls provide explicit account-bound link, fetch, fast-forward pull, reviewed local commits and approval-gated pushes; repository import is on the Projects page. The separate **Save a local checkpoint** workflow creates a local recovery commit after you review it. A checkpoint never stages files, moves your branch, pushes or deploys. Deployments and project deletion still require approval.

## Choose a commit or checkpoint

| Operation | Branch and staging | Remote effect |
| --- | --- | --- |
| Local checkpoint | Saves selected working copies to a separate recovery ref; branch and whole index stay unchanged. | None; ordinary branch pushes do not include checkpoint refs. |
| Reviewed local commit | Advances the current branch; updates selected index entries and preserves other staging and all working files. | None until a separately approved push. |
| Fetch | Updates Nakama's local tracking ref and objects; preserves working files and index. | Reads the linked GitHub repository. |
| Fast-forward pull | Advances a clean local checkout to the fetched branch; refuses dirty or divergent work. | Reads the linked GitHub repository. |
| Reviewed push | Sends the exact reviewed branch commit after PC approval and remote-state checks. | Changes GitHub and may trigger its automations. |

Use **Projects → Import from GitHub** to bring an existing nonempty repository into a new workspace folder, or link an existing checkout through its GitHub panel. Choose the exact saved account and repository. Linking does not initialise Git or change an existing origin. Imported checkouts use Nakama's saved link; ordinary Git tools may still need their own remote setup.

For a local commit, select changed files, enter a message and author name/email, prepare the review and inspect each complete before/after version. Confirm the review before creating the commit. Selected staged or partly staged files need your Git client; Nakama does not replace that staging. Unselected staged changes remain available for a later commit. Review Push is a second operation with a fresh PC approval, including from Android.

Save editor drafts before Git mutations. After a pull, reload any previously open editor file before editing or saving it again. If the result is uncertain, refresh repository state before deciding what to do next. A failed or interrupted commit can retain `.git/index.lock` and `.git/nakama-commit-recovery.json`; preserve them and inspect with Git rather than repeating the request or deleting recovery files. See [GitHub setup, limits and recovery](github-projects.md).

## Save a recovery point

Use a checkpoint before another AI edit or development step when you want to keep selected saved changes. The project must already have an ordinary Git repository with at least one commit.

1. Save or discard unsaved editor changes. Wait for any active repair or project command to finish.
2. Open **Git changes**, then choose **Refresh** to see the current files.
3. Under **Save a local checkpoint**, enter a short message and select the files you want to keep.
4. Choose **Prepare checkpoint review**. This reads the selected files; it does not create the checkpoint yet.
5. Read each **Before · HEAD** and **After · checkpoint** version. Check the project, message and file list, then tick the review box.
6. Choose **Create local checkpoint**. The receipt shows its commit ID and local reference, such as `refs/nakama/checkpoints/<id>`.



The checkpoint contains the **entire saved working copy** of each selected file on top of the current HEAD. For example, if you staged one change and then made a second saved edit, both edits appear in the selected file's checkpoint version. Unselected files come from HEAD. Your branch, working files and staging area stay as they were. Selected deletions are recorded only inside the checkpoint; this action does not delete another working file.

The review lasts ten minutes and is checked again before creation. If selected content, HEAD, staging, configuration or the workspace changes, prepare a fresh review. Changing the selection/message or refreshing the panel also discards the old review. Other Nakama file operations cannot run while a checkpoint is being prepared or created. External editors and Git clients remain separate processes; these checks are not an operating-system sandbox.

Checkpoints are stored only in this repository on this PC. They are **not a backup on GitHub**, are not included by an ordinary branch push, and will be lost if you remove the repository. Existing HEAD files and history remain part of the checkpoint; the selected-file review is not a scan of all historical secrets.

### Find a saved checkpoint

The receipt's reference identifies an ordinary local Git commit. In the project's terminal, these read-only commands list checkpoints and inspect one:

```powershell
git for-each-ref --format="%(refname) %(objectname) %(subject)" refs/nakama/checkpoints/
git show --stat refs/nakama/checkpoints/REPLACE_WITH_RECEIPT_ID
```

Replace the example suffix with the exact ID from your receipt. Nakama does not yet include checkpoint history, restore, branch or merge controls. Use your usual Git client to recover changes deliberately; avoid resetting a working tree that contains edits you still need.

If creation times out or the result is unconfirmed, inspect the displayed reference before starting another checkpoint. Nakama does not automatically retry it. A lost response does not prove that Git failed to save the commit.

### Which files can be saved

Select up to 20 changed UTF-8 text files, with at most 256 KiB per before/after version and 2 MiB across the selection. Nakama excludes recognised credential paths/content, binary files, links, conflicts, renames, submodules and executable-mode changes. A staged-only change whose current working copy matches HEAD has nothing new to save here. Use your Git client for those cases.

Content is stored exactly as reviewed, without Git filters or line-ending conversion. Checkpoint creation uses a temporary index and a fixed local author (`Nakama checkpoint`); it does not use your signing key or run repository hooks. Recognised-secret checks are a precaution, not complete secret detection. Review the contents before saving them into Git history.

## If Git is not ready

- **Git is not installed:** install Git for Windows and restart Control Center so it can find the executable.
- **This project is not a Git repository:** the project needs its own repository first. Creating a Nakama project does not automatically initialise Git. Use the project's reviewed command workflow or your usual Git client to initialise it.
- **Repository not supported:** this preview supports an ordinary `.git` directory directly inside the project. Linked worktrees, submodules, partial clones, shared object stores and linked metadata need your usual Git client.
- **Custom configuration cannot be used:** external filters, filesystem monitors, configuration includes and settings that refer to outside files are rejected. The app does not run them to prepare a preview.

Git inspection uses the repository's own configuration and attributes, with an isolated empty user profile. Global/system customisations are ignored. This can differ from your usual client's view when you rely on global settings such as line-ending conversion; put relevant non-executable project settings in the repository where appropriate.

## Limits and privacy

The list shows at most 1,000 changed files. Text previews are limited to 256 KiB and explicitly marked when truncated. Git commands have a 15-second deadline. The metadata scan allows up to 20,000 entries and 24 levels; unusually large repositories should be inspected with Git directly.

Common credential formats are redacted in read-only diffs; commit/checkpoint reviews reject recognised credentials instead of concealing content that would be saved. This is not guaranteed secret detection. No diff is sent to an AI merely by opening this view. Read-only Git endpoints require project access; GitHub operations additionally require Google/shared-data access on Android. Checkpoint creation remains owner-only.

Paths stay within the selected project, and linked files cannot be followed through this view. Local validation is not an operating-system sandbox against a simultaneous malicious process changing files on your PC.

## Verification

Tests use real disposable Git repositories on Windows, including staged and unstaged edits, deleted/untracked/binary files, Unicode and leading-dash names, an unborn branch and unchanged index checks. Additional cases reject metadata links and unsafe configuration, prevent external diff/text-conversion commands, isolate inherited/global settings, enforce output/deadline limits and verify device permissions.

GitHub tests substitute a disposable local remote and synthetic account metadata. They exercise reviewed commits, staging preservation, fetch/pull, approval and remote-lease checks, credential-helper scoping and uncertain-result recovery without publishing anything. They do not establish live GitHub account access, organisation permissions or physical Android acceptance.

Implementation references: [Git status](https://git-scm.com/docs/git-status), [Git diff](https://git-scm.com/docs/git-diff), [Git 2.29 configuration](https://git-scm.com/docs/git-config/2.29.0). The old Git version installed on the build machine requires extra care: a `core.fsmonitor=false` override is not safe there because it can be interpreted as a command name.
