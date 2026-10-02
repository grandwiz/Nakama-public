import path from "node:path";
import { NakamaHost } from "./host.mjs";
const host = await new NakamaHost({
  dataDir: process.env.NAKAMA_DATA_DIR || path.resolve(".nakama"),
}).init();
await host.listen();
console.log("Nakama private development host: https://127.0.0.1:43110");
console.log(
  "Use the Electron desktop for first-run configuration, persistent protected credentials, and pairing.",
);
process.on("SIGINT", async () => {
  await host.close();
  process.exit(0);
});
