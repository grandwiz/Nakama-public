// Local notice inventory only. No registry requests, package scripts or provider calls.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDefault = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const noticeName =
  /^(?:licen[sc]e|copying|notice|copyright)(?:[._-]|notice|$)/i;
const expectedLicenses = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
]);
const outputs = {
  text: "docs/third-party-runtime-notices.txt",
  inventory: "docs/third-party-runtime-inventory.json",
};

async function readFile(file, max = 1024 * 1024) {
  const stat = await fs.lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink > 1 ||
    stat.size > max
  )
    throw new Error("A notice input is not an ordinary bounded file.");
  const data = await fs.readFile(file);
  if (data.length > max)
    throw new Error("A notice input grew beyond its bound.");
  return data;
}

/** Inventory every production lockfile placement, including nested duplicates. */
export async function collectRuntimeNotices(root = rootDefault) {
  root = path.resolve(root);
  const lockData = await readFile(
    path.join(root, "package-lock.json"),
    4 * 1024 * 1024,
  );
  const lock = JSON.parse(lockData.toString("utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""])
    throw new Error("Expected a version-three npm lockfile.");
  const entries = [];
  for (const [placement, locked] of Object.entries(lock.packages).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (!placement || locked.dev || locked.devOptional) continue;
    if (
      !placement.startsWith("node_modules/") ||
      placement.includes("\\") ||
      placement.split("/").some((p) => !p || [".", ".."].includes(p)) ||
      locked.link
    )
      throw new Error(
        "Runtime lockfile contains an unsupported package location.",
      );
    let current = root;
    for (const part of placement.split("/")) {
      current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error(
          "Runtime package links are not accepted for notice generation.",
        );
    }
    const metadata = JSON.parse(
      (await readFile(path.join(current, "package.json"))).toString("utf8"),
    );
    if (
      metadata.version !== locked.version ||
      typeof metadata.name !== "string" ||
      !metadata.name
    )
      throw new Error(
        `Installed runtime package differs from its lockfile: ${placement}`,
      );
    const license =
      typeof metadata.license === "string" ? metadata.license : locked.license;
    if (!expectedLicenses.has(license) || locked.license !== license)
      throw new Error(
        `Review the new or inconsistent license declaration: ${metadata.name}`,
      );
    const notices = [];
    for (const entry of (
      await fs.readdir(current, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!noticeName.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error(`Review the non-file notice in ${metadata.name}`);
      const data = await readFile(path.join(current, entry.name));
      const content = data.toString("utf8");
      if (
        !content.trim() ||
        content.includes("\0") ||
        content.includes("\ufffd")
      )
        throw new Error(
          `Review the empty or non-text notice in ${metadata.name}`,
        );
      notices.push({
        name: entry.name,
        sha256: hash(data),
        text: content.replaceAll("\r\n", "\n").trimEnd(),
      });
    }
    if (!notices.some((notice) => /^(?:licen[sc]e|copying)/i.test(notice.name)))
      throw new Error(`Runtime license text is missing: ${metadata.name}`);
    entries.push({
      name: metadata.name,
      version: metadata.version,
      license,
      placement,
      notices,
    });
  }
  if (!entries.length)
    throw new Error("No runtime dependencies were inventoried.");
  const groups = new Map();
  for (const entry of entries) {
    // Do not silently coalesce differing notices from equal package versions.
    const identity = `${entry.name}@${entry.version}:${hash(JSON.stringify(entry.notices))}`;
    const group = groups.get(identity);
    if (group) group.placements.push(entry.placement);
    else
      groups.set(identity, {
        ...entry,
        placement: undefined,
        placements: [entry.placement],
      });
  }
  const packages = [...groups.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const inventory = {
    schema: 1,
    scope:
      "Production npm lockfile packages; not a complete binary software bill of materials",
    packageLockSha256: hash(lockData),
    placements: entries.length,
    packages: packages.map(({ notices, placement, ...rest }) => ({
      ...rest,
      notices: notices.map(({ text, ...notice }) => notice),
    })),
    excluded: [
      "Electron/Chromium native runtime notices",
      "Android resolved runtime dependencies",
      "Gradle/SDK and npm development build tools",
      "External provider CLIs and services",
    ],
    binaryDistributionReady: false,
  };
  const lines = [
    "Nakama production npm dependency notices",
    "Generated locally by node scripts/release-notices.mjs --write.",
    `package-lock.json SHA-256: ${inventory.packageLockSha256}`,
    `${entries.length} lockfile placements; ${packages.length} package/version/notice groups.`,
    "",
    "These are copies of the installed packages' original notice files. Package metadata is not a substitute for the text below.",
    "Scope excludes Electron/Chromium native runtime notices, Android, build tools and separately installed provider CLIs.",
    "This file does not certify binary license completeness. See docs/third-party-notices.md.",
  ];
  for (const row of packages) {
    lines.push(
      "",
      "=".repeat(78),
      `${row.name} ${row.version}`,
      `Declared license: ${row.license}`,
      `Lockfile placements: ${row.placements.join(", ")}`,
    );
    for (const notice of row.notices)
      lines.push("", `--- ${notice.name} ---`, notice.text);
  }
  return { inventory, text: lines.join("\n") + "\n" };
}

export async function checkRuntimeNotices(root = rootDefault) {
  const generated = await collectRuntimeNotices(root);
  const expected = {
    text: generated.text,
    inventory: JSON.stringify(generated.inventory, null, 2) + "\n",
  };
  for (const [kind, file] of Object.entries(outputs)) {
    const saved = await readFile(path.join(root, file), 4 * 1024 * 1024).catch(
      () => null,
    );
    if (!saved || saved.toString("utf8") !== expected[kind])
      throw new Error(
        `Notice inventory is missing or stale: ${file}. Run --write and review the changes.`,
      );
  }
  return generated.inventory;
}

/** This conservative gate intentionally cannot approve Android before its missing inventory is implemented. */
export async function binaryNoticeProblems(
  platform,
  distribution,
  root = rootDefault,
) {
  if (!["windows", "android"].includes(platform))
    throw new Error("Select windows or android for binary notices.");
  await checkRuntimeNotices(root);
  if (platform === "android")
    return [
      "Android releaseRuntimeClasspath has no checked-in resolved transitive artifact/POM/license inventory. Direct Gradle declarations and three merged AndroidX LICENSE entries cannot establish completeness.",
      "Android has no verified packaged Nakama license, notices and complete third-party notice asset. Generate/review the resolved release inventory and inspect the final APK before enabling this gate.",
    ];
  if (!distribution)
    return [
      "Provide the unpacked Windows distribution directory for binary notice verification.",
    ];
  const problems = [];
  for (const [target, source] of [
    ["LICENSE.nakama.txt", "LICENSE"],
    ["NOTICE.nakama.md", "NOTICE.md"],
    ["THIRD_PARTY_NOTICES.txt", outputs.text],
    ["LICENSE.electron.txt", "node_modules/electron/dist/LICENSE"],
    [
      "LICENSES.chromium.html",
      "node_modules/electron/dist/LICENSES.chromium.html",
    ],
  ]) {
    const expected = await readFile(path.join(root, source), 32 * 1024 * 1024);
    const actual = await readFile(
      path.join(distribution, target),
      32 * 1024 * 1024,
    ).catch(() => null);
    if (!actual || hash(actual) !== hash(expected))
      problems.push(
        `Windows distribution notice is missing or differs from its reviewed source: ${target}`,
      );
  }
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift() || "--check";
  if (!["--write", "--check", "--binary"].includes(mode))
    throw new Error(
      "Use --write, --check, or --binary <windows|android> [unpacked-directory].",
    );
  if (mode !== "--binary" && args.length)
    throw new Error("Unexpected notice arguments.");
  if (mode === "--write") {
    const generated = await collectRuntimeNotices();
    await fs.writeFile(path.join(rootDefault, outputs.text), generated.text);
    await fs.writeFile(
      path.join(rootDefault, outputs.inventory),
      JSON.stringify(generated.inventory, null, 2) + "\n",
    );
  }
  const inventory = await checkRuntimeNotices();
  const errors =
    mode === "--binary" ? await binaryNoticeProblems(args[0], args[1]) : [];
  if (args.length > 2) throw new Error("Unexpected notice arguments.");
  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        scope:
          mode === "--binary"
            ? `${args[0]} binary notices`
            : "npm source notice inventory only",
        placements: inventory.placements,
        packages: inventory.packages.length,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
