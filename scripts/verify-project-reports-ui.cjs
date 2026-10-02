/* Native PDF and renderer fixture. Disposable profile, no model/account requests. */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const playwrightPath =
  process.env.NAKAMA_PLAYWRIGHT ||
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
const { _electron } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, "test"));

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = path.join(root, "tmp", `project-reports-ui-${Date.now()}`);
  const { initialState } = await import(
    pathToFileURL(path.join(root, "apps/host/store.mjs")).href
  );
  const state = initialState();
  const projectPath = path.join(profile, "projects", "pocket-garden");
  const stamp = new Date().toISOString();
  state.config.workspaceRoot = path.dirname(projectPath);
  state.projects = [
    {
      id: "fixture-garden",
      name: "Pocket Garden",
      description: "A small, welcoming place to plan the next season.",
      path: projectPath,
      updatedAt: stamp,
      status: "ready",
    },
  ];
  state.projectWorkflows = [
    {
      id: "fixture-workflow",
      projectId: "fixture-garden",
      requestedBy: "desktop",
      createdAt: stamp,
      updatedAt: stamp,
      status: "completed",
      stage: "completed",
      dependencySummary:
        "Synthetic dependency preparation receipt: npm ci completed with install scripts disabled. This fixture does not install packages or establish website acceptance.",
      message:
        "Create an accessible, offline garden planner. Let me keep track of plants, organise seasonal jobs and see what still needs attention. Keep the design calm, readable and usable with a keyboard.",
      delivery:
        "The planner now has a clear seasonal overview, labelled planting forms and a small task list. The implementation keeps plant notes on this device and supports a narrow phone layout. This example records synthetic fixture receipts only: no live model, account or hardware acceptance ran. Review the actual deployment environment before publishing.",
      assignments: {
        manager: { providerId: "codex", model: "fixture-model", effort: "low" },
        peer: { providerId: "claude", model: "fixture-model", effort: "high" },
        development: {
          providerId: "claude",
          model: "fixture-model",
          effort: "high",
        },
      },
      taskIds: ["fixture-writer"],
      workItems: [],
      reviews: [
        { role: "manager", round: 0, verdict: "pass", findings: [] },
        { role: "peer", round: 0, verdict: "pass", findings: [] },
      ],
    },
  ];
  state.tasks = [
    {
      id: "fixture-dependencies",
      projectId: "fixture-garden",
      workflowId: "fixture-workflow",
      kind: "project_dependencies",
      checkName: "dependencies",
      title: "Synthetic dependency receipt",
      status: "completed",
      exitCode: 0,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "fixture-writer",
      projectId: "fixture-garden",
      workflowId: "fixture-workflow",
      status: "completed",
      title: "Create garden planner",
      providerId: "claude",
      createdAt: stamp,
      updatedAt: stamp,
      filesWritten: [
        "index.html",
        "src/garden.ts",
        "src/plant-form.ts",
        "src/styles.css",
        "README.md",
      ],
    },
    {
      id: "fixture-check",
      projectId: "fixture-garden",
      kind: "project_check",
      checkName: "typecheck (synthetic receipt)",
      title: "Synthetic typecheck receipt",
      status: "completed",
      exitCode: 0,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  await fs.mkdir(path.join(profile, "private"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, "src/garden.ts"),
    "// Disposable fixture\nexport const season = 'spring';\n",
  );
  await fs.writeFile(
    path.join(projectPath, "README.md"),
    "# Pocket Garden fixture\n",
  );
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
  const deadline = setTimeout(() => app.process().kill(), 90000);
  let page;
  try {
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByText("Pocket Garden", { exact: true }).first(),
    ).toBeVisible();
    // A local synthetic illustration, explicitly selected for the report. No screenshot capture.
    const illustration = await app.evaluate(
      ({ nativeImage }, icon) =>
        nativeImage
          .createFromPath(icon)
          .resize({ width: 380 })
          .toPNG()
          .toString("base64"),
      path.join(root, "apps/desktop/assets/icon.png"),
    );
    await fs.writeFile(
      path.join(projectPath, "garden-illustration.png"),
      Buffer.from(illustration, "base64"),
    );
    const report = await page.evaluate(() =>
      window.nakama.api("POST", "/api/projects/fixture-garden/reports", {
        workflowId: "fixture-workflow",
        images: [
          {
            kind: "project",
            path: "garden-illustration.png",
            caption:
              "Synthetic illustration - fixture image, not a live browser test",
          },
        ],
      }),
    );
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() =>
              window.nakama.api("GET", "/api/projects/fixture-garden/reports"),
            )
          ).reports[0]?.status,
        { timeout: 40000 },
      )
      .toBe("ready");
    const file = await page.evaluate(
      (id) =>
        window.nakama.api(
          "GET",
          `/api/projects/fixture-garden/reports/${id}/file`,
        ),
      report.id,
    );
    assert.equal(file.mimeType, "application/pdf");
    assert.ok(file.bytes > 10000 && file.bytes < 1363148);
    await fs.mkdir(path.join(root, "output/pdf"), { recursive: true });
    await fs.writeFile(
      path.join(root, "output/pdf/Nakama-Project-Report-Example.pdf"),
      Buffer.from(file.base64, "base64"),
    );
    await page.getByText("Pocket Garden", { exact: true }).first().click();
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open PDF", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/ready ·/)).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: /^Make a report when the project is delivered/,
      }),
    ).toBeChecked();
    // Screenshots intended for documentation show a generic fixture path.
    await page
      .locator(".project-meta-bar > span")
      .first()
      .evaluate((node) => {
        const text = [...node.childNodes].find(
          (child) => child.nodeType === Node.TEXT_NODE,
        );
        if (text) text.textContent = "Workspace / pocket-garden";
      });
    await page.screenshot({
      path: path.join(root, "output/project-reports.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Files & editor", exact: true })
      .click();
    await page.getByLabel("Relative folder path").fill("src");
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "garden.ts", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Find a file in this folder").fill("missing");
    await expect(
      page.getByText("No matching files in this folder."),
    ).toBeVisible();
    await page.getByLabel("Find a file in this folder").fill("");
    await page.getByRole("button", { name: "garden.ts", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Edit src/garden.ts" }),
    ).toHaveValue(/season/);
    await page
      .getByRole("navigation", { name: "Project folder path" })
      .getByRole("button", { name: "Pocket Garden" })
      .click();
    await page
      .getByRole("button", { name: "garden-illustration.png", exact: true })
      .click();
    await expect(
      page.getByRole("img", { name: "garden-illustration.png", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(root, "output/project-file-navigation.png"),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(root, "output/project-reports-verification.json"),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          synthetic: true,
          reportBytes: file.bytes,
          sha256: file.sha256,
          checks: [
            "Actual isolated Electron printToPDF",
            "Host report create/read",
            "Explicit synthetic illustration with provenance",
            "Report list/default automatic switch",
            "Folder breadcrumbs/path jump/filter",
            "Text read and bounded image preview",
          ],
          outputs: [
            "output/pdf/Nakama-Project-Report-Example.pdf",
            "output/project-reports.png",
            "output/project-file-navigation.png",
          ],
        },
        null,
        2,
      ),
    );
    console.log("Project report PDF and native UI fixture passed.");
  } catch (error) {
    if (page) {
      await page
        .screenshot({ path: path.join(profile, "failure.png") })
        .catch(() => {});
      await fs.writeFile(
        path.join(profile, "failure.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => "unavailable"),
      );
    }
    console.error(`Fixture failure evidence: ${profile}`);
    throw error;
  } finally {
    clearTimeout(deadline);
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
