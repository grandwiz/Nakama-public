import https from "node:https";
import tls from "node:tls";
import crypto from "node:crypto";

export function bridgeConfig(env = process.env) {
  let url;
  try {
    url = new URL(env.NAKAMA_KLING_URL || "https://127.0.0.1:43110");
  } catch {
    throw new Error("Kling MCP needs a valid Nakama localhost HTTPS address.");
  }
  if (
    url.protocol !== "https:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Kling MCP only connects to Nakama HTTPS on this PC.");
  const fingerprint = (env.NAKAMA_KLING_FINGERPRINT || "")
    .replaceAll(":", "")
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint))
    throw new Error(
      "Copy the current Kling MCP configuration from Nakama; its certificate fingerprint is required.",
    );
  const token = env.NAKAMA_KLING_TOKEN || "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw new Error(
      "Copy the current Kling MCP configuration from Nakama; its scoped connection token is required.",
    );
  return {
    host: url.hostname === "[::1]" ? "::1" : "127.0.0.1",
    port: Number(url.port || 443),
    fingerprint,
    token,
  };
}

export function verifyPinnedCertificate(cert, fingerprint, now = Date.now()) {
  if (
    !cert?.raw ||
    !Number.isFinite(Date.parse(cert.valid_from)) ||
    !Number.isFinite(Date.parse(cert.valid_to)) ||
    now < Date.parse(cert.valid_from) ||
    now > Date.parse(cert.valid_to)
  )
    throw new Error(
      "Nakama's certificate is missing or expired. Refresh the MCP connection in Control Center.",
    );
  const actual = crypto.createHash("sha256").update(cert.raw).digest();
  const expected = Buffer.from(fingerprint, "hex");
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(actual, expected)
  )
    throw new Error(
      "Nakama's certificate changed. Refresh the MCP connection in Control Center.",
    );
}

class PinnedAgent extends https.Agent {
  constructor(config) {
    super({ keepAlive: false, maxCachedSessions: 0 });
    this.config = config;
  }
  createConnection(options, callback) {
    const socket = tls.connect({
      ...options,
      host: this.config.host,
      rejectUnauthorized: false,
    });
    let complete = false;
    const fail = (error) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      callback(error);
    };
    socket.once("error", fail);
    socket.setTimeout(15000, () =>
      fail(new Error("Nakama TLS handshake timed out.")),
    );
    socket.once("secureConnect", () => {
      try {
        verifyPinnedCertificate(
          socket.getPeerCertificate(),
          this.config.fingerprint,
        );
      } catch (error) {
        fail(error);
        return;
      }
      if (complete) return;
      complete = true;
      socket.setTimeout(0);
      socket.removeListener("error", fail);
      callback(null, socket);
    });
    // Returning a socket here would send the token before our pin check finishes.
    return undefined;
  }
}

const routes = new Set([
  "GET /api/kling/status",
  "GET /api/kling/catalogue",
  "GET /api/kling/account",
  "GET /api/kling/jobs",
  "POST /api/kling/prepare",
]);
function allowed(method, route) {
  return (
    routes.has(`${method} ${route}`) ||
    (method === "POST" &&
      /^\/api\/kling\/jobs\/[A-Za-z0-9_-]{1,200}\/poll$/.test(route))
  );
}
function safeOutput(value, depth = 0) {
  if (depth > 20) throw new Error("Nakama returned an unsupported response.");
  if (Array.isArray(value)) return value.map((v) => safeOutput(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/(?:token|secret|password|cookie|credential|authorization)/i.test(
              key,
            ),
        )
        .map(([key, v]) => [key, safeOutput(v, depth + 1)]),
    );
  return value;
}

export function createBridgeClient(
  config = bridgeConfig(),
  { timeoutMs = 120000 } = {},
) {
  const agent = new PinnedAgent(config);
  return {
    async request(method, route, body, { signal } = {}) {
      if (!allowed(method, route))
        throw new Error(
          "This MCP connection cannot access that Nakama operation.",
        );
      const payload = body === undefined ? undefined : JSON.stringify(body);
      if (payload && Buffer.byteLength(payload) > 32000)
        throw new Error("The video request is too large.");
      return new Promise((resolve, reject) => {
        const req = https.request(
          {
            host: config.host,
            port: config.port,
            path: route,
            method,
            agent,
            signal,
            headers: {
              authorization: `Bearer ${config.token}`,
              accept: "application/json",
              ...(payload
                ? {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(payload),
                  }
                : {}),
            },
          },
          (res) => {
            let raw = "",
              bytes = 0;
            res.on("data", (data) => {
              bytes += data.length;
              if (bytes > 256000) req.destroy(new Error("Response too large"));
              else raw += data;
            });
            res.on("end", () => {
              if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(
                  new Error(
                    res.statusCode === 401 || res.statusCode === 403
                      ? "Kling MCP connection is disabled or revoked. Reconnect in Windows Control Center."
                      : "Nakama could not complete this Kling request. Open Kling video in Windows Control Center for details; do not resubmit an uncertain video.",
                  ),
                );
                return;
              }
              try {
                resolve(safeOutput(JSON.parse(raw)));
              } catch {
                reject(new Error("Nakama returned an unreadable response."));
              }
            });
          },
        );
        req.setTimeout(timeoutMs, () =>
          req.destroy(new Error("Request timed out")),
        );
        const deadline = setTimeout(
          () => req.destroy(new Error("Request timed out")),
          timeoutMs,
        );
        req.once("close", () => clearTimeout(deadline));
        req.on("error", () =>
          reject(
            new Error(
              "Cannot securely reach Nakama. Keep Control Center open and check the current Kling MCP configuration. Do not resubmit an uncertain video.",
            ),
          ),
        );
        req.end(payload);
      });
    },
    close() {
      agent.destroy();
    },
  };
}
