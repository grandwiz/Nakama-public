import test from "node:test";
import assert from "node:assert/strict";
import {
  resultDataDigest,
  trimScreenshotResults,
  sanitizeActionResultData,
} from "../apps/host/action-results.mjs";
import { boundedJson } from "../apps/host/security.mjs";

// Actual 2x2 JPEG captured by disposable Chromium from a locally generated blue page.
const chromiumJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJcA7Hn/2Q==",
  "base64",
);
const tokenBytes = Buffer.from("AIza" + "A".repeat(28), "base64");
// COM is valid opaque JPEG metadata. Alignment makes its base64 match the
// text credential regex, even though the image contains no real credential.
const commentedJpeg = Buffer.concat([
  chromiumJpeg.subarray(0, 2),
  Buffer.from([0xff, 0xfe, 0, 63]),
  tokenBytes,
  Buffer.alloc(37, 0xff),
  chromiumJpeg.subarray(2),
]);
const captureData = (bytes) => ({
  kind: "browser_screenshot",
  mimeType: "image/jpeg",
  dataUrl: "data:image/jpeg;base64," + bytes.toString("base64"),
  width: 2,
  height: 2,
  url: "https://example.test/page",
  title: "Fixture API_KEY=metadata-secret",
  capturedAt: "2026-09-29T12:00:00.000Z",
});

test("validated screenshot bytes survive credential-like JPEG base64 while metadata is redacted", () => {
  const data = captureData(commentedJpeg);
  assert.match(data.dataUrl, /\bAIza[\w-]{20,}\b/);
  assert.notEqual(
    boundedJson(data).dataUrl,
    data.dataUrl,
    "fixture must reproduce the old corruption",
  );
  const cleaned = sanitizeActionResultData(
    { type: "browser_screenshot" },
    data,
  );
  assert.equal(cleaned.dataUrl, data.dataUrl);
  assert.deepEqual(
    Buffer.from(cleaned.dataUrl.split(",")[1], "base64"),
    commentedJpeg,
  );
  assert.equal(cleaned.title, "Fixture API_KEY=[redacted]");
  assert.equal(data.title, "Fixture API_KEY=metadata-secret");
  assert.equal(
    resultDataDigest(cleaned),
    resultDataDigest(
      sanitizeActionResultData(
        { type: "browser_screenshot" },
        Object.fromEntries(Object.entries(data).reverse()),
      ),
    ),
  );
});

test("the opaque image exception is limited to actual screenshot actions and ordinary results still redact", () => {
  const data = captureData(commentedJpeg);
  const ordinary = sanitizeActionResultData({ type: "browser_read" }, data);
  assert.equal(ordinary.dataUrl, boundedJson(data).dataUrl);
  assert.deepEqual(
    sanitizeActionResultData(
      { type: "browser_read" },
      { text: "API_KEY=secret" },
    ),
    { text: "API_KEY=[redacted]" },
  );
  assert.equal(
    sanitizeActionResultData({ type: "browser_screenshot" }, undefined),
    undefined,
  );
});

test("screenshot sanitizer rejects malformed or mismatched JPEGs and oversized/untrusted metadata", () => {
  const data = captureData(chromiumJpeg),
    action = { type: "browser_screenshot" };
  assert.equal(sanitizeActionResultData(action, data).dataUrl, data.dataUrl);
  const invalidBytes = [
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    chromiumJpeg.subarray(0, -1),
    Buffer.concat([chromiumJpeg, Buffer.from("trailing")]),
    Buffer.from(chromiumJpeg),
  ];
  invalidBytes.at(-1)[4] = 0xff;
  invalidBytes.at(-1)[5] = 0xff; // Truncated APP segment.
  for (const bytes of invalidBytes)
    assert.throws(() => sanitizeActionResultData(action, captureData(bytes)), {
      status: 400,
    });
  for (const changed of [
    { width: 3 },
    { mimeType: "image/png" },
    { dataUrl: "data:image/jpeg;base64,YmFk" },
    { dataUrl: data.dataUrl + "=" },
    { dataUrl: "data:image/jpeg;base64," + "A".repeat(230000) },
    { url: "https://name:password@example.test/" },
    { url: "file:///secret" },
    { capturedAt: "not a date" },
    { title: "x".repeat(501) },
    { extraDataUrl: "not permitted" },
  ])
    assert.throws(
      () => sanitizeActionResultData(action, { ...data, ...changed }),
      { status: 400 },
    );
});

const screenshot = (index, extra = {}) => ({
  id: `capture-${index}`,
  deviceId: index % 2 ? "chrome-a" : "chrome-b",
  type: "browser_screenshot",
  status: "completed",
  result: `Captured ${index}.`,
  createdAt: new Date(Date.UTC(2026, 8, 29, 12, index)).toISOString(),
  completedAt: new Date(Date.UTC(2026, 8, 29, 12, index, 10)).toISOString(),
  resultData: {
    kind: "browser_screenshot",
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,capture${index}`,
    width: 1280,
    height: 720,
    url: "https://example.test/page",
    title: `Page ${index}`,
    capturedAt: "2026-09-29T12:00:00.000Z",
  },
  ...extra,
});

test("canonical result digests ignore nested object key order but preserve values and array order", () => {
  const a = { z: [{ b: 2, a: "é" }, true], a: null };
  const b = { a: null, z: [{ a: "é", b: 2 }, true] };
  assert.match(resultDataDigest(a), /^[0-9a-f]{64}$/);
  assert.equal(resultDataDigest(a), resultDataDigest(b));
  assert.notEqual(
    resultDataDigest(a),
    resultDataDigest({ a: null, z: [true, { a: "é", b: 2 }] }),
  );
  assert.notEqual(resultDataDigest(a), resultDataDigest({ ...a, added: true }));
  assert.notEqual(
    resultDataDigest({ a: "ab", b: "c" }),
    resultDataDigest({ a: "a", b: "bc" }),
  );
  assert.equal(
    resultDataDigest({ b: -0, a: 1 }),
    resultDataDigest({ a: 1, b: 0 }),
  );
});

test("absent result data remains distinct from null, strings and empty containers", () => {
  const values = [undefined, null, "undefined", "null", {}, [], "", false, 0];
  assert.equal(new Set(values.map(resultDataDigest)).size, values.length);
  assert.equal(resultDataDigest(undefined), resultDataDigest(undefined));
});

test("digest bounds reject invalid and oversized JSON without trusting conversion hooks", () => {
  for (const value of [
    { field: undefined },
    [undefined],
    NaN,
    Infinity,
    1n,
    new Date(),
    {
      toJSON() {
        return "hidden";
      },
    },
    "x".repeat(256 * 1024),
  ])
    assert.throws(() => resultDataDigest(value));
  let deep = null;
  for (let i = 0; i < 32; i++) deep = { child: deep };
  assert.throws(() => resultDataDigest(deep), /nested/);
});

test("retention keeps newest ten screenshots total across devices and preserves status, message and metadata", () => {
  const actions = Array.from({ length: 14 }, (_, i) => screenshot(i));
  const originals = structuredClone(actions);
  assert.equal(trimScreenshotResults(actions), 4);
  assert.equal(actions.filter((a) => a.resultData).length, 10);
  for (let i = 0; i < 14; i++) {
    assert.equal(actions[i].id, originals[i].id);
    assert.equal(actions[i].deviceId, originals[i].deviceId);
    assert.equal(actions[i].status, "completed");
    assert.equal(actions[i].result, originals[i].result);
    if (i >= 4) {
      assert.deepEqual(actions[i], originals[i]);
      continue;
    }
    assert.equal(actions[i].resultData, undefined);
    assert.equal(actions[i].resultDataOmitted, true);
    assert.equal(
      actions[i].dataDigest,
      resultDataDigest(originals[i].resultData),
    );
    assert.deepEqual(actions[i].resultDataMetadata, {
      mimeType: "image/jpeg",
      url: "https://example.test/page",
      title: `Page ${i}`,
      capturedAt: "2026-09-29T12:00:00.000Z",
      width: 1280,
      height: 720,
    });
  }
  assert.equal(trimScreenshotResults(actions), 0);
  actions.push(screenshot(20));
  assert.equal(trimScreenshotResults(actions), 1);
  assert.equal(actions[4].resultDataOmitted, true);
  assert.ok(actions.at(-1).resultData);
});

test("pruned screenshot acknowledgements can compare canonical digest without accepting altered pixels", () => {
  const action = screenshot(1),
    original = structuredClone(action.resultData);
  action.dataDigest = "stale";
  trimScreenshotResults([action], 0);
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(action.dataDigest, resultDataDigest(reordered));
  assert.notEqual(
    action.dataDigest,
    resultDataDigest({ ...original, dataUrl: original.dataUrl + "changed" }),
  );
  assert.notEqual(
    action.dataDigest,
    resultDataDigest({ ...original, url: "https://other.test" }),
  );
  assert.notEqual(action.dataDigest, resultDataDigest(undefined));
});

test("pending screenshots, unrelated action data and malformed screenshot markers are untouched", () => {
  const unrelated = [
    screenshot(0, { status: "pending" }),
    screenshot(1, { status: "dispatched" }),
    screenshot(2, { type: "browser_read" }),
    screenshot(3, { resultData: { kind: "other", text: "Keep me" } }),
    {
      id: "phone",
      type: "contacts_search",
      status: "completed",
      resultData: { contacts: ["Mike"] },
    },
  ];
  const before = structuredClone(unrelated),
    actions = [...unrelated, screenshot(4)];
  assert.equal(trimScreenshotResults(actions, 0), 1);
  assert.deepEqual(unrelated, before);
});

test("retention sorts by completion then creation time with deterministic insertion-order ties", () => {
  const actions = [screenshot(20), screenshot(1), screenshot(15)];
  trimScreenshotResults(actions, 1);
  assert.ok(actions[0].resultData);
  assert.equal(actions[1].resultDataOmitted, true);
  const fallback = [
    screenshot(1, { completedAt: "bad" }),
    screenshot(2, { completedAt: undefined }),
  ];
  trimScreenshotResults(fallback, 1);
  assert.ok(fallback[1].resultData);
  const ties = [
    screenshot(1, { completedAt: undefined, createdAt: undefined }),
    screenshot(2, { completedAt: undefined, createdAt: undefined }),
  ];
  trimScreenshotResults(ties, 1);
  assert.ok(ties[1].resultData);
  assert.equal(ties[0].resultDataOmitted, true);
});

test("metadata whitelist cannot retain hidden image properties and invalid input cannot partially prune", () => {
  const a = screenshot(1);
  Object.assign(a.resultData, {
    extraImage: "large-secret",
    nested: { dataUrl: "extra-image" },
    title: "x".repeat(501),
    url: { nested: "unsafe" },
  });
  trimScreenshotResults([a], 0);
  assert.deepEqual(Object.keys(a.resultDataMetadata).sort(), [
    "capturedAt",
    "height",
    "mimeType",
    "width",
  ]);
  assert.equal(JSON.stringify(a).includes("large-secret"), false);
  assert.equal(JSON.stringify(a).includes("extra-image"), false);
  const valid = screenshot(2),
    invalid = screenshot(3);
  invalid.resultData.cycle = invalid.resultData;
  assert.throws(() => trimScreenshotResults([valid, invalid], 0));
  assert.ok(valid.resultData);
  assert.equal(valid.resultDataOmitted, undefined);
  assert.throws(() => trimScreenshotResults([], -1));
  assert.throws(() => trimScreenshotResults([], 1.5));
  assert.throws(() => trimScreenshotResults({}));
});
