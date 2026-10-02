import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { api } from "./bridge";
import { Button, SectionTitle, Status } from "./components";
import { useNakama } from "./context";
import "./monitoring.css";
import { InstalledAppSelect, InstalledAppName, useInstalledApps } from "./installed-apps";

export interface MonitorRecord {
  id: string;
  revision: number;
  title: string;
  kind: string;
  status: string;
  url?: string;
  processName?: string;
  deviceId?: string;
  packageName?: string;
  lastOutcome?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  detail?: string;
  attentionReason?: string;
  setupConfirmedAt?: string;
  intervalSeconds: number;
  expiresAt?: string;
  sharedDeviceIds?: string[];
  checkout?: { status?: string; detail?: string };
  recipe?: { enabled?: boolean };
}
interface MonitorSnapshot {
  monitors: MonitorRecord[];
  available?: boolean;
  websiteAvailable?: boolean;
  windowsAvailable?: boolean;
  detail?: string;
}
const failureText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Nakama could not confirm this request.";
const localTime = (value?: string) =>
  value ? new Date(value).toLocaleString() : "Not checked yet";
const route = (id: string, action = "") =>
  `/api/monitors/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

export function MonitoringPage() {
  const { state, navigate, setNavigationGuard } = useNakama();
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("website");
  const [target, setTarget] = useState("");
  const [conditionType, setConditionType] = useState("stock");
  const [contains, setContains] = useState("");
  const [excludes, setExcludes] = useState("");
  const [interval, setInterval] = useState(60);
  const [deviceId, setDeviceId] = useState("");
  const installedApps = useInstalledApps(deviceId);
  const [shared, setShared] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(false),
    working = useRef(false),
    sequence = useRef(0);
  const dirty = useRef(false),
    cardDrafts = useRef(new Set<string>());
  dirty.current = Boolean(
    title || target || contains || excludes || cardDrafts.current.size,
  );
  const load = useCallback(async () => {
    if (working.current) return;
    const token = ++sequence.current;
    try {
      const value = await api<MonitorSnapshot>("GET", "/api/monitors");
      if (alive.current && token === sequence.current) {
        setSnapshot(value);
        setLoadError("");
      }
    } catch (error) {
      if (alive.current && token === sequence.current)
        setLoadError(failureText(error));
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = window.setInterval(() => void load(), 6000);
    setNavigationGuard(
      () =>
        !dirty.current ||
        window.confirm("Leave without saving these monitoring drafts?"),
    );
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      alive.current = false;
      sequence.current++;
      clearInterval(timer);
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", unload);
    };
  }, [load, setNavigationGuard]);
  async function request(
    method: string,
    path: string,
    body: unknown,
  ): Promise<any> {
    if (working.current) return;
    working.current = true;
    sequence.current++;
    setBusy(true);
    setError("");
    try {
      const value = await api<any>(method, path, body);
      if (!alive.current) return;
      working.current = false;
      await load();
      return alive.current ? value : undefined;
    } catch (error) {
      if (alive.current) setError(failureText(error));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function action(
    row: MonitorRecord,
    name: string,
    fields = {},
    method = "POST",
  ) {
    const result = await request(method, route(row.id, name), {
      revision: row.revision,
      ...fields,
    });
    if (result?.sessionId && alive.current)
      navigate("browser", { browserSessionId: result.sessionId });
    return result;
  }
  const phones = state.devices.filter(
    (device) =>
      device.platform === "android" &&
      device.permissions?.browserControl &&
      device.permissions?.projectAccess !== false &&
      device.permissions?.googleAccess !== false,
  );
  return (
    <div className="monitoring-page">
      <SectionTitle
        eyebrow="Quietly keeping an eye on things"
        title="Monitoring mode"
        description="Watch a shop or application, and return when something needs you."
      />
      <section className="panel">
        <h2>
          <Bell size={20} /> Create a monitor
        </h2>
        <p>
          Checks run locally without AI calls. Keep this PC awake and Nakama
          open. Phone alerts need a connected app or the visible Mote service.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (kind === "android_app" && !installedApps.apps.some((app) => app.packageName === target)) { setError("Choose an installed app from this device’s current list."); return; }
            const result = await request("POST", "/api/monitors", {
              title: title.trim(),
              kind,
              ...(kind === "website"
                ? { url: target.trim() }
                : kind === "windows_app"
                  ? { processName: target.trim() }
                  : { deviceId, packageName: target.trim() }),
              condition:
                kind === "website" && conditionType === "stock"
                  ? { type: "stock" }
                  : {
                      contains: contains.trim(),
                      ...(excludes.trim() ? { excludes: excludes.trim() } : {}),
                    },
              intervalSeconds: interval,
              sharedDeviceIds: kind === "website" ? shared : [],
            });
            if (result) {
              setTitle("");
              setTarget("");
              setContains("");
              setExcludes("");
            }
          }}
        >
          <fieldset className="monitor-form-fields" disabled={busy}>
            <div className="monitor-fields">
              <label>
                Name
                <input
                  required
                  maxLength={100}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Cards coming back in stock"
                />
              </label>
              <label>
                Watch
                <select
                  aria-label="Watch"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value);
                    setTarget("");
                    setShared([]);
                  }}
                >
                  <option value="website">Website</option>
                  <option value="windows_app">Windows application</option>
                  <option value="android_app">Android application</option>
                </select>
              </label>
              <label>
                {kind === "website"
                  ? "Product or page URL"
                  : kind === "windows_app"
                    ? "Exact process name (.exe)"
                    : "Installed app"}
                {kind === "android_app" ? <InstalledAppSelect deviceId={deviceId} value={target} onChange={setTarget} controlOnly /> : <input
                  required
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder={
                    kind === "website"
                      ? "https://your-shop.example/product"
                      : kind === "windows_app"
                        ? "example.exe"
                        : ""
                  }
                />}
              </label>
              {kind === "android_app" && (
                <label>
                  Phone or tablet
                  <select
                    aria-label="Phone or tablet"
                    required
                    value={deviceId}
                    onChange={(event) => { setDeviceId(event.target.value); setTarget(""); }}
                  >
                    <option value="">Select a paired device</option>
                    {state.devices
                      .filter((device) => device.platform === "android")
                      .map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {kind === "website" && (
                <label>
                  Condition
                  <select
                    value={conditionType}
                    onChange={(event) => setConditionType(event.target.value)}
                  >
                    <option value="stock">
                      Product availability (structured shop data)
                    </option>
                    <option value="text">Page contains specific text</option>
                  </select>
                </label>
              )}
              {(kind !== "website" || conditionType === "text") && (
                <>
                  <label>
                    Text to look for
                    <input
                      required
                      maxLength={200}
                      value={contains}
                      onChange={(event) => setContains(event.target.value)}
                      placeholder={
                        kind === "windows_app"
                          ? "Text in the window title"
                          : "Exact text in the page or app's language"
                      }
                    />
                  </label>
                  <label>
                    Must not contain (optional)
                    <input
                      maxLength={200}
                      value={excludes}
                      onChange={(event) => setExcludes(event.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                Check every (seconds)
                <input
                  type="number"
                  required
                  min={30}
                  max={86400}
                  value={interval}
                  onChange={(event) => setInterval(Number(event.target.value))}
                />
              </label>
            </div>
            {kind === "website" && (
              <fieldset>
                <legend>
                  Allow private handoff and alerts on these devices
                </legend>
                {phones.length ? (
                  phones.map((device) => (
                    <label className="monitor-check" key={device.id}>
                      <input
                        type="checkbox"
                        checked={shared.includes(device.id)}
                        onChange={(event) =>
                          setShared((old) =>
                            event.target.checked
                              ? [...old, device.id]
                              : old.filter((id) => id !== device.id),
                          )
                        }
                      />
                      {device.name}
                    </label>
                  ))
                ) : (
                  <p>
                    Enable Browser control and shared access for a paired device
                    to select it here.
                  </p>
                )}
              </fieldset>
            )}
            <p className="small-copy">
              Save creates a paused monitor. Review the target, prepare any
              private login, then start. Stock data that is missing or ambiguous
              is reported as unknown. Android observation also needs explicit
              consent on that phone.
            </p>
            <Button disabled={busy || !snapshot || (kind === "android_app" && !installedApps.apps.some((app) => app.packageName === target))}>
              <Bell size={16} /> Save monitor
            </Button>
          </fieldset>
        </form>
      </section>
      {snapshot?.detail && <p className="small-copy">{snapshot.detail}</p>}
      {(error || loadError) && (
        <p role="alert" className="inline-error">
          {error || loadError}
        </p>
      )}
      <Button kind="ghost" disabled={busy} onClick={() => void load()}>
        <RefreshCw size={16} /> Refresh
      </Button>
      {snapshot?.monitors.length === 0 && <p>No monitors yet.</p>}
      <div className="monitor-cards">
        {snapshot?.monitors
          .slice()
          .reverse()
          .map((row) => (
            <section key={row.id} className="panel monitor-card">
              <div className="monitor-heading">
                <h3>{row.title}</h3>
                <Status value={row.status} />
              </div>
              <p className="monitor-target">
                {row.url || row.processName || <InstalledAppName deviceId={row.deviceId || ""} packageName={row.packageName || ""} />}
              </p>
              <p>{row.detail || "No result recorded."}</p>
              <dl>
                <dt>Last outcome</dt>
                <dd>{row.lastOutcome?.replaceAll("_", " ") || "None"}</dd>
                <dt>Last check</dt>
                <dd>{localTime(row.lastCheckedAt)}</dd>
                <dt>Next check</dt>
                <dd>
                  {row.nextCheckAt
                    ? localTime(row.nextCheckAt)
                    : "Paused or waiting for attention"}
                </dd>
              </dl>
              <div className="monitor-actions">
                {["active", "checking"].includes(row.status) ? (
                  <Button
                    kind="secondary"
                    disabled={busy}
                    onClick={() => void action(row, "pause")}
                  >
                    <Pause size={16} /> Pause
                  </Button>
                ) : (
                  <Button
                    kind="secondary"
                    disabled={busy || row.status === "expired"}
                    onClick={() => void action(row, "resume")}
                  >
                    <Play size={16} /> Start / resume
                  </Button>
                )}
                <Button
                  kind="ghost"
                  disabled={
                    busy ||
                    row.status !== "active" ||
                    row.kind === "android_app"
                  }
                  onClick={() => void action(row, "check")}
                >
                  <RefreshCw size={16} /> Check once
                </Button>
                {row.attentionReason && (
                  <Button
                    disabled={busy}
                    onClick={() => void action(row, "acknowledge")}
                  >
                    Acknowledge
                  </Button>
                )}
                {row.kind === "website" && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void action(row, "open", {
                          reason:
                            row.lastOutcome === "captcha" ? "captcha" : "page",
                        })
                      }
                    >
                      Open private browser
                    </Button>
                    <Button
                      kind="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(row, "open", { reason: "setup" })
                      }
                    >
                      Set up login &amp; delivery
                    </Button>
                  </>
                )}
                <Button
                  kind="ghost"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      window.confirm(
                        "Remove this monitor? This does not make a purchase or undo any cart change.",
                      )
                    ) {
                      const result = await action(row, "", {}, "DELETE");
                      if (result) {
                        cardDrafts.current.delete(row.id);
                        cardDrafts.current.delete(`${row.id}:sharing`);
                        dirty.current = Boolean(
                          title ||
                          target ||
                          contains ||
                          excludes ||
                          cardDrafts.current.size,
                        );
                      }
                    }
                  }}
                >
                  <Trash2 size={16} /> Remove
                </Button>
              </div>
              {row.kind === "website" && (
                <details>
                  <summary>Private shopping setup and cart preparation</summary>
                  <MonitorSharing
                    row={row}
                    phones={phones}
                    busy={busy}
                    save={(sharedDeviceIds) =>
                      action(row, "sharing", { sharedDeviceIds })
                    }
                    onDirty={(value) => {
                      const key = `${row.id}:sharing`;
                      if (value) cardDrafts.current.add(key);
                      else cardDrafts.current.delete(key);
                      dirty.current = Boolean(
                        title ||
                        target ||
                        contains ||
                        excludes ||
                        cardDrafts.current.size,
                      );
                    }}
                  />
                  <p>
                    Sign in yourself and check the saved delivery details.
                    Nakama remembers the dedicated browser session. Confirm your
                    setup here, then use Release control in the browser before
                    starting checks. An out-of-stock item may prevent rehearsing
                    checkout; a login alone does not verify checkout. Payment
                    and order placement always stay with you.
                  </p>
                  <p>
                    {row.setupConfirmedAt
                      ? `Delivery details confirmed by you on ${localTime(row.setupConfirmedAt)}.`
                      : "Private setup has not been confirmed."}
                  </p>
                  <Button
                    kind="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Have you privately checked the correct account and delivery address? No payment details should be added for this setup.",
                        )
                      )
                        void action(row, "setup-confirm", {
                          addressConfirmed: true,
                        });
                    }}
                  >
                    I checked my login and delivery details
                  </Button>
                  <Button
                    kind="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Forget this monitor's saved browser login? Its private browser session will close.",
                        )
                      )
                        void action(row, "forget-profile");
                    }}
                  >
                    Forget saved browser login
                  </Button>
                  <CheckoutRecipe
                    row={row}
                    busy={busy}
                    save={(recipe) =>
                      action(row, "recipe", { recipe, confirmed: true })
                    }
                    onDirty={(value) => {
                      if (value) cardDrafts.current.add(row.id);
                      else cardDrafts.current.delete(row.id);
                      dirty.current = Boolean(
                        title ||
                        target ||
                        contains ||
                        excludes ||
                        cardDrafts.current.size,
                      );
                    }}
                  />
                </details>
              )}
            </section>
          ))}
      </div>
    </div>
  );
}

function MonitorSharing({
  row,
  phones,
  busy,
  save,
  onDirty,
}: {
  row: MonitorRecord;
  phones: { id: string; name: string }[];
  busy: boolean;
  save: (sharedDeviceIds: string[]) => Promise<any>;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const selected = draft ?? row.sharedDeviceIds ?? [];
  return (
    <fieldset disabled={busy}>
      <legend>Private handoff and alerts on paired devices</legend>
      <p>
        Changing access pauses this monitor. Review the selected devices, save,
        then resume checks.
      </p>
      {phones.map((phone) => (
        <label className="monitor-check" key={phone.id}>
          <input
            type="checkbox"
            checked={selected.includes(phone.id)}
            onChange={(event) => {
              setDraft(
                event.target.checked
                  ? [...selected, phone.id]
                  : selected.filter((id) => id !== phone.id),
              );
              onDirty(true);
            }}
          />
          {phone.name}
        </label>
      ))}
      {!phones.length && (
        <p>
          No paired device currently has Browser control and shared access
          enabled.
        </p>
      )}
      <Button
        kind="secondary"
        disabled={busy || draft === null}
        onClick={async () => {
          const result = await save(
            selected.filter((id) => phones.some((phone) => phone.id === id)),
          );
          if (result) {
            setDraft(null);
            onDirty(false);
          }
        }}
      >
        Save device access
      </Button>
    </fieldset>
  );
}

function CheckoutRecipe({
  row,
  busy,
  save,
  onDirty,
}: {
  row: MonitorRecord;
  busy: boolean;
  save: (recipe: unknown) => Promise<any>;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState({
    productText: "",
    variantField: "",
    variantValue: "",
    priceText: "",
    maxPrice: "",
    currency: "",
    cartPath: "/cart/add",
    checkoutPath: "/checkout",
    addLabel: "Add to cart",
    checkoutLabel: "Checkout",
  });
  const [changed, setChanged] = useState(false);
  const baseline = useRef(row.revision);
  const stale = changed && baseline.current !== row.revision;
  return (
    <details className="monitor-recipe">
      <summary>Configure an exact native-form cart recipe</summary>
      <p>
        For shops with a native HTML /cart/add form, a verifiable /cart.js cart
        and a /checkout link. JavaScript-only carts and unverified shop layouts
        need a manual handoff. An empty cart is required. This recipe permits
        one cart attempt for quantity 1, followed by a checkout page; it never
        submits payment or places an order.
      </p>
      <fieldset className="monitor-form-fields" disabled={busy}>
        <div className="monitor-fields">
          {Object.entries(draft).map(([name, value]) => (
            <label key={name}>
              {
                (
                  {
                    productText: "Exact product text",
                    variantField: "Variant field name",
                    variantValue: "Variant field value",
                    priceText: "Exact displayed price",
                    maxPrice: "Maximum price",
                    currency: "Currency code",
                    cartPath: "Cart-add path",
                    checkoutPath: "Checkout path",
                    addLabel: "Exact Add to cart label",
                    checkoutLabel: "Exact Checkout label",
                  } as Record<string, string>
                )[name]
              }
              <input
                value={value}
                onChange={(event) => {
                  if (!changed) baseline.current = row.revision;
                  setChanged(true);
                  onDirty(true);
                  setDraft((old) => ({ ...old, [name]: event.target.value }));
                }}
              />
            </label>
          ))}
        </div>
      </fieldset>
      {stale && (
        <p>
          The monitor changed while you edited. Review the latest status and
          recheck these settings before saving.
        </p>
      )}
      <Button
        kind="secondary"
        disabled={busy || !row.setupConfirmedAt || !changed}
        onClick={async () => {
          if (
            !window.confirm(
              "Approve this exact product, variant, quantity 1 and price limit for automatic cart preparation until this monitor expires? Payment and order completion remain manual.",
            )
          )
            return;
          const result = await save({
            ...draft,
            maxPrice: Number(draft.maxPrice),
            enabled: true,
          });
          if (result) {
            setChanged(false);
            onDirty(false);
          }
        }}
      >
        Approve exact cart recipe on this PC
      </Button>
      <Button
        kind="ghost"
        disabled={busy}
        onClick={() => void save({ enabled: false })}
      >
        Disable cart preparation
      </Button>
      {row.checkout && (
        <p>
          {row.checkout.status}: {row.checkout.detail}
        </p>
      )}
    </details>
  );
}
