import { useState } from "react";
import { Clock3, Info, RefreshCw } from "lucide-react";
import { Button, SectionTitle, Status, TextLink } from "./components";
import { openExternal } from "./bridge";
import { useNakama } from "./context";
import "./usage.css";

export interface ProviderUsage {
  id: string;
  name: string;
  status: "available" | "unavailable" | "error";
  windows: {
    label: string;
    usedPercent: number;
    remainingPercent: number;
    resetsAt: string | null;
  }[];
  checkedAt: string | null;
  detail: string;
  source: string;
}
export interface UsageSnapshot {
  providers: ProviderUsage[];
  checkedAt: string;
}
const percent = (value: number) =>
  `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value)}%`;
const dateLabel = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function UsagePanel() {
  const { perform } = useNakama();
  const [snapshot, setSnapshot] = useState<UsageSnapshot>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openingClaude, setOpeningClaude] = useState(false);
  const [repairDetail, setRepairDetail] = useState("");
  const openClaude = async () => {
    setOpeningClaude(true);
    try {
      const result = await perform<{ opened: boolean; detail: string }>(
        "POST",
        "/api/providers/claude/usage-terminal",
        {},
      );
      if (result) setRepairDetail(result.detail);
    } finally {
      setOpeningClaude(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await perform<UsageSnapshot>(
        "GET",
        "/api/providers/usage",
      );
      if (result) setSnapshot(result);
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="usage-panel" aria-label="AI account usage">
      <SectionTitle
        eyebrow="YOUR AI ALLOWANCES"
        title="Room to keep creating"
        description="See the remaining allowances your providers make available to Nakama."
        action={
          <Button kind="secondary" busy={busy} onClick={() => void refresh()}>
            <RefreshCw size={15} />
            {snapshot ? "Refresh usage" : "Check usage"}
          </Button>
        }
      />
      <div className="usage-summary" aria-live="polite">
        <Clock3 size={16} />
        <span>
          {busy
            ? "Checking your account allowances…"
            : snapshot
              ? `Last checked ${dateLabel(snapshot.checkedAt)}`
              : "Press Check usage to read your allowances."}{" "}
          Refreshes within 30 seconds reuse the same snapshot.
        </span>
      </div>
      {failed && (
        <p className="usage-error" role="alert">
          Could not refresh usage.{" "}
          {snapshot
            ? "The previous snapshot remains below."
            : "Check that your PC host is connected and try again."}
        </p>
      )}
      <div className="usage-grid">
        {snapshot
          ? snapshot.providers.map((provider, index) => (
              <article className="usage-card" key={provider.id}>
                <div className="usage-card-heading">
                  <span className={`provider-mark large provider-${index}`}>
                    {provider.name.slice(0, 1)}
                  </span>
                  <Status
                    value={
                      provider.status === "available"
                        ? "connected"
                        : provider.status
                    }
                    label={
                      provider.status === "available"
                        ? "Reported"
                        : provider.status === "error"
                          ? "Refresh failed"
                          : "Not available"
                    }
                  />
                </div>
                <h2>{provider.name}</h2>
                {provider.windows.length ? (
                  <div className="usage-windows">
                    {provider.windows.map((window, index) => (
                      <div
                        className="usage-window"
                        key={`${window.label}-${index}`}
                      >
                        <p className="usage-window-label">{window.label}</p>
                        <div className="usage-remaining">
                          <strong>{percent(window.remainingPercent)}</strong>
                          <span>remaining</span>
                        </div>
                        <progress
                          className={
                            window.remainingPercent <= 10 ? "usage-low" : ""
                          }
                          max="100"
                          value={window.remainingPercent}
                          aria-label={`${window.label} remaining`}
                        />
                        <div className="usage-window-meta">
                          <span>{percent(window.usedPercent)} used</span>
                          <span>
                            {window.resetsAt
                              ? new Date(window.resetsAt).getTime() <=
                                Date.now()
                                ? "Reset time passed · refresh to check"
                                : `Resets ${dateLabel(window.resetsAt)}`
                              : "Reset time unavailable"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="usage-unknown">
                    <strong>—</strong>
                    <span>Remaining usage unavailable</span>
                  </div>
                )}
                <p className="usage-detail">{provider.detail}</p>
                {provider.id === "claude" &&
                  provider.status !== "available" && (
                    <div>
                      <Button
                        kind="secondary"
                        busy={openingClaude}
                        onClick={() => void openClaude()}
                      >
                        Open Claude /usage on this PC
                      </Button>
                      <p className="usage-detail">
                        A separate official Claude terminal can refresh its
                        sign-in. Return here and refresh usage afterward.
                      </p>
                      {repairDetail && <p role="status">{repairDetail}</p>}
                    </div>
                  )}
                <div className="usage-card-footer">
                  <small>
                    {provider.checkedAt
                      ? `Checked ${dateLabel(provider.checkedAt)}`
                      : "No allowance data imported"}
                  </small>
                  <TextLink
                    external
                    onClick={() => void openExternal(provider.source)}
                  >
                    Provider guidance
                  </TextLink>
                </div>
              </article>
            ))
          : ["ChatGPT / Codex", "Claude"].map((name, index) => (
              <article className="usage-card" key={name}>
                <div className="usage-card-heading">
                  <span className={`provider-mark large provider-${index}`}>
                    {name.slice(0, 1)}
                  </span>
                  <Status value="not_checked" label="Not checked" />
                </div>
                <h2>{name}</h2>
                <div className="usage-unknown">
                  <strong>—</strong>
                  <span>No snapshot yet</span>
                </div>
                <p className="usage-detail">
                  {index === 0
                    ? "Read the account allowances reported by your signed-in Codex CLI."
                    : "Read the subscription allowances used by Claude Code /usage without submitting a model prompt."}
                </p>
              </article>
            ))}
      </div>
      <div className="inline-note">
        <Info size={18} />
        <span>
          Allowances belong to each account and may include use outside Nakama.
          Missing data is shown as unavailable. This check makes no AI request,
          buys no credits and does not consume a reset.
        </span>
      </div>
    </section>
  );
}
