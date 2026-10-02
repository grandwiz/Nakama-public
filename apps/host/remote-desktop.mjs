import { ApiError, uid } from "./security.mjs";

const SESSION_MS = 120_000;
const IDLE_MS = 15_000;
const FRAME_MS = 3_000;
const KEYS = new Set(["Enter", "Escape", "Backspace", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Delete"]);
const DETAILS = "Touch control of your unlocked Windows desktop. Two-minute sessions; Stop is available on both devices. Secure desktops, elevated apps and Nakama approval controls are unavailable. Screen images are transient and never sent to an AI.";

function normalized(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new ApiError(400, `${label} must be a normalized screen coordinate.`);
  return value;
}

export function validateRemoteInput(body) {
  const input = { kind: body.kind };
  if (["tap", "double_tap", "right_click", "drag", "scroll"].includes(body.kind)) {
    input.x = normalized(body.x, "x");
    input.y = normalized(body.y, "y");
    if (body.kind === "drag") {
      input.endX = normalized(body.endX, "endX");
      input.endY = normalized(body.endY, "endY");
    }
    if (body.kind === "scroll") {
      if (!Number.isInteger(body.deltaY) || !body.deltaY || Math.abs(body.deltaY) > 10)
        throw new ApiError(400, "Scroll must contain 1–10 wheel steps.");
      input.deltaY = body.deltaY;
    }
  } else if (body.kind === "key") {
    if (!KEYS.has(body.key)) throw new ApiError(400, "That remote key is unavailable.");
    input.key = body.key;
  } else if (body.kind === "text") {
    if (typeof body.text !== "string" || !body.text.length || body.text.length > 500 || /[\x00-\x1f\x7f]/.test(body.text))
      throw new ApiError(400, "Remote text must contain 1–500 characters without control characters.");
    input.text = body.text;
  } else throw new ApiError(400, "Unsupported remote gesture.");
  return input;
}

// This controller is deliberately separate from assistant actions. Its endpoints
// accept gestures from the paired Android Remote screen, never model plans.
export class RemoteDesktop {
  constructor(host, { adapter = null, clock = Date.now, timers = true } = {}) {
    this.host = host;
    this.adapter = adapter;
    this.clock = clock;
    this.session = null;
    this.monitors = [];
    this.approvalBlockedUntil = 0;
    this.starting = false;
    this.changed = () => this.expire();
    host.store.on("changed", this.changed);
    if (timers) {
      this.timer = setInterval(() => this.expire(), 500);
      this.timer.unref?.();
    }
  }
  deviceAllowed(principal) {
    const device = this.host.store.state.devices.find((d) => d.id === principal?.id);
    return principal?.kind === "device" && device?.platform === "android" &&
      device.permissions?.remoteDesktop === true && device.permissions?.googleAccess !== false &&
      device.permissions?.projectAccess !== false;
  }
  guard(principal) {
    if (!this.deviceAllowed(principal)) throw new ApiError(403, "Enable this Android device's Remote desktop and shared access permissions on the PC first.");
    if (this.host.store.state.config.remoteDesktopEnabled !== true) throw new ApiError(403, "Remote desktop is disabled on the PC.");
    if (!this.adapter?.available) throw new ApiError(409, "Remote desktop needs the Windows Control Center, an unlocked desktop and its local input helper.");
  }
  expire() {
    const session = this.session;
    if (session && (this.clock() >= session.expires || this.clock() - session.lastActivity > IDLE_MS ||
      !this.deviceAllowed({ kind: "device", id: session.deviceId }) ||
      this.host.store.state.config.remoteDesktopEnabled !== true))
      this.stopAll("Session ended, disconnected or permission changed.");
  }
  publicStatus(principal) {
    this.expire();
    const owner = principal?.kind === "owner";
    const permitted = owner || this.deviceAllowed(principal);
    const visible = this.session && (owner || this.session.deviceId === principal?.id) && permitted;
    return {
      available: this.adapter?.available === true,
      enabled: this.host.store.state.config.remoteDesktopEnabled === true,
      permitted,
      monitors: permitted ? this.monitors.map(({ id, name, width, height, primary }) => ({ id, name, width, height, primary })) : [],
      session: visible ? { id: this.session.id, deviceId: this.session.deviceId, monitorId: this.session.monitorId,
        expiresAt: new Date(this.session.expires).toISOString(), lastActivityAt: new Date(this.session.lastActivity).toISOString() } : null,
      detail: DETAILS,
    };
  }
  async status(principal) {
    if (principal?.kind !== "owner" && !this.deviceAllowed(principal)) return this.publicStatus(principal);
    if (this.adapter?.available) this.monitors = await this.adapter.monitors();
    return this.publicStatus(principal);
  }
  requireSession(body, principal) {
    this.expire();
    this.guard(principal);
    const session = this.session;
    if (!session || session.id !== body.sessionId || session.deviceId !== principal.id)
      throw new ApiError(409, "This remote desktop session has ended. Start a fresh session on the phone.");
    return session;
  }
  async start(body, principal) {
    this.expire();
    this.guard(principal);
    if (this.session || this.starting) throw new ApiError(409, "A remote desktop session is already active. Stop it first.");
    this.starting = true;
    try {
      this.monitors = await this.adapter.monitors();
      this.guard(principal);
      const monitor = body.monitorId == null ? this.monitors.find((m) => m.primary) || this.monitors[0] : this.monitors.find((m) => m.id === body.monitorId);
      if (!monitor) throw new ApiError(409, "Choose a connected Windows monitor.");
      const stamp = this.clock();
      // Reserve the session before asynchronous helper startup so Stop/revocation
      // invalidates an in-flight start instead of allowing it to appear later.
      const session = this.session = { id: uid(), deviceId: principal.id, monitorId: monitor.id,
        expires: stamp + SESSION_MS, lastActivity: stamp, lastFrameAt: -Infinity,
        lastInputAt: -Infinity, frame: null, capturing: false, inputting: false };
      this.host.store.emit("changed");
      this.requireSession({ sessionId: session.id }, principal);
      await this.adapter.start?.({ ...this.publicStatus(principal).session, deviceName: this.host.device(principal.id).name || "Paired Android", stop: () => this.stopAll("Stopped on PC") });
      this.requireSession({ sessionId: session.id }, principal);
      return this.publicStatus(principal);
    } catch (error) {
      this.stopAll("Could not start remote desktop.");
      if (error.status) throw error;
      throw new ApiError(409, error.message || "The Windows remote desktop helper is unavailable.");
    } finally { this.starting = false; }
  }
  async frame(body, principal) {
    const session = this.requireSession(body, principal);
    if (session.capturing || this.clock() - session.lastFrameAt < 350) throw new ApiError(429, "Wait briefly before requesting the next screen image.");
    const monitorId = body.monitorId ?? session.monitorId;
    session.capturing = true;
    session.frame = null;
    session.lastFrameAt = this.clock();
    try {
      const monitors = await this.adapter.monitors();
      this.requireSession(body, principal);
      this.monitors = monitors;
      const monitor = monitors.find((m) => m.id === monitorId);
      if (!monitor) throw new ApiError(409, "That monitor was disconnected. Refresh the monitor list.");
      const frame = await this.adapter.capture(monitor);
      this.requireSession(body, principal);
      if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 ||
        frame.width > 1600 || frame.height > 1600 || !Buffer.isBuffer(frame.jpeg) || frame.jpeg.length > 1_200_000 ||
        frame.jpeg[0] !== 0xff || frame.jpeg[1] !== 0xd8)
        throw new ApiError(409, "Windows returned an unsupported screen image.");
      const stamp = this.clock();
      session.monitorId = monitor.id;
      session.lastActivity = stamp;
      session.frame = { id: uid(), capturedAt: stamp, monitor, width: frame.width, height: frame.height };
      return { sessionId: session.id, frameId: session.frame.id, monitorId: monitor.id,
        width: frame.width, height: frame.height, capturedAt: new Date(stamp).toISOString(),
        expiresAt: new Date(Math.min(stamp + FRAME_MS, session.expires)).toISOString(),
        image: `data:image/jpeg;base64,${frame.jpeg.toString("base64")}` };
    } catch (error) {
      if (!error.status) { this.stopAll("Desktop capture unavailable."); throw new ApiError(409, error.message || "Desktop capture unavailable."); }
      throw error;
    } finally { session.capturing = false; }
  }
  async input(body, principal) {
    const session = this.requireSession(body, principal);
    const input = validateRemoteInput(body);
    const frame = session.frame;
    if (!frame || body.frameId !== frame.id || this.clock() - frame.capturedAt > FRAME_MS)
      throw new ApiError(409, "The screen image is stale. Wait for a fresh image before touching the desktop.");
    if (session.inputting || session.capturing || this.clock() - session.lastInputAt < 70)
      throw new ApiError(429, "The previous gesture is still being handled.");
    session.inputting = true;
    session.lastInputAt = this.clock();
    // A frame authorizes at most one gesture. A lost reply cannot replay a click.
    session.frame = null;
    try {
      const monitors = await this.adapter.monitors();
      this.requireSession(body, principal);
      const monitor = monitors.find((m) => m.id === frame.monitor.id);
      if (JSON.stringify(monitor) !== JSON.stringify(frame.monitor)) throw new ApiError(409, "The display layout changed. Refresh before touching the desktop.");
      await this.adapter.input(input, monitor, { deadline: Math.min(frame.capturedAt + FRAME_MS, session.expires) });
      this.requireSession(body, principal);
      session.lastActivity = this.clock();
      return { handled: true, sessionId: session.id, frameId: frame.id };
    } catch (error) {
      if (error.status) throw error;
      throw new ApiError(409, error.message || "Windows blocked this gesture.");
    } finally { session.inputting = false; }
  }
  stopAll(reason = "Stopped") {
    const session = this.session;
    this.session = null;
    this.adapter?.stop?.(reason);
    if (session) {
      this.approvalBlockedUntil = this.clock() + 2000;
      this.host.store.emit("changed");
    }
    return { stopped: true };
  }
  stopForDevice(id) { if (this.session?.deviceId === id) this.stopAll("Device disconnected."); }
  assertOwnerApprovalAllowed() {
    this.expire();
    if (this.session || this.clock() < this.approvalBlockedUntil)
      throw new ApiError(403, "Stop remote desktop, then approve this action directly on the PC. Remote input cannot approve Nakama actions.");
  }
  close() {
    this.stopAll("Control Center closed.");
    clearInterval(this.timer);
    this.host.store.off("changed", this.changed);
  }
  async dispatch(method, route, body, principal) {
    if (route === "/api/remote-desktop/status" && method === "GET") return this.status(principal);
    if (route === "/api/remote-desktop/start" && method === "POST") return this.start(body, principal);
    if (route === "/api/remote-desktop/frame" && method === "POST") return this.frame(body, principal);
    if (route === "/api/remote-desktop/input" && method === "POST") return this.input(body, principal);
    if (route === "/api/remote-desktop/stop" && method === "POST") {
      if (principal?.kind !== "owner" && this.session?.deviceId !== principal?.id)
        throw new ApiError(403, "Only the PC or this session's phone can stop it.");
      if (body.sessionId && this.session && this.session.id !== body.sessionId)
        throw new ApiError(409, "That remote session is no longer active.");
      return this.stopAll();
    }
    throw new ApiError(404, "Remote desktop route not found.");
  }
}
