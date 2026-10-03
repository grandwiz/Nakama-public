import os from "node:os";
import { isIP } from "node:net";

export function privateIpv4Kind(address) {
  if (isIP(address) !== 4) return null;
  const [a, b] = address.split(".").map(Number);
  if (a === 100 && b >= 64 && b <= 127) return "vpn";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
    return "lan";
  return null;
}

export function privateVpnAddress(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces).filter(([name]) => /tailscale/i.test(name)).flatMap(([,entries]) => entries || []).find(entry => !entry.internal && privateIpv4Kind(entry.address) === "vpn")?.address || null;
}
export function hostBindAddress(config, interfaces = os.networkInterfaces()) {
  if (config.vpnOnly === true) return privateVpnAddress(interfaces) || "127.0.0.1";
  return config.allowLan ? "0.0.0.0" : "127.0.0.1";
}
// Read-only desktop diagnostics. These are interface candidates, never a claim
// that Windows Firewall or the phone's network can reach this PC.
export function networkStatus({
  config,
  listener,
  interfaces = os.networkInterfaces(),
}) {
  const active = Boolean(listener && typeof listener === "object");
  const bindAddress = active ? listener.address : "";
  const loopback =
    /^(?:127\.|::ffff:127\.)/.test(bindAddress) || bindAddress === "::1";
  const allowLan = active && !loopback;
  const port = active ? listener.port : config.port;
  const wildcard = bindAddress === "0.0.0.0" || bindAddress === "::";
  const seen = new Set();
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      const kind = privateIpv4Kind(entry.address);
      if (entry.internal || !kind || seen.has(entry.address)) continue;
      seen.add(entry.address);
      addresses.push({
        name,
        address: entry.address,
        kind,
        url: `https://${entry.address}:${port}`,
        listening: allowLan && (wildcard || bindAddress === entry.address),
      });
    }
  }
  addresses.sort(
    (a, b) =>
      Number(b.listening) - Number(a.listening) ||
      Number(/virtual|vethernet|docker|wsl|vmware/i.test(a.name)) -
        Number(/virtual|vethernet|docker|wsl|vmware/i.test(b.name)) ||
      a.name.localeCompare(b.name) ||
      a.address.localeCompare(b.address),
  );
  return {
    configured: { allowLan: config.allowLan === true, vpnOnly: config.vpnOnly === true, port: config.port },
    listener: { active, allowLan, address: bindAddress, port },
    restartNeeded:
      active &&
      ((config.vpnOnly === true ? bindAddress !== hostBindAddress(config, interfaces) : allowLan !== (config.allowLan === true) || config.allowLan === true && privateIpv4Kind(bindAddress) === "vpn") ||
        (config.port !== 0 && port !== config.port)),
    addresses,
  };
}
