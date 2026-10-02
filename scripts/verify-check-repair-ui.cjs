// Run after npm run build. Native Electron renderer with an isolated profile.
// Repair POST/Stop and provider metadata are intercepted: no model, account,
// command, check, approval resolution, external action or clipboard access runs.
// window.confirm is fixture-stubbed, not a test of the Windows dialog itself.
// Optional NAKAMA_CAPTURE_REPAIR_UI=1 saves only a fresh Playwright screenshot.
// NAKAMA_REPAIR_CAPTURE_ONLY=1 stages the mocked result without repeating tests.
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
  const testRoot = path.join(root, "tmp", "check-repair-ui-" + Date.now());
  const profile = path.join(testRoot, "profile");
  const workspace = path.join(testRoot, "projects");
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = workspace;
  state.projects = ["Repair fixture", "Other fixture"].map((name, index) => ({
    id: "repair-project-" + index,
    name,
    description: "Disposable repair UI verification",
    path: path.join(workspace, "project-" + index),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
  }));
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  for (const project of state.projects) {
    await fs.mkdir(project.path, { recursive: true });
    await fs.writeFile(
      path.join(project.path, "README.md"),
      "# Fixture only\n",
    );
  }
  await fs.writeFile(
    path.join(profile, "private", "state.json"),
    JSON.stringify(state),
  );
  const project = state.projects[0];
  const task = (id, status, extra = {}) => ({
    id,
    title: id,
    projectId: project.id,
    kind: "project_check",
    checkName: "test",
    providerId: "local",
    status,
    exitCode: 7,
    manifestHash: "a".repeat(64),
    createdAt: new Date().toISOString(),
    output: "Fixture result: " + id,
    ...extra,
  });
  const tasks = [
    task("Failed test fixture", "failed"),
    task("Startup failure", "failed", { exitCode: null }),
    task("Previously passed", "completed", { exitCode: 0 }),
    task("Ordinary command", "failed", { kind: "command" }),
    task("Foreign failed check", "failed", { projectId: state.projects[1].id }),
  ];
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
    console.error("Repair fixture exceeded its own 150-second deadline.");
    app.process().kill();
  }, 150000);
  let screenshotCaptured = false;
  const captureOnly = process.env.NAKAMA_REPAIR_CAPTURE_ONLY === "1";
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("dialog", (dialog) => void dialog.accept().catch(() => {}));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
    console.log("Native repair fixture ready.");
    await app.evaluate(
      ({ BrowserWindow, ipcMain }, fixture) => {
        const original = ipcMain._invokeHandlers?.get("nakama:api");
        if (typeof original !== "function")
          throw new Error("Cannot safely intercept fixture API.");
        const data = {
          calls: [],
          bodies: [],
          repairs: [],
          approvals: [],
          tasks: fixture.tasks,
          failNext: false,
          releaseStart: null,
        };
        globalThis.__nakamaRepairFixture = data;
        ipcMain.removeHandler("nakama:api");
        ipcMain.handle("nakama:api", async (event, method, route, body) => {
          data.calls.push({ method, route });
          if (
            method === "POST" &&
            route === "/api/projects/repair-project-0/check-repairs"
          ) {
            data.bodies.push(JSON.parse(JSON.stringify(body)));
            if (data.failNext) {
              data.failNext = false;
              throw new Error("Fixture connection broke after submission.");
            }
            await new Promise((resolve) => {
              data.releaseStart = resolve;
            });
            const repair = {
              id: "repair-fixture",
              projectId: "repair-project-0",
              sourceTaskId: body.sourceTaskId,
              checkName: "test",
              providerId: body.providerId,
              model: body.model,
              effort: body.effort,
              requestedBy: "desktop",
              status: "building",
              attempts: 1,
              maxAttempts: 1,
              buildTaskId: "repair-build",
              approvalId: null,
              checkTaskId: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              detail:
                "One file-repair attempt is in progress. No check has been run.",
            };
            data.repairs = [repair];
            data.tasks.push({
              id: "repair-build",
              projectId: repair.projectId,
              title: "Repair files",
              kind: "agent",
              providerId: body.providerId,
              status: "running",
              createdAt: repair.createdAt,
              output: "Reviewing the fixture failure.",
            });
            return repair;
          }
          if (
            method === "POST" &&
            route === "/api/check-repairs/repair-fixture/stop"
          ) {
            Object.assign(data.repairs[0], {
              status: "stopped",
              detail: "Stopped. Files already saved remain in the project.",
            });
            return data.repairs[0];
          }
          if (method !== "GET")
            throw new Error("Fixture blocks all other mutations.");
          const result = await original(event, method, route, body);
          if (route === "/api/state")
            return {
              ...result,
              tasks: data.tasks,
              checkRepairs: data.repairs,
              approvals: data.approvals,
              providers: result.providers.map((provider) => ({
                ...provider,
                status: "configured",
                detail:
                  "Disposable provider metadata; no account call will run.",
                selectedModel: "fixture-model",
                models: ["fixture-model"],
                modelDetails: [
                  {
                    id: "fixture-model",
                    efforts: ["low", "high", "ultra"],
                    defaultEffort: "high",
                  },
                ],
              })),
            };
          return result;
        });
        BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
          false,
        );
        BrowserWindow.getAllWindows()[0].webContents.send("nakama:event", {
          type: "fixture.ready",
        });
      },
      { tasks },
    );
    await page.evaluate(() => {
      window.__repairConfirms = [];
      window.confirm = (message) => {
        window.__repairConfirms.push(message);
        return false;
      };
    });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const openProject = async () => {
      await nav.getByRole("button", { name: "Projects", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Repair fixture Disposable repair UI verification",
          exact: true,
        })
        .click();
    };
    const openTasks = () =>
      page.getByRole("button", { name: /Tasks & commands/ }).click();
    const openFiles = () =>
      page.getByRole("button", { name: "Files & editor", exact: true }).click();
    const repairButton = page.getByRole("button", {
      name: "Repair this failed check",
      exact: true,
    });
    const dialog = page.getByRole("dialog", {
      name: "Repair this failed check",
      exact: true,
    });
    const repairs = page.getByRole("region", {
      name: "Check repairs",
      exact: true,
    });
    const editor = page.getByRole("textbox", {
      name: "Edit README.md",
      exact: true,
    });
    const calls = () =>
      app.evaluate(() => globalThis.__nakamaRepairFixture.calls);
    const stage = async (status, checkStatus, exitCode) => {
      await app.evaluate(
        ({ BrowserWindow }, next) => {
          const data = globalThis.__nakamaRepairFixture;
          Object.assign(data.repairs[0], {
            status: next.status,
            approvalId: "exact-rerun-approval",
            detail:
              next.status === "awaiting_approval"
                ? "File repair is recorded. Review the fresh approval before the same test runs."
                : "Fixture stage: " + next.status,
            checkTaskId: next.checkStatus ? "new-repair-check" : null,
          });
          const build = data.tasks.find((item) => item.id === "repair-build");
          Object.assign(build, {
            status: "completed",
            output:
              "Saved README.md. File changes do not prove the test passes.",
          });
          data.approvals = ["unrelated-approval", "exact-rerun-approval"].map(
            (id) => ({
              id,
              type: "project_check",
              title:
                id === "exact-rerun-approval"
                  ? "Rerun fixture test after repair"
                  : "Unrelated check",
              description: "Disposable fixture only. No command will run.",
              status: next.checkStatus ? "started" : "pending",
              requestedBy: "desktop",
              createdAt: new Date().toISOString(),
            }),
          );
          data.tasks = data.tasks.filter(
            (item) => item.id !== "new-repair-check",
          );
          if (next.checkStatus)
            data.tasks.push({
              id: "new-repair-check",
              projectId: "repair-project-0",
              kind: "project_check",
              checkName: "test",
              title: "New repair check",
              providerId: "local",
              status: next.checkStatus,
              exitCode: next.exitCode,
              createdAt: new Date().toISOString(),
              output:
                "New fixture check result, separate from original failure.",
            });
          BrowserWindow.getAllWindows()[0].webContents.send("nakama:event", {
            type: "fixture.stage",
          });
        },
        { status, checkStatus, exitCode },
      );
    };
    if (!captureOnly) {
      await openProject();
      await page
        .getByRole("button", { name: "README.md", exact: true })
        .click();
      await expect(editor).toHaveValue("# Fixture only\n");
      await editor.fill("UNSAVED_FIXTURE");
      await openTasks();
      await expect(repairButton).toHaveCount(1);
      await expect(repairButton).toBeDisabled();
      await openFiles();
      await editor.fill("# Fixture only\n");
      await openTasks();
      await repairButton.click();
      console.log(
        "Dirty editor gating passed; checking dialog focus and Escape.",
      );
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Start one repair", exact: true }),
      ).toBeDisabled();
      assert.equal(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        true,
        "Opening the named dialog moves focus inside it.",
      );
      await page.keyboard.press("Escape");
      console.log("First Escape delivered.");
      await expect(dialog).toHaveCount(0);
      assert.equal(
        (await calls()).filter((call) => call.method !== "GET").length,
        0,
      );
      await repairButton.click();
      await dialog
        .getByLabel("Repair AI", { exact: true })
        .selectOption("codex");
      console.log("Explicit provider selected.");
      await dialog
        .getByLabel("Repair thinking effort", { exact: true })
        .selectOption("ultra");
      await dialog
        .getByRole("button", { name: "Start one repair", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: "Start one repair", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      const bodies = await app.evaluate(
        () => globalThis.__nakamaRepairFixture.bodies,
      );
      console.log("Held submission did not duplicate or close on Escape.");
      assert.deepEqual(bodies, [
        {
          sourceTaskId: "Failed test fixture",
          providerId: "codex",
          model: "fixture-model",
          effort: "ultra",
        },
      ]);
      await app.evaluate(() => globalThis.__nakamaRepairFixture.releaseStart());
      console.log("Mock repair released.");
      await expect(
        dialog.getByRole("heading", {
          name: "Repairing project files",
          exact: true,
        }),
      ).toBeVisible();
      await dialog
        .getByRole("button", {
          name: "Close and follow project activity",
          exact: true,
        })
        .click();
      await openFiles();
      await expect(editor).toHaveAttribute("readonly", "");
      await expect(
        page.getByRole("button", { name: "Save file", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Reload file", exact: true }),
      ).toBeDisabled();
      // The fixture simulates the repair's file commit using only its disposable file.
      await fs.writeFile(
        path.join(project.path, "README.md"),
        "# Repaired fixture\n",
      );
      await stage("needs_review", "failed", 9);
      await expect(
        page.getByRole("button", { name: "Reload file", exact: true }),
      ).toBeEnabled();
      await expect(editor).toHaveValue("# Fixture only\n");
      await expect(editor).toHaveAttribute("readonly", "");
      await page
        .getByRole("button", { name: "Reload file", exact: true })
        .click();
      await expect(editor).toHaveValue("# Repaired fixture\n");
      await expect(editor).not.toHaveAttribute("readonly", "");
      await openTasks();
      await stage("awaiting_approval");
      console.log("Stale open buffer preserved and explicitly reloaded.");
      await expect(
        repairs.getByRole("heading", {
          name: "Rerun needs desktop approval",
          exact: true,
        }),
      ).toBeVisible();
      await repairs
        .getByRole("button", { name: "Review this approval", exact: true })
        .click();
      await expect(
        page.locator("#approval-exact-rerun-approval"),
      ).toBeFocused();
      await expect(page.locator("#approval-exact-rerun-approval")).toHaveClass(
        /focused-approval/,
      );
      await expect(
        page.locator("#approval-unrelated-approval"),
      ).not.toHaveClass(/focused-approval/);
      assert.equal(
        (await calls()).some((call) => call.route.includes("/resolve")),
        false,
      );
      await openProject();
      await openTasks();
      await stage("checking", "running", null);
      console.log("Exact approval navigation verified.");
      await expect(
        repairs.getByRole("heading", {
          name: "Running the approved check",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        repairs.getByRole("heading", {
          name: "Check passed after repair",
          exact: true,
        }),
      ).toHaveCount(0);
      await stage("needs_review", "failed", 9);
      await expect(
        repairs.getByRole("heading", {
          name: "Needs your review",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        repairs.getByText("New check result · failed · exit 9", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .locator(".task-card")
          .filter({
            has: page.getByRole("heading", {
              name: "Failed test fixture",
              exact: true,
            }),
          })
          .getByText("Exit code: 7", { exact: true }),
      ).toBeVisible();
      await stage("completed", "completed", 0);
      await expect(
        repairs.getByRole("heading", {
          name: "Check passed after repair",
          exact: true,
        }),
      ).toBeVisible();
      await stage("checking", "running", null);
      await repairs
        .getByRole("button", { name: "Stop repair", exact: true })
        .click();
      await expect(
        repairs.getByRole("heading", { name: "Repair stopped", exact: true }),
      ).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const data = globalThis.__nakamaRepairFixture;
        data.repairs = [];
        data.tasks = data.tasks.filter(
          (item) => item.id !== "new-repair-check",
        );
        data.failNext = true;
        BrowserWindow.getAllWindows()[0].webContents.send("nakama:event", {
          type: "fixture.uncertain",
        });
      });
      await expect(repairs).toHaveCount(0);
      await repairButton.click();
      await dialog
        .getByLabel("Repair AI", { exact: true })
        .selectOption("claude");
      await dialog
        .getByRole("button", { name: "Start one repair", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        "Fixture connection broke after submission",
      );
      await expect(
        dialog.getByRole("button", { name: "Start one repair", exact: true }),
      ).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(repairButton).toBeDisabled();
      await expect(
        repairs.getByText("A request could not be confirmed", { exact: true }),
      ).toBeVisible();
      await nav.getByRole("button", { name: "Assistant", exact: true }).click();
      const message = page.getByRole("textbox", {
        name: "Message Nakama",
        exact: true,
      });
      await message.fill("Keep my unsent fixture draft.");
      await nav.getByRole("button", { name: "Projects", exact: true }).click();
      await expect(message).toHaveValue("Keep my unsent fixture draft.");
      assert.ok(
        (await page.evaluate(() => window.__repairConfirms)).some((text) =>
          /unsent/i.test(text),
        ),
      );
      await message.fill("");
    }
    await openProject();
    await openTasks();
    await app.evaluate(({ BrowserWindow }) => {
      const data = globalThis.__nakamaRepairFixture;
      data.repairs = [
        {
          id: "repair-fixture",
          projectId: "repair-project-0",
          sourceTaskId: "Failed test fixture",
          checkName: "test",
          providerId: "codex",
          model: "fixture-model",
          effort: "ultra",
          requestedBy: "desktop",
          status: "awaiting_approval",
          attempts: 1,
          maxAttempts: 1,
          buildTaskId: "repair-build",
          approvalId: "exact-rerun-approval",
          checkTaskId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          detail:
            "One file repair is recorded. Review the fresh approval before running the same test.",
        },
      ];
      data.approvals = data.approvals.map((item) => ({
        ...item,
        status: "pending",
      }));
      if (!data.approvals.length)
        data.approvals = [
          {
            id: "exact-rerun-approval",
            type: "project_check",
            title: "Rerun fixture test after repair",
            description: "Disposable fixture only",
            status: "pending",
            requestedBy: "desktop",
            createdAt: new Date().toISOString(),
          },
        ];
      if (!data.tasks.some((item) => item.id === "repair-build"))
        data.tasks.push({
          id: "repair-build",
          projectId: "repair-project-0",
          kind: "agent",
          title: "Repair files",
          status: "completed",
          providerId: "codex",
          createdAt: new Date().toISOString(),
          output:
            "Saved README.md. File changes do not prove the check passes.",
        });
      BrowserWindow.getAllWindows()[0].webContents.send("nakama:event", {
        type: "fixture.capture",
      });
    });
    await expect(
      repairs.getByRole("heading", {
        name: "Rerun needs desktop approval",
        exact: true,
      }),
    ).toBeVisible();
    if (process.env.NAKAMA_CAPTURE_REPAIR_UI === "1") {
      try {
        await repairs.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(root, "output/desktop-check-repair.png"),
          timeout: 5000,
          animations: "disabled",
        });
        screenshotCaptured = true;
      } catch (error) {
        console.warn(
          "Optional fresh screenshot unavailable: " +
            error.message.split("\n")[0],
        );
      }
    }
    const mutations = (await calls()).filter((call) => call.method !== "GET");
    if (!captureOnly) {
      assert.deepEqual(
        mutations.map((call) => call.route),
        [
          "/api/projects/repair-project-0/check-repairs",
          "/api/check-repairs/repair-fixture/stop",
          "/api/projects/repair-project-0/check-repairs",
        ],
      );
      assert.equal(
        await app.evaluate(
          () => globalThis.__nakamaRepairFixture.bodies.length,
        ),
        2,
      );
      assert.equal(
        await fs.readFile(path.join(project.path, "README.md"), "utf8"),
        "# Repaired fixture\n",
      );
    } else assert.equal(mutations.length, 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        functionalChecksPassed: !captureOnly,
        captureOnly,
        screenshotCaptured,
        testRoot,
        nativeRenderer: true,
        repairAndStopIntercepted: true,
        realModelCalls: 0,
        clipboardChanges: 0,
      }),
    );
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.on("will-prevent-unload", (event) =>
            event.preventDefault(),
          );
      })
      .catch(() => {});
    await app.close();
    clearTimeout(deadline);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
