import { ApiError } from "./security.mjs";
import { MAX_TIMER_SECONDS } from "./clock-timers.mjs";
import { hostTimeZone } from "./personal-boards.mjs";

const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function number(value) {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === "half" || value === "half a" || value === "half an") return .5;
  if (["quarter", "a quarter", "a quarter of an", "a quarter of a"].includes(value)) return .25;
  if (value in words) return words[value];
  const parts = value.split(" ");
  if (parts.length === 2 && (words[parts[0]] || 0) >= 20 && (words[parts[1]] || 0) < 10 && words[parts[1]]) return words[parts[0]] + words[parts[1]];
  return NaN;
}
export function parseTimerDuration(input) {
  if (/[+\-−]\s*\d/.test(input)) return null;
  const normalized = input.toLowerCase().trim().replace(/-/g, " ").replace(/\s+/g, " ");
  const chunks = [...normalized.matchAll(/(.+?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b(?:\s*(?:and\s+)?|$)/g)];
  if (!chunks.length || chunks.map((part) => part[0]).join("") !== normalized) return null;
  let total = 0;
  for (const part of chunks) {
    const count = number(part[1].trim());
    if (!Number.isFinite(count) || count <= 0) return null;
    total += count * (/^(?:d)/.test(part[2]) ? 86400 : /^(?:h)/.test(part[2]) ? 3600 : /^(?:m)/.test(part[2]) ? 60 : 1);
  }
  return Number.isSafeInteger(total) && total >= 1 && total <= MAX_TIMER_SECONDS ? total : null;
}
export function durationLabel(seconds) {
  seconds = Math.max(0, Math.ceil(seconds));
  const chunks = [[86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]].map(([unit, label]) => {
    const count = Math.floor(seconds / unit); seconds %= unit;
    return count ? `${count} ${label}${count === 1 ? "" : "s"}` : "";
  }).filter(Boolean);
  return chunks.join(" ") || "0 seconds";
}
function safeTimerName(value) {
  return value.length <= 100 && /^[\p{L}\p{N}][\p{L}\p{N} '_-]*$/u.test(value) &&
    !/\b(?:then|but|after|before|unless|never|without|do not|don['’]t)\b|\band\s+(?:set|start|cancel|stop|pause|resume|dismiss|send|call|delete|open|create|buy|order|deploy|ring|notify|make|tell|remind|show|list|read|write)\b/i.test(value);
}
export function parseClockCommand(input) {
  const clean = input.trim().replace(/[.!?]+$/, "");
  if (/^(?:what(?:'s| is) (?:the )?(?:time|date)(?: now| today)?|what time is it|tell me (?:the |today's )?(?:time|date)|what day is (?:it|today))$/i.test(clean)) return { type: /date|day/i.test(clean) ? "date" : "time" };
  if (/^(?:hi|hello|hey|good morning|good afternoon|good evening)(?: nakama)?$/i.test(clean)) return { type: "greeting" };
  if (/^(?:how are you|how are you doing)$/i.test(clean)) return { type: "greeting", wellbeing: true };
  if (/^(?:thanks|thank you|cheers)(?: nakama)?$/i.test(clean)) return { type: "thanks" };
  let match = /^(?:set|start|create)\s+(?:a\s+)?timer\s+(?:for\s+)?(.+)$/i.exec(clean);
  let duration = match?.[1];
  if (!match) { match = /^(?:set|start|create)\s+(?:a\s+)?(.+?)\s+timer(?:\s+((?:called|named)\s+.+))?$/i.exec(clean); if (match) duration = match[1] + (match[2] ? ` ${match[2]}` : ""); }
  if (duration) {
    if (/\b(?:and|then)\s+(?:set|start|cancel|stop|pause|resume|dismiss|send|call|delete|open|create|buy|order|deploy)\b/i.test(duration)) return { type: "invalid" };
    const titleMatch = /^(.*?)(?:\s+(?:called|named)\s+(.+))?$/i.exec(duration);
    if (titleMatch[2] && !safeTimerName(titleMatch[2].trim())) return { type: "invalid" };
    const durationSeconds = parseTimerDuration(titleMatch[1]);
    return durationSeconds ? { type: "create", durationSeconds, title: titleMatch[2]?.trim() || `${durationLabel(durationSeconds)} timer` } : { type: "invalid" };
  }
  if (/^(?:set|start|create)\b.*\btimer\b/i.test(clean)) return { type: "invalid" };
  if (/^(?:(?:show|list|read)(?: me)? (?:my |the )?timers|what timers (?:are running|do I have)|how much time is left)$/i.test(clean)) return { type: "list" };
  match = /^(?:how much time is left|time remaining|what(?:'s| is) left)(?: on)?(?: the| my)? (.+?)(?: timer)?$/i.exec(clean);
  if (match) return { type: "remaining", name: match[1] === "timer" ? "" : match[1] };
  match = /^(pause|resume|cancel|stop|dismiss)(?: the| my)?(?: (.+?))? timer$/i.exec(clean) || /^(pause|resume|cancel|stop|dismiss)(?: the| my)? timer(?: (.+))?$/i.exec(clean);
  if (match) {
    const name = match[2]?.trim() || "";
    return name && !safeTimerName(name) ? { type: "invalid" } : { type: match[1].toLowerCase() === "stop" ? "cancel" : match[1].toLowerCase(), name };
  }
  return null;
}
export async function localClockReply(host, command, body, principal) {
  if (!command) return null;
  host.clockTimers.access(principal);
  if (command.type === "greeting") return { reply: command.wellbeing ? "I'm here and ready to help. What would you like to do?" : "Hello! What can I help you with?", outcome: { type: "greeting" } };
  if (command.type === "thanks") return { reply: "You're welcome.", outcome: { type: "greeting" } };
  if (["date", "time"].includes(command.type)) {
    let zone = typeof body.timeZone === "string" ? body.timeZone : hostTimeZone();
    try { new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format(); } catch { throw new ApiError(400, "Choose a valid time zone in your device settings."); }
    const format = command.type === "date" ? { weekday: "long", year: "numeric", month: "long", day: "numeric" } : { hour: "2-digit", minute: "2-digit", hour12: true };
    const at = host.clockTimers.clock();
    return { reply: `It's ${new Intl.DateTimeFormat("en-GB", { ...format, timeZone: zone }).format(at)} (${zone}).`, outcome: { type: "clock_read", at: new Date(at).toISOString(), timeZone: zone } };
  }
  if (command.type === "invalid") throw new ApiError(400, "Choose a duration from 1 second to 7 days, for example: set a 10 minute timer called Pasta.");
  if (command.type === "create") {
    const { timer } = await host.clockTimers.route("POST", "/api/clock/timers", { durationSeconds: command.durationSeconds, title: command.title, ...(body.requestId ? { requestId: body.requestId } : {}) }, principal);
    return { reply: timer.status === "running" ? `Started “${timer.title}” for ${durationLabel(timer.remainingSeconds)} on this PC. Keep Nakama and the PC awake to hear its notification.` : `That timer request was already saved; “${timer.title}” is ${timer.status}.`, outcome: { type: "timer_created", timerId: timer.id } };
  }
  const snapshot = await host.clockTimers.route("GET", "/api/clock", {}, principal);
  const timers = snapshot.timers.filter((timer) => !["cancelled", "dismissed"].includes(timer.status));
  if (command.type === "list") return { reply: timers.length ? timers.map((timer) => `• ${timer.title}: ${timer.status === "finished" ? "finished" : `${durationLabel(timer.remainingSeconds)} left${timer.status === "paused" ? " (paused)" : ""}`}`).join("\n") : "You have no running, paused or undismissed timers on this PC.", outcome: { type: "timers_listed", count: timers.length } };
  const eligible = command.type === "pause" ? timers.filter((timer) => timer.status === "running") : command.type === "resume" ? timers.filter((timer) => timer.status === "paused") : command.type === "cancel" ? timers.filter((timer) => ["running", "paused"].includes(timer.status)) : command.type === "dismiss" ? timers.filter((timer) => timer.status === "finished") : timers;
  const normalized = (value) => value.toLowerCase().replace(/\s+timer$/, "").trim();
  const matches = command.name ? eligible.filter((timer) => timer.id === command.name || normalized(timer.title) === normalized(command.name)) : eligible;
  if (matches.length !== 1) throw new ApiError(409, matches.length ? "Several timers match. Use the complete timer name, or choose the exact timer in Clock." : "No matching timer is available. Open Clock to see your timers.");
  const timer = matches[0];
  if (command.type === "remaining") return { reply: `“${timer.title}” ${timer.status === "finished" ? "has finished" : `has ${durationLabel(timer.remainingSeconds)} left${timer.status === "paused" ? " and is paused" : ""}`}.`, outcome: { type: "timer_read", timerId: timer.id } };
  const result = await host.clockTimers.route("POST", `/api/clock/timers/${timer.id}/${command.type}`, { revision: timer.revision }, principal);
  return { reply: `“${timer.title}” is ${result.timer.status}${result.timer.status === "running" ? ` with ${durationLabel(result.timer.remainingSeconds)} left` : ""}.`, outcome: { type: "timer_updated", timerId: timer.id } };
}
