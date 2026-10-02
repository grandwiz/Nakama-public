const params = new URLSearchParams(location.search);
document.getElementById("device").textContent = params.get("device") || "Paired Android";
const expires = Date.parse(params.get("expiresAt"));
const update = () => {
  const seconds = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
  document.getElementById("time").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
document.getElementById("stop").addEventListener("click", () => window.remoteSession.stop());
update(); setInterval(update, 500);
