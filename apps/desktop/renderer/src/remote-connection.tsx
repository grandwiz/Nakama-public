import { useEffect, useState } from "react";
import { api, openExternal } from "./bridge";
import { Button } from "./components";
import { useNakama } from "./context";
import type { NetworkStatus } from "./pairing-model";
export function RemoteConnectionSetup() {
  const { perform } = useNakama();
  const [network, setNetwork] = useState<NetworkStatus>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<NetworkStatus>("GET", "/api/network-status").then(value => { if (active) { setNetwork(value); setError(""); } }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [revision]);
  const vpn = network?.addresses.filter(row => row.kind === "vpn" && /tailscale/i.test(row.name)) || [];
  const enable = async () => { if (await perform("PATCH", "/api/settings", { vpnOnly: true }, "VPN-only access selected. Fully close and reopen Control Center.")) setRevision(value => value + 1); };
  return <section className="panel" style={{ padding: 24, marginBottom: 24 }}>
    <h2>Use Nakama away from home</h2>
    <p>Connect this PC and your Android devices to the same private Tailscale network. Keep this PC awake and Control Center running.</p>
    <ol><li>Install Tailscale on Windows and Android, then sign into the same account.</li><li>Before changing access, open each already-paired Android app while its current connection still works. A successful refresh securely remembers the PC’s VPN address.</li><li>Select VPN-only access and reopen Control Center. If a device was not refreshed, create a new pairing ticket using the displayed VPN address. The listener uses only that VPN interface.</li><li>Turn off phone Wi-Fi and confirm Nakama connects over mobile data before leaving.</li></ol>
    <div className="button-row">
      <Button kind="secondary" onClick={() => void openExternal("https://tailscale.com/download")}>Get Tailscale</Button>
      <Button disabled={!vpn.length || network?.configured.vpnOnly} onClick={enable}>Use VPN-only access</Button>
      <Button kind="secondary" onClick={() => setRevision(value => value + 1)}>Check VPN connection</Button>
    </div>
    <p role="status">{network?.restartNeeded ? "Fully close and reopen Control Center to apply network settings." : vpn.length ? vpn.some(row => row.listening) ? "Private VPN address detected. Confirm a connection from your phone." : "VPN detected. Select VPN-only access and restart Control Center." : "No private VPN address detected yet. Open Tailscale, connect, and check again."}</p>
    {vpn.map(row => <p key={row.url}><code>{row.url}</code></p>)}
    {error && <p role="alert">{error}</p>}
    <p className="muted">No router port forwarding is required. If the VPN is unavailable at startup, Nakama listens locally only. A detected address alone does not prove phone reachability.</p>
  </section>;
}
