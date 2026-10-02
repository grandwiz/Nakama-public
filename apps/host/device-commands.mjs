import { ApiError, digest } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { originId } from "./device-delivery.mjs";

export const DEVICE_CONNECTED_MS = 90_000;
const normal = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/\s+/g, " ");
export function permittedTarget(state, id) {
  const device = state.devices.find((item) => item.id === id);
  if (
    !device ||
    device.platform !== "android" ||
    device.permissions?.googleAccess === false ||
    device.permissions?.projectAccess === false
  )
    throw new ApiError(
      403,
      "That Android device is unavailable or its shared access is disabled.",
    );
  return device;
}
export function resolveDeviceTarget(
  state,
  principal,
  { targetDeviceId, targetDeviceName } = {},
  { desktop = true, connected = true } = {},
) {
  assertPersonalAccess(state, principal);
  if (
    targetDeviceId !== undefined &&
    (typeof targetDeviceId !== "string" || !targetDeviceId)
  )
    throw new ApiError(400, "Choose an exact device ID.");
  if (
    targetDeviceName !== undefined &&
    (typeof targetDeviceName !== "string" ||
      !targetDeviceName.trim() ||
      targetDeviceName.length > 80)
  )
    throw new ApiError(400, "Use the complete connected device name.");
  const choices = [
    { id: "desktop", name: "Nakama PC", platform: "desktop" },
    ...state.devices.filter((item) => item.platform === "android"),
  ];
  let chosen;
  if (targetDeviceName !== undefined) {
    const name = normal(targetDeviceName),
      aliases = ["pc", "desktop", "this pc", "nakama pc"];
    const matching = choices.filter(
      (item) =>
        normal(item.name) === name ||
        (item.id === "desktop" && aliases.includes(name)),
    );
    if (matching.length !== 1)
      throw new ApiError(
        409,
        matching.length
          ? "Several devices have that name. Choose one exact device in Devices."
          : "No paired device has that exact name. Nothing was sent.",
      );
    chosen = matching[0];
    if (targetDeviceId !== undefined && chosen.id !== targetDeviceId)
      throw new ApiError(
        409,
        "The device name and selected identity no longer match.",
      );
  } else
    chosen = choices.find(
      (item) => item.id === (targetDeviceId || originId(principal)),
    );
  if (!chosen)
    throw new ApiError(
      404,
      "The selected device no longer exists. Nothing was sent.",
    );
  if (chosen.id === "desktop") {
    if (!desktop)
      throw new ApiError(
        400,
        "Choose the Android device that should perform this action.",
      );
    return chosen;
  }
  permittedTarget(state, chosen.id);
  if (
    connected &&
    chosen.id !== originId(principal) &&
    !(
      Date.now() - Date.parse(chosen.lastSeen) >= 0 &&
      Date.now() - Date.parse(chosen.lastSeen) < DEVICE_CONNECTED_MS
    )
  )
    throw new ApiError(
      409,
      "The selected device is not currently connected. Nothing was sent.",
    );
  return chosen;
}
export class DeviceCommands {
  #authority = new WeakMap();
  #requests = new Map();
  constructor(host) {
    this.host = host;
  }
  directory(principal) {
    assertPersonalAccess(this.host.store.state, principal);
    return {
      sourceDeviceId: originId(principal),
      devices: [
        {
          id: "desktop",
          name: "Nakama PC",
          platform: "desktop",
          connected: true,
        },
        ...this.host.store.state.devices
          .filter(
            (item) =>
              item.platform === "android" &&
              item.permissions?.googleAccess !== false &&
              item.permissions?.projectAccess !== false,
          )
          .map((item) => ({
            id: item.id,
            name: item.name,
            platform: "android",
            connected:
              Date.now() - Date.parse(item.lastSeen) >= 0 &&
              Date.now() - Date.parse(item.lastSeen) < DEVICE_CONNECTED_MS,
          })),
      ],
    };
  }
  guard(record, principal) {
    assertPersonalAccess(this.host.store.state, principal);
    const target = resolveDeviceTarget(this.host.store.state, principal, {
      targetDeviceId: record.deviceId,
      ...(record.targetDeviceName
        ? { targetDeviceName: record.targetDeviceName }
        : {}),
    });
    if (target.id !== record.deviceId)
      throw new ApiError(409, "The target changed. Nothing was sent.");
    return target;
  }
  authorized(token, body, principal) {
    const record = token && this.#authority.get(token);
    if (
      !record ||
      record.requestedBy !== originId(principal) ||
      record.deviceId !== body.deviceId ||
      record.type !== body.type ||
      record.argsDigest !== digest(JSON.stringify(body.args))
    )
      return null;
    this.guard(record, principal);
    return record;
  }
  async route(body, principal) {
    if (
      body.inputMode !== undefined &&
      !["voice", "text"].includes(body.inputMode)
    )
      throw new ApiError(400, "Choose voice or text input mode.");
    const requestId = body.requestId ?? body.args?.requestId;
    if (
      requestId !== undefined &&
      (typeof requestId !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(requestId))
    )
      throw new ApiError(400, "Invalid command request ID.");
    if (
      body.requestId &&
      body.args?.requestId &&
      body.requestId !== body.args.requestId
    )
      throw new ApiError(400, "The command request IDs must match.");
    if (!requestId) {
      const result = await this.execute(body, principal);
      assertPersonalAccess(this.host.store.state, principal);
      return result;
    }
    const key = `${originId(principal)}:${requestId}`;
    const signature = digest(
      JSON.stringify([
        body.command,
        body.targetDeviceId || null,
        body.targetDeviceName || null,
        body.args,
      ]),
    );
    const pending = this.#requests.get(key);
    if (pending) {
      if (pending.signature !== signature)
        throw new ApiError(
          409,
          "That request ID is already being used for another command.",
        );
      const result = await pending.promise;
      assertPersonalAccess(this.host.store.state, principal);
      return result;
    }
    const promise = this.execute(
      {
        ...body,
        requestId,
        ...(body.command === "timer"
          ? { args: { ...body.args, requestId } }
          : {}),
      },
      principal,
    );
    this.#requests.set(key, { signature, promise });
    try {
      const result = await promise;
      assertPersonalAccess(this.host.store.state, principal);
      return result;
    } finally {
      this.#requests.delete(key);
    }
  }
  async execute(body, principal) {
    assertPersonalAccess(this.host.store.state, principal);
    if (
      Object.keys(body).some(
        (key) =>
          ![
            "command",
            "targetDeviceId",
            "targetDeviceName",
            "args",
            "requestId",
            "inputMode",
          ].includes(key),
      ) ||
      !["open_app", "timer"].includes(body.command) ||
      !body.args ||
      typeof body.args !== "object" ||
      Array.isArray(body.args)
    )
      throw new ApiError(
        400,
        "Choose one app or timer command and its exact target.",
      );
    const target = resolveDeviceTarget(this.host.store.state, principal, body, {
      desktop: body.command === "timer",
    });
    if (
      body.requestId &&
      target.id !== "desktop" &&
      this.host.store.state.clock.requests.some(
        (entry) =>
          entry.key === digest(`${originId(principal)}:${body.requestId}`),
      )
    )
      throw new ApiError(
        409,
        "That request ID was already used for a PC timer. Choose a fresh request deliberately.",
      );
    let args, type;
    if (body.command === "open_app") {
      if (
        Object.keys(body.args).some((key) => key !== "appName") ||
        typeof body.args.appName !== "string" ||
        !body.args.appName.trim() ||
        body.args.appName.length > 120
      )
        throw new ApiError(400, "State the installed app's display name.");
      const catalog = this.host.installedApps.list(target.id, {
        kind: "owner",
        id: "desktop",
      });
      if (!catalog.available)
        throw new ApiError(
          409,
          "Open Nakama on the target device to refresh its installed apps. Nothing was sent.",
        );
      const matches = catalog.apps.filter(
        (app) => normal(app.label) === normal(body.args.appName),
      );
      if (matches.length !== 1)
        throw new ApiError(
          409,
          matches.length
            ? "Several installed apps have that name. Select the exact app on the target device."
            : "That app is not in the target device's current installed app list.",
        );
      type = "open_app";
      args = { packageName: matches[0].packageName };
    } else {
      if (
        Object.keys(body.args).some(
          (key) => !["durationSeconds", "title", "requestId"].includes(key),
        ) ||
        !Number.isSafeInteger(body.args.durationSeconds) ||
        body.args.durationSeconds < 1 ||
        body.args.durationSeconds > 604800 ||
        (body.args.title !== undefined &&
          (typeof body.args.title !== "string" ||
            body.args.title.length > 80 ||
            /[\p{Cc}\p{Cf}]/u.test(body.args.title))) ||
        (body.args.requestId !== undefined &&
          (typeof body.args.requestId !== "string" ||
            !/^[A-Za-z0-9_-]{1,100}$/.test(body.args.requestId)))
      )
        throw new ApiError(
          400,
          "Choose a timer from one second to seven days with a short plain name.",
        );
      if (target.id === "desktop") {
        if (
          body.requestId &&
          (this.host.store.state.actions.some(
            (action) =>
              action.requestedBy === originId(principal) &&
              action.explicitTarget?.requestId === body.requestId,
          ) ||
            this.host.store.state.approvals.some(
              (approval) =>
                approval.requestedBy === originId(principal) &&
                approval.operation?.explicitTarget?.requestId ===
                  body.requestId,
            ))
        )
          throw new ApiError(
            409,
            "That request ID was already used for an Android command. Choose a fresh request deliberately.",
          );
        const result = await this.host.clockTimers.createForTarget(
          body.args,
          principal,
        );
        return {
          ...result,
          targetDeviceId: "desktop",
          deliveryDeviceId: originId(principal),
          reply: result.repeated
            ? `That PC timer request is already ${result.timer.status}.`
            : `Started “${result.timer.title}” on Nakama PC. Keep the PC awake and Nakama running for its alert.`,
        };
      }
      type = "timer_start";
      args = {
        durationSeconds: body.args.durationSeconds,
        title: body.args.title || "Timer",
        ...(body.args.requestId ? { requestId: body.args.requestId } : {}),
      };
    }
    const record = {
      deviceId: target.id,
      requestedBy: originId(principal),
      ...(body.targetDeviceName
        ? { targetDeviceName: body.targetDeviceName }
        : {}),
      type,
      argsDigest: digest(JSON.stringify(args)),
      ...(body.requestId ? { requestId: body.requestId } : {}),
    };
    if (record.requestId) {
      const prior = this.host.store.state.actions.find(
        (action) =>
          action.requestedBy === record.requestedBy &&
          action.explicitTarget?.requestId === record.requestId,
      );
      const approval = this.host.store.state.approvals.find(
        (entry) =>
          entry.type === "device_action" &&
          entry.requestedBy === record.requestedBy &&
          entry.operation?.explicitTarget?.requestId === record.requestId,
      );
      const saved = prior || approval?.operation;
      if (saved) {
        if (
          saved.deviceId !== record.deviceId ||
          saved.type !== record.type ||
          saved.explicitTarget.argsDigest !== record.argsDigest
        )
          throw new ApiError(
            409,
            "That request ID was already used for another command or target.",
          );
        return {
          id: prior?.id || approval.id,
          status: prior?.status || approval.status,
          ...(approval && !prior ? { type: "device_action" } : {}),
          repeated: true,
          targetDeviceId: target.id,
          deliveryDeviceId: originId(principal),
          reply: `That command was already requested for ${target.name}; its status is ${prior?.status || approval.status}. No second action was queued.`,
        };
      }
    }
    const token = {};
    this.#authority.set(token, record);
    try {
      const result = await this.host.enqueueAction(
        { deviceId: target.id, type, args },
        principal,
        token,
      );
      return {
        ...result,
        targetDeviceId: target.id,
        deliveryDeviceId: originId(principal),
        reply:
          result.type === "device_action"
            ? `Requested PC approval for ${target.name}. Nothing has been sent to that device yet.`
            : `Queued ${body.command === "timer" ? "the timer" : body.args.appName} for ${target.name}. It has not been confirmed by that device yet.`,
      };
    } finally {
      this.#authority.delete(token);
    }
  }
}
