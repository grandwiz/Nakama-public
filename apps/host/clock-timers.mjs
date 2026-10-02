import { ApiError, digest, uid } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { hostTimeZone } from "./personal-boards.mjs";

export const MAX_TIMER_SECONDS = 7 * 24 * 60 * 60;
export const defaultClock = () => ({ version: 1, timers: [], requests: [] });
const terminal = new Set(["cancelled", "dismissed"]);
const stamp = (time) => new Date(time).toISOString();
export function timerRemaining(timer, time) {
  return timer.status === "running" ? Math.max(0, Math.ceil((Date.parse(timer.endsAt) - time) / 1000)) :
    timer.status === "paused" ? Math.ceil(timer.remainingMs / 1000) : 0;
}
function settle(state, time) {
  let changed = false;
  for (const timer of state.clock.timers) {
    if (timer.status !== "running" || Date.parse(timer.endsAt) > time) continue;
    timer.status = "finished"; timer.remainingMs = 0;
    timer.finishedAt = timer.endsAt; timer.updatedAt = stamp(time); timer.revision++;
    changed = true;
  }
  return changed;
}
export class ClockTimers {
  constructor(host, { clock = () => new Date(), timers = true } = {}) {
    this.host = host; this.clock = () => +clock(); this.closed = false;
    if (timers) { this.interval = setInterval(() => this.tick().catch(() => {}), 1000); this.interval.unref?.(); }
  }
  access(principal) { assertPersonalAccess(this.host.store.state, principal); }
  visible(timer, principal) { return principal.kind === "owner" || timer.requestedBy === principal.id; }
  snapshot(principal) {
    this.access(principal);
    const time = this.clock();
    return { now: stamp(time), timeZone: hostTimeZone(), timers: this.host.store.state.clock.timers.filter((timer) => this.visible(timer, principal)).map(({ remainingMs, ...timer }) => ({ ...timer, remainingSeconds: timerRemaining({ ...timer, remainingMs }, time) })) };
  }
  public(principal) { try { return this.snapshot(principal); } catch { return { now: stamp(this.clock()), timeZone: hostTimeZone(), timers: [] }; } }
  async tick() {
    if (this.closed || this.host.closing || this.host.maintenanceLock) return;
    const time = this.clock();
    if (!this.host.store.state.clock.timers.some((timer) => timer.status === "running" && Date.parse(timer.endsAt) <= time)) return;
    await this.host.store.change((state) => { if (!this.closed && !this.host.closing && !this.host.maintenanceLock) settle(state, this.clock()); });
  }
  async createForTarget(body, principal) {
    return this.route("POST", "/api/clock/timers", body, principal, true);
  }
  async route(method, route, body, principal, explicitDesktop = false) {
    this.access(principal);
    if (method === "GET" && route === "/api/clock") { await this.tick(); this.access(principal); return this.snapshot(principal); }
    if (method === "POST" && route === "/api/clock/timers") {
      if (principal.kind === "device" && !explicitDesktop) return this.host.deviceCommands.route({ command: "timer", args: body }, principal);
      if (Object.keys(body).some((key) => !["durationSeconds", "title", "requestId"].includes(key)) || !Number.isSafeInteger(body.durationSeconds) || body.durationSeconds < 1 || body.durationSeconds > MAX_TIMER_SECONDS)
        throw new ApiError(400, "Choose a timer duration between 1 second and 7 days.");
      const title = body.title === undefined ? "Timer" : body.title;
      if (typeof title !== "string" || !title.trim() || title.length > 100 || /[\p{Cc}\p{Cf}]/u.test(title)) throw new ApiError(400, "Use a short timer name without hidden formatting.");
      if (body.requestId !== undefined && (typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId))) throw new ApiError(400, "Invalid timer request ID.");
      const requestedBy = principal.kind === "owner" ? "desktop" : principal.id;
      const requestKey = body.requestId ? digest(`${requestedBy}:${body.requestId}`) : null;
      const signature = digest(JSON.stringify([body.durationSeconds, title.trim()]));
      return this.host.store.change((state) => {
        this.access(principal);
        if (this.host.maintenanceLock) throw new ApiError(409, "Timers are paused while an update is handed off.");
        const time = this.clock(); settle(state, time);
        if (requestKey) {
          const prior = state.clock.requests.find((entry) => entry.key === requestKey);
          if (prior) {
            if (prior.signature !== signature) throw new ApiError(409, "That timer request ID was already used for another duration or name.");
            const timer = state.clock.timers.find((entry) => entry.id === prior.id);
            if (!timer) throw new ApiError(409, "That timer was already created and removed from recent history. Start a fresh request deliberately.");
            return { timer: this.snapshot(principal).timers.find((entry) => entry.id === timer.id), repeated: true };
          }
        }
        if (state.clock.timers.filter((timer) => !terminal.has(timer.status)).length >= 50) throw new ApiError(409, "Dismiss finished timers or cancel an existing timer before creating more (50 active or undismissed timers maximum).");
        state.clock.requests = state.clock.requests.filter((entry) => time - Date.parse(entry.createdAt) < 30 * 86400000);
        if (requestKey && state.clock.requests.length >= 2000) throw new ApiError(409, "The recent timer request log is full. Try again after older receipts expire.");
        const timer = { id: uid(), title: title.trim(), durationSeconds: body.durationSeconds, remainingMs: body.durationSeconds * 1000,
          status: "running", endsAt: stamp(time + body.durationSeconds * 1000), createdAt: stamp(time), updatedAt: stamp(time), revision: 1, requestedBy, targetDeviceId: "desktop" };
        state.clock.timers.push(timer);
        if (requestKey) state.clock.requests.push({ key: requestKey, signature, id: timer.id, createdAt: stamp(time) });
        const old = state.clock.timers.filter((entry) => terminal.has(entry.status)).slice(0, -200);
        const prune = new Set(old.map((entry) => entry.id)); state.clock.timers = state.clock.timers.filter((entry) => !prune.has(entry.id));
        return { timer: this.snapshot(principal).timers.find((entry) => entry.id === timer.id) };
      });
    }
    const match = /^\/api\/clock\/timers\/([^/]+)\/(pause|resume|cancel|dismiss)$/.exec(route);
    if (method === "POST" && match) {
      if (Object.keys(body).some((key) => key !== "revision") || !Number.isSafeInteger(body.revision)) throw new ApiError(400, "Provide the timer's current revision.");
      return this.host.store.change((state) => {
        this.access(principal);
        if (this.host.maintenanceLock) throw new ApiError(409, "Timers are paused while an update is handed off.");
        const time = this.clock(); settle(state, time);
        const timer = state.clock.timers.find((entry) => entry.id === match[1] && this.visible(entry, principal));
        if (!timer) throw new ApiError(404, "Timer not found for this device.");
        if (timer.revision !== body.revision) throw new ApiError(409, "This timer changed. Refresh before changing it again.");
        const action = match[2];
        if (action === "pause" && timer.status === "running") {
          timer.remainingMs = Math.max(0, Date.parse(timer.endsAt) - time); timer.status = "paused"; delete timer.endsAt;
        } else if (action === "resume" && timer.status === "paused") {
          timer.endsAt = stamp(time + timer.remainingMs); timer.status = "running";
        } else if (action === "cancel" && ["running", "paused"].includes(timer.status)) {
          timer.status = "cancelled"; timer.remainingMs = 0; delete timer.endsAt;
        } else if (action === "dismiss" && timer.status === "finished") timer.status = "dismissed";
        else throw new ApiError(409, `This ${timer.status} timer cannot ${action}.`);
        timer.updatedAt = stamp(time); timer.revision++;
        return { timer: this.snapshot(principal).timers.find((entry) => entry.id === timer.id) };
      });
    }
    throw new ApiError(404, "Clock endpoint not found.");
  }
  close() { this.closed = true; clearInterval(this.interval); }
}
