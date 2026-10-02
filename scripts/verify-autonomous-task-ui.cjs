// Isolated native UI fixture. Every autonomous operation is intercepted: no
// inference, browser capture, account lookup, command or provider write occurs.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  path.join(
    require("node:os").homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = path.join(root, "tmp", "autonomous-task-ui-" + Date.now());
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = path.join(profile, "projects");
  state.projects.push({
    id: "task-ui-project",
    name: "Fixture project",
    path: path.join(state.config.workspaceRoot, "fixture"),
    status: "ready",
    updatedAt: new Date().toISOString(),
  });
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
  const deadline = setTimeout(() => app.process().kill(), 150000);
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (failure) => errors.push(failure.message));
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.waitFor().catch(async (failure) => {
      console.error("Initial renderer errors:", errors);
      console.error(
        "Initial renderer text:",
        await page
          .locator("body")
          .innerText()
          .catch(() => "unavailable"),
      );
      throw failure;
    });
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("nakama:api");
      const fixture = {
        calls: [],
        blocked: [],
        failStart: true,
        failAnswer: true,
        runs: [
          {
            id: "paused",
            goal: "Resume the interrupted fixture",
            detail: "Independent completion verification is still required.",
            status: "interrupted",
            revision: 4,
            step: 2,
            maxSteps: 30,
            questions: [],
            receipts: [
              {
                id: "read",
                tool: "project_read",
                status: "completed",
                summary: "Read synthetic project text",
                verification: {
                  verified: false,
                  summary: "No acceptance claim",
                },
              },
              {
                id: "observation",
                tool: "project_read",
                status: "completed",
                summary: "Observed saved fixture text",
                verification: {
                  verified: true,
                  summary: "Read observed; goal remains unverified",
                },
              },
            ],
          },
          {
            id: "question",
            goal: "Inspect the fixture project",
            status: "awaiting_answers",
            revision: 2,
            step: 1,
            questions: [
              { id: "scope", question: "Which local result matters?" },
            ],
            receipts: [],
          },
        ],
      };
      globalThis.__autonomousUiFixture = fixture;
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        if (method === "GET" && route === "/api/state") {
          const state = await original(event, method, route, body);
          state.approvals = [
            {
              id: "task-ui-approval",
              type: "project_check",
              title: "Fixture exact check approval",
              status: "pending",
              description: "Synthetic only; no command is started",
              createdAt: new Date().toISOString(),
            },
          ];
          return state;
        }
        if (method === "GET" && route === "/api/autonomous-tasks")
          return {
            runs: structuredClone(fixture.runs),
            capabilities: {
              tools: [{ name: "project_read", tool: "project_read" }],
              limits:
                "Fixture scope: project reads. No unrestricted device or account control.",
            },
          };
        if (method === "POST" && route.startsWith("/api/autonomous-tasks")) {
          fixture.calls.push({ route, body: structuredClone(body) });
          if (route === "/api/autonomous-tasks") {
            if (fixture.failStart) {
              fixture.failStart = false;
              throw new Error("Simulated start failure");
            }
            fixture.runs.push({
              id: "new-run",
              goal: body.goal,
              projectId: body.projectId,
              status: "running",
              stage: "thinking",
              revision: 1,
              step: 1,
              receipts: [],
            });
          } else if (route === "/api/autonomous-tasks/question/answers") {
            if (fixture.failAnswer) {
              fixture.failAnswer = false;
              throw new Error("Simulated answer failure");
            }
            Object.assign(
              fixture.runs.find((run) => run.id === "question"),
              {
                status: "awaiting_approval",
                approvalId: "task-ui-approval",
                questions: [],
              },
            );
          } else if (route === "/api/autonomous-tasks/new-run/stop")
            fixture.runs.find((run) => run.id === "new-run").status = "stopped";
          else if (route === "/api/autonomous-tasks/paused/resume")
            fixture.runs.find((run) => run.id === "paused").status = "running";
          else throw new Error("Unexpected autonomous mutation: " + route);
          return { saved: true };
        }
        fixture.blocked.push({ method, route });
        throw new Error("Unexpected route blocked: " + route);
      });
    });
    await page.reload();
    await nav
      .getByRole("button", { name: "My clipboard", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Autonomous tasks", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Autonomous tasks",
      exact: true,
    });
    const goal = panel.getByRole("textbox", { name: "Task goal", exact: true });
    await expect(panel).toContainText(
      "No unrestricted device or account control",
    );
    await goal.fill("  Check the synthetic project  ");
    await panel
      .getByRole("combobox", { name: "Project context", exact: true })
      .selectOption("task-ui-project");
    await page.evaluate(() => {
      window.confirm = () => false;
    });
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(goal).toHaveValue("  Check the synthetic project  ");
    await page.getByRole("tab", { name: /^Routines board/ }).click();
    await expect(goal).toHaveValue("  Check the synthetic project  ");
    const start = panel.getByRole("button", {
      name: "Start autonomous task",
      exact: true,
    });
    await start.click();
    await expect(panel).toContainText("Simulated start failure");
    await expect(goal).toHaveValue("  Check the synthetic project  ");
    await start.click();
    await expect(goal).toHaveValue("");
    const created = page.getByRole("article", {
      name: "Autonomous task: Check the synthetic project",
      exact: true,
    });
    await created
      .getByRole("button", { name: "Stop autonomous task", exact: true })
      .click();
    await expect(created).toContainText("stopped");
    const question = page.getByRole("article", {
      name: "Autonomous task: Inspect the fixture project",
      exact: true,
    });
    const answer = question.getByRole("textbox", {
      name: "Which local result matters?",
      exact: true,
    });
    const send = question.getByRole("button", {
      name: "Send task answers",
      exact: true,
    });
    await expect(send).toBeDisabled();
    await answer.fill("  A verified local result  ");
    await send.click();
    await expect(panel).toContainText("Simulated answer failure");
    // A successful background refresh must not erase the failed action notice.
    await page.waitForTimeout(6500);
    await expect(panel).toContainText("Simulated answer failure");
    await expect(answer).toHaveValue("  A verified local result  ");
    await app.evaluate(() => {
      globalThis.__autonomousUiFixture.runs.find(
        (run) => run.id === "question",
      ).revision = 3;
    });
    await panel
      .getByRole("button", { name: "Refresh task progress", exact: true })
      .click();
    await expect(question).toContainText("This task changed elsewhere");
    await expect(send).toBeDisabled();
    await expect(answer).toHaveValue("  A verified local result  ");
    await page.evaluate(() => {
      window.confirm = () => true;
    });
    await question
      .getByRole("button", { name: "Reload saved questions", exact: true })
      .click();
    await answer.fill("A verified local result");
    await send.click();
    await question
      .getByRole("button", {
        name: "Review task approval on this PC",
        exact: true,
      })
      .click();
    await expect(page.locator(".focused-approval")).toContainText(
      "Fixture exact check approval",
    );
    await nav
      .getByRole("button", { name: "My clipboard", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Autonomous tasks", exact: true })
      .click();
    const paused = page.getByRole("article", {
      name: "Autonomous task: Resume the interrupted fixture",
      exact: true,
    });
    await paused
      .getByText("Recorded task actions (2)", { exact: true })
      .click();
    await expect(paused).toContainText(
      "Verification unresolved: No acceptance claim",
    );
    await expect(paused).toContainText(
      "Independent completion verification is still required.",
    );
    await expect(paused).toContainText(
      "Observation checked: Read observed; goal remains unverified",
    );
    await paused
      .getByRole("button", { name: "Resume task", exact: true })
      .click();
    await expect(
      paused.getByRole("button", { name: "Resume task", exact: true }),
    ).toHaveCount(0);
    const result = await app.evaluate(() => globalThis.__autonomousUiFixture);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      result.calls.find((call) => call.route === "/api/autonomous-tasks").body,
      { goal: "Check the synthetic project", projectId: "task-ui-project" },
    );
    assert.deepEqual(
      result.calls.filter((call) => call.route.endsWith("/answers")).at(-1)
        .body,
      {
        revision: 3,
        answers: [{ id: "scope", answer: "A verified local result" }],
      },
    );
    assert.deepEqual(
      result.calls.find((call) => call.route.endsWith("/resume")).body,
      { revision: 4 },
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks: [
            "Goal and answer drafts survive failed requests and declined navigation",
            "Stale revision disables answers without discarding drafts",
            "Start sends exact optional project; answers/resume send exact revision",
            "Stop and resume reflect saved status",
            "Approval opens exact PC request without approving",
            "Action receipts distinguish unresolved verification",
          ],
          providerCalls: 0,
          browserCaptures: 0,
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
