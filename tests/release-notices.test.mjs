import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  collectRuntimeNotices,
  checkRuntimeNotices,
  binaryNoticeProblems,
} from "../scripts/release-notices.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nakama-notices-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "node_modules", "fixture"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "docs"));
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture-app" },
      "node_modules/fixture": { version: "1.0.0", license: "MIT" },
      "node_modules/dev-only": { version: "1.0.0", license: "MIT", dev: true },
    },
  };
  await fs.writeFile(
    path.join(root, "package-lock.json"),
    JSON.stringify(lock),
  );
  await fs.writeFile(
    path.join(root, "node_modules/fixture/package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", license: "MIT" }),
  );
  await fs.writeFile(
    path.join(root, "node_modules/fixture/LICENSE"),
    "Fixture permission notice\n",
  );
  await fs.writeFile(
    path.join(root, "node_modules/fixture/CopyrightNotice.txt"),
    "Fixture copyright\n",
  );
  const save = async () => {
    const result = await collectRuntimeNotices(root);
    await fs.writeFile(
      path.join(root, "docs/third-party-runtime-notices.txt"),
      result.text,
    );
    await fs.writeFile(
      path.join(root, "docs/third-party-runtime-inventory.json"),
      JSON.stringify(result.inventory, null, 2) + "\n",
    );
    return result;
  };
  return { root, lock, save };
}

test("runtime notices retain separate copyright text and exclude uninstalled dev-only packages", async (t) => {
  const f = await fixture(t);
  const result = await f.save();
  assert.equal(result.inventory.placements, 1);
  assert.equal(result.inventory.binaryDistributionReady, false);
  assert.deepEqual(
    result.inventory.packages[0].notices.map((n) => n.name),
    ["CopyrightNotice.txt", "LICENSE"],
  );
  assert.match(result.text, /Fixture copyright/);
  await checkRuntimeNotices(f.root);
  await fs.writeFile(
    path.join(f.root, "node_modules/fixture/LICENSE"),
    "Changed upstream notice\n",
  );
  await assert.rejects(checkRuntimeNotices(f.root), /missing or stale/);
});

test("missing licenses and installed version mismatches fail instead of marking an inventory complete", async (t) => {
  const f = await fixture(t);
  await fs.rm(path.join(f.root, "node_modules/fixture/LICENSE"));
  await assert.rejects(
    collectRuntimeNotices(f.root),
    /license text is missing/,
  );
  await fs.writeFile(
    path.join(f.root, "node_modules/fixture/package.json"),
    JSON.stringify({ name: "fixture", version: "2.0.0", license: "MIT" }),
  );
  await assert.rejects(
    collectRuntimeNotices(f.root),
    /differs from its lockfile/,
  );
});

test("new license declarations and escaping lockfile paths require review", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.root, "node_modules/fixture/package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      license: "UNLICENSED",
    }),
  );
  await assert.rejects(collectRuntimeNotices(f.root), /license declaration/);
  f.lock.packages = {
    "": {},
    "node_modules/../outside": { version: "1", license: "MIT" },
  };
  await fs.writeFile(
    path.join(f.root, "package-lock.json"),
    JSON.stringify(f.lock),
  );
  await assert.rejects(
    collectRuntimeNotices(f.root),
    /unsupported package location/,
  );
});

test("a passing npm inventory cannot approve Android binary notice completeness", async (t) => {
  const f = await fixture(t);
  await f.save();
  const errors = await binaryNoticeProblems("android", undefined, f.root);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /resolved transitive/);
  assert.match(errors[1], /packaged Nakama/);
});
