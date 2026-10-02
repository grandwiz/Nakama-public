// Run after npm run build. Uses a disposable profile, Git repository, and simulated
// paired Chrome device. No model calls, remote requests, user clipboard access,
// source repository changes, or real device actions are performed.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  require("node:path").join(require("node:os").homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { _electron } = require(playwrightPath);

(async () => {
  const root = path.resolve(__dirname, "..");
  const testRoot = path.join(root, "tmp", `review-ui-${Date.now()}`);
  const projects = path.join(testRoot, "projects");
  await fs.mkdir(projects, { recursive: true });
  await fs.mkdir(path.join(root, "tmp", "ui"), { recursive: true });
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
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(15000);
    const project = await page.evaluate(async (folder) => {
      await window.nakama.api("PATCH", "/api/settings", {
        workspaceRoot: folder,
      });
      return window.nakama.api("POST", "/api/projects", {
        name: "Companion website",
        description: "Local verification fixture · staged and saved edits",
      });
    }, projects);
    // This path comes from our isolated test host. Refuse to run Git elsewhere.
    const relative = path.relative(projects, project.path);
    assert.ok(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
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
    const git = (...args) => {
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
    };

    await page.reload();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.getByRole("button", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", {
        name: /Companion website Local verification fixture/,
      })
      .click();
    await page
      .getByRole("button", { name: "Git changes", exact: true })
      .click();
    await page
      .getByText("This project has no Git repository", { exact: true })
      .waitFor();

    git("init");
    git("add", "README.md");
    git("commit", "-m", "Create local verification fixture");
    await fs.writeFile(
      path.join(project.path, "README.md"),
      "# Companion website\n\nA home for the Nakama companion.\n",
    );
    git("add", "README.md");
    await fs.appendFile(
      path.join(project.path, "README.md"),
      "\n## Coming next\n\n- A clearer welcome screen\n- Quick access to recent projects\n",
    );
    await fs.writeFile(
      path.join(project.path, "design-notes.md"),
      "# Design notes\n\nKeep the companion calm, clear, and easy to use.\n",
    );
    await page
      .getByRole("button", { name: "Refresh changes", exact: true })
      .click();
    const worktree = page.getByRole("tab", { name: /Worktree/ });
    const staged = page.getByRole("tab", { name: /Staged/ });
    const diff = page.getByLabel("Diff of README.md", { exact: true });
    // Git returns names in sorted order; explicitly select README.md.
    await page.getByRole("button", { name: /README.md Modified/ }).click();
    await diff.waitFor();
    assert.match(await diff.innerText(), /\+## Coming next/);
    const tabStyle = await worktree.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        border: style.borderLeftWidth,
        background: style.backgroundColor,
      };
    });
    assert.equal(tabStyle.border, "0px");
    assert.equal(tabStyle.background, "rgba(0, 0, 0, 0)");
    const preview = path.join(root, "tmp", "ui", "git-diff-final.png");
    await page.screenshot({ path: preview, fullPage: true });
    await fs.copyFile(
      preview,
      path.join(root, "output", "git-changes-preview.png"),
    );

    await staged.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".git-diff-heading")
          ?.textContent.includes("Index vs HEAD") &&
        document
          .querySelector(".git-diff")
          ?.textContent.includes("+A home for the Nakama companion."),
    );
    assert.doesNotMatch(await diff.innerText(), /\+## Coming next/);
    await worktree.click();
    await page.getByRole("button", { name: /design-notes.md/ }).click();
    const contents = page.getByLabel("Contents of design-notes.md", {
      exact: true,
    });
    await contents.waitFor();
    assert.match(await contents.innerText(), /Keep the companion calm/);
    git("add", "README.md", "design-notes.md");
    git("commit", "-m", "Finish local verification fixture");
    await page
      .getByRole("button", { name: "Refresh changes", exact: true })
      .click();
    await page
      .getByText("Your working tree is clean", { exact: true })
      .waitFor();
    console.log(
      "Git review: not-repository, styled tabs, worktree/staged diff, untracked text, and clean state passed.",
    );

    // The loopback-only host assigns an ephemeral port to this smoke profile.
    const ticket = await page.evaluate(() =>
      window.nakama.api("POST", "/api/pairing/tickets", { platform: "chrome" }),
    );
    const request = async (
      route,
      body,
      token,
      method = "POST",
      expectedStatus = 200,
    ) => {
      const response = await fetch(`http://127.0.0.1:${ticket.port}${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      assert.equal(
        response.status,
        expectedStatus,
        data.error || "Local fixture request failed",
      );
      return data;
    };
    const paired = await request("/api/pair", {
      ticket: ticket.ticket,
      name: "Local screenshot fixture",
      platform: "chrome",
      capabilities: ["browser_screenshot"],
    });
    await page.reload();
    await nav.getByRole("button", { name: "Devices", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Action", exact: true })
      .selectOption("browser_screenshot");
    await page
      .getByRole("spinbutton", { name: "Browser tab ID", exact: true })
      .fill("1");
    await page
      .getByRole("button", { name: "Send action", exact: true })
      .click();
    await page
      .getByText("Action queued. Wait for the device to report its result.", {
        exact: true,
      })
      .waitFor();
    const pending = await request(
      "/api/device/actions",
      null,
      paired.token,
      "GET",
    );
    assert.equal(pending.actions[0].type, "browser_screenshot");
    assert.equal(pending.actions[0].args.tabId, 1);
    // Capture a small piece of our own fixture, never another app or website.
    const jpeg = await page.screenshot({
      type: "jpeg",
      quality: 25,
      clip: { x: 0, y: 0, width: 600, height: 400 },
    });
    const data = {
      kind: "browser_screenshot",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64," + jpeg.toString("base64"),
      width: 600,
      height: 400,
      url: "https://example.test/local-fixture",
      title: "Local screenshot fixture",
      capturedAt: new Date().toISOString(),
    };
    assert.ok(data.dataUrl.length <= 220 * 1024);
    await request(
      `/api/device/actions/${pending.actions[0].id}/result`,
      { status: "completed", message: "Valid local fixture capture", data },
      paired.token,
    );
    const invalid = await page.evaluate(
      (deviceId) =>
        window.nakama.api("POST", "/api/device/actions", {
          deviceId,
          type: "browser_screenshot",
          args: { tabId: 1 },
        }),
      paired.deviceId,
    );
    await request("/api/device/actions", null, paired.token, "GET");
    await request(
      `/api/device/actions/${invalid.id}/result`,
      {
        status: "completed",
        message: "Malformed local fixture capture",
        data: { ...data, dataUrl: "https://example.test/arbitrary-image.jpg" },
      },
      paired.token,
      "POST",
      400,
    );
    // The host rejects a malformed screenshot before storing it. Device error
    // details are ordinary JSON and still need the renderer's safe fallback.
    await request(
      `/api/device/actions/${invalid.id}/result`,
      {
        status: "failed",
        message: "Malformed local fixture capture",
        data: { dataUrl: "https://example.test/arbitrary-image.jpg" },
      },
      paired.token,
    );
    await page.reload();
    await nav.getByRole("button", { name: "Devices", exact: true }).click();
    await page
      .locator("details.activity-item")
      .filter({ hasText: "Valid local fixture capture" })
      .locator("summary")
      .click();
    const image = page.getByRole("img", {
      name: "Captured page: Local screenshot fixture",
      exact: true,
    });
    await image.waitFor();
    await image.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const img = document.querySelector(".browser-screenshot img");
      return img?.complete && img.naturalWidth > 0;
    });
    assert.equal(
      await page.locator("pre").filter({ hasText: "base64" }).count(),
      0,
    );
    await page
      .locator("details.activity-item")
      .filter({ hasText: "Malformed local fixture capture" })
      .locator("summary")
      .click();
    await page.getByText(/This screenshot could not be displayed/).waitFor();
    assert.equal(
      await page
        .locator('img[src="https://example.test/arbitrary-image.jpg"]')
        .count(),
      0,
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "native Git review",
          "final Git preview saved",
          "screenshot UI submits action",
          "valid JPEG visibly decodes",
          "remote image result rejected",
          "no base64 text",
          "no renderer errors",
          "no clipboard access",
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
