export interface NetworkStatus {
  configured: { allowLan: boolean; port: number };
  listener: {
    active: boolean;
    allowLan: boolean;
    address: string;
    port: number;
  };
  restartNeeded: boolean;
  addresses: {
    name: string;
    address: string;
    kind: "lan" | "vpn";
    url: string;
    listening: boolean;
  }[];
}

export function pairingAddress(value: string, platform: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Enter the PC’s HTTPS address, for example https://192.168.1.10:43110.",
    );
  }
  if (platform === "chrome") {
    if (url.href !== "http://127.0.0.1:43111/")
      throw new Error("Chrome must use http://127.0.0.1:43111 on this PC.");
    return url.origin;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Enter only the PC’s HTTPS address and port, without a path or sign-in details.",
    );
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "::" ||
    host === "::ffff:0:0" ||
    host === "0.0.0.0" ||
    host.startsWith("127.") ||
    /^::ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(host)
  )
    throw new Error(
      "Localhost points to your phone, not this PC. Choose a private network address below or enter the PC’s VPN address.",
    );
  return url.origin;
}

export function pairingNetworkBlock(status?: NetworkStatus): string | null {
  if (!status)
    return "Check the PC’s network status before creating an Android pairing ticket.";
  if (!status.listener.active)
    return "The HTTPS listener is stopped. Restart Control Center, then check the network again.";
  if (status.restartNeeded)
    return "Network settings have changed. Fully close and reopen Control Center, then check the network again.";
  if (!status.listener.allowLan)
    return "This PC is listening locally only. In Settings, enable ‘Allow paired devices over a private network’, then fully close and reopen Control Center.";
  return null;
}
