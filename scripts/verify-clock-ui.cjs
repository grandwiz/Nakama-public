// Native Clock UI with a disposable host profile. No providers, phones, or external actions.
const fs = require("node:fs/promises"), path = require("node:path"), assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const runtime = process.env.NAKAMA_PLAYWRIGHT || path.join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(runtime), { expect } = require(path.join(runtime, "test"));
(async () => {
  const root = path.resolve(__dirname, ".."), profile = path.join(root, "tmp", `clock-ui-${Date.now()}`);
  const { initialState } = await import(pathToFileURL(path.join(root, "apps/host/store.mjs")).href);
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  await fs.writeFile(path.join(profile, "private/state.json"), JSON.stringify(initialState()));
  const env = { ...process.env, NAKAMA_SMOKE_TEST: "1", NAKAMA_TEST_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [root], env, timeout: 30000 });
  const deadline = setTimeout(() => app.process().kill(), 120000);
  try {
    const page = await app.firstWindow(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      globalThis.__clockFixture = { calls: [], dropCreateResponse: true };
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        if (method !== "GET") {
          if (method !== "POST" || !route.startsWith("/api/clock/timers")) throw new Error("Synthetic fixture rejects external effects");
          globalThis.__clockFixture.calls.push({ method, route, body });
        }
        const response = await original(event, method, route, body);
        if (route === "/api/clock/timers" && globalThis.__clockFixture.dropCreateResponse) {
          globalThis.__clockFixture.dropCreateResponse = false;
          throw new Error("Synthetic lost response; retry uses the same request ID");
        }
        return response;
      });
    });
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Clock", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Clock & timers" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current time" })).toContainText(/\d{2}:\d{2}:\d{2}/);
    await page.getByLabel("Timer name", { exact: true }).fill("Fixture tea");
    await page.getByRole("button", { name: "Start timer", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Synthetic lost response");
    await expect(page.getByLabel("Timer name", { exact: true })).toHaveValue("Fixture tea");
    await page.getByRole("button", { name: "Start timer", exact: true }).click();
    const tea = page.getByRole("region", { name: "Fixture tea timer", exact: true });
    await expect(tea).toHaveCount(1);
    await expect(page.getByLabel("Timer name", { exact: true })).toHaveValue("");
    await tea.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(tea).toContainText("paused");
    await tea.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(tea).toContainText("running");
    await tea.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(tea).toHaveCount(0);
    await page.getByLabel("Show history", { exact: true }).check();
    await expect(tea).toContainText("cancelled");
    await page.getByLabel("Show history", { exact: true }).uncheck();
    await page.getByLabel("Timer name", { exact: true }).fill("Fixture finish");
    await page.getByLabel("Minutes", { exact: true }).fill("0");
    await page.getByLabel("Seconds", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Start timer", exact: true }).click();
    const finish = page.getByRole("region", { name: "Fixture finish timer", exact: true });
    await expect(finish.getByRole("status")).toHaveText("Time’s up.", { timeout: 10000 });
    await finish.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(finish).toHaveCount(0);
    await page.getByLabel("Show history", { exact: true }).check();
    await expect(finish).toContainText("dismissed");
    const calls = await app.evaluate(() => globalThis.__clockFixture.calls);
    assert.equal(calls[0].body.durationSeconds, 600);
    assert.deepEqual(calls[0].body, calls[1].body, "Retry must use identical idempotent create payload");
    assert.deepEqual(calls.filter((call) => call.route !== "/api/clock/timers").map((call) => call.route.split("/").at(-1)), ["pause", "resume", "cancel", "dismiss"]);
    assert.deepEqual(calls.filter((call) => call.route !== "/api/clock/timers").map((call) => call.body.revision), [1, 2, 3, 2]);
    const saved = JSON.parse(await fs.readFile(path.join(profile, "private/state.json"), "utf8"));
    assert.equal(saved.clock.timers.length, 2);
    assert.equal(saved.tasks.length, 0);
    assert.equal(saved.routineBoard.routines.length, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["Clock navigation and local time", "Ten-minute timer and safe retry after lost response", "Pause/resume/cancel with current revisions", "Finished attention and dismissal", "History preserves completed timers", "No model tasks or repeating routines"], providerCalls: 0, physicalDevices: 0 }, null, 2));
  } finally {
    clearTimeout(deadline);
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
