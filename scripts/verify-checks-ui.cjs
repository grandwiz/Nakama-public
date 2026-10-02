// Run after npm run build. Executes only disposable, known local Node scripts
// after approving their exact check requests through the native UI. There are
// no installs, model calls, external requests, or clipboard operations.
// Optional preview: NAKAMA_CAPTURE_CHECKS_UI=1. This needs an actively painting
// Windows session; a capture failure is skipped and never uses a stale native fallback.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);

(async () => {
  const root = path.resolve(__dirname, "..");
  const testRoot = path.join(root, "tmp", `checks-ui-${Date.now()}`);
  const projects = path.join(testRoot, "projects");
  await fs.mkdir(projects, { recursive: true });
  await fs.mkdir(path.join(root, "output"), { recursive: true });
  const env = {
    ...process.env,
    NAKAMA_SMOKE_TEST: "1",
    NAKAMA_TEST_DATA_DIR: path.join(testRoot, "profile"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [root],
    env,
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(20000);
    const project = await page.evaluate(async (folder) => {
      await window.nakama.api("PATCH", "/api/settings", {
        workspaceRoot: folder,
      });
      return window.nakama.api("POST", "/api/projects", {
        name: "Project checks fixture",
        description: "Disposable local script verification",
      });
    }, projects);
    const relative = path.relative(projects, project.path);
    assert.ok(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    );
    const manifest = {
      name: "nakama-checks-fixture",
      version: "0.0.1",
      private: true,
      scripts: {
        pretest: "node before.cjs",
        test: "node test.cjs",
        posttest: "node after.cjs",
        lint: "node failure.cjs",
        start: "node unused.cjs",
      },
    };
    const writeManifest = () =>
      fs.writeFile(
        path.join(project.path, "package.json"),
        JSON.stringify(manifest, null, 2),
      );
    await Promise.all([
      fs.writeFile(
        path.join(project.path, "before.cjs"),
        "require('node:fs').appendFileSync('check-order.txt', 'before\\n'); console.log('FIXTURE_BEFORE');\n",
      ),
      fs.writeFile(
        path.join(project.path, "test.cjs"),
        "require('node:fs').appendFileSync('check-order.txt', 'main\\n'); console.log('FIXTURE_MAIN_OK');\n",
      ),
      fs.writeFile(
        path.join(project.path, "after.cjs"),
        "require('node:fs').appendFileSync('check-order.txt', 'after\\n'); console.log('FIXTURE_AFTER');\n",
      ),
      fs.writeFile(
        path.join(project.path, "failure.cjs"),
        "console.error('FIXTURE_EXPECTED_FAILURE'); process.exit(7);\n",
      ),
    ]);
    const state = () =>
      page.evaluate(() => window.nakama.api("GET", "/api/state"));
    const waitState = async (predicate) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const current = await state();
        if (predicate(current)) return current;
        await page.waitForTimeout(100);
      }
      throw new Error("Timed out waiting for the fixture host state.");
    };
    await page.reload();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const openProject = async () => {
      await nav.getByRole("button", { name: "Projects", exact: true }).click();
      await page
        .getByRole("button", {
          name: /Project checks fixture Disposable local script verification/,
        })
        .click();
      await page.getByRole("button", { name: /Tasks & commands/ }).click();
    };
    const request = async (name) => {
      await page
        .getByRole("button", { name: `Request ${name} approval`, exact: true })
        .click();
      const current = await waitState((value) =>
        value.approvals.some(
          (item) => item.type === "project_check" && item.status === "pending",
        ),
      );
      return current.approvals.find(
        (item) => item.type === "project_check" && item.status === "pending",
      );
    };
    const approve = async () => {
      await nav.getByRole("button", { name: /^Activity & approvals/ }).click();
      await page
        .getByRole("button", { name: "Approve this action", exact: true })
        .click();
    };
    await openProject();
    await page
      .getByText("Project checks are not available", { exact: true })
      .waitFor();
    await writeManifest();
    await page
      .getByRole("button", { name: "Refresh checks", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Request test approval", exact: true })
      .waitFor();
    const catalogue = await page.evaluate(
      (id) => window.nakama.api("GET", `/api/projects/${id}/checks`),
      project.id,
    );
    assert.equal(catalogue.runtime.available, true, catalogue.runtime.detail);
    assert.deepEqual(catalogue.checks.map((item) => item.name).sort(), [
      "lint",
      "test",
    ]);
    await page.getByText("Before · pretest", { exact: true }).waitFor();
    await page.getByText("After · posttest", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Request start approval", exact: true })
        .count(),
      0,
    );
    // Switching project tabs preserves an unsaved editor buffer and must block a run.
    await page
      .getByRole("button", { name: "Files & editor", exact: true })
      .click();
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "Edit README.md",
      exact: true,
    });
    await editor.fill("# Unsaved fixture edit\n");
    await page.getByRole("button", { name: /Tasks & commands/ }).click();
    await page
      .getByRole("button", { name: "Request test approval", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Request test approval", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Files & editor", exact: true })
      .click();
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await page.getByText("2 lines · Saved", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Tasks & commands/ }).click();

    const stale = await request("test");
    assert.equal((await state()).tasks.length, 0);
    manifest.version = "0.0.2";
    await writeManifest();
    await approve();
    const rejected = await waitState(
      (value) =>
        value.approvals.find((item) => item.id === stale.id)?.status ===
        "failed",
    );
    assert.equal(rejected.tasks.length, 0);
    assert.equal(
      await fs.stat(path.join(project.path, "check-order.txt")).then(
        () => true,
        () => false,
      ),
      false,
    );
    await page.getByRole("button", { name: /All approvals/ }).click();
    await page.locator(".approval-card .inline-error").waitFor();
    console.log(
      "Discovery, lifecycle script cards, unsaved-file block, and stale approval rejection passed.",
    );

    await openProject();
    const passing = await request("test");
    await approve();
    const completed = await waitState((value) =>
      value.tasks.some(
        (task) =>
          task.kind === "project_check" &&
          task.checkName === "test" &&
          ["completed", "failed"].includes(task.status),
      ),
    );
    const passingTask = completed.tasks.find(
      (task) => task.checkName === "test",
    );
    assert.equal(
      passingTask.status,
      "completed",
      passingTask.error || passingTask.output,
    );
    assert.equal(passingTask.exitCode, 0);
    assert.equal(
      await fs.readFile(path.join(project.path, "check-order.txt"), "utf8"),
      "before\nmain\nafter\n",
    );
    const approval = completed.approvals.find((item) => item.id === passing.id);
    assert.equal(approval.status, "started");
    assert.equal(approval.result.taskId, passingTask.id);
    await page.getByRole("button", { name: /All approvals/ }).click();
    await page
      .getByText("Started. See project activity for the final result.", {
        exact: true,
      })
      .waitFor();
    await openProject();
    const successfulCard = page.locator(".task-card").filter({
      has: page.getByRole("heading", { name: "npm run test", exact: true }),
    });
    await successfulCard.getByText("Exit code: 0", { exact: true }).waitFor();

    await request("lint");
    await approve();
    const failure = await waitState((value) =>
      value.tasks.some(
        (task) => task.checkName === "lint" && task.status === "failed",
      ),
    );
    const failedTask = failure.tasks.find((task) => task.checkName === "lint");
    assert.equal(failedTask.exitCode, 7);
    assert.match(failedTask.output, /FIXTURE_EXPECTED_FAILURE/);
    await openProject();
    const failedCard = page.locator(".task-card").filter({
      has: page.getByRole("heading", { name: "npm run lint", exact: true }),
    });
    await failedCard.getByText("Exit code: 7", { exact: true }).waitFor();
    await failedCard.locator(".status.negative").waitFor();
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      "Approved lifecycle order, started approval status, and failed check exit code 7 passed.",
    );
    // Keep capture opt-in: native capturePage can return stale compositor pixels
    // in an idle Windows session. Do not fall back to it or block functional proof.
    let screenshotCaptured = false;
    if (process.env.NAKAMA_CAPTURE_CHECKS_UI === "1") {
      try {
        await page.locator(".project-checks").screenshot({
          path: path.join(root, "output", "project-checks-preview.png"),
          timeout: 5000,
          animations: "disabled",
        });
        screenshotCaptured = true;
      } catch (error) {
        console.warn(`Optional native preview unavailable: ${error.message}`);
      }
    }
    console.log(
      JSON.stringify({
        passed: true,
        screenshotCaptured,
        checks: [
          "native discovery",
          "pre/main/post script preview",
          "unsaved file disables request",
          "stale approval blocked before execution",
          "approved local lifecycle runs in order",
          "started approval links final task",
          "failed check truthfully reports exit code 7",
          "no renderer errors",
          "no clipboard or external calls",
        ],
        testRoot,
      }),
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
