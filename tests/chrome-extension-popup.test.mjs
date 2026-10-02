import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../apps/chrome-extension/popup.js", import.meta.url), "utf8");
function fixture({ shared, request } = {}) {
  const state = shared || { local: { pairing: { token: "fixture-token", hostName: "Fixture PC" } }, session: {}, granted: false };
  const elements = new Map(), requests = [], messages = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", value: "", hidden: false, disabled: false,
      addEventListener(type, handler) { this[type] = handler; } });
    return elements.get(id);
  };
  const area = (values) => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(values[key])])); },
    async set(update) { Object.assign(values, structuredClone(update)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  });
  const chrome = {
    storage: { local: area(state.local), session: area(state.session) },
    permissions: { contains: async () => state.granted, request: async (options) => {
      requests.push(structuredClone(options));
      const granted = request ? await request(options) : true;
      if (granted) state.granted = true;
      return granted;
    } },
    runtime: { sendMessage: async (message) => { messages.push(message); return { ok: true }; } },
  };
  const context = vm.createContext({ chrome, document: { getElementById: element }, Date, crypto, URL, console });
  vm.runInContext(source.replace(/refresh\(\);\s*$/, ""), context);
  return { state, elements, requests, messages, chrome, refresh: () => context.refresh(), click: (id) => element(id).click() };
}

test("popup requests Chrome's all-sites grant once per explicit session and never enrolls individual tabs", async () => {
  const f = fixture(); await f.refresh();
  assert.match(f.elements.get("session").textContent, /off/);
  await f.click("allow");
  assert.deepEqual(f.requests, [{ origins: ["<all_urls>"] }]);
  assert.equal(f.state.session.browserSession.pairingToken, "fixture-token");
  assert.ok(f.state.session.browserSession.expiresAt > Date.now());
  assert.equal(f.state.session.allowedTabs, undefined);
  assert.match(f.elements.get("session").textContent, /All ordinary tabs enabled/);
  await f.click("stop");
  assert.equal(f.state.session.browserSession, undefined);
  assert.equal(f.state.granted, true); // Chrome permission persists; active authority does not.
  await f.refresh(); assert.match(f.elements.get("session").textContent, /off/);
  await f.click("allow");
  assert.equal(f.state.session.browserSession.controlEpoch, f.state.session.browserControlEpoch);
});

test("denying the Chrome grant leaves the session off and gives setup feedback", async () => {
  const f = fixture({ request: async () => false });
  await f.click("allow");
  assert.equal(f.state.session.browserSession, undefined);
  assert.match(f.elements.get("status").textContent, /not granted/);
  assert.equal(f.messages.length, 0);
});

for (const stopAction of ["stop", "disconnect"])
  test(`${stopAction} in a second popup invalidates an outstanding permission prompt`, async () => {
    let resolve;
    const prompt = new Promise((done) => { resolve = done; });
    const first = fixture({ request: () => prompt });
    const second = fixture({ shared: first.state });
    const enabling = first.click("allow");
    await second.click(stopAction);
    resolve(true); await enabling;
    assert.equal(first.state.session.browserSession, undefined);
    assert.equal(first.messages.length, 0);
  });

test("Stop invalidates a session even if its pending storage write completes later", async () => {
  const f = fixture(); const other = fixture({ shared: f.state });
  const set = f.chrome.storage.session.set;
  let finish, started;
  const written = new Promise((resolve) => { started = resolve; });
  const wait = new Promise((resolve) => { finish = resolve; });
  f.chrome.storage.session.set = async (value) => {
    if (value.browserSession) { started(); await wait; }
    return set(value);
  };
  const enabling = f.click("allow"); await written;
  await other.click("stop"); finish(); await enabling;
  assert.equal(f.state.session.browserSession, undefined);
  assert.equal(f.messages.length, 0);
});

test("saved website permission never starts a new browser session after restart", async () => {
  const f = fixture(); f.state.granted = true;
  await f.refresh();
  assert.equal(f.state.session.browserSession, undefined);
  assert.match(f.elements.get("session").textContent, /off/);
  assert.equal(f.requests.length, 0);
});

test("manifest makes broad website access optional and excludes incognito", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../apps/chrome-extension/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.equal(manifest.incognito, "not_allowed");
});
