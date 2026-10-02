const $ = (id) => document.getElementById(id),
  HOST = "http://127.0.0.1:43111";
async function refresh() {
  const { pairing, lastStatus } = await chrome.storage.local.get([
    "pairing",
    "lastStatus",
  ]);
  $("pair").hidden = !!pairing;
  $("controls").hidden = !pairing;
  $("status").textContent = pairing
    ? lastStatus || `Connected to ${pairing.hostName}. Allow a tab to begin.`
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
  await chrome.storage.local.set({
    pairing: result,
    lastStatus: "Paired successfully. Choose a tab to allow.",
  });
  $("ticket").value = "";
  await chrome.alarms.create("nakama-poll", { periodInMinutes: 0.5 });
  await refresh();
});
button("allow", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.hostname === "127.0.0.1"
  )
    throw new Error("Choose a normal website tab.");
  const granted = await chrome.permissions.request({
    origins: [url.origin + "/*"],
  });
  if (!granted) throw new Error("Website access was not granted.");
  const { allowedTabs = {} } = await chrome.storage.session.get("allowedTabs");
  allowedTabs[tab.id] = {
    origin: url.origin,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  };
  await chrome.storage.session.set({ allowedTabs });
  await chrome.storage.local.set({
    lastStatus: `Allowed ${url.hostname} for two hours. Tab ID: ${tab.id}.`,
  });
  await chrome.runtime.sendMessage({ type: "poll" });
  await refresh();
});
button("poll", async () => {
  await chrome.runtime.sendMessage({ type: "poll" });
  await refresh();
});
button("stop", async () => {
  await chrome.storage.session.remove("allowedTabs");
  await chrome.storage.local.set({
    lastStatus: "Stopped. No tabs are currently allowed.",
  });
  await refresh();
});
button("disconnect", async () => {
  await chrome.storage.local.remove(["pairing", "receipts"]);
  await chrome.storage.session.remove("allowedTabs");
  await chrome.storage.local.set({
    lastStatus:
      "Disconnected locally. Revoke this browser in Control Center to invalidate its credential.",
  });
  await refresh();
});
refresh();
