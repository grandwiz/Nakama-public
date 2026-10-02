import { ApiError, now, uid } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { hostTimeZone } from "./personal-boards.mjs";
import { captureCompanionMemory } from "./companion-memory.mjs";
import { navigationRequest } from "./local-navigation.mjs";
import { parseTaughtSkill, captureTaughtSkill } from "./learned-skills.mjs";

const clean = (value) => value.trim().replace(/[.!?]+$/g, "");
const key = (value) => clean(value).toLowerCase().replace(/\s+/g, " ");
function clockTime(value) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0),
    meridiem = match[3]?.toLowerCase();
  if (minute > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12)))
    return null;
  if (meridiem) hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function selected(items, name, label) {
  const matches = items.filter(
    (item) => item.id === name || key(item.title) === key(name),
  );
  if (matches.length === 1) return matches[0];
  throw new ApiError(
    409,
    matches.length
      ? `There are several ${label}s named “${name}”. Choose the exact card on the board.`
      : `I couldn't find a ${label} named “${name}”. Use its complete board title.`,
  );
}
const encoded = (id) => encodeURIComponent(id);
const ready = (routine) =>
  `Saved ${routine.kind === "alarm" ? "alarm request" : "routine"} “${routine.title}” for ${routine.time} (${routine.timeZone}). ${routine.kind === "alarm" ? "The Android app must still confirm on-device alarm scheduling; this host receipt does not mean an alarm is set or has sounded." : "Nakama will show a reminder while connected; no external action is scheduled."}`;

export class LocalAssistant {
  constructor(host) {
    this.host = host;
  }
  async handle(body, principal) {
    const input =
      typeof body.message === "string"
        ? clean(
            body.message
              .replace(/^(?:hey\s+)?nakama(?!\s+personality:)[, :]*/i, "")
              .replace(/^please[, ]+/i, ""),
          )
        : "";
    const skillTeaching = /^teach (?:nakama )?skill:/i.test(input);
    if (
      !input ||
      (!skillTeaching &&
        (input.length > 1000 ||
          /[\r\n]|```|^>|<\w+>|\b(?:do not|don't|don’t|never|instead of)\b/i.test(
            input,
          )))
    )
      return null;
    let match, reply, outcome;
    const access = () => assertPersonalAccess(this.host.store.state, principal);
    const taskRoute = (method, path, data = {}) =>
      this.host.boards.route(method, path, data, principal);
    const tasks = () => this.host.boards.taskState(principal).items;
    const routines = () => this.host.boards.routineState(principal).routines;
    try {
      const navigation = navigationRequest(
        input,
        this.host.store.state,
        body.projectId,
      );
      if (navigation) {
        access();
        outcome = navigation;
        reply = `Navigation requested: ${navigation.target.replaceAll("-", " ")}.`;
      } else if (
        (match =
          /^(?:open|show)(?: up)?(?: me)? (?:the |that |my )?(captcha|checkout)(?: page)?(?: for me to (?:fill in|complete))?$/i.exec(
            input,
          ))
      ) {
        access();
        const reason = match[1].toLowerCase();
        const monitors = this.host.monitoring
          .list(principal)
          .monitors.filter(
            (row) =>
              row.kind === "website" &&
              row.status === "attention" &&
              (reason === "captcha"
                ? row.lastOutcome === "captcha" ||
                  row.attentionReason === "captcha"
                : ["match", "checkout", "payment"].includes(row.lastOutcome) ||
                  row.attentionReason === "checkout"),
          );
        if (monitors.length === 1) {
          const opened = await this.host.monitoring.route(
            "POST",
            `/api/monitors/${monitors[0].id}/open`,
            { revision: monitors[0].revision, reason },
            principal,
          );
          outcome = opened.outcome;
          reply = `Opening the current private ${reason} session. Complete it yourself in Nakama's browser.`;
        } else {
          outcome = { type: "navigate", target: "monitoring" };
          reply = monitors.length
            ? "Several monitors need attention. Choose the intended one in Monitoring."
            : `No current permitted ${reason} request is waiting. Open Monitoring to review its latest status.`;
        }
      } else if (
        (match = /^(?:monitor|watch)\s+(https:\/\/\S+?)\s+for\s+(.+)$/i.exec(
          input,
        ))
      ) {
        access();
        let url;
        try {
          url = new URL(match[1]);
        } catch {
          throw new ApiError(400, "Use the exact public HTTPS page URL.");
        }
        const stock =
          /^(?:stock|restock|restocking|when (?:it(?:'s| is) )?(?:back )?in stock|(?:it(?:'s| is) )?(?:back )?in stock)$/i.test(
            match[2],
          );
        const created = await this.host.monitoring.route(
          "POST",
          "/api/monitors",
          {
            title: `Watch ${url.hostname}`,
            kind: "website",
            url: url.href,
            condition: stock
              ? { type: "stock" }
              : { type: "text", contains: match[2] },
            intervalSeconds: 60,
          },
          principal,
        );
        reply =
          "Saved a paused monitor without using AI. Review its exact condition, select any phone handoff and prepare private login in Monitoring, then start it.";
        outcome = {
          type: "navigate",
          target: "monitoring",
          monitorId: created.monitor.id,
        };
      } else if (
        (match =
          /^(?:improve|upgrade|update) (?:yourself|nakama) (?:to|by|with)\s+(.+)$/i.exec(
            input,
          ))
      ) {
        access();
        const saved = await this.host.selfMaintenance.route(
          "POST",
          "/api/self-maintenance",
          { title: match[1].slice(0, 120), request: match[1] },
          principal,
        );
        reply =
          "Saved this Dynamic upgrade request. Model work remains on hold until you explicitly start it on Windows after your allowance returns.";
        outcome = {
          type: "navigate",
          target: "self-maintenance",
          selfMaintenanceId: saved.id,
        };
      } else if (skillTeaching) {
        access();
        if (!parseTaughtSkill(input))
          throw new ApiError(
            400,
            "Teach a skill using one direct line: Teach skill: Title | When: relevant context | Steps: first step; second step. Use the Skills editor for longer methods.",
          );
        const saved = await this.host.store.change((state) => {
          access();
          return captureTaughtSkill(state, input, principal);
        });
        reply = saved.paused
          ? "I haven’t saved this skill because skill learning or conversation memory is paused. You can still add or edit skills in the library."
          : `Saved reusable skill “${saved.title}”. It is available as reference when relevant; this does not grant tools, permissions or verified expertise.`;
        outcome = {
          type: saved.paused ? "skill_not_saved" : "skill_saved",
          ...(saved.id ? { id: saved.id } : {}),
        };
      } else if (
        /^(?:read|list)(?: me)? (?:my |the )?(?:skills|learned skills|skill library)$/i.test(
          input,
        )
      ) {
        access();
        const collection = this.host.skills.public(principal);
        reply = collection.skills.length
          ? collection.skills
              .map(
                (skill) =>
                  `• ${skill.title} · ${skill.status === "candidate" ? "needs review" : skill.enabled ? "ready" : "disabled"}`,
              )
              .join("\n")
          : "The skills library is empty. Teach a method directly or add it in Skills.";
        outcome = { type: "skills_listed", count: collection.skills.length };
      } else if (
        (match = /^(pause|resume) skill (learning|reuse)$/i.exec(input))
      ) {
        access();
        const setting =
          match[2].toLowerCase() === "learning"
            ? "learningEnabled"
            : "reuseEnabled";
        await this.host.skills.route(
          "PATCH",
          "/api/skills/settings",
          { [setting]: match[1].toLowerCase() === "resume" },
          principal,
        );
        reply = `Skill ${match[2].toLowerCase()} ${match[1].toLowerCase() === "resume" ? "enabled" : "paused"}.${this.host.store.state.config.memoryEnabled === false ? " Conversation memory is still off, so automatic skill learning and reuse remain paused." : ""}`;
        outcome = { type: "skill_settings_updated" };
      } else if (
        (match =
          /^(enable|disable|accept|forget|delete|remove) (?:learned )?skill\s+(.+)$/i.exec(
            input,
          ))
      ) {
        access();
        const skill = selected(
            this.host.skills.public(principal).skills,
            match[2],
            "skill",
          ),
          action = match[1].toLowerCase();
        if (["forget", "delete", "remove"].includes(action))
          await this.host.skills.route(
            "DELETE",
            `/api/skills/${skill.id}`,
            {},
            principal,
          );
        else if (action === "accept")
          await this.host.skills.route(
            "POST",
            `/api/skills/${skill.id}/accept`,
            {},
            principal,
          );
        else
          await this.host.skills.route(
            "PATCH",
            `/api/skills/${skill.id}`,
            { enabled: action === "enable" },
            principal,
          );
        reply = `${action === "accept" ? "Accepted for reference" : ["forget", "delete", "remove"].includes(action) ? "Forgot" : action === "enable" ? "Enabled" : "Disabled"} skill “${skill.title}”.`;
        outcome = { type: "skill_updated", id: skill.id };
      } else if (
        /^(?:remember that\s+|(?:my|nakama) (?:personality|preference|trait|routine):\s*|I (?:usually|tend to)\s+)/i.test(
          input,
        )
      ) {
        access();
        const entry = await this.host.store.change((state) => {
          access();
          return captureCompanionMemory(state, input, principal);
        });
        reply = entry
          ? `Saved in Core Memory: ${entry.text}`
          : this.host.store.state.config.memoryEnabled === false ||
              this.host.store.state.config.companionLearningEnabled === false
            ? "I haven’t saved that note because memory or learning is paused in Settings."
            : "That note was not saved. Core Memory accepts one short note without credentials, and has space for 50 notes.";
        outcome = {
          type: entry ? "memory_saved" : "memory_not_saved",
          ...(entry ? { id: entry.id } : {}),
        };
      } else if (
        /^(?:show|read|list)(?: me)? (?:my |the )?(?:core memory|saved memories|saved notes)$/i.test(
          input,
        )
      ) {
        access();
        const memory = await this.host.companionMemory.route(
          "GET",
          "/api/core-memory",
          {},
          principal,
        );
        reply = memory.entries.length
          ? memory.entries
              .map((entry) => `• ${entry.category}: ${entry.text}`)
              .join("\n")
          : "Core Memory has no saved notes.";
        outcome = { type: "memory_listed", count: memory.entries.length };
      } else if (
        /^(?:forget|delete|clear|remove) all (?:my )?(?:core memory|saved memories|saved notes)$/i.test(
          input,
        )
      ) {
        access();
        const result = await this.host.companionMemory.route(
          "DELETE",
          "/api/core-memory",
          {},
          principal,
        );
        reply = `Forgot ${result.forgotten} Core Memory note(s). Conversation history is unchanged.`;
        outcome = { type: "memory_forgotten", ...result };
      } else if (
        (match = /^(?:forget|delete|remove) (?:core )?memory\s+(.+)$/i.exec(
          input,
        ))
      ) {
        access();
        const entries = this.host.store.state.companionMemory.entries;
        const entry = selected(
          entries.map((item) => ({ ...item, title: item.text })),
          match[1],
          "memory note",
        );
        await this.host.companionMemory.route(
          "DELETE",
          `/api/core-memory/${entry.id}`,
          {},
          principal,
        );
        reply = "Forgot that Core Memory note.";
        outcome = { type: "memory_forgotten", id: entry.id };
      } else if (
        (match = /^(?:update|change) (?:core )?memory\s+(.+?) to (.+)$/i.exec(
          input,
        ))
      ) {
        access();
        const entry = selected(
          this.host.store.state.companionMemory.entries.map((item) => ({
            ...item,
            title: item.text,
          })),
          match[1],
          "memory note",
        );
        const result = await this.host.companionMemory.route(
          "PATCH",
          `/api/core-memory/${entry.id}`,
          { category: entry.category, text: match[2] },
          principal,
        );
        reply = `Updated Core Memory: ${result.text}`;
        outcome = { type: "memory_updated", id: entry.id };
      } else if (
        /^(?:(?:what(?:'s| is| are)) (?:on (?:my |the )?task board|my tasks|left to do)|(?:show|list|read)(?: me)? (?:my |the )?(?:tasks|task board|to-do list))$/i.test(
          input,
        )
      ) {
        access();
        const items = tasks().filter((item) => !item.completed);
        reply = items.length
          ? `You have ${items.length} open task card(s):\n${items
              .slice(0, 20)
              .map(
                (item) =>
                  `• ${item.title}${item.sourceStatus ? ` (${item.sourceStatus.replaceAll("_", " ")})` : ""}`,
              )
              .join("\n")}`
          : "Your task board has no open cards.";
        outcome = { type: "tasks_listed", count: items.length };
      } else if (
        /^(?:what are you working on|(?:give me (?:a )?)?status update|(?:give me (?:an )?)?update on (?:my |the )?(?:project|tasks)|how (?:is|are) (?:my |the )?(?:project|tasks) (?:going|doing))$/i.test(
          input,
        )
      ) {
        access();
        const active = this.host.store.state.projectWorkflows.filter((item) =>
          ["running", "awaiting_answers"].includes(item.status),
        );
        const other = this.host.store.state.tasks.filter(
          (item) =>
            !item.workflowId && ["running", "queued"].includes(item.status),
        );
        reply =
          [
            ...active.map(
              (item) =>
                `“${item.message.slice(0, 100)}”: ${item.stage.replaceAll("_", " ")}${item.status === "awaiting_answers" ? ` (${item.questions.filter((q) => !q.answer).length} question(s) waiting for you)` : ""}.`,
            ),
            ...other.map(
              (item) => `“${item.title}”: ${item.phase || item.status}.`,
            ),
          ].join("\n") ||
          "No assistant work is currently running. Your task board keeps saved tasks and results.";
        outcome = { type: "status_read", active: active.length + other.length };
      } else if (
        (match = /^(?:add|create)(?: a)? task(?: called| to)?\s+(.+)$/i.exec(
          input,
        ))
      ) {
        access();
        const item = await taskRoute("POST", "/api/task-board/items", {
          title: match[1],
          ...(body.requestId ? { requestId: body.requestId } : {}),
        });
        reply = `Added “${item.title}” to your task board.`;
        outcome = { type: "task_created", id: item.id };
      } else if (
        (match = /^(?:complete|finish|tick off) (?:the )?task\s+(.+)$/i.exec(
          input,
        )) ||
        (match = /^mark (?:the )?task\s+(.+?) (?:as )?(?:done|complete)$/i.exec(
          input,
        ))
      ) {
        access();
        const item = selected(tasks(), match[1], "task"),
          result = await taskRoute(
            "PATCH",
            `/api/task-board/items/${encoded(item.id)}`,
            { completed: true },
          );
        reply = `Marked “${result.title}” complete on your board.${result.sourceStatus && result.sourceStatus !== "completed" ? ` Its underlying ${result.sourceKind} is still ${result.sourceStatus.replaceAll("_", " ")}; ticking the card does not stop or finish that work.` : ""}`;
        outcome = { type: "task_completed", id: item.id };
      } else if (
        (match = /^(?:delete|remove) (?:the )?task\s+(.+)$/i.exec(input))
      ) {
        access();
        const item = selected(tasks(), match[1], "task");
        await taskRoute("DELETE", `/api/task-board/items/${encoded(item.id)}`);
        reply = `Removed “${item.title}” from your board. Project files and task history are preserved.`;
        outcome = { type: "task_removed", id: item.id };
      } else if (
        (match = /^rename (?:the )?task\s+(.+?) to (.+)$/i.exec(input))
      ) {
        access();
        const item = selected(tasks(), match[1], "task"),
          result = await taskRoute(
            "PATCH",
            `/api/task-board/items/${encoded(item.id)}`,
            { title: match[2] },
          );
        reply = `Renamed the task card to “${result.title}”.`;
        outcome = { type: "task_updated", id: item.id };
      } else if (
        /^(?:clear|clean up|remove) (?:the )?(?:completed|finished|done) tasks$/i.test(
          input,
        )
      ) {
        access();
        const result = await taskRoute(
          "POST",
          "/api/task-board/cleanup-completed",
        );
        reply = `Cleared ${result.removed} completed task card(s). Files and underlying task history are preserved.`;
        outcome = { type: "tasks_cleaned", ...result };
      } else if (
        /^(?:show|list|read)(?: me)? (?:my |the )?(?:routines|alarms|reminders|routine board)$/i.test(
          input,
        )
      ) {
        access();
        const items = routines();
        reply = items.length
          ? items
              .slice(0, 30)
              .map(
                (item) =>
                  `• ${item.title}: ${item.time} (${item.timeZone}), ${item.enabled ? "enabled" : "paused"}${item.kind === "alarm" ? "; Android alarm scheduling must be confirmed on the phone" : ""}.`,
              )
              .join("\n")
          : "You have no saved routines.";
        outcome = { type: "routines_listed", count: items.length };
      } else if (
        (match =
          /^(?:create|add)(?: a)? routine(?: called)?\s+(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s+(every day|daily|on weekdays|on weekends))?$/i.exec(
            input,
          )) ||
        (match =
          /^remind me to\s+(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(every day|daily|on weekdays|on weekends)$/i.exec(
            input,
          ))
      ) {
        access();
        const time = clockTime(match[2]);
        if (!time)
          throw new ApiError(
            400,
            "Use a clear reminder time, such as 07:30 or 7:30 am.",
          );
        const cadence = (match[3] || "daily").toLowerCase();
        const item = await taskRoute("POST", "/api/routines", {
          title: match[1],
          details: "",
          kind: "reminder",
          time,
          timeZone: body.timeZone || hostTimeZone(),
          weekdays:
            cadence === "on weekdays"
              ? [1, 2, 3, 4, 5]
              : cadence === "on weekends"
                ? [0, 6]
                : [0, 1, 2, 3, 4, 5, 6],
          enabled: true,
          targetDeviceId: null,
          ...(body.requestId ? { requestId: body.requestId } : {}),
        });
        reply = ready(item);
        outcome = { type: "routine_created", id: item.id };
      } else if (
        (match =
          /^(?:set|create|add)(?: a| an)? (morning )?alarm(?: for| at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s+(every day|daily|on weekdays|on weekends))?$/i.exec(
            input,
          ))
      ) {
        access();
        if (principal.kind !== "device")
          throw new ApiError(
            409,
            "Choose the target phone in the Routines board before creating an alarm, or ask on that phone.",
          );
        const time = clockTime(match[2]);
        if (!time)
          throw new ApiError(
            400,
            "Use a clear alarm time, such as 07:00 or 7 am.",
          );
        const cadence = (match[3] || "daily").toLowerCase();
        const item = await taskRoute("POST", "/api/routines", {
          title: match[1] ? "Morning alarm" : "Alarm",
          details: "Requested by voice or chat",
          kind: "alarm",
          time,
          timeZone: body.timeZone || hostTimeZone(),
          weekdays:
            cadence === "on weekdays"
              ? [1, 2, 3, 4, 5]
              : cadence === "on weekends"
                ? [0, 6]
                : [0, 1, 2, 3, 4, 5, 6],
          enabled: true,
          targetDeviceId: principal.id,
          ...(body.requestId ? { requestId: body.requestId } : {}),
        });
        reply = ready(item);
        outcome = { type: "routine_created", id: item.id };
      } else if (
        (match =
          /^(?:complete|finish|tick off) (?:the )?(?:routine|reminder)\s+(.+)$/i.exec(
            input,
          ))
      ) {
        access();
        const item = selected(routines(), match[1], "routine");
        const pending = this.host.boards
          .routineState(principal)
          .occurrences.filter(
            (occurrence) =>
              occurrence.routineId === item.id &&
              occurrence.status === "pending",
          )
          .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))[0];
        if (!pending)
          throw new ApiError(
            409,
            `“${item.title}” has no pending reminder occurrence to complete. Its future schedule is unchanged.`,
          );
        await taskRoute(
          "POST",
          `/api/routines/occurrences/${encoded(pending.id)}/ack`,
        );
        reply = `Marked the latest reminder for “${item.title}” complete. Its future schedule is unchanged.`;
        outcome = {
          type: "routine_completed",
          id: item.id,
          occurrenceId: pending.id,
        };
      } else if (
        (match =
          /^(?:delete|remove) (?:the )?(?:routine|alarm|reminder)\s+(.+)$/i.exec(
            input,
          ))
      ) {
        access();
        const item = selected(routines(), match[1], "routine");
        await taskRoute("DELETE", `/api/routines/${item.id}`);
        reply = `Removed routine “${item.title}”. Sync the Android app to cancel its saved alarm schedule; cancellation is not confirmed until the phone syncs.`;
        outcome = { type: "routine_removed", id: item.id };
      } else if (
        (match =
          /^(pause|disable|resume|enable) (?:the )?(?:routine|alarm|reminder)\s+(.+)$/i.exec(
            input,
          ))
      ) {
        access();
        const item = selected(routines(), match[2], "routine"),
          enabled = /^(resume|enable)$/i.test(match[1]);
        await taskRoute("PATCH", `/api/routines/${item.id}`, { enabled });
        reply = `${enabled ? "Enabled" : "Paused"} routine “${item.title}”.${item.kind === "alarm" ? " Sync the Android app to update its alarm schedule; this receipt does not confirm that phone update." : ""}`;
        outcome = { type: "routine_updated", id: item.id };
      } else if (
        (match =
          /^(?:change|update|move) (?:the )?(?:routine|alarm|reminder)\s+(.+?) to\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i.exec(
            input,
          ))
      ) {
        access();
        const item = selected(routines(), match[1], "routine"),
          time = clockTime(match[2]);
        if (!time) throw new ApiError(400, "Use a clear routine time.");
        const result = await taskRoute("PATCH", `/api/routines/${item.id}`, {
          time,
        });
        reply = ready(result);
        outcome = { type: "routine_updated", id: item.id };
      } else if (
        /^(?:(?:what(?:'s| is) (?:the )?)?weather (?:here|near me)|(?:show|open)(?: a| the)? map (?:here|near me|of my location))$/i.test(
          input,
        )
      ) {
        access();
        const records = this.host.locations
          .public(principal)
          .filter((item) => item.enabled && item.lastKnown)
          .sort((a, b) =>
            b.lastKnown.observedAt.localeCompare(a.lastKnown.observedAt),
          );
        if (principal.kind === "owner" && records.length > 1)
          throw new ApiError(
            409,
            "Several phones have shared locations. Ask on the intended phone, or select its location in Devices.",
          );
        const location = records[0];
        if (!location)
          throw new ApiError(
            409,
            "No location is shared. Enable location sharing on this phone and send a fix first.",
          );
        const point = `${location.lastKnown.latitude},${location.lastKnown.longitude}`,
          weather = /weather/i.test(input),
          url = weather
            ? `https://www.google.com/search?q=${encodeURIComponent(`current weather at ${point}`)}`
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point)}`;
        reply = `Using the saved location observed ${location.lastKnown.observedAt} (accuracy about ${Math.round(location.lastKnown.accuracy)} metres). ${weather ? "Open this weather lookup; no live weather was fetched" : "Open this map; no navigation was started"}: ${url}`;
        outcome = {
          type: weather ? "weather_lookup" : "map_link",
          url,
          observedAt: location.lastKnown.observedAt,
        };
      } else if (
        /^(?:find my phone|where is my phone|(?:show|read)(?: me)? (?:my )?phone location)$/i.test(
          input,
        )
      ) {
        access();
        const records = this.host.locations
          .public(principal)
          .filter((item) => item.enabled && item.lastKnown)
          .sort((a, b) =>
            b.lastKnown.observedAt.localeCompare(a.lastKnown.observedAt),
          );
        const location = records[0];
        reply = location
          ? `Last known location of ${this.host.device(location.deviceId).name}: ${location.lastKnown.latitude}, ${location.lastKnown.longitude}. Observed ${location.lastKnown.observedAt}, accuracy about ${Math.round(location.lastKnown.accuracy)} metres. This is a saved location, not a new live fix.`
          : "No shared phone location is available. Enable location sharing and send a location from the intended phone.";
        outcome = { type: "location_read", available: Boolean(location) };
      } else return null;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 403) throw error;
      reply = error.message;
      outcome = { type: "needs_clarification", status: error.status };
    }
    const messageId = uid();
    await this.host.store.change((state) => {
      access();
      const locationSensitive = [
        "location_read",
        "weather_lookup",
        "map_link",
      ].includes(outcome.type);
      state.messages.push(
        {
          id: uid(),
          role: "user",
          projectId: body.projectId || null,
          content: skillTeaching
            ? "Explicit skill teaching request. Saved steps are inspectable in the Skills library; teaching content is not copied into chat history."
            : body.message,
          createdAt: now(),
        },
        {
          id: messageId,
          role: "assistant",
          providerId: state.config.interactionRole.providerId,
          projectId: body.projectId || null,
          kind: locationSensitive ? "location_result" : "local_result",
          ...(locationSensitive
            ? {
                locationSensitive: true,
                ...(principal.kind === "device"
                  ? { visibleToDeviceId: principal.id }
                  : { ownerOnly: true }),
              }
            : {}),
          content: reply,
          ...(outcome.type === "navigate" ? {} : { localOutcome: outcome }),
          createdAt: now(),
        },
      );
      state.messages = state.messages.slice(-500);
    });
    return { local: true, taskIds: [], reply, messageId, outcome };
  }
}
