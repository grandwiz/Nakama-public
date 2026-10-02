# Accounts and running costs

**30 September 2026. Existing subscriptions are used without automatic paid API fallback.** ChatGPT and Claude are the general assistants. Kling is a separate optional video service. Adding its MCP does not buy credits or include them in your existing plans.

## Compare your options

These are suggested spending targets, not provider prices or packages. No paid option is selected. Existing subscriptions, electricity, mobile data, tax and hosting are outside these figures.

| Option                                | Extra monthly target | What you can use                                                                              | Trade-off                                                                                |
| ------------------------------------- | -------------------: | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Existing subscriptions — selected** |               **£0** | ChatGPT through Codex, Claude through Claude Code, installed Android speech and your awake PC | Existing limits apply. Leave Kling credit use disabled; no automatic paid fallback.      |
| Optional occasional video             |               £5–£15 | Core features plus whatever Kling allowance you deliberately obtain                           | Check actual Kling prices. This is a target, not a promised number of clips.             |
| Optional more video iterations        |              £25–£50 | More separately approved Kling work if its current plan suits you                             | Variants consume credits. Nakama does not enforce a sterling billing cap or buy credits. |

Kling can report a credit balance, but this is **not an exact generation quote**. Nakama blocks submission for an unknown or zero balance. A positive balance does not prove a particular clip is affordable. Every generation needs a new desktop approval. Review provider renewal/top-up controls independently. [Official Kling CLI](https://www.npmjs.com/package/@klingai/cli-global).

## Connect your accounts

| Connection       | Setup                                                                        | Boundary                                                                                 |
| ---------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ChatGPT / Codex  | Run `codex login` and check AI team                                          | Existing subscription connection; API-key authentication is rejected for these tasks.    |
| Claude Max       | Run `claude auth login --claudeai`, finish browser sign-in and check AI team | First-party subscription session; Console/API-key/external-provider routes are rejected. |
| Gmail / Calendar | Connections → Connect Google, with your desktop OAuth client                 | Independent personal/business identities; this does not configure Kling.                 |
| Kling            | Official pinned CLI login from Kling setup, then Refresh Kling               | Separate account and credits, deliberate enablement and one approval per video.          |

Run sign-in under the same Windows user as Nakama, from any folder. Expired sessions may need refreshing. Verify pairing and each account on your own installation; successful sign-in does not establish model eligibility or device acceptance. [Codex authentication](https://learn.chatgpt.com/docs/auth), [Claude subscription use](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan).

## Choose an exact Claude version

Automatic conversations use **Settings → AI roles**. **Fast Nakama interaction** is saved separately and starts with `gpt-6-astra` at low effort until a faster suitable model is verified. Detailed conversation, planning, research and development keep their own assignments. The Faster everyday replies switch does not override the exact interaction assignment.

New project defaults use Astra 6 Ultra to manage/plan/review, Claude Fable 5.1 to co-plan/review, and `claude-opus-4-8` for development. Fable and Opus request Nakama's restricted Ultracode mode, mapped to xhigh workers with Nakama coordinating the workflow. Existing saved max/custom roles are preserved. See [project workflow](project-workflow.md) for exact IDs, preflight and the distinction from Claude's native dynamic workflows.

The optional manual **AI team → Claude → Preferred model** selector offers named Opus presets, moving aliases and a custom exact ID. Exact IDs pass through unchanged. Presets do not prove account eligibility; unsupported responses must not silently select another version. [Claude model configuration](https://code.claude.com/docs/en/model-config).

## Voice and private access

Use installed Android recognition and text-to-speech first. Preview an available British female-sounding voice on each device. Offline support depends on the installed engine; system recognition requires deliberate opt-in. No Nakama cloud-voice purchase is needed. [Android speech API](https://developer.android.com/reference/android/speech/SpeechRecognizer).

Mobile access needs an awake PC reachable through a private LAN/VPN. Check current personal-plan terms before choosing one. Do not expose Nakama's port on a public router. [Tailscale plans](https://tailscale.com/pricing).

Follow [Kling setup](kling-mcp.md) for video. Text-to-video, result links and explicit status queries are implemented. Image-to-video, automatic downloads, exact price quotes and automatic phone-to-Kling execution remain unfinished. No paid video was generated during development.
