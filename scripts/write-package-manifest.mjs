import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const files = [
  "output/installers/Nakama Control Center Setup 0.1.0.exe",
  "output/apk/Nakama-0.1.0-debug.apk",
  "output/pdf/Nakama-Feature-Checklist.pdf",
];
const artifacts = [];
for (const file of files) {
  const data = await fs.readFile(path.resolve(file));
  artifacts.push({
    path: file,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const manifest = {
  version: "0.1.0",
  status: "engineering-preview",
  generatedAt: new Date().toISOString(),
  artifacts,
};
await fs.writeFile(
  "output/package-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
