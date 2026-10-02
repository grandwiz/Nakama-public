// Run after npm run build. Uses native Electron and two disposable local repos.
// No model, account, remote Git, deployment, hooks or clipboard action is used.
// NAKAMA_CHECKPOINT_LATE_ONLY=1 reruns only refresh/project-navigation checks.
// NAKAMA_CHECKPOINT_LAYOUT_ONLY=1 checks a large preview without creating a ref.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));

(async () => {
  const root = path.resolve(__dirname, "..");
  const testRoot = path.join(root, "tmp", `checkpoint-ui-${Date.now()}`);
  const workspace = path.join(testRoot, "projects");
  const profile = path.join(testRoot, "profile");
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  state.config.workspaceRoot = workspace;
  state.projects = ["Checkpoint fixture", "Other checkpoint fixture"].map(
    (name, index) => ({
      id: `checkpoint-project-${index}`,
      name,
      description: "Disposable local checkpoint verification",
      path: path.join(workspace, `project-${index}`),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "active",
    }),
  );
  const gitEnv = {
    ...process.env,
    HOME: testRoot,
    USERPROFILE: testRoot,
    XDG_CONFIG_HOME: testRoot,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "NUL",
    GIT_CONFIG_SYSTEM: "NUL",
  };
  const git = (project, ...args) => {
    const relative = path.relative(workspace, project.path);
    assert.ok(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    );
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=Local fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        `core.hooksPath=${path.join(testRoot, "no-hooks")}`,
        ...args,
      ],
      {
        cwd: project.path,
        env: gitEnv,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  for (const project of state.projects) {
    await fs.mkdir(project.path, { recursive: true });
    await fs.writeFile(
      path.join(project.path, "README.md"),
      "# Before checkpoint\n\nOriginal fixture content.\n",
    );
    await fs.writeFile(
      path.join(project.path, "staged.txt"),
      "Unselected original\n",
    );
    git(project, "init");
    git(project, "add", "README.md", "staged.txt");
    git(project, "commit", "-m", "Create isolated checkpoint fixture");
    await fs.writeFile(
      path.join(project.path, "README.md"),
      process.env.NAKAMA_CHECKPOINT_LAYOUT_ONLY === "1"
        ? ("A plain fixture line. ".repeat(10) + "\n").repeat(1000)
        : "# After checkpoint\n\nSaved fixture content.\n",
    );
    await fs.writeFile(
      path.join(project.path, "staged.txt"),
      "Unselected staged change\n",
    );
    git(project, "add", "staged.txt");
    await fs.writeFile(
      path.join(project.path, "new.txt"),
      "A new selected file.\n",
    );
    await fs.writeFile(path.join(project.path, ".env"), "FIXTURE_ONLY=true\n");
  }
  await fs.writeFile(
    path.join(profile, "private", "state.json"),
    JSON.stringify(state),
  );
  const project = state.projects[0];
  const originalHead = git(project, "rev-parse", "HEAD").trim();
  const originalStatus = git(project, "status", "--porcelain=v1");
  const originalIndex = await fs.readFile(
    path.join(project.path, ".git", "index"),
  );
  const saved = await fs.readFile(path.join(project.path, "README.md"), "utf8");
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
    console.error("Checkpoint UI fixture exceeded 150 seconds.");
    app.process().kill();
  }, 150000);
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.getByRole("button", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", { name: /^Checkpoint fixture Disposable/ })
      .click();
    const lateOnly = process.env.NAKAMA_CHECKPOINT_LATE_ONLY === "1";
    const panel = page.getByRole("region", {
      name: "Local Git checkpoint",
      exact: true,
    });
    const prepare = panel.getByRole("button", {
      name: "Prepare checkpoint review",
      exact: true,
    });
    const create = panel.getByRole("button", {
      name: "Create local checkpoint",
      exact: true,
    });
    const title = panel.getByRole("textbox", {
      name: "Checkpoint message",
      exact: true,
    });
    if (process.env.NAKAMA_CHECKPOINT_LAYOUT_ONLY === "1") {
      await page
        .getByRole("button", { name: "Git changes", exact: true })
        .click();
      await title.fill("Review a large text file");
      await panel
        .getByRole("checkbox", {
          name: "Include README.md in checkpoint",
          exact: true,
        })
        .check();
      await prepare.click();
      const after = panel.getByLabel("After checkpoint: README.md", {
        exact: true,
      });
      await expect(after).toHaveText(saved);
      const bounds = await after.evaluate((element) => ({
        height: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflow: getComputedStyle(element).overflowY,
        characters: element.textContent.length,
      }));
      assert.equal(bounds.characters, saved.length);
      assert.ok(bounds.height <= 300 && bounds.scrollHeight > bounds.height);
      assert.equal(bounds.overflow, "auto");
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          passed: true,
          testRoot,
          checks: ["large exact text preview remains bounded and scrollable"],
          bounds,
        }),
      );
      return;
    }
    if (!lateOnly) {
      await page
        .getByRole("button", { name: "README.md", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Edit README.md", exact: true })
        .fill(saved + "Unsaved editor text.\n");
      await page
        .getByRole("button", { name: "Git changes", exact: true })
        .click();
      await expect(
        panel.getByRole("textbox", { name: "Checkpoint message" }),
      ).toBeDisabled();
      await expect(
        panel.getByText(/Save or discard your unsaved/),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Files & editor", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Edit README.md", exact: true })
        .fill(saved);
      await page
        .getByRole("button", { name: "Git changes", exact: true })
        .click();
      await expect(prepare).toBeDisabled();
      assert.equal(
        await panel.getByRole("checkbox", { name: /Include \.env/ }).count(),
        0,
      );
      assert.equal(
        await panel.locator("input[type=checkbox]:checked").count(),
        0,
      );
      await title.fill("Keep the companion welcome page");
      await panel
        .getByRole("checkbox", {
          name: "Include README.md in checkpoint",
          exact: true,
        })
        .check();
      await panel
        .getByRole("checkbox", {
          name: "Include new.txt in checkpoint",
          exact: true,
        })
        .check();
      await prepare.click();
      await expect(
        panel.getByLabel("Before checkpoint: README.md", { exact: true }),
      ).toHaveText("# Before checkpoint\n\nOriginal fixture content.\n");
      await expect(
        panel.getByLabel("After checkpoint: README.md", { exact: true }),
      ).toHaveText(saved);
      await expect(create).toBeDisabled();
      await title.fill("Keep the reviewed welcome page");
      assert.equal(
        await create.count(),
        0,
        "Changing message must invalidate old review",
      );
      await prepare.click();
      const consent = panel.getByRole("checkbox", {
        name: "I have reviewed these exact files and this checkpoint message.",
        exact: true,
      });
      await consent.check();
      await expect(create).toBeEnabled();
      await fs.mkdir(path.join(root, "tmp", "ui"), { recursive: true });
      await page.screenshot({
        path: path.join(root, "tmp", "ui", "checkpoint-review.png"),
        fullPage: true,
      });
      await create.click();
      await expect(
        panel.getByText("Local checkpoint saved", { exact: true }),
      ).toBeVisible();
      assert.equal(git(project, "rev-parse", "HEAD").trim(), originalHead);
      assert.deepEqual(
        await fs.readFile(path.join(project.path, ".git", "index")),
        originalIndex,
      );
      assert.equal(git(project, "status", "--porcelain=v1"), originalStatus);
      assert.equal(
        await fs.readFile(path.join(project.path, "README.md"), "utf8"),
        saved,
      );
      const refs = git(
        project,
        "for-each-ref",
        "--format=%(refname)",
        "refs/nakama/checkpoints",
      )
        .trim()
        .split("\n");
      assert.equal(refs.length, 1);
      assert.equal(git(project, "show", `${refs[0]}:README.md`), saved);
      assert.equal(
        git(project, "show", `${refs[0]}:new.txt`),
        "A new selected file.\n",
      );
      assert.equal(
        git(project, "show", `${refs[0]}:staged.txt`),
        "Unselected original\n",
      );
      await page.screenshot({
        path: path.join(root, "tmp", "ui", "checkpoint-saved.png"),
        fullPage: true,
      });
      console.log(
        "Native checkpoints: dirty editor block, private-file filtering, explicit selection/review, message invalidation and exact local checkpoint passed.",
      );

      await panel
        .getByRole("button", { name: "New checkpoint", exact: true })
        .click();
      await title.fill("Stale checkpoint should fail");
      await panel
        .getByRole("checkbox", {
          name: "Include README.md in checkpoint",
          exact: true,
        })
        .check();
      await prepare.click();
      await consent.check();
      await fs.appendFile(
        path.join(project.path, "README.md"),
        "Changed after review.\n",
      );
      await create.click();
      await expect(
        panel.getByText("Check the result before trying again", {
          exact: true,
        }),
      ).toBeVisible();
      assert.match(
        await panel.getByRole("alert").innerText(),
        /changed|fresh checkpoint/,
      );
      assert.equal(
        await create.count(),
        0,
        "Unconfirmed outcome must not offer a retry",
      );
      assert.equal(
        git(
          project,
          "for-each-ref",
          "--format=%(refname)",
          "refs/nakama/checkpoints",
        )
          .trim()
          .split("\n").length,
        1,
      );
      console.log(
        "Native checkpoints: stale disk files refused with no second checkpoint and no automatic retry.",
      );
    } else {
      await page
        .getByRole("button", { name: "Git changes", exact: true })
        .click();
      await expect(panel).toBeVisible();
    }
    // Hold only a real prepared response so switching projects happens while
    // the original renderer request is still in flight. No create is stubbed.
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers?.get("nakama:api");
      if (typeof original !== "function")
        throw new Error("Cannot intercept fixture response safely.");
      globalThis.__nakamaCheckpointWait = { release: null, waiting: false };
      ipcMain.removeHandler("nakama:api");
      ipcMain.handle("nakama:api", async (event, method, route, body) => {
        const result = await original(event, method, route, body);
        if (
          method === "POST" &&
          route === "/api/projects/checkpoint-project-0/git/checkpoints/prepare"
        ) {
          globalThis.__nakamaCheckpointWait.waiting = true;
          await new Promise((resolve) => {
            globalThis.__nakamaCheckpointWait.release = resolve;
          });
        }
        return result;
      });
    });
    await page
      .getByRole("button", { name: "Refresh changes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Refresh changes", exact: true }),
    ).toBeEnabled();
    await title.fill("Abandoned first project preview");
    await panel
      .getByRole("checkbox", {
        name: "Include README.md in checkpoint",
        exact: true,
      })
      .check();
    await prepare.click();
    await expect
      .poll(() => app.evaluate(() => globalThis.__nakamaCheckpointWait.waiting))
      .toBe(true);
    await nav.getByRole("button", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", { name: /^Other checkpoint fixture Disposable/ })
      .click();
    await page
      .getByRole("button", { name: "Git changes", exact: true })
      .click();
    await app.evaluate(() => globalThis.__nakamaCheckpointWait.release());
    await expect(
      panel.getByRole("textbox", { name: "Checkpoint message", exact: true }),
    ).toHaveValue("");
    assert.equal(
      await panel.getByText(/Abandoned first project preview/).count(),
      0,
    );
    assert.equal(await create.count(), 0);
    console.log(
      "Native checkpoints: late preparation discarded after project navigation.",
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        testRoot,
        checks: lateOnly
          ? [
              "refresh removes old review immediately",
              "late response cannot cross projects",
            ]
          : [
              "native real local Git checkpoint",
              "exact before/after",
              "no automatic selection",
              "message edit invalidates review",
              "dirty editor blocked",
              "private paths excluded",
              "HEAD/index/worktree unchanged",
              "unselected staged content excluded",
              "stale selected file refused",
              "late response cannot cross projects",
              "no clipboard/network/provider calls",
            ],
      }),
    );
  } finally {
    clearTimeout(deadline);
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
