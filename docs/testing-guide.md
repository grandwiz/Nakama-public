# Test your current Nakama

Use this guide after updating both Windows and Android. It is ordered so you can find basic problems before starting an account-dependent project or enabling device services.

The [blank public PDF](assets/Nakama-Test-Checklist.pdf) and [Markdown checklist](feature-checklist.md) cover 222 checks across 23 PDF pages. Your separate personal copy under `output/pdf` retains its saved values; newly added checks start unchecked. Do not upload private acceptance values as part of a public template. A previous tick does not prove the latest update still passes. Save your personal PDF after changing it, then reopen it to confirm the checks were retained.

**READY** means implemented and available to test. **SETUP** needs an account or permission. **PARTIAL** means a limited subset, and **LATER** is unfinished. These labels are separate from your acceptance ticks.

## Record useful results

Copy this block for each issue or testing session:

```text
Date/time:
Windows package/source revision:
Device and Android version:
Checklist ID or feature:
Exact typed/spoken request:
Expected result:
Actual result and displayed error:
Task/agent/workflow ID or name, if shown:
Reproduces after reopening? Yes / No / Not tried
```

Do not include passwords, pairing payloads, tokens, private message contents or signing keys in a report. Record permission changes you made so they can be restored deliberately.

## 1. Update and preserve your setup

- [ ] Quit Control Center from its tray and install the new Windows build.
- [ ] Install the APK over the existing app on the phone and tablet. Keep app data.
- [ ] Check saved projects, accounts, pairing, device permissions, voice choice, Core Memory and any existing skills before changing them.
- [ ] Open the major pages in light/dark mode, at your usual text size and on both Android orientations.
- [ ] Confirm the editable PDF opens, your older checks remain and new boxes save/reopen correctly.

If Android reports a signing mismatch, stop that update and report it; uninstalling would erase the pairing you're trying to preserve. The package manifest records the delivered hashes.

## 2. Try local commands first

These examples use disposable personal notes and do not need an AI answer:

- [ ] “Add task test the Nakama clipboard.” Check that Windows and Android show the same card.
- [ ] Complete it, reopen it, edit its title, then remove it. It should stay removed after refresh.
- [ ] Add a reminder routine called “testing stretch” with a known time and time zone. Edit, pause and remove it from the other device.
- [ ] “Remember that I prefer short test replies.” Inspect, edit and forget the note in Core Memory.
- [ ] Pause learning, then share a new preference. It should not be automatically captured. Restore your preferred learning setting.
- [ ] Turn conversation memory off and verify saved notes remain editable while reuse is paused. Restore your preference.

For daily cleanup, leave a completed disposable card overnight. The following host day it should clear; reopening an asleep host should catch up. Removing/checking a workflow card must never delete its project or finish a running worker.

### Try a reusable method

- [ ] Open Learned skills on Windows and Tools → Learned skills on Android. Teach a disposable method in the editor and confirm the same entry appears on both.
- [ ] Try `Teach skill: Test label review | When: reviewing test labels and keyboard focus | Steps: Read each visible label; Walk the keyboard focus order; List checks not performed`. A local receipt should appear without a new model task.
- [ ] Edit its steps, disable and re-enable it, then inspect source and selection details. Ordinary edits must not change host provenance or invent test results.
- [ ] Pause skill learning and repeat direct teaching with a different title. It must not report a saved method. Manual editor changes remain possible. Restore the intended preference.
- [ ] Pause reuse separately, then turn overall conversation memory off. Saved methods remain visible; automatic learning/reuse stay paused until their required settings are restored.
- [ ] If doing an ordinary account-backed task anyway, ask for this exact method or a relevant task and inspect selection receipts. An unrelated prompt should not include the whole library. A selection count is not evidence the answer followed every step.
- [ ] After a disposable managed project completes both reviews, inspect any candidate. It must remain disabled after editing until explicitly accepted. A candidate is not guaranteed for every project.
- [ ] Forget the disposable entry and refresh/reopen. Its selection receipts disappear; forgetting a workflow candidate must not recreate it from the same delivery. Existing project files and task history remain.

Read [bounds and candidate limitations](learned-skills.md). No additional model request is needed merely to learn, edit or inspect a method.

## 3. Check fast conversation and navigation

- [ ] In AI roles, inspect the separate fast Nakama assignment. Changing it must not silently change planners, researchers or developers. Preserve your preferred models.
- [ ] Send a short ordinary question, then a detailed question. Inspect the recorded model/effort and answer; do not judge accuracy by speed alone.
- [ ] Time transcription completion, queued acknowledgement and final answer separately. A quick receipt is not a quick generated answer.
- [ ] Ask “open agent office”, “go to projects”, “open the task board”, “open routines”, “open core memory” and “open learned skills”. Verify the intended destination. “Show my routines” can instead return the list.
- [ ] Repeat navigation with voice on Android. Confirm a request on one device does not unexpectedly move the other device.
- [ ] Reopen the conversation and refresh. Old navigation messages must not execute again.
- [ ] On Windows, leave a settings draft unsaved before navigating away. The existing draft guard must still apply.

Current local map/weather commands can return explicit lookup links. A link or last-known position is not proof that current weather or live GPS was retrieved.

## 4. Meet the agents

Start one small account-backed request only after the connection is ready:

- [ ] Agent office shows actual queued/running work with a generated name and provider label.
- [ ] GPT desks are light green and Claude desks orange. Names and labels remain readable on both devices.
- [ ] Select a screen. Confirm assignment, status and available output/error agree with the task history.
- [ ] Refresh/reopen: the same agent keeps its name; a new worker gets a distinct identity/name.
- [ ] A managed project shows its manager and actual children, with planner/developer/reviewer roles distinguishable.
- [ ] Ask “what are you working on?” and navigate while a worker is busy. The response must report recorded state rather than invent progress.
- [ ] Cancel disposable work. Confirm the cancelled/interrupted state is distinct from successful completion and the office settles after it stops.
- [ ] An empty office is clearly empty; completed history must not look like an active background worker.

The office is not a live terminal or a view of private reasoning. A worker can be running without returning text yet.

## 5. Run one small project end to end

Use a disposable project. Verify the exact accounts/models and Fable's documented billing setup first. Do not turn usage credits on just to pass a test.

1. Ask for a small offline page with two or three clear requirements.
2. Read both planning contributions and the manager's combined plan. Answer genuine questions on one device; ensure the answer is saved on the other.
3. Confirm implementation waits while required questions remain unanswered.
4. Inspect resulting files. For supported root npm checks, read each script and its pre/post hooks on the PC before approving it. Reviewers must wait for the actual process outcome.
5. Use a harmless failing check to observe a bounded worker repair and a fresh approval for the rerun. Confirm test intent remains intact. Stop/reject instead of approving unfamiliar or externally mutating scripts.
6. The manager should deliver only after the final checks succeed and both reviewers pass. A project without supported checks must explicitly say tests were not executed. Confirm Windows/Android status and the PDF reflect actual receipts, not live-site certification.
7. Use a second disposable run to verify Stop or host restart reports interruption and does not silently resume writes.

Do not deliberately delete a real project or run unfamiliar commands for acceptance. Deployment and deletion approval screens can be reviewed and declined. Failed account eligibility is a setup result, not permission to silently choose a different model.

### Review GitHub work separately

Use a disposable checkout and a repository you are authorised to read. Do not use important staged work or a production deployment branch for acceptance.

- [ ] In Connections select the intended GitHub account; load repositories deliberately. Import one existing repository into a new workspace folder and verify the account/repository/name. Existing projects and files must remain intact.
- [ ] Read branch/HEAD and changes from Windows and Android. Refresh is local; Fetch may update comparison counts without changing files. Counts describe the last fetch, not continuous remote status.
- [ ] In a disposable checkout, review and create one harmless local text commit with explicit author identity. Verify its branch commit and unchanged working bytes. Selected staged files should be refused; unrelated staging should survive.
- [ ] Compare this with a local checkpoint: its separate receipt/ref must leave branch and whole index unchanged.
- [ ] Exercise Pull only when a deliberate harmless remote update exists. Dirty work must block it; a clean fast-forward should require reloading any already open editor file before saving.
- [ ] Prepare a push review and request approval. Confirm Android cannot resolve it and that the exact account, repository, branch, commit and automation warning appear on the PC. Declining it must perform no push.
- [ ] Treat a real approved push as a separate deliberate publication, after checking repository automations. It is not required for the local regression pass and no live push was used by automated fixtures.

An expired/stale preview or host restart requires a fresh review. An unconfirmed transport or retained commit-recovery record requires inspection before retrying. See [GitHub setup and recovery](github-projects.md); do not induce crashes or remove recovery locks in a real project as a test.

### Website setup, internal browser and delivery

Use a disposable local project and harmless local content. These checks do not require a real deployment, DNS change, purchase, credential or model request; automated fixtures use synthetic transports. Live account acceptance is separate and deliberate.

- [ ] Open **Project setup**, describe a hosted website and save partial answers. Refresh on the other device; confirm the latest revision is visible and a stale save is refused without losing the draft. Do not put secrets into answers.
- [ ] Confirm required answers block **Start planning**. Choosing a new local folder must not claim a remote repository was created. Additional planning/account questions remain visible.
- [ ] In **Nakama browser**, open anonymous research. Confirm unsupported dynamic/account-only pages fail honestly. Verify a local project session stays inside its approved preview origin. Preview scripts run with your Windows authority, so inspect them before approving.
- [ ] Take human control of a harmless page. Verify fresh-frame controls, Stop, session expiry and that the office no longer shows its pixels. Release must not restore agent access; create a fresh session for agents.
- [ ] Inspect an explicit Android private-session/account handoff and cancel it. Confirm other phones cannot claim it, expired requests disappear and notifications have generic text. Test actual provider login only as a separate intentional account-setup step; never paste a real credential into chat or a fixture.
- [ ] In **Delivery**, prepare a harmless review plan. Inspect exact project/account/action/settings and decline its approval. Preparation and denial must perform no remote write. Review a grant's exact scope/expiry/quota, then decline or revoke it; do not authorize a real write merely to test the UI.
- [ ] Confirm pending approvals/questions, Stop and interrupted runs remain honest. Completed coordination must show **review required**, not a claim that the site is certified live. An unconfirmed service attempt must not be retried automatically.
- [ ] Browse nested folders and eligible text/image/PDF files on both apps. A stale or unsupported file must fail clearly. Generate/open/save/remove a local report; verify actual reviews/checks and unfinished acceptance, plus no private browser image. Turn automatic reporting off and back on for the disposable project.
- [ ] Disable the phone's Google/project/browser permissions as applicable and confirm stale private frames, reports and setup details are cleared. Restore only the permissions intended for that phone.

See [project delivery](project-delivery.md) and [internal browser](internal-browser.md) for exact limits. A real website's URL/TLS/DNS, frontend/backend/database integration, admin/recovery, mobile/accessibility and payment-provider test checkout require separate recorded acceptance. A READY deployment receipt or generated PDF does not pass those checks.

## 6. Test Android voice and local navigation

Perform each on the phone and tablet separately:

- [ ] Widget Talk and mascot Talk open the correct conversation after permissions.
- [ ] The chosen voice is understandable; Stop interrupts speech and a backgrounded conversation does not speak another request's result.
- [ ] The optional local wake listener responds to a leading “Nakama”/“Hey Nakama” and ignores unrelated speech. Test visible Stop.
- [ ] Nakama does not listen to its own spoken reply; wake listening pauses around ordinary recognition/TTS.
- [ ] Unsupported local speech recognition is explained without a hidden cloud fallback.
- [ ] Local app-page commands reach Chat, Projects, boards, memory, Learned skills and Agent office.
- [ ] Android Home/settings/app-opening commands reach the requested destination. Check ambiguity rather than allowing the wrong installed app to open.
- [ ] Where Back/Recents/notifications require the visible control session, missing or expired permission is explained. Stop ends that authority.

Test after screen-off and ordinary backgrounding, and note battery impact. Reboot/force-stop behaviour is a separate observation; uninterrupted 24-hour listening is not established.

## 7. Test alarms, location and Windows remote desktop

**Alarm:** create a clearly named test routine a few minutes ahead, target the intended phone and enable local alarm sync. Verify exact-alarm/notification permission, the schedule receipt, actual sound and dismissal. Edit then cancel a second test before it fires. Confirm the phone received cancellation; an offline phone may retain its previous schedule. Check time zone, Do Not Disturb and volume if it stays silent.

**Location:** explicitly enable sharing on the intended phone. Verify observation/receipt times and accuracy on Windows, then briefly disconnect/reconnect the phone and confirm stale/offline reporting. Stop collection locally; use Forget on the PC to remove its saved last-known fix. Confirm another paired phone cannot read the first phone's location. Opening a map/weather link deliberately shares coordinates with that selected service.

**Remote Windows:** enable the overall setting and the intended device permission. Open a harmless local test window, connect from Android and verify the displayed monitor. Try a click, drag, scroll and short text in a disposable field; switch monitors if you have several. Test Stop on both ends, backgrounding the Android page and the bounded session expiry. Stop before any PC-only approval. Do not use messages, purchases, deployments or deletion as remote-input tests.

## 8. Check connection/privacy regressions

- [ ] PC asleep/offline is clear; reopening does not replay old actions.
- [ ] Existing pairing survives an ordinary update and both devices keep independent permissions.
- [ ] Temporarily disable a test device's Google/shared access. It must lose AI/shared history, boards, memory, office and skills access, plus GitHub operation/link metadata. Restore the intended setting afterwards.
- [ ] Project-disabled devices lose the corresponding shared data as well.
- [ ] Remote desktop starts disabled unless deliberately enabled; no update grants control automatically.
- [ ] Chrome works only on explicitly allowed tabs; clear a test tab's allowance to stop access.
- [ ] Gmail/Calendar identities remain separate and correctly labelled. Use read-only checks first.
- [ ] Kling remains disabled. Its live login/model/credit checks and any paid generation are separate optional acceptance, not required for ordinary Nakama.

Real messages, calls, paid video, purchases, deployment and destructive operations are not needed for this regression pass. The full checklist retains these capabilities so unfinished or deliberately untested areas remain visible.

## 9. Save what you found

Tick only behaviour you actually observed. Leave account- or hardware-dependent items unchecked when unavailable, and record why. Reopen the saved PDF to verify its fields. Report exact requests and task/agent names with expected versus actual behaviour; this is more useful than a general “slow” or “not working”.

Use [troubleshooting](troubleshooting.md) for connection problems and [verification](verification.md) to distinguish developer fixture evidence from your acceptance results.

Developer Skills tests use deterministic model fixtures; GitHub tests use local disposable repositories and synthetic account/transport data. Native renderer and emulator fixtures do not establish live GitHub access, useful real-model learning or acceptance on your physical-device hardware. Keep those observations separate when ticking the checklist.
