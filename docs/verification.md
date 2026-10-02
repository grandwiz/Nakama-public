# Verification

Nakama is an engineering preview. These results establish the listed local and synthetic checks; they do not certify live provider accounts, retailer checkout, production updates or reliable unattended device operation.

## Tested implementation

| Check | Recorded result and scope |
| --- | --- |
| Host suite | 607 passed, zero failures, one optional Chromium-extension case skipped (608 total). Providers were synthetic; local browser and process fixtures were disposable. |
| Build | Strict TypeScript, Vite and the standalone MCP bundle passed. A bundle-size advisory remains. |
| Monitoring | Revision, expiry, Stop, restart pause, exact-device sharing and revocation, sensitive or ambiguous outcomes, single cart attempts and private takeover races passed. |
| Native browser | Isolated Chromium exercised synthetic stock/text/CAPTCHA/queue/cart pages, persistent profile isolation, profile forgetting and existing browser regressions. Release review reproduced service-worker interception; the fix blocks/clears workers and cache during automatic transitions while retaining cookies/localStorage. The native worker regression passed. It did not use a merchant account. |
| Desktop UI | An isolated native fixture checked drafts, paused monitor creation, selected-phone sharing and held upgrade requests, with no provider calls or remote page loads. |
| Dynamic upgrade | Fifteen focused tests within the host suite covered source staging, saved preferences, check and independent review evidence, artifact trust, exact approvals, private backup, cancellation and prevention of replay. No production installer was launched. |
| Android | 77 JVM tests and eight focused Android 16 emulator tests passed. Lint reported zero errors, 34 warnings and two informational hints. See [Android verification](../apps/android/VERIFICATION.md). |
| Release preparation | Eleven release-gate tests passed, including actual-byte/identity binding and synthetic backup restoration into a fresh directory. Four notice tests are included in the host total. The npm runtime inventory covers 156 production placements in 148 notice groups. Neither result certifies signed installation or complete Android binary notices. |

Code review and regression checks covered privacy revocation, stale navigation, one-use cart dispatch, source export and publisher trust. Successful checks are evidence for their tested paths, not a guarantee that every supported workflow or device has been accepted.

## Reproduce local checks

Install the development dependencies as described in the README, then run from the repository root:

```powershell
npm test
npm run build
node scripts/verify-browser-studio.cjs
node scripts/verify-monitoring-native.cjs
node scripts/verify-monitoring-ui.cjs
node scripts/verify-autonomous-task-ui.cjs
node scripts/verify-project-workflow-ui.cjs
```

Native Electron fixtures require Windows and normal process permissions. Renderer fixtures use Playwright configured through `NAKAMA_PLAYWRIGHT`. Fixtures must use disposable local profiles; do not redirect them to installed application data. Some optional integration checks require additional local tooling and report their absence explicitly.

The source repository does not contain installed packages, private acceptance records, signed release artifacts or personal checklist results. Building from source creates local outputs. Package verification scripts validate locally prepared artifacts and are not evidence of a published release.

## Remaining acceptance

- Live model eligibility, quality, costs and end-to-end autonomous project delivery require a user's accounts and explicit authorization. There is no paid fallback or automatic release of the development hold.
- Website monitoring is best-effort polling. Arbitrary JavaScript storefronts, Pokémon Center stock drops, real login/CAPTCHA/queue behavior and payment handoff have not been accepted. Cart preparation cannot pay or place an order.
- Physical Android voice, background notifications, accessibility observation, battery use and third-party application behavior require separate device acceptance.
- Windows preview builds are unsigned. They cannot pass the signed update gate. Signed installation, restart health and deliberate recovery remain unaccepted; recovery is manual.

Use [Monitoring](monitoring.md), [Dynamic upgrade](dynamic-upgrade.md), [Security](security.md) and the [testing guide](testing-guide.md) for their operational boundaries. Never use a real purchase, message, deployment or billing change as a disposable test fixture.
