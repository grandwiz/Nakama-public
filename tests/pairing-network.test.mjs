import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  networkStatus,
  hostBindAddress,
  privateIpv4Kind,
} from "../apps/host/network-status.mjs";
import { NakamaHost } from "../apps/host/host.mjs";
import {
  pairingAddress,
  pairingNetworkBlock,
} from "../apps/desktop/renderer/src/pairing-model.ts";

const interfaces = {
  "VirtualBox Host-Only": [{ address: "192.168.56.1", internal: false }],
  "Wi-Fi": [
    { address: "192.168.0.131", internal: false },
    { address: "fe80::1", internal: false },
  ],
  Tailscale: [{ address: "100.100.5.7", internal: false }],
  Public: [{ address: "8.8.8.8", internal: false }],
  Loopback: [{ address: "127.0.0.1", internal: true }],
  Duplicate: [{ address: "192.168.0.131", internal: false }],
};
const config = { allowLan: true, port: 43110 };
const active = () =>
  networkStatus({
    config,
    listener: { address: "0.0.0.0", port: 43110 },
    interfaces,
  });

test("private candidates exclude public, internal, link-local and duplicate addresses, with virtual adapters last", () => {
  const status = active();
  assert.equal(status.addresses.length, 3);
  assert.equal(status.addresses.at(-1).name, "VirtualBox Host-Only");
  assert.deepEqual(
    status.addresses.map((item) => item.listening),
    [true, true, true],
  );
  for (const address of [
    "127.0.0.1",
    "169.254.1.2",
    "172.15.1.2",
    "172.32.1.2",
    "100.63.1.2",
    "100.128.1.2",
    "192.169.0.1",
    "1.2.3.4.5",
    "::1",
  ])
    assert.equal(privateIpv4Kind(address), null);
  for (const address of ["10.0.0.1", "172.16.0.1", "172.31.0.1", "192.168.0.1"])
    assert.equal(privateIpv4Kind(address), "lan");
  assert.equal(privateIpv4Kind("100.64.0.1"), "vpn");
});

test("actual listener wins over saved network settings; changed port/settings require restart", () => {
  assert.equal(pairingNetworkBlock(active()), null);
  const local = networkStatus({
    config,
    listener: { address: "127.0.0.1", port: 43110 },
    interfaces,
  });
  assert.equal(local.listener.allowLan, false);
  assert.equal(local.restartNeeded, true);
  assert.match(pairingNetworkBlock(local), /Fully close/);
  assert.ok(local.addresses.every((item) => !item.listening));
  const pendingDisable = networkStatus({
    config: { ...config, allowLan: false },
    listener: { address: "0.0.0.0", port: 43110 },
    interfaces,
  });
  assert.equal(pendingDisable.restartNeeded, true);
  const portChange = networkStatus({
    config: { ...config, port: 43112 },
    listener: { address: "0.0.0.0", port: 43110 },
    interfaces,
  });
  assert.equal(portChange.restartNeeded, true);
  assert.equal(portChange.addresses[0].url.endsWith(":43110"), true);
  const stopped = networkStatus({ config, listener: null, interfaces });
  assert.match(pairingNetworkBlock(stopped), /stopped/);
  assert.match(pairingNetworkBlock(undefined), /Check/);
});

test("specific interface listener identifies only the bound candidate", () => {
  const status = networkStatus({
    config,
    listener: { address: "192.168.0.131", port: 43110 },
    interfaces,
  });
  assert.equal(status.addresses[0].address, "192.168.0.131");
  assert.equal(status.addresses.filter((item) => item.listening).length, 1);
});

test("Android pairing rejects localhost and loopback aliases instead of giving the phone a ticket for itself", () => {
  for (const host of [
    "localhost",
    "LOCALHOST.",
    "a.localhost",
    "127.0.0.1",
    "127.2.3.4",
    "127.1",
    "2130706433",
    "0x7f000001",
    "[::1]",
    "[0:0:0:0:0:0:0:1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:7f01:203]",
    "[::ffff:0.0.0.0]",
    "[::ffff:0:0]",
    "0.0.0.0",
    "[::]",
  ]) {
    assert.throws(
      () => pairingAddress(`https://${host}:43110`, "android"),
      /Localhost points to your phone/,
    );
  }
  for (const value of [
    "http://192.168.1.2:43110",
    "https://me:secret@192.168.1.2:43110",
    "https://192.168.1.2:43110/path",
    "https://192.168.1.2:43110/?x=1",
    "https://192.168.1.2:43110/#part",
    "not a url",
  ])
    assert.throws(() => pairingAddress(value, "android"));
  assert.equal(
    pairingAddress("https://192.168.0.131:43110/", "android"),
    "https://192.168.0.131:43110",
  );
  assert.equal(
    pairingAddress("https://my-pc.tailnet.ts.net:43110", "android"),
    "https://my-pc.tailnet.ts.net:43110",
  );
});

test("Chrome pairing stays on its fixed loopback-only bridge", () => {
  assert.equal(
    pairingAddress("http://127.0.0.1:43111", "chrome"),
    "http://127.0.0.1:43111",
  );
  for (const value of [
    "http://localhost:43111",
    "https://127.0.0.1:43111",
    "http://192.168.1.2:43111",
    "http://127.0.0.1:43111/path",
    "http://user@127.0.0.1:43111",
  ])
    assert.throws(() => pairingAddress(value, "chrome"));
});

test("network diagnostics are owner-only, read-only and report a real loopback listener", async (t) => {
  const base = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(base, "nakama-network-"));
  const host = await new NakamaHost({ dataDir: dir }).init();
  t.after(async () => {
    await host.close();
    assert.ok(dir.startsWith(base + path.sep));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const initial = JSON.stringify(host.store.state);
  const before = await host.dispatch("GET", "/api/network-status");
  assert.equal(before.listener.active, false);
  assert.equal(JSON.stringify(host.store.state), initial);
  await host.listen({ host: "127.0.0.1", port: 0 });
  const after = await host.dispatch("GET", "/api/network-status");
  assert.equal(after.listener.address, "127.0.0.1");
  assert.equal(after.listener.allowLan, false);
  assert.ok(after.listener.port > 0);
  assert.equal(JSON.stringify(host.store.state), initial);
  for (const platform of ["android", "chrome"]) {
    const id = "fixture-" + platform;
    host.store.state.devices.push({
      id,
      platform,
      permissions: { googleAccess: false, projectAccess: false },
    });
    await assert.rejects(
      host.dispatch(
        "GET",
        "/api/network-status",
        {},
        { kind: "device", id, platform },
      ),
      (error) => error.status === 403,
    );
  }
  await assert.rejects(
    host.dispatch("GET", "/api/network-status", {}, { kind: "anonymous" }),
    (error) => error.status === 401,
  );
  assert.equal(host.tickets.size, 0);
});


test("VPN-only binding never widens to LAN or unrelated CGNAT adapters", () => {
  assert.equal(hostBindAddress({ vpnOnly:true, allowLan:true }, interfaces), "100.100.5.7");
  assert.equal(hostBindAddress({ vpnOnly:true, allowLan:true }, { Mobile:[{address:"100.65.1.2",internal:false}] }), "127.0.0.1");
  assert.equal(hostBindAddress({ vpnOnly:true }, {}), "127.0.0.1");
  const status = networkStatus({ config:{...config,vpnOnly:true}, listener:{address:"0.0.0.0",port:43110}, interfaces });
  assert.equal(status.restartNeeded,true);
  const ready = networkStatus({ config:{...config,vpnOnly:true}, listener:{address:"100.100.5.7",port:43110}, interfaces });
  assert.equal(ready.restartNeeded,false);
  assert.deepEqual(ready.addresses.filter(row=>row.listening).map(row=>row.address),["100.100.5.7"]);
});
