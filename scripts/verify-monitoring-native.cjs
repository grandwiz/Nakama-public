// Actual Chromium with synthetic HTTPS protocol pages. No Internet, login,
// installed profile, model, cart, payment or physical device is contacted.
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
if (!process.versions.electron) {
  (async () => {
    const dir = await fs.mkdtemp(path.join(root, "tmp", "monitor-native-"));
    try {
      const { spawn } = require("node:child_process");
      const env = { ...process.env, NAKAMA_MONITOR_FIXTURE: dir };
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
      assert.equal(code, 0, "Native monitoring fixture failed");
      console.log(
        "PASS native monitor: isolated persistent cookies, stock/variant evidence, worker-free inert polling, single bounded native cart POST, checkout handoff, challenge/queue pause, private forget.",
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
  const { app, BrowserWindow, session } = require("electron");
  const { randomUUID } = require("node:crypto");
  const {
    createBrowserStudioAdapter,
  } = require("../apps/desktop/browser-studio.cjs");
  const {
    createMonitoringAdapter,
  } = require("../apps/desktop/browser-monitor.cjs");
  app.setPath(
    "userData",
    path.join(process.env.NAKAMA_MONITOR_FIXTURE, "profile"),
  );
  app.on("window-all-closed", () => {});
  app
    .whenReady()
    .then(async () => {
      const profiles = new Map(),
        requests = [];
      let evidence = "stock",
        cartPosts = 0,
        redirectReplay = false;
      const url = "https://fixture.example/product";
      const product = {
        "@context": "https://schema.org",
        "@type": "Product",
        url,
        sku: "fixture-1",
        offers: {
          "@type": "Offer",
          availability: "https://schema.org/InStock",
        },
      };
      const recipe = {
        enabled: true,
        productText: "Fixture product",
        variantField: "id",
        variantValue: "fixture-1",
        priceText: "GBP 12.00",
        maxPrice: 12,
        currency: "GBP",
        cartPath: "/cart/add",
        checkoutPath: "/checkout",
        addLabel: "Add to cart",
        checkoutLabel: "Checkout",
      };
      const monitor = {
        url,
        condition: { type: "stock", sku: "fixture-1" },
        recipe,
      };
      const fixtureSession = {
        fromPartition(name, options) {
          const isolated = session.fromPartition(name, options);
          if (!profiles.has(name)) {
            profiles.set(name, isolated);
            isolated.protocol.handle("https", async (request) => {
              const target = new URL(request.url);
              requests.push(`${request.method} ${target.pathname}`);
              assert.equal(target.hostname, "fixture.example");
              if (target.pathname === "/worker.js")
                return new Response(
                  `self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('fetch',event=>{if(new URL(event.request.url).pathname==='/product')event.respondWith((async()=>{await fetch('/worker-observed');return new Response('<h1>Worker substituted this product</h1>',{headers:{'Content-Type':'text/html'}})})())});`,
                  {
                    headers: {
                      "Content-Type": "application/javascript",
                      "Service-Worker-Allowed": "/",
                    },
                  },
                );
              if (
                target.pathname === "/worker-setup" ||
                target.pathname === "/worker-observed"
              )
                return new Response(
                  "<!doctype html><h1>Synthetic worker setup</h1>",
                  { headers: { "Content-Type": "text/html" } },
                );
              if (target.pathname === "/cart.js")
                return new Response(
                  JSON.stringify({
                    currency: "GBP",
                    item_count: cartPosts ? 1 : 0,
                    items: cartPosts
                      ? [
                          {
                            variant_id: "fixture-1",
                            quantity: 1,
                            final_price: 1200,
                          },
                        ]
                      : [],
                  }),
                  { headers: { "Content-Type": "application/json" } },
                );
              if (target.pathname === "/cart/add") {
                cartPosts++;
                assert.equal(request.method, "POST");
                const values = new URLSearchParams(await request.text());
                assert.equal(values.get("id"), "fixture-1");
                assert.equal(values.get("quantity"), "1");
                return new Response(null, {
                  status: redirectReplay ? 307 : 302,
                  headers: {
                    Location: redirectReplay
                      ? "https://fixture.example/cart/add"
                      : "https://fixture.example/cart",
                  },
                });
              }
              let body;
              if (target.pathname === "/cart")
                body =
                  '<h1>Fixture product</h1><p>GBP 12.00</p><a href="/checkout">Checkout</a>';
              else if (target.pathname === "/checkout")
                body =
                  '<h1>Review your checkout</h1><input autocomplete="cc-number" placeholder="Human card entry">';
              else if (evidence === "queue")
                body = "<h1>You are in the queue</h1>";
              else if (evidence === "captcha")
                body = '<h1>Verify you are human</h1><div id="captcha"></div>';
              else {
                const data = structuredClone(product);
                if (evidence === "out")
                  data.offers.availability = "https://schema.org/OutOfStock";
                if (evidence === "ambiguous")
                  data.offers = [data.offers, { ...data.offers }];
                if (evidence === "recommendation")
                  data.url = "https://fixture.example/unrelated";
                body = `<script type="application/ld+json">${JSON.stringify(data)}</script><form method="post" action="/cart/add" onsubmit="fetch('/order',{method:'POST'})"><h1>Fixture product</h1><p>GBP 12.00</p><meta itemprop="price" content="12.00"><meta itemprop="priceCurrency" content="GBP"><input type="hidden" name="id" value="fixture-1"><input type="hidden" name="quantity" value="1"><button type="submit">Add to cart</button></form><script>fetch('/order',{method:'POST'});localStorage.setItem('unexpected-script','executed')</script>`;
              }
              return new Response(
                `<!doctype html><title>Private fixture</title>${body}`,
                { status: 200, headers: { "Content-Type": "text/html" } },
              );
            });
          }
          return isolated;
        },
      };
      const adapter = createBrowserStudioAdapter({
        BrowserWindow,
        session: fixtureSession,
        proxyFactory: async () => ({ port: 65530, close() {} }),
      });
      const profileId = randomUUID();
      try {
        await adapter.create({
          id: "monitor",
          mode: "private",
          profileId,
          onChange() {},
        });
        await adapter.createTab("monitor", "tab");
        const privateSession = profiles.get(
          `persist:nakama-monitor-${profileId}`,
        );
        await privateSession.cookies.set({
          url,
          name: "private-fixture",
          value: "synthetic-only",
          secure: true,
          expirationDate: Date.now() / 1000 + 3600,
        });
        await adapter.setMonitorHuman("monitor", true);
        await adapter.navigate(
          "monitor",
          "tab",
          "https://fixture.example/worker-setup",
        );
        const workerContents = BrowserWindow.getAllWindows()[0].webContents;
        await workerContents.executeJavaScript(
          `(async()=>{localStorage.setItem('private-login-fixture','preserved');await navigator.serviceWorker.register('/worker.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));return true})()`,
        );
        assert.ok(
          Object.keys(privateSession.serviceWorkers.getAllRunning()).length,
          "Synthetic service worker is installed and running before monitor resume",
        );
        await adapter.setMonitorHuman("monitor", false);
        assert.equal(
          Object.keys(privateSession.serviceWorkers.getAllRunning()).length,
          0,
          "Automatic transition stops registered background workers",
        );
        assert.deepEqual(
          await adapter.monitorCheck("monitor", "tab", monitor),
          { outcome: "match" },
        );
        assert.equal(
          requests.includes("GET /worker-observed"),
          false,
          "Background worker cannot intercept automatic product checks",
        );
        assert.equal(
          requests.some((request) => request.includes("/order")),
          false,
        );
        assert.deepEqual(
          await adapter.monitorPrepare("monitor", "tab", monitor),
          { outcome: "checkout" },
        );
        assert.equal(cartPosts, 1);
        assert.equal(
          requests.some((request) => request.includes("/order")),
          false,
        );
        await assert.rejects(adapter.read("monitor", "tab"), /Private/);
        assert.deepEqual(
          await adapter.monitorCheck("monitor", "tab", {
            ...monitor,
            recipe: undefined,
            condition: { type: "text", contains: "Fixture product" },
          }),
          { outcome: "match" },
        );
        for (const [state, outcome] of [
          ["out", "no_match"],
          ["ambiguous", "unknown"],
          ["recommendation", "unknown"],
          ["queue", "queue"],
          ["captcha", "captcha"],
        ]) {
          evidence = state;
          assert.deepEqual(
            await adapter.monitorCheck("monitor", "tab", monitor),
            { outcome },
          );
        }
        evidence = "stock";
        await adapter.monitorCheck("monitor", "tab", monitor);
        assert.deepEqual(
          await adapter.monitorPrepare("monitor", "tab", monitor),
          { outcome: "unsupported" },
        );
        assert.equal(
          cartPosts,
          1,
          "An existing cart cannot receive a second addition",
        );
        cartPosts = 0;
        assert.deepEqual(
          await adapter.monitorPrepare("monitor", "tab", {
            ...monitor,
            recipe: { ...recipe, maxPrice: 11 },
          }),
          { outcome: "price_changed" },
        );
        assert.equal(cartPosts, 0);
        redirectReplay = true;
        const redirected = await adapter
          .monitorPrepare("monitor", "tab", monitor)
          .catch(() => ({ outcome: "uncertain" }));
        assert.ok(
          ["checkout", "uncertain", "unsupported"].includes(redirected.outcome),
        );
        assert.equal(
          cartPosts,
          1,
          "307 redirect cannot replay the one allowed cart POST",
        );
        adapter.destroy("monitor");
        await privateSession.cookies.flushStore();
        await adapter.create({
          id: "reopen",
          mode: "private",
          profileId,
          onChange() {},
        });
        await adapter.createTab("reopen", "tab");
        assert.equal(
          (await privateSession.cookies.get({ url, name: "private-fixture" }))
            .length,
          1,
        );
        await adapter.setMonitorHuman("reopen", true);
        await adapter.navigate(
          "reopen",
          "tab",
          "https://fixture.example/worker-setup",
        );
        assert.equal(
          await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
            "localStorage.getItem('private-login-fixture')",
          ),
          "preserved",
          "Worker cleanup preserves ordinary login storage across profile reopen",
        );
        await adapter.forgetProfile(profileId);
        assert.equal(
          (await privateSession.cookies.get({ url, name: "private-fixture" }))
            .length,
          0,
        );
        const windows = createMonitoringAdapter({ browserAdapter: adapter });
        if (process.platform === "win32")
          assert.deepEqual(
            await windows.checkWindows({
              processName: "nakama-synthetic-no-process-93845.exe",
              condition: { contains: "fixture" },
            }),
            { outcome: "no_match" },
          );
      } finally {
        adapter.close();
        for (const isolated of profiles.values())
          isolated.protocol.unhandle("https");
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
