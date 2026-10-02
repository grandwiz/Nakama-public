import test from "node:test";
import assert from "node:assert/strict";
import { mailPayload, calendarPayload } from "../apps/host/google.mjs";
test("email request refuses header injection and preserves unicode content", () => {
  assert.throws(() =>
    mailPayload({
      to: "a@example.com\r\nBcc: victim@example.com",
      subject: "hello",
      body: "text",
    }),
  );
  assert.throws(() =>
    mailPayload({
      to: "a@example.com",
      subject: "hello\r\nBcc: victim@example.com",
      body: "text",
    }),
  );
  const mime = Buffer.from(
    mailPayload({
      to: "a@example.com",
      subject: "Appointment £10",
      body: "Tuesday at 3pm",
    }).raw,
    "base64url",
  ).toString();
  assert.match(mime, /To: a@example.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.ok(mime.endsWith(Buffer.from("Tuesday at 3pm").toString("base64")));
});
test("calendar creation requires timezone and ordered dates", () => {
  assert.throws(() =>
    calendarPayload({
      summary: "Dentist",
      start: "2026-10-01T15:00",
      end: "2026-10-01T16:00",
    }),
  );
  assert.throws(() =>
    calendarPayload({
      summary: "Dentist",
      start: "2026-10-01T15:00:00Z",
      end: "2026-10-01T14:00:00Z",
    }),
  );
  assert.equal(
    calendarPayload({
      summary: "Dentist",
      start: "2026-10-01T15:00:00+01:00",
      end: "2026-10-01T16:00:00+01:00",
    }).start.dateTime,
    "2026-10-01T14:00:00.000Z",
  );
});
