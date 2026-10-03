# Claude subscription usage

The Usage screen reads account quota metadata without sending an inference prompt. It shows recognized five-hour, weekly and model-specific weekly allowance percentages and provider reset times. Missing/unknown values remain unavailable. Extra-usage billing values, account identity and raw provider responses are not sent to desktop or Android views.

Claude Code's documented `/usage` command is an interactive local command. Nakama does not submit `/usage` through `--print`: a command that is not supported in that mode must not become a model prompt. The official CLI reference and commands pages are the user-facing references:

- [Claude Code commands](https://code.claude.com/docs/en/commands)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)

The adapter uses the same literal HTTPS account endpoint as the CLI's local `/usage` implementation: `GET https://api.anthropic.com/api/oauth/usage`. This is a CLI-internal interface, not a stable public API contract. Its path/header were checked against the official published CLI source (2.1.10), and the installed 2.1.284 native CLI still contains the same endpoint/header identifiers. Schema changes fail closed rather than producing guessed percentages.

## Authentication and repair

On Windows/Linux, the adapter reads the existing Claude Code subscription credential from its standard local store, honoring `CLAUDE_CONFIG_DIR`. It requires an unexpired subscription token with profile-read scope. It ignores API keys, alternate inference providers and refresh tokens. It does not modify the credential file. macOS keychain extraction is not implemented.

A connected CLI can still have an expired cached access token. On the PC, **Open Claude /usage on this PC** opens an official interactive terminal in a newly created empty temporary directory. The owner can complete any sign-in there, then return to Nakama and refresh usage. Only the CLI handles refresh/login. This explicit owner-only action has fixed `/usage` input, safe mode, no user/project settings, no MCP servers, no tools and no Chrome connection. The official CLI manages its own local authentication and session metadata; its print-only no-session-persistence flag is not used for interactive commands. It cannot accept arbitrary command text. Windows quoting preserves empty and JSON arguments. The launcher itself stays hidden; the requested Claude terminal is visible and owns normal terminal input/output.

Android displays the sign-in/PC-handoff guidance but cannot open a host terminal. Normal Check/Refresh usage does not open terminals, modify credentials or call models. Usage snapshots share a 30-second cache and run only on explicit reads. Repeated checks during that window retain the original timestamp.

## Network and output boundaries

The account reader has a 12-second maximum deadline (10 seconds by default), a 64 KiB credential/response bound, redirects disabled, a fixed destination and only an allowlisted quota output schema. Token expiry, invalid scope, failed authentication, oversized data, missing windows and network errors produce a generic unavailable/error result. No credentials or raw account errors are included in logs or responses. Revocation while a host metadata read is pending is checked again before delivering it to a phone.

## Verification

Synthetic tests in `tests/claude-usage.test.mjs`, `tests/provider-usage.test.mjs` and `tests/claude-usage-handoff.test.mjs` cover schema normalization, exact GET destination, no prompt/body, no redirects, API-only/expired/invalid credentials, deadline/size limits, private output filtering, cache invalidation, owner-only handoff and fixed Windows arguments. Handoff tests use a fake process executor and do not open a user's terminal. An authorized read-only check on 2026-10-03 used installed Claude Code 2.1.284 in an isolated empty directory, with safe mode, empty settings sources, no MCP servers/tools/Chrome and the fixed interactive `/usage` command. It displayed its allowance panel and reported zero model tokens and zero API duration. The CLI refreshed its own expired session; the normal Nakama metadata reader then returned available allowances. No credentials or account quota values are retained in this repository. The observed typed `limits` schema also identifies a Fable weekly window; its allowlisted percentage/reset fields have a synthetic regression. Physical-device verification is reported separately.
