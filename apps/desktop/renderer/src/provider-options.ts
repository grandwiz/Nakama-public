import type { Provider } from "./types";

// Documented IDs, checked 2026-10-02. These are choices, not account discovery.
// https://code.claude.com/docs/en/model-config
// https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
export const claudeModelChoices = [
  { value: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { value: "claude-opus-5", label: "Claude Opus 5" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "opus", label: "Opus · follow CLI default" },
  { value: "sonnet", label: "Sonnet · follow CLI default" },
  { value: "haiku", label: "Haiku · follow CLI default" },
];

export function effortChoices(provider?: Provider, model?: string) {
  const detail =
    provider?.modelDetails?.find((item) => item.id === model) ||
    (!model
      ? provider?.modelDetails?.find((item) => item.isDefault)
      : undefined);
  const values = detail?.efforts.length
    ? detail.efforts
    : provider?.id === "claude"
      ? ["low", "medium", "high", "xhigh", "max", "ultracode"]
      : ["low", "medium", "high", "xhigh"];
  const labels: Record<string, string> = {
    none: "Minimal · no reasoning",
    minimal: "Minimal",
    low: "Quick · low",
    medium: "Balanced · medium",
    high: "Thorough · high",
    xhigh: "Extra thorough · xhigh",
    max: provider?.id === "claude" ? "Ultra · max" : "Maximum · max",
    ultra: "Ultra · ultra",
    ultracode: "Ultracode request · xhigh, Nakama workers",
  };
  return values.map((value) => ({ value, label: labels[value] || value }));
}

export function normalizedEffort(provider?: Provider) {
  const options = effortChoices(provider, provider?.selectedModel);
  return options.some((item) => item.value === provider?.effort)
    ? provider!.effort
    : options.find((item) => item.value === "high")?.value ||
        options[0]?.value ||
        "high";
}
