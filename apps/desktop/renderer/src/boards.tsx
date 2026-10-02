import { useCallback, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  ClipboardList,
  Clock3,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Button,
  Empty,
  IconButton,
  Mascot,
  SectionTitle,
  Status,
  Toggle,
} from "./components";
import { useNakama } from "./context";
import type { Routine } from "./foundations-types";
import { AutonomousTasksPanel } from "./autonomous-tasks";
import "./foundations.css";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function BoardsPage({
  initialTab = "tasks",
}: {
  initialTab?: "tasks" | "routines";
}) {
  const { state, perform, openAssistant, navigate } = useNakama();
  const [tab, setTab] = useState<"tasks" | "routines" | "autonomous">(
    initialTab,
  );
  const autonomousDirty = useRef(false);
  const onAutonomousDirty = useCallback((dirty: boolean) => {
    autonomousDirty.current = dirty;
  }, []);
  function selectTab(next: "tasks" | "routines" | "autonomous") {
    if (
      next === tab ||
      !autonomousDirty.current ||
      window.confirm("Leave without saving these autonomous task drafts?")
    )
      setTab(next);
  }
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const items = state.taskBoard?.items || [];
  const open = items.filter((item) => !item.completed).length;
  const visible = items.filter(
    (item) =>
      filter === "all" ||
      (filter === "done" ? item.completed : !item.completed),
  );
  async function change(method: string, path: string, body?: unknown) {
    setBusy(true);
    try {
      return await perform(method, path, body);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-enter">
      <SectionTitle
        eyebrow="LITTLE STEPS, BIG POSSIBILITIES"
        title="My clipboard"
        description="Your tasks and everyday rhythms, together on your PC and phone."
      />
      <div
        className="clipboard-tabs"
        role="tablist"
        aria-label="Clipboard boards"
      >
        <button
          role="tab"
          aria-selected={tab === "tasks"}
          className={tab === "tasks" ? "selected" : ""}
          onClick={() => selectTab("tasks")}
        >
          <ClipboardList size={18} /> Task board <span>{open}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "routines"}
          className={tab === "routines" ? "selected" : ""}
          onClick={() => selectTab("routines")}
        >
          <Bell size={18} /> Routines board{" "}
          <span>{state.routineBoard?.routines.length || 0}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "autonomous"}
          className={tab === "autonomous" ? "selected" : ""}
          onClick={() => selectTab("autonomous")}
        >
          <ClipboardList size={18} /> Autonomous tasks
        </button>
      </div>
      {tab === "tasks" ? (
        <section className="clipboard" aria-label="Task board">
          <div className="clipboard-clip" aria-hidden="true" />
          <div className="clipboard-heading">
            <div>
              <span className="eyebrow">ONE THING AT A TIME</span>
              <h2>Let’s get it done.</h2>
              <p>
                {open
                  ? `${open} ${open === 1 ? "task is" : "tasks are"} waiting for a little attention.`
                  : "A little room for your next idea."}
              </p>
            </div>
            <Mascot size={92} />
          </div>
          <form
            className="board-add"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!title.trim() || busy) return;
              const result = await change("POST", "/api/task-board/items", {
                title: title.trim(),
              });
              if (result) setTitle("");
            }}
          >
            <input
              aria-label="New task"
              placeholder="Something to remember to do…"
              maxLength={240}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button type="submit" busy={busy} disabled={!title.trim()}>
              <Plus size={17} /> Add task
            </Button>
          </form>
          <div className="board-toolbar">
            <div className="button-row">
              {(["all", "open", "done"] as const).map((value) => (
                <button
                  key={value}
                  className={`board-filter ${filter === value ? "selected" : ""}`}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === "all"
                    ? "All tasks"
                    : value === "open"
                      ? "To do"
                      : "Completed"}
                </button>
              ))}
            </div>
            <Button
              kind="ghost"
              disabled={busy || items.every((item) => !item.completed)}
              onClick={() =>
                void change("POST", "/api/task-board/cleanup-completed", {})
              }
            >
              Clear completed
            </Button>
          </div>
          <div className="board-items">
            {visible.map((item) => (
              <article
                key={item.id}
                className={`board-item ${item.completed ? "done" : ""}`}
              >
                <button
                  className="board-check"
                  role="checkbox"
                  aria-checked={item.completed}
                  aria-label={`${item.completed ? "Reopen" : "Complete"} task: ${item.title}`}
                  disabled={busy}
                  onClick={() =>
                    void change(
                      "PATCH",
                      `/api/task-board/items/${encodeURIComponent(item.id)}`,
                      { completed: !item.completed },
                    )
                  }
                >
                  {item.completed && <Check size={18} />}
                </button>
                <div className="board-item-copy">
                  <h3>{item.title}</h3>
                  {item.details && <p>{item.details}</p>}
                  <div className="board-item-meta">
                    <span>
                      {item.sourceKind === "manual"
                        ? "Your note"
                        : item.sourceKind === "workflow"
                          ? "Project team"
                          : item.sourceKind === "routine"
                            ? "Routine"
                            : "Nakama task"}
                    </span>
                    {item.sourceStatus && <Status value={item.sourceStatus} />}
                    {item.projectId && (
                      <button onClick={() => openAssistant(item.projectId!)}>
                        View progress <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
                <IconButton
                  label={`Delete task card: ${item.title}`}
                  disabled={busy}
                  onClick={() =>
                    void change(
                      "DELETE",
                      `/api/task-board/items/${encodeURIComponent(item.id)}`,
                    )
                  }
                >
                  <Trash2 size={17} />
                </IconButton>
              </article>
            ))}
            {!visible.length && (
              <Empty
                icon={<ClipboardList size={28} />}
                title={
                  filter === "done"
                    ? "Good things take little steps"
                    : "A fresh page"
                }
              >
                {filter === "done"
                  ? "Tasks you finish will be crossed out here."
                  : "Add a task above, or give Nakama a task in conversation."}
              </Empty>
            )}
          </div>
          <p className="board-footnote">
            <Clock3 size={15} /> Yesterday’s completed cards clear each day the
            host runs. Ticking or removing a card leaves the original work and
            its status intact.
          </p>
          <Button kind="ghost" onClick={() => navigate("assistant")}>
            Talk to Nakama <ArrowRight size={15} />
          </Button>
        </section>
      ) : tab === "autonomous" ? (
        <AutonomousTasksPanel onDirty={onAutonomousDirty} />
      ) : (
        <RoutinesBoard />
      )}
      <p className="small-copy foundations-voice">
        Try saying “Nakama, add task buy oat milk”, “show my tasks” or “what are
        you working on?” in Android voice.
      </p>
    </div>
  );
}

function RoutinesBoard() {
  const { state, perform } = useNakama();
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [time, setTime] = useState("07:00");
  const [timeZone, setTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);
  const [kind, setKind] = useState<Routine["kind"]>("reminder");
  const [targetDeviceId, setTargetDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const routines = state.routineBoard?.routines || [];
  const devices = state.devices.filter(
    (device) =>
      device.platform === "android" &&
      device.permissions?.googleAccess !== false &&
      device.permissions?.projectAccess !== false,
  );
  function reset() {
    setEditing(undefined);
    setTitle("");
    setDetails("");
    setTime("07:00");
    setWeekdays([1, 2, 3, 4, 5]);
    setKind("reminder");
    setTargetDeviceId("");
  }
  async function change(method: string, path: string, body?: unknown) {
    setBusy(true);
    try {
      return await perform(method, path, body);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="routines-layout">
      <section className="clipboard routines-list" aria-label="Routines board">
        <div className="clipboard-clip" aria-hidden="true" />
        <div className="clipboard-heading">
          <div>
            <span className="eyebrow">A RHYTHM THAT FEELS LIKE YOU</span>
            <h2>Everyday little rituals.</h2>
            <p>Reminders and alarms you can change whenever life does.</p>
          </div>
          <Mascot size={76} />
        </div>
        {routines.map((routine) => (
          <article className="routine-card" key={routine.id}>
            <div className="routine-title">
              <span className="routine-clock">
                <Bell size={18} /> {routine.time}
              </span>
              <Status
                value={routine.enabled ? "ready" : "paused"}
                label={routine.enabled ? "On" : "Paused"}
              />
            </div>
            <h3>{routine.title}</h3>
            {routine.details && <p>{routine.details}</p>}
            <p className="small-copy">
              {routine.weekdays.map((day) => days[day]).join(" · ")} ·{" "}
              {routine.timeZone}
            </p>
            <p className="small-copy">
              {routine.kind === "alarm" ? "Alarm" : "Reminder"}
              {routine.targetDeviceId
                ? ` · ${state.devices.find((device) => device.id === routine.targetDeviceId)?.name || "Paired device"}`
                : " · Shared devices"}
            </p>
            {routine.kind === "alarm" && (
              <p className="small-copy" role="status">
                {routine.deviceSchedule
                  ? `${routine.deviceSchedule.status.replaceAll("_", " ")} · ${routine.deviceSchedule.detail} · Reported ${new Date(routine.deviceSchedule.reportedAt).toLocaleString()}`
                  : "Waiting for the phone to confirm its alarm schedule."}
              </p>
            )}
            <Toggle
              checked={routine.enabled}
              disabled={busy}
              label={`Enable ${routine.title}`}
              onChange={(enabled) => {
                if (!busy)
                  void change(
                    "PATCH",
                    `/api/routines/${encodeURIComponent(routine.id)}`,
                    { enabled },
                  );
              }}
            />
            <div className="button-row">
              <Button
                kind="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(routine.id);
                  setTitle(routine.title);
                  setDetails(routine.details || "");
                  setTime(routine.time);
                  setTimeZone(routine.timeZone);
                  setWeekdays(routine.weekdays);
                  setKind(routine.kind);
                  setTargetDeviceId(routine.targetDeviceId || "");
                }}
              >
                <Pencil size={14} /> Edit
              </Button>
              <Button
                kind="ghost"
                disabled={busy}
                aria-label={`Delete routine: ${routine.title}`}
                onClick={async () => {
                  const result = await change(
                    "DELETE",
                    `/api/routines/${encodeURIComponent(routine.id)}`,
                  );
                  if (result && editing === routine.id) reset();
                }}
              >
                <Trash2 size={14} /> Remove
              </Button>
            </div>
          </article>
        ))}
        {!routines.length && (
          <Empty icon={<Bell size={28} />} title="Make room for a good habit">
            Add a morning alarm or a reminder to take a breather.
          </Empty>
        )}
      </section>
      <section className="panel routine-form">
        <h3>{editing ? "Edit routine" : "A new routine"}</h3>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const result = await change(
              editing ? "PATCH" : "POST",
              `/api/routines${editing ? `/${encodeURIComponent(editing)}` : ""}`,
              {
                title: title.trim(),
                details: details.trim(),
                kind,
                time,
                timeZone,
                weekdays,
                targetDeviceId: targetDeviceId || null,
                ...(!editing ? { enabled: true } : {}),
              },
            );
            if (result) reset();
          }}
        >
          <label className="field">
            Name
            <input
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A gentle morning start"
            />
          </label>
          <label className="field">
            Notes
            <textarea
              rows={2}
              maxLength={1000}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Anything to remember?"
            />
          </label>
          <div className="routine-time-fields">
            <label className="field">
              Time
              <input
                required
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
            <label className="field">
              Type
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as Routine["kind"])
                }
              >
                <option value="reminder">Reminder</option>
                <option value="alarm">Alarm</option>
              </select>
            </label>
          </div>
          <label className="field">
            Time zone
            <input
              required
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              placeholder="Europe/London"
            />
          </label>
          <fieldset className="routine-days">
            <legend>Repeat on</legend>
            {days.map((day, index) => (
              <button
                type="button"
                key={day}
                aria-pressed={weekdays.includes(index)}
                className={weekdays.includes(index) ? "selected" : ""}
                onClick={() =>
                  setWeekdays((current) =>
                    current.includes(index)
                      ? current.filter((value) => value !== index)
                      : [...current, index].sort(),
                  )
                }
              >
                {day}
              </button>
            ))}
          </fieldset>
          <label className="field">
            Notify
            <select
              required={kind === "alarm"}
              value={targetDeviceId}
              onChange={(event) => setTargetDeviceId(event.target.value)}
            >
              <option value="">
                {kind === "alarm"
                  ? "Choose the phone for this alarm"
                  : "All permitted devices"}
              </option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
          <p className="small-copy">
            The host records reminders while running. Open Nakama on your phone
            to sync alarm changes; Android must allow notifications and exact
            alarms for timely alerts.
          </p>
          <div className="button-row">
            <Button
              type="submit"
              busy={busy}
              disabled={
                !title.trim() ||
                !weekdays.length ||
                (kind === "alarm" && !targetDeviceId)
              }
            >
              {editing ? "Save routine" : "Add routine"}
            </Button>
            {editing && (
              <Button type="button" kind="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
