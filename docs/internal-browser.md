# Nakama's internal browser

Nakama includes its own Chromium browser in the Windows host. Open **Nakama browser** on Windows or **Browser** on a paired Android. The phone views and controls the host's session; it does not download your Windows browser profile. The existing Chrome extension remains a separate integration.

## Choose the right session

| Session | What Nakama can do | What the user sees |
| --- | --- | --- |
| Web research | Read anonymous public HTTPS pages and follow links. Page JavaScript, cookies, authentication, form submission and non-GET/HEAD requests are disabled. | A visible tab and snapshots of the page. Dynamic or account-only sources may not work. |
| Local project test | Read the DOM, click fresh element targets, type and navigate inside the exact origin of an approved project preview. | Real local page frames and task-linked activity. External origins are blocked, including page subrequests. |
| Private sign-in / browsing | Agents cannot read or operate the session. | Human-controlled tabs for login or other private browsing. |

Research uses a session-only proxy that resolves and validates public addresses, then connects to the checked address. Loopback, private/link-local destinations, credentials in URLs, arbitrary schemes, downloads and uncontrolled popups are blocked. Research may therefore refuse a site that redirects to an unsupported destination. It should explain that result rather than invent a page or bypass the boundary.

Ordinary research/project/private sessions use isolated temporary profiles. Private sessions do not import the user's normal Chrome cookies. Closing Nakama ends those sessions. **Monitoring** explicitly creates a separate persistent private profile per website monitor, with a Forget control; its cookies survive restart but remain opaque to agents. Automatic monitoring blocks JavaScript and writes except the separately approved single native cart operation. See [Monitoring](monitoring.md).

## Test a local website

1. Open **Nakama browser**, choose **Local project test**, and select the project.
2. Under **Local project preview**, refresh the available scripts. Managed previews accept a plain root `vite` or `next dev` script, with dependencies already installed.
3. Review the exact launch request in **Activity & approvals**. This starts project code with the Windows user's permissions; it is not an operating-system sandbox.
4. After approval, refresh preview status and open the browser. Nakama assigns a loopback port and confines the project session to that origin.
5. Stop the preview before changing files or starting incompatible project operations.

The autonomous task manager can request the same exact PC-approved preview and inspect it with the existing browser adapter. Its `project_preview_stop` operation can stop only that task's own recorded launch and waits for process close. It cannot take over another task's or manually started preview. [Locked dependency preparation](project-dependencies.md) is a separate approval. A launch receipt remains separate from page readiness and functional acceptance.

The launch receipt establishes that the approved process started. It is not cryptographic proof of which process owns the port and does not establish application health. A connection error or failed build remains visible. Real browser tests still need suitable test data and explicit acceptance criteria.

## Watch the agent office

An agent using the browser keeps the same real task identity. Its associated live browser appears on its mini screen in **Agent office**. Select the screen for the task receipt, then open the browser to inspect or take control. Attention states highlight the session and generate a generic Android notification when alerts are enabled.

Browser tools are bounded to 12 steps per model task, shared with service tools when the delivery manager uses both. Current adapters pass textual page evidence and fresh element IDs to the model. Screenshot pixels are shown to the user and can supply a safe report image; they are not passed as vision input to the text-only CLI adapters. Browser content is untrusted evidence, not instructions or permission.

Ordinary fast conversation does not start a browsing loop. Research and appropriate project work can use it. A tool error becomes an honest receipt; the model must not claim that a page, click or test succeeded without that receipt.

## Take control privately

Select **Take control** before clicking or typing. The page must have a fresh frame; stale frames, mismatched tabs and a different active controller are rejected. Text goes only to the currently focused field. The text-entry box is obscured and cleared after submission.

Taking over permanently makes that session opaque to agents, including after **Release control**. A fresh agent session is required for further automated work. Sensitive/login content also pauses automation. Private and tainted sessions are excluded from agent-office thumbnails and report capture.

For an Android handoff, enable that device's **Browser control** in Windows Devices, then choose it under **Continue privately on Android**. The explicit handoff permits only that selected, paired device. Control has a short inactivity lease. Revoking pairing, browser permission or shared-data access ends availability. A different phone cannot claim the private session.

Private login is a human action. It does not authorize agent access to authenticated dashboards, and browser cookies do not automatically become GitHub/Vercel/Render/Neon API credentials. Use the separate [account handoff](project-delivery.md#account-access-from-android) to add a supported protected service connection.

## Android alerts and voice

Enable the app's project-attention notifications. Lock-screen notifications say only that Nakama needs attention; they carry record IDs, not question text, URLs, tokens or login contents. Opening an alert refreshes the host state before choosing the destination. Expired or removed requests do not replay.

Alerts refresh while the app is foreground and through the already-visible Mote service when enabled. They are not a new invisible push server or a guarantee of delivery while the host/phone is offline. Voice can open supported areas, ask for status and fill a question's answer draft. Review and send the draft. Credential fields deliberately do not use voice entry.

## Current limits

This is a bounded snapshot-based browser view, not a guaranteed video frame rate. Real sign-in, provider-specific CAPTCHA/passkeys, Android touchscreen latency, wake/background behaviour and private account handoffs still require intentional acceptance on the user's own devices. No live provider login, purchase, deployment, message or paid model/video call was a development test.

Implementation: `apps/desktop/browser-studio.cjs`, `browser-network.cjs`, `apps/host/browser-studio.mjs` and `browser-agent.mjs`. Native synthetic fixtures exercise actual Chromium DOM/input, isolation, blocked origins, screenshots and sensitive-page takeover separately from renderer fixtures.
