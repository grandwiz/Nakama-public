# Kling video and the Nakama MCP

Nakama can prepare a text-to-video request with Kling, show it for approval on your PC, submit it once, and check the result. ChatGPT and Claude stay your everyday assistants. Kling is a separate video service and does not use either assistant's subscription allowance.

**Video generation starts disabled.** Connecting an account or looking at its balance does not authorise a video. Each video needs approval in Windows Control Center. There is no automatic purchase, top-up, fallback provider or replacement video after a failed or uncertain submission.

## What is an MCP?

An MCP connection gives an AI client a small set of named tools. Nakama's Kling MCP lets a compatible local client discover the available video models, prepare a video request and check its progress. It cannot approve its own request or change your spending permissions.

The MCP connects to the running Nakama Control Center on the same PC. Control Center remains responsible for your permissions, approvals and job history. It uses the official Kling Global CLI for Kling login and operations.

## First connection

1. Install the latest Nakama Windows update and keep Control Center open.
2. Make sure Node.js with npm is installed. If you have just installed it, close and reopen Control Center so it sees the new command paths.
3. Open PowerShell and run the command below. You can run it from any normal folder; it does not need to be your project folder.
4. Complete the official Kling sign-in in the browser. Use your **Global Kling account**.
5. In Control Center, open **AI team** and find **Bring your ideas to life with Kling**. **Kling setup** also shows the login command. Choose **Refresh Kling** to retrieve your current models, supported settings and credit balance. Opening this page does not automatically contact Kling.

```powershell
npm exec --yes --registry=https://registry.npmjs.org --package=@klingai/cli-global@0.2.0 -- kling login --skill-name kling-ai-cli --skill-version 1.0.5
```

This command may download and execute the pinned official package from npm. Nakama uses exactly `@klingai/cli-global@0.2.0`, matching the installed Kling integration guidance. You do not need to install a second global `kling` command. Login belongs to the official CLI; do not paste Kling passwords, cookies or login files into Nakama or an AI chat.

An existing Kling web subscription may have different credit rules from the CLI service. Read the account result shown by Kling. An unknown balance is displayed as unknown and blocks generation; Nakama does not treat it as an unlimited allowance or a zero-cost offer.

## Make one video

1. Choose **Refresh Kling**, then enable **Allow Kling video generation** only if you want to allow approved requests to use your existing Kling credits. The toggle allows preparation; it does not itself generate or approve anything.
2. Pick an available **Kling model**. In **Describe your video**, write the scene in order: its opening state, the subject's action, the camera movement and the ending. Include sound only if you want it and the model supports it.
3. Use only the settings shown for that model. Changing model changes its available settings. Omitted settings use the provider's declared defaults.
4. Choose **Prepare video for approval**. Preparation creates a review item; it does not generate a video.
5. Choose **Review approval** to open **Activity & approvals**. On the PC, review the model, prompt and parameters, then explicitly approve the request if you want to spend Kling credits on it.
6. Use **Check video status** on the existing job. Do not submit another copy while it is queued, running or uncertain.
7. When complete, choose the relevant **Open result** link. Nakama records the provider's consumed-credit value when one is returned. Save a result yourself if you need a permanent copy.

Kling's account balance is an availability check, **not an exact price quote or a guarantee that a video costs a particular number of credits**. Nakama checks the current balance immediately before submission and blocks known empty or unreadable balances. Approval allows the reviewed job to use Kling credits; there is no currency conversion or invented cost estimate.

Result links can expire after 24 hours. Keep the job ID and work index. Refreshing that same job may return a current link; it does not create another video. Nakama exposes the primary result URL and does not automatically choose a separate watermark-free download.

## Connect an AI client to the MCP

On the Kling screen, choose **Create MCP configuration**, then **Copy MCP configuration**. It contains the correct local server path, Nakama address, certificate fingerprint and a revocable connection token. Copy that configuration into your compatible client's **local stdio MCP** settings, then reload its MCP connections.

The installed update includes the MCP server. You should not have to locate its internal packaged files yourself. Keep Control Center running whenever the client uses its Kling tools.

Treat the copied configuration as private: its token gives access to this limited Kling connection. Do not commit it to GitHub, paste it into a chat or share it with someone else. Choose **Revoke MCP access** when you stop using a client. **Replace MCP configuration** creates a new configuration; the old token then stops working. The token does not grant deployment, project deletion, general app control or owner approval access.

For developers running from the source checkout, the stdio entry is `apps/kling-mcp/server.mjs`:

```json
{
  "mcpServers": {
    "nakama-kling": {
      "command": "node",
      "args": ["C:\\Projects\\Nakama\\apps\\kling-mcp\\server.mjs"],
      "env": {
        "NAKAMA_KLING_URL": "https://127.0.0.1:43110",
        "NAKAMA_KLING_TOKEN": "COPY_FROM_YOUR_PRIVATE_NAKAMA_CONFIGURATION",
        "NAKAMA_KLING_FINGERPRINT": "COPY_THE_NAKAMA_SHA256_CERTIFICATE_FINGERPRINT"
      }
    }
  }
}
```

These are placeholders, not usable credentials. For an installed copy, use the app's generated configuration rather than this source-checkout example. The source entry requires the repository's npm dependencies; the packaged entry bundles its MCP dependencies.

## Available tools

| Tool | What it does | Generates a video? |
| --- | --- | --- |
| `kling_status` | Reads Nakama's local connection and permission state. | No |
| `kling_catalogue` | Refreshes live text-to-video models and supported parameters. | No |
| `kling_account` | Reads Kling membership and remaining credits when supplied. | No |
| `kling_jobs` | Lists Nakama's existing Kling jobs and pending reviews. | No |
| `kling_prepare_video` | Creates a request for approval in Windows Control Center. | No |
| `kling_job_status` | Refreshes one existing job once. | No |

There is deliberately no approve or direct-submit MCP tool. Only the owner action in Windows Control Center can submit the prepared video.

A useful first instruction is: “Check my Kling connection and available video models. Prepare one short video of a wave rolling onto a quiet beach, with a slow camera movement and no sound. Show me the request for approval.” A live account check may contact Kling but this sequence cannot approve or generate the video by itself.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Node/npm is unavailable | Install Node.js with npm, reopen Control Center and refresh. |
| Login or account discovery failed | Run the official login command above, finish in the browser, then refresh. Do not copy login files into Nakama. |
| No supported models | Refresh after checking account access. Nakama does not invent model names or reuse another model's parameters. |
| Balance unknown or empty | Check the signed-in Kling account. Generation remains blocked; do not assume it is free. |
| Request awaiting approval | Open Windows Control Center and review it. An AI client cannot approve it for you. |
| Submission uncertain or missing a generation ID | Stop. A job may have been billed or started. Check your Kling account. Nakama never automatically repeats it and blocks further submissions while the outcome is unresolved. This preview has no owner resolution screen for an unknown outcome; get help with that specific job before trying another submission. |
| MCP connection revoked | Create a fresh connection in Control Center and replace the old client configuration. |
| Certificate changed | Copy the current configuration from Control Center. Do not turn off certificate checking. |
| Old result link expired | Refresh that same job and use the same work index's refreshed primary URL if returned. |

## Scope of this preview

This version supports **text-to-video**. Image-to-video, reference uploads, reusable Elements, motion control, batch generation and automatic downloads are not implemented. The adapter does not silently turn a reference-image request into text-only generation.

Automated checks cover argument validation, model discovery parsing, credit checks, approval boundaries, single submission, safe result handling, MCP protocol negotiation and certificate pinning. They use fixtures and disposable local servers. They do not prove a live account's model access, credit eligibility, queue speed or output quality. No paid video is generated as a test.

## Technical notes

Nakama starts npm through its JavaScript entry point with a fixed package and registry, separate argument values, an isolated working folder and empty npm configuration files. npm uses its own Windows command wrapper; prompt line breaks and tabs are converted to spaces before you review the request, and control characters are rejected in parameter values. This keeps the complete approved prompt intact when Windows launches the CLI. The MCP uses the official TypeScript SDK over stdio. Its HTTPS bridge accepts only loopback addresses, checks the pinned certificate before sending its bearer token, caps request/response sizes and restricts paths to the six operations above. Provider credential files and raw diagnostic output are never returned by these tools.

The implementation follows the [official Kling Global CLI package](https://www.npmjs.com/package/@klingai/cli-global) and the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). Kling's live `who_am_i` and `tool_list` remain the authority for model names and settings; this guide does not hardcode a model catalogue.
