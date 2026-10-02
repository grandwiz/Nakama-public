import { useEffect, useState } from "react";
import { Info, Send, Smartphone } from "lucide-react";
import { api, previewMode } from "./bridge";
import { Button, SectionTitle, Status, relativeDate } from "./components";
import { useNakama } from "./context";
import { DeviceResult } from "./device-result";
import { InstalledAppSelect, useInstalledApps } from "./installed-apps";

type ActionField = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "datetime-local" | "textarea";
  optional?: boolean;
  allowEmpty?: boolean;
  maxLength?: number;
};
type ActionOption = {
  id: string;
  label: string;
  description: string;
  fields: ActionField[];
};
const phoneOptions: ActionOption[] = [
  {
    id: "ui_read",
    label: "Read the current app screen",
    description:
      "Read a bounded summary of visible labels and controls during an active phone-control session. Protected screens are blocked.",
    fields: [
      {
        key: "packageName",
        label: "Installed app",
        placeholder: "com.whatsapp",
      },
    ],
  },
  {
    id: "open_app",
    label: "Open an app",
    description: "Open an installed app on the selected device.",
    fields: [
      {
        key: "packageName",
        label: "Installed app",
        placeholder: "com.whatsapp",
      },
    ],
  },
  {
    id: "call",
    label: "Place a phone call",
    description:
      "Place a normal phone call using the Android dialler. Calling permission must be granted on the phone.",
    fields: [{ key: "number", label: "Phone number", placeholder: "+44…" }],
  },
  {
    id: "sms",
    label: "Prepare an SMS",
    description:
      "Open a message draft in the phone’s SMS app. Check and send it there.",
    fields: [
      { key: "number", label: "Phone number", placeholder: "+44…" },
      { key: "message", label: "Message", type: "textarea" },
    ],
  },
  {
    id: "whatsapp_message",
    label: "Prepare a WhatsApp message",
    description:
      "Open a WhatsApp draft for this phone number. Check and send it in WhatsApp.",
    fields: [
      {
        key: "number",
        label: "Phone number including country code",
        placeholder: "+44…",
      },
      { key: "message", label: "Message", type: "textarea" },
    ],
  },
  {
    id: "calendar",
    label: "Prepare a calendar event",
    description:
      "Open an event draft in the phone’s calendar app. Review and save it there.",
    fields: [
      { key: "title", label: "Event title" },
      { key: "start", label: "Start time on this PC", type: "datetime-local" },
      { key: "end", label: "End time on this PC", type: "datetime-local" },
      { key: "location", label: "Location", optional: true },
    ],
  },
  {
    id: "contacts_search",
    label: "Find a contact",
    description:
      "Search the phone’s contacts after contacts permission has been granted.",
    fields: [{ key: "query", label: "Contact name", placeholder: "Steve" }],
  },
  {
    id: "ui_tap",
    label: "Tap a control in an app",
    description:
      "Start an app-control session on the phone first. The exact app must be in the foreground, and the label must match one visible control.",
    fields: [
      {
        key: "packageName",
        label: "Installed app",
        placeholder: "com.whatsapp",
      },
      {
        key: "text",
        label: "Exact visible control label",
        placeholder: "Search",
      },
    ],
  },
  {
    id: "ui_type",
    label: "Type in the focused app field",
    description:
      "Requires an active phone control session and a focused text field. This enters text without sending it.",
    fields: [
      {
        key: "packageName",
        label: "Installed app",
        placeholder: "com.whatsapp",
      },
      { key: "text", label: "Text to enter", type: "textarea" },
    ],
  },
  {
    id: "ui_scroll",
    label: "Scroll an app",
    description:
      "Scroll forward inside the active, explicitly allowed app session.",
    fields: [
      {
        key: "packageName",
        label: "Installed app",
        placeholder: "com.whatsapp",
      },
    ],
  },
  {
    id: "ui_back",
    label: "Go back inside an app",
    description: "Use Android Back during the active app-control session.",
    fields: [
      {
        key: "packageName",
        label: "Installed app",
        placeholder: "com.whatsapp",
      },
    ],
  },
];
const tabId: ActionField = {
  key: "tabId",
  label: "Browser tab ID",
  type: "number",
  placeholder: "Get this from “List permitted tabs”",
};
const browserOptions: ActionOption[] = [
  {
    id: "browser_tabs",
    label: "List permitted tabs",
    description:
      "List only tabs you have explicitly allowed in the Chrome extension.",
    fields: [],
  },
  {
    id: "browser_read",
    label: "Read a permitted page",
    description:
      "Read page text and the selectors of visible controls. The extension must be allowed on this tab.",
    fields: [tabId],
  },
  {
    id: "browser_screenshot",
    label: "Capture a permitted page",
    description:
      "Capture the visible area of an allowed tab. Keep that tab active in Chrome; protected pages and sensitive fields are blocked.",
    fields: [tabId],
  },
  {
    id: "browser_navigate",
    label: "Navigate within this website",
    description:
      "Navigate a permitted tab within the same website. Another website needs a new tab permission.",
    fields: [
      tabId,
      {
        key: "url",
        label: "Destination URL",
        placeholder: "https://example.com/page",
      },
    ],
  },
  {
    id: "browser_click",
    label: "Click a page control",
    description:
      "Click the exact control from a recent page read. Review the control carefully before sending this action.",
    fields: [
      tabId,
      {
        key: "selector",
        label: "Control selector",
        placeholder: '[data-nakama-control="0"]',
      },
    ],
  },
  {
    id: "browser_type",
    label: "Enter text on a page",
    description:
      "Fill a permitted field without submitting it. Password and protected payment fields are blocked.",
    fields: [
      tabId,
      {
        key: "selector",
        label: "Control selector",
        placeholder: '[data-nakama-control="0"]',
      },
      { key: "text", label: "Text to enter", type: "textarea" },
    ],
  },
  {
    id: "browser_select",
    label: "Choose a dropdown option",
    description:
      "Choose an option in a native single-select dropdown using its exact value from a recent page read. Page events may react to the change; read the page again to check the result. Complete publishing, deployment or deletion actions in Chrome.",
    fields: [
      tabId,
      {
        key: "selector",
        label: "Dropdown selector",
        placeholder: '[data-nakama-control="0"]',
        maxLength: 300,
      },
      {
        key: "value",
        label: "Exact option value",
        placeholder: "Copy the value from a recent page read",
        allowEmpty: true,
        maxLength: 200,
      },
    ],
  },
  {
    id: "browser_scroll",
    label: "Scroll a page",
    description:
      "Scroll a permitted page. Positive values go down; negative values go up.",
    fields: [
      tabId,
      {
        key: "amount",
        label: "Scroll amount in pixels",
        type: "number",
        placeholder: "600",
      },
    ],
  },
];
interface DeviceAction {
  id: string;
  deviceId: string;
  type: string;
  status: string;
  createdAt: string;
  result?: string;
  resultData?: unknown;
  resultDataOmitted?: boolean;
}
export function DeviceActions() {
  const { state, perform, notify } = useNakama();
  const [deviceId, setDeviceId] = useState(state.devices[0]?.id || "");
  const device =
    state.devices.find((item) => item.id === deviceId) || state.devices[0];
  const options = device?.platform === "chrome" ? browserOptions : phoneOptions;
  const [type, setType] = useState("");
  const option = options.find((item) => item.id === type) || options[0];
  const [values, setValues] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<DeviceAction[]>([]);
  const [busy, setBusy] = useState(false);
  const installedApps = useInstalledApps(device?.id || "");
  const needsApp = option.fields.some((field) => field.key === "packageName");
  const validApp = installedApps.apps.some((app) => app.packageName === values.packageName);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (previewMode) return;
      try {
        const result = await api<{ actions: DeviceAction[] }>(
          "GET",
          "/api/actions",
        );
        if (!cancelled) setActions(result.actions);
      } catch {}
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!device) return;
    if (needsApp && !validApp) { notify("Choose an app from the current device list.", true); return; }
    const args: Record<string, unknown> = {};
    for (const field of option.fields) {
      const value = values[field.key] || "";
      if (field.optional && !value) continue;
      if (field.type === "datetime-local") {
        const date = new Date(value);
        if (Number.isNaN(+date)) {
          notify("Enter a valid date and time.", true);
          return;
        }
        args[field.key] = date.toISOString();
      } else if (field.type === "number") {
        if (!value.trim() || !Number.isFinite(Number(value))) {
          notify("Enter a valid number for " + field.label + ".", true);
          return;
        }
        args[field.key] = Number(value);
      } else args[field.key] = value;
    }
    if (
      option.id === "browser_select" &&
      (!Number.isSafeInteger(args.tabId) || Number(args.tabId) <= 0)
    ) {
      notify("Enter a positive whole-number browser tab ID.", true);
      return;
    }
    if (option.id === "browser_select" && !String(args.selector).trim()) {
      notify("Enter the dropdown selector from a recent page read.", true);
      return;
    }
    if (option.id === "call") args.direct = true;
    if (option.id === "ui_scroll") args.direction = "forward";
    if (
      option.id === "calendar" &&
      +new Date(String(args.end)) <= +new Date(String(args.start))
    ) {
      notify("The end time must be after the start time.", true);
      return;
    }
    setBusy(true);
    await perform(
      "POST",
      "/api/device/actions",
      { deviceId: device.id, type: option.id, args },
      state.config.confirmOrdinaryActions
        ? "Device request sent for desktop approval."
        : "Action queued. Wait for the device to report its result.",
    );
    setBusy(false);
  };
  if (!device) return null;
  return (
    <section className="panel device-actions-panel">
      <SectionTitle
        eyebrow="A HELPING HAND, ON YOUR DEVICES"
        title="Request a device action"
        description="Choose a paired device and the exact action you want it to perform."
      />
      <form onSubmit={(event) => void submit(event)}>
        <div className="two-column">
          <label className="field">
            Device
            <select
              aria-label="Device"
              value={device.id}
              onChange={(event) => {
                setDeviceId(event.target.value);
                setType("");
                setValues({});
              }}
            >
              {state.devices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.platform}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Action
            <select
              aria-label="Action"
              value={option.id}
              onChange={(event) => {
                setType(event.target.value);
                setValues({});
              }}
            >
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="device-action-description">{option.description}</p>
        <div className="device-action-fields">
          {option.fields.map((field) => (
            <label
              className={`field ${field.type === "textarea" ? "wide-field" : ""}`}
              key={field.key}
            >
              {field.label}
              {field.optional ? " · optional" : ""}
              {field.key === "packageName" ? (
                <InstalledAppSelect deviceId={device.id} value={values.packageName || ""}
                  controlOnly={option.id !== "open_app"}
                  onChange={(value) => setValues((current) => ({ ...current, packageName: value }))} />
              ) : field.type === "textarea" ? (
                <textarea
                  required={!field.optional && !field.allowEmpty}
                  value={values[field.key] || ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                  rows={3}
                  maxLength={field.maxLength || 10000}
                />
              ) : (
                <input
                  required={!field.optional && !field.allowEmpty}
                  type={field.type || "text"}
                  value={values[field.key] || ""}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  aria-label={field.allowEmpty ? field.label : undefined}
                  aria-describedby={
                    field.allowEmpty
                      ? `${option.id}-${field.key}-hint`
                      : undefined
                  }
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              )}
              {field.allowEmpty && (
                <small id={`${option.id}-${field.key}-hint`}>
                  Leave blank only when the option’s exact value is an empty
                  string. An empty value is still sent with this request.
                </small>
              )}
            </label>
          ))}
        </div>
        <div className="device-action-submit">
          <p>
            <Info size={14} />
            {device.platform === "chrome"
              ? "Allow the target tab in the Chrome extension first."
              : "Keep Nakama open on the device. App-control actions require a live control session."}
          </p>
          <Button type="submit" busy={busy} disabled={needsApp && !validApp}>
            <Send size={15} />
            Send action
          </Button>
        </div>
      </form>
      <div className="settings-divider" />
      <h3 className="form-subtitle">Recent device results</h3>
      {actions.filter((item) => item.deviceId === device.id).length ? (
        <div className="activity-list">
          {actions
            .filter((item) => item.deviceId === device.id)
            .slice(-8)
            .reverse()
            .map((item) => (
              <details className="activity-item" key={item.id}>
                <summary>
                  <span className="activity-task-icon">
                    <Smartphone size={17} />
                  </span>
                  <span>
                    <strong>{item.type.replaceAll("_", " ")}</strong>
                    <small>{relativeDate(item.createdAt)}</small>
                  </span>
                  <Status value={item.status} />
                </summary>
                <p className="small-copy">
                  {item.result || "Waiting for this device to report a result."}
                </p>
                {item.resultData !== undefined && (
                  <DeviceResult type={item.type} value={item.resultData} />
                )}
                {item.resultDataOmitted && (
                  <p className="small-copy">
                    This older screenshot is no longer retained. Request a new
                    capture if needed.
                  </p>
                )}
              </details>
            ))}
        </div>
      ) : (
        <p className="small-copy">
          Requests and device-reported outcomes appear here. A queued request
          has not yet been executed.
        </p>
      )}
    </section>
  );
}
