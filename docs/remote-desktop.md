# Android → Windows remote desktop

Nakama's **Remote desktop** screen lets a paired Android phone or tablet view and touch the unlocked Windows host. It uses the existing certificate-pinned Nakama HTTPS connection. It needs the Windows Control Center open and reachable; it is not a new public remote-access service.

## Enable and use

1. On the PC, open **Devices** and enable **Allow remote desktop sessions**.
2. Give the chosen Android device its separate **Remote desktop** permission. Project and Google/shared access must also remain enabled, because an unrestricted desktop picture could contain that shared information.
3. Open Remote desktop on the phone and explicitly start a session. Choose a monitor from the selector at the top when several monitors are attached.
4. Touch the picture to click; drag to move a pointer while holding the mouse button. Use the screen's scroll, text and key controls as available. Nakama checks the displayed frame and refuses stale touches; wait for the next frame before retrying.
5. Stop on the phone, close the phone's Remote screen, click the visible Windows **Stop** control, or use **Stop remote desktop** in Nakama's tray menu.

Both the overall setting and each device's permission start off. Updating does not grant existing phones control. Permission changes and device revocation take effect on active sessions.

## Session and input boundaries

- A session lasts at most two minutes and does not restart itself. It ends after 15 seconds without a successful frame or input request. The Android screen polls only while visible; normal backgrounding also sends Stop.
- A separate Windows window shows the phone name, countdown and Stop throughout the session. Locking/suspending Windows or changing/disconnecting a display ends the session.
- Images are bounded JPEG snapshots, requested at approximately two frames per second, rather than a high-frame-rate video stream. Their size is bounded to 1.2 MB of JPEG data and 1600 pixels per dimension; the current capture request uses a 1280-pixel box. Network and desktop capture latency affect responsiveness.
- A touch must name the latest frame from that session and monitor, no older than three seconds. Each frame permits one gesture. A lost response cannot replay the same click. Display geometry is checked again before input, including negative-origin and scaled monitors.
- Native Windows input supports tap, double tap, right click, bounded drag, vertical scroll, ordinary navigation keys and up to 500 literal text characters. There is no shell-command endpoint, arbitrary shortcut endpoint, clipboard transfer, file transfer, desktop audio or unattended auto-reconnection.
- Text uses Unicode keyboard input; it never runs as PowerShell source. Newlines/control characters and modifier shortcuts are rejected. Physically held modifier keys block remote input until released.
- Protected/UAC and locked desktops are unavailable. Windows' privilege isolation also blocks input into elevated applications. These screens need local PC interaction; the helper does not request elevation or install an accessibility/input driver.
- Native input refuses Nakama's own process windows, including its approval UI. Host approval resolution is additionally blocked during a session and for two seconds after Stop. Stop remote desktop and approve intentionally on the PC for deployments, project deletion, commands and Kling videos. Remote permission does not change those approval rules.

This is powerful manual control of the signed-in Windows session. Only enable it for a trusted paired device. The Android UI emits input from the user's gestures; possession of the paired device credential remains the API trust boundary, not cryptographic proof of a human touch. Other Windows applications can perform consequential operations when the user controls them. The guards are not an operating-system sandbox against a compromised trusted phone or local administrator.

## Privacy and storage

Screen images are returned directly to the requesting paired phone and are not saved in conversation history, task output, screenshots or local recordings. They are not sent to Astra, Claude or another AI. The remote gesture endpoints are separate from assistant action planning. Voice can open/close the Remote screen and choose a monitor; remote input is emitted by that screen's explicit controls.

With an active session and a current picture, explicit phone commands also include **“type on PC Hello”**, **“press Enter on PC”**, **“press Escape on PC”**, **“press Tab on PC”**, **“press Backspace on PC”**, **“scroll PC up”** and **“scroll PC down”**. They use the same fresh-frame and protected-window checks. A spoken command does not connect or grant PC permission by itself; connect through its separate control first.

Google-disabled or project-disabled phones cannot see monitor/session details or capture/control the desktop. Enabling remote desktop does not silently enable either shared-access permission. Sessions exist only in memory, and PC/app restart does not restore them.

## Implementation and verification

The host controller is `apps/host/remote-desktop.mjs`. Electron matches capture sources by their exact display ID, then converts monitor-relative touches with `screen.dipToScreenPoint`. The fixed bundled PowerShell helper compiles its C# interop once per active session and accepts bounded JSON messages on stdin. It checks the Windows input desktop, destination window and deadline before queuing a complete input batch. The helper is unpacked alongside the installed application because it must be an ordinary filesystem script.

`node --test tests/remote-desktop.test.mjs` passes **14 tests** covering settings/privacy, session isolation, single-use and stale frames, monitor/layout changes, capture size/rate/concurrency, revocation during capture, cancellation during startup, idle/absolute expiration, the approval guard, gesture validation, coordinate conversion and the fixed helper protocol. A real host with a disposable profile also verifies owner-only permission changes, approval blocking and Google-disabled state/route privacy using a synthetic desktop. The native helper compiles and exits with empty stdin: **no real mouse/keyboard event and no real screen capture occurs in these tests**. The adapter fixture uses synthetic images and a simulated child process.

Real Windows capture/input, physical-device touch, mixed-DPI monitor switching, lock/UAC handling, latency and network disconnect behaviour still require intentional device acceptance. Passing mocked protocol checks does not claim that acceptance.

API references: [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer), [capture source display IDs](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source), [Electron screen coordinate conversion](https://www.electronjs.org/docs/latest/api/screen), [Microsoft SendInput and privilege isolation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput), and [Microsoft OpenInputDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-openinputdesktop).
