import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { locateProvider } from "../apps/host/providers.mjs";

const packages = {
  codex: "@openai/codex",
  claude: "@anthropic-ai/claude-code",
};

async function fixture() {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "nakama-cli-discovery-"),
  );
  const home = path.join(folder, "user");
  const appData = path.join(home, "AppData", "Roaming");
  const prefix = path.join(appData, "npm");
  await fs.mkdir(prefix, { recursive: true });
  const options = {
    platform: "win32",
    home,
    env: { PATH: "", APPDATA: appData },
  };
  return {
    folder,
    prefix,
    options,
    async install(id, entry, overrides = {}) {
      const root = path.join(
        prefix,
        "node_modules",
        ...packages[id].split("/"),
      );
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: packages[id],
          bin: { [id]: entry },
          ...overrides,
        }),
      );
      const file = path.resolve(root, entry);
      // Fixtures use inert files: discovery must never execute a wrapper or script.
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        file,
        "throw new Error('discovery must not execute');\n",
      );
      return { root, file };
    },
    async clean() {
      assert.equal(
        path.dirname(path.resolve(folder)),
        path.resolve(os.tmpdir()),
      );
      assert.match(path.basename(folder), /^nakama-cli-discovery-/);
      await fs.rm(folder, { recursive: true, force: true });
    },
  };
}

test("Codex resolves the current npm bundle when GUI PATH predates installation", async () => {
  const f = await fixture();
  try {
    const { file } = await f.install("codex", "bundle/codex.js");
    assert.equal(
      await locateProvider("codex", null, f.options),
      await fs.realpath(file),
    );
  } finally {
    await f.clean();
  }
});

test("Codex alternate npm layouts follow the declared official bin", async () => {
  const f = await fixture();
  try {
    for (const entry of ["dist/index.js", "another-release/entry.mjs"]) {
      const { file } = await f.install("codex", entry);
      assert.equal(
        await locateProvider("codex", null, f.options),
        await fs.realpath(file),
      );
    }
  } finally {
    await f.clean();
  }
});

test("Claude and Codex npm clients resolve without executing Windows wrapper scripts", async () => {
  const f = await fixture();
  try {
    for (const [id, entry] of [
      ["claude", "cli.js"],
      ["codex", "bin/codex.js"],
    ]) {
      const { file } = await f.install(id, entry);
      await fs.writeFile(path.join(f.prefix, `${id}.cmd`), "exit 99\r\n");
      await fs.writeFile(
        path.join(f.prefix, `${id}.ps1`),
        "throw 'must not run'\r\n",
      );
      const options = { ...f.options, env: { PATH: `"${f.prefix}"` } };
      assert.equal(
        await locateProvider(id, null, options),
        await fs.realpath(file),
      );
    }
  } finally {
    await f.clean();
  }
});

test("native CLI remains preferred when both native and npm installs exist", async () => {
  const f = await fixture();
  try {
    await f.install("claude", "cli.js");
    const native = path.join(f.options.home, ".local", "bin", "claude.exe");
    await fs.mkdir(path.dirname(native), { recursive: true });
    await fs.writeFile(native, "inert native fixture");
    assert.equal(await locateProvider("claude", null, f.options), native);
  } finally {
    await f.clean();
  }
});

test("npm discovery rejects foreign packages, shell entries, missing and escaping bins", async () => {
  const f = await fixture();
  try {
    const { root } = await f.install("codex", "bundle/codex.js");
    const absolute = path.join(f.folder, "outside.js");
    await fs.writeFile(absolute, "inert fixture");
    const variants = [
      { name: "not-the-official-package", bin: { codex: "bundle/codex.js" } },
      { bin: { codex: absolute } },
      { bin: { codex: "../../../outside.js" } },
      { bin: { codex: "codex.cmd" } },
      { bin: { codex: "codex.ps1" } },
      { bin: { codex: "missing.js" } },
      { bin: { unexpected: "bundle/codex.js" } },
      { bin: { codex: 42 } },
      { bin: null },
    ];
    for (const variant of variants) {
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ name: packages.codex, ...variant }),
      );
      assert.equal(
        await locateProvider("codex", null, f.options),
        null,
        JSON.stringify(variant),
      );
    }
    for (const invalid of ["not-json", " ".repeat(65537)]) {
      await fs.writeFile(path.join(root, "package.json"), invalid);
      assert.equal(await locateProvider("codex", null, f.options), null);
    }
  } finally {
    await f.clean();
  }
});

test("npm entry symlink or junction cannot escape the declared package", async () => {
  const f = await fixture();
  try {
    const { root } = await f.install("codex", "bundle/codex.js");
    const external = path.join(f.folder, "external");
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, "codex.js"), "inert fixture");
    await fs.symlink(
      external,
      path.join(root, "external-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: packages.codex,
        bin: { codex: "external-link/codex.js" },
      }),
    );
    assert.equal(await locateProvider("codex", null, f.options), null);
  } finally {
    await f.clean();
  }
});

test("configured CLI paths still require absolute executable or Node entry points", async () => {
  const f = await fixture();
  try {
    const { file } = await f.install("codex", "bundle/codex.js");
    assert.equal(await locateProvider("codex", file, f.options), file);
    const wrapper = path.join(f.prefix, "codex.cmd");
    await fs.writeFile(wrapper, "exit 99\r\n");
    for (const invalid of [
      wrapper,
      "relative.js",
      path.join(f.folder, "missing.js"),
    ])
      await assert.rejects(locateProvider("codex", invalid, f.options), {
        status: 400,
      });
    await assert.rejects(locateProvider("unknown", file, f.options), {
      status: 400,
    });
  } finally {
    await f.clean();
  }
});
