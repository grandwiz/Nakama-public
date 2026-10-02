import { ApiError, now, redact, uid } from "./security.mjs";

const KEYS = new Set([
  "Enter",
  "Escape",
  "Backspace",
  "Tab",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Delete",
]);
const DETAILS =
  "Dedicated Chromium sessions; no installed browser profile is used. Ordinary sessions are temporary; explicitly created monitor profiles keep private site storage until forgotten. Research is anonymous and read-only. Project automation stays inside a reviewed local preview. Private/login takeover is human-only and never sent to agents, history or reports. Downloads, popups and browser permissions are blocked.";
const same = (a, b) => a?.kind === b?.kind && a?.id === b?.id;
function keys(body, allowed) {
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "Unexpected internal browser fields.");
}
function text(value, max, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new ApiError(400, `Enter a valid ${label}.`);
  return value;
}
export function browserUrl(raw, mode, origin) {
  if (raw === "about:blank") return raw;
  let url;
  try {
    url = new URL(text(raw, 2048, "browser URL"));
  } catch {
    throw new ApiError(400, "Enter an allowed absolute browser URL.");
  }
  if (
    url.username ||
    url.password ||
    (mode !== "private" && redact(raw) !== raw)
  )
    throw new ApiError(
      403,
      "Credential-bearing URLs are unavailable to browser automation.",
    );
  if (mode === "project") {
    if (url.protocol !== "http:" || url.origin !== origin)
      throw new ApiError(
        403,
        "Project browser navigation must stay inside the approved local preview origin.",
      );
  } else if (
    url.protocol !== "https:" ||
    !url.hostname.includes(".") ||
    /^(?:\d|\[)/.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|home|lan)$/i.test(url.hostname)
  ) {
    throw new ApiError(
      403,
      "Research/private browsing supports public HTTPS websites only.",
    );
  }
  if (
    mode === "research" &&
    /\/(?:login|signin|sign-in|oauth|authorize|callback)(?:[/?#]|$)/i.test(
      url.href,
    )
  )
    throw new ApiError(
      403,
      "Open a private human-controlled session for sign-in pages.",
    );
  return url.href;
}
export function browserInput(body) {
  const input = { kind: body.kind };
  if (body.kind === "tap") {
    for (const field of ["x", "y"]) {
      if (
        typeof body[field] !== "number" ||
        !Number.isFinite(body[field]) ||
        body[field] < 0 ||
        body[field] > 1
      )
        throw new ApiError(400, "Use normalized browser coordinates.");
      input[field] = body[field];
    }
  } else if (body.kind === "scroll") {
    if (
      !Number.isInteger(body.deltaY) ||
      !body.deltaY ||
      Math.abs(body.deltaY) > 10
    )
      throw new ApiError(400, "Scroll 1–10 steps.");
    input.deltaY = body.deltaY;
  } else if (body.kind === "key") {
    if (!KEYS.has(body.key))
      throw new ApiError(400, "Unsupported browser key.");
    input.key = body.key;
  } else if (body.kind === "text")
    input.text = text(body.text, 1000, "browser text");
  else throw new ApiError(400, "Unsupported browser input.");
  return input;
}

export class BrowserStudio {
  constructor(host, { adapter = null, clock = Date.now, timers = true } = {}) {
    this.host = host;
    this.adapter = adapter;
    this.clock = clock;
    this.sessions = new Map();
    this.closed = false;
    this.changed = () => this.expire();
    host.store.on("changed", this.changed);
    if (timers) {
      this.timer = setInterval(() => this.expire(), 1000);
      this.timer.unref?.();
    }
  }
  allowed(principal) {
    if (principal?.kind === "owner") return true;
    const device =
      principal?.kind === "device" &&
      this.host.store.state.devices.find((row) => row.id === principal.id);
    return Boolean(
      device?.platform === "android" &&
      device.permissions?.browserControl === true &&
      device.permissions?.projectAccess !== false &&
      device.permissions?.googleAccess !== false,
    );
  }
  access(principal) {
    if (this.closed || this.host.closing || this.host.maintenanceLock)
      throw new ApiError(503, "Internal browser is closing.");
    if (!this.allowed(principal))
      throw new ApiError(
        403,
        "Enable Browser control, project and Google access for this phone in Windows Devices.",
      );
    if (!this.adapter?.available)
      throw new ApiError(
        409,
        "Internal Chromium needs the Windows Control Center.",
      );
  }
  visible(session, principal) {
    if (session.monitorId)
      return this.monitorVisible(session.monitorId, principal);
    return (
      this.allowed(principal) &&
      (principal.kind === "owner" ||
        same(session.requestedBy, principal) ||
        (principal.kind === "device" &&
          session.sharedDeviceId === principal.id &&
          this.clock() < session.controllerUntil) ||
        (session.mode !== "private" && session.requestedBy.kind === "owner"))
    );
  }
  session(id, principal) {
    this.access(principal);
    const session = this.sessions.get(id);
    if (!session || !this.visible(session, principal))
      throw new ApiError(404, "Browser session unavailable.");
    this.guard(session);
    session.touched = this.clock();
    return session;
  }
  guard(session) {
    if (
      this.closed ||
      this.host.closing ||
      this.sessions.get(session.id) !== session ||
      !this.allowed(session.requestedBy)
    )
      throw new ApiError(
        409,
        "Browser session ended or its requesting device lost access.",
      );
    if (
      session.monitorId &&
      !this.host.store.state.monitors?.some(
        (row) =>
          row.id === session.monitorId && row.profileId === session.profileId,
      )
    )
      throw new ApiError(
        409,
        "This monitor or its private profile was removed.",
      );
    if (session.mode === "project") {
      const preview = this.host.projectPreviews?.browserOrigin(
        session.projectId,
      );
      if (
        !preview ||
        preview.origin !== session.origin ||
        preview.launchId !== session.launchId
      )
        throw new ApiError(
          409,
          "The reviewed local preview ended or changed. Open a fresh browser session.",
        );
    }
    if (session.taskId) {
      const task = this.host.store.state.tasks.find(
        (task) => task.id === session.taskId,
      );
      if (!task || ["stopped", "failed"].includes(task.status))
        throw new ApiError(409, "The associated browser task stopped.");
    }
  }
  association(body, principal, requireActive = false) {
    if (body.projectId) this.host.project(body.projectId);
    const task =
      body.taskId &&
      this.host.store.state.tasks.find((row) => row.id === body.taskId);
    const workflow =
      body.workflowId &&
      this.host.store.state.projectWorkflows.find(
        (row) => row.id === body.workflowId,
      );
    if (
      body.taskId &&
      (!task ||
        task.projectId !== body.projectId ||
        (requireActive && !["running", "queued"].includes(task.status)))
    )
      throw new ApiError(409, "Select a real active task in this project.");
    if (
      body.workflowId &&
      (!workflow ||
        workflow.projectId !== body.projectId ||
        (task && task.workflowId !== workflow.id))
    )
      throw new ApiError(
        409,
        "Browser workflow association does not match the actual task.",
      );
    if (
      principal.kind === "device" &&
      ((task?.requestedBy && task.requestedBy !== principal.id) ||
        (workflow?.requestedBy && workflow.requestedBy !== principal.id))
    )
      throw new ApiError(403, "This task belongs to another requester.");
    return {
      taskId: task?.id,
      workflowId: workflow?.id || task?.workflowId,
      projectId: body.projectId,
    };
  }
  publicStatus(principal) {
    this.expire();
    return {
      available: this.adapter?.available === true,
      permitted: this.allowed(principal),
      sessions: [...this.sessions.values()]
        .filter((row) => this.visible(row, principal))
        .map((row) => {
          const privateVisible =
            !row.tainted || same(row.controller, principal);
          return {
            id: row.id,
            mode: row.mode,
            projectId: row.projectId,
            taskId: row.taskId,
            workflowId: row.workflowId,
            status: row.status,
            attentionId: row.attentionId,
            attentionReason: row.attentionReason,
            controller: row.controller,
            sharedDeviceId: row.sharedDeviceId,
            deliveryDeviceId: row.sharedDeviceId || row.requestedBy?.id || "desktop",
            tainted: row.tainted,
            hasFrame: row.hasFrame && privateVisible,
            activeTabId: row.activeTabId,
            tabs: [...row.tabs.values()].map((tab) => ({
              id: tab.id,
              title: privateVisible ? tab.title : "Private human session",
              url: privateVisible ? tab.url : "",
              loading: tab.loading,
            })),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }),
      detail: DETAILS,
    };
  }
  notify(session) {
    if (session) session.updatedAt = now();
    this.host.store.emit("changed");
  }
  expire() {
    if (this.expiring) return;
    this.expiring = true;
    try {
      for (const session of [...this.sessions.values()]) {
        try {
          this.guard(session);
          if (this.clock() - session.touched > 30 * 60000)
            throw new Error("expired");
        } catch {
          this.destroy(session.id);
          continue;
        }
        if (
          session.controller &&
          (this.clock() >= session.controllerUntil ||
            !this.allowed(session.controller) ||
            (session.monitorId &&
              !this.monitorVisible(session.monitorId, session.controller)))
        ) {
          if (session.monitorId)
            void this.adapter
              ?.setMonitorHuman?.(session.id, false)
              .catch(() => {});
          session.controller = null;
          session.sharedDeviceId = undefined;
          this.attention(
            session,
            "Human takeover ended. Private contents remain unavailable to agents; open a fresh session for automated work.",
          );
        }
      }
    } finally {
      this.expiring = false;
    }
  }
  destroy(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    this.adapter?.destroy(id);
    session.frame = null;
    session.reportFrame = null;
    this.notify();
  }
  async operation(session, run) {
    this.guard(session);
    if (session.busy)
      throw new ApiError(429, "A browser operation is already running.");
    session.busy = true;
    try {
      const result = await run();
      this.guard(session);
      return result;
    } catch (error) {
      if (error.sensitive) this.attention(session);
      if (error.status) throw error;
      throw new ApiError(
        409,
        "Browser operation could not be confirmed. Refresh the session before retrying.",
      );
    } finally {
      session.busy = false;
    }
  }
  async create(body, principal, monitor = null, monitorHuman = false) {
    keys(body, ["mode", "projectId", "taskId", "workflowId", "url"]);
    this.access(principal);
    if (!["project", "research", "private"].includes(body.mode))
      throw new ApiError(400, "Choose project, research or private browsing.");
    if (this.sessions.size >= 4)
      throw new ApiError(
        429,
        "Close a browser session before opening another (maximum four).",
      );
    const association = this.association(body, principal);
    const preview =
      body.mode === "project"
        ? this.host.projectPreviews?.browserOrigin(body.projectId)
        : null;
    if (
      body.mode === "project" &&
      (!preview ||
        !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(preview.origin))
    )
      throw new ApiError(
        409,
        "Start a reviewed local project preview before opening its browser.",
      );
    const url = browserUrl(
      body.url || preview?.origin || "about:blank",
      body.mode,
      preview?.origin,
    );
    const session = {
      id: uid(),
      mode: body.mode,
      ...(monitor
        ? { monitorId: monitor.id, profileId: monitor.profileId }
        : {}),
      ...association,
      origin: preview?.origin,
      launchId: preview?.launchId,
      requestedBy: { kind: principal.kind, id: principal.id },
      status: "loading",
      tabs: new Map(),
      version: 0,
      tainted: body.mode === "private",
      controller:
        body.mode === "private" && !monitor
          ? { kind: principal.kind, id: principal.id }
          : null,
      controllerUntil: this.clock() + 120000,
      hasFrame: false,
      createdAt: now(),
      updatedAt: now(),
      touched: this.clock(),
      lastFrameAt: -Infinity,
    };
    this.sessions.set(session.id, session);
    try {
      await this.adapter.create({
        id: session.id,
        mode: session.mode,
        origin: session.origin,
        ...(monitor ? { profileId: monitor.profileId, monitorHuman } : {}),
        onChange: (event) => {
          if (this.sessions.get(session.id) !== session) return;
          session.version++;
          session.frame = null;
          session.reportFrame = null;
          session.hasFrame = false;
          const tab = session.tabs.get(event.tabId);
          if (tab) {
            if (event.url) tab.url = event.url.slice(0, 2048);
            if (event.title) tab.title = redact(event.title).slice(0, 200);
            if (event.loading !== undefined) tab.loading = event.loading;
          }
          if (event.attentionReason || event.error) {
            session.attentionId ||= uid();
            session.status = event.error ? "error" : "attention";
            session.attentionReason = event.attentionReason || event.error;
          } else if (!session.controller && !session.attentionId)
            session.status = event.loading ? "loading" : "ready";
          this.notify(session);
        },
      });
      this.access(principal);
      this.guard(session);
      await this.newTab(session, url);
      if (session.controller) session.status = "human_control";
      this.notify(session);
      return {
        session: this.publicStatus(principal).sessions.find(
          (row) => row.id === session.id,
        ),
      };
    } catch (error) {
      this.destroy(session.id);
      if (error.status) throw error;
      throw new ApiError(
        409,
        "The internal browser could not open this session.",
      );
    }
  }
  monitorVisible(id, principal) {
    const monitor = this.host.store.state.monitors?.find(
      (row) => row.id === id,
    );
    return Boolean(
      monitor &&
      this.allowed(principal) &&
      (principal.kind === "owner" ||
        monitor.sharedDeviceIds?.includes(principal.id)),
    );
  }
  // A monitor owns an opaque private profile. Models never receive its DOM,
  // frames or cookies, even when a deterministic local check is active.
  async openMonitor(monitor, principal, { human = true } = {}) {
    this.access(principal);
    if (!this.monitorVisible(monitor.id, principal))
      throw new ApiError(
        403,
        "This private monitor is not shared with this device.",
      );
    let session = [...this.sessions.values()].find(
      (row) =>
        row.monitorId === monitor.id && row.profileId === monitor.profileId,
    );
    if (!session) {
      const result = await this.create(
        { mode: "private", url: human ? monitor.url : "about:blank" },
        { kind: "owner", id: "desktop" },
        monitor,
        human,
      );
      session = this.sessions.get(result.session.id);
    }
    this.guard(session);
    if (human) {
      if (session.busy)
        throw new ApiError(
          409,
          "Wait for the current private browser operation to stop.",
        );
      if (
        session.controller &&
        !same(session.controller, principal) &&
        principal.kind !== "owner" &&
        this.clock() < session.controllerUntil
      )
        throw new ApiError(
          409,
          "Another human currently controls this browser.",
        );
      this.attention(
        session,
        "Private monitor needs your review. Browser contents remain hidden from agents.",
      );
      session.controller = { kind: principal.kind, id: principal.id };
      session.sharedDeviceId =
        principal.kind === "device" ? principal.id : undefined;
      session.controllerUntil = this.clock() + 120000;
      session.status = "human_control";
      await this.adapter?.setMonitorHuman?.(session.id, true);
      this.notify(session);
    }
    return session;
  }
  async forgetMonitorProfile(monitor) {
    for (const session of [...this.sessions.values()])
      if (session.monitorId === monitor.id) this.destroy(session.id);
    await this.adapter?.forgetProfile?.(monitor.profileId);
  }
  async newTab(session, url) {
    this.guard(session);
    if (session.tabs.size >= 4)
      throw new ApiError(
        429,
        "Close this session before opening more tabs (maximum four per session).",
      );
    const tab = {
      id: uid(),
      title: "New tab",
      url: "about:blank",
      loading: true,
    };
    session.tabs.set(tab.id, tab);
    session.activeTabId = tab.id;
    await this.adapter.createTab(session.id, tab.id);
    this.guard(session);
    await this.adapter.navigate(
      session.id,
      tab.id,
      browserUrl(url, session.mode, session.origin),
    );
    this.guard(session);
    return tab;
  }
  requireTab(session, id) {
    const tab = session.tabs.get(id || session.activeTabId);
    if (!tab) throw new ApiError(404, "Browser tab unavailable.");
    return tab;
  }
  human(session, principal) {
    // Recheck live authority after every asynchronous capture/input. Store
    // mutations update sharing before their save completes and before the
    // changed event expires a former controller's lease.
    if (
      !this.allowed(principal) ||
      (session.monitorId && !this.monitorVisible(session.monitorId, principal))
    )
      throw new ApiError(
        403,
        "Private browser permission was revoked; this response is withheld.",
      );
    if (
      !same(session.controller, principal) ||
      this.clock() >= session.controllerUntil
    )
      throw new ApiError(
        409,
        "Take over this browser before interacting with it.",
      );
    session.controllerUntil = this.clock() + 120000;
  }
  attention(
    session,
    reason = "Login or sensitive fields need human attention.",
  ) {
    session.attentionId ||= uid();
    session.version++;
    session.tainted = true;
    session.hasFrame = false;
    session.frame = null;
    session.reportFrame = null;
    session.status = "attention";
    session.attentionReason = reason;
    this.notify(session);
  }
  async frame(session, body, principal, agent = false) {
    const tab = this.requireTab(session, body.tabId);
    if (session.tainted && (agent || !same(session.controller, principal)))
      throw new ApiError(
        403,
        "Private frames are visible only to the current human controller.",
      );
    if (this.clock() - session.lastFrameAt < 350)
      throw new ApiError(429, "Wait briefly for the next browser frame.");
    session.lastFrameAt = this.clock();
    session.frame = null;
    const version = session.version;
    return this.operation(session, async () => {
      const captured = await this.adapter.capture(session.id, tab.id, {
        privateAllowed: session.tainted && !agent,
      });
      this.access(principal);
      this.guard(session);
      if (session.version !== version)
        throw new ApiError(
          409,
          "Browser page or controller changed during capture. Request a fresh frame.",
        );
      if (captured.sensitive) {
        this.attention(session);
        throw new ApiError(
          409,
          "Login requires a private human takeover; no frame was shared.",
        );
      }
      if (
        !Buffer.isBuffer(captured.jpeg) ||
        captured.jpeg.length > 1200000 ||
        captured.jpeg[0] !== 255 ||
        captured.jpeg[1] !== 216 ||
        !Number.isInteger(captured.width) ||
        !Number.isInteger(captured.height) ||
        captured.width < 1 ||
        captured.height < 1 ||
        captured.width > 1600 ||
        captured.height > 1600
      )
        throw new ApiError(409, "Browser returned an unsupported image.");
      if (session.tainted) this.human(session, principal);
      const stamp = this.clock(),
        frameId = uid();
      session.frame = {
        id: frameId,
        tabId: tab.id,
        stamp,
        principal: { kind: principal.kind, id: principal.id },
        revision: captured.revision,
      };
      session.hasFrame = true;
      if (
        !session.tainted &&
        session.mode === "project" &&
        captured.jpeg.length <= 262144
      )
        session.reportFrame = {
          bytes: Buffer.from(captured.jpeg),
          mimeType: "image/jpeg",
          url: tab.url,
          capturedAt: new Date(stamp).toISOString(),
          caption:
            "Local project preview captured during browser verification.",
        };
      return {
        sessionId: session.id,
        tabId: tab.id,
        frameId,
        width: captured.width,
        height: captured.height,
        image: `data:image/jpeg;base64,${captured.jpeg.toString("base64")}`,
        capturedAt: new Date(stamp).toISOString(),
        expiresAt: new Date(stamp + 3000).toISOString(),
      };
    });
  }
  async dispatch(method, route, body, principal) {
    if (route === "/api/browser-studio" && method === "GET")
      return this.publicStatus(principal);
    if (route === "/api/browser-studio/sessions" && method === "POST")
      return this.create(body, principal);
    const match =
      /^\/api\/browser-studio\/sessions\/([^/]+)(?:\/(tabs|activate|navigate|frame|control|takeover|release|attention|handoff))?$/.exec(
        route,
      );
    if (!match) throw new ApiError(404, "Browser endpoint unavailable.");
    const session = this.session(match[1], principal),
      action = match[2];
    if (!action && method === "DELETE") {
      this.destroy(session.id);
      return { closed: true };
    }
    if (method !== "POST")
      throw new ApiError(404, "Browser endpoint unavailable.");
    if (action === "handoff") {
      keys(body, ["deviceId"]);
      if (session.monitorId && session.busy)
        throw new ApiError(
          409,
          "Wait for the bounded monitor operation to finish before taking private control.",
        );
      if (principal.kind !== "owner")
        throw new ApiError(
          403,
          "Only Windows can hand a private browser to a phone.",
        );
      if (session.mode === "research")
        throw new ApiError(403, "Research pages cannot accept login.");
      const recipient = { kind: "device", id: body.deviceId };
      this.access(recipient);
      this.attention(
        session,
        "Private browser handed to the selected phone for human control.",
      );
      session.sharedDeviceId = recipient.id;
      session.controller = recipient;
      session.controllerUntil = this.clock() + 120000;
      session.status = "human_control";
      if (session.monitorId)
        await this.adapter?.setMonitorHuman?.(session.id, true);
    } else if (action === "takeover") {
      keys(body, []);
      if (session.monitorId && session.busy)
        throw new ApiError(
          409,
          "Wait for the bounded monitor operation to finish before taking private control.",
        );
      if (session.mode === "research")
        throw new ApiError(
          403,
          "Research sessions cannot accept typing or login. Open a private session.",
        );
      if (
        session.controller &&
        !same(session.controller, principal) &&
        principal.kind !== "owner"
      )
        throw new ApiError(409, "Another human controls this browser.");
      this.attention(
        session,
        "Human takeover: this session is permanently private to agents.",
      );
      if (principal.kind === "owner") session.sharedDeviceId = undefined;
      session.controller = { kind: principal.kind, id: principal.id };
      session.controllerUntil = this.clock() + 120000;
      session.status = "human_control";
      if (session.monitorId)
        await this.adapter?.setMonitorHuman?.(session.id, true);
      this.notify(session);
    } else if (action === "release") {
      keys(body, []);
      this.human(session, principal);
      session.controller = null;
      session.sharedDeviceId = undefined;
      if (session.monitorId)
        await this.adapter?.setMonitorHuman?.(session.id, false);
      this.attention(
        session,
        "Human takeover released. Open a fresh session to resume agent work.",
      );
    } else if (action === "attention") {
      keys(body, ["reason"]);
      this.attention(
        session,
        body.reason
          ? redact(text(body.reason, 200, "attention reason"))
          : undefined,
      );
    } else if (action === "frame") {
      keys(body, ["tabId"]);
      return this.frame(session, body, principal);
    } else if (action === "activate") {
      keys(body, ["tabId"]);
      if (session.tainted) this.human(session, principal);
      session.activeTabId = this.requireTab(session, body.tabId).id;
      session.frame = null;
      session.hasFrame = false;
      session.version++;
    } else if (action === "tabs") {
      keys(body, ["url"]);
      if (session.tainted) this.human(session, principal);
      await this.operation(session, () =>
        this.newTab(
          session,
          browserUrl(body.url || "about:blank", session.mode, session.origin),
        ),
      );
    } else if (action === "navigate") {
      keys(body, ["tabId", "url"]);
      if (session.tainted) this.human(session, principal);
      const tab = this.requireTab(session, body.tabId),
        url = browserUrl(body.url, session.mode, session.origin);
      await this.operation(session, () =>
        this.adapter.navigate(session.id, tab.id, url),
      );
      session.activeTabId = tab.id;
    } else if (action === "control") {
      keys(body, [
        "tabId",
        "frameId",
        "kind",
        "x",
        "y",
        "deltaY",
        "key",
        "text",
      ]);
      this.human(session, principal);
      if (session.mode === "research")
        throw new ApiError(403, "Research pages are read-only.");
      const tab = this.requireTab(session, body.tabId),
        frame = session.frame,
        input = browserInput(body);
      if (
        !frame ||
        body.frameId !== frame.id ||
        frame.tabId !== tab.id ||
        !same(frame.principal, principal) ||
        this.clock() - frame.stamp > 3000
      )
        throw new ApiError(
          409,
          "Refresh the browser image before interacting.",
        );
      session.frame = null;
      const guard = () => {
        this.access(principal);
        this.guard(session);
        this.human(session, principal);
      };
      await this.operation(session, () => {
        guard();
        return this.adapter.input(session.id, tab.id, input, guard);
      });
      return { applied: true };
    }
    this.access(principal);
    this.notify(session);
    return {
      session: this.publicStatus(principal).sessions.find(
        (row) => row.id === session.id,
      ),
    };
  }
  async agentAction(body, { taskId, principal }) {
    this.access(principal);
    const task = this.host.store.state.tasks.find((row) => row.id === taskId);
    if (!task || !["queued", "running"].includes(task.status))
      throw new ApiError(
        409,
        "An active host task is required for agent browser actions.",
      );
    this.association(
      { taskId, projectId: task.projectId, workflowId: task.workflowId },
      principal,
      true,
    );
    if (body.action === "create") {
      if (!["project", "research"].includes(body.mode))
        throw new ApiError(
          403,
          "Agents cannot open authenticated/private browser sessions.",
        );
      const result = await this.create(
        {
          mode: body.mode,
          projectId: task.projectId,
          taskId,
          workflowId: task.workflowId,
          url: body.url,
        },
        principal,
      );
      if (!["queued", "running"].includes(task.status)) {
        this.destroy(result.session.id);
        throw new ApiError(
          409,
          "Agent browser task stopped before opening completed.",
        );
      }
      return result;
    }
    const session = this.session(body.sessionId, principal);
    if (
      session.taskId !== taskId ||
      session.projectId !== task.projectId ||
      session.tainted ||
      session.controller
    )
      throw new ApiError(
        403,
        "This browser is private, human-controlled or belongs to another task.",
      );
    const tab = this.requireTab(session, body.tabId);
    const guard = () => {
      this.access(principal);
      this.guard(session);
      if (
        !["queued", "running"].includes(task.status) ||
        session.tainted ||
        session.controller
      )
        throw new ApiError(409, "Agent browser work paused or stopped.");
    };
    if (body.action === "screenshot") {
      const result = await this.frame(
        session,
        { tabId: tab.id },
        principal,
        true,
      );
      guard();
      return result;
    }
    if (body.action === "attention") {
      this.attention(
        session,
        "The agent requested human attention. Browser content is now private.",
      );
      return { status: "attention", sessionId: session.id };
    }
    return this.operation(session, async () => {
      guard();
      if (body.action === "read") {
        const result = await this.adapter.read(session.id, tab.id);
        guard();
        if (result.sensitive) {
          this.attention(session);
          return {
            status: "attention",
            sessionId: session.id,
            detail: "Login/sensitive content withheld.",
          };
        }
        session.readReceipt = {
          tabId: tab.id,
          revision: result.revision,
          at: this.clock(),
          ids: new Set((result.elements || []).map((row) => row.id)),
        };
        return {
          sessionId: session.id,
          tabId: tab.id,
          url: redact(String(result.url)).slice(0, 2048),
          title: redact(String(result.title)).slice(0, 200),
          text: redact(String(result.text)).slice(0, 40000),
          elements: (result.elements || []).slice(0, 150).map((row) => ({
            id: String(row.id),
            tag: String(row.tag).slice(0, 20),
            text: redact(String(row.text)).slice(0, 160),
            href: row.href
              ? redact(String(row.href)).slice(0, 2048)
              : undefined,
          })),
        };
      }
      if (body.action === "navigate")
        await this.adapter.navigate(
          session.id,
          tab.id,
          browserUrl(body.url, session.mode, session.origin),
        );
      else if (["click", "type"].includes(body.action)) {
        const receipt = session.readReceipt;
        if (
          !receipt ||
          receipt.tabId !== tab.id ||
          this.clock() - receipt.at > 30000 ||
          !receipt.ids.has(String(body.elementId))
        )
          throw new ApiError(
            409,
            "Read the browser page again before choosing a target.",
          );
        session.readReceipt = null;
        if (session.mode === "research") {
          if (body.action !== "click")
            throw new ApiError(403, "Research never types or submits forms.");
          const href = await this.adapter.element(
            session.id,
            tab.id,
            body.elementId,
            receipt.revision,
            "link",
            undefined,
            guard,
          );
          guard();
          await this.adapter.navigate(
            session.id,
            tab.id,
            browserUrl(href, "research"),
          );
        } else
          await this.adapter.element(
            session.id,
            tab.id,
            body.elementId,
            receipt.revision,
            body.action,
            body.action === "type"
              ? text(body.text, 1000, "browser text")
              : undefined,
            guard,
          );
      } else if (body.action === "scroll" || body.action === "key") {
        if (session.mode === "research" && body.action !== "scroll")
          throw new ApiError(403, "Research never submits forms.");
        await this.adapter.input(
          session.id,
          tab.id,
          browserInput({ ...body, kind: body.action }),
          guard,
        );
      } else throw new ApiError(400, "Unsupported agent browser action.");
      guard();
      session.frame = null;
      session.reportFrame = null;
      return { applied: true, sessionId: session.id, tabId: tab.id };
    });
  }
  reportImages(projectId) {
    const images = [];
    for (const session of this.sessions.values()) {
      try {
        this.guard(session);
      } catch {
        continue;
      }
      if (
        session.projectId === projectId &&
        session.mode === "project" &&
        !session.tainted &&
        !session.controller &&
        session.reportFrame &&
        this.clock() - Date.parse(session.reportFrame.capturedAt) < 10 * 60000
      )
        images.push({
          ...session.reportFrame,
          bytes: Buffer.from(session.reportFrame.bytes),
        });
    }
    return images.slice(-2);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.host.store.off("changed", this.changed);
    for (const id of [...this.sessions.keys()]) this.destroy(id);
    this.adapter?.close();
  }
}
