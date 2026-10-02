# Make a video with Kling

Open **AI team → Bring your ideas to life with Kling** on Windows. Normal chat uses ChatGPT and Claude. Gmail and Calendar stay independent.

1. Open **Kling setup** and run the official CLI sign-in command under the same Windows user as Nakama.
2. Select **Refresh Kling**. This reads account models and credits without generating a video. The pinned CLI may download on first use.
3. Read the disclosure and enable **Allow Kling video generation** only if you intend to use those credits. ChatGPT/Claude plans do not cover Kling.
4. Choose a live text-to-video model, its supported options and a prompt. A project labels the request; output is not automatically downloaded into it.
5. Select **Prepare video for approval**, then **Review approval**. Check the full prompt, options and credit disclosure in **Activity & approvals** before approving. Reviews expire after ten minutes.
6. Check the recorded job's status. Open primary result links deliberately and save wanted output through the provider's download interface.

Exact charges are unavailable in this integration. Credit balance is a readiness check, not a price or guaranteed spending cap. There is no automatic retry, credit purchase or paid fallback.

## Connect an MCP client

Create and copy the private configuration using [the detailed guide](kling-mcp.md). It contains a restricted local token and certificate fingerprint, not your Kling credentials. Keep it private. Control Center must stay open on this PC.

The six tools read status, models, credits and their own jobs, prepare a review, or poll an existing job. They cannot approve spending, run commands, read project files, change settings or access email. Nakama's restricted coding workers do not automatically load this external MCP; use Video studio or a separately configured compatible client.

## Understand job states

| State                    | Meaning and next step                                                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Awaiting approval        | No generation sent. Approve or decline in Activity; expired reviews need a fresh request.                                                                                                                       |
| Declined / not submitted | No generation sent by this request. Correct setup or prepare another if wanted.                                                                                                                                 |
| Submitting / running     | One submission started. Wait or check its recorded ID; do not make a replacement.                                                                                                                               |
| Completed / partial      | Provider reported final results. Open primary links and inspect each output.                                                                                                                                    |
| Failed / cancelled       | Provider returned a terminal state. Check results and credits before another clip.                                                                                                                              |
| Unconfirmed              | Response lost or app restarted during submission. Check Kling directly. Nakama blocks another submission and never retries. Without an ID, recovery and clearing that block require future reconciliation work. |

Only one unresolved video is admitted at a time. Disabling generation or revoking MCP blocks new submissions; it cannot cancel an already sent request. The PC can still check known IDs. Result links may expire (the CLI contract states 24 hours); retain generation IDs/work indexes and save output promptly.

## Current limits

This preview supports **text-to-video** with scalar options from the live model declaration. Image-to-video, uploads, editing, motion control, automatic downloads and phone video controls are unfinished. Generic video requests in Nakama chat explain the studio/MCP route; they do not silently generate.

Tests use mock provider responses and real local MCP/TLS transport. Your login, current model/credit response and an explicitly authorised generation still need acceptance testing. No paid video was generated as a test.
