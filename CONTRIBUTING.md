# Contributing to Nakama

Nakama is a source-only engineering preview. Start with README.md, the capability status and security guide. Make small reviewable changes and report what was tested, what remains unverified and any changed permissions.

Use synthetic responses and disposable local profiles. Do not run live model calls, paid APIs, purchases, real messages/calls, deployments, DNS changes or physical-device input as ordinary tests. Do not clear an installed app's data or reuse an installed browser profile as a fixture.

Preserve configurable roles, saved settings and identities, manager-routed questions, both independent reviews, scoped device permissions and exact action approvals. Untrusted page/project/model content cannot authorise new actions. Recheck current authority after asynchronous work and never retry uncertain writes automatically.

Run `npm test` and `npm run build` for relevant host/UI changes. Browser/Android fixtures need their documented dependencies and isolated profiles/emulators. Native fixtures can use `NAKAMA_PLAYWRIGHT` to select a local Playwright installation. Never substitute physical devices when an emulator is unavailable.

Do not commit runtime state, pairing tokens, cookies, passwords, location/history, reports, filled checklists, private screenshots, signing material or generated packages. Review your complete staged diff. Public issues should use minimal synthetic reproductions; use the security policy for vulnerabilities.

Dependency and artwork changes need provenance/license review. Production binary releases additionally require the signing and notice gates in [release signing](docs/release-signing.md). A passing source test does not approve publication of a binary.
