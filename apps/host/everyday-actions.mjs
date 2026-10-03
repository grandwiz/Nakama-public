import { soundQuery } from "./alarm-sounds.mjs";
import { isDeepStrictEqual } from "node:util";
import { ApiError, redact } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { resolveDeviceTarget } from "./device-commands.mjs";
import { hostTimeZone, nextScheduledDate, zonedOccurrence, validateRoutine } from "./personal-boards.mjs";
import { browserUrl } from "./browser-studio.mjs";

export const EVERYDAY_ACTION_FIELDS = {
  alarm_create: ["type", "time", "repeat", "scheduledDate", "targetDeviceNames", "soundQuery", "startSeconds", "durationSeconds"],
  alarm_sound: ["type", "time", "soundQuery", "startSeconds", "durationSeconds"],
  monitor_create: ["type", "url", "condition", "intervalSeconds"],
  open_app: ["type", "appName", "targetDeviceName"],
};
export const EVERYDAY_ACTION_INSTRUCTIONS = `Nakama has host-managed Clock, Android app-launch and website-monitor workers. Alarms may include soundQuery (the exact user sound description), startSeconds (default0), durationSeconds (default15, maximum30). The Windows sound worker searches reusable online audio, downloads a bounded source and creates a local WAV; the destination must download/verify it before confirming scheduling. To change an existing own-device alarm use {"type":"alarm_sound","soundQuery":"exact description","time":"optional HH:mm explicitly requested","startSeconds":0,"durationSeconds":15}; if several alarms match ask which time. Delegate these supported requests with the shapes below instead of claiming a mode prevents them. The host validates the current direct request and performs the work using its existing permission-checked adapter; the model cannot grant permissions or select an unstated destination.
{"type":"alarm_create","time":"HH:mm","repeat":"once|daily|weekdays|weekends","scheduledDate":"optional YYYY-MM-DD explicitly requested","targetDeviceNames":["optional complete explicitly named paired devices"]} — default repeat once. Omit scheduledDate for the next occurrence; today/tomorrow use the supplied timezone. Omit destinations for the requesting Android; a PC alarm needs an explicit Android destination. Ask for a missing time; never invent a recurrence. The host owns the record and Android schedules its own assigned alarm after sync and required OS permissions.
{"type":"open_app","appName":"exact requested app display name","targetDeviceName":"optional exact stated device name"} — launch only. Google Chrome may use Chrome. Unnamed Android requests stay on the requesting device. Opening an app never grants clicks or accessibility permission.
{"type":"monitor_create","url":"exact public HTTPS URL stated by the user","condition":{"type":"stock"},"intervalSeconds":60} or condition {"type":"text","contains":"exact stated text"}. The default cadence is 60 seconds; change it only when explicitly stated (30–86400 seconds). A direct monitoring request creates and starts read-only host checks with no model per poll. Private login, CAPTCHA, purchases and checkout remain separate human actions. Ask for missing URL/condition; do not infer a retailer URL or product. These capability workers report actual queued/saved/active receipts, never an invented completed device effect.`;

const normal = (value) => String(value || "").trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
const fail = (message) => { throw new ApiError(403, message); };
export function normalizeEverydayRequest(message) {
  if (typeof message !== "string" || message.length > 24000) return "";
  let value = message.trim().replace(/^(?:hey\s+)?nakama[, :]*/i, "").replace(/[.!?]+$/g, "");
  for (let i = 0; i < 5; i++) {
    const next = value.replace(/^(?:please[, ]+|(?:can|could|would|will) you\s+|(?:i want|i need|i would like|i['’]d like) you to\s+|help me (?:to )?)/i, "");
    if (next === value) break;
    value = next;
  }
  return value.trim();
}
function safeRequest(message) {
  const value = normalizeEverydayRequest(message);
  return !value || /[\r\n]|```|`|^>|<\w+>|\b(?:do not|don['’]t|never|avoid|without|not to|instead of)\b/i.test(value) ? null : value;
}
const numbers = new Map(Object.entries({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 }));
function number(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const words = value.split(/[ -]+/);
  if (words.length === 1) return numbers.get(words[0]);
  if (words.length === 2 && [20,30,40,50].includes(numbers.get(words[0])) && numbers.get(words[1]) > 0 && numbers.get(words[1]) < 10) return numbers.get(words[0]) + numbers.get(words[1]);
  return undefined;
}
function clockTime(value) {
  let input = normal(value).replace(/\ba\.m\.?$/i, "am").replace(/\bp\.m\.?$/i, "pm");
  let meridiem = /\s*(am|pm|in the morning|in the afternoon|in the evening|at night)$/.exec(input);
  if (meridiem) input = input.slice(0, meridiem.index).trim();
  const marker = meridiem?.[1];
  if (input === "noon") return marker ? null : "12:00";
  if (input === "midnight") return marker ? null : "00:00";
  let hour, minute = 0, match;
  if ((match = /^(\d{1,2})(?::(\d{2}))?$/.exec(input))) { hour = Number(match[1]); minute = Number(match[2] || 0); }
  else if ((match = /^(half|quarter) past (.+)$/.exec(input))) { hour = number(match[2]); minute = match[1] === "half" ? 30 : 15; }
  else {
    input = input.replace(/ o['’]?clock$/, "");
    hour = number(input);
    if (hour === undefined) {
      const tokens = input.split(" ");
      hour = number(tokens.shift()); minute = number(tokens.join(" "));
    }
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || hour < 0 || minute > 59 || minute < 0 || (marker && (hour < 1 || hour > 12))) return null;
  if (marker) hour = hour % 12 + (/^(pm|in the afternoon|in the evening|at night)$/.test(marker) ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function localDate(timeZone, now, offset = 0) {
  try { new Intl.DateTimeFormat("en", { timeZone }).format(now); } catch { throw new ApiError(400, "Choose a supported IANA time zone."); }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((item) => [item.type, item.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function targets(value) {
  const names = value.split(/\s+and\s+|\s*,\s*/i).map((name) => name.trim());
  return names.length <= 10 && names.every((name) => name && name.length <= 80 && !/["“”'`;<>]/.test(name)) ? names : null;
}
function appName(value) {
  const name = String(value || "").trim().replace(/ app$/i, "");
  return /^google chrome$/i.test(name) ? "Chrome" : name;
}

// This is a bounded interpreter of direct user instructions. A model proposal
// must agree with it; quoted/source instructions cannot become action authority.
export function parseEverydayRequest(message, { timeZone = hostTimeZone(), now = new Date() } = {}) {
  const input = safeRequest(message);
  if (!input) return null;
  let match;
  if ((match = /^(?:set|change) (?:my |the )?(?:(.+?) )?alarm sound to (.+)$/i.exec(input))) {
    const time = match[1] ? clockTime(match[1]) : undefined;
    if (match[1] && !time) return null;
    const spec = parseSoundSpec(match[2]);
    return spec ? { type: "alarm_sound", ...(time ? { time } : {}), ...spec } : null;
  }
  if ((match = /^(?:find|download) (.+?)(?: and)? (?:use|set) (?:it |that )?as (?:my |the )?alarm(?: sound)?$/i.exec(input))) {
    const spec = parseSoundSpec(match[1]);
    return spec ? { type: "alarm_sound", ...spec } : null;
  }
  if ((match = /^(?:(?:(?:take )?control (?:of )?(?:my|this) (?:phone|tablet|device))\s+(?:and|to)\s+)?(?:open|launch|start)(?: up)?\s+(?:the )?(.+?)(?:\s+(?:on|using)\s+(.+))?$/i.exec(input))) {
    const name = appName(match[1]);
    if (!name || name.length > 120 || /["“”'`;<>]|\s+(?:and|then)\s+/i.test(name)) return null;
    const destination = match[2] && targets(match[2]);
    if (match[2] && (!destination || destination.length !== 1)) return null;
    return { type: "open_app", appName: name, ...(destination ? { targetDeviceName: destination[0] } : {}) };
  }
  if ((match = /^(?:(?:set|create|add|schedule)(?: me)?(?: a| an)?\s+(?:(?:morning|wake[- ]up)\s+)?alarm(?:\s+(?:for|at))?|wake me(?: up)?(?:\s+at)?)\s+(.+)$/i.exec(input))) {
    let rest = match[1], repeat = "once", scheduledDate, sound;
    const soundSuffix = /\s+with\s+(?:a |the )?(.+)$/i.exec(rest);
    if (soundSuffix) { sound = parseSoundSpec(soundSuffix[1]); if (!sound) return null; rest = rest.slice(0, soundSuffix.index); }
    const recurrence = /\s+(every day|daily|(?:on )?weekdays|(?:on )?weekends|just once|once|one time)(?=\s+(?:on|using)\s+|$)/i.exec(rest);
    if (recurrence) { repeat = /weekday/i.test(recurrence[1]) ? "weekdays" : /weekend/i.test(recurrence[1]) ? "weekends" : /daily|every day/i.test(recurrence[1]) ? "daily" : "once"; rest = rest.slice(0, recurrence.index) + rest.slice(recurrence.index + recurrence[0].length); }
    const date = /\s+(?:on\s+)?(today|tomorrow|\d{4}-\d{2}-\d{2})(?=\s+(?:on|using)\s+|$)/i.exec(rest);
    if (date) { if (repeat !== "once") return null; scheduledDate = /^\d/.test(date[1]) ? date[1] : localDate(timeZone, now, /^tomorrow$/i.test(date[1]) ? 1 : 0); rest = rest.slice(0, date.index) + rest.slice(date.index + date[0].length); }
    const destination = /\s+(?:on|using)\s+(.+)$/.exec(rest);
    const targetDeviceNames = destination && targets(destination[1]);
    if (destination) { if (!targetDeviceNames) return null; rest = rest.slice(0, destination.index); }
    const time = clockTime(rest);
    if (!time) return null;
    return { type: "alarm_create", time, repeat, ...(sound || {}), ...(scheduledDate ? { scheduledDate } : {}), ...(targetDeviceNames ? { targetDeviceNames } : {}) };
  }
  if ((match = /^(?:monitor|watch|track|keep (?:an )?eye on)\s+(?:(?:this |the )?(?:website|web ?page|site)\s+)?(https:\/\/\S+)\s+(?:for|until|and (?:tell|notify|alert) me (?:when|if))\s+(.+)$/i.exec(input))) {
    let conditionText = match[2], intervalSeconds = 60;
    const cadence = /\s+(?:every|once every)\s+(\d+|[a-z -]+)\s+(seconds?|minutes?|hours?)$/i.exec(conditionText);
    if (cadence) { const count = number(normal(cadence[1])); if (!Number.isInteger(count)) return null; intervalSeconds = count * (/hour/i.test(cadence[2]) ? 3600 : /minute/i.test(cadence[2]) ? 60 : 1); conditionText = conditionText.slice(0, cadence.index); }
    const stock = /^(?:stock|stock availability|restock|restocking|(?:when )?(?:it(?:'s| is) )?(?:back )?in stock|(?:it )?(?:comes|coming) back in stock)$/i.test(conditionText);
    const literal = /^(?:(?:the )?(?:text|words?)\s+)?(?:"([^"\n]+)"|“([^”\n]+)”|'([^'\n]+)')$/.exec(conditionText);
    // Unquoted non-stock phrases are literal matching conditions, not commands.
    const contains = literal ? literal[1] || literal[2] || literal[3] : conditionText;
    if (!stock && (contains.length > 200 || !contains.trim() || /[<>`]|\s+(?:then|and)\s+(?:buy|click|open|send|order|pay)\b/i.test(contains))) return null;
    return { type: "monitor_create", url: match[1], condition: stock ? { type: "stock" } : { type: "text", contains }, intervalSeconds };
  }
  return null;
}
function parseSoundSpec(input) {
  const match = /^(.*?)(?:\s+(?:starting at|from)\s+(\d+)\s+seconds?)?(?:\s+for\s+(\d+)\s+seconds?)?$/i.exec(input);
  if (!match) return null;
  const description = match[1].replace(/^(?:the )?sound of /i, "").replace(/ (?:alarm )?(?:sound|audio)(?: clip)?$/i, "").trim();
  try { soundQuery(description); } catch { return null; }
  const startSeconds = Number(match[2] || 0), durationSeconds = Number(match[3] || 15);
  if (startSeconds > 300 || durationSeconds < 1 || durationSeconds > 30 || /["“”]|\b(?:then|and|not)\b/i.test(description)) return null;
  return { soundQuery: description, startSeconds, durationSeconds };
}
function equivalent(action, expected) {
  if (!expected || action.type !== expected.type) return false;
  if (normal(action.soundQuery) !== normal(expected.soundQuery) || (action.startSeconds ?? 0) !== (expected.startSeconds ?? 0) || (action.durationSeconds ?? 15) !== (expected.durationSeconds ?? 15)) return false;
  if (action.type === "alarm_sound") return (action.time || "") === (expected.time || "");
  if (action.type === "open_app") return normal(appName(action.appName || "")) === normal(expected.appName) && normal(action.targetDeviceName) === normal(expected.targetDeviceName);
  if (action.type === "alarm_create") return action.time === expected.time && (action.repeat || "once") === expected.repeat && (action.scheduledDate || "") === (expected.scheduledDate || "") && JSON.stringify((action.targetDeviceNames || []).map(normal)) === JSON.stringify((expected.targetDeviceNames || []).map(normal));
  return action.url === expected.url && (action.intervalSeconds ?? 60) === expected.intervalSeconds && action.condition?.type === expected.condition.type && (action.condition?.contains || "") === (expected.condition.contains || "");
}
function directClauses(request) {
  // A quoted semicolon is payload, never a new user instruction. Keep quoted
  // text intact for literal monitor conditions while tracking its boundaries.
  if (!safeRequest(request)) return [];
  const result = [];
  let start = 0, quote = null;
  for (let index = 0; index < request.length; index++) {
    const character = request[index];
    if (quote) { if (character === quote) quote = null; continue; }
    if (character === '"' || character === "“") { quote = character === "“" ? "”" : '"'; continue; }
    if (character === "'" && (index === 0 || /\s/.test(request[index - 1]))) { quote = "'"; continue; }
    if (character === ";") { result.push(request.slice(start, index)); start = index + 1; }
  }
  if (quote) return [];
  result.push(request.slice(start));
  // Narrative prefixes do not authorize a quoted/example command after a ';'.
  if (!/^(?:set|create|add|schedule|wake|open|launch|start|control|take|monitor|watch|track|keep|read|check|show|send|email|message|text|call|delete|remove|change|find|download)\b/i.test(normalizeEverydayRequest(result[0]))) return [];
  return result;
}
export function validateEverydayAction(action, request, options = {}) {
  const fields = EVERYDAY_ACTION_FIELDS[action?.type];
  if (!fields || Object.keys(action).some((key) => !fields.includes(key))) fail("Unsupported Nakama capability fields.");
  if (action.targetDeviceNames !== undefined && (!Array.isArray(action.targetDeviceNames) || action.targetDeviceNames.some((name) => typeof name !== "string"))) fail("State the exact alarm destinations.");
  if (action.type === "monitor_create") {
    if (!action.condition || typeof action.condition !== "object" || Array.isArray(action.condition) || Object.keys(action.condition).some((key) => !["type", "contains"].includes(key))) fail("Choose a stock or literal text monitoring condition.");
    if (!Number.isInteger(action.intervalSeconds ?? 60) || (action.intervalSeconds ?? 60) < 30 || (action.intervalSeconds ?? 60) > 86400) fail("Choose a monitoring cadence of 30–86400 seconds.");
    if (action.condition.type === "stock" && action.condition.contains !== undefined) fail("Stock conditions cannot include another text condition.");
  }
  const clauses = typeof request === "string" ? directClauses(request) : [];
  const matched = clauses.some((clause) => equivalent(action, parseEverydayRequest(clause, options)));
  if (!matched) fail("The delegated action must match a complete direct current request, including its time, condition and destination. Ask for any missing detail.");
  return action;
}
export function validateEverydayPlan(actions, request, options = {}) {
  const candidates = directClauses(request).map((clause) => parseEverydayRequest(clause, options));
  const used = new Set();
  for (const action of actions) {
    if (!EVERYDAY_ACTION_FIELDS[action.type]) continue;
    const index = candidates.findIndex((candidate, index) => !used.has(index) && equivalent(action, candidate));
    if (index < 0) fail("Each delegated action requires its own direct request clause. Duplicate actions were not dispatched.");
    used.add(index);
  }
}
function destination(host, principal, name, connected) {
  const named = name && host.store.state.devices.some((device) => device.platform === "android" && normal(device.name) === normal(name));
  const own = !named && /^this (?:phone|tablet|device)$/i.test(name || "");
  if (own && principal.kind !== "device") fail("Name the exact paired Android device from the PC.");
  const target = resolveDeviceTarget(host.store.state, principal, { ...(name && !own ? { targetDeviceName: name } : {}) }, { desktop: false, connected });
  return { ...target, requestTargetName: name && !own ? name : undefined };
}
function monitorUrl(value) {
  const result = browserUrl(value, "private"), url = new URL(result);
  if (redact(value) !== value || url.hash || (url.port && url.port !== "443") || [...url.searchParams.keys()].some((key) => /token|secret|password|credential|session|auth|signature|api.?key|code/i.test(key)) || /\/(?:login|signin|sign-in|oauth|authorize|callback)(?:[/?#]|$)/i.test(url.href)) fail("Use a public HTTPS page URL without login or credential parameters.");
  return result;
}
export function preflightEverydayAction(host, action, principal, request, options = {}) {
  validateEverydayAction(action, request, options);
  assertPersonalAccess(host.store.state, principal);
  if (principal.signal?.aborted) throw new ApiError(499, "The delegated action was stopped.");
  if (action.soundQuery !== undefined) soundQuery(action.soundQuery);
  if (action.type === "alarm_sound") {
    const routines = host.boards.routineState(principal).routines.filter(row => row.kind === "alarm" && row.enabled && (!action.time || row.time === action.time) && (principal.kind === "owner" || row.requestedBy === principal.id));
    if (routines.length !== 1) throw new ApiError(409, routines.length ? "Which alarm time should use this sound? Say change my 7 am alarm sound to birds chirping." : "Create an alarm first, then choose its sound.");
    return { routineId: routines[0].id, updatedAt: routines[0].updatedAt, soundQuery: action.soundQuery, startSeconds: action.startSeconds ?? 0, durationSeconds: action.durationSeconds ?? 15 };
  }
  if (action.type === "alarm_create") {
    const timeZone = options.timeZone || hostTimeZone();
    const deviceIds = (action.targetDeviceNames || [null]).map((name) => destination(host, principal, name, false).id);
    const repeat = action.repeat || "once";
    const body = { title: "Alarm", details: "Requested through Nakama", kind: "alarm", time: action.time, timeZone, enabled: true, targetDeviceIds: deviceIds,
      weekdays: repeat === "once" ? [] : repeat === "weekdays" ? [1,2,3,4,5] : repeat === "weekends" ? [0,6] : [0,1,2,3,4,5,6],
      scheduledDate: repeat === "once" ? action.scheduledDate || nextScheduledDate(action.time, timeZone, options.now || new Date()) : null,
      ...(options.requestId ? { requestId: options.requestId } : {}) };
    validateRoutine(body, null, host.store.state, principal);
    if (body.scheduledDate && Date.parse(zonedOccurrence(body.scheduledDate, body.time, timeZone)) <= Number(options.now || new Date())) throw new ApiError(400, "That alarm time has already passed. Choose a future time or date.");
    return body;
  }
  if (action.type === "open_app") {
    const target = destination(host, principal, action.targetDeviceName, true);
    const catalog = host.installedApps.list(target.id, { kind: "owner", id: "desktop" });
    if (!catalog.available) throw new ApiError(409, "Open Nakama on the target device to refresh its installed apps.");
    const matches = catalog.apps.filter((item) => normal(appName(item.label)) === normal(appName(action.appName)));
    if (matches.length !== 1) throw new ApiError(409, matches.length ? "Several installed apps share that name. Select the exact app on the target device." : "That app is not in the target device's current installed app list.");
    return { command: "open_app", targetDeviceId: target.id, ...(target.requestTargetName ? { targetDeviceName: target.requestTargetName } : {}), args: { appName: matches[0].label }, ...(options.requestId ? { requestId: options.requestId } : {}) };
  }
  if (principal.kind === "device" && host.device(principal.id).permissions?.browserControl !== true) throw new ApiError(403, "Enable this device's browser-control permission on the PC before website monitoring.");
  host.monitoring?.access(principal);
  if (action.condition.type === "text" && (typeof action.condition.contains !== "string" || !action.condition.contains.trim() || action.condition.contains.length > 200 || /[\x00-\x1f\x7f]/.test(action.condition.contains) || redact(action.condition.contains) !== action.condition.contains)) throw new ApiError(400, "Use literal matching text without credentials.");
  const url = monitorUrl(action.url);
  return { title: `Watch ${new URL(url).hostname}`.slice(0, 100), kind: "website", url, condition: action.condition, intervalSeconds: action.intervalSeconds ?? 60 };
}
export async function executeEverydayAction(host, action, principal, request, options = {}, expectedBody) {
  // Re-resolve identities and recheck access immediately before every dispatch.
  const body = preflightEverydayAction(host, action, principal, request, options);
  if (expectedBody && !isDeepStrictEqual(body, expectedBody)) throw new ApiError(409, "The delegated action or destination changed after preflight. Nothing was dispatched.");
  let sound;
  if (action.soundQuery) {
    const guard = () => {
      const current = preflightEverydayAction(host, action, principal, request, options);
      if (!isDeepStrictEqual(current, expectedBody || body)) throw new ApiError(409, "The alarm changed while preparing its sound. Repeat the request.");
    };
    sound = await host.alarmSounds.create({ query: action.soundQuery, startSeconds: action.startSeconds ?? 0, durationSeconds: action.durationSeconds ?? 15, ...(options.requestId ? { requestId: options.requestId } : {}) }, principal, guard);
    guard();
  }
  if (action.type === "alarm_sound") {
    const result = await host.dispatch("PATCH", `/api/routines/${body.routineId}`, { soundId: sound.id, expectedUpdatedAt: body.updatedAt }, principal);
    return { result, status: "pending_device", description: `Prepared ${Math.round(sound.durationMs/1000)} seconds of ${sound.name} from ${sound.sourceTitle} (${sound.license}). Saved it for the ${result.time} alarm. Waiting for Android to download, verify and confirm scheduling.`, outcome: { type: "routine_created", id: result.id, kind: "alarm", targetDeviceIds: result.targetDeviceIds, updatedAt: result.updatedAt } };
  }
  if (action.type === "alarm_create") {
    const result = await host.dispatch("POST", "/api/routines", { ...body, ...(sound ? { soundId: sound.id } : {}) }, principal);
    if (!result?.id || result.kind !== "alarm") throw new ApiError(502, "The host did not confirm the alarm record.");
    return { result, status: "pending_device", description: `Saved ${result.scheduledDate ? "one-time" : "repeating"} alarm for ${result.time} (${result.timeZone})${result.scheduledDate ? ` on ${result.scheduledDate}` : ""}${sound ? ` with a ${Math.round(sound.durationMs/1000)}-second ${sound.name} clip (${sound.license})` : ""}. Waiting for the selected Android device${result.targetDeviceIds.length === 1 ? "" : "s"} to confirm scheduling. If alarm syncing is off, open Tools → Routines → Sync phone alarms on each selected device.`, outcome: { type: "routine_created", id: result.id, kind: "alarm", targetDeviceIds: result.targetDeviceIds, updatedAt: result.updatedAt } };
  }
  if (action.type === "open_app") {
    const result = await host.dispatch("POST", "/api/device/commands", body, principal);
    if (!result?.id || !result.reply) throw new ApiError(502, "The host did not confirm the app command.");
    return { result, status: result.type === "device_action" ? "pending_approval" : "queued", description: result.reply, outcome: { type: "device_command_queued", actionId: result.id, targetDeviceId: result.targetDeviceId } };
  }
  const created = await host.dispatch("POST", "/api/monitors", body, principal);
  if (!created?.monitor?.id || !Number.isInteger(created.monitor.revision)) throw new ApiError(502, "The host did not confirm the monitor record.");
  let result = created, status = "needs_attention", detail;
  try {
    preflightEverydayAction(host, action, principal, request, options);
    result = await host.dispatch("POST", `/api/monitors/${encodeURIComponent(created.monitor.id)}/resume`, { revision: created.monitor.revision }, principal);
    if (result?.monitor?.status !== "active") throw new ApiError(502, "Monitoring was not confirmed active.");
    status = "active";
    detail = `Started monitoring ${new URL(body.url).hostname} every ${body.intervalSeconds} seconds on the Windows host. No AI runs per check; keep the host awake. Matches return to this request's device. Login or a challenge may need your attention.`;
  } catch (error) {
    if (error.status === 403 || error.status === 499) throw error;
    detail = `Saved the monitor, but checks are not confirmed active: ${redact(error.message)}. Open Monitoring to review it.`;
  }
  return { result: { ...result, id: created.monitor.id }, status, description: detail, outcome: { type: "navigate", target: "monitoring", monitorId: created.monitor.id } };
}
