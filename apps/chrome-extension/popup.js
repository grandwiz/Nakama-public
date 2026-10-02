const $ = (id) => document.getElementById(id),
  HOST = "http://127.0.0.1:43111";
let controlGeneration = 0;
async function refresh() {
  const { pairing, lastStatus } = await chrome.storage.local.get([
    "pairing",
    "lastStatus",
  ]);
  const { browserSession, browserControlEpoch = "" } = await chrome.storage.session.get(["browserSession", "browserControlEpoch"]);
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  const active = pairing?.token && granted && browserSession?.pairingToken === pairing.token && browserSession.controlEpoch === browserControlEpoch && browserSession.expiresAt > Date.now();
  $("session").textContent = active
    ? `All ordinary tabs enabled until ${new Date(browserSession.expiresAt).toLocaleTimeString()}. New and navigated tabs are included.`
    : "Browser control is off. Chrome's saved website permission alone does not start a session.";
  $("pair").hidden = !!pairing;
  $("controls").hidden = !pairing;
  $("status").textContent = pairing
    ? lastStatus || `Connected to ${pairing.hostName}. Enable all ordinary tabs to begin.`
    : "Not paired. Open Nakama Control Center on this PC.";
}
function button(id, action) {
  $(id).addEventListener("click", async () => {
    $(id).disabled = true;
    try {
      await action();
    } catch (error) {
      $("status").textContent = error.message;
    } finally {
      $(id).disabled = false;
    }
  });
}
button("connect", async () => {
  let payload;
  try {
    payload = JSON.parse($("ticket").value);
  } catch {
    throw new Error("Paste the complete pairing JSON from Control Center.");
  }
  if (payload.url && payload.url !== HOST)
    throw new Error(`Use a Chrome pairing ticket for ${HOST}.`);
  if (typeof payload.ticket !== "string")
    throw new Error("The pairing ticket is missing.");
  const response = await fetch(HOST + "/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticket: payload.ticket,
      name: "Chrome on this PC",
      platform: "chrome",
      capabilities: [
        "browser_tabs",
        "browser_read",
        "browser_navigate",
        "browser_click",
        "browser_type",
        "browser_select",
        "browser_scroll",
        "browser_screenshot",
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Pairing failed.");
  await chrome.storage.session.remove(["browserSession", "allowedTabs"]);
  await chrome.storage.local.set({
    pairing: result,
    lastStatus: "Paired successfully. Enable all ordinary tabs to begin.",
  });
  $("ticket").value = "";
  await chrome.alarms.create("nakama-poll", { periodInMinutes: 0.5 });
  await refresh();
});
button("allow", async () => {
  const generation = ++controlGeneration;
  // Request directly from this click so Chrome receives a real user gesture.
  const previous = chrome.storage.session.get("browserControlEpoch");
  const request = chrome.permissions.request({ origins: ["<all_urls>"] });
  const { browserControlEpoch = "" } = await previous;
  const granted = await request;
  if (!granted) throw new Error("Website access was not granted. Browser control remains off.");
  const { pairing } = await chrome.storage.local.get("pairing");
  const latest = await chrome.storage.session.get("browserControlEpoch");
  if (generation !== controlGeneration || (latest.browserControlEpoch || "") !== browserControlEpoch) return;
  if (!pairing?.token) throw new Error("Pair this browser first.");
  const browserSession = { id: crypto.randomUUID(), pairingToken: pairing.token, controlEpoch: browserControlEpoch,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000 };
  await chrome.storage.session.remove(["browserSession", "allowedTabs"]);
  await chrome.storage.session.set({ browserSession });
  const { pairing: current } = await chrome.storage.local.get("pairing");
  const state = await chrome.storage.session.get(["browserSession", "browserControlEpoch"]);
  if (generation !== controlGeneration || current?.token !== pairing.token || (state.browserControlEpoch || "") !== browserControlEpoch) {
    if (state.browserSession?.id === browserSession.id) await chrome.storage.session.remove("browserSession");
    return;
  }
  await chrome.storage.local.set({ lastStatus: "All ordinary tabs enabled for two hours. Protected and private pages remain excluded." });
  await chrome.runtime.sendMessage({ type: "poll" });
  await refresh();
});
button("poll", async () => {
  await chrome.runtime.sendMessage({ type: "poll" });
  await refresh();
});
button("stop", async () => {
  ++controlGeneration;
  await chrome.storage.session.set({ browserControlEpoch: crypto.randomUUID() });
  await chrome.storage.session.remove(["browserSession", "allowedTabs"]);
  await chrome.storage.local.set({
    lastStatus: "Stopped. No tabs are accessible to Nakama. Chrome remembers its website grant until you remove it in extension settings.",
  });
  await refresh();
});
button("disconnect", async () => {
  ++controlGeneration;
  await chrome.storage.session.set({ browserControlEpoch: crypto.randomUUID() });
  await chrome.storage.local.remove(["pairing", "receipts"]);
  await chrome.storage.session.remove(["browserSession", "allowedTabs"]);
  await chrome.storage.local.set({
    lastStatus:
      "Disconnected locally. Revoke this browser in Control Center to invalidate its credential.",
  });
  await refresh();
});
refresh();
