import { createHash } from "node:crypto";
import { ApiError, boundedJson } from "./security.mjs";

const MAX_DATA_BYTES = 256 * 1024;

// Accept the bounded baseline JPEG format produced by Chrome's canvas encoder.
// Validate the complete marker/scan structure rather than trusting a MIME label
// or a SOF header with no image data. This does not decode or inspect the pixels.
function jpegDimensions(bytes) {
  if (bytes.length < 20 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2,
    frame,
    restartInterval = 0;
  const quantization = new Set(),
    huffman = new Set();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset),
      end = offset + length;
    if (length < 2 || end > bytes.length) return null;
    let cursor = offset + 2;
    if (marker === 0xc0) {
      const count = bytes[cursor + 5];
      if (
        frame ||
        length !== 8 + 3 * count ||
        ![1, 3].includes(count) ||
        bytes[cursor] !== 8
      )
        return null;
      const height = bytes.readUInt16BE(cursor + 1),
        width = bytes.readUInt16BE(cursor + 3),
        components = new Map();
      if (
        !height ||
        !width ||
        width > 4096 ||
        height > 4096 ||
        width * height > 8_000_000
      )
        return null;
      for (let i = 0; i < count; i++) {
        const at = cursor + 6 + 3 * i,
          id = bytes[at],
          sampling = bytes[at + 1],
          table = bytes[at + 2];
        if (
          components.has(id) ||
          !(sampling >> 4) ||
          sampling >> 4 > 4 ||
          !(sampling & 15) ||
          (sampling & 15) > 4 ||
          table > 3
        )
          return null;
        components.set(id, table);
      }
      frame = { width, height, components };
    } else if (marker === 0xdb) {
      while (cursor < end) {
        const table = bytes[cursor++],
          precision = table >> 4,
          count = 64 * (precision + 1);
        if (precision > 1 || (table & 15) > 3 || cursor + count > end)
          return null;
        for (let i = cursor; i < cursor + count; i += precision + 1)
          if (precision ? bytes.readUInt16BE(i) === 0 : bytes[i] === 0)
            return null;
        quantization.add(table & 15);
        cursor += count;
      }
    } else if (marker === 0xc4) {
      while (cursor < end) {
        const table = bytes[cursor++];
        if (table >> 4 > 1 || (table & 15) > 3 || cursor + 16 > end)
          return null;
        let count = 0,
          available = 1;
        for (let i = 0; i < 16; i++) {
          const n = bytes[cursor++];
          count += n;
          available = available * 2 - n;
          if (available < 0) return null;
        }
        if (!count || count > 256 || cursor + count > end) return null;
        huffman.add(table);
        cursor += count;
      }
    } else if (marker === 0xdd) {
      if (length !== 4) return null;
      restartInterval = bytes.readUInt16BE(cursor);
    } else if (marker === 0xda) {
      const count = bytes[cursor++];
      if (!frame || count !== frame.components.size || length !== 6 + 2 * count)
        return null;
      const seen = new Set();
      for (let i = 0; i < count; i++) {
        const id = bytes[cursor++],
          tables = bytes[cursor++];
        if (
          seen.has(id) ||
          !frame.components.has(id) ||
          !quantization.has(frame.components.get(id)) ||
          !huffman.has(tables >> 4) ||
          !huffman.has(0x10 | (tables & 15))
        )
          return null;
        seen.add(id);
      }
      if (
        bytes[cursor++] !== 0 ||
        bytes[cursor++] !== 63 ||
        bytes[cursor] !== 0
      )
        return null;
      let entropyBytes = 0,
        nextRestart = 0;
      for (offset = end; offset < bytes.length;) {
        if (bytes[offset++] !== 0xff) {
          entropyBytes++;
          continue;
        }
        while (bytes[offset] === 0xff) offset++;
        const next = bytes[offset++];
        if (next === 0) {
          entropyBytes++;
          continue;
        }
        if (
          next >= 0xd0 &&
          next <= 0xd7 &&
          restartInterval &&
          next === 0xd0 + nextRestart
        ) {
          nextRestart = (nextRestart + 1) % 8;
          continue;
        }
        if (next === 0xd9 && offset === bytes.length && entropyBytes)
          return { width: frame.width, height: frame.height };
        return null;
      }
      return null;
    } else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe)
      return null;
    offset = end;
  }
  return null;
}

// Image bytes are opaque binary, not text credentials. Preserve only a validated
// screenshot on its actual queue action; every other field still uses redaction.
export function sanitizeActionResultData(action, value) {
  if (value === undefined) return undefined;
  if (
    action?.type !== "browser_screenshot" ||
    value?.kind !== "browser_screenshot"
  )
    return boundedJson(value);
  const invalid = () => {
    throw new ApiError(
      400,
      "Provide a valid bounded JPEG screenshot with matching metadata.",
    );
  };
  const fields = [
    "kind",
    "mimeType",
    "dataUrl",
    "width",
    "height",
    "url",
    "title",
    "capturedAt",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key)) ||
    value.mimeType !== "image/jpeg" ||
    typeof value.dataUrl !== "string" ||
    value.dataUrl.length > 220 * 1024 ||
    !value.dataUrl.startsWith("data:image/jpeg;base64,") ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 1 ||
    value.height < 1 ||
    value.width > 4096 ||
    value.height > 4096 ||
    value.width * value.height > 8_000_000 ||
    typeof value.url !== "string" ||
    value.url.length > 4096 ||
    typeof value.title !== "string" ||
    value.title.length > 500 ||
    typeof value.capturedAt !== "string" ||
    value.capturedAt.length > 40 ||
    !Number.isFinite(Date.parse(value.capturedAt))
  )
    invalid();
  let url;
  try {
    url = new URL(value.url);
  } catch {
    invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    invalid();
  const encoded = value.dataUrl.slice("data:image/jpeg;base64,".length);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    invalid();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) invalid();
  const dimensions = jpegDimensions(bytes);
  if (
    !dimensions ||
    dimensions.width !== value.width ||
    dimensions.height !== value.height
  )
    invalid();
  const cleaned = boundedJson(value);
  cleaned.dataUrl = value.dataUrl;
  return cleaned;
}

// Call after boundedJson has validated/redacted incoming result data. Undefined
// means no data field, and must not compare equal to an explicit JSON null.
export function resultDataDigest(value) {
  if (value === undefined)
    return createHash("sha256")
      .update("nakama-action-result-v1\0absent")
      .digest("hex");
  let size = 0;
  const part = (text) => {
    size += Buffer.byteLength(text);
    if (size > MAX_DATA_BYTES)
      throw new RangeError("Result data exceeds 256 KiB.");
    return text;
  };
  const encode = (item, depth = 0) => {
    if (depth > 30) throw new RangeError("Result data is nested too deeply.");
    if (item === null) return part("null");
    if (
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return part(JSON.stringify(item));
    if (Array.isArray(item))
      return (
        part("[") +
        Array.from(
          item,
          (child, index) => (index ? part(",") : "") + encode(child, depth + 1),
        ).join("") +
        part("]")
      );
    if (
      item &&
      typeof item === "object" &&
      [Object.prototype, null].includes(Object.getPrototypeOf(item))
    )
      return (
        part("{") +
        Object.keys(item)
          .sort()
          .map(
            (key, index) =>
              (index ? part(",") : "") +
              part(JSON.stringify(key)) +
              part(":") +
              encode(item[key], depth + 1),
          )
          .join("") +
        part("}")
      );
    throw new TypeError("Result data must be validated JSON.");
  };
  return createHash("sha256")
    .update("nakama-action-result-v1\0json\0")
    .update(encode(value))
    .digest("hex");
}

function screenshotMetadata(data) {
  const metadata = {};
  for (const [key, max] of [
    ["mimeType", 100],
    ["url", 4096],
    ["title", 500],
    ["capturedAt", 50],
  ])
    if (typeof data[key] === "string" && data[key].length <= max)
      metadata[key] = data[key];
  for (const key of ["width", "height"])
    if (Number.isInteger(data[key]) && data[key] > 0 && data[key] <= 4096)
      metadata[key] = data[key];
  return metadata;
}

// Retain newest completed screenshot payloads globally across all devices.
// Queue entries, non-screenshot data and extension-side receipts are untouched.
// Prepare every digest before mutation so invalid input cannot partly prune.
export function trimScreenshotResults(actions, limit = 10) {
  if (!Array.isArray(actions))
    throw new TypeError("Provide the host action list.");
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new RangeError("Screenshot retention must be a nonnegative integer.");
  const candidates = actions
    .map((action, index) => ({ action, index }))
    .filter(
      ({ action }) =>
        action?.type === "browser_screenshot" &&
        action.status === "completed" &&
        action.resultData?.kind === "browser_screenshot",
    );
  const timestamp = (action) => {
    for (const value of [action.completedAt, action.createdAt]) {
      if (typeof value !== "string") continue;
      const time = Date.parse(value);
      if (Number.isFinite(time)) return time;
    }
    return -Infinity;
  };
  candidates.sort(
    (a, b) => timestamp(b.action) - timestamp(a.action) || b.index - a.index,
  );
  const discarded = candidates.slice(limit).map(({ action }) => ({
    action,
    dataDigest: resultDataDigest(action.resultData),
    metadata: screenshotMetadata(action.resultData),
  }));
  for (const { action, dataDigest, metadata } of discarded) {
    action.dataDigest = dataDigest;
    action.resultDataMetadata = metadata;
    action.resultDataOmitted = true;
    delete action.resultData;
  }
  return discarded.length;
}
