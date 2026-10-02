import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Globe,
  Hand,
  Plus,
  RefreshCw,
  Square,
} from "lucide-react";
import { api, previewMode } from "./bridge";
import { Button, Empty, SectionTitle } from "./components";
import { useNakama } from "./context";
import "./browser-studio.css";

export interface BrowserSession {
  id: string;
  mode: "research" | "project" | "private";
  projectId?: string;
  taskId?: string;
  workflowId?: string;
  status: string;
  attentionReason?: string;
  tainted?: boolean;
  attentionId?: string;
  sharedDeviceId?: string;
  controller?: { kind: string; id: string };
  activeTabId?: string;
  tabs: { id: string; title: string; url: string; loading?: boolean }[];
  createdAt: string;
  updatedAt: string;
}
export interface BrowserStudioState {
  available: boolean;
  permitted: boolean;
  sessions: BrowserSession[];
  detail?: string;
}
interface Frame {
  sessionId: string;
  tabId: string;
  frameId: string;
  width: number;
  height: number;
  image: string;
  capturedAt: string;
  expiresAt: string;
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : "The browser did not confirm this action.";
const endpoint = (id: string) =>
  `/api/browser-studio/sessions/${encodeURIComponent(id)}`;

function ProjectPreviewLauncher({ projectId }: { projectId: string }) {
  const { notify, openApproval } = useNakama();
  const [data, setData] = useState<{
    manifestHash?: string;
    detail?: string;
    checks: { name: string; script: string }[];
    launch?: { origin: string; status: string; taskId?: string } | null;
  }>();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const version = useRef(0);
  const alive = useRef(true);
  const working = useRef(false);
  async function load() {
    const current = ++version.current;
    const value = await api<typeof data>(
      "GET",
      `/api/projects/${projectId}/preview`,
    );
    if (alive.current && current === version.current) {
      setData(value);
      setName((previous) =>
        value?.checks.some((check) => check.name === previous)
          ? previous
          : value?.checks[0]?.name || "",
      );
    }
  }
  useEffect(() => {
    alive.current = true;
    setData(undefined);
    if (projectId)
      void load().catch((e) => {
        if (alive.current) notify(message(e), true);
      });
    return () => {
      alive.current = false;
      version.current++;
    };
  }, [projectId]);
  async function change(start: boolean) {
    if (working.current || !alive.current) return;
    working.current = true;
    setBusy(true);
    const current = ++version.current;
    try {
      const result = await api<{ id: string }>(
        "POST",
        `/api/projects/${projectId}/preview/${start ? "start" : "stop"}`,
        start ? { name, manifestHash: data!.manifestHash } : {},
      );
      if (!alive.current || current !== version.current) return;
      if (start) openApproval(result.id);
      else await load();
    } catch (e) {
      if (alive.current && current === version.current)
        notify(message(e), true);
    } finally {
      if (alive.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  if (!projectId) return null;
  return (
    <section className="browser-preview-launch">
      <h4>Local project preview</h4>
      {data?.launch ? (
        <>
          <p>
            {data.launch.status} · {data.launch.origin}
          </p>
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() => void change(false)}
          >
            Stop preview
          </Button>
        </>
      ) : (
        <>
          <p className="small-copy">
            Start an installed Vite or Next.js project on an assigned local
            port. The exact script requires PC approval and can execute project
            code.
          </p>
          <label>
            Preview script
            <select
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            >
              {data?.checks.map((check) => (
                <option key={check.name} value={check.name}>
                  {check.name}: {check.script}
                </option>
              ))}
            </select>
          </label>
          <Button
            kind="secondary"
            disabled={busy || !name || !data?.manifestHash}
            onClick={() => void change(true)}
          >
            Review preview launch
          </Button>
          {data?.detail && <p className="small-copy">{data.detail}</p>}
        </>
      )}
      <Button
        kind="ghost"
        disabled={busy}
        onClick={() => void load().catch((e) => notify(message(e), true))}
      >
        Refresh preview status
      </Button>
    </section>
  );
}

export function BrowserFrame({
  session,
  compact = false,
}: {
  session: BrowserSession;
  compact?: boolean;
}) {
  const [received, setReceived] = useState<{ context: string; frame: Frame }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const generation = useRef(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const tabId = session.activeTabId || session.tabs[0]?.id;
  const opaque = compact
    ? Boolean(
        session.tainted ||
        session.mode === "private" ||
        session.controller ||
        session.status === "human_control",
      )
    : Boolean(
        (session.tainted ||
          session.mode === "private" ||
          session.status === "human_control") &&
        session.controller?.kind !== "owner",
      );
  const controllable = !compact && session.controller?.kind === "owner";
  // A privacy or controller transition must hide the old image during render,
  // before the next effect or frame request has had a chance to run.
  const context = JSON.stringify([
    session.id,
    tabId,
    session.mode,
    Boolean(session.tainted),
    session.status,
    session.controller?.kind,
    session.controller?.id,
    compact,
  ]);
  const frame = received?.context === context ? received.frame : undefined;
  useEffect(() => {
    const version = ++generation.current;
    let timer: number | undefined,
      stopped = false;
    setReceived(undefined);
    setError("");
    setTyped("");
    setBusy(false);
    if (!tabId || opaque || previewMode) return;
    async function read() {
      try {
        if (document.visibilityState !== "visible") return;
        const next = await api<Frame>("POST", `${endpoint(session.id)}/frame`, {
          tabId,
        });
        if (!stopped && generation.current === version) {
          setReceived({ context, frame: next });
          setError("");
        }
      } catch (e) {
        if (!stopped) {
          setReceived(undefined);
          setError(message(e));
        }
      } finally {
        if (!stopped) timer = window.setTimeout(read, compact ? 1600 : 650);
      }
    }
    void read();
    return () => {
      stopped = true;
      generation.current++;
      window.clearTimeout(timer);
    };
  }, [context, opaque]);
  async function control(body: Record<string, unknown>) {
    if (
      !controllable ||
      !frame ||
      busy ||
      Date.parse(frame.expiresAt) <= Date.now()
    )
      return;
    setBusy(true);
    setTyped("");
    const version = generation.current;
    try {
      await api("POST", `${endpoint(session.id)}/control`, {
        tabId,
        frameId: frame.frameId,
        ...body,
      });
      if (version === generation.current) setError("");
    } catch (e) {
      if (version === generation.current) setError(message(e));
    } finally {
      if (version === generation.current) {
        setReceived(undefined);
        setBusy(false);
      }
    }
  }
  if (opaque)
    return (
      <span className="browser-private">
        Private user session · screen hidden from agents
      </span>
    );
  return (
    <div className={`browser-view ${compact ? "compact" : ""}`}>
      {frame ? (
        <img
          ref={imageRef}
          src={frame.image}
          alt={compact ? "Current agent browser view" : "Live browser page"}
          className={controllable ? "controllable" : ""}
          onClick={(event) => {
            const bounds = imageRef.current?.getBoundingClientRect();
            if (bounds && bounds.width > 0 && bounds.height > 0)
              void control({
                kind: "tap",
                x: Math.max(
                  0,
                  Math.min(1, (event.clientX - bounds.left) / bounds.width),
                ),
                y: Math.max(
                  0,
                  Math.min(1, (event.clientY - bounds.top) / bounds.height),
                ),
              });
          }}
        />
      ) : (
        <div className="browser-frame-empty">
          {error || "Waiting for a fresh browser frame…"}
        </div>
      )}
      {!compact && (
        <>
          <p className="small-copy">
            {controllable
              ? "You have control. Click the page, then type below. Text goes only to the focused browser field."
              : "Watching Nakama's browser. Take control to interact or sign in."}
          </p>
          {controllable && (
            <div className="browser-inputs">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void control({ kind: "text", text: typed });
                }}
              >
                <label>
                  Text for the focused field
                  <input
                    type="password"
                    autoComplete="off"
                    value={typed}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                </label>
                <Button disabled={!frame || !typed || busy} type="submit">
                  Type into page
                </Button>
              </form>
              <div className="button-row">
                {["Tab", "Enter", "Backspace", "Escape"].map((key) => (
                  <Button
                    key={key}
                    kind="secondary"
                    disabled={!frame || busy}
                    onClick={() => void control({ kind: "key", key })}
                  >
                    {key}
                  </Button>
                ))}
                <Button
                  kind="secondary"
                  disabled={!frame || busy}
                  onClick={() => void control({ kind: "scroll", deltaY: -5 })}
                >
                  Scroll up
                </Button>
                <Button
                  kind="secondary"
                  disabled={!frame || busy}
                  onClick={() => void control({ kind: "scroll", deltaY: 5 })}
                >
                  Scroll down
                </Button>
              </div>
            </div>
          )}
          {error && frame && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function BrowserStudioPage({
  initialSessionId,
}: { initialSessionId?: string } = {}) {
  const { state, notify } = useNakama();
  const [snapshot, setSnapshot] = useState<BrowserStudioState>();
  const [selected, setSelected] = useState(initialSessionId || "");
  const [mode, setMode] = useState<BrowserSession["mode"]>("research");
  const [projectId, setProjectId] = useState("");
  const [url, setUrl] = useState("");
  const [navigateUrl, setNavigateUrl] = useState("");
  const [handoffDevice, setHandoffDevice] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const requests = useRef(0);
  const mutations = useRef(0);
  const working = useRef(false);
  const session = snapshot?.sessions.find((item) => item.id === selected);
  useEffect(() => {
    if (initialSessionId) setSelected(initialSessionId);
  }, [initialSessionId]);
  async function load(afterMutation = false) {
    if (!alive.current || (working.current && !afterMutation)) return;
    const request = ++requests.current;
    const next = await api<BrowserStudioState>("GET", "/api/browser-studio");
    if (alive.current && request === requests.current) setSnapshot(next);
  }
  useEffect(() => {
    alive.current = true;
    let timer: number;
    async function poll() {
      try {
        if (!previewMode) await load();
      } catch {
        /* explicit controls report errors */
      } finally {
        if (alive.current) timer = window.setTimeout(poll, 1500);
      }
    }
    void poll();
    return () => {
      alive.current = false;
      requests.current++;
      mutations.current++;
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    setNavigateUrl("");
    setHandoffDevice("");
  }, [selected, session?.activeTabId]);
  async function action(path: string, body = {}, method = "POST") {
    if (working.current || !alive.current) return;
    working.current = true;
    const mutation = ++mutations.current;
    requests.current++; // Invalidate reads started before this user action.
    setBusy(true);
    try {
      const result = await api<BrowserSession | { session: BrowserSession }>(
        method,
        path,
        body,
      );
      if (!alive.current || mutation !== mutations.current) return;
      await load(true);
      if (alive.current && mutation === mutations.current) return result;
    } catch (e) {
      if (alive.current && mutation === mutations.current)
        notify(message(e), true);
    } finally {
      if (alive.current && mutation === mutations.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div className="browser-studio">
      <SectionTitle
        eyebrow="A window into the work"
        title="Nakama browser"
        description="Research, test your project and step in when Nakama needs you."
      />
      <section className="panel browser-create">
        <h3>
          <Globe size={20} /> Chromium, inside Nakama
        </h3>
        <p>
          Research is anonymous and read-only. Project browsing tests an
          approved local preview. Private sessions let you sign in yourself;
          Nakama cannot inspect your login fields or use that session as an
          agent.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await action("/api/browser-studio/sessions", {
              mode,
              ...(mode === "project" ? { projectId } : {}),
              ...(url.trim() ? { url: url.trim() } : {}),
            });
            if (result)
              setSelected("session" in result ? result.session.id : result.id);
          }}
        >
          <label>
            Purpose
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as BrowserSession["mode"]);
                setUrl("");
              }}
              disabled={busy}
            >
              <option value="research">Web research</option>
              <option value="project">Local project test</option>
              <option value="private">Private sign-in / your browsing</option>
            </select>
          </label>
          {mode === "project" && (
            <label>
              Project
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose a running project preview</option>
                {state.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {mode === "project"
              ? "Optional path in your preview"
              : "Website address"}
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={mode === "project" ? "/" : "https://example.com"}
              disabled={busy}
            />
          </label>
          <Button
            type="submit"
            disabled={
              busy ||
              previewMode ||
              !snapshot?.available ||
              (mode === "project" ? !projectId : !url.trim())
            }
          >
            <Plus size={15} /> Open browser
          </Button>
        </form>
        {mode === "project" && (
          <ProjectPreviewLauncher key={projectId} projectId={projectId} />
        )}
        {snapshot?.detail && <p className="small-copy">{snapshot.detail}</p>}
      </section>
      <div className="browser-workspace">
        <aside className="panel browser-sessions" aria-label="Browser sessions">
          {snapshot?.sessions.map((item) => (
            <button
              key={item.id}
              disabled={busy}
              className={`${item.id === selected ? "selected" : ""} ${item.status === "attention" ? "needs-attention" : ""}`}
              onClick={() => setSelected(item.id)}
            >
              <strong>
                {item.tabs.find((tab) => tab.id === item.activeTabId)?.title ||
                  "Browser session"}
              </strong>
              <span>
                {item.mode} · {item.status.replaceAll("_", " ")}
              </span>
              {item.attentionReason && (
                <small>
                  <AlertCircle size={12} /> {item.attentionReason}
                </small>
              )}
            </button>
          ))}
          {!snapshot?.sessions.length && <p>No browser sessions yet.</p>}
        </aside>
        <section
          className="panel browser-current"
          aria-label="Selected browser"
        >
          {!session ? (
            <Empty icon={<Globe size={32} />} title="Choose a browser">
              Open a page above or select an active session.
            </Empty>
          ) : (
            <>
              {session.attentionReason && (
                <div className="browser-attention" role="status">
                  <AlertCircle />
                  {session.attentionReason}
                </div>
              )}
              <div className="browser-tabs">
                {session.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    disabled={busy}
                    className={tab.id === session.activeTabId ? "selected" : ""}
                    onClick={() =>
                      void action(`${endpoint(session.id)}/activate`, {
                        tabId: tab.id,
                      })
                    }
                  >
                    {tab.title || tab.url || "New tab"}
                  </button>
                ))}
              </div>
              <p className="browser-address">
                {
                  session.tabs.find((tab) => tab.id === session.activeTabId)
                    ?.url
                }
              </p>
              <form
                className="browser-nav"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const result = await action(
                    `${endpoint(session.id)}/navigate`,
                    { tabId: session.activeTabId, url: navigateUrl },
                  );
                  if (result) setNavigateUrl("");
                }}
              >
                <label>
                  Navigate this tab
                  <input
                    value={navigateUrl}
                    maxLength={2048}
                    onChange={(event) => setNavigateUrl(event.target.value)}
                    placeholder="https://… or local preview path"
                    disabled={busy}
                  />
                </label>
                <Button type="submit" disabled={busy || !navigateUrl.trim()}>
                  Go
                </Button>
                <Button
                  kind="secondary"
                  disabled={busy || !navigateUrl.trim()}
                  onClick={async () => {
                    const result = await action(
                      `${endpoint(session.id)}/tabs`,
                      { url: navigateUrl },
                    );
                    if (result) setNavigateUrl("");
                  }}
                >
                  New tab
                </Button>
              </form>
              <div className="button-row">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(
                      `${endpoint(session.id)}/${session.controller ? "release" : "takeover"}`,
                    )
                  }
                >
                  <Hand size={15} />
                  {session.controller ? "Release control" : "Take control"}
                </Button>
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() =>
                    void load().catch((e) => notify(message(e), true))
                  }
                >
                  <RefreshCw size={15} /> Refresh status
                </Button>
                <Button
                  kind="danger"
                  disabled={busy}
                  onClick={async () => {
                    const result = await action(
                      endpoint(session.id),
                      {},
                      "DELETE",
                    );
                    if (result) setSelected("");
                  }}
                >
                  <Square size={15} /> Close session
                </Button>
              </div>
              <div className="browser-handoff">
                <label>
                  Continue privately on Android
                  <select
                    value={handoffDevice}
                    disabled={busy}
                    onChange={(event) => setHandoffDevice(event.target.value)}
                  >
                    <option value="">Choose an allowed phone or tablet</option>
                    {state.devices
                      .filter(
                        (device) =>
                          device.platform === "android" &&
                          device.permissions?.browserControl === true &&
                          device.permissions?.googleAccess !== false &&
                          device.permissions?.projectAccess !== false,
                      )
                      .map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  kind="secondary"
                  disabled={busy || !handoffDevice}
                  onClick={() =>
                    void action(`${endpoint(session.id)}/handoff`, {
                      deviceId: handoffDevice,
                    })
                  }
                >
                  Send to Android
                </Button>
              </div>
              <BrowserFrame key={session.id} session={session} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
