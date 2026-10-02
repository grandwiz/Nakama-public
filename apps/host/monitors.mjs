import { ApiError, uid, digest, redact, requireOwner } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { browserUrl } from "./browser-studio.mjs";

const OWNER = { kind: "owner", id: "desktop" };
const OUTCOMES = new Set([
  "match",
  "no_match",
  "unknown",
  "captcha",
  "queue",
  "login",
  "payment",
  "unavailable",
  "unsupported",
  "price_changed",
  "checkout",
  "uncertain",
  "sensitive",
]);
const DETAILS =
  "Local checks use no AI or paid provider calls. Keep the Windows host running. Website sessions are private and isolated. Native-form cart preparation needs exact PC approval; payment and order completion are always human. Android observation needs a separate visible, unlocked, exact-app consent session.";
const DETAIL = {
  match:
    "The configured condition matched. Review the current private page or application.",
  no_match: "The configured condition did not match this check.",
  unknown:
    "The page evidence is missing, ambiguous or changed. Review it before resuming.",
  captcha:
    "The website requires a human challenge or has limited requests. No challenge is bypassed.",
  queue:
    "A waiting room or queue needs human attention. Automatic refresh has stopped.",
  login:
    "Sign in privately before continuing. Login details are never sent to an agent.",
  payment:
    "Payment or sensitive checkout controls need you. No payment or order was submitted.",
  unavailable: "The source is unavailable. No matching condition is assumed.",
  unsupported:
    "This shop does not meet the approved native-form requirements. Continue privately yourself.",
  price_changed:
    "The price or currency does not match the approved limit. Continue privately yourself.",
  checkout:
    "The checkout page is open for you to review and complete payment yourself. No order was placed by Nakama.",
  uncertain:
    "A cart attempt may have changed the shop. Review it yourself; Nakama will not repeat that attempt.",
  sensitive:
    "The application screen is sensitive. No screen content was shared.",
};
function fields(body, allowed) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "Unexpected monitoring fields.");
}
function text(value, max, label, empty = false) {
  if (empty && (value == null || value === "")) return "";
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value) ||
    redact(value) !== value
  )
    throw new ApiError(400, `Enter a valid ${label} without credentials.`);
  return value.trim();
}
function condition(input, kind) {
  input ||= kind === "website" ? { type: "stock" } : {};
  fields(input, ["type", "contains", "excludes", "sku"]);
  if (input.type === "stock") {
    if (kind !== "website" || input.contains || input.excludes)
      throw new ApiError(
        400,
        "Stock conditions use website product data only.",
      );
    return {
      type: "stock",
      ...(input.sku ? { sku: text(input.sku, 100, "exact product SKU") } : {}),
    };
  }
  if ((input.type && input.type !== "text") || input.sku)
    throw new ApiError(400, "Choose a stock or literal text condition.");
  const result = {
    type: "text",
    contains: text(input.contains, 200, "exact matching text"),
  };
  if (input.excludes)
    result.excludes = text(input.excludes, 200, "excluded text");
  if (
    result.excludes &&
    result.excludes.toLowerCase() === result.contains.toLowerCase()
  )
    throw new ApiError(400, "Positive and excluded text must differ.");
  return result;
}
function validateRecipe(input) {
  fields(input, [
    "enabled",
    "productText",
    "variantField",
    "variantValue",
    "priceText",
    "maxPrice",
    "currency",
    "cartPath",
    "checkoutPath",
    "addLabel",
    "checkoutLabel",
  ]);
  if (input.enabled === false) return { enabled: false };
  if (
    input.enabled !== true ||
    !["/cart/add"].includes(input.cartPath) ||
    input.checkoutPath !== "/checkout"
  )
    throw new ApiError(
      400,
      "Only the reviewed native /cart/add form and /checkout link adapter is supported.",
    );
  if (
    !Number.isFinite(input.maxPrice) ||
    input.maxPrice <= 0 ||
    input.maxPrice > 100000 ||
    Math.abs(Math.round(input.maxPrice * 100) - input.maxPrice * 100) > 1e-6
  )
    throw new ApiError(
      400,
      "Enter an exact positive price limit with at most two decimals.",
    );
  if (
    !/^[A-Z]{3}$/.test(input.currency) ||
    !/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(input.variantField) ||
    /quantity|qty|card|payment|order|token|address/i.test(input.variantField)
  )
    throw new ApiError(400, "Choose a product variant field and ISO currency.");
  if (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: input.currency,
    }).resolvedOptions().maximumFractionDigits !== 2
  )
    throw new ApiError(
      400,
      "This cart adapter currently supports currencies with two decimal minor units; other currencies require manual checkout.",
    );
  const result = { ...input };
  for (const key of [
    "productText",
    "variantValue",
    "priceText",
    "addLabel",
    "checkoutLabel",
  ])
    result[key] = text(input[key], 160, key);
  if (
    /pay|order|buy now|purchase|one.click/i.test(
      `${result.addLabel} ${result.checkoutLabel}`,
    )
  )
    throw new ApiError(
      400,
      "Payment or order-placement labels cannot be automated.",
    );
  return result;
}

export class Monitoring {
  constructor(host, { adapter = null, clock = Date.now, timers = true } = {}) {
    this.host = host;
    this.adapter = adapter;
    this.clock = clock;
    this.timers = timers;
    this.running = new Map();
    this.epochs = new Map();
    this.consents = new Map();
    this.closed = false;
  }
  async init() {
    await this.host.store.change((state) => {
      state.monitors ||= [];
      for (const row of state.monitors)
        if (["active", "checking"].includes(row.status)) {
          row.status = "paused";
          row.nextCheckAt = null;
          row.revision++;
          row.detail =
            "Control Center restarted. Review this monitor and explicitly resume; no cart attempt is replayed.";
          if (row.attempt?.status === "started")
            row.attempt.status = "uncertain";
        }
    });
    if (this.timers) {
      this.timer = setInterval(() => void this.tick().catch(() => {}), 1000);
      this.timer.unref?.();
    }
    return this;
  }
  access(principal) {
    if (this.closed || this.host.closing || this.host.maintenanceLock)
      throw new ApiError(
        503,
        "Monitoring is closing or paused for maintenance.",
      );
    assertPersonalAccess(this.host.store.state, principal);
  }
  permitted(row, principal) {
    try {
      this.access(principal);
    } catch {
      return false;
    }
    return (
      principal.kind === "owner" ||
      row.requestedBy === principal.id ||
      row.sharedDeviceIds?.includes(principal.id) ||
      row.deviceId === principal.id
    );
  }
  row(id, principal) {
    this.access(principal);
    const row = this.host.store.state.monitors?.find((row) => row.id === id);
    if (!row || !this.permitted(row, principal))
      throw new ApiError(404, "Monitor unavailable.");
    return row;
  }
  revision(row, body) {
    if (!Number.isInteger(body.revision) || body.revision !== row.revision)
      throw new ApiError(
        409,
        "This monitor changed. Refresh it before continuing.",
      );
  }
  publicRow(row) {
    const { profileId, ...safe } = row;
    return structuredClone(safe);
  }
  list(principal) {
    assertPersonalAccess(this.host.store.state, principal);
    return {
      available: true,
      websiteAvailable: this.adapter?.websiteAvailable === true,
      windowsAvailable: this.adapter?.windowsAvailable === true,
      monitors: (this.host.store.state.monitors || [])
        .filter(
          (row) =>
            principal.kind === "owner" ||
            row.requestedBy === principal.id ||
            row.sharedDeviceIds?.includes(principal.id) ||
            row.deviceId === principal.id,
        )
        .map((row) => this.publicRow(row)),
      detail: DETAILS,
    };
  }
  touch(row) {
    row.revision++;
    row.updatedAt = new Date(this.clock()).toISOString();
  }
  invalidate(row) {
    this.epochs.set(row.id, (this.epochs.get(row.id) || 0) + 1);
    for (const [id, consent] of this.consents)
      if (consent.monitorId === row.id) this.consents.delete(id);
  }
  async create(body, principal) {
    fields(body, [
      "title",
      "kind",
      "url",
      "processName",
      "deviceId",
      "packageName",
      "condition",
      "intervalSeconds",
      "expiresAt",
      "sharedDeviceIds",
    ]);
    this.access(principal);
    if (!["website", "windows_app", "android_app"].includes(body.kind))
      throw new ApiError(
        400,
        "Choose website, Windows app or Android app monitoring.",
      );
    const intervalSeconds = body.intervalSeconds ?? 60;
    if (
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds < 30 ||
      intervalSeconds > 86400
    )
      throw new ApiError(400, "Use a monitoring interval of 30–86400 seconds.");
    const expires = body.expiresAt
      ? Date.parse(body.expiresAt)
      : this.clock() + 30 * 86400000;
    if (
      !Number.isFinite(expires) ||
      expires <= this.clock() ||
      expires > this.clock() + 90 * 86400000
    )
      throw new ApiError(400, "Choose an expiry within the next 90 days.");
    if (body.sharedDeviceIds && principal.kind !== "owner")
      throw new ApiError(403, "Only Windows selects private-monitor sharing.");
    const shared =
      body.sharedDeviceIds ||
      (principal.kind === "device" ? [principal.id] : []);
    if (
      !Array.isArray(shared) ||
      shared.length > 10 ||
      new Set(shared).size !== shared.length ||
      shared.some(
        (id) =>
          !this.host.store.state.devices.some(
            (device) =>
              device.id === id &&
              device.platform === "android" &&
              device.permissions?.googleAccess !== false &&
              device.permissions?.projectAccess !== false &&
              (body.kind !== "website" ||
                device.permissions?.browserControl === true),
          ),
      )
    )
      throw new ApiError(400, "Select permitted paired Android devices.");
    const row = {
      id: uid(),
      revision: 1,
      title: text(body.title, 100, "monitor title"),
      kind: body.kind,
      condition: condition(body.condition, body.kind),
      intervalSeconds,
      expiresAt: new Date(expires).toISOString(),
      sharedDeviceIds: shared,
      requestedBy: principal.id,
      status: "paused",
      nextCheckAt: null,
      lastOutcome: null,
      lastCheckedAt: null,
      detail: "Saved paused. Review settings, then resume local checks.",
      failures: 0,
      createdAt: new Date(this.clock()).toISOString(),
      updatedAt: new Date(this.clock()).toISOString(),
    };
    if (body.kind === "website") {
      row.url = browserUrl(
        text(body.url, 2048, "public product URL"),
        "private",
      );
      const url = new URL(row.url);
      if (
        url.hash ||
        [...url.searchParams.keys()].some((key) =>
          /token|secret|password|credential|session|auth|signature|api.?key|code/i.test(
            key,
          ),
        ) ||
        /\/(?:login|signin|sign-in|oauth|authorize|callback)(?:[/?#]|$)/i.test(
          url.href,
        )
      )
        throw new ApiError(
          400,
          "Use a public product URL without login, fragment or credential parameters. Sign in only inside the private browser.",
        );
      if (url.port && url.port !== "443")
        throw new ApiError(400, "Website monitors use public HTTPS port 443.");
      row.profileId = uid();
    }
    if (body.kind === "windows_app") {
      requireOwner(principal);
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_. -]{0,100}\.exe$/i.test(
          body.processName || "",
        )
      )
        throw new ApiError(
          400,
          "Enter an exact .exe process name without paths.",
        );
      row.processName = body.processName;
    }
    if (body.kind === "android_app") {
      const device = this.host.store.state.devices.find(
        (item) => item.id === body.deviceId && item.platform === "android",
      );
      if (
        !device ||
        (principal.kind !== "owner" && device.id !== principal.id) ||
        device.permissions?.googleAccess === false ||
        device.permissions?.projectAccess === false
      )
        throw new ApiError(403, "Choose your permitted paired Android device.");
      if (
        !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(
          body.packageName || "",
        ) ||
        /^(?:android|dev\.nakama\.companion|com\.android\.|com\.google\.android\.permissioncontroller)/.test(
          body.packageName,
        ) ||
        /settings|systemui|packageinstaller/i.test(body.packageName)
      )
        throw new ApiError(
          400,
          "Choose an ordinary Android application package.",
        );
      row.deviceId = device.id;
      row.packageName = body.packageName;
    }
    await this.host.store.change((state) => {
      this.access(principal);
      if ((state.monitors || []).length >= 30)
        throw new ApiError(
          409,
          "Remove a monitor before adding another (maximum 30).",
        );
      (state.monitors ||= []).push(row);
    });
    return { monitor: this.publicRow(row) };
  }
  async mutate(row, principal, body, fn) {
    await this.host.store.change(() => {
      const current = this.row(row.id, principal);
      this.revision(current, body);
      fn(current);
      this.touch(current);
    });
    return { monitor: this.publicRow(row) };
  }
  async dispatch(method, route, body = {}, principal) {
    if (route === "/api/monitors") {
      if (method === "GET") return this.list(principal);
      if (method === "POST") return this.create(body, principal);
    }
    const match =
      /^\/api\/monitors\/([^/]+)(?:\/(resume|pause|check|acknowledge|open|setup-confirm|forget-profile|recipe|sharing|observe-consent|observe-revoke|observation))?$/.exec(
        route,
      );
    if (!match) throw new ApiError(404, "Monitoring endpoint unavailable.");
    const row = this.row(match[1], principal),
      action = match[2];
    if (!action && method === "DELETE") {
      fields(body, ["revision"]);
      this.revision(row, body);
      requireOwner(principal);
      this.invalidate(row);
      // Save the disabled state before clearing private storage. A failed
      // deletion never allows checks to continue on a partly removed profile.
      await this.mutate(row, principal, body, (current) => {
        current.status = "paused";
        current.nextCheckAt = null;
      });
      if (row.profileId)
        await this.host.browserStudio.forgetMonitorProfile(row);
      await this.host.store.change((state) => {
        state.monitors = state.monitors.filter((item) => item.id !== row.id);
      });
      return { removed: true };
    }
    if (method !== "POST")
      throw new ApiError(404, "Monitoring endpoint unavailable.");
    if (action === "sharing") {
      fields(body, ["revision", "sharedDeviceIds"]);
      requireOwner(principal);
      this.revision(row, body);
      if (row.kind !== "website")
        throw new ApiError(
          400,
          "Private browser sharing belongs to website monitors.",
        );
      const shared = body.sharedDeviceIds;
      if (
        !Array.isArray(shared) ||
        shared.length > 10 ||
        new Set(shared).size !== shared.length ||
        shared.some(
          (id) =>
            !this.host.store.state.devices.some(
              (device) =>
                device.id === id &&
                device.platform === "android" &&
                device.permissions?.googleAccess !== false &&
                device.permissions?.projectAccess !== false &&
                (row.kind !== "website" ||
                  device.permissions?.browserControl === true),
            ),
        )
      )
        throw new ApiError(400, "Select permitted paired Android devices.");
      this.invalidate(row);
      return this.mutate(row, principal, body, (current) => {
        current.sharedDeviceIds = [...shared];
        current.status = "paused";
        current.nextCheckAt = null;
        current.detail =
          "Private handoff and alert devices updated. Review and explicitly resume monitoring.";
      });
    }
    if (action === "observe-revoke") {
      fields(body, ["consentId"]);
      const consent = this.consents.get(body.consentId);
      if (
        consent &&
        (principal.kind !== "device" ||
          consent.deviceId !== principal.id ||
          consent.monitorId !== row.id)
      )
        throw new ApiError(
          403,
          "This observation consent belongs to another device.",
        );
      this.consents.delete(body.consentId);
      return { revoked: true };
    }
    if (action === "observation") return this.observation(row, body, principal);
    if (action === "observe-consent") {
      fields(body, ["revision", "packageName"]);
      this.revision(row, body);
      if (
        row.kind !== "android_app" ||
        principal.kind !== "device" ||
        row.deviceId !== principal.id ||
        row.packageName !== body.packageName ||
        row.status !== "active" ||
        Date.parse(row.expiresAt) <= this.clock()
      )
        throw new ApiError(
          403,
          "Start observation on the exact selected Android app after resuming its monitor.",
        );
      this.invalidate(row);
      const consentId = uid(),
        expiresAt = new Date(
          Math.min(this.clock() + 30 * 60000, Date.parse(row.expiresAt)),
        ).toISOString();
      this.consents.set(consentId, {
        monitorId: row.id,
        deviceId: principal.id,
        packageName: row.packageName,
        configDigest: digest(JSON.stringify(row.condition)),
        expiresAt,
        lastAt: 0,
      });
      return { monitor: this.publicRow(row), consentId, expiresAt };
    }
    if (action === "open") {
      fields(body, ["revision", "reason"]);
      this.revision(row, body);
      if (
        row.kind !== "website" ||
        (body.reason &&
          !["setup", "checkout", "captcha", "page"].includes(body.reason))
      )
        throw new ApiError(
          400,
          "Only website monitors have a private browser.",
        );
      this.invalidate(row);
      await this.mutate(row, principal, body, (current) => {
        current.status = "paused";
        current.nextCheckAt = null;
      });
      const session = await this.host.browserStudio.openMonitor(row, principal);
      await this.host.store.change(() => {
        row.browserSessionId = session.id;
        this.touch(row);
      });
      return {
        monitor: this.publicRow(row),
        sessionId: session.id,
        outcome: {
          type: "navigate",
          target: "browser",
          browserSessionId: session.id,
        },
      };
    }
    if (action === "setup-confirm") {
      fields(body, ["revision", "addressConfirmed"]);
      requireOwner(principal);
      if (row.kind !== "website" || body.addressConfirmed !== true)
        throw new ApiError(
          400,
          "Confirm that you privately checked your login and delivery details.",
        );
      const session = [...this.host.browserStudio.sessions.values()].find(
        (item) =>
          item.monitorId === row.id && item.controller?.kind === "owner",
      );
      if (!session)
        throw new ApiError(
          409,
          "Open this monitor's private browser and check your details first.",
        );
      return this.mutate(row, principal, body, (current) => {
        current.setupConfirmedAt = new Date(this.clock()).toISOString();
        current.detail =
          "You confirmed private login and delivery details. This is your attestation, not an automated checkout acceptance test.";
      });
    }
    if (action === "recipe") {
      fields(body, ["revision", "recipe", "confirmed"]);
      requireOwner(principal);
      if (
        row.kind !== "website" ||
        body.confirmed !== true ||
        !row.setupConfirmedAt
      )
        throw new ApiError(
          403,
          "First confirm private setup, then approve the exact native-form recipe on Windows.",
        );
      const recipe = validateRecipe(body.recipe);
      this.revision(row, body);
      if (recipe.enabled) this.host.remoteDesktop?.assertOwnerApprovalAllowed();
      this.invalidate(row);
      return this.mutate(row, principal, body, (current) => {
        if (recipe.enabled)
          this.host.remoteDesktop?.assertOwnerApprovalAllowed();
        current.recipe = recipe;
        current.recipeApprovedAt = new Date(this.clock()).toISOString();
        current.status = "paused";
        current.nextCheckAt = null;
        current.detail =
          "Exact native-form recipe saved. Quantity is one. Payment and order completion remain human; unsupported pages stop.";
      });
    }
    if (action === "forget-profile") {
      fields(body, ["revision"]);
      requireOwner(principal);
      this.revision(row, body);
      if (row.kind !== "website")
        throw new ApiError(400, "This monitor has no private browser profile.");
      this.invalidate(row);
      await this.mutate(row, principal, body, (current) => {
        current.status = "paused";
        current.nextCheckAt = null;
        current.recipe = { enabled: false };
        current.setupConfirmedAt = null;
      });
      await this.host.browserStudio.forgetMonitorProfile(row);
      await this.host.store.change(() => {
        row.profileId = uid();
        row.browserSessionId = null;
        row.detail =
          "Dedicated cookies and site storage were cleared. Sign in again before future checkout setup.";
        this.touch(row);
      });
      return { monitor: this.publicRow(row) };
    }
    fields(body, ["revision"]);
    this.revision(row, body);
    if (action === "check") {
      if (row.status !== "active")
        throw new ApiError(409, "Resume this monitor before checking.");
      await this.check(row);
      return { monitor: this.publicRow(row) };
    }
    if (action === "resume") {
      if (Date.parse(row.expiresAt) <= this.clock())
        throw new ApiError(
          409,
          "This monitor expired. Create a new reviewed monitor.",
        );
      if (row.status === "checking")
        throw new ApiError(409, "A check is already running.");
      const controlled = [
        ...(this.host.browserStudio?.sessions.values() || []),
      ].find((session) => session.monitorId === row.id && session.controller);
      if (controlled)
        throw new ApiError(
          409,
          "Release human browser control before resuming checks on this monitor.",
        );
      if (row.lastOutcome === "queue" || row.lastOutcome === "captcha") {
        const session = this.host.browserStudio?.sessions.get(
          row.browserSessionId,
        );
        if (session?.controller)
          throw new ApiError(
            409,
            "Complete the challenge privately, release browser control, then resume.",
          );
      }
      this.invalidate(row);
      return this.mutate(row, principal, body, (current) => {
        current.status = "active";
        current.attentionId = null;
        current.attentionReason = null;
        current.nextCheckAt = new Date(this.clock()).toISOString();
        current.detail =
          current.kind === "android_app"
            ? "Waiting for explicit, visible observation consent on the selected Android device."
            : "Local monitoring resumed. No AI provider is called.";
      });
    }
    if (action === "pause" || action === "acknowledge") {
      this.invalidate(row);
      return this.mutate(row, principal, body, (current) => {
        current.status = "paused";
        current.nextCheckAt = null;
        current.attentionId = null;
        current.attentionReason = null;
        current.detail = "Monitoring paused. Resume explicitly when ready.";
      });
    }
    throw new ApiError(404, "Monitoring operation unavailable.");
  }
  route(method, route, body, principal) {
    return this.dispatch(method, route, body, principal);
  }
  async tick() {
    if (
      this.closed ||
      this.host.closing ||
      this.host.maintenanceLock ||
      this.ticking
    )
      return;
    this.ticking = true;
    try {
      for (const row of this.host.store.state.monitors || []) {
        if (
          ["active", "checking"].includes(row.status) &&
          Date.parse(row.expiresAt) <= this.clock()
        ) {
          this.invalidate(row);
          await this.host.store.change(() => {
            row.status = "expired";
            row.nextCheckAt = null;
            row.detail = "Monitoring permission expired.";
            this.touch(row);
          });
          continue;
        }
        if (
          row.status === "active" &&
          row.kind !== "android_app" &&
          Date.parse(row.nextCheckAt) <= this.clock()
        )
          await this.check(row);
      }
    } finally {
      this.ticking = false;
    }
  }
  async check(row) {
    if (this.running.has(row.id) || row.status !== "active")
      throw new ApiError(409, "This monitor cannot start another check.");
    if (row.kind === "android_app")
      throw new ApiError(
        409,
        "Android checks come only from the selected device's local observation consent.",
      );
    const epoch = this.epochs.get(row.id) || 0;
    const guard = () => {
      if (
        this.closed ||
        this.host.closing ||
        this.host.maintenanceLock ||
        (this.epochs.get(row.id) !== undefined &&
          this.epochs.get(row.id) !== epoch) ||
        !this.host.store.state.monitors.includes(row) ||
        row.status !== "checking" ||
        Date.parse(row.expiresAt) <= this.clock()
      )
        throw new ApiError(409, "Monitor stopped or changed during its check.");
      if (row.requestedBy !== "desktop") {
        const device = this.host.store.state.devices.find(
          (device) => device.id === row.requestedBy,
        );
        if (device)
          assertPersonalAccess(this.host.store.state, {
            kind: "device",
            id: device.id,
          });
        else if (row.requestedBy !== "owner")
          throw new ApiError(
            403,
            "The monitor's requesting device is unavailable.",
          );
      }
    };
    this.running.set(row.id, true);
    let session, result;
    try {
      await this.host.store.change(() => {
        if (row.status !== "active")
          throw new ApiError(409, "Monitor was paused.");
        row.status = "checking";
        this.touch(row);
      });
      guard();
      if (row.kind === "windows_app")
        result = await this.adapter?.checkWindows(row, guard);
      else {
        if (!this.adapter?.websiteAvailable)
          result = { outcome: "unavailable" };
        else {
          session = await this.host.browserStudio.openMonitor(row, OWNER, {
            human: false,
          });
          const browserGuard = () => {
            guard();
            this.host.browserStudio.guard(session);
            if (session.controller)
              throw new ApiError(
                409,
                "Private browser is under human control.",
              );
          };
          browserGuard();
          result = await this.host.browserStudio.operation(
            session,
            async () => {
              let found = await this.adapter.checkWebsite(
                {
                  monitor: row,
                  sessionId: session.id,
                  tabId: session.activeTabId,
                },
                browserGuard,
              );
              browserGuard();
              if (
                found?.outcome === "match" &&
                row.recipe?.enabled &&
                row.setupConfirmedAt &&
                !row.attempt
              ) {
                // The durable attempt is saved before the first possible cart
                // mutation. Save failure, Stop and restart can never replay it.
                await this.host.store.change(() => {
                  browserGuard();
                  row.attempt = {
                    id: uid(),
                    status: "started",
                    createdAt: new Date(this.clock()).toISOString(),
                  };
                  this.touch(row);
                });
                browserGuard();
                try {
                  found = await this.adapter.prepareCheckout(
                    {
                      monitor: row,
                      sessionId: session.id,
                      tabId: session.activeTabId,
                    },
                    browserGuard,
                  );
                } catch {
                  found = { outcome: "uncertain" };
                }
                await this.host.store.change(() => {
                  if (row.attempt?.status === "started")
                    row.attempt.status =
                      found.outcome === "checkout" ? "prepared" : "uncertain";
                  this.touch(row);
                });
              }
              return found;
            },
          );
        }
      }
      guard();
      await this.record(row, result?.outcome, session?.id);
      if (session && row.status === "attention")
        this.host.browserStudio.attention(
          session,
          "Private monitoring needs your attention. Open the current monitor to continue.",
        );
      else if (session && !session.controller)
        this.host.browserStudio.destroy(session.id);
    } catch {
      if (
        row.status === "checking" &&
        (this.epochs.get(row.id) || 0) === epoch
      ) {
        try {
          await this.record(
            row,
            row.attempt?.status === "started" ? "uncertain" : "unavailable",
            session?.id,
          );
        } catch {
          row.status = "paused";
          row.nextCheckAt = null;
          this.invalidate(row);
        }
      }
    } finally {
      this.running.delete(row.id);
    }
  }
  async record(row, rawOutcome, sessionId) {
    const outcome = OUTCOMES.has(rawOutcome) ? rawOutcome : "unknown";
    await this.host.store.change(() => {
      if (!this.host.store.state.monitors.includes(row))
        throw new ApiError(409, "Monitor removed.");
      row.lastOutcome = outcome;
      row.lastCheckedAt = new Date(this.clock()).toISOString();
      row.detail = DETAIL[outcome];
      row.failures =
        outcome === "unavailable" ? Math.min((row.failures || 0) + 1, 8) : 0;
      const attention =
        !["no_match", "unavailable"].includes(outcome) || row.failures >= 3;
      row.status = attention ? "attention" : "active";
      row.nextCheckAt = attention
        ? null
        : new Date(
            this.clock() +
              Math.min(row.intervalSeconds * 1000 * 2 ** row.failures, 3600000),
          ).toISOString();
      if (attention) {
        row.attentionId = uid();
        row.attentionReason = outcome;
        row.browserSessionId = sessionId || row.browserSessionId || null;
      } else {
        row.attentionId = null;
        row.attentionReason = null;
        row.browserSessionId = null;
      }
      if (outcome === "no_match" && row.attempt?.status === "prepared")
        row.attempt = null;
      this.touch(row);
    });
  }
  async observation(row, body, principal) {
    fields(body, [
      "revision",
      "observedAt",
      "packageName",
      "outcome",
      "consentId",
    ]);
    this.revision(row, body);
    const consent = this.consents.get(body.consentId),
      observed = Date.parse(body.observedAt);
    if (
      !consent ||
      principal.kind !== "device" ||
      consent.deviceId !== principal.id ||
      row.deviceId !== principal.id ||
      row.kind !== "android_app" ||
      row.id !== consent.monitorId ||
      row.packageName !== body.packageName ||
      consent.packageName !== body.packageName ||
      row.status !== "active" ||
      Date.parse(consent.expiresAt) <= this.clock() ||
      Date.parse(row.expiresAt) <= this.clock() ||
      consent.configDigest !== digest(JSON.stringify(row.condition))
    )
      throw new ApiError(
        403,
        "Android observation consent ended or no longer matches this exact monitor.",
      );
    if (
      !Number.isFinite(observed) ||
      observed > this.clock() + 5000 ||
      observed < this.clock() - 15000 ||
      observed <= consent.lastAt
    )
      throw new ApiError(409, "This Android observation is stale or repeated.");
    if (
      !["match", "no_match", "unavailable", "sensitive"].includes(body.outcome)
    )
      throw new ApiError(400, "Unsupported Android observation outcome.");
    if (
      consent.lastAt &&
      this.clock() - consent.lastAt < row.intervalSeconds * 1000 - 1000
    )
      throw new ApiError(429, "Wait for the configured observation interval.");
    consent.lastAt = observed;
    await this.record(row, body.outcome);
    if (row.status !== "active") this.consents.delete(body.consentId);
    return { monitor: this.publicRow(row) };
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.consents.clear();
    for (const row of this.host.store.state.monitors || [])
      this.invalidate(row);
  }
}
