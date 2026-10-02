import { ApiError } from "./security.mjs";

export function assertPersonalAccess(state, principal) {
  if (principal?.kind === "owner") return;
  const device = state.devices.find((item) => item.id === principal?.id);
  if (
    principal?.kind !== "device" ||
    !device ||
    device.platform !== "android" ||
    device.permissions?.googleAccess === false ||
    device.permissions?.projectAccess === false
  )
    throw new ApiError(
      403,
      "Personal boards and memory are unavailable while shared personal access is disabled for this device.",
    );
}
