export interface BrowserScreenshot {
  kind: "browser_screenshot";
  mimeType: "image/jpeg";
  dataUrl: string;
  width: number;
  height: number;
  url: string;
  title: string;
  capturedAt: string;
}

const jpegPrefix = "data:image/jpeg;base64,";
const maxDataUrlLength = 220 * 1024;

// Check the JPEG header before asking the browser to decode an untrusted image.
function jpegSize(bytes: string): { width: number; height: number } | null {
  const byte = (index: number) => bytes.charCodeAt(index);
  if (
    bytes.length < 12 ||
    byte(0) !== 0xff ||
    byte(1) !== 0xd8 ||
    byte(bytes.length - 2) !== 0xff ||
    byte(bytes.length - 1) !== 0xd9
  )
    return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (byte(offset++) !== 0xff) return null;
    while (byte(offset) === 0xff) offset++;
    const marker = byte(offset++);
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = byte(offset) * 256 + byte(offset + 1);
    if (length < 2 || offset + length > bytes.length) return null;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      if (length < 8) return null;
      return {
        height: byte(offset + 3) * 256 + byte(offset + 4),
        width: byte(offset + 5) * 256 + byte(offset + 6),
      };
    }
    offset += length;
  }
  return null;
}

export function validateBrowserScreenshot(
  value: unknown,
): BrowserScreenshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    item.kind !== "browser_screenshot" ||
    item.mimeType !== "image/jpeg" ||
    typeof item.dataUrl !== "string" ||
    item.dataUrl.length > maxDataUrlLength ||
    !item.dataUrl.startsWith(jpegPrefix) ||
    typeof item.width !== "number" ||
    !Number.isInteger(item.width) ||
    typeof item.height !== "number" ||
    !Number.isInteger(item.height) ||
    item.width < 1 ||
    item.height < 1 ||
    item.width > 4096 ||
    item.height > 4096 ||
    item.width * item.height > 8_000_000 ||
    typeof item.url !== "string" ||
    item.url.length > 4096 ||
    typeof item.title !== "string" ||
    item.title.length > 500 ||
    typeof item.capturedAt !== "string" ||
    item.capturedAt.length > 40 ||
    !Number.isFinite(Date.parse(item.capturedAt))
  )
    return null;
  try {
    const url = new URL(item.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    const encoded = item.dataUrl.slice(jpegPrefix.length);
    if (
      !encoded ||
      encoded.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    )
      return null;
    const size = jpegSize(atob(encoded));
    if (!size || size.width !== item.width || size.height !== item.height)
      return null;
  } catch {
    return null;
  }
  return item as unknown as BrowserScreenshot;
}

// Device output is untrusted. Bound all text, nesting and entries before serialization.
export function boundedDeviceResult(value: unknown): string {
  let budget = 180;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (--budget < 0) return "[Further results omitted]";
    if (typeof item === "string") {
      if (item.startsWith("data:")) return "[Encoded data omitted]";
      return item.length > 1500 ? item.slice(0, 1500) + "… [truncated]" : item;
    }
    if (item === null || typeof item !== "object") return item;
    if (depth > 5 || seen.has(item)) return "[Nested results omitted]";
    seen.add(item);
    if (Array.isArray(item))
      return item.slice(0, 50).map((entry) => visit(entry, depth + 1));
    return Object.fromEntries(
      Object.entries(item)
        .slice(0, 50)
        .map(([key, entry]) => [
          key.slice(0, 100),
          key.toLowerCase() === "dataurl"
            ? "[Image data omitted]"
            : visit(entry, depth + 1),
        ]),
    );
  };
  try {
    const text = JSON.stringify(visit(value, 0), null, 2) || "No result data.";
    return text.length > 18000
      ? text.slice(0, 18000) + "\n… [Result truncated]"
      : text;
  } catch {
    return "This device result could not be displayed.";
  }
}
