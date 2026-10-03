import { originId } from "./device-delivery.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { parseEverydayRequest } from "./everyday-actions.mjs";

const TTL = 5 * 60_000;
const clean = (input) => {
  let value = String(input || "").trim().replace(/[.!?]+$/, "");
  value = value.replace(/^(?:hey\s+)?nakama[, :]*/i, "");
  for (let count = 0; count < 4; count++) {
    const next = value.replace(/^(?:please[, ]+|(?:can|could|would) you\s+|(?:i want|i would like|i['’]d like) you to\s+)/i, "");
    if (next === value) break;
    value = next;
  }
  return value.trim();
};
const plain = (value) => value.length <= 1000 && !/[\r\n`<>]|\b(?:do not|don't|don’t|never|instead of)\b/i.test(value) && !/^(?:explain|example|pretend)\b/i.test(value);

// Only a short answer to a question we actually asked can complete a command.
// Conversation history, model text and another device never supply authority.
export class EverydayConversation {
  constructor({ clock = Date.now } = {}) {
    this.clock = clock;
    this.pending = new Map();
  }
  clearDevice(id) {
    for (const [key, row] of this.pending)
      if (row.origin === id) this.pending.delete(key);
  }
  prepare(body, principal, state) {
    assertPersonalAccess(state, principal);
    const origin = originId(principal);
    const key = JSON.stringify([origin, body.projectId || null]);
    const now = this.clock();
    for (const [id, row] of this.pending)
      if (row.expires <= now) this.pending.delete(id);
    let value = clean(body.message);
    const pending = this.pending.get(key);
    const remember = (entry, question) => {
      if (this.pending.size >= 100 && !this.pending.has(key))
        this.pending.delete(this.pending.keys().next().value);
      this.pending.set(key, { ...entry, origin, expires: now + TTL, timeZone: body.timeZone || pending?.timeZone });
      return { question };
    };
    if (pending && /^(?:cancel|stop|never mind|nevermind|forget it)$/i.test(value)) {
      this.pending.delete(key);
      return { question: "Cancelled that unfinished request. Nothing was scheduled or opened." };
    }
    if (!plain(value)) {
      this.pending.delete(key);
      return null;
    }
    // New complete commands replace an unfinished question instead of combining
    // their arguments with stale ones.
    if (parseEverydayRequest(body.message)) {
      this.pending.delete(key);
      return null;
    }
    if (pending?.kind === "alarm") {
      const answer = value.replace(/^(?:at|for)\s+/i, "");
      const command = `set an alarm for ${answer}${pending.suffix || ""}`;
      if (parseEverydayRequest(command)?.type === "alarm_create") {
        this.pending.delete(key); // consume before the first effect; never replay
        return { message: command, timeZone: body.timeZone || pending.timeZone };
      }
    }
    if (pending?.kind === "monitor") {
      if (!pending.url) {
        const url = /^(https:\/\/\S+?)(?:\s+for\s+(.+))?$/i.exec(value);
        if (url) {
          const condition = url[2] || pending.condition;
          if (condition) {
            const command = `monitor ${url[1]} for ${condition}`;
            if (parseEverydayRequest(command)?.type === "monitor_create") {
              this.pending.delete(key);
              return { message: command };
            }
          } else {
            return remember({ kind: "monitor", url: url[1] }, "What should I watch for: stock availability, or exact text? For text, reply text: followed by the phrase.");
          }
        }
      } else {
        const condition = /^(?:stock|restock|stock availability|in stock|back in stock)$/i.test(value)
          ? "stock" : /^text:\s*\S/i.test(value) ? value.slice(5).trim() : null;
        if (condition) {
          const command = `monitor ${pending.url} for ${condition}`;
          if (parseEverydayRequest(command)?.type === "monitor_create") {
            this.pending.delete(key);
            return { message: command };
          }
        }
      }
    }
    let match;
    if ((match = /^(?:set|create|add|schedule)(?: me)? (?:a |an |my )?(?:morning )?alarm(?: for me)?((?: (?:every day|daily|on weekdays|on weekends))?(?: on .+)?)$/i.exec(value))) {
      return remember({ kind: "alarm", suffix: match[1] }, principal.kind === "device"
        ? "What time should I set the alarm for? For example, 7 am tomorrow. I’ll save it in Nakama on your PC and send it to this device unless you name another destination."
        : "What time and which paired phone or tablet should ring? For example, 7 am tomorrow on Kitchen tablet. I’ll save the alarm in Nakama on your PC.");
    }
    if ((match = /^(?:monitor|watch|keep (?:an )?eye on)\s+(?:(?:a|the|this)\s+)?(?:website|site|stock)(?:\s+for\s+(stock|restock|stock availability))?$/i.exec(value))) {
      return remember({ kind: "monitor", condition: match[1] || (/\bstock$/i.test(value) ? "stock" : null) }, "Which exact HTTPS page should I monitor? Paste its URL. I can watch for stock availability or text without using a model on each check.");
    }
    if ((match = /^(?:monitor|watch)\s+(https:\/\/\S+)$/i.exec(value))) {
      return remember({ kind: "monitor", url: match[1] }, "What should I watch for: stock availability, or exact text? For text, reply text: followed by the phrase.");
    }
    // A different request ends the pending exchange. Later incidental numbers or
    // URLs must not unexpectedly finish an old command.
    this.pending.delete(key);
    return null;
  }
}
