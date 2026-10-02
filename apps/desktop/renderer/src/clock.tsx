import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Pause, Play, Square, BellOff } from "lucide-react";
import { api } from "./bridge";
import { Button, SectionTitle } from "./components";
import { useNakama } from "./context";
import "./clock.css";

type Timer = { id: string; title: string; durationSeconds: number; remainingSeconds: number; status: "running" | "paused" | "finished" | "cancelled" | "dismissed"; endsAt?: string; revision: number; requestedBy: string };
type Snapshot = { now: string; timeZone: string; timers: Timer[] };
function countdown(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
export function ClockPage() {
  const { state } = useNakama();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState("0"), [minutes, setMinutes] = useState("10"), [seconds, setSeconds] = useState("0");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const alive = useRef(false), writing = useRef(false), readSequence = useRef(0);
  const load = useCallback(async () => {
    if (writing.current) return;
    const sequence = ++readSequence.current;
    try {
      const response = await api<Snapshot>("GET", "/api/clock");
      if (alive.current && sequence === readSequence.current) { setSnapshot(response); setOffset(Date.parse(response.now) - Date.now()); }
    } catch (error) { if (alive.current && sequence === readSequence.current) setError(error instanceof Error ? error.message : "Clock could not refresh."); }
  }, []);
  useEffect(() => {
    alive.current = true; void load();
    const refresh = window.setInterval(() => void load(), 3000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive.current = false; readSequence.current++; clearInterval(refresh); clearInterval(clock); };
  }, [load]);
  const edit = (update: () => void) => { update(); requestId.current = crypto.randomUUID(); };
  const duration = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  const validDuration = [hours, minutes, seconds].every((value) => /^\d+$/.test(value)) && duration >= 1 && duration <= 604800 && Number.isSafeInteger(duration);
  async function mutate(path: string, body: unknown, onSaved?: () => void) {
    if (writing.current) return;
    writing.current = true; readSequence.current++; setBusy(true); setError("");
    try {
      await api("POST", path, body);
      if (alive.current) onSaved?.();
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "Could not confirm this timer change. Refresh before trying again."); }
    finally { writing.current = false; if (alive.current) { setBusy(false); void load(); } }
  }
  const timers = (snapshot?.timers || []).filter((timer) => history || !["cancelled", "dismissed"].includes(timer.status));
  const date = new Date(now + offset);
  return <div className="clock-page">
    <SectionTitle eyebrow="Your time, close at hand" title="Clock & timers" description="A clock and one-time countdowns built into Nakama. No AI requests are needed." />
    <section className="panel clock-now" aria-label="Current time">
      <Clock3 size={24} /><div><time className="clock-face" dateTime={date.toISOString()}>{date.toLocaleTimeString("en-GB", { timeZone: snapshot?.timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
      <p>{date.toLocaleDateString("en-GB", { timeZone: snapshot?.timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {snapshot?.timeZone || "Local time"}</p></div>
    </section>
    <section className="panel">
      <h2>Start a timer on this PC</h2>
      <p className="small-copy">Timers keep their deadlines when Nakama restarts. Keep this PC awake and Nakama running for a notification at the right time. Phone timers run separately on your Android device.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (validDuration) void mutate("/api/clock/timers", { title: title.trim() || "Timer", durationSeconds: duration, requestId: requestId.current }, () => { setTitle(""); requestId.current = crypto.randomUUID(); }); }}>
        <fieldset disabled={busy} className="clock-form">
          <label className="field">Timer name<input value={title} maxLength={100} placeholder="Pasta, laundry, a short break…" onChange={(event) => edit(() => setTitle(event.target.value))} /></label>
          <div className="clock-duration">{([["Hours", hours, setHours], ["Minutes", minutes, setMinutes], ["Seconds", seconds, setSeconds]] as const).map(([label, value, setter]) => <label className="field" key={label}>{label}<input aria-label={label} type="number" min="0" max={label === "Hours" ? 168 : 604800} step="1" required value={value} onChange={(event) => edit(() => setter(event.target.value))} /></label>)}</div>
          <div className="clock-actions">{[1, 5, 10, 30].map((preset) => <Button key={preset} type="button" onClick={() => edit(() => { setHours("0"); setMinutes(String(preset)); setSeconds("0"); })}>{preset} min</Button>)}<Button type="submit" disabled={!validDuration || !snapshot} busy={busy}><Play size={15} /> Start timer</Button></div>
          {!validDuration && <p className="small-copy">Choose a duration between 1 second and 7 days.</p>}
        </fieldset>
      </form>
    </section>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="clock-list-heading"><h2>Your PC timers</h2><label><input type="checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} /> Show history</label></div>
    {snapshot && !timers.length && <p>No timers yet. Try “set a 10 minute timer called Pasta” in Assistant.</p>}
    <div className="clock-timers">{timers.slice().reverse().map((timer) => {
      const remaining = timer.status === "running" && timer.endsAt ? Math.max(0, (Date.parse(timer.endsAt) - now - offset) / 1000) : timer.remainingSeconds;
      const owner = timer.requestedBy === "desktop" ? "This PC" : state.devices.find((device) => device.id === timer.requestedBy)?.name || "Removed paired device";
      return <section className={`panel clock-timer ${timer.status === "finished" ? "clock-finished" : ""}`} key={timer.id} aria-label={`${timer.title} timer`}>
        <h3>{timer.title}</h3><p className="small-copy">{owner} · {timer.status === "running" && remaining === 0 ? "Checking completion…" : timer.status}</p>
        <div className="clock-countdown" aria-label={`Remaining ${countdown(remaining)}`}>{countdown(remaining)}</div>
        {timer.status === "finished" && <p role="status">Time’s up.</p>}
        <div className="clock-actions">{(timer.status === "running" ? ["pause", "cancel"] : timer.status === "paused" ? ["resume", "cancel"] : timer.status === "finished" ? ["dismiss"] : []).map((action) => <Button key={action} disabled={busy} onClick={() => void mutate(`/api/clock/timers/${encodeURIComponent(timer.id)}/${action}`, { revision: timer.revision })}>{action === "pause" ? <Pause size={14} /> : action === "resume" ? <Play size={14} /> : action === "dismiss" ? <BellOff size={14} /> : <Square size={14} />}{action[0].toUpperCase() + action.slice(1)}</Button>)}</div>
      </section>;
    })}</div>
  </div>;
}
