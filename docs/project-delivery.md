# Project setup, delivery and reports

Nakama separates a fast conversation from the deeper project team. The default team still uses Astra for management, Astra and Fable for planning/review, and Opus for implementation. Roles are configurable. This update adds upfront website setup, a post-review delivery manager, narrowly scoped service operations, Android account handoffs, file browsing and default PDF reports.

## Begin with the outcome

Describe the website and intended hosting in automatic chat, or open **Project setup**. A website request mentioning hosting, a domain or supported services creates a saved setup record immediately, without spending a model call on an acknowledgement.

Setup asks about:

- A new private repository, an existing repository or local-only work; account, branch and existing changes.
- Product requirements, audience, accessibility, mobile layout, content, brand assets and animation.
- Hosting/database providers, accounts, teams, regions, folders and build/start commands.
- Missing connections and how to obtain them privately.
- The domain actually owned, DNS management and existing email/MX/verification records to preserve.
- Spending limits and plan eligibility. The default is no purchase, upgrade or new paid resource.
- Fresh approvals versus an explicit, bounded project grant.
- Shop payments, products, shipping/tax, admin/customer access and recovery when relevant.
- Acceptance criteria and non-sensitive images for the final report.

Save partial answers from either device. Setup uses revision checks so one device cannot silently overwrite another's answers. Android voice fills a reviewable answer draft. Credentials belong in protected connection fields, not answers. All required setup answers must be present before **Start planning**.

Select an existing local project or give the new local folder a name. Creating that folder does not create a remote repository. Use **Projects → GitHub** to import/link an existing repository and to review commits/pushes. A new remote repository can be prepared through **Delivery → GitHub → Create repository**. The new-repository adapter does not automatically initialize, commit or push local files.

Additional questions can still arise when an account denies access, a live provider returns different capabilities or the planning team discovers missing requirements. Nakama saves those questions and relays them through the manager rather than treating a broad initial prompt as an answer.

## Account access from Android

Existing Windows **Connections** remain available. In **Delivery**, choose a supported provider and ask a specific trusted Android device to complete account setup. That device needs pairing, shared project/Google access and explicitly enabled Browser control.

The request expires after ten minutes and can add one new account for the named provider. On Android, use the private dashboard action to sign in, obtain the provider's API credential and paste it into the obscured account-setup field. Submit it explicitly. The credential travels over the pinned host connection and is stored in the Windows vault. The field clears on submit/pause and is not placed in chat, voice drafts, agent context, reports or notifications. Existing credentials cannot be read or overwritten through this handoff.

Signing into a dashboard alone does not connect its API. Provider access, token scopes, account eligibility, organization restrictions and verification remain real setup requirements. Namecheap requires an eligible API account, an explicitly whitelisted IPv4 client address, and the bundled `apiUser`, `apiKey`, `userName`, `clientIp` values. Its connection form uses that JSON bundle; do not put it in the project plan.

For application environment variables, Windows **Delivery → Protected project values** saves an immutable project-scoped secret reference. Plans use the reference, never the raw value. Neon connection responses can be stored in the vault the same way. A changed value receives a new reference and requires a new matching plan/authorization.

## Supported service work

All operations use fixed provider API origins and strict field allowlists. No arbitrary HTTP endpoint, service-delete operation, purchase or billing upgrade is exposed.

| Provider | Supported operations | Important boundary |
| --- | --- | --- |
| GitHub | Create a personal/organization repository, private by default | Local import/link, selected commits and exact pushes use the separate GitHub project workflow. |
| Vercel | Create an unlinked project, deploy an exact GitHub commit, set a named environment value, add a custom domain | Creating a project does not link Git or deploy. Domain verification can remain outstanding. |
| Render | Create a free web service, set one environment key, deploy an exact commit | Service creation starts its initial build/deploy. Later automatic deploys are disabled. Free-plan eligibility is not assumed. |
| Neon | Create a project, inspect returned operation statuses, obtain/store a scoped database connection | Wait for provider operations; a saved connection is not proof a database schema or application query works. |
| Namecheap | Replace an existing domain's custom nameservers and inspect registrar settings | No domain purchase/registration. Nameserver changes can affect website and email routing; DNS propagation is separate. |

Open **Delivery**, choose a project and account, fill the operation's labelled fields and select **Prepare plan**. Preparation freezes exact settings, account identity, project binding and expiry; it performs no remote write. Inspect the plan, then request PC approval or use a matching existing grant.

Before a write, Nakama durably records the attempt. Each plan can be attempted once. If a response is lost, the receipt becomes **unconfirmed** and no automatic retry occurs. Check the provider dashboard or read-only receipt verification before preparing any replacement. A crash does not resume an in-flight write.

## Project grants

Fresh PC approval remains the default for deployments and DNS changes. To reduce repeated prompts, review a bounded project grant in Activity. A grant binds the project location, saved account, allowed action and exact settings, and expires within 24 hours with a maximum of 30 operations. The interface starts with a one-hour, one-operation grant. Exact prepared settings include values such as commit, environment secret reference and nameservers; changing them does not silently broaden authority.

A grant is explicit confirmation, not a phrase inferred from chat or webpage content. Revoke it from Delivery. Expiry, exhaustion, changed project/account, device revocation and out-of-scope settings block dispatch. Service deletion remains unsupported even with a grant. Local project deletion retains its separate PC approval and recovery-folder behavior. Ordinary project command execution is a separate reviewed capability, not covered by these API grants or an operating-system sandbox.

## After implementation and dual review

For a hosted website begun through Project setup, Nakama starts a separate delivery manager after both static reviews and manager delivery. Managed workflows now run supported root npm checks with fresh PC approval before review and after repairs; no-script projects retain an explicit unrun status. Failed or interrupted required checks block delivery. An explicit local-only setup skips the service-delivery stage. You can also start a delivery run for a completed workflow from Delivery.

The manager receives saved project/account metadata, secret references and actual provider receipts. It can list, prepare, execute and verify supported service operations, using existing matching grants or pausing for an exact approval. Approval completion starts a fresh bounded continuation. No model is left silently running while waiting for the user. Stop, restart, changed reviewed files or revoked access prevent further dispatch. Questions are saved and appear on Android.

The coordinator cannot conjure unavailable accounts or unsupported operations. Git initialization/publication, dependency installation, database migrations, payment-provider onboarding, domain verification, custom DNS records and real end-to-end acceptance may still need separate supported workflows or user action. A provider reporting READY/live establishes its deployment state, not a fully working shop. The current coordinator ends at **review required**; it never sets a model-supplied live certification flag. The perfume domain in the design example was fictional and is never used by implementation or tests.

## Default PDF report

Projects default to generating a friendly PDF after a completed managed workflow. A delivery update can generate another report. Find them in **Projects → Reports** on Windows and the project's report panel on Android. Toggle automatic reports per project, generate a snapshot manually, open/save the PDF or remove an individual report.

Reports include the request, manager summary, recorded files, static reviews, executed-check receipts, service/deployment receipts, unfinished acceptance and visual evidence when available. Images can be selected bounded PNG/JPEG files or safe untainted local-browser captures. Private/login sessions and credential-preview paths are excluded. Reports do not perform extra model inference.

Windows renders data-only escaped HTML in an isolated Electron window with scripts and remote resources disabled. PDFs stay in private host data, separate from project source. Android previews PDFs through an isolated renderer service and saves copies through the system document picker. A PDF failure leaves the project outcome intact and shows a retryable report error.

Project text/images can still be private. Review the report before sharing it. A generated PDF is a summary of receipts, never a claim that unrun checks passed or that the website is live.

## Browse project files

Windows and Android provide folder rows, breadcrumbs, parent navigation and filtering. Open bounded text files, and preview supported PNG/JPEG/PDF files. Path containment, link rejection, size/header checks and permission rechecks apply. Binary previews are not a general-purpose file viewer; unsupported formats fail clearly. Existing file editing and stale-file safeguards remain in place.

## Verification and live acceptance

Development fixtures use disposable data and mocked provider transports. Native Chromium and PDF rendering are exercised locally. No real login, paid model/video, purchase, deployment, DNS change, message or physical input is a development test.

Before calling an actual website finished, verify its URL, TLS and custom DNS; frontend/backend/database interaction; admin access and recovery; accessibility and mobile behavior; and payment-provider test checkout. Record real outcomes in the [editable checklist](assets/Nakama-Test-Checklist.pdf). Account eligibility, costs and provider limitations remain subject to live verification. See [verification](verification.md) for the exact checks run on this source.

Provider contracts follow [Vercel project management](https://vercel.com/docs/projects/managing-projects), [Render service creation](https://api-docs.render.com/reference/create-service), [Neon project creation](https://api-docs.neon.tech/reference/createproject) and [Namecheap custom nameservers](https://www.namecheap.com/support/api/methods/domains-dns/set-custom/).
