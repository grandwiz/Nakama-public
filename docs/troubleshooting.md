# When something does not work

## Nakama is slow or the office appears empty

**Settings → AI roles → Fast Nakama interaction** is separate from the project manager. It defaults to Astra 6 at low effort until another suitable GPT model is verified. A queued acknowledgement is immediate local feedback; the final answer still waits for the official subscription client and provider. Detailed/research requests use deeper roles, so a longer response time can be expected. Local “what are you working on?” and board/navigation commands do not wait for a model.

The Agent office shows actual recorded jobs. Local commands such as opening a board do not create an artificial model agent. Switch from **Current work** to **Including history** for completed jobs. A desk without output has no returned output yet. Unsupported snapshot data shows unavailable rather than invented work. On Android, both project and Google access are required for shared office and memory data.

## A navigation request stayed on the same page

Use an explicit phrase such as “open agent office”, “open routines”, “open core memory” or “open learned skills”. “Show my tasks” can return a list instead of moving. Unsaved edits require your normal save/cancel decision. Results arriving after newer navigation or an edited draft are discarded; send the request again from the screen you now intend to leave. Old history cannot replay navigation.

Android app opening uses an exact visible app name or package and asks you to choose when several match. Back, recent apps and notifications need the existing active control session. Opening Android settings never grants permissions automatically. See [Android navigation and limits](android-guide.md).

## A learned skill is missing, paused or unused

Windows **Learned skills** and Android **Tools → Learned skills** use the PC's saved library. Update both apps and connect to the same paired PC. Android needs both Google/shared and project access; a denied device must not receive the library or its receipts.

Check **Learn useful methods**, **Reuse relevant skills** and the overall conversation-memory setting separately. Turning memory off pauses both automatic paths but keeps entries editable. Direct teaching recognises the exact single-line `Teach skill: TITLE | When: CONTEXT | Steps: FIRST; SECOND` format; it does not learn arbitrary quoted instructions or replay old conversation. Recognised credential text is rejected. The library holds at most 50 skills, with 12 steps per skill; see [all field bounds](learned-skills.md).

A workflow-derived candidate stays disabled until you inspect and accept it. Editing alone does not activate it. Candidate creation requires a completed delivery, finished writers and both current reviewers passing; full libraries or unsuitable content can produce no candidate. Deleting one prevents the same delivery from automatically recreating it.

Reuse is deliberately selective: ready/enabled entries need the exact title or at least two meaningful matching terms, and only three methods within a bounded payload can fit. Large or unrelated methods can be omitted. “Selected for a task” does not prove the provider read or followed it; late edits, pause or access changes can withhold previously selected context. Learning does not train the underlying model or grant a new tool.

## GitHub import, commit or push is blocked

Choose the intended saved account in **Connections**, then the same account in import/link. Repository listing is explicit. Tokens must have access to that repository, with any organisation/SSO approval and branch rules satisfied. Read operations and pushes can require different permissions. Do not paste a token into a repository URL or chat. Only ordinary HTTPS `github.com` repositories are supported; [the setup guide](github-projects.md) lists restrictions.

- **Import fails:** it needs an existing nonempty default branch, Git for Windows and a configured workspace. Import uses a new folder and does not initialise an empty remote. Unsupported links, submodules, unsafe paths or custom Git configuration need your usual Git client.
- **Link is refused:** use a project-root `.git` directory with an initial commit and supported branch. An existing origin pointing elsewhere is not silently retargeted. Imported Nakama links do not configure origin/upstream for external tools.
- **Pull is refused:** commit or deliberately handle dirty files and staging first, including untracked files. Nakama never stashes automatically and only accepts fast-forward history. Divergence/conflicts need your Git client.
- **Commit review is refused:** select 1–20 eligible UTF-8 files, at most 256 KiB per version and 2 MiB total. Selected staged/partly staged files, recognised credentials, renames, binary content and unsupported metadata need direct Git review. Unselected staging is preserved.
- **Review expired or state changed:** refresh and prepare again. Ten-minute previews bind the current content, branch, staging, configuration and requester. Restart also discards them.
- **Push is only requested:** open Activity & approvals on Windows. The phone cannot approve it; the ordinary-action setting does not remove this gate. The reviewed push can trigger repository automation.

Ahead/behind values come from the last fetch. They are not a live remote monitor. A push rejected by permissions, branch protection or a changed remote does not justify forcing it. Inspect GitHub after an unconfirmed result before preparing any new request.

## Git reports unfinished Nakama commit recovery

An uncertain ref update or staging finalisation may leave `.git/index.lock` and `.git/nakama-commit-recovery.json`. Keep both, stop new Git mutations and inspect the recorded old/new commits and actual branch/index with your usual Git tools. Do not delete the lock blindly or repeat the commit: the branch may already have advanced. Nakama has no automatic repair that overwrites staging to guess the result.

After any pull, an already open editor buffer must be reloaded before saving. This prevents an older cached file from overwriting new Git content. Local checkpoints remain separate from branch commits and are not included in an ordinary branch push; see [the comparison](git-changes.md).

## The app says a provider is connected, but a task fails

A saved CLI login is only a sign-in record. The first real request can discover that its session expired. Read the task log, sign in again through the provider's official CLI, and press Check connection. Do not paste subscription passwords or browser cookies into Nakama.

Verify each configured model with a deliberate first task after sign-in. A linked account alone does not establish model access or successful task completion. Both workers must keep a verified first-party subscription sign-in. See [provider guidance](provider-options.md). Kling video generation is a separate connection with its own account, credits and per-job approval.

## Claude works in PowerShell but Nakama cannot connect

**You do not need to open PowerShell in your Nakama project folder.** Sign-in normally belongs to your Windows user account. Use the same Windows account that runs Control Center. A PowerShell profile that selects a different CLI installation or a custom account-data directory can make the two applications see different sign-ins.

For Claude, run these in ordinary PowerShell:

```powershell
claude auth login --claudeai
claude auth status
```

Complete the browser sign-in with your Claude subscription, then use **AI team → Claude → Check connection**. If the status command still says you are logged out, Nakama cannot use that login yet. You do not need to leave the interactive Claude window open. Do not share the contents of credential files. If Claude was installed while Nakama was already open, quit Nakama from its tray menu and reopen it before checking again.

## Kling video setup or generation is unavailable

Follow [Kling MCP setup](kling-mcp.md) using the official pinned CLI and your own Kling account. Refresh the connection and model list in **Video studio**. Do not paste credentials into a chat. Generation is intentionally disabled by default and requires explicit owner enablement plus approval for each prepared request. Unknown credits or cost are not evidence that a video is free. No live paid generation was used to test this build.

If you have upgraded from the older media integration, its pending requests cannot run. Historical receipts and generated files are preserved locally; an uncertain old remote job may still have finished and should be checked with its original provider.

## `npm start` cannot find Electron

Some managed npm environments skip dependency installation scripts. After `npm ci`, run `node node_modules/electron/install.js`, then `npm run build` and `npm start`. Use the project's pinned dependencies. The Windows installer includes the runtime, so launching the packaged Control Center does not require a separate Node.js installation. Running approved npm project checks still requires installed Node.js and npm on the PC.

## The phone cannot reach the PC

Check these in order:

1. The PC is awake and Nakama is running or visible in the Windows tray.
2. Both devices are connected to the same private network, or the same private VPN when using mobile data.
3. In Windows Nakama Settings, enable **Allow paired devices over a private network**. Use the tray menu **Quit Nakama and disconnect devices**, then reopen Control Center. Closing the window alone usually keeps its old listener running.
4. In **Devices → Pair a device**, choose the PC's Wi-Fi/Ethernet address for the same home network, or its private VPN address for mobile data. Port 43110 uses HTTPS. Do not choose a VirtualBox, Docker or other virtual-machine adapter for your phone. The updated pairing screen shows detected adapters and whether a full restart is still needed; **Check network again** refreshes this information.
5. Windows Firewall allows this app/port only on the intended private network. Do not disable the firewall or open a public router port.
6. Create a fresh ticket if the old two-minute ticket expired. Copy the complete payload and fingerprint.

**“Failed to connect to localhost/127.0.0.1:43110” means the phone tried to connect to itself.** Generate a new ticket using the PC's private address. Addresses such as `localhost`, `127.0.0.1`, `0.0.0.0` and `::1` cannot pair a separate phone. The updated desktop prevents these Android tickets; Android also explains the problem before making a request.

Detected addresses are suggestions, not a successful phone connection test. Windows Firewall can still block the listener. If your trusted home Wi-Fi is labelled Public by Windows, check its network profile and a suitably scoped firewall allowance. Do not enable a broad public-network rule or disable the firewall to get pairing working. Nakama does not change the Windows network profile or firewall for you.

An Android certificate mismatch means stop and re-pair deliberately through your trusted desktop. Do not turn certificate validation off. If the PC's protected application data was reset, its identity may have changed.

## The Chrome extension cannot connect

Chrome on the PC uses the separate local bridge `http://127.0.0.1:43111`. Android's HTTPS ticket is not a Chrome ticket. Reload the unpacked extension after updating its source, pair again if revoked, then allow the specific tab. A changed website or expired tab session needs a new allowance.

Browser deployment/deletion controls deliberately require direct human completion. A click accepted by Chrome is not proof that a purchase, message or deployment succeeded.

## Android says a permission is missing

Open the relevant Settings entry from Nakama. Calls need phone permission; named recipients need contacts permission; speech needs microphone permission. The overlay and accessibility service have separate special-access screens. A sideloaded app may also require Android's user-controlled “Allow restricted settings” step. Manufacturer menus vary.

Nakama does not unlock the phone, approve its own permission prompts, bypass protected screens, or suppress the visible control-session notification. A tablet without cellular hardware cannot place a normal cellular call. App calls depend on that app and its own account.

## The voice is not the one I wanted

In **Device → Your British English voice**, choose an installed offline voice and tap **Preview voice**. Choose Slower, Normal or Faster if needed. Voice names and offline availability depend on the installed Android speech engine. Use **Android speech settings** to install English (United Kingdom) data, then return and tap **Refresh voices**. Internet-only or missing voice data is not silently used. Female-sounding voice selection is a preference you audition; Android's voice identifiers do not consistently provide gender metadata.

If Talk says no on-device recognizer is available, you can keep typing or configure offline recognition through **Android voice input settings**. You may deliberately enable **Allow Android recognition service**; its provider may receive audio. Nakama does not automatically use it after an error or call a paid voice API. After granting microphone access while the app is not active, return to Chat and tap Talk again.

## A build says the project changed

Someone edited a target file while the model was working. Nakama refused to overwrite that edit. Review the current project and ask for a smaller new Build files task. Recovery copies for completed changes are in the private host data's `file-recovery` folder, with a manifest showing original and new hashes.

## A deployment or media request is “unconfirmed”

Do not repeatedly press Send or generate another request. The provider may have accepted the original request before the connection failed. Inspect its dashboard first. Nakama retains uncertain receipts to avoid automatically repeating a paid or externally visible action. For Kling, check the existing job when its generation ID is known; a lost submission response is not permission to submit again.

## How to completely stop Nakama

Use the Windows tray menu **Quit Nakama and disconnect devices**. Closing the window keeps the host running when “Close to tray” is enabled. Stop the Android mascot/control notification separately. Revoking a device prevents future authenticated host requests; it does not undo actions that already finished.
