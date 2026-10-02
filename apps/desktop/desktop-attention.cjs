// Only generic text and opaque record IDs enter operating-system notifications.
// Clicking resolves current authority in the host; it never stores/replays a URL.
function createDesktopAttention({ Notification, onOpen }) {
  const seen = new Set();
  const visible = new Map();
  function update(attention) {
    const items = (attention?.items || []).filter(
      (item) =>
        ["monitor", "upgrade", "timer"].includes(item.kind) &&
        typeof item.id === "string" &&
        item.id.length <= 300,
    );
    const current = new Set(items.map((item) => item.id));
    for (const [id, notification] of visible)
      if (!current.has(id)) {
        notification.close();
        visible.delete(id);
      }
    if (!Notification.isSupported()) return;
    for (const item of items.slice(-10)) {
      if (seen.has(item.id)) continue;
      const notification = new Notification({
        title:
          item.kind === "timer" ? "A Nakama timer has finished" : item.kind === "monitor"
            ? "A Nakama monitor needs you"
            : "A Nakama upgrade needs review",
        body: item.kind === "timer" ? "Open Clock to dismiss your timer." : "Open Nakama to review securely.",
        silent: false,
      });
      notification.on("click", () => {
        if (visible.get(item.id) === notification) onOpen(item.id);
      });
      notification.on("close", () => {
        if (visible.get(item.id) === notification) visible.delete(item.id);
      });
      visible.set(item.id, notification);
      notification.show();
      seen.add(item.id);
    }
    while (seen.size > 500) seen.delete(seen.values().next().value);
  }
  return {
    update,
    close() {
      for (const notification of visible.values()) notification.close();
      visible.clear();
    },
  };
}
module.exports = { createDesktopAttention };
