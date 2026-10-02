# Install the private Chrome companion

This extension is supplied directly with Nakama. It is not published in the Chrome Web Store.

## Install and pair

1. Start the installed Nakama Control Center on Windows, or build and run it from source.
2. In Chrome, enter `chrome://extensions` in the address bar.
3. Turn on **Developer mode** in the top-right corner.
4. Choose **Load unpacked** and select the repository's `apps/chrome-extension` folder.
5. Pin **Nakama Browser Companion** from Chrome's extensions menu.
6. In Control Center, open **Devices**, select **Chrome**, and create a pairing ticket. It is single-use and expires after two minutes.
7. Open the extension and paste the pairing JSON. Its URL must be `http://127.0.0.1:43111`.
8. Select **Enable all ordinary tabs** in the extension, then accept Chrome's requested website permission. This starts one two-hour browser-control session; you do not need to enable each site or tab. Chrome remembers its broad website grant for future sessions until you remove it.

The extension only accepts commands from Control Center on the same PC. Its HTTP listener is bound to loopback; Android uses the separate pinned HTTPS connection. The browser has its own revocable credential. Provider passwords and API keys are not copied into Chrome.

## Browser control

The enabled session includes ordinary HTTP/HTTPS tabs across this Chrome profile, including newly opened tabs, reloads and navigation to another website. It lasts two hours, until Chrome/extension restart, or until you press **Stop browser control**. Start another session with the same **Enable all ordinary tabs** button. Chrome normally reuses the saved website grant without another permission prompt; that grant alone never starts or restores a Nakama control session.

Incognito windows, browser/extension settings, local files, the Nakama bridge, Chrome Web Store pages and recognised sign-in, credential or payment addresses are excluded. Pages still loading must finish before an action can run. Nakama's separate private browser sessions remain isolated; this Chrome session does not expose them. Models and website text cannot enable a session, extend its expiry or grant deployment, deletion or payment authority.

The current extension can list eligible tabs, read page text and controls, navigate between ordinary websites, click a specific control, enter text, choose a native dropdown option, and scroll. Password, payment-card, one-time-code and recognised API-key fields are excluded. Hidden, disabled and read-only controls cannot be edited. Website text is untrusted content and does not grant new instructions.

Clicks labelled **Deploy**, **Publish**, **Delete**, **Remove**, or similar require you to finish the action directly in Chrome. The same check covers a nested icon/text element, confirmation dialogs, related forms and potentially destructive navigation addresses. Adding `approved: true` to a browser command cannot bypass this. A **Needs user** result means nothing was clicked automatically.

These checks use the page's labels and context. They cannot prove what an arbitrary website's scripts will do. Enable the session only when the ordinary tabs in this profile are appropriate to share, and complete deployments or project deletion yourself after reviewing the page. Entering text dispatches normal input events; some sites react immediately or save automatically. Nakama reports text entry without claiming that the website did nothing else.

Commands are checked about every 30 seconds while Chrome is running; **Check for requested actions** performs an immediate check. Browser page changes and DOM controls must be verified after an action. A click is not evidence that a message was sent, a payment succeeded, or a deployment completed.

Before executing a command, the extension saves a receipt locally. If the network loses its acknowledgement, Nakama sends the saved result again instead of clicking twice. If the browser closes during an action, its receipt becomes **Interrupted**: check the page before requesting another action. Expired commands never execute. If receipt storage fills up, actions stop before execution.

Receipts, including captured images, are removed on the next check after their command expiry plus a one-minute acknowledgement grace period. This cleanup also runs when the queue is empty or the browser is unpaired, while Chrome is running. Receipts for commands that can still run or are within that grace period stay available for safe retries. A confirmed revocation clears the browser's local receipts; disconnecting during an in-flight action cannot restore its cleared result.

## Choose a dropdown option

Use this for an ordinary website dropdown such as a colour, language or list filter:

1. In **Devices → Request a device action**, choose the paired browser and **Read a permitted page**. Enter the tab's ID from the active browser-session tab list.
2. Open its result under **Recent device results**. Find the dropdown in `controls`. Its `options` show each exact `value`, its readable `label`, and whether it is selected or disabled.
3. Choose **Choose a dropdown option**. Copy that control's `selector`, enter the same tab ID and copy the desired option's **value**. The label and value can differ: a label might be “Blue” while its value is `blue`.
4. Send the action. If ordinary-action confirmation is enabled, approve it in **Activity & approvals** first.
5. Read the resulting page again. A selected option does not prove a form was saved or a website task finished.

An empty option value is valid: leave **Exact option value** empty when the page read explicitly shows `"value": ""`. Spaces are significant and are preserved. If the requested option is already selected, Nakama leaves it alone without firing another input/change event.

This operation supports native HTML dropdowns that select one option. Custom menus, multiple-selection lists, ambiguous values, unavailable options and protected or destructive forms require manual interaction. Disabled groups and disabled surrounding fieldsets are respected. Changing a dropdown can trigger website scripts or automatic saving; Nakama does not submit the form itself and cannot prevent every effect of a site's event handlers.

Option lists are bounded. A read includes at most 50 options per dropdown within a shared result budget. Values longer than 200 characters are omitted, not shortened into a different value. `optionsTruncated: true` means the list is incomplete; inspect the page manually if the option you need is missing. Reload the extension after updating Nakama to enable this operation.

## Capture the visible tab

In Control Center, choose the paired browser in **Devices → Request a device action**, then choose the screenshot action and the tab's ID. Keep that tab active in a focused, normal Chrome window. **Enable all ordinary tabs** and accept Chrome's website grant once for the session; no separate toolbar click is needed on each tab.

The result appears as an image under recent device results. It captures only the visible viewport, resized to at most 1280 × 960, with a bounded JPEG size. It does not capture an entire scrolling page or switch tabs/windows for you. The host retains only the ten newest screenshot payloads; older result records remain, without their image. Screenshot data stays in local action history and is not automatically sent to an AI.

Navigation, a window/tab switch, changed permission or a detected page mutation during capture discards the image. Known sign-in/payment/credential pages and detected uninspectable content—such as embedded frames, open shadow roots, canvas, video or custom elements—are blocked conservatively. Closed shadow roots on ordinary elements may remain undetected. Screenshots are **not guaranteed secret redaction**; text visibly written on an ordinary page can still be captured. Restricted Chrome pages and extension settings cannot be captured through this workflow.

## Stop and remove access

- **Stop browser control** immediately ends the active session for subsequent commands across all tabs. A command already executing may still finish; Stop cannot undo an existing website effect.
- To remove the saved broad browser grant too, open `chrome://extensions`, choose **Nakama Browser Companion → Details → Site access**, and restrict access. Removing website access also ends the active Nakama session. Granting it again does not automatically restart control.
- **Disconnect this browser** removes the local credential and receipts.
- **Revoke** the browser in Control Center to invalidate that credential at the host.
- Remove the extension in `chrome://extensions` if it is no longer needed.

Turning off an Android device's browser-control permission also stops its queued browser requests and prevents its pending approvals from restoring that access. Already dispatched requests stop being redelivered, but an action already executing in Chrome may still finish and report its result. Revocation cannot undo an effect already performed.

## Updating and troubleshooting

After updating the source, press the extension's **Reload** button on `chrome://extensions`. Open the popup again. Reload ends the active session. Choose **Enable all ordinary tabs** once after the update; old individual-tab grants do not silently become broad access.

If pairing fails, keep Control Center open, generate a fresh Chrome ticket, and check the port is 43111. Do not substitute the Android HTTPS URL. If a website changes its interface, read it again before attempting a new click. If the desktop says the device was revoked, pair again deliberately.

## What has been checked

Synthetic extension checks cover the all-tab session, newly opened/reloaded/navigated tabs, permission denial/removal, Stop from a second popup during a permission prompt or storage write, session expiry, browser restart and pairing changes. Existing command receipts, redelivery, protected controls, destructive navigation and screenshot focus/document race checks remain in place. No installed browser profile, real account or external website action is used.

The optional real Chromium check loads the MV3 extension into a disposable local profile. It uses a temporary copy with the production feature's optional `<all_urls>` permission granted upfront, because headless Chrome cannot approve a real toolbar permission prompt. It checks local fixture tabs, page controls and actual JPEG dimensions/pixels. The shipped manifest requests broad access only from the user's **Enable all ordinary tabs** click and excludes incognito. Real installation/pairing/permission prompts and websites still need your manual check.

Run the always-available checks with `node --test tests/chrome-extension.test.mjs tests/chrome-extension-popup.test.mjs`. The real-browser check also runs when Playwright and its Chromium browser are installed. A bundled Playwright installation can be selected with `NAKAMA_PLAYWRIGHT_MODULE_PATH`; `PLAYWRIGHT_BROWSERS_PATH` selects its browser cache. Without Playwright, that one check reports **skipped**, not passed.

Source references: [optional permission grants and revocation](https://developer.chrome.com/docs/extensions/reference/api/permissions), [session storage lifetime](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session), [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [visible-tab capture](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab), [native HTML dropdowns](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select) and [option values](https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement/value).
