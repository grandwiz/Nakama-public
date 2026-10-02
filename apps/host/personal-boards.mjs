import { resolveDeviceTarget, permittedTarget } from "./device-commands.mjs";
import { originId, forDelivery } from "./device-delivery.mjs";
import { ApiError, digest, now, text, uid } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";

export const hostTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const calendarDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const defaultTaskBoard = () => ({
  version: 1,
  items: [],
  removedSourceIds: [],
  lastCleanupDate: "",
});
export const defaultRoutineBoard = () => ({
  version: 1,
  routines: [],
  occurrences: [],
  requestReceipts: [],
});

export function syncTaskBoard(state, date = new Date()) {
  const board = (state.taskBoard ||= defaultTaskBoard());
  board.removedSourceIds ||= [];
  const removed = new Set(board.removedSourceIds),
    items = new Map(board.items.map((item) => [item.id, item]));
  const sources = [
    ...(state.tasks || [])
      .filter((task) => !task.workflowId && !task.autonomousRunId)
      .map((task) => ({
        id: `task:${task.id}`,
        sourceId: task.id,
        sourceKind: "task",
        title: task.title || "Assistant task",
        details: task.error || "",
        sourceStatus: task.status,
        projectId: task.projectId,
        requestedBy: task.requestedBy || "desktop",
        createdAt: task.createdAt || now(),
        updatedAt: task.updatedAt || task.createdAt || now(),
        finishedAt: task.timings?.completedAt,
      })),
    ...(state.autonomousTasks || []).map((run) => ({
      id: `autonomous:${run.id}`,
      sourceId: run.id,
      sourceKind: "autonomous",
      title: run.goal || "Autonomous task",
      details: run.summary || run.error || run.stage || "",
      sourceStatus: run.status,
      projectId: run.projectId,
      requestedBy: run.requestedBy,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })),
    ...(state.projectWorkflows || []).map((workflow) => ({
      id: `workflow:${workflow.id}`,
      sourceId: workflow.id,
      sourceKind: "workflow",
      title: workflow.message || "Project workflow",
      details: workflow.error || workflow.stage || "",
      sourceStatus: workflow.status,
      projectId: workflow.projectId,
      requestedBy: workflow.requestedBy,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    })),
  ];
  for (const source of sources) {
    if (removed.has(source.id)) continue;
    const current = items.get(source.id),
      completed = source.sourceStatus === "completed";
    if (current) {
      Object.assign(current, {
        sourceStatus: source.sourceStatus,
        sourceDetail: source.details,
        updatedAt: source.updatedAt,
      });
      if (!current.detailsOverride) current.details = source.details;
      if (current.completionOverride === undefined) {
        current.completed = completed;
        if (completed)
          current.completedAt ||= source.finishedAt || source.updatedAt;
        else delete current.completedAt;
      }
    } else {
      const item = {
        ...source,
        completed,
        ...(completed
          ? { completedAt: source.finishedAt || source.updatedAt }
          : {}),
      };
      delete item.finishedAt;
      board.items.push(item);
      items.set(item.id, item);
    }
  }
  const today = calendarDay(date);
  if (board.lastCleanupDate !== today) {
    const expired = board.items.filter(
      (item) =>
        item.completed &&
        item.completedAt &&
        calendarDay(new Date(item.completedAt)) < today,
    );
    for (const item of expired)
      if (item.sourceKind !== "manual") removed.add(item.id);
    const ids = new Set(expired.map((item) => item.id));
    board.items = board.items.filter((item) => !ids.has(item.id));
    board.lastCleanupDate = today;
    board.lastCleanupCount = expired.length;
    board.removedSourceIds = [...removed];
  }
  return board;
}

const formatters = new Map();
function parts(date, zone) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}
function nominal(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
  );
}
export function zonedOccurrence(day, time, zone) {
  const [year, month, date] = day.split("-").map(Number),
    [hour, minute] = time.split(":").map(Number);
  const desired = { year, month, day: date, hour, minute },
    base = nominal(desired),
    candidates = [];
  for (const offsetProbe of [-86400000, 0, 86400000]) {
    const probe = base + offsetProbe,
      offset = nominal(parts(new Date(probe), zone)) - probe,
      candidate = base - offset;
    if (
      Object.entries(desired).every(
        ([key, value]) => parts(new Date(candidate), zone)[key] === value,
      )
    )
      candidates.push(candidate);
  }
  return candidates.length
    ? new Date(Math.min(...candidates)).toISOString()
    : null;
}
export function latestDueOccurrence(routine, date = new Date()) {
  if (!routine.enabled) return null;
  const local = parts(date, routine.timeZone),
    localDay = Date.UTC(local.year, local.month - 1, local.day);
  for (let back = 0; back < 8; back++) {
    const day = new Date(localDay - back * 86400000);
    if (!routine.weekdays.includes(day.getUTCDay())) continue;
    const when = zonedOccurrence(
      day.toISOString().slice(0, 10),
      routine.time,
      routine.timeZone,
    );
    if (
      when &&
      Date.parse(when) <= date.getTime() &&
      Date.parse(when) >=
        Date.parse(routine.scheduleUpdatedAt || routine.createdAt) &&
      (!routine.lastScheduledFor ||
        Date.parse(when) > Date.parse(routine.lastScheduledFor))
    )
      return when;
  }
  return null;
}

function exactKeys(body, allowed) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "Unsupported board fields.");
}
function details(value = "") {
  if (typeof value !== "string" || value.length > 3000 || value.includes("\0"))
    throw new ApiError(400, "Details must be text under 3,000 characters.");
  return value.trim();
}
export function routineTargets(routine) {
  return routine.targetDeviceIds || (routine.targetDeviceId ? [routine.targetDeviceId] : [routine.requestedBy || "desktop"]);
}
function originAvailable(state, record) {
  if (!record.requestedBy || record.requestedBy === "desktop") return true;
  try { permittedTarget(state, record.requestedBy); return true; } catch { return false; }
}
export function validateRoutine(body, current, state, principal) {
  exactKeys(body, [
    "title",
    "details",
    "kind",
    "time",
    "timeZone",
    "weekdays",
    "enabled",
    "targetDeviceId",
    "targetDeviceIds",
    "requestId",
  ]);
  const value = { ...current, ...body };
  delete value.requestId;
  value.title = text(value.title, "Routine title", 200);
  value.details = details(value.details);
  if (!["reminder", "alarm"].includes(value.kind))
    throw new ApiError(400, "Choose a reminder or requested Android alarm.");
  if (
    typeof value.time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
  )
    throw new ApiError(400, "Routine time must use HH:mm, for example 07:30.");
  value.timeZone ||= hostTimeZone();
  if (typeof value.timeZone !== "string" || value.timeZone.length > 100)
    throw new ApiError(400, "Choose an IANA time zone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format();
  } catch {
    throw new ApiError(400, "Choose a supported IANA time zone.");
  }
  if (
    !Array.isArray(value.weekdays) ||
    !value.weekdays.length ||
    value.weekdays.length > 7 ||
    value.weekdays.some(
      (day) => !Number.isInteger(day) || day < 0 || day > 6,
    ) ||
    new Set(value.weekdays).size !== value.weekdays.length
  )
    throw new ApiError(
      400,
      "Choose unique weekdays from 0 (Sunday) through 6 (Saturday).",
    );
  value.weekdays = [...value.weekdays].sort();
  if (typeof value.enabled !== "boolean")
    throw new ApiError(400, "Routine enabled must be true or false.");
  if (body.targetDeviceId !== undefined && body.targetDeviceIds !== undefined) throw new ApiError(400, "Choose one target-device field, not both.");
  let targets = body.targetDeviceIds !== undefined ? body.targetDeviceIds : body.targetDeviceId !== undefined ? (body.targetDeviceId ? [body.targetDeviceId] : [originId(principal)]) :
    current ? routineTargets(current) : principal.kind === "device" || value.kind === "reminder" ? [originId(principal)] : [];
  if (Array.isArray(targets) && !targets.length && value.kind === "reminder") targets = [originId(principal)];
  if (!Array.isArray(targets) || !targets.length || targets.length > 10 || targets.some((id) => typeof id !== "string" || !id) || new Set(targets).size !== targets.length)
    throw new ApiError(400, "Select one to ten unique devices for this schedule.");
  targets = targets.map((id) => resolveDeviceTarget(state, principal, { targetDeviceId: id }, { desktop: value.kind !== "alarm", connected: false }).id);
  value.targetDeviceIds = targets;
  value.targetDeviceId = targets.length === 1 ? targets[0] : null;
  return value;
}

export class PersonalBoards {
  constructor(host, { clock = () => new Date() } = {}) {
    this.host = host;
    this.clock = clock;
    this.closed = false;
    this.timer = setInterval(() => this.tick().catch(() => {}), 15000);
    this.timer.unref?.();
  }
  access(principal) {
    assertPersonalAccess(this.host.store.state, principal);
  }
  taskState(principal) {
    const { removedSourceIds, ...board } = structuredClone(
      this.host.store.state.taskBoard,
    );
    if (principal?.kind === "device")
      board.items = board.items.filter(
        (item) => item.targetDeviceId ? item.targetDeviceId === principal.id : forDelivery(this.host.store.state, item, principal),
      );
    return board;
  }
  routineState(principal) {
    const { requestReceipts, ...board } = structuredClone(
      this.host.store.state.routineBoard,
    );
    board.routines = board.routines.map((routine) => ({ ...routine, targetDeviceIds: routineTargets(routine) }));
    if (principal.kind === "device") {
      board.routines = board.routines.filter((item) => originAvailable(this.host.store.state, item) && (item.targetDeviceIds.includes(principal.id) || item.requestedBy === principal.id))
        .map((item) => ({ ...item, targetDeviceId: item.targetDeviceIds.includes(principal.id) ? principal.id : null,
          deviceSchedule: item.deviceSchedules?.[principal.id] || (item.deviceSchedule?.deviceId === principal.id ? item.deviceSchedule : undefined) }));
      board.occurrences = board.occurrences.filter((item) => (item.targetDeviceId || item.requestedBy || "desktop") === principal.id);
    }
    return board;
  }
  request(state, principal, route, body, operation) {
    if (
      body.requestId !== undefined &&
      (typeof body.requestId !== "string" ||
        !/^[a-zA-Z0-9-]{8,100}$/.test(body.requestId))
    )
      throw new ApiError(400, "Use an 8–100 character request ID.");
    const key = body.requestId
      ? `${principal.id}:${route}:${body.requestId}`
      : null;
    const fingerprint = digest(JSON.stringify(body));
    const receipts = state.routineBoard.requestReceipts;
    const previous = key && receipts.find((receipt) => receipt.key === key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ApiError(
          409,
          "This request ID was already used for different input.",
        );
      return structuredClone(previous.response);
    }
    const response = operation();
    if (key) {
      receipts.push({ key, fingerprint, response: structuredClone(response) });
      state.routineBoard.requestReceipts = receipts.slice(-500);
    }
    return response;
  }
  async tick() {
    if (this.closed || this.host.closing || this.host.maintenanceLock) return;
    const date = this.clock(),
      state = this.host.store.state;
    if (
      state.taskBoard.lastCleanupDate === calendarDay(date) &&
      !state.routineBoard.routines.some((routine) =>
        latestDueOccurrence(routine, date),
      )
    )
      return;
    await this.host.store.change((state) => {
      if (this.host.maintenanceLock)
        throw new ApiError(
          409,
          "Routine updates are paused for the approved backup.",
        );
      syncTaskBoard(state, date);
      for (const routine of state.routineBoard.routines) {
        const when = latestDueOccurrence(routine, date);
        if (!when) continue;
        routine.lastScheduledFor = when;
        if (!originAvailable(state, routine)) continue;
        for (const targetDeviceId of routineTargets(routine)) {
          if (targetDeviceId !== "desktop") { try { permittedTarget(state, targetDeviceId); } catch { continue; } }
          const id = `${routine.id}:${when}:${targetDeviceId}`;
          if (state.routineBoard.occurrences.some((item) => item.id === id)) continue;
          const occurrence = { id, routineId: routine.id, title: routine.title, kind: routine.kind,
            scheduledFor: when, status: "pending", targetDeviceId, requestedBy: routine.requestedBy, createdAt: date.toISOString() };
          state.routineBoard.occurrences.push(occurrence);
          state.taskBoard.items.push({ id: `routine:${id}`, sourceId: id, sourceKind: "routine", title: routine.title,
            details: `${routine.kind === "alarm" ? "Alarm request" : "Reminder"} due ${when}. This host receipt does not confirm an Android alarm sounded.`,
            targetDeviceId, requestedBy: routine.requestedBy, completed: false, createdAt: date.toISOString(), updatedAt: date.toISOString() });
        }
      }
      state.routineBoard.occurrences =
        state.routineBoard.occurrences.slice(-200);
    });
  }
  async route(method, route, body, principal) {
    this.access(principal);
    if (method === "GET" && route === "/api/task-board")
      return this.taskState(principal);
    if (method === "GET" && route === "/api/routines")
      return this.routineState(principal);
    if (method === "POST" && route === "/api/task-board/cleanup-completed") {
      exactKeys(body, []);
      return this.host.store.change((state) => {
        this.access(principal);
        const board = state.taskBoard,
          done = board.items.filter(
            (item) =>
              item.completed &&
              (principal.kind === "owner" ||
                !item.targetDeviceId ||
                item.targetDeviceId === principal.id),
          );
        board.removedSourceIds = [
          ...new Set([
            ...board.removedSourceIds,
            ...done
              .filter((item) => item.sourceKind !== "manual")
              .map((item) => item.id),
          ]),
        ];
        const ids = new Set(done.map((item) => item.id));
        board.items = board.items.filter((item) => !ids.has(item.id));
        return { removed: done.length, sourceHistoryPreserved: true };
      });
    }
    if (method === "POST" && route === "/api/task-board/items") {
      exactKeys(body, ["title", "details", "requestId"]);
      const title = text(body.title, "Task title", 300),
        detail = details(body.details);
      return this.host.store.change((state) => {
        this.access(principal);
        return this.request(state, principal, route, body, () => {
          const stamp = this.clock().toISOString(),
            item = {
              id: uid(),
              sourceKind: "manual",
              title,
              details: detail,
              requestedBy: principal.id,
              completed: false,
              createdAt: stamp,
              updatedAt: stamp,
            };
          state.taskBoard.items.push(item);
          return structuredClone(item);
        });
      });
    }
    const task = route.match(/^\/api\/task-board\/items\/([^/]+)$/);
    if (task && ["PATCH", "DELETE"].includes(method)) {
      exactKeys(
        body,
        method === "DELETE" ? [] : ["title", "details", "completed"],
      );
      if (body.completed !== undefined && typeof body.completed !== "boolean")
        throw new ApiError(400, "Completed must be true or false.");
      return this.host.store.change((state) => {
        this.access(principal);
        const item = state.taskBoard.items.find(
          (item) => item.id === decodeURIComponent(task[1]),
        );
        if (!item) throw new ApiError(404, "Task card not found.");
        if (
          principal.kind === "device" &&
          item.targetDeviceId &&
          item.targetDeviceId !== principal.id
        )
          throw new ApiError(
            403,
            "This reminder card belongs to another device.",
          );
        if (method === "DELETE") {
          if (item.sourceKind !== "manual")
            state.taskBoard.removedSourceIds.push(item.id);
          state.taskBoard.items = state.taskBoard.items.filter(
            (other) => other.id !== item.id,
          );
          return { removed: true, sourceHistoryPreserved: true };
        }
        if (body.title !== undefined)
          item.title = text(body.title, "Task title", 300);
        if (body.details !== undefined) {
          item.details = details(body.details);
          item.detailsOverride = true;
        }
        if (body.completed !== undefined) {
          item.completed = body.completed;
          item.completionOverride = body.completed;
          if (body.completed) item.completedAt = this.clock().toISOString();
          else delete item.completedAt;
          if (item.sourceKind === "routine") {
            const occurrence = state.routineBoard.occurrences.find(
              (entry) => entry.id === item.sourceId,
            );
            if (occurrence) {
              occurrence.status = body.completed ? "acknowledged" : "pending";
              if (body.completed) occurrence.acknowledgedAt = item.completedAt;
              else delete occurrence.acknowledgedAt;
            }
          }
        }
        item.updatedAt = this.clock().toISOString();
        return structuredClone(item);
      });
    }
    if (method === "POST" && route === "/api/routines") {
      const value = validateRoutine(
        body,
        null,
        this.host.store.state,
        principal,
      );
      return this.host.store.change((state) => {
        this.access(principal);
        validateRoutine(body, null, state, principal);
        return this.request(state, principal, route, body, () => {
          if (state.routineBoard.routines.length >= 100)
            throw new ApiError(409, "Keep at most 100 routines.");
          const stamp = this.clock().toISOString(),
            routine = {
              ...value,
              id: uid(),
              requestedBy: principal.id,
              createdAt: stamp,
              updatedAt: stamp,
              scheduleUpdatedAt: stamp,
            };
          state.routineBoard.routines.push(routine);
          return structuredClone(routine);
        });
      });
    }
    const routine = route.match(/^\/api\/routines\/([^/]+)$/);
    if (routine && ["PATCH", "DELETE"].includes(method))
      return this.host.store.change((state) => {
        this.access(principal);
        const current = state.routineBoard.routines.find(
          (item) => item.id === routine[1],
        );
        if (!current) throw new ApiError(404, "Routine not found.");
        if (
          principal.kind === "device" &&
          current.requestedBy !== principal.id
        )
          throw new ApiError(
            403,
            "A phone can edit only routines it can access.",
          );
        if (method === "DELETE") {
          exactKeys(body, []);
          state.routineBoard.routines = state.routineBoard.routines.filter(
            (item) => item.id !== current.id,
          );
          return { removed: true };
        }
        const next = validateRoutine(body, current, state, principal),
          changed = [
            "kind",
            "time",
            "timeZone",
            "weekdays",
            "enabled",
            "targetDeviceId",
            "targetDeviceIds",
          ].some(
            (key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]),
          );
        Object.assign(current, next, {
          updatedAt: new Date(
            Math.max(this.clock().getTime(), Date.parse(current.updatedAt) + 1),
          ).toISOString(),
        });
        if (changed) {
          current.scheduleUpdatedAt = current.updatedAt;
          delete current.lastScheduledFor;
          delete current.deviceSchedule;
          delete current.deviceSchedules;
        }
        return structuredClone(current);
      });
    const deviceStatus = route.match(
      /^\/api\/routines\/([^/]+)\/device-status$/,
    );
    if (deviceStatus && method === "POST") {
      exactKeys(body, ["status", "detail", "expectedUpdatedAt"]);
      if (
        principal.kind !== "device" ||
        !["scheduled", "permission_required", "cancelled", "failed"].includes(
          body.status,
        ) ||
        typeof body.expectedUpdatedAt !== "string"
      )
        throw new ApiError(
          400,
          "A target phone must report a known scheduling status and the exact routine update timestamp.",
        );
      const detail = details(body.detail);
      return this.host.store.change((state) => {
        this.access(principal);
        const current = state.routineBoard.routines.find(
          (item) => item.id === deviceStatus[1],
        );
        if (!current) throw new ApiError(404, "Routine not found.");
        if (!routineTargets(current).includes(principal.id) || !originAvailable(state, current))
          throw new ApiError(
            403,
            "Only the target phone can report its alarm scheduling.",
          );
        if (current.updatedAt !== body.expectedUpdatedAt)
          throw new ApiError(
            409,
            "This scheduling receipt is for an older routine. Sync the current schedule.",
          );
        const receipt = {
          deviceId: principal.id,
          status: body.status,
          detail,
          reportedAt: this.clock().toISOString(),
          expectedUpdatedAt: body.expectedUpdatedAt,
        };
        current.deviceSchedules ||= {};
        current.deviceSchedules[principal.id] = receipt;
        if (routineTargets(current).length === 1) current.deviceSchedule = receipt;
        return structuredClone(receipt);
      });
    }
    const ack = route.match(/^\/api\/routines\/occurrences\/([^/]+)\/ack$/);
    if (ack && method === "POST") {
      exactKeys(body, []);
      return this.host.store.change((state) => {
        this.access(principal);
        const occurrence = state.routineBoard.occurrences.find(
          (item) => item.id === decodeURIComponent(ack[1]),
        );
        if (!occurrence) throw new ApiError(404, "Reminder receipt not found.");
        if (
          principal.kind === "device" &&
          occurrence.targetDeviceId &&
          occurrence.targetDeviceId !== principal.id
        )
          throw new ApiError(403, "This reminder belongs to another device.");
        occurrence.status = "acknowledged";
        occurrence.acknowledgedAt = this.clock().toISOString();
        const card = state.taskBoard.items.find(
          (item) =>
            item.sourceId === occurrence.id && item.sourceKind === "routine",
        );
        if (card) {
          card.completed = true;
          card.completedAt = occurrence.acknowledgedAt;
        }
        return structuredClone(occurrence);
      });
    }
    throw new ApiError(404, "Board operation not found.");
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
