# Talk, carry out a task, or build a project

Nakama now chooses the AI and workflow automatically from your request. Configure the defaults once in **Settings → AI roles**; see [automatic conversations and the planning handoff](automatic-assistant.md). The three modes below remain available under the optional advanced override controls.

For a saved sequence of observations and tool decisions, use **Tasks → Autonomous tasks**. That separate engine asks questions, retains receipts, verifies observations and coordinates exact PC-approved project checks. The older one-shot **Do a task** mode below keeps its existing boundaries. [Current autonomous scope and limits](autonomous-tasks.md).

| Mode            | What happens                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Discuss**     | Your chosen AI explains, plans or reviews. Its reply does not perform an external action or save generated files.                                                                                    |
| **Do a task**   | One selected AI proposes a short supported action plan. Nakama validates it and uses its own account, project or phone tools. Results come from those tools.                                         |
| **Build files** | Inside a project, the first selected AI proposes complete files. Nakama checks paths and conflicting edits, saves valid files, and retains recovery copies. Other team members review independently. |

Do a task does not require an open project. In a team request, only the first provider plans actions; the others cannot repeat them. Connect Codex and Claude through their official subscription clients, then verify the configured models with a deliberate first task. These are the two available AI workers. Kling video requests use their own reviewed Video studio or MCP workflow and are not another chat worker. Your Google accounts and phone permissions still have to be connected separately.

## Examples to try

- “Create a project called Garden planner.”
- “Show the latest emails in my personal Gmail inbox.”
- “What is on my personal calendar?”
- “Schedule an event called Dentist on 2 October 2026 from 14:00 to 14:30 UK time in my personal calendar.”
- “Email alex@example.com, subject Running late, message: I will arrive at 6 pm.”
- “On my phone, call +447700900123.” Use a real intended number when you actually want a call.
- “Open WhatsApp on my phone.”

These examples describe real effects once the relevant accounts and permissions are enabled. Do not use a message or call example as a harmless connectivity test. Start with a project or a read-only inbox/calendar request.

## Recipients and message text stay explicit

Automatic email sending requires the exact email address and full message text in your current request. Put the message **after its recipient**, either in quotes or after `message:`/`body:`/`saying`. Its spelling and capitalisation must match; the validator rejects a shortened or rewritten body and text belonging to another recipient. Keep each request simple. Use the Personal/Google composer if you want to draft and edit first.

On Android, the local phone command parser can resolve “call Mike” against your contacts. If several contacts match, choose one. A desktop-planned call requires the actual number; a contact-name search can return possible recipients for a later explicit action. SMS and WhatsApp flows open drafts and report that you still need to tap Send. WhatsApp voice calls and Discord username messaging are not automated in this preview.

## Confirmation and results

Your ordinary-action confirmation setting applies to account writes and queued phone actions. Project deletion always requests desktop approval. Deployment, paid generation, arbitrary commands and screen-control sequences use their explicit app flows; Do a task cannot silently run them.

A plan has at most five steps. Its structure, payloads, identities and permissions are checked before execution; these checks do not prove the model interpreted a date or your intention correctly. Be explicit about the account and date, and enable ordinary-action confirmation if you want to review writes first. If a step fails or its result cannot be confirmed, further steps stop. Earlier successful steps are not undone. Requests are not automatically repeated after network uncertainty.

Read the result carefully: **pending approval** means the desktop owner still needs to approve; **queued** means the phone has not yet reported its result; Gmail acceptance does not prove delivery. An uncertain result needs checking before you send a new request. Stop prevents subsequent plan steps, but cannot undo an API call already in flight or an action already queued for a device.

The planner is given the current user request and available identity labels. Previous email, webpage and file contents are not automatically included in that prompt. Retrieved messages are displayed as data, without a second automatic action-planning round. Disabled Google access hides the Google account catalogue from that phone. If Nakama asks for clarification, make the next request self-contained, including the desired account, recipient and action.

Claude's action planner runs with built-in tools disabled. Codex still has read-only CLI tools: the request not to read files is a prompt instruction, not a hard no-file-access sandbox. Nakama uses an empty assistant folder when no project is selected. See [security boundaries](security.md) before sharing sensitive project context.

This is a bounded personal-assistant mode. It is not yet a continuous agent that can reliably operate arbitrary apps through long sequences of screenshots and clicks.
