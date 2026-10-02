import { useEffect, useState } from "react";
import { api } from "./bridge";
import { useNakama } from "./context";

type App = { packageName: string; label: string };
type Catalog = { deviceId: string; apps: App[]; available: boolean; expiresAt?: string };
// One poll per device, shared by selectors and monitor cards. Last reader clears memory.
const readers = new Map<string, { value?: Catalog; listeners: Set<(value?: Catalog) => void>; stop: () => void }>();
function subscribe(deviceId: string, listener: (value?: Catalog) => void) {
  let entry = readers.get(deviceId);
  if (!entry) {
    let stopped = false, fetching = false;
    const current = { value: undefined as Catalog | undefined, listeners: new Set<(value?: Catalog) => void>(), stop: () => {} };
    const emit = () => current.listeners.forEach((reader) => reader(current.value));
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const value = await api<Catalog>("GET", `/api/devices/${encodeURIComponent(deviceId)}/apps`);
        if (!stopped) { current.value = value.deviceId === deviceId ? value : undefined; emit(); }
      } catch { if (!stopped) { current.value = undefined; emit(); } }
      finally { fetching = false; }
    };
    const poll = window.setInterval(() => void refresh(), 5000);
    const expiry = window.setInterval(() => {
      if (current.value && Date.parse(current.value.expiresAt || "") <= Date.now()) { current.value = undefined; emit(); }
    }, 1000);
    current.stop = () => { stopped = true; clearInterval(poll); clearInterval(expiry); };
    entry = current;
    readers.set(deviceId, entry);
    void refresh();
  }
  const owned = entry;
  owned.listeners.add(listener); listener(owned.value);
  return () => {
    owned.listeners.delete(listener);
    if (!owned.listeners.size) { owned.stop(); readers.delete(deviceId); }
  };
}
export function useInstalledApps(deviceId: string) {
  const { state } = useNakama();
  const device = state.devices.find((item) => item.id === deviceId);
  const allowed = device?.platform === "android" && device.permissions?.googleAccess !== false && device.permissions?.projectAccess !== false;
  const [catalog, setCatalog] = useState<Catalog>();
  useEffect(() => {
    setCatalog(undefined);
    if (!allowed) return;
    return subscribe(deviceId, setCatalog);
  }, [deviceId, allowed]);
  const available = Boolean(allowed && catalog?.deviceId === deviceId && catalog.available && Date.parse(catalog.expiresAt || "") > Date.now());
  return { apps: available ? catalog!.apps : [], available };
}

export function InstalledAppSelect({ deviceId, value, onChange, controlOnly = false }: {
  deviceId: string; value: string; onChange: (value: string) => void; controlOnly?: boolean;
}) {
  const { apps, available } = useInstalledApps(deviceId);
  const choices = controlOnly ? apps.filter((app) => app.packageName !== "dev.nakama.companion" &&
    !app.packageName.startsWith("com.android.") && !app.packageName.startsWith("com.google.android.permissioncontroller") &&
    !/packageinstaller|systemui|settings/i.test(app.packageName)) : apps;
  const selected = choices.some((app) => app.packageName === value) ? value : "";
  return <>
    <select aria-label="Installed app" required value={selected} disabled={!available || !choices.length} onChange={(event) => onChange(event.target.value)}>
      <option value="">{available ? "Choose an installed app" : "Open Nakama on this device to refresh apps"}</option>
      {choices.map((app) => <option key={app.packageName} value={app.packageName}>
        {app.label}{choices.filter((other) => other.label === app.label).length > 1 ? ` (${app.packageName})` : ""}
      </option>)}
    </select>
    <small>{!available ? "App names are available while the paired app is connected with shared access enabled." : !choices.length ? "No eligible launchable apps were reported." : "Only apps visible to Nakama on this device are listed. Control still needs separate phone consent."}</small>
  </>;
}

export function InstalledAppName({ deviceId, packageName }: { deviceId: string; packageName: string }) {
  const { apps } = useInstalledApps(deviceId);
  return <>{apps.find((app) => app.packageName === packageName)?.label || "Selected Android app"}</>;
}
