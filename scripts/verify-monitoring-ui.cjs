// Disposable native fixture. Monitors are saved paused; no remote page, model,
// process inspection, purchase or installed profile is used.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  path.join(
    require("node:os").homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
const { _electron } = require(playwrightPath),
  { expect } = require(path.join(playwrightPath, "test"));
(async () => {
  const root = path.resolve(__dirname, ".."),
    profile = path.join(root, "tmp", `monitoring-ui-${Date.now()}`);
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  const seed = initialState();
  seed.devices.push({
    id: "fixture-phone",
    name: "Fixture phone",
    platform: "android",
    permissions: {
      browserControl: true,
      projectAccess: true,
      googleAccess: true,
    },
  });
  await fs.writeFile(
    path.join(profile, "private/state.json"),
    JSON.stringify(seed),
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
  const deadline = setTimeout(() => app.process().kill(), 150000);
  try {
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      globalThis.__monitorFixture = {
        calls: [],
        blocked: [],
        failCreate: true,
      };
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        const f = globalThis.__monitorFixture;
        if (method !== "GET") f.calls.push({ method, route, body });
        if (
          method !== "GET" &&
          !["/api/monitors", "/api/self-maintenance"].includes(route) &&
          !(
            method === "POST" && /^\/api\/monitors\/[^/]+\/sharing$/.test(route)
          )
        ) {
          f.blocked.push(route);
          throw new Error("Fixture rejects effects");
        }
        if (route === "/api/monitors" && method === "POST" && f.failCreate) {
          f.failCreate = false;
          throw new Error("Synthetic save failure; retain draft");
        }
        return original(event, method, route, body);
      });
    });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.waitFor();
    await nav.getByRole("button", { name: "Monitoring", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Synthetic stock alert");
    await page
      .getByLabel("Product or page URL")
      .fill("https://shop.example/fr/product");
    await page
      .getByRole("button", { name: "Save monitor", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Synthetic save failure",
    );
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Synthetic stock alert",
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await nav.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Synthetic stock alert",
    );
    await page
      .getByRole("button", { name: "Save monitor", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Synthetic stock alert" }),
    ).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Check once", exact: true }),
    ).toBeDisabled();
    await page
      .getByText("Private shopping setup and cart preparation", { exact: true })
      .click();
    const sharing = page.getByRole("group", {
      name: "Private handoff and alerts on paired devices",
      exact: true,
    });
    await sharing.getByLabel("Fixture phone", { exact: true }).check();
    page.once("dialog", (dialog) => dialog.dismiss());
    await nav.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(
      sharing.getByLabel("Fixture phone", { exact: true }),
    ).toBeChecked();
    await sharing
      .getByRole("button", { name: "Save device access", exact: true })
      .click();
    await expect(
      sharing.getByRole("button", { name: "Save device access", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: path.join(root, "tmp/monitoring-ui.png"),
      fullPage: true,
    });
    await nav
      .getByRole("button", { name: "Dynamic upgrade", exact: true })
      .click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Synthetic improvement");
    await page
      .getByLabel("Requested change", { exact: true })
      .fill("Make fixture status clearer.");
    await page
      .getByRole("button", {
        name: "Save request without model usage",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Synthetic improvement" }),
    ).toBeVisible();
    await expect(page.getByText("held", { exact: true })).toBeVisible();
    await page.screenshot({
      path: path.join(root, "tmp/self-maintenance-ui.png"),
      fullPage: true,
    });
    const result = await app.evaluate(() => globalThis.__monitorFixture);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(errors, []);
    const create = result.calls
      .filter((call) => call.route === "/api/monitors")
      .at(-1);
    assert.deepEqual(create.body.condition, { type: "stock" });
    assert.equal(create.body.intervalSeconds, 60);
    const state = JSON.parse(
      await fs.readFile(path.join(profile, "private/state.json"), "utf8"),
    );
    assert.equal(state.monitors[0].status, "paused");
    assert.deepEqual(state.monitors[0].sharedDeviceIds, ["fixture-phone"]);
    assert.equal(state.selfMaintenance.requests[0].status, "held");
    assert.equal(state.tasks.length, 0);
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks: [
            "Failed save and declined navigation retain drafts",
            "Locale-independent stock predicate and default cadence",
            "New monitor stays paused; no check runs",
            "Existing monitor phone sharing saves with draft protection",
            "Upgrade request stays held; no model starts",
          ],
          providerCalls: 0,
          remotePageLoads: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(deadline);
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
