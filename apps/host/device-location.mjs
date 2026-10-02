import { ApiError, now } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";

export class DeviceLocations {
  constructor(host) {
    this.host = host;
  }
  own(principal) {
    assertPersonalAccess(this.host.store.state, principal);
    if (principal.kind !== "device")
      throw new ApiError(
        403,
        "Only the paired phone can grant location consent or upload its own location.",
      );
    return this.host.device(principal.id);
  }
  public(principal) {
    if (principal.kind === "owner")
      return structuredClone(this.host.store.state.deviceLocations);
    try {
      this.own(principal);
    } catch {
      return [];
    }
    return structuredClone(
      this.host.store.state.deviceLocations.filter(
        (item) => item.deviceId === principal.id,
      ),
    );
  }
  revoke(deviceId) {
    return this.host.store.change((state) => {
      state.deviceLocations = state.deviceLocations.filter(
        (item) => item.deviceId !== deviceId,
      );
    });
  }
  async route(method, route, body, principal) {
    const device = this.own(principal);
    if (method === "GET" && route === "/api/device/location")
      return (
        this.public(principal)[0] || { deviceId: device.id, enabled: false }
      );
    if (
      (method === "DELETE" && route === "/api/device/location") ||
      (method === "POST" && route === "/api/device/location/consent")
    ) {
      if (
        method === "POST" &&
        (Object.keys(body).length !== 1 || typeof body.enabled !== "boolean")
      )
        throw new ApiError(
          400,
          "Location consent needs enabled true or false.",
        );
      if (method === "DELETE" && Object.keys(body).length)
        throw new ApiError(400, "Location removal takes no additional fields.");
      return this.host.store.change((state) => {
        this.own(principal);
        state.deviceLocations = state.deviceLocations.filter(
          (item) => item.deviceId !== device.id,
        );
        const value = {
          deviceId: device.id,
          enabled: method === "POST" && body.enabled,
          updatedAt: now(),
        };
        state.deviceLocations.push(value);
        return value;
      });
    }
    if (method === "POST" && route === "/api/device/location") {
      if (
        Object.keys(body).sort().join(",") !==
          "accuracy,latitude,longitude,observedAt" ||
        !Number.isFinite(body.latitude) ||
        Math.abs(body.latitude) > 90 ||
        !Number.isFinite(body.longitude) ||
        Math.abs(body.longitude) > 180 ||
        !Number.isFinite(body.accuracy) ||
        body.accuracy < 0 ||
        body.accuracy > 100000 ||
        typeof body.observedAt !== "string" ||
        !Number.isFinite(Date.parse(body.observedAt)) ||
        Date.parse(body.observedAt) > Date.now() + 60000 ||
        Date.parse(body.observedAt) < Date.now() - 86400000
      )
        throw new ApiError(
          400,
          "Provide valid coordinates, accuracy in metres and an observation timestamp from the last 24 hours.",
        );
      return this.host.store.change((state) => {
        this.own(principal);
        const record = state.deviceLocations.find(
          (item) => item.deviceId === device.id,
        );
        if (!record?.enabled)
          throw new ApiError(
            403,
            "Enable location sharing on this phone before uploading.",
          );
        if (
          record.lastKnown &&
          Date.parse(body.observedAt) < Date.parse(record.lastKnown.observedAt)
        )
          throw new ApiError(409, "A newer location is already saved.");
        record.lastKnown = { ...body, receivedAt: now() };
        record.updatedAt = now();
        return structuredClone(record);
      });
    }
    throw new ApiError(404, "Location operation not found.");
  }
}
