// Dedicated Electron + synthetic loopback pages only; no account, Internet or AI calls.
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
if (!process.versions.electron) {
  (async () => {
    const dir = await fs.mkdtemp(path.join(root, "tmp", "browser-studio-"));
    try {
      await fs.mkdir(path.join(dir, "profile"));
      const { spawn } = require("node:child_process");
      const env = { ...process.env, NAKAMA_BROWSER_FIXTURE: dir };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require("electron"), [__filename], {
        cwd: root,
        env,
        stdio: "inherit",
        windowsHide: true,
      });
      const timer = setTimeout(() => child.kill(), 60000);
      const code = await new Promise((resolve) => child.on("exit", resolve));
      clearTimeout(timer);
      assert.equal(code, 0, "Native browser fixture failed");
      console.log(
        "PASS isolated Chromium: DOM controls, safe captures, request blocking, login pause, takeover, private isolation, anonymous research.",
      );
    } finally {
      const relative = path.relative(path.join(root, "tmp"), dir);
      assert.ok(
        relative && !relative.startsWith("..") && !path.isAbsolute(relative),
      );
      await fs.rm(dir, { recursive: true, force: true });
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const trace = (message) =>
    require("node:fs").appendFileSync(
      path.join(process.env.NAKAMA_BROWSER_FIXTURE, "trace.log"),
      message + "\n",
    );
  process.on("uncaughtException", (error) => {
    trace(error.stack);
    require("electron").app.exit(1);
  });
  trace("Electron entry loaded");
  const { app, BrowserWindow, session } = require("electron");
  const { EventEmitter } = require("node:events");
  const http = require("node:http");
  const { pathToFileURL } = require("node:url");
  const {
    createBrowserStudioAdapter,
  } = require("../apps/desktop/browser-studio.cjs");
  app.setPath(
    "userData",
    path.join(process.env.NAKAMA_BROWSER_FIXTURE, "profile"),
  );
  app.on("window-all-closed", () => {});
  app
    .whenReady()
    .then(async () => {
      trace("Electron ready");
      console.log("Fixture Electron ready.");
      let studio, server, outside;
      try {
        let outsideRequests = 0;
        outside = http.createServer((_req, res) => {
          outsideRequests++;
          res.end("outside");
        });
        await new Promise((resolve) => outside.listen(0, "127.0.0.1", resolve));
        server = http.createServer((request, response) => {
          response.setHeader("Content-Type", "text/html");
          if (request.url === "/sensitive")
            return response.end(
              '<h1>Login</h1><input type="password" value="synthetic-secret">',
            );
          response.end(
            `<!doctype html><title>Browser fixture</title><h1>Fixture</h1><button onclick="this.textContent='Clicked'">Click me</button><input placeholder="Name"><a href="/next">Next</a><div style="height:2000px">Local page</div><script>fetch('http://127.0.0.1:${outside.address().port}/blocked').catch(()=>{});</script>`,
          );
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        const windows = [];
        const adapter = createBrowserStudioAdapter({
          BrowserWindow: function (options) {
            const window = new BrowserWindow(options);
            windows.push(window);
            return window;
          },
          session,
        });
        for (const method of ["create", "createTab", "navigate"]) {
          const original = adapter[method];
          adapter[method] = async (...args) => {
            console.log("Adapter", method);
            try {
              return await original(...args);
            } catch (error) {
              console.error(method, error);
              throw error;
            }
          };
        }
        const { BrowserStudio } = await import(
          pathToFileURL(path.join(root, "apps/host/browser-studio.mjs"))
        );
        const store = new EventEmitter();
        store.state = {
          devices: [],
          tasks: [
            {
              id: "task",
              status: "running",
              requestedBy: "desktop",
              projectId: "project",
            },
          ],
          projectWorkflows: [],
        };
        studio = new BrowserStudio(
          {
            store,
            project: (id) => ({ id }),
            projectPreviews: {
              browserOrigin: () => ({ origin, launchId: "fixture" }),
            },
          },
          { adapter, timers: false },
        );
        const principal = { kind: "owner", id: "desktop" };
        const act = (body) =>
          studio.agentAction(body, { taskId: "task", principal });
        const { session: project } = await act({
          action: "create",
          mode: "project",
        });
        console.log("Project tab loaded.");
        let read = await act({ action: "read", sessionId: project.id });
        assert.match(read.text, /Fixture/);
        await act({
          action: "click",
          sessionId: project.id,
          elementId: read.elements.find((row) => row.text === "Click me").id,
        });
        read = await act({ action: "read", sessionId: project.id });
        assert.match(read.text, /Clicked/);
        await act({
          action: "type",
          sessionId: project.id,
          elementId: read.elements.find((row) => row.text === "Name").id,
          text: "Local synthetic value",
        });
        assert.equal(
          await windows[0].webContents.executeJavaScript(
            "document.querySelector('input').value",
          ),
          "Local synthetic value",
        );
        await act({ action: "key", sessionId: project.id, key: "End" });
        const frame = await act({
          action: "screenshot",
          sessionId: project.id,
        });
        console.log("Project input and capture verified.");
        assert.ok(frame.image.startsWith("data:image/jpeg;base64,"));
        assert.equal(frame.width, 1280);
        assert.equal(frame.height, 800);
        assert.equal(studio.reportImages("project").length, 1);
        assert.equal(outsideRequests, 0);
        await act({
          action: "navigate",
          sessionId: project.id,
          url: origin + "/sensitive",
        });
        const withheld = await act({ action: "read", sessionId: project.id });
        assert.equal(withheld.status, "attention");
        assert.equal(studio.reportImages("project").length, 0);
        await studio.dispatch(
          "POST",
          `/api/browser-studio/sessions/${project.id}/takeover`,
          {},
          principal,
        );
        await assert.rejects(
          act({ action: "read", sessionId: project.id }),
          /private/,
        );
        await studio.dispatch(
          "POST",
          `/api/browser-studio/sessions/${project.id}/release`,
          {},
          principal,
        );
        assert.equal(
          studio.publicStatus(principal).sessions[0].tabs[0].url,
          "",
        );
        const { session: privateSession } = await studio.create(
          { mode: "private" },
          principal,
        );
        console.log("Private tab loaded.");
        const privateWindow = windows[1];
        await privateWindow.webContents.session.cookies.set({
          url: "https://fixture.example",
          name: "synthetic",
          value: "private",
        });
        assert.equal(
          (
            await windows[0].webContents.session.cookies.get({
              name: "synthetic",
            })
          ).length,
          0,
        );
        await privateWindow.webContents.executeJavaScript(
          "document.body.innerHTML='<input type=password value=synthetic-secret>'",
        );
        const privateFrame = await studio.dispatch(
          "POST",
          `/api/browser-studio/sessions/${privateSession.id}/frame`,
          {},
          principal,
        );
        assert.ok(privateFrame.image);
        assert.equal(studio.reportImages("project").length, 0);
        const { session: research } = await act({
          action: "create",
          mode: "research",
        });
        assert.equal(
          windows[2].webContents.getLastWebPreferences().javascript,
          false,
        );
        const researchDocument =
          await windows[2].webContents.debugger.sendCommand("DOM.getDocument");
        const researchBody = await windows[2].webContents.debugger.sendCommand(
          "DOM.querySelector",
          { nodeId: researchDocument.root.nodeId, selector: "body" },
        );
        await windows[2].webContents.debugger.sendCommand("DOM.setOuterHTML", {
          nodeId: researchBody.nodeId,
          outerHTML:
            "<body><h1>Anonymous research fixture</h1><a href=https://example.com/page>Link</a></body>",
        });
        assert.match(
          (await act({ action: "read", sessionId: research.id })).text,
          /Anonymous research fixture/,
        );
        await assert.rejects(
          act({
            action: "type",
            sessionId: research.id,
            elementId: "0",
            text: "No submission",
          }),
          /never types/,
        );
        const { session: focusSession } = await act({
          action: "create",
          mode: "project",
        });
        await windows[3].webContents.executeJavaScript(
          "document.querySelector('input').onfocus=()=>{const p=document.createElement('input');p.type='password';document.body.append(p)};true",
        );
        const focusRead = await act({
          action: "read",
          sessionId: focusSession.id,
        });
        await assert.rejects(
          act({
            action: "type",
            sessionId: focusSession.id,
            elementId: focusRead.elements.find((row) => row.text === "Name").id,
            text: "must not type",
          }),
          /could not be confirmed/,
        );
        assert.equal(
          studio
            .publicStatus(principal)
            .sessions.find((row) => row.id === focusSession.id).tainted,
          true,
        );
        assert.equal(
          await windows[3].webContents.executeJavaScript(
            "document.querySelector('input').value",
          ),
          "",
        );
        console.log("Native browser assertions passed.");
      } catch (error) {
        trace(error.stack);
        console.error(error);
        throw error;
      } finally {
        studio?.close();
        await Promise.all(
          [server, outside].filter(Boolean).map(
            (item) =>
              new Promise((resolve) => {
                item.closeAllConnections();
                item.close(resolve);
              }),
          ),
        );
      }
    })
    .then(
      () => app.exit(0),
      (error) => {
        console.error(error);
        app.exit(1);
      },
    );
}
