import { RemoteConnectionSetup } from "./remote-connection";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Check,
  CheckCheck,
  Globe2,
  Copy,
  FolderOpen,
  Globe,
  Info,
  KeyRound,
  LockKeyhole,
  Plus,
  QrCode,
  ShieldCheck,
  Smartphone,
  Tablet,
  Unplug,
  Volume2,
  X,
} from "lucide-react";
import {
  api,
  chooseFolder,
  copyText,
  openExternal,
  previewMode,
} from "./bridge";
import {
  Button,
  Empty,
  Modal,
  SectionTitle,
  Status,
  TextLink,
  Toggle,
  relativeDate,
} from "./components";
import { useNakama } from "./context";
import { DeviceActions } from "./device-actions";
import { DeviceFoundations } from "./device-foundations";
import { MemorySpendSettings } from "./preferences";
import { AiRoleSettings } from "./ai-role-settings";
import type { PairingTicket } from "./types";
import {
  pairingAddress,
  pairingNetworkBlock,
  type NetworkStatus,
} from "./pairing-model";

export function DevicesPage() {
  const { state, perform, notify, navigate } = useNakama();
  const [pairOpen, setPairOpen] = useState(false);
  const [revoke, setRevoke] = useState<string>();
  const [name, setName] = useState("Android phone");
  const [platform, setPlatform] = useState("android");
  const [hostUrl, setHostUrl] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");
  const [network, setNetwork] = useState<NetworkStatus>();
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [networkRefresh, setNetworkRefresh] = useState(0);
  const [ticket, setTicket] = useState<PairingTicket>();
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);
  const payload = ticket
    ? JSON.stringify({
        url: ticketUrl,
        ticket: ticket.ticket,
        fingerprint: ticket.fingerprint,
        hostName: ticket.hostName,
        expiresAt: ticket.expiresAt,
      })
    : "";
  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setQr("");
      return;
    }
    import("qrcode")
      .then((module) =>
        module.toDataURL(payload, {
          width: 260,
          margin: 2,
          color: { dark: "#14263fff", light: "#ffffffff" },
        }),
      )
      .then((data) => {
        if (!cancelled) setQr(data);
      })
      .catch(() => {
        if (!cancelled) setQr("");
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);
  useEffect(() => {
    if (!pairOpen || platform === "chrome") return;
    let active = true;
    setNetworkLoading(true);
    setNetworkError("");
    api<NetworkStatus>("GET", "/api/network-status")
      .then((result) => {
        if (!active) return;
        setNetwork(result);
        const candidates = result.addresses.filter(
          (item) => !/virtual|vethernet|docker|wsl|vmware/i.test(item.name),
        );
        const preferred = candidates.find(item => item.kind === "vpn" && item.listening) || (candidates.length === 1 ? candidates[0] : undefined);
        if (preferred) setHostUrl(current => current || preferred.url);
      })
      .catch(() => {
        if (!active) return;
        setNetwork(undefined);
        setNetworkError(
          "Could not read the PC’s network status. Check the network again before pairing.",
        );
      })
      .finally(() => {
        if (active) setNetworkLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    pairOpen,
    platform,
    networkRefresh,
    state.config.allowLan,
    state.config.vpnOnly,
    state.config.port,
  ]);
  const createTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    try {
      const url = pairingAddress(hostUrl, platform);
      if (platform !== "chrome") {
        const current = await api<NetworkStatus>("GET", "/api/network-status");
        setNetwork(current);
        const blocked = pairingNetworkBlock(current);
        if (blocked) throw new Error(blocked);
        if (Number(new URL(url).port || 443) !== current.listener.port)
          throw new Error(
            `The active HTTPS listener uses port ${current.listener.port}. Update the address to use that port.`,
          );
      }
      const result = await perform<PairingTicket>(
        "POST",
        "/api/pairing/tickets",
        { name: name.trim(), platform },
      );
      if (result) {
        setTicketUrl(url);
        setTicket(result);
      }
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Enter a valid host address.",
        true,
      );
    } finally {
      creating.current = false;
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await copyText(payload);
      notify("Pairing information copied. Keep it private.");
    } catch {
      notify(
        "Could not copy. Select the pairing text and copy it manually.",
        true,
      );
    }
  };
  return (
    <div className="page-enter">
      <SectionTitle
        eyebrow="CARRY YOUR WORKSPACE WITH YOU"
        title="Your devices"
        description="Only devices you pair can connect. Remove access whenever you need to."
        action={
          <Button
            onClick={() => {
              setTicket(undefined);
              setPairOpen(true);
            }}
          >
            <Plus size={17} />
            Pair a device
          </Button>
        }
      />
      <section className="device-hero">
        <div className="device-hero-icon">
          <Smartphone size={48} />
          <Tablet size={64} />
        </div>
        <div>
          <span className="eyebrow">ONE COMPANION, WHEREVER YOU ARE</span>
          <h2>From your desktop to your pocket.</h2>
          <p>
            Connect your Android 16 phone or tablet. For mobile-network access,
            connect both devices through a private VPN and use your PC’s private
            address.
          </p>
          <div className="device-badges">
            <span>
              <ShieldCheck size={14} />
              Certificate-pinned pairing
            </span>
            <span>
              <KeyRound size={14} />
              Revocable device keys
            </span>
            <span>
              <LockKeyhole size={14} />
              No public port forwarding
            </span>
          </div>
        </div>
      </section>
      <RemoteConnectionSetup />
      <SectionTitle
        title="Paired devices"
        description={`${state.devices.length} ${state.devices.length === 1 ? "device has" : "devices have"} access to this Control Center.`}
      />
      {state.devices.length ? (
        <div className="device-grid">
          {state.devices.map((device) => (
            <section className="device-card" key={device.id}>
              <div className="device-card-heading">
                <span className="device-icon">
                  {device.platform === "chrome" ||
                  device.platform === "browser" ? (
                    <Globe2 size={28} />
                  ) : device.name.toLowerCase().includes("tablet") ? (
                    <Tablet size={28} />
                  ) : (
                    <Smartphone size={28} />
                  )}
                </span>
                <Status value="paired" label="Paired" />
              </div>
              <h3>{device.name}</h3>
              <p>
                {device.platform} · Added {relativeDate(device.pairedAt)}
              </p>
              <div className="device-detail">
                <span>Last activity</span>
                <strong>{relativeDate(device.lastSeen)}</strong>
              </div>
              <div className="capability-tags">
                {(device.capabilities || []).map((capability) => (
                  <span key={capability}>
                    {capability.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
              {device.platform === "android" ? (
                <div className="device-permissions">
                  <Toggle
                    checked={device.permissions?.projectAccess !== false}
                    label="Project access"
                    description="Use projects and AI tasks on this host."
                    onChange={(value) =>
                      void perform(
                        "PATCH",
                        `/api/devices/${device.id}`,
                        { projectAccess: value },
                        "Device project permission updated.",
                      )
                    }
                  />
                  <Toggle
                    checked={device.permissions?.googleAccess !== false}
                    label="Google account access"
                    description="Use connected email and calendars. Turning this off also hides shared AI history and disables AI chat on this device in the current preview."
                    onChange={(value) =>
                      void perform(
                        "PATCH",
                        `/api/devices/${device.id}`,
                        { googleAccess: value },
                        "Device Google permission updated.",
                      )
                    }
                  />
                  <Toggle
                    checked={device.permissions?.browserControl === true}
                    label="Control paired browsers"
                    description="Allow this device to request actions on paired Chrome tabs."
                    onChange={(value) =>
                      void perform(
                        "PATCH",
                        `/api/devices/${device.id}`,
                        { browserControl: value },
                        "Device browser-control permission updated.",
                      )
                    }
                  />
                  <Toggle
                    checked={device.permissions?.remoteDesktop === true}
                    label="Remote desktop"
                    description="Use this phone’s touchscreen to control the Windows host. Also requires shared Google and project access, and the host switch below."
                    onChange={(value) =>
                      void perform(
                        "PATCH",
                        `/api/devices/${device.id}`,
                        { remoteDesktop: value },
                        "Device remote desktop permission updated.",
                      )
                    }
                  />
                </div>
              ) : (
                <p className="browser-device-scope">
                  This key can only receive and report its own browser actions.
                  It cannot access your projects or Google accounts.
                </p>
              )}
              <Button
                kind="secondary"
                className="full-width"
                onClick={() => setRevoke(device.id)}
              >
                <Unplug size={15} />
                Remove device access
              </Button>
            </section>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            icon={<Smartphone size={32} />}
            title="Your companion is ready to connect"
            action={
              <Button
                onClick={() => {
                  setTicket(undefined);
                  setPairOpen(true);
                }}
              >
                <QrCode size={17} />
                Pair your first device
              </Button>
            }
          >
            Install Nakama on your phone or tablet, then generate a one-time
            pairing code here.
          </Empty>
        </section>
      )}
      <DeviceFoundations />
      <DeviceActions />
      <div className="two-column">
        <section className="panel info-panel">
          <Globe size={24} />
          <h3>Connecting away from home</h3>
          <p>
            Keep this PC awake and connected. Use a private VPN for the phone
            and PC, enable the private-network listener in Settings, then pair
            using the PC’s reachable HTTPS address.
          </p>
          <TextLink
            external
            onClick={() =>
              void openExternal("https://tailscale.com/kb/1017/install")
            }
          >
            Private network setup
          </TextLink>
        </section>
        <section className="panel info-panel">
          <Globe2 size={24} />
          <h3>Your browser, with a helping hand</h3>
          <p>
            Load the Nakama Chrome extension from this repository, then pair it
            with a separate device key. Follow the extension installation guide
            included with your download.
          </p>
          <span className="code-path">apps/chrome-extension</span>
        </section>
      </div>
      {pairOpen && (
        <Modal
          wide
          title={ticket ? "Connect your companion" : "Pair a new device"}
          description={
            ticket
              ? "Use these details in Nakama on the device you want to connect."
              : "Create a short-lived, single-use pairing ticket."
          }
          onClose={() => {
            if (!busy) setPairOpen(false);
          }}
        >
          {!ticket ? (
            <form onSubmit={(event) => void createTicket(event)}>
              <div className="two-column">
                <label className="field">
                  Device name
                  <input
                    autoFocus
                    required
                    disabled={busy}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                  />
                </label>
                <label className="field">
                  Device type
                  <select
                    value={platform}
                    disabled={busy}
                    onChange={(event) => {
                      const next = event.target.value;
                      setPlatform(next);
                      setHostUrl(
                        next === "chrome" ? "http://127.0.0.1:43111" : "",
                      );
                      setName(
                        next === "chrome"
                          ? "Chrome on this PC"
                          : "Android phone",
                      );
                    }}
                  >
                    <option value="android">Android phone or tablet</option>
                    <option value="chrome">Chrome extension</option>
                  </select>
                </label>
              </div>
              {platform !== "chrome" && (
                <>
                  <p className="small-copy">
                    For your first connection, put your phone and this PC on the
                    same trusted Wi-Fi network. For mobile data, connect both to
                    your private VPN and use its PC address.
                  </p>
                  <div className="inline-note" role="status">
                    <Info size={18} />
                    <span>
                      {networkLoading
                        ? "Checking the active HTTPS listener…"
                        : networkError ||
                          pairingNetworkBlock(network) ||
                          `Private-network listener is active on port ${network?.listener.port}. Windows Firewall and your phone’s network must also allow the connection.`}
                    </span>
                  </div>
                  <div className="modal-actions">
                    <Button
                      type="button"
                      kind="secondary"
                      disabled={busy || networkLoading}
                      onClick={() => setNetworkRefresh((value) => value + 1)}
                    >
                      Check network again
                    </Button>
                    {pairingNetworkBlock(network) && (
                      <Button
                        type="button"
                        kind="secondary"
                        disabled={busy}
                        onClick={() => {
                          setPairOpen(false);
                          navigate("settings");
                        }}
                      >
                        Open network settings
                      </Button>
                    )}
                  </div>
                  {!!network?.addresses.length && (
                    <label className="field">
                      Addresses found on this PC
                      <select
                        value={
                          network.addresses.some((item) => item.url === hostUrl)
                            ? hostUrl
                            : ""
                        }
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.value)
                            setHostUrl(event.target.value);
                        }}
                      >
                        <option value="">
                          Choose your Wi-Fi, Ethernet or VPN adapter
                        </option>
                        {network.addresses.map((item) => (
                          <option value={item.url} key={item.address}>
                            {item.name} · {item.address}
                            {item.kind === "vpn"
                              ? " · VPN/shared private range"
                              : ""}
                          </option>
                        ))}
                      </select>
                      <small>
                        Choose the adapter your phone can reach. VirtualBox, WSL
                        and other virtual adapters usually cannot connect your
                        phone. An address here does not prove reachability.
                      </small>
                    </label>
                  )}
                </>
              )}
              <label className="field">
                Control Center address
                <input
                  type="url"
                  required
                  disabled={busy || platform === "chrome"}
                  value={hostUrl}
                  onChange={(event) => setHostUrl(event.target.value)}
                  placeholder="https://192.168.1.10:43110"
                />
                <small>
                  {platform === "chrome"
                    ? "Chrome connects to the authenticated bridge on this PC only. No LAN listener is needed."
                    : "Use this PC’s private network address. Localhost and 127.0.0.1 point to the phone itself and cannot be used."}
                </small>
              </label>
              <div className="inline-note">
                <Info size={18} />
                <span>
                  {platform === "chrome"
                    ? "Load the extension on this Windows PC, then paste the pairing information into its popup."
                    : "Keep Control Center open. Do not forward port 43110 on your router. If pairing times out, check Windows Firewall access for Nakama on the network you trust."}
                </span>
              </div>
              <div className="modal-actions">
                <Button
                  kind="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setPairOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  busy={busy}
                  disabled={
                    platform !== "chrome" &&
                    (networkLoading || Boolean(pairingNetworkBlock(network)))
                  }
                >
                  <QrCode size={16} />
                  Create pairing ticket
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="pairing-result">
                <div className="qr-frame">
                  {qr ? (
                    <img
                      src={qr}
                      width="260"
                      height="260"
                      alt="Single-use Nakama device pairing QR code"
                    />
                  ) : (
                    <QrCode size={80} />
                  )}
                </div>
                <div>
                  <h3>{name}</h3>
                  <p>
                    Open device setup and paste the pairing information. The QR
                    contains the same details for clients with a QR scanner.
                  </p>
                  <div className="pairing-detail">
                    <span>Server</span>
                    <strong>{ticketUrl}</strong>
                  </div>
                  <div className="pairing-detail">
                    <span>Expires</span>
                    <strong>
                      {new Date(ticket.expiresAt).toLocaleTimeString("en-GB")}
                    </strong>
                  </div>
                  <Button kind="secondary" onClick={() => void copy()}>
                    <Copy size={15} />
                    Copy pairing information
                  </Button>
                </div>
              </div>
              <label className="field">
                Pairing information
                <textarea
                  readOnly
                  rows={4}
                  value={payload}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <small>
                  This ticket grants a new device access. Share it only with
                  your own device.
                </small>
              </label>
              {platform !== "chrome" && (
                <details className="fingerprint">
                  <summary>Verify the host certificate fingerprint</summary>
                  <code>{ticket.fingerprint}</code>
                </details>
              )}
              <div className="modal-actions">
                <Button kind="secondary" onClick={() => setTicket(undefined)}>
                  Create another ticket
                </Button>
                <Button onClick={() => setPairOpen(false)}>Done</Button>
              </div>
            </>
          )}
        </Modal>
      )}
      {revoke && (
        <Modal
          title="Remove this device’s access?"
          description="Its current key will stop working. You can pair the device again later."
          onClose={() => setRevoke(undefined)}
        >
          <div className="modal-actions">
            <Button kind="secondary" onClick={() => setRevoke(undefined)}>
              Keep device
            </Button>
            <Button
              kind="danger"
              onClick={() =>
                void perform(
                  "DELETE",
                  `/api/devices/${revoke}`,
                  undefined,
                  "Device access removed.",
                ).then((result) => {
                  if (result !== undefined) setRevoke(undefined);
                })
              }
            >
              Remove access
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export { ConnectionsPage } from "./connections";

export function ActivityPage({
  focusedApprovalId,
}: {
  focusedApprovalId?: string;
}) {
  const { state, perform } = useNakama();
  const [filter, setFilter] = useState<"pending" | "all">(
    focusedApprovalId ? "all" : "pending",
  );
  const [busy, setBusy] = useState<string>();
  const focusedExists = state.approvals.some(
    (item) => item.id === focusedApprovalId,
  );
  useEffect(() => {
    if (focusedApprovalId && focusedExists) {
      const target = document.getElementById(`approval-${focusedApprovalId}`);
      target?.scrollIntoView({ block: "center", behavior: "auto" });
      target?.focus({ preventScroll: true });
    }
  }, [focusedApprovalId, focusedExists]);
  const approvals = [...state.approvals]
    .filter((item) => filter === "all" || item.status === "pending")
    .reverse();
  const resolve = async (id: string, approved: boolean) => {
    setBusy(id);
    await perform(
      "POST",
      `/api/approvals/${id}/resolve`,
      { approved },
      approved
        ? "Approval recorded. Check the resulting activity for its outcome."
        : "Action declined.",
    );
    setBusy(undefined);
  };
  return (
    <div className="page-enter">
      <SectionTitle
        eyebrow="YOU HAVE THE FINAL SAY"
        title="Activity & approvals"
        description="See what Nakama is doing, and review actions that need your permission."
      />
      <div className="approval-policy">
        <ShieldCheck size={25} />
        <div>
          <strong>
            Deployments and project deletion always need your approval.
          </strong>
          <p>
            Approve only the exact action shown. A request is not a completed
            action.
          </p>
        </div>
      </div>
      <div className="tabs">
        <button
          className={filter === "pending" ? "selected" : ""}
          onClick={() => setFilter("pending")}
        >
          Needs your attention
          <span>
            {state.approvals.filter((item) => item.status === "pending").length}
          </span>
        </button>
        <button
          className={filter === "all" ? "selected" : ""}
          onClick={() => setFilter("all")}
        >
          All approvals<span>{state.approvals.length}</span>
        </button>
      </div>
      {focusedApprovalId && !focusedExists && (
        <p className="inline-note">
          This approval is no longer in the available history. Refresh the host
          and check the repair's current status before taking another action.
        </p>
      )}
      {approvals.length ? (
        <div className="approval-list">
          {approvals.map((item) => (
            <article
              className={`approval-card ${item.id === focusedApprovalId ? "focused-approval" : ""}`}
              id={`approval-${item.id}`}
              tabIndex={item.id === focusedApprovalId ? -1 : undefined}
              key={item.id}
            >
              <div className="approval-card-top">
                <span className="approval-icon">
                  <ShieldCheck size={23} />
                </span>
                <div>
                  <span className="eyebrow">
                    {item.type.replaceAll("_", " ")}
                  </span>
                  <h3>{item.title}</h3>
                </div>
                <Status value={item.status} />
              </div>
              <pre className="approval-description">{item.description}</pre>
              {item.id === focusedApprovalId && (
                <p className="approval-reference">Linked approval: {item.id}</p>
              )}
              {item.type === "project_check" && item.status === "started" && (
                <p className="approval-result-note">
                  Started. See project activity for the final result.
                </p>
              )}
              {item.error && <p className="inline-error">{item.error}</p>}
              <div className="approval-card-bottom">
                <span>{relativeDate(item.createdAt)}</span>
                {item.status === "pending" && (
                  <div className="button-row">
                    <Button
                      kind="secondary"
                      busy={busy === item.id}
                      onClick={() => void resolve(item.id, false)}
                    >
                      <X size={15} />
                      Decline
                    </Button>
                    <Button
                      busy={busy === item.id}
                      onClick={() => void resolve(item.id, true)}
                    >
                      <Check size={16} />
                      Approve this action
                    </Button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            icon={<CheckCheck size={30} />}
            title={
              filter === "pending"
                ? "All clear. Nothing needs your approval."
                : "Your activity starts here."
            }
          >
            {filter === "pending"
              ? "When an action needs a decision, it will appear here with the details."
              : "Requested commands, deployments, and deletion approvals appear here."}
          </Empty>
        </section>
      )}
      <SectionTitle
        title="Recent tasks"
        description="Live states and the latest output from AI, commands, and project checks."
      />
      {state.tasks.length ? (
        <div className="activity-list">
          {[...state.tasks]
            .reverse()
            .slice(0, 30)
            .map((task) => (
              <details className="activity-item" key={task.id}>
                <summary>
                  <span className="activity-task-icon">
                    <Activity size={17} />
                  </span>
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.providerId} · {relativeDate(task.createdAt)}
                    </small>
                  </span>
                  <Status value={task.status} />
                </summary>
                {task.output && (
                  <pre className="task-output">{task.output}</pre>
                )}
                {task.error && <p className="inline-error">{task.error}</p>}
                {task.exitCode !== undefined && task.exitCode !== null && (
                  <p className="task-exit-code">Exit code: {task.exitCode}</p>
                )}
                {task.signal && (
                  <p className="task-exit-code">
                    Stopped by signal: {task.signal}
                  </p>
                )}
                {!task.output && !task.error && (
                  <p className="muted">No output yet.</p>
                )}
              </details>
            ))}
        </div>
      ) : (
        <p className="muted">
          No tasks yet. Start a conversation to put your AI team to work.
        </p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { state, perform, notify } = useNakama();
  const [hostName, setHostName] = useState(state.config.hostName);
  const [voice, setVoice] = useState(state.config.voice || "en-GB-female");
  useEffect(() => {
    setHostName(state.config.hostName);
  }, [state.config.hostName]);
  const pickFolder = async () => {
    try {
      const folder = await chooseFolder();
      if (folder)
        await perform(
          "PATCH",
          "/api/settings",
          { workspaceRoot: folder },
          "Workspace folder updated.",
        );
    } catch (reason) {
      notify(String(reason), true);
    }
  };
  return (
    <div className="page-enter settings-page">
      <SectionTitle
        eyebrow="MAKE YOURSELF AT HOME"
        title="Your Nakama, your way"
        description="Set the workspace, connections, and boundaries that work for you."
      />
      <section className="settings-section">
        <div className="settings-section-label">
          <FolderOpen size={22} />
          <h3>Your workspace</h3>
          <p>The home for projects Nakama creates on this PC.</p>
        </div>
        <div className="settings-section-body">
          <label className="field">
            Control Center name
            <input
              value={hostName}
              onChange={(event) => setHostName(event.target.value)}
              maxLength={80}
            />
          </label>
          <Button
            kind="secondary"
            onClick={() =>
              void perform(
                "PATCH",
                "/api/settings",
                { hostName: hostName.trim() },
                "Host name saved.",
              )
            }
            disabled={!hostName.trim()}
          >
            Save name
          </Button>
          <div className="settings-divider" />
          <label className="field">
            Project folder
            <div className="folder-picker">
              <span>
                <FolderOpen size={17} />
                {state.config.workspaceRoot || "No workspace selected"}
              </span>
              <Button kind="secondary" onClick={() => void pickFolder()}>
                Choose folder
              </Button>
            </div>
            <small>
              Nakama creates projects inside this folder. Existing project
              locations are kept when you change it.
            </small>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-label">
          <ShieldCheck size={22} />
          <h3>Permission preferences</h3>
          <p>
            Keep everyday actions simple and important decisions in your hands.
          </p>
        </div>
        <div className="settings-section-body">
          <Toggle
            checked={state.config.confirmOrdinaryActions}
            onChange={(value) =>
              void perform(
                "PATCH",
                "/api/settings",
                { confirmOrdinaryActions: value },
                "Confirmation preference saved.",
              )
            }
            label="Confirm ordinary assistant actions"
            description="Ask again before routine requests, including phone actions, email sends, and calendar events."
          />
          <Toggle
            checked
            disabled
            onChange={() => {}}
            label="Always approve deployments"
            description="Every deployment needs your explicit approval. This cannot be disabled."
          />
          <Toggle
            checked
            disabled
            onChange={() => {}}
            label="Always approve project deletion"
            description="Deleting a project always requires a fresh approval."
          />
          <Toggle
            checked
            disabled
            onChange={() => {}}
            label="Approve raw commands"
            description="Commands can change files or publish software. Review the executable and arguments first."
          />
          <div className="inline-note compact">
            <Info size={17} />
            <span>
              Phone actions also depend on permissions granted on that device.
              Android’s protected screens and authentication remain under your
              control.
            </span>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-label">
          <Globe size={22} />
          <h3>Remote connection</h3>
          <p>Bring your workspace with you using a private network.</p>
        </div>
        <div className="settings-section-body">
          <label className="field">
            Allow paired devices over a private network
            <select
              aria-label="Allow paired devices over a private network"
              value={state.config.vpnOnly ? "vpn" : state.config.allowLan ? "lan" : "local"}
              onChange={(event) => void perform("PATCH", "/api/settings", { vpnOnly: event.target.value === "vpn", allowLan: event.target.value === "lan" }, "Listener preference saved. Fully quit and reopen Control Center.")}
            >
              <option value="local">This PC only</option>
              <option value="vpn">Private VPN only (Tailscale)</option>
              <option value="lan">Home LAN / private network</option>
            </select>
            <span>VPN mode listens only on Tailscale. Home LAN mode listens on network interfaces. Every device still needs its paired key. Fully quit and reopen after changing this.</span>
          </label>
          <div className="connection-facts">
            <div>
              <span>Transport</span>
              <strong>HTTPS · certificate pinning</strong>
            </div>
            <div>
              <span>Port</span>
              <strong>{state.config.port || 43110}</strong>
            </div>
            <div>
              <span>Pairing</span>
              <strong>Single-use ticket · revocable keys</strong>
            </div>
          </div>
          <p className="small-copy">
            Use a private VPN for mobile data access. Keep this PC on, avoid
            public port forwarding, and remove lost devices from the Devices
            page.
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-label">
          <Volume2 size={22} />
          <h3>Your companion’s voice</h3>
          <p>English, with a British voice where your device provides one.</p>
        </div>
        <div className="settings-section-body">
          <label className="field">
            Preferred voice
            <select
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
            >
              <option value="en-GB-female">
                English (British) · female preference
              </option>
              <option value="en-GB">English (British) · system default</option>
              <option value="en-US">English (American) · system default</option>
            </select>
            <small>
              Voice availability and the selected speaker depend on Android’s
              installed text-to-speech engine.
            </small>
          </label>
          <Button
            kind="secondary"
            onClick={() =>
              void perform(
                "PATCH",
                "/api/settings",
                { voice },
                "Voice preference saved.",
              )
            }
          >
            Save voice preference
          </Button>
        </div>
      </section>
      <AiRoleSettings />
      <MemorySpendSettings />
      <section className="settings-section">
        <div className="settings-section-label">
          <Info size={22} />
          <h3>Setup & help</h3>
          <p>A little guidance when you need it.</p>
        </div>
        <div className="settings-section-body">
          <h4>Start with the quick-start guide</h4>
          <p className="small-copy">
            The repository’s documentation includes account setup, Android
            installation, private networking, the Chrome extension, and a
            detailed feature checklist.
          </p>
          <div className="code-path">docs/</div>
          <div className="settings-divider" />
          <h4>Development preview</h4>
          <p className="small-copy">
            {previewMode
              ? "You are viewing the browser preview. Only preview projects and preferences are saved in this browser. No provider calls, phone control, or computer commands run here."
              : "You are connected through the isolated desktop bridge. Provider credentials are kept by the host and are not sent back to this interface."}
          </p>
          <div className="settings-divider" />
          <h4>Media and integrations</h4>
          <p className="small-copy">
            Setup screens show supported configuration. Google OAuth supports
            multiple personal accounts. Kling video uses its official CLI
            sign-in, separate credits, and approval for every video. Some
            service actions remain pending; the checklist distinguishes
            implemented features from planned work.
          </p>
        </div>
      </section>
    </div>
  );
}
