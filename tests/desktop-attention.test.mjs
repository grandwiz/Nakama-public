import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const { createDesktopAttention } = createRequire(import.meta.url)(
  "../apps/desktop/desktop-attention.cjs",
);
test("desktop monitoring notices remain generic, deduplicate and reject removed attention", () => {
  const notices = [],
    opened = [];
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      this.options = options;
      notices.push(this);
    }
    show() {}
    close() {
      this.emit("close");
    }
  }
  const handler = createDesktopAttention({
    Notification,
    onOpen: (id) => opened.push(id),
  });
  const items = [
    {
      id: "monitor:m:one",
      kind: "monitor",
      title: "private product",
      url: "https://secret.example/checkout",
      password: "private",
    },
  ];
  handler.update({ items });
  handler.update({ items });
  assert.equal(notices.length, 1);
  assert.equal(JSON.stringify(notices[0].options).includes("private"), false);
  notices[0].emit("click");
  assert.deepEqual(opened, ["monitor:m:one"]);
  handler.update({ items: [] });
  notices[0].emit("click");
  assert.equal(opened.length, 1);
  handler.update({ items: [{ id: "upgrade:x", kind: "upgrade" }] });
  assert.equal(notices.length, 2);
  handler.close();
});


test("finished timer notices keep titles private and dismissed clicks cannot reopen stale records", () => {
  const notices = [], opened = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; notices.push(this); }
    show() {}
    close() { this.emit("close"); }
  }
  const handler = createDesktopAttention({ Notification, onOpen: (id) => opened.push(id) });
  const items = [{ id: "timer:fixture", kind: "timer", title: "PRIVATE_MEDICATION" }];
  handler.update({ items }); handler.update({ items });
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].options, { title: "A Nakama timer has finished", body: "Open Clock to dismiss your timer.", silent: false });
  notices[0].emit("click");
  assert.deepEqual(opened, ["timer:fixture"]);
  handler.update({ items: [] }); notices[0].emit("click");
  assert.equal(opened.length, 1);
  handler.close();
});
