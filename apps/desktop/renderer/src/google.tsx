import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Inbox,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Unplug,
} from "lucide-react";
import {
  Button,
  Empty,
  Modal,
  SectionTitle,
  Status,
  TextLink,
} from "./components";
import { api, openExternal, previewMode } from "./bridge";
import { useNakama } from "./context";
import type { GoogleAccount } from "./types";

interface MailMessage {
  id: string;
  snippet: string;
  headers: { name: string; value: string }[];
}
interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
}
export function GooglePanel({ onConnect }: { onConnect: () => void }) {
  const { state, perform, notify } = useNakama();
  const [accounts, setAccounts] = useState<GoogleAccount[]>(
    state.googleAccounts || [],
  );
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<"mail" | "calendar">("mail");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [compose, setCompose] = useState<"mail" | "calendar">();
  const [disconnect, setDisconnect] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (previewMode) {
      setAccounts([]);
      return;
    }
    api<{ accounts: GoogleAccount[] }>("GET", "/api/google/accounts")
      .then((result) => {
        if (!cancelled) setAccounts(result.accounts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state.googleAccounts?.length]);
  const account = accounts.find((item) => item.id === selected) || accounts[0];
  const selectAccount = (id: string) => {
    setSelected(id);
    setLoaded(false);
    setMessages([]);
    setEvents([]);
  };
  const load = async () => {
    if (!account) return;
    setBusy(true);
    try {
      if (tab === "mail") {
        const result = await api<{ messages: MailMessage[] }>(
          "GET",
          `/api/google/${account.id}/messages?q=${encodeURIComponent(query)}`,
        );
        setMessages(result.messages);
      } else {
        const result = await api<{ items?: CalendarEvent[] }>(
          "GET",
          `/api/google/${account.id}/events?calendarId=primary`,
        );
        setEvents(result.items || []);
      }
      setLoaded(true);
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not load Google data.",
        true,
      );
    } finally {
      setBusy(false);
    }
  };
  const changeTab = (next: "mail" | "calendar") => {
    setTab(next);
    setLoaded(false);
    setMessages([]);
    setEvents([]);
  };
  const header = (item: MailMessage, name: string) =>
    item.headers.find(
      (value) => value.name.toLowerCase() === name.toLowerCase(),
    )?.value || "";
  return (
    <section className="panel google-panel">
      <SectionTitle
        eyebrow="PERSONAL ASSISTANT"
        title="Your Google accounts"
        description="Keep your personal inbox and calendar separate from your business AI account."
        action={
          <Button kind="secondary" onClick={onConnect}>
            <Plus size={15} />
            Connect Google
          </Button>
        }
      />
      {!accounts.length ? (
        <Empty
          icon={<Mail size={29} />}
          title="Bring your inbox and plans together"
          action={
            <TextLink onClick={onConnect}>
              Connect your first Google account
            </TextLink>
          }
        >
          Use your own Google desktop OAuth client, then sign in with each
          account you want to add.
        </Empty>
      ) : (
        <>
          <div className="google-account-bar">
            <label className="field">
              Google account
              <select
                value={account?.id || ""}
                onChange={(event) => selectAccount(event.target.value)}
              >
                {accounts.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label} · {item.email}
                  </option>
                ))}
              </select>
            </label>
            <Status value={account?.status || "not_configured"} />
            <Button kind="ghost" onClick={() => setDisconnect(true)}>
              <Unplug size={14} />
              Disconnect
            </Button>
          </div>
          <div className="tabs">
            <button
              className={tab === "mail" ? "selected" : ""}
              onClick={() => changeTab("mail")}
            >
              <Mail size={15} />
              Inbox preview
            </button>
            <button
              className={tab === "calendar" ? "selected" : ""}
              onClick={() => changeTab("calendar")}
            >
              <CalendarDays size={15} />
              Upcoming events
            </button>
          </div>
          {!account?.services.includes(
            tab === "mail" ? "gmail" : "calendar",
          ) ? (
            <div className="inline-note">
              This account has not granted access to{" "}
              {tab === "mail" ? "Gmail" : "Google Calendar"}. Add a connection
              with the required service selected.
            </div>
          ) : (
            <>
              <div className="google-toolbar">
                {tab === "mail" ? (
                  <input
                    aria-label="Search Gmail"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search email, e.g. is:unread"
                  />
                ) : (
                  <span className="muted">
                    Primary calendar · next 25 events
                  </span>
                )}
                <Button
                  kind="secondary"
                  busy={busy}
                  onClick={() => void load()}
                >
                  <RefreshCw size={14} />
                  {loaded
                    ? "Refresh"
                    : tab === "mail"
                      ? "Load inbox"
                      : "Load events"}
                </Button>
                <Button onClick={() => setCompose(tab)}>
                  {tab === "mail" ? <Send size={14} /> : <Plus size={15} />}{" "}
                  {tab === "mail" ? "Write email" : "New event"}
                </Button>
              </div>
              {!loaded ? (
                <p className="google-load-note">
                  {tab === "mail"
                    ? "Load the 10 most recent matching messages. This view displays message headers and snippets."
                    : "Load upcoming events from this account’s primary calendar."}
                </p>
              ) : tab === "mail" ? (
                messages.length ? (
                  <div className="mail-list">
                    {messages.map((item) => (
                      <article className="mail-item" key={item.id}>
                        <div>
                          <strong>
                            {header(item, "From") || "Unknown sender"}
                          </strong>
                          <time>
                            {header(item, "Date")
                              ? new Date(
                                  header(item, "Date"),
                                ).toLocaleDateString("en-GB")
                              : ""}
                          </time>
                        </div>
                        <h4>{header(item, "Subject") || "(No subject)"}</h4>
                        <p>{item.snippet}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon={<Inbox size={25} />}
                    title="No matching messages"
                  >
                    Try changing the search, or check another account.
                  </Empty>
                )
              ) : events.length ? (
                <div className="event-list">
                  {events.map((item) => (
                    <article className="event-item" key={item.id}>
                      <span className="event-calendar-icon">
                        <CalendarDays size={20} />
                      </span>
                      <div>
                        <h4>{item.summary || "Untitled event"}</h4>
                        <p>
                          {item.start?.dateTime
                            ? new Date(item.start.dateTime).toLocaleString(
                                "en-GB",
                              )
                            : item.start?.date || "Date not provided"}
                          {item.location ? ` · ${item.location}` : ""}
                        </p>
                        {item.description && (
                          <p className="event-description">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<CalendarDays size={26} />}
                  title="Room for something good"
                >
                  No upcoming events returned for this calendar.
                </Empty>
              )}
            </>
          )}
          {compose && account && (
            <GoogleCompose
              kind={compose}
              account={account}
              onClose={() => setCompose(undefined)}
            />
          )}{" "}
          {disconnect && account && (
            <Modal
              title={`Disconnect ${account.label}?`}
              description="Nakama will remove its locally stored Google access. This does not delete email or calendar events."
              onClose={() => setDisconnect(false)}
            >
              <div className="modal-actions">
                <Button kind="secondary" onClick={() => setDisconnect(false)}>
                  Keep connection
                </Button>
                <Button
                  kind="danger"
                  onClick={() =>
                    void perform(
                      "DELETE",
                      `/api/google/accounts/${account.id}`,
                      undefined,
                      "Google account disconnected.",
                    ).then((result) => {
                      if (result) {
                        setAccounts((current) =>
                          current.filter((item) => item.id !== account.id),
                        );
                        setSelected("");
                        setLoaded(false);
                        setDisconnect(false);
                      }
                    })
                  }
                >
                  Disconnect
                </Button>
              </div>
            </Modal>
          )}
        </>
      )}
    </section>
  );
}

export function GoogleConnect({
  onClose,
  service,
}: {
  onClose: () => void;
  service?: string;
}) {
  const { perform, notify } = useNakama();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [label, setLabel] = useState("Personal Google account");
  const [services, setServices] = useState<string[]>(
    service ? [service] : ["gmail", "calendar"],
  );
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const toggle = (id: string) =>
    setServices((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await perform<{ url: string; expiresAt: string }>(
      "POST",
      "/api/google/connect",
      {
        clientId: clientId.trim(),
        clientSecret: clientSecret || undefined,
        label: label.trim(),
        services,
      },
    );
    if (result) {
      try {
        await openExternal(result.url);
        setStarted(true);
        setClientSecret("");
      } catch (reason) {
        notify(String(reason), true);
      }
    }
    setBusy(false);
  };
  return (
    <Modal
      title="Connect a Google account"
      description="Use a Desktop app OAuth client from your own Google Cloud project. Then choose the Google account you want to add."
      onClose={onClose}
    >
      {started ? (
        <div className="google-signin-started">
          <span className="empty-icon">
            <Check size={27} />
          </span>
          <h3>Finish signing in with Google</h3>
          <p>
            Your browser has opened Google’s consent screen. After you finish,
            this account will appear in Connections. The sign-in window expires
            after five minutes.
          </p>
          <div className="modal-actions">
            <Button onClick={onClose}>Back to connections</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => void connect(event)}>
          <label className="field">
            Account label
            <input
              autoFocus
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={100}
              placeholder="Personal Gmail"
            />
          </label>
          <label className="field">
            Google desktop OAuth client ID
            <input
              required
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="…apps.googleusercontent.com"
              autoComplete="off"
            />
          </label>
          <label className="field">
            Client secret · if provided by Google
            <input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="off"
            />
            <small>
              Some Google desktop client credentials include a secret. It is
              stored only in the host’s credential vault.
            </small>
          </label>
          <div className="google-scope-options">
            <label>
              <input
                type="checkbox"
                checked={services.includes("gmail")}
                onChange={() => toggle("gmail")}
              />
              <span>
                Gmail<small>Read messages and send email you request.</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={services.includes("calendar")}
                onChange={() => toggle("calendar")}
              />
              <span>
                Google Calendar
                <small>Read calendars and create events you request.</small>
              </span>
            </label>
          </div>
          <TextLink
            external
            onClick={() =>
              void openExternal(
                "https://console.cloud.google.com/apis/credentials",
              )
            }
          >
            Open Google Cloud credentials
          </TextLink>
          <div className="inline-note">
            Enable Gmail API and Google Calendar API, configure the consent
            screen, and add yourself as a test user if your OAuth app is in
            testing. Read the setup guide for exact steps.
          </div>
          <div className="modal-actions">
            <Button kind="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              busy={busy}
              disabled={!clientId.trim() || !label.trim() || !services.length}
            >
              Continue with Google
              <ArrowRight size={15} />
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function GoogleCompose({
  kind,
  account,
  onClose,
}: {
  kind: "mail" | "calendar";
  account: GoogleAccount;
  onClose: () => void;
}) {
  const { state, perform, notify } = useNakama();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      kind === "calendar" &&
      (!start || !end || +new Date(end) <= +new Date(start))
    ) {
      notify("Choose an end time after the start time.", true);
      return;
    }
    setBusy(true);
    const payload =
      kind === "mail"
        ? { to: to.trim(), subject: subject.trim(), body }
        : {
            summary: subject.trim(),
            description: body,
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            location: location.trim(),
            calendarId: "primary",
          };
    const result = await perform<{ status?: string }>(
      "POST",
      `/api/google/${account.id}/${kind === "mail" ? "send-email" : "create-event"}`,
      payload,
    );
    setBusy(false);
    if (result) {
      notify(
        result.status === "pending"
          ? "Request is waiting for your approval in Activity."
          : kind === "mail"
            ? "Google confirmed the email request."
            : "Google confirmed the calendar event.",
      );
      onClose();
    }
  };
  return (
    <Modal
      title={kind === "mail" ? "Write an email" : "Create a calendar event"}
      description={`${kind === "mail" ? "From" : "Calendar"}: ${account.email}`}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        {kind === "mail" && (
          <label className="field">
            To
            <input
              type="email"
              required
              autoFocus
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="person@example.com"
            />
          </label>
        )}
        <label className="field">
          {kind === "mail" ? "Subject" : "Event title"}
          <input
            required
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={300}
          />
        </label>
        {kind === "calendar" && (
          <>
            <div className="two-column">
              <label className="field">
                Start
                <input
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label className="field">
                End
                <input
                  type="datetime-local"
                  required
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
            </div>
            <p className="small-copy timezone-note">
              Times use this PC’s timezone:{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}.
            </p>
            <label className="field">
              Location · optional
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                maxLength={1000}
              />
            </label>
          </>
        )}
        <label className="field">
          {kind === "mail" ? "Message" : "Description · optional"}
          <textarea
            rows={5}
            required={kind === "mail"}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={kind === "mail" ? 100000 : 10000}
          />
        </label>
        <p className="small-copy">
          {state.config.confirmOrdinaryActions
            ? "This request will wait in your approvals inbox."
            : kind === "mail"
              ? "Selecting Send email submits this message to Google for delivery."
              : "Selecting Create event adds it to this account’s primary calendar."}
        </p>
        <div className="modal-actions">
          <Button type="button" kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {kind === "mail" ? <Send size={15} /> : <CalendarDays size={15} />}{" "}
            {state.config.confirmOrdinaryActions
              ? "Request approval"
              : kind === "mail"
                ? "Send email"
                : "Create event"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
