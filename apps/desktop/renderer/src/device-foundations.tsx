import { useEffect, useState } from "react";
import { MapPin, Monitor, ShieldCheck, Square } from "lucide-react";
import { api, openExternal, previewMode, subscribe } from "./bridge";
import { Button, SectionTitle, Status, Toggle } from "./components";
import { useNakama } from "./context";
import "./foundations.css";

interface RemoteStatus {
  available: boolean;
  enabled: boolean;
  permitted: boolean;
  detail: string;
  monitors: {
    id: string;
    name: string;
    width: number;
    height: number;
    primary: boolean;
  }[];
  session: {
    id: string;
    deviceId: string;
    monitorId: string;
    expiresAt: string;
    lastActivityAt: string;
  } | null;
}
export function DeviceFoundations() {
  const { state, perform, notify } = useNakama();
  const [remote, setRemote] = useState<RemoteStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    let active = true,
      pending = false;
    const refresh = async () => {
      if (pending || previewMode) return;
      pending = true;
      try {
        const result = await api<RemoteStatus>(
          "GET",
          "/api/remote-desktop/status",
        );
        if (active) {
          setRemote(result);
          setError("");
        }
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Remote desktop status unavailable.",
          );
      } finally {
        pending = false;
      }
    };
    void refresh();
    const unsubscribe = subscribe(() => void refresh());
    const interval = setInterval(() => {
      setTick(Date.now());
      void refresh();
    }, 3000);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(interval);
    };
  }, []);
  const seconds = remote?.session
    ? Math.max(
        0,
        Math.ceil((Date.parse(remote.session.expiresAt) - tick) / 1000),
      )
    : 0;
  const sessionDevice = state.devices.find(
    (device) => device.id === remote?.session?.deviceId,
  );
  return (
    <div className="device-foundations">
      <section className="panel">
        <SectionTitle
          title="Your desktop, in your hand"
          description="Control your unlocked Windows PC from the Remote desktop screen in Android."
        />
        <Toggle
          checked={state.config.remoteDesktopEnabled === true}
          disabled={busy}
          label="Allow remote desktop sessions"
          description="Also grant Remote desktop to the intended paired phone below. Each session shows a Stop control on this PC and ends after two minutes."
          onChange={(enabled) => {
            if (!busy) {
              setBusy(true);
              void perform(
                "PATCH",
                "/api/settings",
                { remoteDesktopEnabled: enabled },
                enabled
                  ? "Remote desktop enabled for permitted devices."
                  : "Remote desktop disabled.",
              ).finally(() => setBusy(false));
            }
          }}
        />
        {previewMode ? (
          <p className="small-copy">
            Open the Windows app to check monitors and remote desktop
            availability.
          </p>
        ) : error ? (
          <p role="alert" className="small-copy">
            {error}
          </p>
        ) : (
          remote && (
            <>
              <div className="button-row">
                <Status
                  value={remote.available ? "ready" : "unavailable"}
                  label={
                    remote.available
                      ? "Windows remote desktop supported"
                      : "Windows remote desktop unavailable"
                  }
                />
                <span className="small-copy">
                  {remote.monitors
                    .map(
                      (monitor) =>
                        `${monitor.name}${monitor.primary ? " (main)" : ""} · ${monitor.width} × ${monitor.height}`,
                    )
                    .join(" / ") || "No monitor discovered"}
                </span>
              </div>
              {remote.session && (
                <div className="remote-session-live" role="status">
                  <Monitor size={20} />
                  <strong>
                    {sessionDevice?.name || "Paired phone"} is controlling this
                    PC
                  </strong>
                  <span>{seconds}s left</span>
                  <Button
                    kind="danger"
                    busy={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await perform(
                          "POST",
                          "/api/remote-desktop/stop",
                          {},
                          "Remote desktop stopped.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Square size={14} /> Stop remote desktop
                  </Button>
                </div>
              )}
              <p className="small-copy">
                <ShieldCheck size={14} /> {remote.detail}
              </p>
            </>
          )
        )}
        <p className="small-copy">
          Touch to click, drag to move, or use scroll mode and the keyboard. The
          monitor button at the top of the phone screen switches displays. Keep
          both devices connected through your private network.
        </p>
      </section>
      <section className="panel" style={{ marginTop: 20 }}>
        <SectionTitle
          title="Find my devices"
          description="Location shared by your own Android devices. Every fix includes its time and accuracy."
        />
        <div className="location-grid">
          {state.devices
            .filter((device) => device.platform === "android")
            .map((device) => {
              const record = state.deviceLocations?.find(
                (item) => item.deviceId === device.id,
              );
              const location = record?.lastKnown;
              const stale =
                !location ||
                tick - Date.parse(location.observedAt) > 10 * 60 * 1000;
              const privateDevice =
                device.permissions?.googleAccess === false ||
                device.permissions?.projectAccess === false;
              return (
                <article className="location-card" key={device.id}>
                  <MapPin size={22} />
                  <h4>{device.name}</h4>
                  <Status
                    value={record?.enabled && !stale ? "ready" : "paused"}
                    label={
                      privateDevice
                        ? "Shared data disabled"
                        : record?.enabled
                          ? location
                            ? stale
                              ? "Last known · stale"
                              : "Last known · recent"
                            : "Waiting for a fix"
                          : "Sharing off"
                    }
                  />
                  {location && !privateDevice ? (
                    <>
                      <p>
                        {location.latitude.toFixed(5)},{" "}
                        {location.longitude.toFixed(5)}
                        <br />
                        Accuracy about {Math.round(location.accuracy)} metres
                      </p>
                      <p className="small-copy">
                        Observed{" "}
                        {new Date(location.observedAt).toLocaleString()}
                        <br />
                        Received{" "}
                        {new Date(location.receivedAt).toLocaleString()}
                      </p>
                      <Button
                        kind="secondary"
                        onClick={() =>
                          void openExternal(
                            `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`,
                          ).catch(() => notify("Could not open the map.", true))
                        }
                      >
                        Open map
                      </Button>
                    </>
                  ) : (
                    <p className="small-copy">
                      Enable location sharing in this phone’s Nakama Tools
                      screen. Android location permission and a reachable PC are
                      required.
                    </p>
                  )}
                  {record?.enabled && (
                    <Button
                      kind="ghost"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await perform(
                            "DELETE",
                            `/api/device-locations/${encodeURIComponent(device.id)}`,
                            undefined,
                            "Saved location forgotten and sharing revoked. Re-enable on the phone when needed.",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Forget location & stop sharing
                    </Button>
                  )}
                </article>
              );
            })}
        </div>
        {!state.devices.some((device) => device.platform === "android") && (
          <p className="small-copy">Pair your phone to get started.</p>
        )}
        <p className="small-copy">
          Location is last known, not a guarantee of a live fix. Sharing pauses
          if Android stops the service, permissions change or the phone cannot
          reach this PC. Opening a map shares these coordinates with
          OpenStreetMap.
        </p>
      </section>
    </div>
  );
}
