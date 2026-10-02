import { ApiError, now, requireOwner, text, uid } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
const LOGIN = Object.freeze({
  github: "https://github.com/settings/tokens",
  vercel: "https://vercel.com/account/settings/tokens",
  render: "https://dashboard.render.com/u/settings",
  neon: "https://console.neon.tech/app/settings/api-keys",
  namecheap: "https://ap.www.namecheap.com/settings/tools/apiaccess/",
});
const keys = (body, allowed) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw new ApiError(400, "Unexpected connection handoff fields.");
};
export class ConnectionHandoffs {
  constructor(host) {
    this.host = host;
    this.requests = new Map();
    this.pending = new Set();
  }
  device(id) {
    const device = this.host.device(id);
    assertPersonalAccess(this.host.store.state, { kind: "device", id });
    if (
      device.platform !== "android" ||
      device.permissions?.browserControl !== true
    )
      throw new ApiError(
        403,
        "Enable browser control for this trusted Android device first.",
      );
    return device;
  }
  public(principal) {
    try {
      assertPersonalAccess(this.host.store.state, principal);
    } catch {
      return [];
    }
    if (principal.kind === "device") {
      try {
        this.device(principal.id);
      } catch {
        return [];
      }
    }
    return [...this.requests.values()]
      .filter((r) => principal.kind === "owner" || r.deviceId === principal.id)
      .map((r) => ({
        ...r,
        status:
          r.status === "waiting" && Date.parse(r.expiresAt) <= Date.now()
            ? "expired"
            : r.status,
      }));
  }
  async request(body, principal) {
    requireOwner(principal);
    keys(body, ["provider", "deviceId", "accountLabel"]);
    this.device(body.deviceId);
    if (!Object.hasOwn(LOGIN, body.provider))
      throw new ApiError(
        400,
        "Choose GitHub, Vercel, Render, Neon or Namecheap.",
      );
    const record = {
      id: uid(),
      provider: body.provider,
      deviceId: body.deviceId,
      accountLabel: text(body.accountLabel, "Account label", 120),
      status: "waiting",
      loginUrl: LOGIN[body.provider],
      createdAt: now(),
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
    };
    for (const [id, r] of this.requests)
      if (Date.parse(r.expiresAt) <= Date.now()) this.requests.delete(id);
    if (this.requests.size >= 12)
      throw new ApiError(
        409,
        "Complete or cancel an existing connection request first.",
      );
    this.requests.set(record.id, record);
    return { ...record };
  }
  get(id, principal) {
    const record = this.requests.get(id);
    if (!record) throw new ApiError(404, "Connection request not found.");
    if (principal.kind !== "owner" && principal.id !== record.deviceId)
      throw new ApiError(
        403,
        "This connection request belongs to another device.",
      );
    this.device(record.deviceId);
    if (
      record.status !== "waiting" ||
      Date.parse(record.expiresAt) <= Date.now()
    )
      throw new ApiError(
        409,
        "This connection request is expired or already used.",
      );
    return record;
  }
  async complete(id, body, principal) {
    keys(body, ["token", "accountLabel"]);
    const record = this.get(id, principal);
    if (this.pending.has(id))
      throw new ApiError(
        409,
        "This connection request is already being saved.",
      );
    this.pending.add(id);
    try {
      const token = text(body.token, "Provider API credential", 16000),
        accountLabel = text(
          body.accountLabel || record.accountLabel,
          "Account label",
          120,
        );
      if (record.provider === "namecheap") {
        let value;
        try {
          value = JSON.parse(token);
        } catch {
          throw new ApiError(
            400,
            "Namecheap needs JSON with apiUser, apiKey, userName and whitelisted clientIp.",
          );
        }
        keys(value, ["apiUser", "apiKey", "userName", "clientIp"]);
        if (
          ["apiUser", "apiKey", "userName", "clientIp"].some(
            (key) => typeof value[key] !== "string" || !value[key],
          )
        )
          throw new ApiError(
            400,
            "Complete every Namecheap API credential field.",
          );
      }
      this.get(id, principal);
      // The owner issued this one-use, provider/device-bound capability. It only
      // adds a new vault account; it cannot alter or reveal existing credentials.
      const result = await this.host.connection(
        record.provider,
        "",
        { accountLabel, token },
        { kind: "owner", id: "desktop" },
        () => this.get(id, principal),
      );
      record.status = "saved";
      record.savedAt = now();
      record.accountId = result.accountId;
      return { saved: true, accountId: result.accountId };
    } finally {
      this.pending.delete(id);
    }
  }
  cancel(id, principal) {
    const record = this.requests.get(id);
    if (!record) throw new ApiError(404, "Connection request not found.");
    if (principal.kind !== "owner" && principal.id !== record.deviceId)
      throw new ApiError(403, "Connection request belongs to another device.");
    record.status = "cancelled";
    return { cancelled: true };
  }
}
