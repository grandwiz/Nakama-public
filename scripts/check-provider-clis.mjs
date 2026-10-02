// Explicit opt-in smoke test: consumes a small amount of existing subscription
// allowance, never an API key. Does not edit project files or send external actions.
import fs from "node:fs/promises";
import path from "node:path";
import { runProvider, probeProvider } from "../apps/host/providers.mjs";
const cwd = path.resolve("tmp/provider-smoke");
await fs.mkdir(cwd, { recursive: true });
const results = await Promise.all(
  ["codex", "claude"].map(async (id) => {
    const provider = {
      id,
      connectionType: "subscription",
      selectedModel: id === "codex" ? "gpt-6-luna" : "sonnet",
      effort: "low",
    };
    const probe = await probeProvider(provider);
    if (probe.status !== "connected") return { id, status: "not_signed_in" };
    return new Promise(async (resolve) => {
      let output = "",
        run,
        timer;
      try {
        timer = setTimeout(() => run?.stop(), 120000);
        run = await runProvider(provider, {
          cwd,
          prompt:
            "This is a connectivity check for the private Nakama client. Do not call tools or read files. Respond only with: Nakama ready",
          onOutput: (text) => {
            output = (output + text).slice(-3000);
          },
          onComplete: (result) => {
            clearTimeout(timer);
            resolve({
              id,
              code: result.code,
              error: result.error,
              answer: result.text,
              diagnostic: result.code ? output : undefined,
            });
          },
        });
      } catch (error) {
        clearTimeout(timer);
        resolve({ id, code: 1, error: error.message });
      }
    });
  }),
);
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.code !== 0)) process.exitCode = 1;
