// Native Electron pairing regression using a disposable profile. Network
// diagnostics/tickets are fixtures: no real pairing keys, listener changes,
// firewall changes, account requests or clipboard access are performed.
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = path.join(root, "tmp", "pairing-network-ui-" + Date.now());
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = path.join(profile, "projects");
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  await fs.mkdir(state.config.workspaceRoot);
  await fs.writeFile(
    path.join(profile, "private/state.json"),
    JSON.stringify(state),
  );
  const env = {
    ...process.env,
    NAKAMA_SMOKE_TEST: "1",
    NAKAMA_TEST_DATA_DIR: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [root],
    env,
    timeout: 30000,
  });
  const deadline = setTimeout(() => {
    console.error("Pairing network fixture timed out.");
    app.process().kill();
  }, 120000);
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers?.get("nakama:api");
      if (typeof original !== "function")
        throw new Error("Fixture interceptor unavailable");
      const data = {
        posts: [],
        fail: false,
        network: {
          configured: { allowLan: false, port: 43110 },
          listener: {
            active: true,
            allowLan: false,
            address: "127.0.0.1",
            port: 43110,
          },
          restartNeeded: false,
          addresses: [
            {
              name: "VirtualBox Host-Only",
              address: "192.168.56.1",
              kind: "lan",
              url: "https://192.168.56.1:43110",
              listening: false,
            },
            {
              name: "Wi-Fi",
              address: "192.168.0.131",
              kind: "lan",
              url: "https://192.168.0.131:43110",
              listening: false,
            },
          ],
        },
      };
      globalThis.__nakamaPairingFixture = data;
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", (event, method, route, body) => {
        if (route === "/api/network-status") {
          if (data.fail) throw new Error("Fixture unavailable");
          return structuredClone(data.network);
        }
        if (method === "POST" && route === "/api/pairing/tickets") {
          data.posts.push(body);
          return {
            ticket: "fixture-only-not-a-real-ticket",
            expiresAt: new Date(Date.now() + 120000).toISOString(),
            fingerprint: "AA:BB:CC",
            hostName: "Pairing fixture",
            port: 43110,
          };
        }
        if (method !== "GET")
          throw new Error("Unexpected mutation in pairing fixture: " + route);
        return original(event, method, route, body);
      });
    });
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Devices", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pair a device", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Pair a new device" });
    await expect(dialog.getByLabel("Control Center address")).toHaveValue(
      "https://192.168.0.131:43110",
    );
    await expect(
      dialog.getByText(/This PC is listening locally only/),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Create pairing ticket" }),
    ).toBeDisabled();
    await dialog.getByLabel("Device type").selectOption("chrome");
    await expect(dialog.getByLabel("Control Center address")).toHaveValue(
      "http://127.0.0.1:43111",
    );
    await expect(dialog.getByLabel("Control Center address")).toBeDisabled();
    await dialog.getByRole("button", { name: "Create pairing ticket" }).click();
    dialog = page.getByRole("dialog", { name: "Connect your companion" });
    assert.equal(
      JSON.parse(
        await dialog
          .getByRole("textbox", { name: /^Pairing information/ })
          .inputValue(),
      ).url,
      "http://127.0.0.1:43111",
    );
    await dialog.getByRole("button", { name: "Create another ticket" }).click();
    dialog = page.getByRole("dialog", { name: "Pair a new device" });
    await dialog.getByLabel("Device type").selectOption("android");
    await app.evaluate(() => {
      const n = globalThis.__nakamaPairingFixture.network;
      n.configured.allowLan = true;
      n.restartNeeded = true;
    });
    await dialog.getByRole("button", { name: "Check network again" }).click();
    await expect(
      dialog.getByText(/Network settings have changed/),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Create pairing ticket" }),
    ).toBeDisabled();
    await app.evaluate(() => {
      const n = globalThis.__nakamaPairingFixture.network;
      n.listener.allowLan = true;
      n.listener.address = "0.0.0.0";
      n.restartNeeded = false;
      n.addresses.forEach((item) => {
        item.listening = true;
      });
    });
    await dialog.getByRole("button", { name: "Check network again" }).click();
    await expect(
      dialog.getByText(/Private-network listener is active/),
    ).toBeVisible();
    await dialog
      .getByLabel("Control Center address")
      .fill("https://localhost:43110");
    await dialog.getByRole("button", { name: "Create pairing ticket" }).click();
    await expect(
      page.getByText(/Localhost points to your phone/),
    ).toBeVisible();
    assert.equal(
      await app.evaluate(() => globalThis.__nakamaPairingFixture.posts.length),
      1,
    );
    await dialog
      .getByLabel("Addresses found on this PC")
      .selectOption("https://192.168.0.131:43110");
    // Recheck immediately before POST catches a listener that became local after
    // the form was opened; an old green status must not create another ticket.
    await app.evaluate(() => {
      const n = globalThis.__nakamaPairingFixture.network;
      n.listener.allowLan = false;
      n.restartNeeded = true;
    });
    await dialog.getByRole("button", { name: "Create pairing ticket" }).click();
    await expect(
      dialog.getByRole("button", { name: "Create pairing ticket" }),
    ).toBeDisabled();
    assert.equal(
      await app.evaluate(() => globalThis.__nakamaPairingFixture.posts.length),
      1,
    );
    await app.evaluate(() => {
      const n = globalThis.__nakamaPairingFixture.network;
      n.listener.allowLan = true;
      n.restartNeeded = false;
    });
    await dialog.getByRole("button", { name: "Check network again" }).click();
    await expect(
      dialog.getByRole("button", { name: "Create pairing ticket" }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Create pairing ticket" }).click();
    dialog = page.getByRole("dialog", { name: "Connect your companion" });
    const payload = JSON.parse(
      await dialog
        .getByRole("textbox", { name: /^Pairing information/ })
        .inputValue(),
    );
    assert.equal(payload.url, "https://192.168.0.131:43110");
    assert.equal(payload.ticket, "fixture-only-not-a-real-ticket");
    await dialog.getByRole("button", { name: "Create another ticket" }).click();
    dialog = page.getByRole("dialog", { name: "Pair a new device" });
    await app.evaluate(() => {
      globalThis.__nakamaPairingFixture.fail = true;
    });
    await dialog.getByRole("button", { name: "Check network again" }).click();
    await expect(
      dialog.getByText(/Could not read the PC’s network status/),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Create pairing ticket" }),
    ).toBeDisabled();
    assert.equal(
      await app.evaluate(() => globalThis.__nakamaPairingFixture.posts.length),
      2,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks: [
            "Wi-Fi suggested over first VirtualBox adapter",
            "loopback listener blocked",
            "Chrome unchanged",
            "restart-needed blocked",
            "localhost rejected without POST",
            "fresh network recheck before ticket",
            "LAN payload correct",
            "failed diagnostics fail closed",
          ],
          profile,
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(deadline);
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
