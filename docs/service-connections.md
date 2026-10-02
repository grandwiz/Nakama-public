# Connect your development services

Nakama keeps service credentials in the **Windows-protected vault**. The Android app, Chrome extension, renderer and AI prompts cannot retrieve stored API tokens. An explicit private Android handoff can accept a newly entered credential and submit it directly to the Windows vault; it is not saved in chat or agent context. Each connection can have several named accounts; select the correct account for every operation.

These adapters provide a deliberately small set of real API operations. They do not pretend that a saved token alone proves an account is connected.

## Included operations

| Service | Read-only operations                                                                        | Write operations                                                                         | Current limits                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GitHub  | Repositories visible to the selected account; deployments for an explicit owner/repository. | Account-bound import/fetch/pull, reviewed local commits and exact PC-approved pushes; typed repository creation in Delivery. | Ordinary GitHub HTTPS repositories only; no automatic merge or history rewriting. Separate Delivery plans can create a repository but do not initialize/publish local Git. See [GitHub projects](github-projects.md). |
| Vercel  | Existing projects and deployment metadata.                                                  | Exact-commit deployments; Delivery also creates unlinked projects, sets referenced environment values and adds domains. | No local directory upload, domain purchase or automatic health certification. Creating a project does not deploy/link Git.    |
| Render  | Existing services and their deployment metadata.                                            | Exact-commit deployment; Delivery also creates free web services and sets referenced environment values.    | No plan upgrade or managed database adapter. Service creation starts its initial deployment; later auto-deploys are disabled. Cron jobs are excluded.              |
| Neon | Projects, branches and database metadata. | Delivery creates projects and stores scoped connection results in the vault. | No SQL/migrations or deletion; the existing metadata browser still returns no connection secrets. |
| Namecheap | Existing custom nameserver settings. | Delivery replaces the exact selected domain's custom nameservers. | Eligible API account and whitelisted client IPv4 required; no registration/purchase or general DNS-record editor. |
| Resend  | Domain names and verification status.                                                       | Send an explicit plain-text email with a stable request ID.                              | No attachments, campaigns, automatic retries or delivery-webhook processing. “Accepted” does not mean delivered.          |

Google Gmail and Calendar use Nakama's separate Google OAuth integration with explicit account selection. Optional Kling video generation uses its own CLI sign-in and [MCP connection](kling-mcp.md); it is not enabled by connecting a Google account.

Lists return up to 30 items per request, with continuation information where supported. Account permissions and provider plan limits still apply. A read-only list does not create resources or start a deployment.

## Add an account

1. Open **Control Center → Connections**.
2. Choose the service and enter a clear label, such as `Personal GitHub` or `Business Vercel`.
3. Create an API credential in that service's official account settings. Grant only the access you want Nakama to use.
4. Enter the credential in Control Center's protected connection form. Do not paste it into an AI conversation or commit it to Git.
5. Verify the connection, then load the relevant resource list.

Use a credential belonging to the account/workspace containing the resources. If Vercel resources belong to a team, specify its `teamId`. A personal Neon key may also require an `orgId`; organisation keys infer their organisation. Resend domain listing needs domain-read/full-access privileges, while a send-only key can have narrower access and may not list domains.

The host calls fixed official HTTPS origins, sets a 15-second timeout, refuses redirects and limits response size. It returns selected metadata rather than proxying entire provider responses, environment variables or database secrets. Provider error bodies are hidden because they can contain sensitive request details.

## Delivery plans, grants and private setup

Open **Delivery** for the typed operations above. Select the project, named account and labelled action fields, then prepare a plan. Preparation makes no remote write. Review the frozen exact settings and request PC approval, or choose an existing matching project grant. A grant itself needs explicit PC approval and binds project/account/action/exact settings, expiry and quota; it is not a general permission to use a service. See [the full delivery guide](project-delivery.md).

Protected project values are immutable vault references, never literal values in a plan. Changed values need a new reference and matching authorization. The post-review manager can use these typed operations and receipts, pause for questions/approval and continue under fresh guards. Its final result is **review required**. A provider resource status does not certify your website, database, domain or checkout.

Every prepared plan is single-attempt. The attempt is persisted before dispatch, and an uncertain response is not automatically retried. Service deletion, arbitrary endpoints, billing upgrades and purchases have no adapter. Creating a Render free service includes its initial deployment, so it needs matching deployment-aware authority and verified account eligibility. Vercel project creation is separate from linking/publishing Git and deployment. Nameserver replacement can affect website and mail routing; preserve existing DNS requirements and verify propagation separately.

In Delivery, the owner can ask one selected permitted Android device to add a named account. The ten-minute handoff submits a new credential directly to the host vault; it cannot read or replace existing credentials. A private browser login alone does not establish API authentication. Namecheap uses the protected JSON bundle `apiUser`, `apiKey`, `userName`, `clientIp`; the account must have eligible API access and whitelist that client IPv4. Do not place this bundle in answers, voice, reports or chat.

Git initialization/publication, dependency installation, migrations, payment-provider onboarding, unsupported DNS records and end-to-end acceptance remain separate work. A grant does not cover Git pushes or arbitrary project commands.

## Existing-resource deployments with fresh approval

The existing `/api/deployments` route needs **fresh approval in the Windows Control Center** for every deployment, including previews. Turning off ordinary-action confirmations does not change this rule. The separate typed Delivery routes accept exact approval or an explicitly approved matching bounded project grant.

The approval records the selected Nakama project, provider account, remote target and exact 40-character Git commit SHA. The adapter accepts only the stored operation associated with an executing deployment approval. It cannot deploy by supplying an arbitrary request body after approval.

### Existing Render service

Prepare the project in Render first, connect its Git repository and configure its build command, environment and service plan. Push the commit that should be deployed.

Choose the saved Render account, Nakama project, Render service ID and exact commit SHA. Review those values in the approval. When approved, Nakama calls Render's deployment endpoint with that commit and retains the existing build cache.

The service's existing configuration determines its plan and build behaviour. Nakama does not purchase a new service or silently change its plan. Triggering a deployment can still use the hosting account's existing resources. **Render's independent automatic-deploy settings remain in effect**; Nakama does not disable them. [Render deployment API](https://api-docs.render.com/reference/create-deploy)

### Existing Vercel GitHub project

Import the GitHub repository into Vercel first, configure its build settings/environment and push the desired commit. Select the existing Vercel project and provide:

- Its project ID and project name.
- The linked GitHub repository's numeric ID.
- The branch or tag and exact 40-character commit SHA.
- The Vercel team ID, if applicable.
- Preview or production target.

Nakama defaults to **preview** and submits the exact Git source to Vercel only after approval. The local folder is a project association; **uncommitted or unpushed local files are not uploaded** by this adapter. Existing Vercel Git auto-deploy rules remain independent of Nakama's manual approval workflow. [Vercel deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)

### Understand the result

`submitted` means the provider returned a deployment ID. It does not mean the build finished, the deployment became healthy or a production domain was updated successfully. Refresh the deployment list or open the provider dashboard to inspect its current status.

If the request times out, Nakama records **unconfirmed**. The provider may have received it. The same approval cannot be replayed automatically. Check the provider dashboard before making a new deployment request and granting a new approval.

## Send a Resend email

Use the email form for a direct request with an explicit sender, recipient list, subject and exact plain-text body. Your sender must meet Resend's domain-verification and account requirements. This is separate from sending mail through your personal Gmail account.

- Ordinary confirmations **on**: the exact email becomes a stored `service_email` approval before it can send.
- Ordinary confirmations **off**: your explicit authenticated send request can execute immediately.
- Model output, webpage content and incoming email text do not grant permission to send.

The form generates a stable request ID for one send. Nakama records the attempt before making the network request and sends a matching Resend idempotency key. Repeating a successful identical request returns the saved email ID; reusing the ID for different content is rejected. A timeout blocks blind automatic retries. Resend also retains provider-side idempotency keys for 24 hours. [Resend sending API](https://resend.com/docs/api-reference/emails/send-email)

`accepted` means Resend accepted the email and returned its ID. Delivery, bouncing or spam placement require provider-side status or future webhook support. No test in this repository sends a real email.

## Technical route contract

The existing resource/deployment/email routes below remain supported. New setup, provisioning, grants, account handoffs and delivery-run routes are defined in the [shared API contract](api-contract.md#website-setup-and-delivery). Their payloads are separate; a legacy request cannot silently become broader provisioning.

The adapter implementation is in `apps/host/services.mjs`. The host's route integration supplies authentication and exposes these methods; it never accepts an arbitrary upstream URL.

```text
GET /api/services/:provider/:accountId/:resource
POST /api/deployments
POST /api/services/resend/:accountId/send-email
```

Read resources and optional query parameters:

| Provider | Resource       | Parameters                                         |
| -------- | -------------- | -------------------------------------------------- |
| `github` | `repositories` | `page` or `cursor`                                 |
| `github` | `deployments`  | required `owner`, `repo`; optional `page`/`cursor` |
| `vercel` | `projects`     | `teamId`, `cursor`                                 |
| `vercel` | `deployments`  | `teamId`, `remoteProjectId`, `cursor`              |
| `render` | `services`     | `cursor`                                           |
| `render` | `deployments`  | required `serviceId`; optional `cursor`            |
| `neon`   | `projects`     | `orgId`, `cursor`                                  |
| `neon`   | `branches`     | required `remoteProjectId`; optional `cursor`      |
| `neon`   | `databases`    | required `remoteProjectId`, `branchId`             |
| `resend` | `domains`      | `cursor`                                           |

List response:

```json
{
  "provider": "render",
  "accountId": "saved-account-id",
  "resource": "services",
  "items": [{ "id": "srv-example", "name": "My service" }],
  "hasMore": false,
  "nextCursor": null,
  "limit": 30
}
```

Render deployment request:

```json
{
  "provider": "render",
  "accountId": "saved-render-account-id",
  "projectId": "local-nakama-project-id",
  "serviceId": "srv-example",
  "commitId": "0123456789abcdef0123456789abcdef01234567"
}
```

Vercel deployment request:

```json
{
  "provider": "vercel",
  "accountId": "saved-vercel-account-id",
  "projectId": "local-nakama-project-id",
  "vercelProjectId": "prj_example",
  "deploymentName": "my-project",
  "repoId": "123456789",
  "ref": "main",
  "commitId": "0123456789abcdef0123456789abcdef01234567",
  "target": "preview",
  "teamId": "team_example"
}
```

Resend email body, with account ID supplied by the route:

```json
{
  "requestId": "stable-random-request-id",
  "from": "owner@example.com",
  "to": ["friend@example.com"],
  "subject": "Project update",
  "text": "The exact message the user requested."
}
```

`prepareDeployment` and `prepareEmail` validate and canonicalise input before the host saves it in an approval. `deploy(approvalId)` reads the stored approval itself. `sendEmail(operation, {principal, approvalId})` checks the direct authenticated principal and, when required, the matching saved email approval.

## Tests and current verification

Run:

```powershell
node --test tests/services.test.mjs tests/service-provisioning.test.mjs tests/service-agent.test.mjs tests/connection-handoffs.test.mjs
```

Fixtures use mocked fetch responses; see [verification](verification.md) for the current results and counts. They cover metadata-only results, typed plans/grants, private handoffs, secret references, uncertain writes, fixed origins, timeouts/redirect policy, missing accounts, path injection, hidden provider errors, response-size limits, required approvals, exact commits, concurrent/replayed deployment prevention, unconfirmed network outcomes, exact email approval, idempotency and header-injection rejection.

These are adapter and policy tests. No credential, live provider account, deployment or real email was exercised. Your first authenticated use still needs to verify token scopes, existing project/service configuration and provider-specific responses.

Primary API references: [GitHub repositories](https://docs.github.com/en/rest/repos/repos), [Vercel deployment list](https://vercel.com/docs/rest-api/deployments/list-deployments), [Render service list](https://api-docs.render.com/reference/list-services), [Neon projects](https://api-docs.neon.tech/reference/listprojects), [Neon databases](https://api-docs.neon.tech/reference/listprojectbranchdatabases), [Resend domains](https://resend.com/docs/api-reference/domains/list-domains).
