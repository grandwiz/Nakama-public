// Actual Electron views with disposable synthetic data. The fixture rejects every non-fixture mutation.
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
    profile = path.join(root, "tmp", "chat-ui-" + Date.now());
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const seed = initialState();
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
  const checks = [];
  try {
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const stamp = new Date().toISOString();
      const fixture = (globalThis.__chatFixture = {
        calls: [],
        messages: Array.from({ length: 55 }, (_, i) => ({
          id: "m" + i,
          chatId: "current",
          role: i % 2 ? "assistant" : "user",
          content: `Synthetic conversation message ${i}. Reading older messages should keep this position while a new reply arrives.`,
          createdAt: stamp,
          deliveryDeviceId: "desktop",
        })),
        chat: {
          id: "current",
          revision: 4,
          projectId: null,
          deliveryDeviceId: "desktop",
          status: "active",
          startedAt: stamp,
          updatedAt: stamp,
          messageCount: 55,
          summary: "Synthetic saved summary",
          summaryMethod: "local_extract",
          canComplete: true,
        },
      });
      const original = ipcMain._invokeHandlers.get("nakama:api");
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        fixture.calls.push({ method, route, body });
        if (method === "GET" && route === "/api/state") {
          const result = await original(event, method, route, body);
          result.messages =
            fixture.chat.status === "active" ? fixture.messages : [];
          result.chatHistory = { rotationHours: 6, chats: [fixture.chat] };
          result.projects = [
            {
              id: "fixture-project",
              name: "Fixture project",
              path: "synthetic",
              status: "ready",
              updatedAt: stamp,
            },
          ];
          result.projectWorkflows = [
            {
              id: "done-workflow",
              projectId: "fixture-project",
              status: "completed",
              stage: "completed",
              message: "Finished synthetic workflow",
            },
            {
              id: "waiting-workflow",
              projectId: "fixture-project",
              status: "awaiting_answers",
              stage: "awaiting_answers",
              message: "Unfinished synthetic workflow",
              questions: [],
              assignments: {
                manager: { providerId: "codex", effort: "high" },
                peer: { providerId: "claude", effort: "high" },
                development: { providerId: "codex", effort: "high" },
              },
            },
          ];
          result.agentOffice = {
            version: 1,
            agents: [
              {
                id: "manager",
                name: "Finished fixture manager",
                status: "completed",
                role: "manager",
                providerId: "codex",
                sourceKind: "task",
                createdAt: stamp,
              },
              {
                id: "worker",
                name: "Working fixture agent",
                parentId: "manager",
                status: "running",
                role: "worker",
                providerId: "codex",
                sourceKind: "task",
                createdAt: stamp,
              },
            ],
          };
          if (fixture.demo) Object.assign(result, fixture.demo.state);
          if (fixture.networkConfig) Object.assign(result.config, fixture.networkConfig);
          if (fixture.credits) { result.alarmSounds = [fixture.credits.sound]; result.routineBoard = { routines: [fixture.credits.routine] }; }
          return result;
        }
        if (method === "GET" && route === "/api/network-status")
          return {
            configured: { allowLan: true, vpnOnly: false, port: 43110 },
            listener: {
              active: true,
              allowLan: true,
              address: "0.0.0.0",
              port: 43110,
            },
            restartNeeded: false,
            addresses: [
              {
                name: fixture.vpnName || "Tailscale (demo)",
                address: "100.100.20.30",
                kind: "vpn",
                url: "https://100.100.20.30:43110",
                listening: true,
              },
            ],
          };
        if (method === "GET" && route === "/api/project-imports/roots")
          return { roots: [{ id: "demo", name: "Demo project library" }] };
        if (
          method === "GET" &&
          route.startsWith("/api/project-imports/browse?")
        ) {
          const nested = new URL(
            route,
            "https://demo.invalid",
          ).searchParams.get("path");
          return {
            rootId: "demo",
            path: nested || "",
            entries: nested
              ? []
              : [
                  { name: "Garden planner", path: "Garden planner" },
                  { name: "Recipe notebook", path: "Recipe notebook" },
                ],
            detected: nested ? ["Claude", "GPT / Codex", "Git"] : [],
            canImport: Boolean(nested),
          };
        }
        if (method === "GET" && route.startsWith("/api/chats?"))
          return { rotationHours: 6, chats: [fixture.chat], nextCursor: null };
        if (method === "GET" && route === "/api/chats/current")
          return {
            chat: fixture.chat,
            messages: fixture.demo?.archive || [
              {
                id: "saved",
                role: "assistant",
                content: "Archived synthetic original message",
                createdAt: stamp,
              },
            ],
          };
        if (method === "POST" && route === "/api/chats/current/complete") {
          if (body.revision !== fixture.chat.revision)
            throw Error("Stale fixture revision");
          fixture.chat = {
            ...fixture.chat,
            status: "completed",
            canComplete: false,
            revision: 5,
          };
          return { chat: fixture.chat };
        }
        if (method === "POST" && route === "/api/chat") {
          fixture.messages.push({
            id: "submitted",
            chatId: "current",
            role: "user",
            content: body.message,
            createdAt: stamp,
            deliveryDeviceId: "desktop",
          });
          return {
            routing: {
              reason: "Synthetic fixture response; no provider called",
            },
          };
        }
        if (method === "PATCH" && route === "/api/settings") {
          if (Object.keys(body).sort().join(",") !== "allowLan,vpnOnly" || typeof body.allowLan !== "boolean" || typeof body.vpnOnly !== "boolean") throw Error("Unexpected fixture setting");
          fixture.networkConfig = body;
          return { ...body, restartRequired: true };
        }
        if (method !== "GET")
          throw Error(
            "Fixture rejects external effects: " + method + " " + route,
          );
        return original(event, method, route, body);
      });
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("nakama:event", { type: "fixture" });
    });
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Assistant", exact: true })
      .click();
    const viewport = page.locator(".chat-messages");
    await expect(page.locator('[data-message-id="m54"]')).toBeVisible();
    const latest = () => page.getByRole("button", { name: /^Latest/ });
    assert.ok(
      await viewport.evaluate((n) => n.scrollHeight > n.clientHeight + 500),
      "Fixture conversation must actually overflow",
    );
    await viewport.evaluate((n) => {
      n.scrollTop = 0;
      n.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(latest()).toHaveText("Latest message");
    const first = page.locator('[data-message-id="m0"]');
    await first.getByRole("button").click();
    await expect(first.locator(".message-exact-time")).toHaveAttribute(
      "datetime",
      /T/,
    );
    await first.getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(first.locator(".message-exact-time")).toHaveCount(0);
    checks.push("Message timestamps work by click and keyboard");
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__chatFixture.messages.push({
        id: "incoming",
        chatId: "current",
        role: "assistant",
        content: "New synthetic incoming message",
        createdAt: new Date().toISOString(),
        deliveryDeviceId: "desktop",
      });
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("nakama:event", { type: "fixture" });
    });
    await expect(latest()).toHaveText("Latest · 1 unread");
    assert.ok(
      await viewport.evaluate((n) => n.scrollTop < 50),
      "Incoming reply changed reading position",
    );
    const buttonBox = await latest().boundingBox(),
      viewBox = await viewport.boundingBox();
    assert.ok(
      buttonBox.x < viewBox.x + 50 &&
        buttonBox.y > viewBox.y + viewBox.height - 80,
      "Latest must be bottom left",
    );
    checks.push(
      "Incoming replies preserve position and expose a bottom-left unread jump",
    );
    await latest().click();
    await expect(latest()).toHaveCount(0);
    assert.ok(
      await viewport.evaluate(
        (n) => n.scrollHeight - n.scrollTop - n.clientHeight < 50,
      ),
    );
    checks.push("Latest jumps to the bottom and clears unread state");
    await viewport.evaluate((n) => {
      n.scrollTop = 0;
      n.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page
      .getByPlaceholder(
        "Ask Nakama anything, or describe what you want to build…",
      )
      .fill("My new synthetic request");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.locator('[data-message-id="submitted"]'),
    ).toBeInViewport();
    assert.ok(await viewport.evaluate((n) => n.scrollTop > 500));
    checks.push(
      "Own submissions become visible even when reading old messages",
    );
    await page.screenshot({
      path: path.join(profile, "chat-timestamps.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Complete chat", exact: true })
      .click();
    await expect(page.locator('[data-message-id="submitted"]')).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Complete chat", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Chat history", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Chat history" });
    await expect(
      dialog.getByRole("button", { name: /Synthetic saved summary/ }),
    ).toBeVisible();
    await dialog
      .getByLabel("Search saved conversations")
      .fill("original message");
    await expect
      .poll(async () =>
        app.evaluate(() =>
          globalThis.__chatFixture.calls.some(
            (c) => c.route === "/api/chats?q=original%20message",
          ),
        ),
      )
      .toBe(true);
    await dialog
      .getByRole("button", { name: /Synthetic saved summary/ })
      .click();
    await dialog
      .getByRole("button", { name: "Archived synthetic original message" })
      .click();
    await expect(dialog.locator("time")).toHaveCount(1);
    await page.screenshot({
      path: path.join(profile, "chat-history.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    checks.push(
      "Completed chats leave the current view and retain searchable timestamped originals",
    );
    await page
      .getByLabel("Conversation project")
      .selectOption("fixture-project");
    await expect(
      page.getByText("Unfinished synthetic workflow", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Finished synthetic workflow", { exact: true }),
    ).toHaveCount(0);
    checks.push(
      "Finished project chat panels hide while unanswered work remains visible",
    );
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Agent office", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Open screen for Working fixture agent",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Open screen for Finished fixture manager",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Including history/ }).click();
    await expect(
      page.getByRole("button", {
        name: "Open screen for Finished fixture manager",
        exact: true,
      }),
    ).toBeVisible();
    checks.push(
      "Completed agent desks stay hidden until explicit history selection",
    );
    if (process.env.NAKAMA_CAPTURE_DOCS === "1") {
      const captures = path.join(root, "docs", "images");
      await fs.mkdir(captures, { recursive: true });
      await app.evaluate(({ BrowserWindow }) => {
        const f = globalThis.__chatFixture,
          stamp = "2026-10-03T08:15:00Z";
        const message = (id, role, content) => ({
          id,
          role,
          content,
          createdAt: stamp,
          deliveryDeviceId: "desktop",
          chatId: "current",
        });
        f.chat = {
          ...f.chat,
          status: "active",
          canComplete: true,
          messageCount: 4,
          summary: "Demo: a morning plan, a phone alarm, and a project idea.",
        };
        const messages = [
          message("demo-1", "user", "Help me plan a calmer morning."),
          message(
            "demo-2",
            "assistant",
            "Start with a little space: a glass of water, breakfast, and ten quiet minutes before your first meeting.",
          ),
          message(
            "demo-3",
            "user",
            "I would like a 7 am alarm on my phone, then time to work on my garden planner.",
          ),
          message(
            "demo-4",
            "assistant",
            "Demo conversation: an alarm belongs to the device you choose. Your project work and saved chats stay available from this Control Center.",
          ),
        ];
        f.demo = {
          archive: messages,
          state: {
            messages,
            projects: [
              {
                id: "garden",
                name: "Garden planner",
                description: "A small project for seasonal planting ideas",
                status: "ready",
                updatedAt: stamp,
                path: "C:\\Demo\\Garden planner",
              },
            ],
            projectWorkflows: [],
            tasks: [],
            devices: [],
            hostEndpoints: [],
            agentOffice: {
              version: 1,
              agents: [
                {
                  id: "lead",
                  name: "Demo project manager",
                  status: "running",
                  role: "manager",
                  providerId: "codex",
                  sourceKind: "workflow",
                  title: "Plan the garden notebook",
                  createdAt: stamp,
                },
                {
                  id: "builder",
                  parentId: "lead",
                  name: "Demo developer",
                  status: "running",
                  role: "worker",
                  providerId: "codex",
                  sourceKind: "task",
                  title: "Build the planting calendar",
                  createdAt: stamp,
                },
                {
                  id: "reviewer",
                  parentId: "lead",
                  name: "Demo reviewer",
                  status: "queued",
                  role: "reviewer",
                  providerId: "claude",
                  sourceKind: "task",
                  title: "Review the project plan",
                  createdAt: stamp,
                },
              ],
            },
          },
        };
        for (const win of BrowserWindow.getAllWindows()) {
          win.setSize(1440, 1040);
          win.webContents.send("nakama:event", { type: "fixture" });
        }
      });
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await nav.getByRole("button", { name: "Assistant", exact: true }).click();
      await expect(page.locator('[data-message-id="demo-4"]')).toBeVisible();
      await page
        .locator('[data-message-id="demo-4"]')
        .getByRole("button")
        .click();
      await page.screenshot({
        path: path.join(captures, "windows-assistant.png"),
      });
      await page
        .getByRole("button", { name: "Chat history", exact: true })
        .click();
      const history = page.getByRole("dialog", { name: "Chat history" });
      await history
        .getByRole("button", { name: /Demo: a morning plan/ })
        .click();
      await expect(
        history.getByRole("button", { name: "Help me plan a calmer morning." }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(captures, "windows-chat-history.png"),
      });
      await history.getByRole("button", { name: "Close dialog" }).click();
      await nav
        .getByRole("button", { name: "Agent office", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Open screen for Demo project manager",
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(captures, "windows-agent-office.png"),
        fullPage: true,
      });
      await nav.getByRole("button", { name: "Devices", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Use Nakama away from home" }),
      ).toBeVisible();
      await expect(
        page.getByText("https://100.100.20.30:43110", { exact: true }).first(),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(captures, "windows-private-connection.png"),
      });
      await nav.getByRole("button", { name: "Projects", exact: true }).click();
      await page
        .getByRole("button", { name: "Import existing folder", exact: true })
        .click();
      const imported = page.getByRole("dialog", {
        name: "Import an existing project",
      });
      await imported
        .getByRole("button", { name: "Garden planner →", exact: true })
        .click();
      await expect(
        imported.getByText("Claude · GPT / Codex · Git", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(captures, "windows-project-import.png"),
      });
      await imported.getByRole("button", { name: "Close dialog" }).click();
    }
    const settingsNav = page.getByRole("navigation", { name: "Main navigation" });
    await settingsNav.getByRole("button", { name: "Settings", exact: true }).click();
    const connectionMode = page.getByLabel("Allow paired devices over a private network", { exact: true });
    await connectionMode.selectOption("vpn");
    await expect(connectionMode).toHaveValue("vpn");
    await connectionMode.selectOption("local");
    await expect(connectionMode).toHaveValue("local");
    const settingsCalls = await app.evaluate(() => globalThis.__chatFixture.calls.filter(c => c.method === "PATCH"));
    assert.deepEqual(settingsCalls.map(c => c.body), [{ vpnOnly: true, allowLan: false }, { vpnOnly: false, allowLan: false }]);
    checks.push("VPN-only mode and return to local-only preserve exact listener settings");
    await app.evaluate(() => { globalThis.__chatFixture.vpnName = "Carrier CGNAT (not Tailscale)"; });
    await settingsNav.getByRole("button", { name: "Devices", exact: true }).click();
    await expect(page.getByRole("button", { name: "Use VPN-only access", exact: true })).toBeDisabled();
    checks.push("An unrelated CGNAT adapter cannot enable the Tailscale guide");
    await app.evaluate(({ BrowserWindow }) => {
      const now = new Date().toISOString();
      globalThis.__chatFixture.credits = {
        sound: { id:"clip", name:"Demo birds", durationMs:3000, sourceTitle:"File:Demo birds.ogg", sourceUrl:"https://commons.wikimedia.org/wiki/File:Demo_birds.ogg", license:"CC BY 4.0", attribution:"Demo artist" },
        routine: { id:"alarm", title:"Demo custom alarm", kind:"alarm", time:"07:00", timeZone:"Europe/London", weekdays:[], scheduledDate:"2099-10-03", enabled:true, targetDeviceIds:["phone"], createdAt:now, updatedAt:now, soundId:"clip" }
      };
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send("nakama:event", {type:"fixture"});
    });
    await settingsNav.getByRole("button", { name: "My clipboard", exact: true }).click();
    await page.getByRole("tab", { name: /Routines board/ }).click();
    const credit = page.getByLabel("Alarm sound credit", { exact: true });
    await expect(credit).toContainText("Demo artist · CC BY 4.0");
    await expect(credit).toContainText("Clipped and converted to mono WAV by Nakama");
    await expect(credit.getByRole("button", {name:"Sound source and license"})).toBeVisible();
    checks.push("Custom alarm credits expose source, author, license and clip modification");
    const calls = await app.evaluate(() =>
      globalThis.__chatFixture.calls.filter((c) => c.method !== "GET"),
    );
    assert.deepEqual(
      calls.map((c) => c.route),
      ["/api/chat", "/api/chats/current/complete", "/api/settings", "/api/settings"],
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        { passed: true, checks, providerCalls: 0, physicalDevices: 0, profile },
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
