// Native renderer only, disposable profile, synthetic catalogs/actions, no phones or providers.
const fs = require("node:fs/promises"), path = require("node:path"), assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const runtime = process.env.NAKAMA_PLAYWRIGHT || path.join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(runtime), { expect } = require(path.join(runtime, "test"));
(async () => {
  const root = path.resolve(__dirname, ".."), profile = path.join(root, "tmp", `app-picker-ui-${Date.now()}`);
  const { initialState } = await import(pathToFileURL(path.join(root, "apps/host/store.mjs")).href);
  const seed = initialState();
  seed.devices = ["phone", "tablet"].map((id) => ({ id, name: `Fixture ${id}`, platform: "android", permissions: { projectAccess: true, googleAccess: true } }));
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  await fs.writeFile(path.join(profile, "private/state.json"), JSON.stringify(seed));
  const env = { ...process.env, NAKAMA_SMOKE_TEST: "1", NAKAMA_TEST_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [root], env, timeout: 30000 });
  const deadline = setTimeout(() => app.process().kill(), 120000);
  try {
    const page = await app.firstWindow(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      globalThis.__appFixture = { calls: [], expired: false, revoke: false, delayPhone: false, delayed: false };
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        const f = globalThis.__appFixture, match = route.match(/^\/api\/devices\/(phone|tablet)\/apps$/);
        if (match) {
          const deviceId = match[1];
          if (deviceId === "phone" && f.delayPhone) { f.delayed = true; await new Promise((resolve) => setTimeout(resolve, 1600)); }
          return { deviceId, available: true, expiresAt: new Date(Date.now() + (f.expired ? -1 : 90000)).toISOString(), apps: deviceId === "phone" ?
            [{ packageName: "com.fixture.first", label: "Reader" }, { packageName: "com.fixture.second", label: "Reader" }] :
            [{ packageName: "com.fixture.tablet", label: "Tablet notes" }] };
        }
        if (method !== "GET") {
          if (method === "POST" && route === "/api/device/actions") { f.calls.push({ route, body }); return { queued: true }; }
          if (method === "POST" && route === "/api/monitors") { f.calls.push({ route, body }); return original(event, method, route, body); }
          throw new Error("Synthetic fixture rejects external effects");
        }
        const response = await original(event, method, route, body);
        if (route === "/api/state" && f.revoke) response.devices = response.devices.filter((item) => item.id !== "phone");
        return response;
      });
    });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.getByRole("button", { name: "Devices", exact: true }).click();
    const panel = page.locator(".device-actions-panel");
    await panel.getByLabel("Action", { exact: true }).selectOption("open_app");
    const picker = panel.getByLabel("Installed app", { exact: false });
    await expect(picker).toBeEnabled();
    await expect(picker.locator("option")).toHaveText(["Choose an installed app", "Reader (com.fixture.first)", "Reader (com.fixture.second)"]);
    await picker.selectOption("com.fixture.second");
    await panel.getByRole("button", { name: "Send action", exact: true }).click();
    assert.deepEqual(await app.evaluate(() => globalThis.__appFixture.calls[0].body), { deviceId: "phone", type: "open_app", args: { packageName: "com.fixture.second" } });
    await app.evaluate(() => { globalThis.__appFixture.delayPhone = true; });
    await expect.poll(() => app.evaluate(() => globalThis.__appFixture.delayed), { timeout: 10000 }).toBe(true);
    await panel.getByLabel("Device", { exact: true }).selectOption("tablet");
    await panel.getByLabel("Action", { exact: true }).selectOption("open_app");
    await expect(picker.locator("option")).toHaveText(["Choose an installed app", "Tablet notes"]);
    await picker.selectOption("com.fixture.tablet");
    await expect(panel.getByRole("button", { name: "Send action", exact: true })).toBeEnabled();
    await app.evaluate(() => { globalThis.__appFixture.expired = true; });
    await expect(picker).toBeDisabled({ timeout: 10000 });
    await expect(panel.getByRole("button", { name: "Send action", exact: true })).toBeDisabled();
    await app.evaluate(() => { globalThis.__appFixture.expired = false; globalThis.__appFixture.delayPhone = false; });
    await nav.getByRole("button", { name: "Monitoring", exact: true }).click();
    await page.getByLabel("Watch", { exact: true }).selectOption("android_app");
    await page.getByLabel("Phone or tablet", { exact: true }).selectOption("phone");
    const monitorPicker = page.getByLabel("Installed app", { exact: false });
    await expect(monitorPicker).toBeEnabled();
    await monitorPicker.selectOption("com.fixture.first");
    await page.getByLabel("Name", { exact: true }).fill("Fixture reader alert");
    await page.getByLabel("Text to look for", { exact: true }).fill("Ready");
    await page.getByRole("button", { name: "Save monitor", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Fixture reader alert" })).toBeVisible();
    assert.equal((await app.evaluate(() => globalThis.__appFixture.calls.at(-1))).body.packageName, "com.fixture.first");
    await app.evaluate(() => { globalThis.__appFixture.revoke = true; });
    await expect(monitorPicker).toBeDisabled({ timeout: 15000 });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["Friendly names with exact duplicate identity", "Exact device/action payload", "Late prior-device list ignored", "Expired catalogs disable actions", "Monitor uses exact selected app", "Revoked device hides app choices"], providerCalls: 0, physicalDevices: 0 }, null, 2));
  } finally {
    clearTimeout(deadline);
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
