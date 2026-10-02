import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  locateNpmCli,
  klingEnvironment,
  validateVideoRequest,
  runKling,
} from "../apps/host/kling-cli.mjs";

test("installed npm preserves literal Kling-style argument values without network or provider access", async () => {
  const npm = await locateNpmCli();
  assert.ok(npm, "Node/npm is required to verify Windows argument handling");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nakama-kling-argv-"),
  );
  const entry = path.join(directory, "capture.mjs");
  await fs.writeFile(
    entry,
    "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n",
  );
  await fs.writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "nakama-kling-argv-fixture",
      version: "1.0.0",
      bin: { "kling-argv-fixture": "capture.mjs" },
    }),
  );
  const model = {
    models: [
      {
        id: "fixture",
        parameters: { properties: {} },
        required: [],
        defaults: {},
      },
    ],
  };
  const prompt = validateVideoRequest(
    { model: "fixture", prompt: "line one\nline two" },
    model,
  ).prompt;
  assert.equal(prompt, "line one line two");
  const args = [
    "--model=fixture",
    "--negative_prompt=--other=thing",
    'A "quoted" value & echo NAKAMA_ARG_LITERAL',
    prompt,
    "literal %NAKAMA_ARG_TEST% $(echo harmless) `test` | < > ^ !",
    "ending\\",
  ];
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          npm,
          "exec",
          "--offline",
          "--ignore-scripts",
          "--yes",
          `--cache=${path.join(directory, "cache")}`,
          `--package=${directory}`,
          "--",
          "kling-argv-fixture",
          ...args,
        ],
        {
          shell: false,
          windowsHide: true,
          cwd: directory,
          env: {
            ...klingEnvironment(),
            NAKAMA_ARG_TEST: "MUST_NOT_BE_EXPANDED",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Offline npm argument check timed out"));
      }, 10000);
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    assert.equal(
      result.code,
      0,
      `Offline argument capture must execute: ${result.stderr.slice(0, 1200)}`,
    );
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("nakama-kling-argv-"));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Kling launch isolates npm configuration and rechecks approval at the actual spawn boundary", async () => {
  let guarded = false,
    workingDirectory;
  const result = await runKling(["account", "--quiet"], {
    beforeSpawn: () => {
      guarded = true;
    },
    spawnProcess: (executable, args, options) => {
      assert.equal(guarded, true);
      assert.equal(executable, process.execPath);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      workingDirectory = options.cwd;
      assert.equal(path.dirname(workingDirectory), path.resolve(os.tmpdir()));
      assert.ok(
        path.basename(workingDirectory).startsWith("nakama-kling-run-"),
      );
      assert.notEqual(workingDirectory, process.cwd());
      for (const flag of ["--userconfig=", "--globalconfig="]) {
        const file = args.find((v) => v.startsWith(flag)).slice(flag.length);
        assert.equal(path.dirname(file), workingDirectory);
        assert.equal(readFileSync(file, "utf8"), "");
      }
      assert.ok(args.some((v) => v.startsWith("--script-shell=")));
      assert.ok(args.includes("--package=@klingai/cli-global@0.2.0"));
      assert.ok(args.includes("--registry=https://registry.npmjs.org"));
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from('{"ok":true,"body":{}}'));
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.equal(result.code, 0);
  await assert.rejects(fs.stat(workingDirectory), { code: "ENOENT" });
});
