// Native UI + local persistence in a disposable profile. Synthetic phone/location
// and remote status; no desktop input/capture, microphone, provider or account use.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = path.join(root, "tmp", "foundations-ui-" + Date.now());
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  const stamp = new Date().toISOString();
  state.devices.push({
    id: "fixture-phone",
    name: "Fixture Android 16",
    platform: "android",
    pairedAt: stamp,
    permissions: {
      projectAccess: true,
      googleAccess: true,
      browserControl: false,
      remoteDesktop: false,
    },
    capabilities: [],
  });
  state.deviceLocations = [
    {
      deviceId: "fixture-phone",
      enabled: true,
      updatedAt: stamp,
      lastKnown: {
        latitude: 51.5007,
        longitude: -0.1246,
        accuracy: 28,
        observedAt: new Date(Date.now() - 3600000).toISOString(),
        receivedAt: stamp,
      },
    },
  ];
  state.tasks.push({
    id: "fixture-task",
    title: "A finished fixture task",
    providerId: "codex",
    status: "completed",
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.messages.push(
    {
      id: "fixture-lookup",
      role: "assistant",
      content: "Synthetic dated weather lookup, not live weather.",
      createdAt: stamp,
      localOutcome: {
        type: "weather_lookup",
        url: "https://www.google.com/search?q=weather+at+51.5%2C-0.1",
      },
    },
    {
      id: "fixture-rejected-lookup",
      role: "assistant",
      content: "Invalid fixture lookup must not create a button.",
      createdAt: stamp,
      localOutcome: {
        type: "weather_lookup",
        url: "javascript:alert('not permitted')",
      },
    },
  );
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
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
    console.error("Foundations UI deadline exceeded.");
    app.process().kill();
  }, 150000);
  const images = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.waitFor();
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      const fixture = { calls: [], blocked: [], session: null };
      globalThis.__foundationsFixture = fixture;
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        fixture.calls.push({ method, route, body });
        if (method === "GET" && route === "/api/actions")
          return { actions: [] };
        if (method === "GET" && route === "/api/remote-desktop/status") {
          const data = await original(event, "GET", "/api/state");
          return {
            available: true,
            enabled: data.config.remoteDesktopEnabled === true,
            permitted: true,
            monitors: [
              {
                id: "fixture-monitor-a",
                name: "Main fixture",
                width: 1920,
                height: 1080,
                primary: true,
              },
              {
                id: "fixture-monitor-b",
                name: "Side fixture",
                width: 1280,
                height: 1024,
                primary: false,
              },
            ],
            session: fixture.session,
            detail:
              "Synthetic remote desktop status. No capture or input is performed.",
          };
        }
        if (method === "POST" && route === "/api/remote-desktop/stop") {
          fixture.session = null;
          return { stopped: true };
        }
        const local =
          (method === "GET" && route === "/api/state") ||
          /^\/api\/(?:task-board|routines|core-memory|companion-memory)(?:\/|$)/.test(
            route,
          ) ||
          (method === "DELETE" &&
            route === "/api/device-locations/fixture-phone") ||
          (method === "PATCH" &&
            route === "/api/devices/fixture-phone" &&
            Object.keys(body).every((key) => key === "remoteDesktop")) ||
          (method === "PATCH" &&
            route === "/api/settings" &&
            Object.keys(body).every((key) => ["remoteDesktopEnabled", "memoryEnabled"].includes(key)));
        if (local) return original(event, method, route, body);
        if (
          method === "POST" &&
          route === "/api/chat" &&
          [
            "show my tasks",
            "what are you working on?",
            "Nakama personality: Keep replies playful and practical.",
          ].includes(body.message)
        )
          return original(event, method, route, body);
        fixture.blocked.push({ method, route });
        throw new Error("Blocked by isolated foundations UI fixture.");
      });
    });
    const capture = async (name) => {
      const file = path.join(root, "output", name);
      await page.screenshot({ path: file, fullPage: true });
      images.push(path.relative(root, file));
    };
    const saved = async () =>
      JSON.parse(
        await fs.readFile(path.join(profile, "private/state.json"), "utf8"),
      );
    await nav.getByRole("button", { name: "My clipboard" }).click();
    await expect(
      page.getByRole("heading", { name: "Let’s get it done." }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: "Reopen task: A finished fixture task",
      }),
    ).toHaveAttribute("aria-checked", "true");
    await page
      .getByRole("textbox", { name: "New task" })
      .fill("Bring a sketchbook");
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    const card = page.locator(".board-item").filter({
      has: page.getByRole("heading", {
        name: "Bring a sketchbook",
        exact: true,
      }),
    });
    await expect(card).toBeVisible();
    await card.getByRole("checkbox").click();
    await expect(card).toHaveClass(/done/);
    await capture("foundations-task-board.png");
    await page.reload();
    await nav.getByRole("button", { name: "My clipboard" }).click();
    await expect(card).toHaveClass(/done/);
    await page
      .getByRole("button", { name: "Clear completed", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    assert.equal(
      (await saved()).tasks.length,
      1,
      "Clearing board preserves source tasks",
    );
    await page.reload();
    await nav.getByRole("button", { name: "My clipboard" }).click();
    await expect(
      page.getByText("A finished fixture task", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: /Routines board/ }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Morning stretch");
    await page.getByLabel("Time", { exact: true }).fill("07:15");
    await page
      .getByRole("textbox", { name: "Time zone", exact: true })
      .fill("Europe/London");
    await page
      .getByRole("button", { name: "Add routine", exact: true })
      .click();
    const routine = page.locator(".routine-card").filter({
      has: page.getByRole("heading", {
        name: "Morning stretch",
        exact: true,
      }),
    });
    await expect(routine).toBeVisible();
    await routine.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Time", { exact: true }).fill("07:45");
    await page
      .getByRole("button", { name: "Save routine", exact: true })
      .click();
    await expect(routine).toContainText("07:45");
    await routine.getByRole("checkbox").click();
    await expect(routine).toContainText("Paused");
    await capture("foundations-routines.png");
    await expect
      .poll(async () => (await saved()).routineBoard.routines[0].enabled)
      .toBe(false);
    await routine
      .getByRole("button", {
        name: "Delete routine: Morning stretch",
        exact: true,
      })
      .click();
    await expect(routine).toHaveCount(0);
    await nav.getByRole("button", { name: "Core Memory", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Category" })
      .selectOption("personality");
    await page
      .getByRole("textbox", { name: "What should Nakama remember?" })
      .fill("Keep replies playful and practical.");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(async () => (await saved()).companionMemory.entries[0]?.category)
      .toBe("personality");
    await page.getByRole("checkbox", { name: /^Use memory in conversation/ }).click();
    await expect.poll(async () => (await saved()).config.memoryEnabled).toBe(false);
    await expect(page.getByText(/learning and reuse of these notes are paused/)).toBeVisible();
    await page.getByRole("checkbox", { name: /^Use memory in conversation/ }).click();
    await expect.poll(async () => (await saved()).config.memoryEnabled).toBe(true);
    await capture("foundations-core-memory.png");
    await nav.getByRole("button", { name: "Devices", exact: true }).click();
    await expect(
      page.getByText("Last known · stale", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/51.50070, -0.12460/)).toBeVisible();
    await page
      .getByRole("checkbox", { name: /^Allow remote desktop sessions/ })
      .click();
    await expect(
      page.getByRole("checkbox", { name: /^Allow remote desktop sessions/ }),
    ).toBeChecked();
    await page
      .getByRole("checkbox", { name: /^Remote desktop Use this phone/ })
      .click();
    await expect
      .poll(async () => (await saved()).devices[0].permissions.remoteDesktop)
      .toBe(true);
    await app.evaluate(() => {
      globalThis.__foundationsFixture.session = {
        id: "fixture-session",
        deviceId: "fixture-phone",
        monitorId: "fixture-monitor-a",
        expiresAt: new Date(Date.now() + 90000).toISOString(),
        lastActivityAt: new Date().toISOString(),
      };
    });
    await expect(
      page.getByRole("button", { name: "Stop remote desktop", exact: true }),
    ).toBeVisible();
    await capture("foundations-device-controls.png");
    await page
      .getByRole("button", { name: "Stop remote desktop", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop remote desktop", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Forget location & stop sharing",
        exact: true,
      })
      .click();
    await expect(page.getByText(/51.50070, -0.12460/)).toHaveCount(0);
    await nav.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open weather lookup", exact: true }),
    ).toHaveCount(1);
    await page
      .getByRole("textbox", { name: "Message Nakama" })
      .fill("what are you working on?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByText(
        "No assistant work is currently running. Your task board keeps saved tasks and results.",
        { exact: true },
      ),
    ).toBeVisible();
    const final = await saved();
    assert.equal(
      final.tasks.length,
      1,
      "Local status did not invoke an AI task",
    );
    const fixture = await app.evaluate(() => globalThis.__foundationsFixture);
    assert.deepEqual(fixture.blocked, [], "Unexpected provider/external route");
    assert.deepEqual(errors, [], "Renderer errors");
    await fs.writeFile(
      path.join(root, "output/foundations-ui-verification.json"),
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          profile: path.relative(root, profile),
          result: "passed",
          images,
          checks: [
            "Task add/completion/reload/clear and source preservation",
            "Routine add/edit/pause/remove persistence",
            "Core Memory personality notes",
            "Synthetic stale location and owner forget",
            "Remote opt-ins and simulated session Stop",
            "Fast local manager status without inference",
          ],
          limitations: [
            "No real location, microphone, provider calls or remote input/capture",
            "Physical Android 16 acceptance remains required",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Foundations UI checks passed.");
  } finally {
    clearTimeout(deadline);
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
