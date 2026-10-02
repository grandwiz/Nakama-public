import { useMemo, useState } from "react";
import { ImageOff, Scan } from "lucide-react";
import { boundedDeviceResult, validateBrowserScreenshot } from "./screenshot";

export function DeviceResult({
  type,
  value,
}: {
  type: string;
  value: unknown;
}) {
  const screenshot = useMemo(() => validateBrowserScreenshot(value), [value]);
  const [failedDataUrl, setFailedDataUrl] = useState<string>();
  const isScreenshot =
    type === "browser_screenshot" ||
    (value !== null &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "browser_screenshot");
  if (isScreenshot) {
    if (!screenshot || failedDataUrl === screenshot.dataUrl)
      return (
        <div className="inline-note screenshot-unavailable" role="status">
          <ImageOff size={18} />
          <span>
            This screenshot could not be displayed. The device must return a
            valid, bounded JPEG capture. Request another screenshot from the
            permitted active tab.
          </span>
        </div>
      );
    return (
      <figure className="browser-screenshot">
        <div className="screenshot-heading">
          <Scan size={16} />
          <strong>Browser capture</strong>
          <span>
            {screenshot.width} × {screenshot.height}
          </span>
        </div>
        <img
          src={screenshot.dataUrl}
          alt={
            screenshot.title
              ? `Captured page: ${screenshot.title}`
              : "Captured browser page"
          }
          width={screenshot.width}
          height={screenshot.height}
          loading="lazy"
          decoding="async"
          onError={() => setFailedDataUrl(screenshot.dataUrl)}
        />
        <figcaption>
          <strong>{screenshot.title || "Untitled page"}</strong>
          <span>{screenshot.url}</span>
          <small>
            Captured {new Date(screenshot.capturedAt).toLocaleString("en-GB")} ·
            visible tab area
          </small>
        </figcaption>
      </figure>
    );
  }
  return (
    <pre className="task-output device-result-text">
      {boundedDeviceResult(value)}
    </pre>
  );
}
