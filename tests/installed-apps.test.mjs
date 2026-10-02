import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaHost } from "../apps/host/host.mjs";
import { InstalledApps, APP_CATALOG_TTL_MS, validateInstalledApps } from "../apps/host/installed-apps.mjs";
const owner = { kind: "owner", id: "desktop" };
const phone = { kind: "device", id: "phone", platform: "android" };
const apps = [{ packageName: "com.fixture.one", label: "Reader" }, { packageName: "com.fixture.two", label: "Reader" }];
function fixture() {
  let now = 1000;
  const devices = [{ id: "phone", platform: "android", permissions: {} }, { id: "tablet", platform: "android", permissions: {} }, { id: "chrome", platform: "chrome" }];
  const host = { device: (id) => { const found = devices.find((row) => row.id === id); if (!found) throw new Error("Device not found"); return found; } };
  return { catalogs: new InstalledApps(host, () => now), devices, advance: (ms) => { now += ms; } };
}
test("app catalogs retain exact IDs for duplicate labels and cannot cross paired devices", () => {
  const { catalogs } = fixture();
  catalogs.publish({ apps }, phone);
  assert.deepEqual(catalogs.list("phone", owner).apps, apps);
  assert.deepEqual(catalogs.list("tablet", owner).apps, []);
  assert.throws(() => catalogs.list("phone", { kind: "device", id: "tablet" }), /desktop|owner|Windows/i);
  assert.throws(() => catalogs.publish({ apps, deviceId: "tablet" }, phone), /scoped/);
  assert.throws(() => catalogs.publish({ apps }, owner), /Only/);
  assert.throws(() => catalogs.publish({ apps }, { kind: "device", id: "chrome" }), /Android/);
});
test("expiry, permission loss, device removal and host restart discard catalog authority", () => {
  const { catalogs, devices, advance } = fixture();
  catalogs.publish({ apps }, phone);
  advance(APP_CATALOG_TTL_MS);
  assert.equal(catalogs.list("phone", owner).available, false);
  catalogs.publish({ apps }, phone);
  devices[0].permissions.googleAccess = false;
  assert.throws(() => catalogs.list("phone", owner), /shared access/);
  devices[0].permissions.googleAccess = true;
  assert.equal(catalogs.list("phone", owner).available, false);
  catalogs.publish({ apps }, phone);
  devices.splice(0, 1);
  assert.throws(() => catalogs.list("phone", owner), /not found/);
  assert.equal(fixture().catalogs.list("phone", owner).available, false);
});
test("catalog input rejects malformed packages, hidden formatting, duplicate IDs and excess metadata", () => {
  for (const value of [null, {}, [{ packageName: "*", label: "App" }], [...apps, apps[0]], [{ ...apps[0], label: "Fake\u202eApp" }], [{ ...apps[0], token: "not permitted" }], Array(1001).fill(apps[0])])
    assert.throws(() => validateInstalledApps(value));
  assert.deepEqual(validateInstalledApps([]), []);
});
test("host routes keep inventory owner-only and volatile; disable/re-enable and revoke clear it", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-app-catalog-"));
  const host = await new NakamaHost({ dataDir: dir, runAgent: () => { throw new Error("No model allowed"); } }).init();
  t.after(async () => { await host.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await host.store.change((state) => { state.devices.push({ id: "phone", name: "Fixture", platform: "android", permissions: {} }); });
  await host.dispatch("POST", "/api/device/apps", { apps }, phone);
  assert.deepEqual((await host.dispatch("GET", "/api/devices/phone/apps")).apps, apps);
  assert.equal(JSON.stringify(await host.dispatch("GET", "/api/state", {}, phone)).includes("com.fixture.one"), false);
  assert.equal(JSON.stringify(host.store.state).includes("com.fixture.one"), false);
  await assert.rejects(host.dispatch("GET", "/api/devices/phone/apps", {}, phone));
  await host.dispatch("PATCH", "/api/devices/phone", { googleAccess: false });
  await host.dispatch("PATCH", "/api/devices/phone", { googleAccess: true });
  assert.equal((await host.dispatch("GET", "/api/devices/phone/apps")).available, false);
  await host.dispatch("POST", "/api/device/apps", { apps }, phone);
  await host.dispatch("DELETE", "/api/devices/phone");
  assert.equal(host.installedApps.catalogs.size, 0);
  await assert.rejects(host.dispatch("POST", "/api/device/apps", { apps }, phone));
});
