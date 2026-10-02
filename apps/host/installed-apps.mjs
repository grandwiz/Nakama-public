import { ApiError, requireOwner } from "./security.mjs";

export const APP_CATALOG_TTL_MS = 90_000;
const packagePattern = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export function validateInstalledApps(value) {
  if (!Array.isArray(value) || value.length > 1000)
    throw new ApiError(400, "Provide at most 1000 launchable apps.");
  const seen = new Set();
  return value.map((app) => {
    if (!app || typeof app !== "object" || Array.isArray(app) ||
        Object.keys(app).some((key) => !["packageName", "label"].includes(key)) ||
        typeof app.packageName !== "string" || app.packageName.length > 200 ||
        !packagePattern.test(app.packageName) || seen.has(app.packageName) ||
        typeof app.label !== "string" || !app.label.trim() || app.label.length > 120 ||
        /[\p{Cc}\p{Cf}]/u.test(app.label))
      throw new ApiError(400, "Each app needs a unique package and a plain display name.");
    seen.add(app.packageName);
    return { packageName: app.packageName, label: app.label.trim() };
  }).sort((a, b) => a.label.localeCompare(b.label) || a.packageName.localeCompare(b.packageName));
}

/** Volatile owner-only picker metadata; never part of shared state or model context. */
export class InstalledApps {
  constructor(host, clock = Date.now) { this.host = host; this.clock = clock; this.catalogs = new Map(); }
  forget(id) { this.catalogs.delete(id); }
  device(id) {
    const device = this.host.device(id);
    if (device.platform !== "android" || device.permissions?.projectAccess === false || device.permissions?.googleAccess === false) {
      this.forget(id);
      throw new ApiError(403, "App lists require a paired Android with shared access enabled.");
    }
    return device;
  }
  publish(body, principal) {
    if (principal.kind !== "device") throw new ApiError(403, "Only the paired Android can supply its own app list.");
    this.device(principal.id);
    if (Object.keys(body).some((key) => key !== "apps")) throw new ApiError(400, "App lists are scoped to the sending device.");
    const apps = validateInstalledApps(body.apps);
    const updatedAt = this.clock();
    this.catalogs.set(principal.id, { apps, updatedAt });
    return { recorded: true };
  }
  list(id, principal) {
    requireOwner(principal);
    this.device(id);
    const catalog = this.catalogs.get(id);
    if (!catalog || this.clock() - catalog.updatedAt >= APP_CATALOG_TTL_MS || this.clock() < catalog.updatedAt) {
      this.forget(id);
      return { deviceId: id, apps: [], available: false };
    }
    return { deviceId: id, apps: structuredClone(catalog.apps), available: true,
      expiresAt: new Date(catalog.updatedAt + APP_CATALOG_TTL_MS).toISOString() };
  }
}
