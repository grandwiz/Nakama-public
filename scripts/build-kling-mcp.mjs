import { build } from "esbuild";
await build({
  entryPoints: ["apps/kling-mcp/server.mjs"],
  outfile: "output/kling-mcp/server.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});
