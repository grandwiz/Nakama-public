const { randomUUID } = require("node:crypto");
const { createPublicProxy } = require("./browser-network.cjs");
const { monitorInspection, cartInspection } = require("./browser-monitor.cjs");

const READ_SCRIPT = `(() => {
 const sensitive = Boolean(document.querySelector('iframe,frame,input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"],input[autocomplete="one-time-code"]')) || /\\/(?:login|signin|sign-in|oauth|authorize|callback)(?:[/?#]|$)/i.test(location.href);
 if(sensitive) return {sensitive:true};
 const nodes = Array.from(document.querySelectorAll('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"]')).slice(0,150);
 globalThis.__nakamaTargets = nodes;
 return {sensitive:false,title:document.title.slice(0,200),text:(document.body?.innerText||'').slice(0,40000),elements:nodes.map((e,i)=>({id:String(i),tag:e.tagName.toLowerCase(),text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,160),type:e.getAttribute('type')||'',href:e.tagName==='A'?e.href:undefined}))};
})()`;
const SENSITIVE_SCRIPT = `Boolean(document.querySelector('iframe,frame,input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"],input[autocomplete="one-time-code"]')) || /\\/(?:login|signin|sign-in|oauth|authorize|callback)(?:[/?#]|$)/i.test(location.href)`;
const KEY_CODES = {
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Tab: 9,
  ArrowLeft: 37,
  ArrowRight: 39,
  ArrowUp: 38,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Delete: 46,
};
async function bounded(item, work, ms = 15000) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (!item.window.isDestroyed()) item.window.destroy();
          reject(new Error("Browser operation timed out; tab closed."));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function createBrowserStudioAdapter({
  BrowserWindow,
  session,
  proxyFactory = createPublicProxy,
}) {
  const groups = new Map();
  function group(id) {
    const value = groups.get(id);
    if (!value) throw new Error("Browser session ended.");
    return value;
  }
  function tab(id, tabId) {
    const value = group(id).tabs.get(tabId);
    if (!value || value.window.isDestroyed())
      throw new Error("Browser tab ended.");
    return value;
  }
  function allowed(value, raw, method = "GET", resource = "mainFrame") {
    if (raw === "about:blank") return true;
    if (value.monitorQuiescing) return false;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.username || url.password) return false;
    if (
      value.profileId &&
      value.monitorReadOnly &&
      !["GET", "HEAD"].includes(method)
    ) {
      if (!(
        value.cartSubmission &&
        method === "POST" &&
        resource === "mainFrame" &&
        url.href === value.cartSubmission
      ))
        return false;
    }
    if (value.profileId && value.monitorReadOnly && resource === "webSocket")
      return false;
    if (
      value.profileId &&
      value.monitorReadOnly &&
      value.monitorOrigin &&
      resource === "mainFrame" &&
      url.origin !== value.monitorOrigin
    )
      return false;
    if (value.mode !== "private" && resource === "subFrame") return false;
    if (value.mode === "project")
      return (
        ["http:", "ws:"].includes(url.protocol) &&
        url.origin.replace(/^ws:/, "http:") === value.origin
      );
    if (
      url.protocol !== "https:" ||
      !url.hostname.includes(".") ||
      /^(?:\d|\[)/.test(url.hostname)
    )
      return false;
    if (value.mode === "research")
      return (
        ["GET", "HEAD"].includes(method) &&
        resource !== "webSocket" &&
        !/\/(?:login|signin|sign-in|oauth|authorize|callback)(?:[/?#]|$)/i.test(
          url.href,
        )
      );
    return true;
  }
  async function create({
    id,
    mode,
    origin,
    onChange,
    profileId,
    monitorHuman = false,
  }) {
    if (profileId && (mode !== "private" || !/^[a-f0-9-]{36}$/.test(profileId)))
      throw new Error("Invalid private monitor profile.");
    const partition = profileId
      ? `persist:nakama-monitor-${profileId}`
      : `nakama-browser-${randomUUID()}`;
    const isolated = session.fromPartition(partition, { cache: false });
    const value = {
      id,
      mode,
      origin,
      session: isolated,
      tabs: new Map(),
      onChange,
      profileId,
      monitorReadOnly: Boolean(profileId && !monitorHuman),
    };
    groups.set(id, value);
    try {
      isolated.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      isolated.setPermissionCheckHandler(() => false);
      isolated.setDevicePermissionHandler?.(() => false);
      isolated.removeAllListeners?.("will-download");
      isolated.on("will-download", (event, item) => {
        event.preventDefault();
        item.cancel();
        onChange({
          attentionReason: "Downloads are blocked in the internal browser.",
        });
      });
      isolated.webRequest.onBeforeRequest(
        { urls: ["<all_urls>"] },
        (details, callback) => {
          const permitted =
            groups.get(id) === value &&
            allowed(value, details.url, details.method, details.resourceType);
          if (permitted && value.cartSubmission && details.method === "POST")
            value.cartSubmission = null;
          callback({ cancel: !permitted });
          if (!permitted && details.resourceType === "mainFrame")
            onChange({
              attentionReason:
                "This destination is outside the session's browser policy.",
            });
        },
      );
      if (profileId)
        isolated.webRequest.onHeadersReceived((details, callback) => {
          // Preserve-method redirects after a native cart POST could duplicate
          // an addition even though the host persisted a single attempt.
          callback({
            cancel:
              value.monitorReadOnly &&
              details.method === "POST" &&
              [307, 308].includes(details.statusCode),
          });
        });
      if (mode !== "project") {
        value.proxy = await proxyFactory();
        if (groups.get(id) !== value) throw new Error("Browser session ended.");
        await isolated.setProxy({
          mode: "fixed_servers",
          proxyRules: `http=127.0.0.1:${value.proxy.port};https=127.0.0.1:${value.proxy.port}`,
          proxyBypassRules: "<-loopback>",
        });
      }
      if (mode === "research") {
        isolated.webRequest.onBeforeSendHeaders((details, callback) => {
          const headers = { ...details.requestHeaders };
          for (const key of Object.keys(headers))
            if (
              /^(cookie|authorization|proxy-authorization|referer)$/i.test(key)
            )
              delete headers[key];
          callback({ requestHeaders: headers });
        });
        isolated.webRequest.onHeadersReceived((details, callback) => {
          const headers = { ...details.responseHeaders };
          for (const key of Object.keys(headers))
            if (/^set-cookie$/i.test(key)) delete headers[key];
          callback({ responseHeaders: headers });
        });
      }
      if (value.monitorReadOnly) await clearMonitorWorkers(value);
    } catch (error) {
      destroy(id);
      throw error;
    }
  }
  async function createTab(id, tabId) {
    const value = group(id);
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      useContentSize: true,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        session: value.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        devTools: false,
        spellcheck: false,
        offscreen: true,
        backgroundThrottling: false,
        javascript: value.mode !== "research",
        navigateOnDragDrop: false,
      },
    });
    const contents = window.webContents;
    const item = { window, id: tabId, revision: 0, responseCode: 0 };
    value.tabs.set(tabId, item);
    contents.setWindowOpenHandler(() => {
      value.onChange({
        attentionReason:
          "Popups are blocked. Open an explicit new tab if needed.",
      });
      return { action: "deny" };
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-navigate", (event, url) => {
      if (!allowed(value, url)) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      // Never follow a form redirect automatically: a 307/308 preserves POST.
      // The cart adapter verifies typed state, then explicitly GETs /cart.
      if (!allowed(value, url) || (value.monitorReadOnly && value.cartAttempt))
        event.preventDefault();
    });
    contents.on("login", (event, _details, _auth, callback) => {
      event.preventDefault();
      callback();
      value.onChange({
        attentionReason:
          "HTTP authentication dialogs are unavailable. Use a supported web sign-in page.",
      });
    });
    contents.on("did-start-navigation", () => {
      item.revision++;
      value.onChange({ tabId, loading: true });
    });
    contents.on("did-navigate", (_event, _url, code) => {
      item.responseCode = code;
    });
    contents.on("did-stop-loading", () =>
      value.onChange({
        tabId,
        loading: false,
        url: contents.getURL(),
        title: contents.getTitle(),
      }),
    );
    contents.on("page-title-updated", (_event, title) =>
      value.onChange({ tabId, title }),
    );
    contents.on("render-process-gone", () =>
      value.onChange({
        tabId,
        error:
          "Browser renderer stopped. Close this session and open a fresh one.",
      }),
    );
    contents.setWebRTCIPHandlingPolicy?.("disable_non_proxied_udp");
    await bounded(item, contents.loadURL("about:blank"), 5000);
    contents.debugger.attach("1.3");
    await bounded(item, contents.debugger.sendCommand("Network.enable"), 5000);
    await bounded(item, contents.debugger.sendCommand("Page.enable"), 5000);
    if (value.monitorReadOnly) await setMonitorHuman(id, false);
    await bounded(
      item,
      contents.debugger.sendCommand("Page.setInterceptFileChooserDialog", {
        enabled: true,
      }),
      5000,
    );
    contents.debugger.on("message", (_event, method, params) => {
      if (method === "Page.fileChooserOpened") {
        value.onChange({
          attentionReason:
            "File upload dialogs are blocked in the internal browser.",
        });
        if (params.backendNodeId)
          void contents.debugger
            .sendCommand("DOM.setFileInputFiles", {
              files: [],
              backendNodeId: params.backendNodeId,
            })
            .catch(() => {});
      }
    });
  }
  async function navigate(id, tabId, url) {
    const value = group(id),
      item = tab(id, tabId);
    if (!allowed(value, url))
      throw new Error("Browser destination is blocked.");
    await bounded(item, item.window.webContents.loadURL(url));
  }
  async function monitorCheck(id, tabId, monitor, guard = () => {}) {
    const value = group(id),
      item = tab(id, tabId);
    if (!value.profileId || value.mode !== "private")
      throw new Error(
        "Only a dedicated private monitor profile can be inspected.",
      );
    guard();
    await setMonitorHuman(id, false);
    guard();
    value.monitorOrigin = new URL(monitor.url).origin;
    await navigate(id, tabId, monitor.url);
    guard();
    if ([403, 429].includes(item.responseCode)) return { outcome: "captcha" };
    if (item.responseCode < 200 || item.responseCode >= 400)
      return { outcome: "unavailable" };
    const result = await evaluate(
      item,
      `(${monitorInspection.toString()})(${JSON.stringify({ condition: monitor.condition })})`,
    );
    guard();
    return { outcome: result.outcome };
  }
  async function monitorPrepare(id, tabId, monitor, guard = () => {}) {
    const value = group(id),
      item = tab(id, tabId);
    if (!value.profileId || value.mode !== "private")
      throw new Error("Private monitor profile required.");
    const contents = item.window.webContents;
    guard();
    // Only native HTML fallback forms are supported. No merchant JavaScript
    // handler is permitted to turn an Add-to-cart control into an order.
    await setMonitorHuman(id, false);
    try {
      guard();
      const inspection = await evaluate(
        item,
        `(${monitorInspection.toString()})(${JSON.stringify({ condition: monitor.condition, recipe: monitor.recipe, phase: "cart" })})`,
      );
      guard();
      if (inspection.outcome !== "native_cart_ready")
        return { outcome: inspection.outcome };
      if (new URL(contents.getURL()).href !== monitor.url)
        return { outcome: "unknown" };
      const beforeCart = await evaluate(
        item,
        `(${cartInspection.toString()})(${JSON.stringify({ recipe: monitor.recipe, empty: true })})`,
      );
      guard();
      if (beforeCart.outcome !== "empty_cart")
        return { outcome: "unsupported" };
      // The inspected native form is addressed again by its same document
      // revision. requestSubmit performs HTML validation/default POST, with
      // all merchant script execution disabled. No input or card values leave.
      const revision = item.revision;
      value.cartAttempt = true;
      value.cartSubmission = new URL(monitor.recipe.cartPath, monitor.url).href;
      const selected = await evaluate(
        item,
        `(${monitorInspection.toString()})(${JSON.stringify({ condition: monitor.condition, recipe: monitor.recipe, phase: "cart", submit: true })})`,
      );
      guard();
      if (
        selected.outcome !== "submitted" ||
        (item.revision !== revision && !contents.isLoading())
      )
        return { outcome: "uncertain" };
      await bounded(
        item,
        new Promise((resolve) => {
          if (!contents.isLoading()) return setTimeout(resolve, 150);
          contents.once("did-stop-loading", resolve);
        }),
      );
      guard();
      if (new URL(contents.getURL()).origin !== new URL(monitor.url).origin)
        return { outcome: "uncertain" };
      const afterCart = await evaluate(
        item,
        `(${cartInspection.toString()})(${JSON.stringify({ recipe: monitor.recipe, empty: false })})`,
      );
      guard();
      if (afterCart.outcome !== "exact_cart") return { outcome: "uncertain" };
      await navigate(id, tabId, new URL("/cart", monitor.url).href);
      guard();
      const cart = await evaluate(
        item,
        `(${monitorInspection.toString()})(${JSON.stringify({ recipe: monitor.recipe, phase: "checkout" })})`,
      );
      guard();
      if (cart.outcome !== "native_checkout_ready")
        return { outcome: cart.outcome };
      const checkout = new URL(monitor.recipe.checkoutPath, monitor.url).href;
      value.cartAttempt = false;
      await navigate(id, tabId, checkout);
      guard();
      return { outcome: "checkout" };
    } finally {
      value.cartSubmission = null;
      value.cartAttempt = false;
      // Remain inert until the user explicitly takes private control.
      if (!contents.isDestroyed())
        await contents.debugger
          .sendCommand("Emulation.setScriptExecutionDisabled", { value: true })
          .catch(() => {});
    }
  }
  async function setMonitorHuman(id, enabled) {
    const value = group(id);
    if (!value.profileId) return;
    value.monitorReadOnly = !enabled;
    value.monitorQuiescing = !enabled;
    value.cartSubmission = null;
    try {
      for (const item of value.tabs.values())
        if (!item.window.isDestroyed()) {
          const debug = item.window.webContents.debugger;
          // A page-level script switch does not stop an installed service
          // worker. Bypass its request interception before clearing only its
          // registration/cache; preserve cookies and ordinary login storage.
          if (!enabled)
            await bounded(
              item,
              debug.sendCommand("Emulation.setScriptExecutionDisabled", {
                value: true,
              }),
              5000,
            );
          await bounded(
            item,
            debug.sendCommand("Network.setBypassServiceWorker", {
              bypass: !enabled,
            }),
            5000,
          );
          await bounded(
            item,
            debug.sendCommand("Network.setCacheDisabled", {
              cacheDisabled: !enabled,
            }),
            5000,
          );
          if (enabled)
            await bounded(
              item,
              debug.sendCommand("Emulation.setScriptExecutionDisabled", {
                value: false,
              }),
              5000,
            );
        }
      if (!enabled) await clearMonitorWorkers(value);
    } catch (error) {
      destroy(id);
      throw error;
    } finally {
      value.monitorQuiescing = false;
    }
  }
  async function clearMonitorWorkers(value) {
    let timer;
    value.monitorQuiescing = true;
    try {
      await Promise.race([
        value.session.clearStorageData({
          storages: ["serviceworkers", "cachestorage"],
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Private background-worker cleanup timed out.")),
            5000,
          );
        }),
      ]);
      if (Object.keys(value.session.serviceWorkers.getAllRunning()).length)
        throw new Error(
          "A private background worker remains active; close this session before monitoring.",
        );
    } finally {
      clearTimeout(timer);
      value.monitorQuiescing = false;
    }
  }
  async function evaluate(item, expression) {
    const debug = item.window.webContents.debugger;
    const tree = await bounded(
      item,
      debug.sendCommand("Page.getFrameTree"),
      5000,
    );
    const world = await bounded(
      item,
      debug.sendCommand("Page.createIsolatedWorld", {
        frameId: tree.frameTree.frame.id,
        worldName: "nakama-read-only",
      }),
      5000,
    );
    const result = await bounded(
      item,
      debug.sendCommand("Runtime.evaluate", {
        expression,
        contextId: world.executionContextId,
        returnByValue: true,
        awaitPromise: true,
        silent: true,
        timeout: 3000,
      }),
      5000,
    );
    if (result.exceptionDetails)
      throw new Error("Browser document could not be inspected.");
    return result.result.value;
  }
  async function sensitive(item) {
    return evaluate(item, SENSITIVE_SCRIPT);
  }
  async function read(id, tabId) {
    const value = group(id),
      item = tab(id, tabId);
    if (value.mode === "private")
      throw new Error("Private browser content is unavailable to agents.");
    const result = await evaluate(item, READ_SCRIPT);
    return {
      ...result,
      revision: item.revision,
      url: item.window.webContents.getURL(),
    };
  }
  async function capture(id, tabId, { privateAllowed = false } = {}) {
    const item = tab(id, tabId),
      contents = item.window.webContents;
    const revision = item.revision;
    if (!privateAllowed && (await sensitive(item))) return { sensitive: true };
    const image = await bounded(
      item,
      contents.capturePage(undefined, { stayHidden: true, stayAwake: false }),
      5000,
    );
    if (revision !== item.revision)
      throw new Error("Browser page changed during capture.");
    if (!privateAllowed && (await sensitive(item))) return { sensitive: true };
    const size = image.getSize();
    return {
      jpeg: image.toJPEG(60),
      width: size.width,
      height: size.height,
      revision,
    };
  }
  async function input(id, tabId, input, guard = () => {}) {
    const item = tab(id, tabId),
      contents = item.window.webContents;
    const command = async (method, params) => {
      guard();
      const result = await bounded(
        item,
        contents.debugger.sendCommand(method, params),
        5000,
      );
      guard();
      return result;
    };
    if (input.kind === "tap") {
      const x = Math.round(input.x * 1280),
        y = Math.round(input.y * 800);
      await command("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await command("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
    } else if (input.kind === "scroll") {
      await command("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 640,
        y: 400,
        deltaX: 0,
        deltaY: input.deltaY * 100,
      });
    } else if (input.kind === "text")
      await command("Input.insertText", { text: input.text });
    else if (input.kind === "key") {
      const key = input.key;
      await command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        windowsVirtualKeyCode: KEY_CODES[key],
        ...(key === "Enter" ? { text: "\r" } : {}),
      });
      await command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        windowsVirtualKeyCode: KEY_CODES[key],
      });
    }
  }
  async function element(
    id,
    tabId,
    targetId,
    revision,
    kind,
    text,
    guard = () => {},
  ) {
    const item = tab(id, tabId);
    if (item.revision !== revision || (await sensitive(item)))
      throw new Error(
        "Browser targets changed or login needs human attention.",
      );
    guard();
    const result = await evaluate(
      item,
      `(() => {const e=globalThis.__nakamaTargets?.[${JSON.stringify(Number(targetId))}];if(!e||!e.isConnected)return null;const r=e.getBoundingClientRect();return {x:(r.x+r.width/2)/1280,y:(r.y+r.height/2)/800,href:e.tagName==='A'?e.href:null};})()`,
    );
    guard();
    if (item.revision !== revision) throw new Error("Browser targets changed.");
    if (!result || result.x < 0 || result.x > 1 || result.y < 0 || result.y > 1)
      throw new Error(
        "Target is unavailable or outside the visible page. Read/scroll again.",
      );
    if (kind === "link") return result.href;
    await input(id, tabId, { kind: "tap", x: result.x, y: result.y }, guard);
    if (kind === "type") {
      if (item.revision !== revision || (await sensitive(item))) {
        const error = new Error(
          "The target became sensitive or navigated after focus; human attention is required.",
        );
        error.sensitive = true;
        throw error;
      }
      guard();
      await input(id, tabId, { kind: "text", text }, guard);
    }
    return true;
  }
  function destroy(id) {
    const value = groups.get(id);
    if (!value) return;
    groups.delete(id);
    for (const item of value.tabs.values())
      if (!item.window.isDestroyed()) item.window.destroy();
    value.proxy?.close();
    if (!value.profileId) void value.session.clearStorageData().catch(() => {});
    else void value.session.cookies.flushStore().catch(() => {});
    void value.session.closeAllConnections().catch(() => {});
  }
  return {
    available: true,
    create,
    createTab,
    navigate,
    read,
    capture,
    input,
    element,
    monitorCheck,
    monitorPrepare,
    setMonitorHuman,
    async forgetProfile(profileId) {
      if (!/^[a-f0-9-]{36}$/.test(profileId))
        throw new Error("Invalid private profile.");
      for (const [id, value] of groups)
        if (value.profileId === profileId) destroy(id);
      const isolated = session.fromPartition(
        `persist:nakama-monitor-${profileId}`,
        { cache: false },
      );
      await isolated.clearStorageData();
      await isolated.clearCache();
      await isolated.closeAllConnections();
      await isolated.cookies.flushStore();
    },
    destroy,
    close() {
      for (const id of [...groups.keys()]) destroy(id);
    },
  };
}
module.exports = { createBrowserStudioAdapter };
