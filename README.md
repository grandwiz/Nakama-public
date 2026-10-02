<p align="center"><img src="apps/desktop/assets/mascot.svg" alt="Nakama screen companion" width="150" /></p>
<h1 align="center">Nakama</h1>

Nakama is a Windows and Android personal assistant with configurable ChatGPT and Claude roles, local personal tools and a managed development team. Source is available under the [MIT license](LICENSE). Users run their own host and connect their own eligible accounts; no accounts, credentials, provider allowance or signing keys are bundled.

**Source-only engineering preview.** This repository starts with a reviewed clean source snapshot. It contains no private development history, installed profiles, screenshots, generated reports, filled personal checklists or application binaries. It is not a production-release or universal-autonomy claim. Read [current capabilities](docs/implementation-status.md), [verification](docs/verification.md), [security](docs/security.md) and [release signing](docs/release-signing.md).

## What it does

- Local tasks, routines, editable memory, learned methods and direct navigation.
- Configurable manager, planners, developer and two independent reviewers; questions return through the manager. Local commands/checks and consequential operations retain their approval boundaries.
- Projects, selected-file Git changes, scoped service adapters, local preview checks and reports with honest unverified outcomes.
- Private browser handoffs; agents cannot read private sessions. Paired Android devices receive only permitted shared data.
- Local website stock/text monitoring and scoped Windows/Android application observation. Dedicated shop sessions can persist privately, with human CAPTCHA, payment and order completion.
- Held self-improvement requests, isolated source candidates and guarded signed-update handoff with explicit approval and recovery copies.

Monitoring defaults to a configurable 60-second interval without AI calls per poll. It requires a running Windows host. Its automatic cart adapter supports a narrow, verified native-form flow; arbitrary shops and Pokémon Center compatibility remain unverified. Phone alerts require a connected foreground app or visible Mote service. See [Monitoring](docs/monitoring.md).

Dynamic upgrade does not silently rewrite the running application or start provider work. Actual approved checks and both independent reviews precede signed-package approval. Installed health and automatic rollback are unfinished. The unsigned/debug development builds cannot qualify as production releases. See [Dynamic upgrade](docs/dynamic-upgrade.md).

General computer/browser/app autonomy is the direction. Unrestricted app input, broad authenticated forms and fully autonomous website delivery remain unfinished. Synthetic tests do not establish live provider eligibility, merchant compatibility, physical-device reliability or performance.

## Build from source

Use Windows 10 or later, Node.js 24 and npm. Android additionally requires JDK 17 and SDK 36. Review dependency and provider terms before use; see [notices](NOTICE.md) and [dependency notices](docs/third-party-notices.md).

```powershell
npm ci
npm test
npm run build
npm start
```

`npm run dist:win` creates an **unsigned local development installer**, not a production-signed release. There are no prebuilt downloads in this source release. Configure production signing, dependency notices, identity checks and deliberate installation/recovery acceptance before distributing binaries. [Release process](docs/release-signing.md).

For Android build commands and limitations, read [Android verification](apps/android/VERIFICATION.md) and [Android setup](docs/android-guide.md). The normal debug task uses your own local development key. It will not update an installation signed by another key. Never uninstall an existing app merely to bypass a signature mismatch; preserve its data and signing identity.

## Set up your own installation

1. Choose a dedicated workspace in Windows Control Center. Keep the host awake when using it from a phone.
2. Check saved model roles and connect eligible accounts through the providers' official authentication flows. Subscriptions, hosting, domains and optional services may cost money; there is no automatic paid fallback.
3. Enable the private-network listener deliberately and pair each trusted phone separately. Android pins the host certificate. Do not expose the host directly to the public internet.
4. Try local commands such as “add task check my Nakama setup”. Then follow the [testing guide](docs/testing-guide.md).

Kling is optional and disabled by default. Every generation requires a separate PC approval and may consume credits. Deployment, DNS, command and source-write authority is scoped; page contents and models cannot grant permissions. Read [permissions and private data](docs/security.md).

## Guides

| Topic | Guide |
| --- | --- |
| Installation and pairing | [Quick start](docs/quick-start.md) |
| Team roles and development | [Project workflow](docs/project-workflow.md) |
| General task coordination | [Autonomous tasks](docs/autonomous-tasks.md) |
| Monitoring and shopping boundaries | [Monitoring](docs/monitoring.md) |
| Self-improvement and update gates | [Dynamic upgrade](docs/dynamic-upgrade.md) |
| Acceptance checklist | [Blank fillable PDF](docs/assets/Nakama-Test-Checklist.pdf) · [Markdown](docs/feature-checklist.md) |
| Security reports | [Security policy](SECURITY.md) |
| Contributions | [Contributing](CONTRIBUTING.md) |

The blank checklist contains no personal acceptance results. Keep filled copies, account/vault data, pairing payloads, private browser partitions, location/history, reports, crash logs and signing keys outside Git.

## Support

If Nakama helps you, you can [support development with a coffee](https://buymeacoffee.com/nakamaai). Bug reports, documentation improvements and contributions are welcome. Do not include secrets or private screenshots in public issues.
