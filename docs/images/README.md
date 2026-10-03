# Application screenshots

These images show the actual Windows Electron interface using invented conversations, projects, agent records, and a synthetic VPN address. They contain no account data, pairing tickets, physical-device state, or real model results.

Regenerate them from the public repository after `npm run build`:

```powershell
$env:NAKAMA_CAPTURE_DOCS = '1'
node scripts/verify-chat-ui.cjs
Remove-Item Env:NAKAMA_CAPTURE_DOCS
```

The script uses a disposable data directory, checks the rendered chat interactions, intercepts the demonstrated APIs, and rejects all mutations except its synthetic chat and network-preference operations. The VPN and import screenshots perform no network setup or folder import.

Android images are captured from the actual Compose components on a disposable API 36 emulator, using invented chat replies, libraries and device state. They demonstrate the interface and are not evidence of a physical alarm or live provider run. See `AndroidGuideScreenshotsTest` and the Android verification record for capture/check details.
