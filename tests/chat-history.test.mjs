import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, initialState } from "../apps/host/store.mjs";
import {
  ChatHistory,
  syncChatHistory,
  CHAT_WINDOW_MS,
  CHAT_CONTEXT_LIMIT,
} from "../apps/host/chat-history.mjs";
import { NakamaHost } from "../apps/host/host.mjs";
const owner = { kind: "owner", id: "desktop" };
const phone = { kind: "device", id: "phone" },
  tablet = { kind: "device", id: "tablet" };
const epoch = Date.parse("2026-10-03T08:00:00Z");
function fixture() {
  let at = epoch;
  const state = initialState();
  state.devices = [phone, tablet].map((p) => ({
    id: p.id,
    platform: "android",
    permissions: { projectAccess: true, googleAccess: true },
  }));
  const host = {
    store: {
      state,
      async change(fn) {
        const value = await fn(state);
        syncChatHistory(state, new Date(at));
        return value;
      },
    },
  };
  const chats = new ChatHistory(host, { clock: () => new Date(at) });
  const add = (id, content = "A conversation", extra = {}) =>
    state.messages.push({
      id,
      content,
      role: "user",
      createdAt: new Date(at).toISOString(),
      deliveryDeviceId: "phone",
      ...extra,
    });
  return {
    state,
    host,
    chats,
    add,
    sync: () => syncChatHistory(state, new Date(at)),
    setTime: (value) => (at = value),
  };
}
test("six-hour windows archive originals and local summaries once without moving current chat", async () => {
  const f = fixture();
  f.add("first", "Original request");
  f.sync();
  f.setTime(epoch + CHAT_WINDOW_MS - 1);
  await f.chats.rotate();
  assert.equal(f.state.messages.length, 1);
  f.setTime(epoch + CHAT_WINDOW_MS);
  f.add("second", "Fresh request");
  f.sync();
  assert.deepEqual(
    f.state.messages.map((m) => m.id),
    ["second"],
  );
  const old = f.state.chatHistory.chats[0];
  assert.equal(old.status, "archived");
  assert.match(old.summary, /Original request/);
  assert.equal(old.messages[0].id, "first");
  const revision = old.revision;
  await f.chats.rotate();
  assert.equal(old.revision, revision);
  assert.equal(
    (await f.chats.route("GET", `/api/chats/${old.id}`, {}, phone)).messages
      .length,
    1,
  );
});
test("active work and a fresh unanswered question survive rotation and cannot be explicitly completed", async () => {
  const f = fixture();
  f.state.tasks.push({
    id: "work",
    mode: "act",
    status: "running",
    requestedBy: "phone",
  });
  f.add("request", "Create something", { taskIds: ["work"] });
  f.sync();
  f.setTime(epoch + CHAT_WINDOW_MS + 1);
  await f.chats.rotate();
  const chat = f.state.chatHistory.chats[0];
  assert.equal(chat.status, "active");
  await assert.rejects(
    f.chats.route(
      "POST",
      `/api/chats/${chat.id}/complete`,
      { revision: chat.revision },
      phone,
    ),
    { status: 409 },
  );
  f.add("question", "Which time?", {
    role: "assistant",
    localOutcome: { type: "needs_clarification" },
  });
  f.sync();
  f.setTime(epoch + 2 * CHAT_WINDOW_MS);
  f.add("newquestion", "Which date?", {
    role: "assistant",
    chatId: f.state.messages.at(-1).chatId,
    localOutcome: { type: "needs_clarification" },
  });
  f.sync();
  assert.equal(f.state.messages.at(-1).id, "newquestion");
});
test("successful act work closes with final receipt retained; discuss answers remain visible", async () => {
  const f = fixture();
  f.state.tasks.push({
    id: "work",
    mode: "act",
    status: "running",
    requestedBy: "phone",
  });
  f.add("request", "Create something", { taskIds: ["work"] });
  f.add("ack", "Working", {
    role: "assistant",
    kind: "task_ack",
    taskIds: ["work"],
  });
  f.sync();
  f.state.tasks[0].status = "completed";
  f.sync();
  assert.equal(f.state.chatHistory.chats[0].status, "active");
  f.add("final", "Created", { role: "assistant", taskId: "work" });
  f.sync();
  assert.equal(f.state.messages.length, 0);
  const result = await f.chats.route(
    "POST",
    "/api/chats/receipts",
    { taskIds: ["work"] },
    phone,
  );
  assert.deepEqual(
    result.messages.map((m) => m.id),
    ["request", "ack", "final"],
  );
  assert.deepEqual(
    (
      await f.chats.route(
        "POST",
        "/api/chats/receipts",
        { taskIds: ["work"] },
        tablet,
      )
    ).messages,
    [],
  );
  assert.deepEqual(
    (
      await f.chats.route(
        "POST",
        "/api/chats/receipts",
        { taskIds: ["work"] },
        owner,
      )
    ).messages,
    [],
  );
  f.state.tasks.push({
    id: "discuss",
    mode: "discuss",
    status: "completed",
    requestedBy: "phone",
  });
  f.add("talk", "Hi", { taskId: "discuss", role: "assistant" });
  f.sync();
  assert.equal(f.state.messages[0].id, "talk");
});
test("archive search includes raw omitted middle text and respects device isolation", async () => {
  const f = fixture();
  f.add("first");
  for (let i = 0; i < 10; i++)
    f.add(
      `middle${i}`,
      i === 1 ? "padding ".repeat(180) + "UNIQUE raw needle" : `note ${i}`,
    );
  f.sync();
  f.setTime(epoch + CHAT_WINDOW_MS);
  await f.chats.rotate();
  assert.doesNotMatch(f.state.chatHistory.chats[0].summary, /UNIQUE/);
  assert.equal(
    (await f.chats.route("GET", "/api/chats?q=unique%20RAW", {}, phone)).chats
      .length,
    1,
  );
  assert.equal(
    (await f.chats.route("GET", "/api/chats?q=UNIQUE", {}, tablet)).chats
      .length,
    0,
  );
  await assert.rejects(
    f.chats.route(
      "GET",
      `/api/chats/${f.state.chatHistory.chats[0].id}`,
      {},
      tablet,
    ),
    { status: 404 },
  );
  f.state.devices[0].permissions.googleAccess = false;
  await assert.rejects(
    f.chats.route(
      "POST",
      "/api/chats/receipts",
      { messageIds: ["first"] },
      phone,
    ),
    { status: 403 },
  );
});
test("explicit completion uses revision and late delivered work does not vanish", async () => {
  const f = fixture();
  f.add("first");
  f.sync();
  const chat = f.state.chatHistory.chats[0];
  const revision = chat.revision;
  f.add("second");
  f.sync();
  await assert.rejects(
    f.chats.route(
      "POST",
      `/api/chats/${chat.id}/complete`,
      { revision },
      phone,
    ),
    { status: 409 },
  );
  await f.chats.route(
    "POST",
    `/api/chats/${chat.id}/complete`,
    { revision: chat.revision },
    phone,
  );
  assert.equal(f.state.messages.length, 0);
  f.add("late", "Late answer", { role: "assistant", chatId: chat.id });
  f.sync();
  assert.equal(chat.messages.length, 3);
  assert.match(chat.summary, /Late answer/);
  f.state.tasks.push({
    id: "resume",
    mode: "act",
    status: "running",
    requestedBy: "phone",
    chatId: chat.id,
  });
  f.add("resumeMsg", "Resumed", { taskId: "resume", chatId: chat.id });
  f.sync();
  assert.equal(chat.status, "active");
  assert.equal(f.state.messages.length, 4);
});
test("context is bounded, project+origin scoped, excludes raw archives and honours memory off", async () => {
  const f = fixture();
  f.add("first", "visible extract");
  for (let i = 0; i < 15; i++)
    f.add(
      `old${i}`,
      i === 2 ? "x".repeat(4000) + "RAW_MIDDLE_NEVER_INJECT" : "x".repeat(4000),
    );
  f.add("private", "LOCATION_PRIVATE", { locationSensitive: true });
  f.sync();
  f.setTime(epoch + CHAT_WINDOW_MS);
  await f.chats.rotate();
  f.add("foreign", "OTHER_PHONE_PRIVATE", { deliveryDeviceId: "tablet" });
  f.add("project", "OTHER_PROJECT_PRIVATE", { projectId: "separate" });
  for (let i = 0; i < 20; i++) f.add(`recent${i}`, "y".repeat(4000));
  f.sync();
  const context = f.chats.context(phone);
  assert.ok(context.length <= CHAT_CONTEXT_LIMIT);
  assert.match(context, /untrusted historical/);
  assert.doesNotMatch(
    context,
    /RAW_MIDDLE_NEVER_INJECT|LOCATION_PRIVATE|OTHER_PHONE_PRIVATE|OTHER_PROJECT_PRIVATE/,
  );
  assert.equal(f.chats.context(owner), "");
  f.state.config.memoryEnabled = false;
  assert.equal(f.chats.context(phone), "");
  f.setTime(epoch + 2 * CHAT_WINDOW_MS);
  await f.chats.rotate();
  assert.equal(f.state.messages.length, 0);
});
test("archive state and summaries rollback together on failed save and persist across restart", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-chat-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let at = epoch;
  const store = await new Store(dir, { clock: () => new Date(at) }).init();
  await store.change((s) =>
    s.messages.push({
      id: "persist",
      role: "user",
      content: "preserve original",
      createdAt: new Date(epoch).toISOString(),
    }),
  );
  at += CHAT_WINDOW_MS;
  const save = store.save;
  store.save = async () => {
    throw Error("disk unavailable");
  };
  await assert.rejects(
    store.change(() => {}),
    /disk unavailable/,
  );
  assert.equal(store.state.messages.length, 1);
  assert.equal(store.state.chatHistory.chats[0].status, "active");
  store.save = save;
  await store.change(() => {});
  const recovered = await new Store(dir, { clock: () => new Date(at) }).init();
  assert.equal(recovered.state.messages.length, 0);
  assert.equal(
    recovered.state.chatHistory.chats[0].messages[0].content,
    "preserve original",
  );
  assert.match(
    recovered.state.chatHistory.chats[0].summary,
    /preserve original/,
  );
});
test("real chat provider path receives bounded local archive context with no summary model call", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-chat-host-"));
  let at = epoch;
  const calls = [];
  const host = await new NakamaHost({
    dataDir: dir,
    boardClock: () => new Date(at),
    runAgent: async (provider, options) => {
      calls.push(options.prompt);
      options.onComplete({ code: 0, text: "Fixture reply" });
      return { stop() {} };
    },
  }).init();
  t.after(async () => {
    await host.close();
    await host.store.queue;
    await fs.rm(dir, { recursive: true, force: true });
  });
  await host.store.change((s) => {
    s.messages.push({
      id: "a",
      role: "user",
      content: "remember archive context",
      createdAt: new Date(at).toISOString(),
    });
    for (let i = 0; i < 15; i++)
      s.messages.push({
        id: `m${i}`,
        role: "assistant",
        content:
          i === 1
            ? "old bounded text ".repeat(100) + "RAW_MIDDLE_ONLY"
            : "old bounded text",
        createdAt: new Date(at).toISOString(),
      });
  });
  at += CHAT_WINDOW_MS;
  await host.dispatch("GET", "/api/state");
  await host.dispatch("POST", "/api/chat", { message: "Hello with context" });
  for (let i = 0; i < 100 && !calls.length; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /remember archive context/);
  assert.doesNotMatch(calls[0], /RAW_MIDDLE_ONLY/);
});

test("a successfully repaired workflow closes despite terminal failed historical children", async () => {
  const f = fixture();
  f.state.projectWorkflows.push({
    id: "workflow",
    status: "running",
    requestedBy: "phone",
  });
  f.state.tasks.push(
    {
      id: "failed-attempt",
      workflowId: "workflow",
      status: "failed",
      requestedBy: "phone",
    },
    {
      id: "repair",
      workflowId: "workflow",
      status: "running",
      requestedBy: "phone",
    },
  );
  f.add("request", "Build the project", { workflowId: "workflow" });
  f.add("failed-message", "Earlier attempt failed", {
    taskId: "failed-attempt",
    role: "assistant",
    pipelineIntermediate: true,
  });
  f.add("repair-message", "Repair started", {
    taskId: "repair",
    role: "assistant",
    pipelineIntermediate: true,
  });
  f.sync();
  f.state.projectWorkflows[0].status = "completed";
  f.add("delivery", "Project completed after repair", {
    workflowId: "workflow",
    role: "assistant",
    kind: "project_delivery",
  });
  f.sync();
  assert.equal(
    f.state.chatHistory.chats[0].status,
    "active",
    "Even a completed coordinator must retain still-running child work",
  );
  f.state.tasks[1].status = "completed";
  f.sync();
  assert.equal(f.state.chatHistory.chats[0].status, "completed");
  assert.equal(f.state.messages.length, 0);
  const receipts = await f.chats.route(
    "POST",
    "/api/chats/receipts",
    { workflowIds: ["workflow"] },
    phone,
  );
  assert.equal(receipts.messages.at(-1).id, "delivery");
});

test("representative extracts retain an important middle request and outcome across a long window", async () => {
  const f = fixture();
  for (let i = 0; i < 36; i++) {
    f.add(
      `user-${i}`,
      i === 17
        ? "Important decision: the launch deadline is Friday and the package must remain offline."
        : `Discuss the weather again, conversation ${i}.`,
    );
    f.add(
      `reply-${i}`,
      i === 17
        ? "Saved the Friday deadline and offline packaging requirement for the launch."
        : "That is another routine weather discussion.",
      { role: "assistant" },
    );
  }
  f.sync();
  f.setTime(epoch + CHAT_WINDOW_MS);
  await f.chats.rotate();
  const summary = f.state.chatHistory.chats[0].summary;
  assert.match(summary, /36 turns/);
  assert.match(summary, /Friday/);
  assert.match(summary, /offline packaging requirement/);
  assert.ok(summary.length <= 1800);
  assert.match(summary, /conversation 0/);
  assert.match(summary, /conversation 3[0-5]/);
  assert.match(f.chats.context(phone), /Friday/);
  assert.ok(f.chats.context(phone).length <= CHAT_CONTEXT_LIMIT);
});


test("an idle six-hour chat rotates on the next state refresh without a user message or model call", async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"nakama-idle-chat-"));
  let at=epoch, calls=0;
  const host=await new NakamaHost({dataDir:dir,boardClock:()=>new Date(at),runAgent:async()=>{calls++;throw Error("No model expected");}}).init();
  t.after(async()=>{await host.close();await host.store.queue;await fs.rm(dir,{recursive:true,force:true});});
  await host.store.change(s=>s.messages.push({id:"idle-original",role:"user",content:"Keep the complete original",createdAt:new Date(at).toISOString()}));
  at+=CHAT_WINDOW_MS;
  const state=await host.dispatch("GET","/api/state");
  assert.deepEqual(state.messages,[]);
  const chat=state.chatHistory.chats[0];
  assert.equal(chat.status,"archived");
  assert.match(chat.summary,/complete original/);
  const archive=await host.dispatch("GET","/api/chats/"+chat.id);
  assert.equal(archive.messages[0].content,"Keep the complete original");
  assert.equal(calls,0);
});
