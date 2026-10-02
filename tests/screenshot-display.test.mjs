import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBrowserScreenshot,
  boundedDeviceResult,
} from "../apps/desktop/renderer/src/screenshot.ts";

// Minimal JPEG header fixture. Browser decoding is verified separately with an
// actual JPEG through the native UI; this tests pre-decode shape/dimension gates.
const header = Buffer.from([
  255, 216, 255, 192, 0, 11, 8, 0, 10, 0, 20, 1, 1, 17, 0, 255, 217,
]);
const sample = {
  kind: "browser_screenshot",
  mimeType: "image/jpeg",
  dataUrl: "data:image/jpeg;base64," + header.toString("base64"),
  width: 20,
  height: 10,
  url: "https://example.test/page",
  title: "Local fixture",
  capturedAt: "2026-09-29T01:00:00.000Z",
};

test("screenshot display accepts a bounded matching JPEG header and rejects unsafe or mismatched data", () => {
  assert.equal(validateBrowserScreenshot(sample), sample);
  for (const value of [
    null,
    [],
    {},
    { ...sample, dataUrl: "https://example.test/image.jpg" },
    { ...sample, dataUrl: "data:image/svg+xml,<svg/>" },
    { ...sample, mimeType: "text/html" },
    { ...sample, width: 200 },
    { ...sample, height: 1.5 },
    { ...sample, width: 99999 },
    { ...sample, url: "javascript:alert(1)" },
    { ...sample, url: "https://user:secret@example.test/" },
    { ...sample, capturedAt: "never" },
    { ...sample, title: "x".repeat(501) },
    { ...sample, dataUrl: "data:image/jpeg;base64," + "A".repeat(230000) },
    { ...sample, dataUrl: sample.dataUrl.slice(0, -2) },
    { ...sample, dataUrl: "data:image/jpeg;base64,YmFk" },
  ])
    assert.equal(validateBrowserScreenshot(value), null);
});

test("device result fallback omits encoded images and bounds cyclic and oversized results", () => {
  const cyclic = { dataUrl: sample.dataUrl, text: "x".repeat(20000) };
  cyclic.self = cyclic;
  const output = boundedDeviceResult(cyclic);
  assert.doesNotMatch(output, /data:image|\/9j/);
  assert.match(output, /omitted|truncated/);
  assert.ok(output.length < 18080);
  const many = Object.fromEntries(
    Array.from({ length: 200 }, (_, index) => [
      "field" + index,
      "y".repeat(1600),
    ]),
  );
  assert.ok(boundedDeviceResult(many).length < 18080);
});
