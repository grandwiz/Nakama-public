"""Build Nakama's fillable, printable acceptance checklist and matching Markdown.

Requires reportlab and pypdf. Run from any directory:
    python scripts/build_checklist.py
The source of truth for checklist rows is PAGES below. New boxes intentionally
start unchecked. Existing PDF ticks are preserved by stable feature ID: this is
an owner-controlled acceptance checklist, not an automatic implementation claim.
"""

from pathlib import Path
import re
import tempfile
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "Nakama-Feature-Checklist.pdf"
MARKDOWN = ROOT / "docs" / "feature-checklist.md"
PUBLIC_OUTPUT = ROOT / "docs" / "assets" / "Nakama-Test-Checklist.pdf"
DATE = "2 October 2026"
WIDTH, HEIGHT = A4
NAVY = colors.HexColor("#14263F")
INK = colors.HexColor("#253952")
MUTED = colors.HexColor("#64748B")
TEAL = colors.HexColor("#008D94")
BLUE = colors.HexColor("#4E68DC")
CORAL = colors.HexColor("#D66745")
PALE = colors.HexColor("#EDF5F6")
PAPER = colors.HexColor("#F8FAFD")
LINE = colors.HexColor("#DAE2EA")


PAGES = [
    {
        "title": "Your Windows workspace",
        "label": "CONTROL CENTER",
        "accent": TEAL,
        "intro": "A friendly development client that keeps projects, tools and progress in one place.",
        "phase": "Phases 1, 2 and 6",
        "sections": [
            ("Make it yours", [
                ("WIN-01", "Simple first-run setup", "Choose a project folder, review access and finish setup without developer knowledge."),
                ("WIN-02", "Windows installation", "Install and launch Control Center on the supported Windows PC; show update status."),
                ("WIN-03", "Clear, adaptable interface", "Use readable light/dark themes, keyboard navigation, accessible contrast and helpful errors."),
                ("WIN-04", "Connections at a glance", "See account, device and tool readiness without fabricated connected states."),
            ]),
            ("Manage real projects", [
                ("WIN-05", "Recent project cards", "List projects with the most recently active first; open the correct saved workspace."),
                ("WIN-06", "Create and organise projects", "Create projects in the chosen root; find, reopen, rename and archive them safely."),
                ("WIN-07", "Project conversation and files", "Keep messages, generated files, previews and activity attached to their project."),
                ("WIN-08", "Understand ongoing work", "Show current task, agent progress, errors and a useful outcome with verifiable evidence."),
            ]),
            ("Build on your PC", [
                ("WIN-09", "Development command workflow", "Propose, approve where required, run and inspect commands inside an enforced permission boundary."),
                ("WIN-10", "Review and stop work", "Inspect file changes and command output; cancel jobs and resume supported sessions."),
                ("WIN-11", "Blender project creation", "Use the local Blender installation, save the scene and return a rendered preview and .blend file."),
                ("WIN-12", "Missing-tool guidance", "Explain unavailable runtimes or applications and provide actionable setup instructions."),
            ]),
        ],
        "note": "Chosen folder does not equal an OS sandbox. Full command execution needs enforceable controls; read-only proposals come first.",
    },
    {
        "title": "Your AI team and media",
        "label": "PROVIDERS & CREATIVITY",
        "accent": BLUE,
        "intro": "Use existing accounts first, then select the right model and team for the task.",
        "phase": "Phases 2 and 7",
        "sections": [
            ("Connect supported accounts", [
                ("AI-01", "ChatGPT Pro through Codex", "Complete official sign-in and show the active account, supported models and usage mode."),
                ("AI-02", "Claude Max 20x through Claude Code", "Use the official local client and subscription login; prevent accidental API-key billing."),
                ("KLING-01", "Kling account and live models", "Sign in through the official CLI; refresh supported text-to-video models and current credit balance."),
                ("AI-04", "Separate subscriptions and API keys", "Show which connection is billed; never silently fall back to a paid service."),
            ]),
            ("Coordinate the team", [
                ("AI-05", "Model and version selection", "Select only models/versions supported by the actual connection; explain unavailable choices."),
                ("AI-06", "Effort and Ultra preferences", "Save Astra 6 Ultra and supported provider effort settings; retain optional manual overrides."),
                ("AI-07", "Simultaneous provider teamwork", "Run bounded parallel work with clear roles, status and individual or automatic team selection."),
                ("AI-08", "Integrate without overwriting", "Use file ownership or isolated workspaces, review combined output and resolve conflicts."),
            ]),
            ("Create and remember", [
                ("AI-09", "Useful personal memory", "Save editable preferences and conversation history; view, forget and export remembered information."),
                ("KLING-02", "Text-to-video requests", "Choose a live model, options and prompt; review in Activity, then check status and open the returned video."),
                ("KLING-03", "Private Kling MCP", "Copy the MCP configuration into a compatible client; prepare requests, check results and revoke access."),
                ("KLING-04", "Explicit video spending approval", "Start disabled. Require approval per video; explain unknown exact cost, empty credits and uncertain submissions."),
            ]),
        ],
        "note": "Kling uses separate credits. No live video was generated during development; sign-in and an explicitly authorised generation still need your test.",
    },
    {
        "title": "Your Android companion",
        "label": "CHAT, VOICE & MASCOT",
        "accent": TEAL,
        "intro": "A comfortable companion on the Android phone and tablet, both Android 16.",
        "phase": "Phases 3 and 4",
        "sections": [
            ("Talk and manage projects", [
                ("AND-01", "Phone and tablet layouts", "Adapt to both devices, orientations and larger text without hiding essential controls."),
                ("AND-02", "Typed conversation", "Send requests, read streamed replies and open attachments or generated results."),
                ("AND-03", "Project cards on Android", "Create, open and manage PC projects; show most recently active first and reliable job status."),
                ("AND-04", "Offline and reconnect behaviour", "Show PC/device connectivity, retain drafts and avoid replaying actions when reconnecting."),
            ]),
            ("Voice that feels natural", [
                ("AND-05", "Tap to talk", "Tap the widget's Talk button and start speaking once permission is granted; no model selection is required."),
                ("AND-06", "British female voice", "Preview available English UK voices and remember the selected female-sounding voice."),
                ("AND-07", "Spoken conversation", "Speak responses, allow interruption and offer a hands-free session the user explicitly starts."),
                ("AND-08", "Wake phrase and background limits", "Evaluate optional 'Hey Nakama'; show actual support, battery impact and manual alternatives."),
            ]),
            ("Always within easy reach", [
                ("AND-09", "Home-screen widget", "Add the Nakama widget and use its Talk action to open a foreground voice conversation directly."),
                ("AND-10", "Original fluid mascot", "Animate a lightweight vector companion with idle, listening, thinking and speaking states."),
                ("AND-11", "Movable overlay", "Enable the mascot with Android's display-over-other-apps permission; drag, tap to talk and dismiss it."),
                ("AND-12", "Visible stop and recovery", "Stop speech/control from the active surface; restore widget and overlay state after restarts."),
            ]),
        ],
        "note": "Voice availability is device-dependent. Android 16 does not by itself guarantee an offline recogniser or a specific installed voice.",
    },
    {
        "title": "Phone actions you can trust",
        "label": "CALLS, MESSAGES & APPS",
        "accent": CORAL,
        "intro": "Tell Nakama what to do in normal language, with the correct recipient, app and device.",
        "phase": "Phase 5",
        "sections": [
            ("Choose the intended action", [
                ("ACT-01", "Natural-language requests", "Turn a request into a clear action, including message text, recipient, app and target device."),
                ("ACT-02", "Resolve names and ambiguity", "Use contacts/account identity; ask when 'Mike' or a date could mean more than one thing."),
                ("ACT-03", "Configurable routine confirmations", "Allow ordinary explicit requests to run according to the user's per-action settings."),
                ("ACT-04", "Grant phone permissions on device", "Guide microphone, contacts, calendar, calls, messaging, overlay and accessibility permission setup."),
            ]),
            ("Calls and messages", [
                ("ACT-05", "Normal phone calls", "Handle 'call Mike' with supported Android calling tools and the correct telephone number."),
                ("ACT-06", "SMS messaging", "Prepare/send supported SMS actions and distinguish drafted, sent and delivery status."),
                ("ACT-07", "WhatsApp messaging", "Handle 'message Nayan on WhatsApp [message]' and verify the supported completion step."),
                ("ACT-08", "WhatsApp calls", "Handle 'call Steve on WhatsApp' and report initiation separately from a connected call."),
            ]),
            ("Use other apps carefully", [
                ("ACT-09", "Discord user-directed messages", "Support the requested Discord workflow through permitted interfaces; never use self-bot user tokens."),
                ("ACT-10", "App opening and interaction", "Use app links/intents first; enable scoped accessibility tapping, typing and scrolling where supported."),
                ("ACT-11", "Observe actual completion", "Opening an editor is not sending a message. Report the last verified result and any remaining step."),
                ("ACT-12", "Respect device capabilities", "Detect tablet calling/SMS support, locked screens and protected UI; show manual steps when necessary."),
            ]),
        ],
        "note": "Private APK installation does not bypass Android security. App updates can change accessible controls; each supported workflow needs device testing.",
    },
    {
        "title": "Your connected services",
        "label": "PERSONAL & DEVELOPMENT",
        "accent": BLUE,
        "intro": "Keep each account and service understandable, with permissions matched to its purpose.",
        "phase": "Phases 5 and 6",
        "sections": [
            ("Personal Google accounts", [
                ("CON-01", "Multiple Google identities", "Connect several personal or business Google accounts and choose the correct Gmail or calendar identity."),
                ("CON-02", "Gmail reading and search", "Find and summarise relevant email using the selected account and consented scopes."),
                ("CON-03", "Email composition and sending", "Create drafts and perform explicitly requested sends with clear account and recipient selection."),
                ("CON-04", "Google Calendar management", "Create/update events with correct account, timezone, date and reminders; verify saved details."),
            ]),
            ("Build and publish with permission", [
                ("CON-05", "GitHub", "Connect repositories, inspect changes and manage development workflows with scoped credentials."),
                ("CON-06", "Vercel", "Select a project, inspect status and prepare deployment; execution always requires approval."),
                ("CON-07", "Render", "Connect services and inspect relevant status/logs; gate every deployment behind approval."),
                ("CON-08", "Resend", "Connect email features with sender/domain configuration and a preview of requested outgoing content."),
            ]),
            ("Data and browser", [
                ("CON-09", "Neon", "Connect database projects safely, show the selected environment and review high-impact changes."),
                ("CON-10", "Custom Chrome extension", "Install the unpacked extension, pair it to Control Center and display its connection state."),
                ("CON-11", "Browser observation and control", "Observe requested tabs and perform authorised navigation, clicking, typing and scrolling."),
                ("CON-12", "Browser/session boundaries", "Expose active control, stop/revoke access and handle protected pages or unsupported frames honestly."),
            ]),
        ],
        "note": "Building communication tools is not permission to send real messages during development. Tests use fixtures or deliberately authorised targets.",
    },
    {
        "title": "Security and permissions",
        "label": "TRUST & RELIABILITY",
        "accent": CORAL,
        "intro": "Your approved devices and requests control access. Models cannot grant themselves permission.",
        "phase": "Required across every phase",
        "sections": [
            ("Only your devices", [
                ("SEC-01", "Desktop-approved pairing", "Use a short-lived code plus local desktop approval; unpaired clients cannot execute tasks."),
                ("SEC-02", "Private encrypted connection", "Verify HTTPS and the pinned host identity on local Wi-Fi and mobile data."),
                ("SEC-03", "Per-device management", "Name devices, inspect last activity and permissions, and select the phone or tablet for an action."),
                ("SEC-04", "Immediate revocation", "Revoke a device credential and reject further requests, including an already reconnected client."),
            ]),
            ("Permission rules that hold", [
                ("SEC-05", "Deployments always ask", "Bind approval to the exact proposed deployment; reject missing, expired or mismatched approval."),
                ("SEC-06", "Project deletion always asks", "Show the resolved target and impact; require a separate approval that routine settings cannot disable."),
                ("SEC-07", "Constrained command execution", "Enforce filesystem/process access and isolate deployment secrets before enabling general commands."),
                ("SEC-08", "Untrusted content stays content", "Emails, webpages, app text and project files cannot authorise unrelated actions or change permissions."),
            ]),
            ("Privacy and resilient jobs", [
                ("SEC-09", "Protected credentials", "Store secrets in OS-backed protection, redact logs and keep keys/tokens out of GitHub."),
                ("SEC-10", "Explicit context sharing", "Show when relevant screenshots or app text are sent to the selected AI; provide retention controls."),
                ("SEC-11", "No duplicate actions", "Use job IDs, expiry, acknowledgements and replay protection; a reconnect cannot send a message twice."),
                ("SEC-12", "Audit, recovery and emergency stop", "Record authorised actions and outcomes; stop active jobs and recover safely after crashes."),
            ]),
        ],
        "note": "Initial agent proposals remain read-only. Full execution is accepted only once the mandatory approval rules can actually be enforced.",
    },
    {
        "title": "Ready to install and continue",
        "label": "DELIVERY & ACCEPTANCE",
        "accent": TEAL,
        "intro": "Completion means a reproducible package, clear guides and evidence from the real user flows.",
        "phase": "Phase 8",
        "sections": [
            ("Package and verify", [
                ("REL-01", "Windows installer", "Build a reproducible installer; verify fresh setup, relaunch, settings and upgrade behaviour."),
                ("REL-02", "Signed private Android APK", "Build and install on both Android 16 devices; keep signing keys secure for future updates."),
                ("REL-03", "Installable Chrome extension", "Provide the extension folder/package and exact chrome://extensions installation instructions."),
                ("REL-04", "End-to-end acceptance", "Verify provider results, mobile pairing, permissions, phone workflows and failure/reconnect cases."),
            ]),
            ("Make ownership easy", [
                ("REL-05", "Quick start and full documentation", "Provide an easy first-use guide plus detailed setup, accounts, permissions and daily-use instructions."),
                ("REL-06", "Troubleshooting and capability matrix", "Document each app/device limit, missing dependency, known issue and unverified feature plainly."),
                ("REL-07", "Costs and billing guide", "Explain included subscriptions, free services, optional paid budgets and current official sources."),
                ("REL-08", "GitHub source delivery", "Publish reviewed code, guides and a blank checklist to the selected repository without secrets or private history."),
                ("REL-09", "Rebuildable feature checklist", "Keep this PDF, matching Markdown, stable feature IDs and the script used to regenerate it."),
                ("REL-10", "Seamless continuation", "Leave verified progress, unfinished work, exact next commands and a copy/paste prompt for a new chat."),
            ]),
        ],
        "note": "Every box is initially unchecked. A checked box needs evidence from the stated acceptance behaviour, not only a source file or mock screen.",
    },
]

# Readiness is separate from the owner's saved acceptance ticks.
READINESS = {
    "WIN-01": "ready", "WIN-02": "partial", "WIN-03": "ready", "WIN-04": "ready",
    "WIN-05": "ready", "WIN-06": "partial", "WIN-07": "partial", "WIN-08": "ready",
    "WIN-09": "partial", "WIN-10": "partial", "WIN-11": "setup", "WIN-12": "partial",
    "AI-01": "ready", "AI-02": "ready", "KLING-01": "setup", "AI-04": "ready",
    "AI-05": "partial", "AI-06": "ready", "AI-07": "partial", "AI-08": "partial",
    "AI-09": "partial", "KLING-02": "setup", "KLING-03": "setup", "KLING-04": "ready",
    "AND-01": "ready", "AND-02": "partial", "AND-03": "partial", "AND-04": "ready",
    "AND-05": "ready", "AND-06": "setup", "AND-07": "ready", "AND-08": "later",
    "AND-09": "ready", "AND-10": "partial", "AND-11": "setup", "AND-12": "partial",
    "ACT-01": "partial", "ACT-02": "partial", "ACT-03": "ready", "ACT-04": "setup",
    "ACT-05": "setup", "ACT-06": "partial", "ACT-07": "partial", "ACT-08": "later",
    "ACT-09": "later", "ACT-10": "partial", "ACT-11": "ready", "ACT-12": "ready",
    "CON-01": "setup", "CON-02": "setup", "CON-03": "setup", "CON-04": "setup",
    "CON-05": "partial", "CON-06": "setup", "CON-07": "setup", "CON-08": "setup",
    "CON-09": "partial", "CON-10": "setup", "CON-11": "partial", "CON-12": "ready",
    "SEC-01": "ready", "SEC-02": "setup", "SEC-03": "ready", "SEC-04": "ready",
    "SEC-05": "ready", "SEC-06": "ready", "SEC-07": "partial", "SEC-08": "partial",
    "SEC-09": "ready", "SEC-10": "partial", "SEC-11": "ready", "SEC-12": "partial",
    "REL-01": "ready", "REL-02": "partial", "REL-03": "ready", "REL-04": "partial",
    "REL-05": "ready", "REL-06": "ready", "REL-07": "ready", "REL-08": "ready",
    "REL-09": "ready", "REL-10": "ready",
}
PAGES.insert(2, {
    "title": "One conversation, the right AI",
    "label": "AUTOMATIC ROLES & USAGE",
    "accent": BLUE,
    "intro": "Choose your team once in Settings. Talk normally; override a role only when you want to.",
    "phase": "New automatic companion workflow",
    "sections": [
        ("Save your defaults", [
            ("AUTO-01", "ChatGPT planning and design", "Default to Astra 6 Ultra for requirements, architecture, user experience, implementation steps and test criteria."),
            ("AUTO-02", "Claude development", "Default to Opus 4.8 for development, with the completed plan passed into its project build."),
            ("AUTO-03", "Configurable AI roles", "Save role/model choices and Faster everyday replies in Settings; keep detailed work at its saved effort."),
            ("AUTO-04", "One-request overrides", "Say 'plan using Claude' or use advanced controls; keep the saved role preferences unchanged."),
        ]),
        ("Use one simple conversation", [
            ("AUTO-05", "Automatic task choice and quick replies", "Use the separate fast interaction role for ordinary chat and deeper roles for detailed work. On Android, show waiting status and check promptly for replies."),
            ("AUTO-06", "Plan before development", "A selected-project build waits for planning to succeed; stopping or failing planning prevents the handoff."),
            ("AUTO-07", "ChatGPT image files", "Generate actual image files using included ChatGPT access; text prompts alone do not complete this item."),
            ("KLING-05", "Explicit video workflow", "Keep normal chat with ChatGPT or Claude; a Kling video request directs you to Video studio or the MCP approval flow."),
        ]),
        ("Understand your allowance", [
            ("USE-01", "Usage on PC and Android", "Open AI usage to see ChatGPT and Claude, checked time, remaining allowance where reported and reset times."),
            ("USE-02", "ChatGPT account limits", "Read official account quota windows; distinguish session and weekly limits, and display unavailable data honestly."),
            ("USE-03", "Claude account limits", "Display remaining account allowance when a supported integration exists; current builds show unavailable guidance."),
            ("USE-04", "No invented allowance", "Never present missing, failed or expired quota data as 100% remaining; refreshing does not send a model prompt."),
        ]),
    ],
    "note": "READY means implemented and ready for your test, not accepted. A real ChatGPT-to-Claude build and physical voice/overlay checks still need your validation.",
})
READINESS.update({ident: "ready" for page in PAGES for _, items in page["sections"] for ident, _, _ in items if ident.startswith(("AUTO-", "USE-"))})
READINESS.update({"AUTO-07": "later", "KLING-05": "ready", "USE-01": "partial", "USE-03": "later"})
PAGES.append({
    "title": "Your manager, team and companion",
    "label": "MANAGED PROJECTS & PHONE CONTROL",
    "accent": TEAL,
    "intro": "One manager keeps questions, development and review connected, while your companion remembers what you choose to share.",
    "phase": "October project workflow",
    "sections": [
        ("Plan and deliver together", [
            ("TEAM-01", "Astra and Fable joint planning", "Use Astra 6 Ultra as manager and Fable 5.1 as co-planner; save detailed methodology, tasks, file ownership and acceptance criteria."),
            ("TEAM-02", "Questions through your manager", "Answer the manager's saved questions on Windows or Android; development waits until all required answers are recorded."),
            ("TEAM-03", "Opus implementation workers", "Use exact Opus 4.8 for bounded tasks; request Ultracode, mapped to xhigh with Nakama orchestration. Native Claude workflows remain disabled."),
            ("TEAM-04", "Independent review and fixes", "Astra and Fable both review the current files. Fixes return to Opus; unresolved findings at the limit must not produce a completed delivery."),
        ]),
        ("Stay in control", [
            ("TEAM-05", "Stop, restart and changed files", "Stop the whole workflow; reject late writes, changed files, revoked permissions and unauthorised phone access. Interrupted active runs do not restart."),
            ("MEM-01", "Editable companion learning", "Remember stated preferences and personal notes without extra model calls. Inspect, edit, pause learning or forget notes; do not infer a hidden personality profile."),
            ("REMOTE-01", "Visible phone control session", "Start app-scoped control on the phone; see blue edges, an action cursor, a countdown and immediate Stop. Verify on both Android 16 devices."),
            ("REMOTE-02", "Live remote phone desktop", "Stream the phone screen with Android capture consent and support broader verified visual control. This is not implemented in this update."),
        ]),
    ],
    "note": "New acceptance boxes start unchecked. Fable needs your Max plan and usage credits disabled; live account and physical-device acceptance remain unverified.",
})
READINESS.update({"TEAM-01": "setup", "TEAM-02": "ready", "TEAM-03": "partial", "TEAM-04": "ready", "TEAM-05": "ready", "MEM-01": "ready", "REMOTE-01": "setup", "REMOTE-02": "later"})
PAGES.append({
    "title": "Your everyday Nakama foundations",
    "label": "BOARDS, CORE MEMORY & YOUR DEVICES",
    "accent": BLUE,
    "intro": "A shared clipboard for your tasks and rhythms, with visible memory and optional phone services.",
    "phase": "October personal tools",
    "sections": [
        ("Your tasks and routines", [
            ("BOARD-01", "Shared task clipboard", "See assistant jobs and project progress on Windows and Android; add personal tasks and cross completed cards out."),
            ("BOARD-02", "Daily completed-card cleanup", "Clear previous-day completions once each host day, catch up after restart, and remove cards manually without deleting source work."),
            ("ROUTINE-01", "Shared routines board", "Add, edit, pause and remove named reminders with repeat days and a saved time zone. Verify daylight-saving behaviour."),
            ("ROUTINE-02", "Phone-owned alarm scheduling", "Choose a target Android phone, grant notification/exact-alarm access and verify its scheduling receipt, sound, reboot and cancellation."),
        ]),
        ("Talk and grow together", [
            ("CORE-01", "Core Memory and personality", "Review and edit saved preferences, self-described traits and Nakama personality on PC or Android. Pause learning/reuse and forget notes."),
            ("CORE-02", "Fast manager and voice commands", "Receive a queued acknowledgement for AI work; ask for actual progress or manage boards/memory by supported local typed or voice commands."),
            ("WAKE-01", "Optional Nakama wake word", "Enable the visible local-recogniser listener, test wake/command/Stop and speech suspension. Engine and background limits remain device-dependent."),
        ]),
        ("Your phone and PC", [
            ("DESK-01", "Android controls Windows", "Enable PC and device permissions; view snapshots, touch/drag/scroll/type, switch monitors at the top and Stop on either device."),
            ("LOC-01", "Own-phone location sharing", "Grant phone location consent; verify timestamp, accuracy, offline recovery and last-known display on PC. Confirm Stop and forget."),
            ("LOC-02", "Useful location without hidden sharing", "Open a chosen map/weather lookup from a saved fix; keep unrelated AI chat and other phones free of private location data."),
        ]),
    ],
    "note": "No live microphone, GPS, alarm sound or remote input was used as a test. Continuous 24-hour availability is not guaranteed. Physical Android 16 acceptance remains open.",
})
READINESS.update({"BOARD-01": "ready", "BOARD-02": "ready", "ROUTINE-01": "ready", "ROUTINE-02": "setup", "CORE-01": "ready", "CORE-02": "partial", "WAKE-01": "partial", "DESK-01": "setup", "LOC-01": "setup", "LOC-02": "partial"})
PAGES.append({
    "title": "Your fast companion and office",
    "label": "NAKAMA & ITS LITTLE TEAM",
    "accent": TEAL,
    "intro": "Speak to Nakama while named workers handle deeper tasks. Inspect real progress at their little screens.",
    "phase": "New checks - leave unchecked until you test",
    "sections": [
        ("One fast point of contact", [
            ("FAST-01", "Separate interaction model", "Save the fast Nakama role independently from planning/research/development. Start with Astra 6 low; retain existing deeper assignments."),
            ("FAST-02", "Appropriate question depth", "Compare short chat with detailed/current-fact questions. Verify the recorded route/model and answer, not just response speed."),
            ("FAST-03", "Responsive during background work", "While a project runs, ask for status and open another page. Distinguish accepted-work receipts from the eventual completed answer."),
        ]),
        ("Meet your named workers", [
            ("OFFICE-01", "Mini Nakama desks", "Open Agent office on PC and Android. GPT agents are light green; Claude agents orange. Provider/status text remains readable."),
            ("OFFICE-02", "Stable, distinct names", "Newly spawned agents receive unique names; refresh/restart preserves each identity. No name-pool editing control is exposed."),
            ("OFFICE-03", "Truthful screen details", "Select an agent screen and inspect assignment, phase, model, effort, returned output or error. No fabricated thinking or terminal feed."),
            ("OFFICE-04", "Manager and child hierarchy", "See actual project manager/planner/developer/reviewer relationships. Waiting, cancelled, failed and finished states remain distinct."),
        ]),
        ("Move around by asking", [
            ("NAV-01", "Nakama page navigation", "Ask to open Agent office, projects, tasks, routines, memory or settings. Navigate only the requesting client and honour unsaved drafts."),
            ("NAV-02", "No replay from old messages", "Refresh, reopen history and use a second device. Old navigation results must not move either screen again."),
            ("NAV-03", "Supported Android navigation", "Use voice/text for app pages and supported Android Home/settings/app opening; verify session/permission rules for global controls."),
        ]),
    ],
    "note": "Office records show real work, not private model reasoning. No fastest-model or instant-reply guarantee. Current account and physical-device acceptance still matter.",
})
READINESS.update({"FAST-01": "ready", "FAST-02": "partial", "FAST-03": "ready", "OFFICE-01": "ready", "OFFICE-02": "ready", "OFFICE-03": "ready", "OFFICE-04": "ready", "NAV-01": "ready", "NAV-02": "ready", "NAV-03": "setup"})
PAGES.append({
    "title": "A fresh check after updating",
    "label": "RECENT-UPDATE REGRESSION PASS",
    "accent": BLUE,
    "intro": "Older ticks record earlier acceptance. Use these fresh boxes to retest your current setup on both Android devices.",
    "phase": "Start here after installing both updated packages",
    "sections": [
        ("Keep your existing setup", [
            ("RETEST-01", "Upgrade without data loss", "Quit PC from its tray; install Windows/APK updates over existing apps. Keep projects, accounts, pairing, settings and signing identity."),
            ("RETEST-02", "Boards and memory across devices", "Add/edit/complete/remove a disposable card and routine from both apps. Check memory edit, learning pause, reuse pause and forget."),
            ("RETEST-03", "One complete small project", "Use a disposable project; answer manager questions, inspect workers and both reviews, then distinguish delivered files from unexecuted tests."),
        ]),
        ("Physical Android 16 checks", [
            ("RETEST-04", "Talk, widget and mascot", "On phone and tablet, test Talk entry, chosen voice, acknowledgement/final speech, interruption and background Stop."),
            ("RETEST-05", "Wake listener on both devices", "Check local engine availability, leading Nakama phrase, own-speech pause, visible Stop, background behaviour and battery use."),
            ("RETEST-06", "Alarm actually sounds and cancels", "Schedule a harmless test alarm; verify target, time zone, receipt, audible outcome, dismissal and received cancellation before relying on it."),
            ("RETEST-07", "Location and remote desktop", "Verify location age/accuracy/Stop/forget; use a harmless PC window for touch, text, monitor switching, disconnect and remote-session Stop."),
        ]),
        ("Privacy, recovery and evidence", [
            ("RETEST-08", "Shared-data permission loss", "Temporarily disable test-phone Google/project access; office/history/boards/memory must disappear. Restore the intended grants afterwards."),
            ("RETEST-09", "Offline, Stop and restart", "Test a disposable job: Stop prevents later stages, PC restart reports interruption and reconnect does not replay commands."),
            ("RETEST-10", "Save and report acceptance", "Save/reopen this PDF. Record device, exact request, agent/task name, expected/actual result and error using docs/testing-guide.md."),
        ]),
    ],
    "note": "No purchases, paid video, real messages/calls, deployments or destructive actions are needed for this regression pass. Keep account-dependent items unaccepted until observed.",
})
READINESS.update({"RETEST-01": "setup", "RETEST-02": "ready", "RETEST-03": "setup", "RETEST-04": "setup", "RETEST-05": "partial", "RETEST-06": "setup", "RETEST-07": "setup", "RETEST-08": "ready", "RETEST-09": "ready", "RETEST-10": "ready"})
PAGES.append({
    "title": "Bring your GitHub projects home",
    "label": "CONNECTED REPOSITORIES",
    "accent": BLUE,
    "intro": "Start with a disposable repository. Keep important dirty work untouched, and review every remote destination.",
    "phase": "Existing GitHub projects on Windows and Android",
    "sections": [
        ("Connect and import", [
            ("GH-01", "Link the intended GitHub account", "Save a labelled token on Windows, verify it and select only intended repositories. Tokens must stay out of chat, Android, URLs and logs."),
            ("GH-02", "Import an existing repository", "List repositories or enter an exact GitHub HTTPS repository. Clone to a new managed folder; existing folders and app data stay intact."),
            ("GH-03", "Link an existing managed checkout", "Select its account and repository in Git changes. Confirm the displayed branch and destination before any network write."),
        ]),
        ("Review local and remote work", [
            ("GH-04", "Fetch and fast-forward pull", "Fetch remote state, then pull a clean disposable checkout. Dirty files or diverged history must block pull without stashing/resetting your work."),
            ("GH-05", "Review a real local commit", "Select changed files, author and message; inspect before/after content. Commit exactly reviewed files, preserve unrelated staged work, and do not auto-push."),
            ("GH-06", "Changed files invalidate review", "Change a selected test file after preparing a commit. The old review must fail; prepare a fresh one. Existing staged selected files remain protected."),
            ("GH-07", "Explicit PC push approval", "Review repository, branch, exact commit and automation implications. Request push from either app; only fresh PC approval may perform it."),
            ("GH-08", "Remote changes and failures", "A changed destination, remote/local commit, removed account or revoked phone access must invalidate approval. Uncertain network results must not auto-retry."),
            ("GH-09", "No hidden execution or data leak", "Import/pull/commit do not run hooks, project scripts or dependencies. Disabled phones lose GitHub access; concurrent project writes are blocked."),
        ]),
    ],
    "note": "A push can trigger repository automation or deployment. Review/decline approval without pushing if you do not want that effect. Live account acceptance is separate from fixtures.",
})
READINESS.update({f"GH-{n:02}": "setup" for n in range(1, 10)})
PAGES.append({
    "title": "A wiser, smoother companion",
    "label": "REUSABLE SKILLS & ANDROID MOTION",
    "accent": TEAL,
    "intro": "Skills preserve useful methods as editable context. Motion should make the app pleasant without slowing down your next action.",
    "phase": "Learning and interaction acceptance",
    "sections": [
        ("Teach, inspect and reuse", [
            ("SKILL-01", "Teach a reusable method", "Save a name, purpose, when-to-use context and steps. Reopen the same skill on Windows and Android."),
            ("SKILL-02", "Teach by direct command", "Use Teach skill: NAME | When: CONTEXT | Steps: FIRST; SECOND. Verify a saved receipt without extra inference."),
            ("SKILL-03", "Relevant cross-agent reuse", "Inspect skill-selection records for matching manager/worker tasks. Unrelated, disabled and candidate methods stay out."),
            ("SKILL-04", "Reviewed-project candidates", "Inspect a successful project's method candidate and source. It stays unavailable for reuse until you accept it."),
            ("SKILL-05", "Edit, pause and forget", "Correct, disable and forget a test skill. Queued work rechecks permissions and settings before reuse."),
            ("SKILL-06", "Separate learning and reuse", "Pause each independently. Conversation memory off pauses both; saved methods remain editable."),
            ("SKILL-07", "Privacy and authority", "Disabled phones lose skills/receipts. Methods cannot grant permissions or override deployment/video approvals."),
            ("SKILL-08", "Honest adaptation", "Selection counts do not prove a method was followed or tested. No retraining, hidden trait inference or secret storage."),
        ]),
        ("Android feel on both devices", [
            ("MOTION-01", "Fluid page and status changes", "Visit Chat, Projects, Tools and Agent office. Check scrolling, forms, readable transitions and immediate taps."),
            ("MOTION-02", "Reduce motion", "Enable Nakama Reduce motion and Android animation controls. Decorative motion should stop while navigation, status and all actions still work."),
            ("MOTION-03", "Responsiveness with voice", "While work runs, type, change pages and use Talk/Stop. Keep drafts/replies intact; note jank and battery impact."),
        ]),
    ],
    "note": "No maximum-smoothness or measured frame-rate claim. Physical-device checks and live skill usefulness remain your acceptance work; new boxes begin unchecked.",
})
READINESS.update({f"SKILL-{n:02}": "ready" for n in range(1, 9)})
READINESS.update({"SKILL-03": "setup", "SKILL-04": "setup", "MOTION-01": "setup", "MOTION-02": "ready", "MOTION-03": "setup"})
PAGES.extend([
    {
        "title": "Project reports and easy navigation", "label": "PROJECT HANDOVER", "accent": TEAL,
        "intro": "Find your project files and take away a clear, honest PDF report.", "phase": "Delivery update",
        "sections": [
            ("A report worth keeping", [
                ("PDF-01", "Automatic project report", "Finish a small managed project. Confirm a PDF appears without an extra model call and failed rendering does not fabricate success."),
                ("PDF-02", "Honest outcomes", "Check summary, files, review results, executed-check receipts and unfinished acceptance. A submitted deployment is not called a healthy website."),
                ("PDF-03", "Useful safe images", "Include a selected project image or an untainted local-preview capture. Confirm private login frames are excluded."),
                ("PDF-04", "Open, save and print", "Open the report on Windows and Android, save a copy and inspect every page. Long descriptions must wrap without clipping."),
                ("PDF-05", "Control report generation", "Disable automatic reports for one project, generate a manual snapshot and delete only a report without deleting project files."),
            ]),
            ("Find the right file", [
                ("FILES-01", "Folder navigation", "Use breadcrumbs, parent folders and filtering on both apps. Changing projects must clear old selections and previews."),
                ("FILES-02", "Text editing", "Read and edit a small text file. Protect unsaved changes when moving away or receiving external updates."),
                ("FILES-03", "Images and PDFs", "Preview bounded PNG/JPEG/PDF files and use Android's save destination. Corrupt or oversized files should fail clearly."),
                ("FILES-04", "Path and privacy boundaries", "Confirm traversal, links and credential-preview paths are rejected. Revoke shared access and check stale content clears."),
                ("FILES-05", "Upgrade preservation", "Install over the previous app. Keep projects, accounts, pairing, Android signing and every saved personal PDF checkbox value."),
            ]),
        ],
        "note": "A local or generated report is evidence of saved receipts, not certification of real-world deployment, payment or physical-device acceptance.",
    },
    {
        "title": "Nakama's internal browser", "label": "VISIBLE CHROMIUM", "accent": BLUE,
        "intro": "Watch browsing, test an approved local website and take over privately when needed.", "phase": "Delivery update",
        "sections": [
            ("Browse and test", [
                ("BROWSER-01", "Desktop browser sessions", "Open research and private sessions, use tabs/navigation and close them. Research is anonymous read-only with page JavaScript disabled."),
                ("BROWSER-02", "Local preview approval", "Review an installed Vite/Next preview script, start it on its assigned loopback port, open the page and stop the preview."),
                ("BROWSER-03", "Agent tools and receipts", "Run a small explicit research/local-test task. Confirm real browser steps and bounded output appear under the same agent; ordinary fast chat adds no browsing calls."),
                ("BROWSER-04", "Mini office screens", "Find the associated agent desk, see its live browser thumbnail and open it. Human/private sessions must stay hidden from agents."),
                ("BROWSER-05", "Network limits", "Confirm project tabs cannot escape their approved origin; research cannot access local/private networks, submit forms, use accounts or download files."),
            ]),
            ("Step in from Android", [
                ("BROWSER-06", "Touch and typing", "Grant browser control to the selected Android device. Tap, scroll and type with a fresh frame; reject stale frames and a different controller."),
                ("BROWSER-07", "Private takeover", "Take over a project session, release it and confirm it remains permanently opaque to agents and report capture."),
                ("BROWSER-08", "Targeted phone handoff", "Send a session to one allowed Android. Confirm the intended device can act during its lease and another device cannot see private content."),
                ("BROWSER-09", "Questions and attention", "Enable notifications. Confirm generic lock-screen text, stable deduplication, an attention highlight and a fresh destination after tapping."),
                ("BROWSER-10", "Stop, revoke and reconnect", "Stop control or revoke pairing/shared permissions during work. Check pending callbacks, frames and actions do not revive the old session."),
            ]),
        ],
        "note": "Sessions are visible bounded snapshots, not a frame-rate promise. Private sign-in cookies are not service API credentials. No live account action is an automatic development test.",
    },
    {
        "title": "Website setup, service access and publication", "label": "FROM PLAN TO DELIVERY", "accent": CORAL,
        "intro": "Make the intended outcome, accounts and authority explicit before external work.", "phase": "Delivery update",
        "sections": [
            ("Ask and authorize", [
                ("SETUP-01", "Upfront project questions", "Describe a hosted website. Confirm repository choice, hosting, domain/email records, budget, shop/admin needs and acceptance questions appear before planning."),
                ("SETUP-02", "Answers from either app", "Answer setup/manager/delivery questions on either app, dictating on Android. Check partial answers and stale/duplicate submissions; unanswered questions block progress."),
                ("SETUP-03", "Targeted account setup", "Issue an expiring connection request to one phone. Save credentials only through its protected field; no secrets enter chat, reports, notifications or agent input."),
                ("GRANT-01", "Explicit bounded project grant", "Review exact account/action/resource settings, expiry and operation count. Defaults still require PC approval; free-text permission alone grants nothing."),
                ("GRANT-02", "Grant limits and revocation", "Revoke/expire/exhaust a grant. Changed accounts, projects, commits, secret references or DNS targets outside its exact scope must be rejected."),
            ]),
            ("Inspect actual delivery", [
                ("DELIVER-01", "Review provider plans", "Prepare plans using saved accounts. Inspect GitHub/Vercel/Render/Neon/Namecheap fields without executing. Service creation may include an initial deploy."),
                ("DELIVER-02", "Intent and uncertain receipts", "Inspect synthetic tests for one-attempt writes, no automatic retry after uncertainty, preserved provider IDs and secret references. Deletion/purchases have no adapter."),
                ("DELIVER-03", "Post-review manager", "Start delivery after both reviews. Verify approval pauses, receipt-based continuation, stop/restart behaviour and questions sent to Android."),
                ("DELIVER-04", "Real website acceptance", "Only with your deliberate service authorization, verify deployment URL, custom DNS/TLS, frontend/backend/database, admin recovery and test checkout. Mark live acceptance only from actual results."),
                ("PUBLIC-01", "Publication privacy", "Check the public blank checklist/license/notices, scan current files and full Git history, and resolve historical personal data before changing visibility."),
            ]),
        ],
        "note": "The perfume domain in the design request was fictional. Never buy or operate it. Real provider setup, costs, DNS propagation, OAuth and full shop acceptance remain user-controlled live tests.",
    },
])
READINESS.update({ident: "ready" for page in PAGES[-3:] for _, items in page["sections"] for ident, _, _ in items})
READINESS.update({ident: "setup" for ident in ["PDF-01", "PDF-03", "FILES-05", "BROWSER-02", "BROWSER-03", "BROWSER-06", "BROWSER-08", "BROWSER-09", "BROWSER-10", "SETUP-03", "GRANT-01", "DELIVER-01", "DELIVER-03", "DELIVER-04", "PUBLIC-01"]})

PAGES.append({
    "title": "Managed build, check and repair", "label": "EXECUTED PROJECT CHECKS", "accent": TEAL,
    "intro": "Use actual command results before the team reviews and delivers your project.", "phase": "Managed execution update",
    "sections": [
        ("Approve and observe", [
            ("EXEC-01", "Exact check approval", "Build a small project with supported root npm scripts. Inspect each script and its pre/post hooks on the PC before it runs; service grants cannot authorize commands."),
            ("EXEC-02", "Wait for real completion", "Observe the checking stage and actual task output. Both reviewers must wait for the command to exit, including after Stop."),
            ("EXEC-03", "Bounded repair and rerun", "Use a harmless failing test. Confirm the implementation worker receives actual diagnostics and each repaired rerun requires a fresh approval."),
            ("EXEC-04", "Both reviewers and final report", "After passing checks, confirm both independent reviewers see the recorded results. The summary and PDF distinguish executed checks from remaining live acceptance."),
        ]),
        ("Preserve control and honest limits", [
            ("EXEC-05", "Changed source invalidates approval", "Edit included source while approval is pending. The old request must fail; changed files are preserved and cannot silently become reviewed."),
            ("EXEC-06", "Reject, expire, stop and restart", "Reject or expire a request, stop during a check, or restart the host. No later command, repair or delivery may resume from stale authority."),
            ("EXEC-07", "Android status and privacy", "See waiting/check results on the requesting Android. Approval remains on the PC; revoked shared access stops further workflow actions."),
            ("EXEC-08", "Unsupported and unavailable checks", "Confirm a project without supported scripts explicitly says checks were not executed. Missing runtimes/dependencies or generated source changes must never count as passing tests."),
        ]),
    ],
    "note": "Local fixture checks do not establish live model eligibility or a working hosted site. Dependencies, migrations, payments and final-domain acceptance remain separate work.",
})
READINESS.update({ident: "setup" for _, items in PAGES[-1]["sections"] for ident, _, _ in items})

PAGES.append({
    "title": "General autonomous tasks", "label": "OBSERVE, ACT AND VERIFY", "accent": TEAL,
    "intro": "Give Nakama a bounded outcome and inspect the evidence it gathers through its available tools.", "phase": "General task engine update",
    "sections": [
        ("Run and inspect", [
            ("TASK-01", "Saved task and actual progress", "Start a small research or selected-project task. Confirm one task-board card, actual manager activity, saved decisions and tool receipts."),
            ("TASK-02", "Questions before dependent work", "Give an incomplete goal. Answer the manager's saved questions and confirm stale answer revisions do not overwrite newer answers."),
            ("TASK-03", "Exact project-check approval", "Request a harmless existing npm check. Confirm no command starts before its exact PC approval and progress waits for the saved exit result."),
            ("TASK-04", "Separate verification", "Inspect a fresh verification observation. Reads, accepted clicks and passing scripts must not certify arbitrary goal completion; the result remains reviewable."),
        ]),
        ("Preserve boundaries", [
            ("TASK-05", "Stop, restart and explicit resume", "Stop before approval or restart during work. Pending commands must not run; explicit Resume uses saved receipts without automatically replaying attempted operations."),
            ("TASK-06", "Private content stays private", "Confirm login/private browser content, pixels, credentials and protected project files are unavailable to the task manager and reports."),
            ("TASK-07", "Android upgrade and privacy", "Install the signed APK in place, retain pairing and app data, inspect task questions/results, then verify disabled shared access hides task data."),
            ("TASK-08", "General autonomy limits", "Confirm readiness distinguishes this bounded engine from future Windows app control, authenticated online forms and hands-off website delivery. Live acceptance remains separate."),
        ]),
    ],
    "note": "Use synthetic local examples for development tests. Physical devices retain their data. No live or paid model calls, sends, calls, deployments, purchases or DNS writes are acceptance shortcuts.",
})
READINESS.update({ident: "partial" for _, items in PAGES[-1]["sections"] for ident, _, _ in items})

PAGES.append({
    "title": "Local website preparation", "label": "PREPARE AND OBSERVE", "accent": TEAL,
    "intro": "The first autonomy benchmark is a locally built and verified website. Keep setup, tests and acceptance distinct.", "phase": "Local website preparation update",
    "sections": [
        ("Exact dependency preparation", [
            ("LOCAL-01", "Review locked setup", "With model allowance available, inspect the exact package/lockfile approval. npm ci replaces node_modules; lifecycle scripts stay disabled and unsupported configuration is preserved."),
            ("LOCAL-02", "Recorded setup outcome", "Confirm later checks wait for process close, a saved exit result and unchanged hashes. Missing node_modules after exit zero must stop progress; installation is not a passed website test."),
            ("LOCAL-03", "Interrupted and changed setup", "Change a reviewed lockfile or cancel before launch. No stale install may start. Failed or uncertain setup must stop for attention without an automatic reinstall."),
        ]),
        ("Preview and acceptance", [
            ("LOCAL-04", "Approved task preview", "Request a supported local preview from a task. Review its exact PC approval, then inspect a separate fresh browser observation; a launched process alone must not mean ready."),
            ("LOCAL-05", "Stop only the owned preview", "Stop the task's exact preview and wait for its process to close before another check. A different task's or manually launched preview must remain outside its authority."),
            ("LOCAL-06", "Actual website benchmark", "After Claude allowance returns, build a small local site through both planners and reviewers, then verify its agreed page behavior. Keep missing lockfiles, generated outputs and unrun functional acceptance marked unfinished."),
        ]),
    ],
    "note": "Live project-agent acceptance is on hold until Claude usage is available. Local simulated fixtures do not establish model quality, site functionality or hands-off hosting.",
})
READINESS.update({ident: "partial" for _, items in PAGES[-1]["sections"] for ident, _, _ in items})

PAGES.append({
    "title": "Low-cost monitoring", "label": "WATCH AND RETURN", "accent": TEAL,
    "intro": "Local checks watch an exact website or application without an AI call on each poll.", "phase": "Monitoring update",
    "sections": [
        ("Reliable local checks", [
            ("MON-01", "Save and resume", "Create a paused monitor, check its condition and interval, then explicitly start. Pause, expiry and restart must prevent unnoticed work."),
            ("MON-02", "Stock and language", "Check an exact product's structured availability or text in its own language. Missing, mixed or changed evidence stays unknown."),
            ("MON-03", "No hidden cost", "Confirm ordinary checks use no model calls and failures back off. The PC must be awake; no paid fallback or retry storm is allowed."),
        ]),
        ("Private shopping handoff", [
            ("MON-04", "Dedicated saved login", "Sign in privately using only Nakama's isolated profile. Restart retains that profile; Forget removes its cookies. No installed profile is imported."),
            ("MON-05", "Check delivery yourself", "Privately verify account and delivery details, then attest setup. An out-of-stock product may prevent a checkout rehearsal."),
            ("MON-06", "Exact cart recipe", "On a supported native-form shop, approve product, variant, quantity one, currency and price cap. Changed or unsupported forms stop; payment and order placement stay human."),
            ("MON-07", "Challenge and queue", "A CAPTCHA or queue pauses automation in the same session. No bypass, automatic challenge refresh or uncertain cart replay is allowed."),
            ("MON-08", "Notifications and voice", "Open a current permitted alert on Windows/Android or ask to open the CAPTCHA/checkout. Stale or ambiguous requests must not open another private session."),
        ]),
        ("Application observation", [
            ("MON-09", "Windows application", "Watch the exact process/window-title condition. Confirm this is read-only and does not claim to understand arbitrary app contents."),
            ("MON-10", "Android consent", "Explicitly allow the exact foreground app with visible Stop. Locked, sensitive, expired, revoked or offline observation must not share screen text."),
        ]),
    ],
    "note": "Real shop checkout, Pokemon Center compatibility and physical notification/background behavior require separate acceptance. Fixture checks never purchase or enter payment details.",
})
READINESS.update({ident: "partial" for _, items in PAGES[-1]["sections"] for ident, _, _ in items})
PAGES.append({
    "title": "Dynamic upgrade", "label": "PREPARE, REVIEW AND RECOVER", "accent": BLUE,
    "intro": "Nakama prepares improvements separately and waits for your exact update approval.", "phase": "Self-maintenance update",
    "sections": [
        ("Private source and model controls", [
            ("UPG-01", "Saved requests on hold", "Save an improvement without inference. Only explicitly release a development run after allowance returns; no date-triggered or paid fallback is allowed."),
            ("UPG-02", "Isolated source", "Prepare a separate source candidate excluding credentials, runtime state, cookies, personal checklist values and signing keys. Preserve the running installation."),
            ("UPG-03", "Existing team and questions", "Use saved configurable roles, manager-routed questions, approved checks and both independent reviews. Do not waive either review."),
            ("UPG-04", "Actual readiness", "Changing the candidate after tests/review must block packaging. Missing, failed or stale receipts must not become a passing update."),
        ]),
        ("Signed artifacts and recovery", [
            ("UPG-05", "Trusted signed package", "Verify exact artifact hash, signed release manifest and publisher. Reject unsigned, tampered, incompatible and untrusted updates."),
            ("UPG-06", "Fresh PC approval", "Review the exact update and previous recovery artifact. Finish active work and close browsers before protected backup and installer handoff."),
            ("UPG-07", "Preserve identity and data", "Retain accounts, projects, pairing, preferences, browser profiles and Android signing identity. Verify the local recovery backup without publishing it."),
            ("UPG-08", "Honest installation outcome", "Treat installer launch as unverified installation. Check the new installed version and health separately; inspect interrupted outcomes without automatic retry."),
        ]),
    ],
    "note": "Current Windows packages are unsigned. Production signing, full live development, installed update health and deliberate recovery need acceptance. No installed profile is a disposable fixture.",
})
READINESS.update({ident: "partial" for _, items in PAGES[-1]["sections"] for ident, _, _ in items})

STATUS_LABELS = {"ready": "READY", "setup": "SETUP", "partial": "PARTIAL", "later": "LATER"}
STATUS_COLORS = {"ready": "#008D94", "setup": "#4E68DC", "partial": "#A65A31", "later": "#64748B"}
TOTAL_CHECKS = sum(len(items) for page in PAGES for _, items in page["sections"])
TOTAL_PAGES = len(PAGES) + 1


def setup_fonts():
    windows = Path("C:/Windows/Fonts")
    candidates = [
        (windows / "segoeui.ttf", windows / "segoeuib.ttf"),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
         Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("Nakama", str(regular)))
            pdfmetrics.registerFont(TTFont("Nakama-Bold", str(bold)))
            pdfmetrics.registerFontFamily("Nakama", normal="Nakama", bold="Nakama-Bold", italic="Nakama", boldItalic="Nakama-Bold")
            return
    raise RuntimeError("Install Segoe UI or DejaVu Sans before building the checklist.")


def text(c, content, x, y, width, size=9.5, color=INK, leading=None, bold=False):
    style = ParagraphStyle(
        "body", fontName="Nakama-Bold" if bold else "Nakama",
        fontSize=size, leading=leading or size * 1.4,
        textColor=color, alignment=TA_LEFT,
        spaceAfter=0, spaceBefore=0,
    )
    p = Paragraph(content, style)
    _, height = p.wrap(width, HEIGHT)
    p.drawOn(c, x, y - height)
    return height


def footer(c, n, accent):
    c.setStrokeColor(LINE)
    c.line(38, 47, WIDTH - 38, 47)
    text(c, "NAKAMA  /  PLANNING &amp; ACCEPTANCE", 38, 36, 290, 7.2, MUTED)
    text(c, f"{DATE}  |  {n:02d} / {TOTAL_PAGES:02d}", WIDTH - 187, 36, 160, 7.2, MUTED)
    c.setFillColor(accent)
    c.rect(0, 0, 7, HEIGHT, fill=1, stroke=0)


def mascot(c, x, y, scale=1):
    """Original vector screen companion: no external artwork required."""
    c.saveState()
    c.translate(x, y)
    c.scale(scale, scale)
    c.setFillColor(colors.HexColor("#C6EEEE"))
    c.ellipse(-9, -13, 119, 3, fill=1, stroke=0)
    c.setStrokeColor(NAVY)
    c.setLineWidth(5)
    c.line(55, 91, 60, 111)
    c.setFillColor(colors.HexColor("#F4A77E"))
    c.circle(61, 113, 8, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#6CDAD5"))
    c.roundRect(0, 7, 110, 89, 28, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.roundRect(14, 24, 82, 56, 19, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#C8FFED"))
    c.roundRect(33, 48, 8, 15, 4, fill=1, stroke=0)
    c.roundRect(68, 48, 8, 15, 4, fill=1, stroke=0)
    c.setStrokeColor(colors.HexColor("#C8FFED"))
    c.setLineWidth(2.8)
    c.arc(45, 35, 65, 46, 190, 155)
    c.setFillColor(colors.HexColor("#35B9B7"))
    c.roundRect(18, -1, 23, 15, 7, fill=1, stroke=0)
    c.roundRect(72, -1, 23, 15, 7, fill=1, stroke=0)
    c.restoreState()


def cover(c):
    c.setFillColor(PAPER)
    c.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.roundRect(28, HEIGHT - 287, WIDTH - 56, 255, 20, fill=1, stroke=0)
    text(c, "YOUR PERSONAL AI DEVELOPMENT COMPANION", 50, HEIGHT - 57, 350, 8.0, colors.HexColor("#85D6D6"), bold=True)
    text(c, "Nakama", 49, HEIGHT - 89, 360, 45, colors.white, leading=51, bold=True)
    text(c, "Feature checklist", 51, HEIGHT - 151, 350, 23, colors.white, bold=True)
    text(c, "Windows Control Center + Android 16 + Chrome", 52, HEIGHT - 194, 355, 10.1, colors.HexColor("#C9D7E5"))
    text(c, "Private. Connected. Built around your accounts.", 52, HEIGHT - 221, 338, 9.0, colors.HexColor("#C9D7E5"))
    mascot(c, WIDTH - 164, HEIGHT - 255, 0.87)

    y = HEIGHT - 311
    text(c, "A plan you can check, not a claim of completion", 38, y, WIDTH - 76, 14.8, NAVY, bold=True)
    y -= 29
    text(c, "Click a checkbox after testing an item; click again to clear it. Save the PDF to keep your progress. Use a PDF viewer that supports forms, such as Adobe Acrobat Reader. Record evidence in the matching Markdown checklist.", 38, y, WIDTH - 76, 9.6, INK)
    y -= 58

    labels = [("YOUR PC", "Windows host awake"), ("YOUR DEVICES", "Phone + tablet, Android 16"), ("YOUR RULE", "Scoped grants; never service delete")]
    cardw = (WIDTH - 92) / 3
    for i, (label, value) in enumerate(labels):
        x = 38 + i * (cardw + 8)
        c.setFillColor(colors.white)
        c.roundRect(x, y - 53, cardw, 53, 8, fill=1, stroke=0)
        text(c, label, x + 10, y - 9, cardw - 20, 7.0, TEAL, bold=True)
        text(c, value, x + 10, y - 25, cardw - 20, 8.3, NAVY, bold=True)
    y -= 76

    text(c, "A comfortable order for testing", 38, y, WIDTH - 76, 13.6, NAVY, bold=True)
    y -= 29
    data = [
        ["START WITH", "THEN TRY", "RECORD WHAT HAPPENS"],
        ["Install and reconnect", "Local tools", "Pairing, boards, memory and navigation"],
        ["Your named agent office", "One small project", "Questions, workers, reviews and Stop"],
        ["Each Android device", "Optional services", "Voice, alarms, location and remote PC"],
    ]
    cells = [[Paragraph(escape(s), ParagraphStyle("cell", fontName="Nakama-Bold" if row == 0 else "Nakama", fontSize=8.0 if row == 0 else 8.5, leading=11.5, textColor=colors.white if row == 0 else INK)) for s in values] for row, values in enumerate(data)]
    table = Table(cells, colWidths=[150, 104, WIDTH - 330], rowHeights=[24, 35, 35, 35])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, LINE),
    ]))
    table.wrapOn(c, WIDTH - 76, HEIGHT)
    table.drawOn(c, 38, y - 129)
    y -= 143
    text(c, "Detailed steps and a report template: docs/testing-guide.md. Older ticks are your earlier acceptance notes; the fresh update-regression boxes start unchecked. No purchases, messages, calls or deployments are needed for that pass.", 38, y, WIDTH - 76, 8.1, MUTED)
    y -= 48
    c.setFillColor(PALE)
    c.roundRect(38, y - 44, WIDTH - 76, 44, 8, fill=1, stroke=0)
    text(c, f"{TOTAL_CHECKS} clickable checks  |  Your saved ticks are preserved", 50, y - 10, WIDTH - 100, 10.0, TEAL, bold=True)
    text(c, "READY: test now  /  SETUP: connect or grant permission  /  PARTIAL: limited  /  LATER: unfinished", 50, y - 27, WIDTH - 100, 7.0, MUTED)
    footer(c, 1, TEAL)
    c.showPage()


def checklist_page(c, n, page, checked_ids):
    accent = page["accent"]
    text(c, "NAKAMA  /  " + page["label"], 38, HEIGHT - 35, 445, 8.0, accent, bold=True)
    text(c, f"{n:02d}", WIDTH - 87, HEIGHT - 29, 50, 30, colors.HexColor("#D5E3EB"), bold=True)
    text(c, page["title"], 38, HEIGHT - 68, WIDTH - 76, 24.0, NAVY, bold=True)
    text(c, page["intro"], 39, HEIGHT - 108, WIDTH - 78, 9.7, MUTED)
    text(c, page["phase"].upper(), 39, HEIGHT - 143, WIDTH - 78, 7.6, accent, bold=True)
    y = HEIGHT - 167
    for section, items in page["sections"]:
        c.setFillColor(PALE if accent == TEAL else colors.HexColor("#F0F2F8"))
        c.roundRect(38, y - 24, WIDTH - 76, 24, 5, fill=1, stroke=0)
        text(c, section, 48, y - 5, WIDTH - 100, 10.0, accent, bold=True)
        y -= 32
        for ident, title, description in items:
            c.acroForm.checkbox(
                name=ident,
                tooltip=f"{ident} - {title}. {description}",
                x=41, y=y - 14, size=12,
                buttonStyle="check", shape="square",
                borderWidth=0.9, borderStyle="solid",
                borderColor=colors.HexColor("#8BA1B4"),
                fillColor=colors.white, textColor=accent,
                checked=ident in checked_ids,
                annotationFlags="print", fieldFlags="",
                forceBorder=True,
            )
            status = READINESS[ident]
            heading = f'<font size="7" color="{STATUS_COLORS[status]}">{STATUS_LABELS[status]}</font>  {escape(title)}'
            h1 = text(c, heading, 63, y, WIDTH - 163, 10.0, NAVY, bold=True, leading=12)
            text(c, ident, WIDTH - 90, y - 1, 54, 7.1, MUTED)
            h2 = text(c, escape(description), 63, y - h1 - 2, WIDTH - 103, 8.7, INK, leading=11.7)
            row_h = h1 + h2 + 12
            y -= row_h
        y -= 5
    note_h = text(c, "REVIEW NOTE  " + escape(page["note"]), 49, y - 8, WIDTH - 98, 8.0, MUTED, leading=11)
    if y - note_h - 13 < 57:
        raise ValueError(f"Page {n} content overflows: bottom={y-note_h-13:.1f}")
    # Evidence line stays at a consistent location, separate from feature text.
    if n == TOTAL_PAGES:
        source_y = min(y - note_h - 25, 136)
        text(c, "REFERENCE LINKS", 39, source_y, WIDTH - 78, 7.1, accent, bold=True)
        links = [
            ("Codex", "https://learn.chatgpt.com/docs/auth"),
            ("Claude Code", "https://code.claude.com/docs/en/headless"),
            ("Kling CLI", "https://www.npmjs.com/package/@klingai/cli-global"),
            ("MCP", "https://modelcontextprotocol.io/"),
            ("Android actions", "https://developer.android.com/guide/components/intents-common"),
            ("Tailscale", "https://tailscale.com/pricing"),
        ]
        link_text = " &nbsp; / &nbsp; ".join(f'<a href="{url}" color="#008D94">{label}</a>' for label, url in links)
        text(c, link_text, 39, source_y - 16, WIDTH - 78, 7.8, MUTED)
    footer(c, n, accent)
    c.showPage()


def write_markdown():
    lines = [
        "# Nakama feature checklist",
        "",
        f"Planning and acceptance baseline: **{DATE}**.",
        "",
        f"**{TOTAL_CHECKS} acceptance checks.** READY = implemented and ready to test; SETUP = needs your account/device permissions; PARTIAL = only a subset is implemented; LATER = not available in the selected plan/current build. Saved PDF ticks are retained independently of readiness. New boxes start unchecked. This Markdown baseline does not sync your PDF ticks.",
        "",
        "Blank public template: [Nakama Test Checklist](assets/Nakama-Test-Checklist.pdf). The filled personal copy stays locally at `output/pdf/Nakama-Feature-Checklist.pdf` and is excluded from Git. Click a checkbox to mark an item, click again to clear it, then save the PDF to keep your progress. If your preview cannot edit forms, open the file in a form-capable PDF viewer such as Adobe Acrobat Reader. Save a personal copy for your test results. PDF ticks and Markdown records are stored separately; they do not automatically synchronise. Sequencing: [implementation plan](implementation-plan.md). Account setup: [provider options](provider-options.md).",
        "",
        "Start with [the testing guide](testing-guide.md): installation and pairing, local tools, office/navigation, one small project, then optional Android services. Use the fresh RETEST boxes for this update even where an older feature already has your acceptance tick.",
        "",
        "No purchases, paid video, real messages/calls, deployments or destructive actions are needed for the update-regression pass. Live model work still requires your eligible accounts and documented billing setup.",
        "",
    ]
    for page in PAGES:
        lines.extend([f"## {page['title']}", "", f"{page['phase']}. {page['intro']}", ""])
        for section, items in page["sections"]:
            lines.extend([f"### {section}", ""])
            for ident, title, description in items:
                lines.append(f"- [ ] **{ident} - {title} [{STATUS_LABELS[READINESS[ident]]}]:** {description}")
            lines.append("")
        lines.extend([f"Review note: {page['note']}", ""])
    lines.extend([
        "## Verification record", "",
        "Use one row per accepted feature. Do not mark a device-dependent feature complete from an emulator alone.", "",
        "| Feature ID | Build / commit | Device / account | Evidence and result | Verified date |",
        "| --- | --- | --- | --- | --- |",
        "| | | | | |", "",
        "## Rebuild", "",
        "Install Python packages `reportlab` and `pypdf`, then run `python scripts/build_checklist.py`. The builder writes Markdown and the PDF from the same feature data. It preserves saved PDF ticks by stable feature ID; new fields start unchecked. Back up annotated personal copies: rebuilding preserves checkbox values, not other annotations. Markdown evidence does not synchronise with PDF ticks. Run `python scripts/verify_checklist.py --roundtrip` to validate fields and saved states using temporary test copies.", "",
    ])
    MARKDOWN.parent.mkdir(parents=True, exist_ok=True)
    MARKDOWN.write_text("\n".join(lines), encoding="utf-8")


def saved_checks(output, expected_ids):
    """Read only known checkbox values; never erase saved ticks on a bad input."""
    if not output.exists():
        return set()
    fields = PdfReader(str(output)).get_fields() or {}
    # Retired by the owner's 30 September provider change. Never transfer their
    # saved answers to new Kling features. The original PDF is backed up first.
    retired_ids = {"AI-03", "AI-10", "AI-11", "AI-12", "AUTO-08"}
    unknown = set(fields) - expected_ids - retired_ids
    if unknown:
        raise ValueError(f"PDF has unrecognised form fields; preserve it before rebuilding: {sorted(unknown)}")
    checked = set()
    for ident, field in fields.items():
        if field.get("/FT") != "/Btn":
            raise ValueError(f"Expected a checkbox for {ident}; refusing to discard its value")
        value = field.get("/V", "/Off")
        if value not in ("/Off", "/Yes"):
            raise ValueError(f"Unexpected checkbox state for {ident}; preserve this PDF before rebuilding")
        if value == "/Yes" and ident in expected_ids:
            checked.add(ident)
    return checked


def build_pdf(output, checked_ids):
    """Build to a temporary sibling and replace only after basic validation."""
    setup_fonts()
    items = [item for page in PAGES for _, section in page["sections"] for item in section]
    assert len(items) == TOTAL_CHECKS, len(items)
    assert len({item[0] for item in items}) == TOTAL_CHECKS
    assert set(READINESS) == {item[0] for item in items}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=".nakama-checklist-", suffix=".pdf", dir=output.parent, delete=False) as pending_file:
        pending = Path(pending_file.name)
    try:
        c = canvas.Canvas(str(pending), pagesize=A4, pageCompression=1)
        c.setTitle("Nakama - Feature Checklist")
        c.setAuthor("Nakama")
        c.setSubject(f"Fillable planning and acceptance checklist, {DATE}")
        cover(c)
        for n, page in enumerate(PAGES, start=2):
            checklist_page(c, n, page, checked_ids)
        c.save()
        # Load bytes so the temporary file handle is closed before replacing on Windows.
        from io import BytesIO
        reader = PdfReader(BytesIO(pending.read_bytes()))
        assert len(reader.pages) == TOTAL_PAGES
        all_text = "\n".join(page.extract_text() or "" for page in reader.pages)
        fields = reader.get_fields() or {}
        assert set(fields) == {item[0] for item in items}
        for ident, _, _ in items:
            assert all_text.count(ident) == 1, f"Missing or duplicate {ident}"
            assert fields[ident].get("/FT") == "/Btn"
            assert fields[ident].get("/V") == ("/Yes" if ident in checked_ids else "/Off")
        assert "\u25a0" not in all_text
        pending.replace(output)
    finally:
        if pending.exists():
            pending.unlink()


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-only", action="store_true", help="Rebuild only the blank public PDF and Markdown; never read or modify the personal PDF")
    args = parser.parse_args()
    expected_ids = {ident for page in PAGES for _, items in page["sections"] for ident, _, _ in items}
    if not args.public_only:
        checked_ids = saved_checks(OUTPUT, expected_ids)
        build_pdf(OUTPUT, checked_ids)
    build_pdf(PUBLIC_OUTPUT, set())
    write_markdown()
    print(f"Created blank public checklist: {TOTAL_PAGES} pages, {len(expected_ids)} interactive acceptance checks. Personal PDF {'untouched' if args.public_only else 'saved values preserved'}.")
    print(f"Created {MARKDOWN}")


if __name__ == "__main__":
    main()
