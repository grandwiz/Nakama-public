import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ApiError } from "./security.mjs";

export const KLING_PACKAGE = "@klingai/cli-global@0.2.0";
export const KLING_LOGIN_COMMAND = `npm exec --yes --registry=https://registry.npmjs.org --package=${KLING_PACKAGE} -- kling login --skill-name kling-ai-cli --skill-version 1.0.5`;
const shared = [
  "--skill-name",
  "kling-ai-cli",
  "--skill-version",
  "1.0.5",
  "--quiet",
];
const reserved =
  /^(?:prompt|model|omni|poll|quiet|image|video|tailImage|help|version|rationale|skill[-_]name|skill[-_]version|task[-_]trace[-_]id|__proto__|constructor|prototype)$/i;
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const text = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const numeric = (v) =>
  (typeof v === "number" || typeof v === "string") &&
  String(v).trim() &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : null;

export async function locateNpmCli({
  env = process.env,
  home = os.homedir(),
} = {}) {
  const dirs = [
    ...(env.PATH || env.Path || "")
      .split(path.delimiter)
      .map((v) => v.trim().replace(/^"(.*)"$/, "$1")),
    path.dirname(process.execPath),
    env.ProgramFiles && path.join(env.ProgramFiles, "nodejs"),
    env.APPDATA && path.join(env.APPDATA, "npm"),
    path.join(home, "AppData", "Roaming", "npm"),
  ].filter((v) => v && path.isAbsolute(v));
  for (const dir of new Set(dirs)) {
    for (const file of [
      path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
      path.resolve(dir, "../lib/node_modules/npm/bin/npm-cli.js"),
    ]) {
      if ((await fs.stat(file).catch(() => null))?.isFile()) return file;
    }
  }
  return null;
}

export function klingEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env))
    if (
      /^(?:NAKAMA_|NODE_OPTIONS$|NODE_PATH$|npm_config_|KLING_(?!HOME$))/i.test(
        key,
      )
    )
      delete env[key];
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  env.KLING_NONINTERACTIVE = "1";
  return env;
}

// Nakama starts npm's JavaScript entry with separate arguments. npm exec uses
// its own platform wrapper, so generation inputs are canonicalised/validated
// before this boundary and project/user npm configuration cannot replace it.
export async function runKling(
  args,
  {
    env = process.env,
    timeoutMs = 90000,
    beforeSpawn = () => {},
    spawnProcess = spawn,
  } = {},
) {
  const npm = await locateNpmCli({ env });
  if (!npm)
    throw new ApiError(
      409,
      "Install Node.js with npm, then reopen Nakama to connect Kling.",
    );
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nakama-kling-run-"),
  );
  const userConfig = path.join(directory, "user.npmrc");
  const globalConfig = path.join(directory, "global.npmrc");
  try {
    await Promise.all([
      fs.writeFile(userConfig, ""),
      fs.writeFile(globalConfig, ""),
    ]);
    const scriptShell =
      process.platform === "win32"
        ? path.join(env.SystemRoot || "C:\\Windows", "System32", "cmd.exe")
        : "/bin/sh";
    return await new Promise((resolve, reject) => {
      beforeSpawn();
      const child = spawnProcess(
        process.execPath,
        [
          npm,
          "exec",
          "--yes",
          "--registry=https://registry.npmjs.org",
          `--package=${KLING_PACKAGE}`,
          "--ignore-scripts",
          `--userconfig=${userConfig}`,
          `--globalconfig=${globalConfig}`,
          `--script-shell=${scriptShell}`,
          "--",
          "kling",
          ...args,
        ],
        {
          shell: false,
          windowsHide: true,
          cwd: directory,
          env: klingEnvironment(env),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        bytes = 0,
        stopped = false;
      const fail = () => {
        if (stopped) return;
        stopped = true;
        child.kill();
        reject(
          new ApiError(
            502,
            "Kling did not return a usable response. A submitted video may still be running; do not submit it again.",
          ),
        );
      };
      const timer = setTimeout(fail, timeoutMs);
      child.stdout.on("data", (data) => {
        bytes += data.length;
        if (bytes > 2_000_000) fail();
        else stdout += data;
      });
      // CLI stderr may include prompts or account diagnostics; never retain it.
      child.stderr.on("data", (data) => {
        bytes += data.length;
        if (bytes > 2_000_000) fail();
      });
      child.on("error", () => {
        clearTimeout(timer);
        fail();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (!stopped) {
          stopped = true;
          resolve({ code, stdout });
        }
      });
    });
  } finally {
    if (
      path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith("nakama-kling-run-")
    )
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function decode(result) {
  let value;
  try {
    value =
      typeof result?.stdout === "string" ? JSON.parse(result.stdout) : result;
  } catch {
    /* No raw output in the error. */
  }
  if (
    (result?.code !== undefined && result.code !== 0) ||
    !value ||
    value.ok !== true ||
    value.body?.isError === true ||
    value.body?.success === false ||
    value.body?.ok === false
  )
    throw new ApiError(
      502,
      "Kling could not complete this request. Check your official Kling CLI login and account, then refresh. Do not repeat an uncertain video submission.",
    );
  return value.body;
}

export function normalizeCatalogue(who, tools) {
  const list = Array.isArray(tools) ? tools : tools?.tools;
  const tool = list?.find((v) => v.name === "text_to_video");
  const envelope = tool?.inputSchema;
  if (
    !tool ||
    envelope?.type !== "object" ||
    envelope.properties?.model?.type !== "string" ||
    envelope.properties?.arguments?.type !== "array" ||
    (envelope.required || []).some(
      (key) =>
        !["model", "arguments", "rationale", "taskTraceId"].includes(key),
    )
  )
    throw new ApiError(
      502,
      "Kling did not advertise a supported text-to-video tool schema. Refresh after checking your account access.",
    );
  const names = envelope.properties.arguments.items?.properties?.name?.enum;
  const entry = (who?.availableModels || who?.available_models)?.text_to_video;
  const rawModels = Array.isArray(entry) ? entry : entry?.models;
  const models = [];
  for (const item of (Array.isArray(rawModels) ? rawModels : []).slice(
    0,
    100,
  )) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(item?.model || "") ||
      !Array.isArray(item.arguments)
    )
      continue;
    if (
      envelope.properties.model.enum &&
      !envelope.properties.model.enum.includes(item.model)
    )
      continue;
    if (
      Array.isArray(item.inputs) &&
      item.inputs.some((v) => v.required === true)
    )
      continue;
    const properties = {},
      required = [],
      defaults = {};
    let unsupported = false;
    for (const arg of item.arguments) {
      if (arg.name === "prompt") continue;
      if (names && (!Array.isArray(names) || !names.includes(arg.name))) {
        unsupported = true;
        break;
      }
      if (
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(arg.name || "") ||
        reserved.test(arg.name) ||
        Object.hasOwn(properties, arg.name)
      ) {
        unsupported = true;
        break;
      }
      const allowed = arg.allowedValues ?? arg.allowed_values;
      if (
        allowed !== undefined &&
        (!Array.isArray(allowed) ||
          allowed.length > 200 ||
          allowed.some(
            (v) => !["string", "number", "boolean"].includes(typeof v),
          ))
      ) {
        unsupported = true;
        break;
      }
      const spec = { type: "string", description: text(arg.description, 500) };
      if (allowed?.length) spec.enum = allowed.map(String);
      if (arg.default !== undefined && arg.default !== null) {
        if (!["string", "number", "boolean"].includes(typeof arg.default)) {
          unsupported = true;
          break;
        }
        spec.default = String(arg.default);
        if (
          spec.default.length > 4000 ||
          /[\u0000-\u001f\u007f]/.test(spec.default)
        ) {
          unsupported = true;
          break;
        }
        if (spec.enum && !spec.enum.includes(spec.default)) {
          unsupported = true;
          break;
        }
        defaults[arg.name] = spec.default;
      }
      properties[arg.name] = spec;
      if (arg.required === true) required.push(arg.name);
    }
    if (!unsupported)
      models.push({
        id: item.model,
        name: item.model,
        label: text(item.alias) || item.model,
        description: text(item.description, 1000),
        parameters: {
          type: "object",
          properties,
          required,
          additionalProperties: false,
        },
        required,
        defaults,
      });
  }
  if (!models.length)
    throw new ApiError(
      502,
      "Kling returned no supported text-to-video model declarations. No video was submitted.",
    );
  const identity =
    who?.userId ??
    who?.user_id ??
    who?.accountId ??
    who?.account_id ??
    who?.user?.id;
  return {
    command: "text_to_video",
    models,
    accountId: ["string", "number"].includes(typeof identity)
      ? crypto.createHash("sha256").update(`kling:${identity}`).digest("hex")
      : null,
    discoveredAt: new Date().toISOString(),
  };
}

export function validateVideoRequest(request, catalogue) {
  if (
    !record(request) ||
    Object.keys(request).some(
      (v) => !["prompt", "model", "parameters", "projectId"].includes(v),
    )
  )
    throw new ApiError(
      400,
      "Use a prompt, a discovered model and its declared parameters.",
    );
  const prompt =
    typeof request.prompt === "string"
      ? request.prompt.trim().replace(/[\r\n\t]+/g, " ")
      : "";
  if (
    !prompt ||
    prompt.length > 12000 ||
    /[\u0000-\u001f\u007f]/.test(prompt) ||
    prompt.startsWith("-")
  )
    throw new ApiError(
      400,
      "Enter a video prompt of 1–12000 characters that does not start with a hyphen.",
    );
  const model = catalogue?.models?.find((v) => v.id === request.model);
  if (!model)
    throw new ApiError(
      400,
      "Choose a model from the refreshed Kling catalogue.",
    );
  const supplied = request.parameters ?? {};
  if (!record(supplied) || Object.keys(supplied).length > 60)
    throw new ApiError(
      400,
      "Video parameters must be an object of declared values.",
    );
  const parameters = { ...model.defaults };
  for (const [key, value] of Object.entries(supplied)) {
    const spec = model.parameters.properties[key];
    if (
      !Object.hasOwn(model.parameters.properties, key) ||
      reserved.test(key) ||
      !["string", "boolean", "number"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw new ApiError(
        400,
        "That video parameter is not supported by the selected model.",
      );
    const string = String(value);
    if (
      !string ||
      string.length > 4000 ||
      /[\u0000-\u001f\u007f]/.test(string) ||
      (spec.enum && !spec.enum.includes(string))
    )
      throw new ApiError(400, `Choose a supported value for ${key}.`);
    parameters[key] = string;
  }
  for (const key of model.required)
    if (!Object.hasOwn(parameters, key))
      throw new ApiError(400, `The selected model requires ${key}.`);
  if (
    request.projectId !== undefined &&
    (typeof request.projectId !== "string" ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(request.projectId))
  )
    throw new ApiError(400, "Choose a valid Nakama project.");
  return {
    prompt,
    model: model.id,
    parameters,
    ...(request.projectId ? { projectId: request.projectId } : {}),
  };
}

export function normalizeAccount(body) {
  const source = record(body?.data) ? body.data : body;
  const credits =
    source?.availableCredits ??
    source?.available_credits ??
    source?.remainingCredits ??
    source?.remaining_credits ??
    source?.availablePoints ??
    source?.available_points ??
    source?.credits?.available ??
    source?.points?.available;
  const membership =
    source?.membershipType ??
    source?.membership_type ??
    source?.membership?.type ??
    (typeof source?.membership === "string" ? source.membership : null);
  return {
    availableCredits: numeric(credits),
    membership: typeof membership === "string" ? text(membership, 80) : null,
    checkedAt: new Date().toISOString(),
  };
}

export function normalizeTask(body, fallbackId = null) {
  const nested = Array.isArray(body?.generations)
    ? fallbackId
      ? body.generations.find(
          (v) => String(v.generationId ?? v.generation_id) === fallbackId,
        )
      : body.generations.length === 1
        ? body.generations[0]
        : null
    : null;
  if (Array.isArray(body?.generations) && !nested)
    throw new ApiError(
      502,
      "Kling returned a different task. The existing job was not changed.",
    );
  const source = nested?.result ?? body?.data ?? body;
  const id =
    source?.generationId ??
    source?.generation_id ??
    nested?.generationId ??
    fallbackId;
  const generationId =
    ["string", "number"].includes(typeof id) &&
    /^[A-Za-z0-9_-]{1,200}$/.test(String(id))
      ? String(id)
      : null;
  if (fallbackId && generationId !== fallbackId)
    throw new ApiError(
      502,
      "Kling returned a different task. The existing job was not changed.",
    );
  const status = text(
    String(source?.status ?? nested?.status ?? "unknown"),
    80,
  ).toLowerCase();
  const terminal =
    /^(success|succeed|succeeded|successful|completed|complete|partial|partial_completed|partially_completed|partially_succeeded|failed|failure|cancelled|canceled)$/.test(
      status,
    );
  const works = [];
  for (const [index, work] of (Array.isArray(source?.works) ? source.works : [])
    .slice(0, 20)
    .entries()) {
    try {
      const url = new URL(work.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        String(work.url).length > 12000
      )
        continue;
      works.push({
        index,
        url: url.href,
        contentType:
          text(work.contentType ?? work.content_type ?? work.type, 100) ||
          "video",
      });
    } catch {
      /* Only primary HTTPS result URLs are exposed. */
    }
  }
  return {
    generationId,
    status,
    terminal,
    works,
    creditsConsumed: numeric(
      source?.creditsConsumed ?? source?.credits_consumed,
    ),
    checkedAt: new Date().toISOString(),
  };
}

export class KlingCli {
  constructor({ run = runKling, env = process.env, timeoutMs = 90000 } = {}) {
    this.run = run;
    this.options = { env, timeoutMs };
  }
  async status() {
    const installed = !!(await locateNpmCli(this.options));
    return {
      installed,
      detail: installed
        ? "Node/npm is ready. Refresh connects through the official Kling CLI; npm may download its pinned package on first use."
        : "Install Node.js with npm, reopen Nakama, then sign in to Kling.",
      package: KLING_PACKAGE,
    };
  }
  async call(command, args = [], options = {}) {
    return decode(
      await this.run([command, ...args, ...shared], {
        ...this.options,
        ...options,
      }),
    );
  }
  async discover() {
    const who = await this.call("who_am_i");
    const tools = await this.call("tool_list");
    return normalizeCatalogue(who, tools);
  }
  async account() {
    return normalizeAccount(await this.call("account"));
  }
  async query(generationId) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(generationId || ""))
      throw new ApiError(400, "A valid Kling generation ID is required.");
    return normalizeTask(
      await this.call("query_tasks", [generationId, "--poll", "0"]),
      generationId,
    );
  }
  async submit(request, catalogue, { beforeSubmit = () => {} } = {}) {
    const input = validateVideoRequest(request, catalogue);
    const args = [
      `--model=${input.model}`,
      ...Object.entries(input.parameters).map(
        ([key, value]) => `--${key}=${value}`,
      ),
      "--poll",
      "0",
      input.prompt,
    ];
    const account = await this.account();
    if (account.availableCredits === null || account.availableCredits <= 0)
      throw new ApiError(
        409,
        "Kling credits are unavailable or empty. Verify your balance before approving a video; no submission was made.",
      );
    // A lost or rejected response must never cause an automatic replacement.
    return normalizeTask(
      await this.call("text_to_video", args, { beforeSpawn: beforeSubmit }),
    );
  }
}
