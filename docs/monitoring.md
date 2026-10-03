# Monitoring mode

Open **Monitoring** in Windows or **Tools → Monitoring** on Android. Ordinary checks use local code and make no AI/model calls. Keep Windows awake and Control Center running. The default interval is 60 seconds, configurable from 30 seconds to one day. Monitors created in the editor start paused and normally expire after 30 days. A complete direct request to monitor an exact website starts its read-only schedule after validation. Restart requires explicit resume; missed checks do not create a catch-up burst.

## Watch a website

Enter the exact public HTTPS product/page URL. There is no country restriction or hardcoded shop language. Choose structured product availability or literal text in the page's own language. Structured checks require an unambiguous matching product and offer; recommendations, mixed variants, preorder and missing availability are not treated as in-stock. Literal conditions can include text that must be absent. Dynamic websites that do not expose evidence without JavaScript can remain unknown.

The polling browser blocks page JavaScript and non-read requests. It uses Nakama's public-address network protections, not arbitrary local-network access. Page content cannot issue instructions, change permissions or choose tools. No whole-page text, login details or screenshot is sent to a model. Unknown/changed pages, sign-in, CAPTCHA and queues need attention. Unavailable sources back off, then pause after repeated failures. A successful poll is an observation, not a reservation or purchase.

You can also say `monitor https://shop.example/product for restock` or `monitor https://shop.example/page for Ready to collect`. These complete direct commands save the monitor and start its read-only schedule after checking the current request and permissions. An active schedule is not proof that the page is available or the condition matched; review its current outcome. Incomplete requests ask for the exact URL and condition. General research and complex requests still use existing configured roles and their account availability; monitoring itself does not automatically start a research agent.

## Prepare private shopping

Choose **Set up login & delivery** on Windows or **Open private setup** on an authorised Android device. Sign in yourself inside Nakama's private browser, check the correct account and saved address, and return to Monitoring on Windows to confirm that you checked them. An out-of-stock product may prevent a real checkout rehearsal; setup confirmation records your attestation and does not claim an automated address/checkout test passed. Setup confirmation, forgetting the profile, monitor removal, Windows monitor creation and cart recipe approval are Windows controls.

Each website monitor has its own persistent Chromium profile. Cookies/site storage remain on the Windows machine in that dedicated profile. Nakama does not save your password, address or card in the monitor, chat, report or model context, and never imports an installed Chrome/Edge profile. Closing a tab or restarting retains this explicitly created profile. **Forget saved browser login** clears it. Existing ordinary browser modes retain their previous temporary-profile behavior.

Select permitted paired Android devices when creating the website monitor on Windows, or use **Save device access** in its existing shopping setup section. Changing sharing pauses the monitor and immediately revokes removed recipients' access; resume after reviewing the selection. Only selected devices can receive that monitor's private handoff. Browser control and shared Google/project permissions must remain enabled. Opening the current monitor grants a fresh short control lease; it does not expose other private sessions. Taking control never gives an agent permission to read the page. Private input is entered only by the user.

## Automatic cart preparation

Automatic preparation is optional and requires an exact recipe approved on Windows after private setup. The implemented adapter supports a **native HTML `/cart/add` form, a verifiable `/cart.js` cart and a same-origin `/checkout` link**. It requires exact product text, variant field/value, quantity one, unambiguous machine-readable price/currency and a maximum price. The supported cart API uses two-decimal minor units; other currency representations require manual checkout.

The current cart must be empty. Nakama saves the attempt before dispatch, permits one exact cart POST with page JavaScript disabled, then checks that the returned cart has exactly the approved variant, quantity, currency and price. It follows only the approved checkout link and hands control to you. Payment, order confirmation, saved-card purchase, one-click purchase, ambiguity and unexpected navigation stop automation. An interrupted or uncertain cart attempt is never automatically repeated.

This is a working bounded adapter, **not universal shop checkout automation**. JavaScript-only carts, different APIs/forms, missing required price evidence and unaccepted merchant flows use a private manual handoff. Automated research/recipe discovery, broad authenticated form automation and live Pokémon Center checkout are still unfinished. Do not enter or store payment details as part of setup. You complete any actual payment and order yourself, even if the merchant already has a saved card.

## CAPTCHA, queues and alerts

Windows notifications and Android attention alerts contain generic text and record IDs only. Opening an alert refreshes current host state. Removed, expired or inaccessible requests do not replay an action. Say **“Nakama, open up that CAPTCHA for me to fill in”** or **“open the checkout page”** to open one matching current request. If several match, Nakama asks you to choose in Monitoring.

Keep the existing queue/CAPTCHA session. Nakama pauses automatic checks rather than bypassing a challenge or creating replacement queue tabs. Complete the human step, release browser control and explicitly resume only when appropriate. [Pokémon Center's queue guidance](https://support.pokemoncenter.com/hc/en-us/articles/37286495522452-Pok%C3%A9mon-Center-Virtual-Queue) says to keep the same window and avoid refresh/navigation; entering the queue does not guarantee stock. No live Pokémon Center page, cart or purchase was used as a development test, and compatibility is unverified.

Phone notifications are polled while the app is foreground or the visible Mote service is enabled. Host sleep, network loss, Android background restrictions and notification settings can delay or prevent delivery. A 60-second stock interval plus phone polling is not an instant-purchase guarantee.

## Watch applications

- **Windows:** select an exact executable name and window-title text condition. This read-only adapter observes the requested process/title locally and returns a condition outcome. It does not inspect arbitrary in-app content, type, click or elevate privileges.
- **Android:** select one paired phone and choose an installed app by name. Desktop choices require a fresh app list from that phone; Android reads its local launcher list. The saved rule still binds the exact package. Resume the host monitor, then explicitly enable observation on that phone for at most 30 minutes. Consent requires the visible Mote service and an actual monitoring notification; accessibility observes only while the selected app is foreground and the phone awake and unlocked. Sensitive screens stop observation. The phone evaluates the text locally and sends only an outcome, package/monitor identity and timestamp; no screen text/image is sent. Stop, expiry, notification dismissal, screen-off, a successful match, pairing changes and revoked permissions end consent. This does not grant phone input or universal background monitoring.

Use the [acceptance checklist](feature-checklist.md) for real-device/shop acceptance. Synthetic tests establish the documented boundaries; they do not establish stock accuracy for every retailer, CAPTCHA compatibility, background reliability or purchase success.
