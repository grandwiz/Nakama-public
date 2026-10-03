// Native alarm targeting fixture with disposable data; no providers or physical devices.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const runtime =
  process.env.NAKAMA_PLAYWRIGHT ||
  path.join(
    require("node:os").homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
const { _electron } = require(runtime),
  { expect } = require(path.join(runtime, "test"));
(async () => {
  const root = path.resolve(__dirname, ".."),
    profile = path.join(root, "tmp", "routing-ui-" + Date.now());
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const seed = initialState();
  seed.devices = ["phone", "tablet"].map((id) => ({
    id,
    name: "Fixture " + id,
    platform: "android",
    permissions: { projectAccess: true, googleAccess: true },
  }));
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
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
  const deadline = setTimeout(() => app.process().kill(), 120000);
  try {
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      globalThis.__routingFixture = { calls: [], revoke: false };
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        if (method !== "GET") {
          if (
            !["POST", "PATCH"].includes(method) ||
            !route.startsWith("/api/routines")
          )
            throw new Error("Fixture rejects external effects");
          globalThis.__routingFixture.calls.push({ method, route, body });
        }
        const response = await original(event, method, route, body);
        if (route === "/api/state" && globalThis.__routingFixture.revoke)
          response.devices = response.devices.map((d) =>
            d.id === "tablet"
              ? {
                  ...d,
                  permissions: { ...d.permissions, projectAccess: false },
                }
              : d,
          );
        return response;
      });
    });
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "My clipboard", exact: true })
      .click();
    await page.getByRole("tab", { name: /Routines board/ }).click();
    await page.getByLabel("Name", { exact: true }).fill("Fixture morning");
    await page
      .getByLabel("Routine type", { exact: true })
      .selectOption("alarm");
    const save = page.getByRole("button", { name: /Add routine|Save routine/ });
    await expect(
      page.getByLabel("Routine schedule", { exact: true }),
    ).toHaveValue("once");
    await expect(save).toBeDisabled();
    await page.getByLabel(/^Date in /).fill("2099-10-03");
    await expect(save).toBeDisabled();
    await page
      .getByRole("checkbox", { name: "Notify Fixture phone", exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "Notify Fixture tablet", exact: true })
      .check();
    await save.click();
    const card = page.locator(".routine-card").filter({
      has: page.getByRole("heading", {
        name: "Fixture morning",
        exact: true,
      }),
    });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Once · 2099-10-03");
    await expect(
      card.getByRole("status").filter({ hasText: /Waiting for this device/ }),
    ).toHaveCount(2);
    const calls = await app.evaluate(() => globalThis.__routingFixture.calls);
    assert.deepEqual(calls[0].body.targetDeviceIds, ["phone", "tablet"]);
    assert.equal("targetDeviceId" in calls[0].body, false);
    assert.equal(calls[0].body.scheduledDate, "2099-10-03");
    assert.deepEqual(calls[0].body.weekdays, []);
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await app.evaluate(() => {
      globalThis.__routingFixture.revoke = true;
    });
    await expect(
      page.getByRole("checkbox", {
        name: "Remove unavailable target Fixture tablet",
        exact: true,
      }),
    ).toBeVisible({ timeout: 15000 });
    await expect(save).toBeDisabled();
    await page
      .getByRole("checkbox", {
        name: "Remove unavailable target Fixture tablet",
        exact: true,
      })
      .click();
    await save.click();
    await expect(
      card.getByRole("status").filter({ hasText: /Waiting for this device/ }),
    ).toHaveCount(1);
    const edits = await app.evaluate(() => globalThis.__routingFixture.calls);
    assert.deepEqual(edits[1].body.targetDeviceIds, ["phone"]);
    assert.equal(edits[1].body.scheduledDate, "2099-10-03");
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel(/^Date in /)).toHaveValue("2099-10-03");
    await page
      .getByLabel("Routine schedule", { exact: true })
      .selectOption("repeat");
    await save.click();
    await expect(card).not.toContainText("Once");
    const converted = await app.evaluate(() =>
      globalThis.__routingFixture.calls.at(-1),
    );
    assert.equal(converted.body.scheduledDate, null);
    assert.deepEqual(converted.body.weekdays, [1, 2, 3, 4, 5]);
    await page.getByLabel("Name", { exact: true }).fill("Fixture PC reminder");
    await save.click();
    const reminder = page.locator(".routine-card").filter({
      has: page.getByRole("heading", {
        name: "Fixture PC reminder",
        exact: true,
      }),
    });
    await expect(reminder).toContainText("This PC");
    await reminder.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Notify This PC", exact: true }),
    ).toBeChecked();
    await expect(save).toBeEnabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const saved = JSON.parse(
      await fs.readFile(path.join(profile, "private/state.json"), "utf8"),
    );
    assert.equal(saved.routineBoard.routines.length, 2);
    assert.deepEqual(
      saved.routineBoard.routines.find(
        (routine) => routine.title === "Fixture morning",
      ).targetDeviceIds,
      ["phone"],
    );
    assert.equal(saved.tasks.length, 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks: [
            "New alarms default to one date and require that date",
            "Alarm requires explicit destination",
            "Two device selections in one schedule",
            "Independent pending receipts",
            "Edit preserves target identities",
            "One-shot date survives editing and target removal",
            "Explicit repeat mode clears the date and saves weekdays",
            "Revoked destination blocks save until removed",
            "PC reminder destination survives editing",
            "No model tasks or external actions",
          ],
          providerCalls: 0,
          physicalDevices: 0,
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
