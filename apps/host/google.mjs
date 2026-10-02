import http from "node:http";
import crypto from "node:crypto";
import { ApiError, uid, now, text, secret } from "./security.mjs";

const SCOPES = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
};
const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
async function responseJson(response, max = 1024 * 1024) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(
      409,
      `Google returned HTTP ${response.status}; the action is not confirmed.`,
    );
  }
  if (response.status === 204) return {};
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new ApiError(502, "Google returned too much data.");
  }
  if (!response.body)
    throw new ApiError(502, "Google returned an empty response.");
  const reader = response.body.getReader(),
    parts = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) {
        await reader.cancel();
        throw new ApiError(502, "Google returned too much data.");
      }
      parts.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(parts, length).toString("utf8"));
  } catch {
    throw new ApiError(502, "Google returned invalid JSON.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new ApiError(502, "Google returned an unexpected response.");
  return result;
}
function tokenData(tokens, previous = {}) {
  if (
    typeof tokens.access_token !== "string" ||
    !tokens.access_token ||
    tokens.access_token.length > 16000 ||
    /[\r\n]/.test(tokens.access_token) ||
    typeof tokens.token_type !== "string" ||
    tokens.token_type.toLowerCase() !== "bearer" ||
    !Number.isFinite(tokens.expires_in) ||
    tokens.expires_in <= 0 ||
    tokens.expires_in > 86400
  )
    throw new ApiError(
      409,
      "Google did not return a valid access token. Reconnect this account.",
    );
  if (
    tokens.refresh_token !== undefined &&
    (typeof tokens.refresh_token !== "string" ||
      !tokens.refresh_token ||
      tokens.refresh_token.length > 16000)
  )
    throw new ApiError(409, "Google returned an invalid refresh token.");
  return {
    ...previous,
    access_token: tokens.access_token,
    token_type: "Bearer",
    refresh_token: tokens.refresh_token || previous.refresh_token,
    scope: typeof tokens.scope === "string" ? tokens.scope : previous.scope,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}
function calendarId(value = "primary") {
  const id = text(value, "Calendar ID", 500);
  if (id === "." || id === ".." || /[\/\\\0]/.test(id))
    throw new ApiError(400, "Choose a valid calendar ID.");
  return encodeURIComponent(id);
}
export function mailPayload({ to, subject, body }) {
  if (
    typeof to !== "string" ||
    to.length > 320 ||
    !emailPattern.test(to) ||
    /[,;:"()\\\x00-\x1f\x7f]/.test(to) ||
    typeof subject !== "string" ||
    /[\x00-\x1f\x7f]/.test(subject) ||
    subject.length > 500 ||
    typeof body !== "string" ||
    body.length > 100000
  )
    throw new ApiError(
      400,
      "Provide one valid recipient, a single-line subject, and a message under 100,000 characters.",
    );
  const encodedSubject = Buffer.from(subject, "utf8").toString("base64");
  return {
    raw: Buffer.from(
      `To: ${to}\r\nSubject: =?UTF-8?B?${encodedSubject}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body, "utf8").toString("base64")}`,
    ).toString("base64url"),
  };
}
export function calendarPayload(body) {
  const summary = text(body.summary, "Event title", 300);
  const start = Date.parse(body.start),
    end = Date.parse(body.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    typeof body.start !== "string" ||
    typeof body.end !== "string" ||
    !/(Z|[+-]\d\d:\d\d)$/.test(body.start) ||
    !/(Z|[+-]\d\d:\d\d)$/.test(body.end)
  )
    throw new ApiError(
      400,
      "Use explicit start and end dates with timezone offsets; end must follow start.",
    );
  const result = {
    summary,
    start: { dateTime: new Date(start).toISOString() },
    end: { dateTime: new Date(end).toISOString() },
  };
  if (body.description)
    result.description = text(body.description, "Description", 10000);
  if (body.location) result.location = text(body.location, "Location", 1000);
  return result;
}
export class GoogleAccounts {
  constructor({ store, vault, fetchImpl = fetch }) {
    this.store = store;
    this.vault = vault;
    this.fetch = fetchImpl;
    this.pending = new Set();
    this.refreshing = new Map();
    this.removing = new Set();
    this.abort = new AbortController();
  }
  async fetchJson(url, options = {}, max) {
    if (this.abort.signal.aborted)
      throw new ApiError(503, "Google connections are closed.");
    try {
      return await responseJson(
        await this.fetch(url, {
          ...options,
          redirect: "error",
          signal: AbortSignal.any([
            this.abort.signal,
            AbortSignal.timeout(15000),
          ]),
        }),
        max,
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        409,
        "Google could not confirm this request. Check the account before repeating a write.",
      );
    }
  }
  accounts() {
    return this.store.state.googleAccounts || [];
  }
  account(id, service) {
    const account = this.accounts().find((a) => a.id === id);
    if (!account) throw new ApiError(404, "Google account not found.");
    if (service && !account.services.includes(service))
      throw new ApiError(
        403,
        "This account has not granted the required service.",
      );
    return account;
  }
  async connect(body) {
    if (!this.vault)
      throw new ApiError(
        503,
        "Google connections require the desktop credential vault.",
      );
    if (this.abort.signal.aborted)
      throw new ApiError(503, "Google connections are closed.");
    if (this.pending.size >= 3)
      throw new ApiError(
        429,
        "Finish or cancel an existing Google sign-in first.",
      );
    const clientId = text(body.clientId, "Google desktop OAuth client ID", 250);
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId))
      throw new ApiError(
        400,
        "Use a Google OAuth client ID for a Desktop app.",
      );
    const services = Array.isArray(body.services)
      ? [...new Set(body.services)]
      : ["gmail", "calendar"];
    if (!services.length || services.some((s) => !SCOPES[s]))
      throw new ApiError(400, "Choose Gmail, Calendar, or both.");
    const state = secret(),
      verifier = secret(),
      challenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url"),
      label =
        typeof body.label === "string"
          ? body.label.slice(0, 100)
          : "Personal Google account";
    const clientSecret = body.clientSecret
      ? text(body.clientSecret, "OAuth client secret", 2000)
      : undefined;
    let redirectUri,
      timer,
      consumed = false;
    const expiresAt = Date.now() + 300000;
    const server = http.createServer(async (req, res) => {
      const finish = (code, message) => {
        res.writeHead(code, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(message);
      };
      let url;
      try {
        url = new URL(req.url, "http://127.0.0.1");
      } catch {
        finish(400, "Invalid callback URL.");
        return;
      }
      if (
        req.headers.host !== new URL(redirectUri).host ||
        !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)
      ) {
        finish(400, "Invalid callback host.");
        return;
      }
      if (req.method !== "GET" || url.pathname !== "/oauth/google/callback") {
        finish(404, "Not found");
        return;
      }
      if (this.abort.signal.aborted || Date.now() >= expiresAt) {
        finish(400, "This Google sign-in expired. Start again from Nakama.");
        return;
      }
      if (
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== state
      ) {
        finish(400, "OAuth state mismatch. Return to Nakama and start again.");
        return;
      }
      if (consumed) {
        finish(409, "This sign-in has already been processed.");
        return;
      }
      consumed = true;
      clearTimeout(timer);
      server.close();
      this.pending.delete(server);
      if (url.searchParams.has("error")) {
        finish(
          400,
          "Google sign-in was not completed. You can close this window.",
        );
        return;
      }
      try {
        const code = url.searchParams.get("code");
        if (
          url.searchParams.getAll("code").length !== 1 ||
          !code ||
          code.length > 4096
        )
          throw new ApiError(400, "Missing or invalid authorization code.");
        const params = new URLSearchParams({
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          ...(clientSecret ? { client_secret: clientSecret } : {}),
        });
        const tokens = tokenData(
          await this.fetchJson(
            "https://oauth2.googleapis.com/token",
            { method: "POST", body: params },
            65536,
          ),
        );
        const profile = await this.fetchJson(
          "https://openidconnect.googleapis.com/v1/userinfo",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } },
          65536,
        );
        if (
          typeof profile.sub !== "string" ||
          !profile.sub ||
          typeof profile.email !== "string" ||
          !emailPattern.test(profile.email) ||
          profile.email_verified !== true
        )
          throw new ApiError(
            409,
            "Google account identity could not be verified.",
          );
        const granted = (tokens.scope || "").split(" ");
        const actualServices = services.filter((service) =>
          SCOPES[service].every((scope) => granted.includes(scope)),
        );
        if (!actualServices.length)
          throw new Error(
            "The required Gmail or Calendar permissions were not granted.",
          );
        if (this.abort.signal.aborted)
          throw new ApiError(503, "Google sign-in was stopped.");
        const id = uid();
        await this.vault.set(
          `google:${id}`,
          JSON.stringify({ ...tokens, clientId, clientSecret }),
        );
        try {
          await this.store.change((s) => {
            if (this.abort.signal.aborted)
              throw new ApiError(503, "Google sign-in was stopped.");
            s.googleAccounts ??= [];
            s.googleAccounts.push({
              id,
              label,
              email: profile.email,
              services: actualServices,
              status: "connected",
              connectedAt: now(),
            });
            for (const service of actualServices) {
              const c = s.connections.find((c) => c.id === service);
              if (c) {
                c.status = "connected";
                c.accountLabel = profile.email;
                c.detail =
                  "Connected with Google OAuth. Choose the account for each action.";
              }
            }
          });
        } catch (error) {
          await this.vault.set(`google:${id}`, "");
          throw error;
        }
        finish(
          200,
          "Connected to Nakama. You can close this browser tab and return to Control Center.",
        );
      } catch (error) {
        finish(
          400,
          `${error instanceof ApiError ? error.message : "Google sign-in could not be saved."} Return to Nakama and try again.`,
        );
      }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    this.pending.add(server);
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    } catch (error) {
      this.pending.delete(server);
      throw error;
    }
    if (this.abort.signal.aborted) {
      server.close();
      this.pending.delete(server);
      throw new ApiError(503, "Google connections are closed.");
    }
    redirectUri = `http://127.0.0.1:${server.address().port}/oauth/google/callback`;
    timer = setTimeout(
      () => {
        server.close();
        this.pending.delete(server);
      },
      5 * 60 * 1000,
    );
    timer.unref?.();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: ["openid", "email", ...services.flatMap((s) => SCOPES[s])].join(
        " ",
      ),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent select_account",
    }).toString();
    return {
      url: url.toString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    };
  }
  async accessToken(id, service) {
    this.account(id, service);
    if (this.removing.has(id) || this.abort.signal.aborted)
      throw new ApiError(409, "This Google connection was stopped.");
    if (this.refreshing.has(id)) return this.refreshing.get(id);
    const pending = this.refreshToken(id).finally(() =>
      this.refreshing.delete(id),
    );
    this.refreshing.set(id, pending);
    return pending;
  }
  async refreshToken(id) {
    const raw = await this.vault?.get(`google:${id}`);
    if (!raw) throw new ApiError(409, "Reconnect this Google account.");
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      throw new ApiError(409, "Reconnect this Google account.");
    }
    if (saved.expiresAt > Date.now() + 60000) return saved.access_token;
    if (!saved.refresh_token)
      throw new ApiError(
        409,
        "This connection expired. Reconnect and grant offline access.",
      );
    const params = new URLSearchParams({
      client_id: saved.clientId,
      refresh_token: saved.refresh_token,
      grant_type: "refresh_token",
      ...(saved.clientSecret ? { client_secret: saved.clientSecret } : {}),
    });
    const tokens = tokenData(
      await this.fetchJson(
        "https://oauth2.googleapis.com/token",
        { method: "POST", body: params },
        65536,
      ),
      saved,
    );
    if (this.removing.has(id) || this.abort.signal.aborted)
      throw new ApiError(409, "This Google connection was stopped.");
    this.account(id);
    await this.vault.set(`google:${id}`, JSON.stringify(tokens));
    return tokens.access_token;
  }
  async request(id, service, url, { method = "GET", body } = {}) {
    const target = new URL(url),
      valid =
        target.protocol === "https:" &&
        !target.username &&
        !target.password &&
        !target.port &&
        !target.hash &&
        (service === "gmail"
          ? target.hostname === "gmail.googleapis.com" &&
            target.pathname.startsWith("/gmail/v1/users/me/")
          : service === "calendar" &&
            target.hostname === "www.googleapis.com" &&
            target.pathname.startsWith("/calendar/v3/"));
    if (!valid)
      throw new ApiError(400, "The Google API destination is not allowed.");
    const token = await this.accessToken(id, service);
    this.account(id, service);
    if (this.removing.has(id))
      throw new ApiError(409, "This Google connection was stopped.");
    return this.fetchJson(target.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async messages(id, query = "") {
    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    url.search = new URLSearchParams({
      q: String(query).slice(0, 500),
      maxResults: "10",
    });
    const listing = await this.request(id, "gmail", url);
    const messages = await Promise.all(
      (Array.isArray(listing.messages) ? listing.messages : [])
        .slice(0, 10)
        .map(async (message) => {
          if (
            typeof message.id !== "string" ||
            !/^[A-Za-z0-9_-]{1,200}$/.test(message.id)
          )
            throw new ApiError(502, "Google returned an invalid message ID.");
          const detail = await this.request(
            id,
            "gmail",
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          );
          return {
            id: detail.id,
            snippet: detail.snippet,
            headers: detail.payload?.headers || [],
          };
        }),
    );
    return { messages };
  }
  send(id, body) {
    return this.request(
      id,
      "gmail",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { method: "POST", body: mailPayload(body) },
    );
  }
  calendars(id) {
    return this.request(
      id,
      "calendar",
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    );
  }
  events(id, selected = "primary") {
    return this.request(
      id,
      "calendar",
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId(selected)}/events?singleEvents=true&orderBy=startTime&maxResults=25&timeMin=${encodeURIComponent(now())}`,
    );
  }
  createEvent(id, body) {
    return this.request(
      id,
      "calendar",
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId(body.calendarId || "primary")}/events`,
      { method: "POST", body: calendarPayload(body) },
    );
  }
  async disconnect(id) {
    this.account(id);
    this.removing.add(id);
    try {
      await this.refreshing.get(id)?.catch(() => {});
      await this.vault.set(`google:${id}`, "");
      return await this.store.change((s) => {
        s.googleAccounts = s.googleAccounts.filter((a) => a.id !== id);
        for (const service of ["gmail", "calendar"])
          if (!s.googleAccounts.some((a) => a.services.includes(service))) {
            const c = s.connections.find((c) => c.id === service);
            if (c) {
              c.status = "not_configured";
              c.accountLabel = "";
            }
          }
        return { disconnected: true };
      });
    } finally {
      this.removing.delete(id);
    }
  }
  close() {
    this.abort.abort();
    for (const server of this.pending) server.close();
    this.pending.clear();
  }
}
