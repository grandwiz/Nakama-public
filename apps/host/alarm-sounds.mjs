import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ApiError, uid, now, text } from "./security.mjs";
import { assertPersonalAccess } from "./personal-access.mjs";
import { originId } from "./device-delivery.mjs";
import { routineTargets } from "./personal-boards.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const plain = value => String(value || "").replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").slice(0, 500);
const MAX_AUDIO = 4 * 1024 * 1024;
export function soundQuery(value) {
  const result = text(value, "Alarm sound description", 120);
  if (/[\x00-\x1f<>`;]|https?:|\b(?:do not|don't|never)\b/i.test(result)) throw new ApiError(400, "Describe the sound to find, such as birds chirping or ocean waves.");
  return result;
}
export function checkedWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 46 || bytes.length > 1_323_044 || bytes.toString("ascii",0,4) !== "RIFF" || bytes.toString("ascii",8,12) !== "WAVE" || bytes.toString("ascii",12,16) !== "fmt " || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 22050 || bytes.readUInt16LE(34) !== 16 || bytes.readUInt32LE(28) !== 44100 || bytes.readUInt16LE(32) !== 2 || (bytes.length-44) % 2 !== 0 || bytes.toString("ascii",36,40) !== "data" || bytes.readUInt32LE(40) !== bytes.length - 44 || bytes.readUInt32LE(4) !== bytes.length - 8) throw new ApiError(502, "The audio clip failed its WAV validation.");
  return Math.round((bytes.length - 44) / 44100 * 1000);
}
export class AlarmSounds {
  constructor(host, { fetcher = fetch, decoder } = {}) {
    this.host = host; this.fetcher = fetcher; this.decoder = decoder; this.pending = new Map();
  }
  access(principal) { assertPersonalAccess(this.host.store.state, principal); }
  allowed(row, principal) {
    return principal.kind === "owner" || row.origin === originId(principal) || this.host.store.state.routineBoard.routines.some(r => r.soundId === row.id && routineTargets(r).includes(principal.id));
  }
  public(principal) {
    try { this.access(principal); } catch { return []; }
    return (this.host.store.state.alarmSoundLibrary || []).filter(row => this.allowed(row, principal)).map(({ file, origin, requestKey, requestDigest, ...row }) => row);
  }
  async read(url, max, principal, guard = () => {}) {
    this.access(principal); guard();
    const response = await this.fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Nakama/0.1 (https://github.com/grandwiz/Nakama-public; alarm sound search)" } });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > max) throw new ApiError(502, "The sound source is unavailable or too large.");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new ApiError(502, "The sound source exceeds the download limit."); chunks.push(Buffer.from(chunk)); }
    this.access(principal); guard();
    return Buffer.concat(chunks);
  }
  async create(body, principal, guard = () => {}) {
    this.access(principal); guard();
    const query = soundQuery(body.query);
    const startSeconds = body.startSeconds ?? 0, durationSeconds = body.durationSeconds ?? 15;
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 300 || !Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 30) throw new ApiError(400, "Choose a 1–30 second clip, starting within the first five minutes.");
    if (!this.decoder) throw new ApiError(503, "Open the Windows Control Center to prepare an alarm sound.");
    const requestDigest = hash(JSON.stringify({ query, startSeconds, durationSeconds }));
    const requestKey = body.requestId ? `${originId(principal)}:${text(body.requestId, "Request ID", 160)}` : null;
    const prior = requestKey && (this.host.store.state.alarmSoundLibrary || []).find(row => row.requestKey === requestKey);
    if (prior) { if (prior.requestDigest !== requestDigest) throw new ApiError(409, "Sound request changed. Use a new request ID."); return this.public(principal).find(row => row.id === prior.id); }
    if (requestKey && this.pending.has(requestKey)) {
      const pending = this.pending.get(requestKey);
      if (pending.digest !== requestDigest) throw new ApiError(409, "Sound request changed while preparing.");
      const result = await pending.promise; this.access(principal); guard(); return result;
    }
    const operation = this.prepare(query, startSeconds, durationSeconds, principal, guard, requestKey, requestDigest);
    if (requestKey) this.pending.set(requestKey, { digest: requestDigest, promise: operation });
    try { return await operation; } finally { if (requestKey) this.pending.delete(requestKey); }
  }
  async prepare(query, startSeconds, durationSeconds, principal, guard, requestKey, requestDigest) {
    if ((this.host.store.state.alarmSoundLibrary || []).length >= 100) throw new ApiError(409, "The alarm sound library is full. Remove unused sounds before adding more.");
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    for (const [key,value] of Object.entries({ action:"query", format:"json", generator:"search", gsrnamespace:"6", gsrsearch:`${query} filetype:audio`, gsrlimit:"10", prop:"imageinfo", iiprop:"url|mime|size|extmetadata" })) url.searchParams.set(key,value);
    const result = JSON.parse((await this.read(url, 1_000_000, principal, guard)).toString("utf8"));
    const candidates = Object.values(result.query?.pages || {}).sort((a,b) => (a.index || 0) - (b.index || 0));
    const candidate = candidates.find(page => {
      const info = page.imageinfo?.[0]; if (!info || !/^audio\/|^application\/ogg$/.test(info.mime || "") || info.size > MAX_AUDIO) return false;
      let source; try { source = new URL(info.url); } catch { return false; }
      return source.protocol === "https:" && source.hostname === "upload.wikimedia.org" && !source.username && !source.password && /^(?:CC0(?: 1\.0)?|CC BY(?:-SA)?(?: [1-4]\.0)?|Public domain)$/i.test(plain(info.extmetadata?.LicenseShortName?.value));
    });
    if (!candidate) throw new ApiError(404, "I could not find a downloadable, reusable audio match. Try a more specific sound description.");
    const info = candidate.imageinfo[0];
    const source = await this.read(info.url, MAX_AUDIO, principal, guard);
    const decoded = await this.decoder(source, { startSeconds, durationSeconds });
    this.access(principal); guard();
    const bytes = Buffer.from(decoded); const durationMs = checkedWav(bytes);
    if (durationMs < 500) throw new ApiError(400, "That start position leaves no usable sound. Choose an earlier start.");
    const id = uid(), file = `${id}.wav`, directory = path.join(this.host.store.dir, "alarm-sounds");
    const row = { id, name: query, file, origin: originId(principal), createdAt: now(), sha256: hash(bytes), byteLength: bytes.length, mimeType: "audio/wav", durationMs, sourceTitle: plain(candidate.title), sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(candidate.title)}`, license: plain(info.extmetadata?.LicenseShortName?.value), attribution: plain(info.extmetadata?.Artist?.value), requestKey, requestDigest };
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory,file), bytes, { flag: "wx" });
    try {
      await this.host.store.change(s => { this.access(principal); guard(); s.alarmSoundLibrary ||= []; if (s.alarmSoundLibrary.length >= 100) throw new ApiError(409, "Sound library is full."); s.alarmSoundLibrary.push(row); });
    } catch (error) { await fs.unlink(path.join(directory,file)).catch(() => {}); throw error; }
    return this.public(principal).find(item => item.id === id);
  }
  async audio(id, principal) {
    this.access(principal);
    const row = (this.host.store.state.alarmSoundLibrary || []).find(item => item.id === id);
    if (!row || !this.allowed(row,principal)) throw new ApiError(404, "Alarm sound unavailable for this device.");
    const bytes = await fs.readFile(path.join(this.host.store.dir,"alarm-sounds",`${row.id}.wav`));
    this.access(principal); if (!this.allowed(row,principal)) throw new ApiError(403, "Alarm sound access changed.");
    checkedWav(bytes); if (hash(bytes) !== row.sha256) throw new ApiError(409, "Alarm sound changed. Prepare it again.");
    return { id, sha256: row.sha256, byteLength: bytes.length, mimeType: row.mimeType, durationMs: row.durationMs, base64: bytes.toString("base64") };
  }
  async route(method, route, body, principal) {
    this.access(principal);
    if (route === "/api/alarm-sounds" && method === "GET") return { sounds: this.public(principal) };
    if (route === "/api/alarm-sounds" && method === "POST") return this.create(body, principal);
    const match = route.match(/^\/api\/alarm-sounds\/([a-f0-9-]+)\/audio$/);
    if (match && method === "GET") return this.audio(match[1], principal);
    throw new ApiError(404, "Unknown alarm sound operation.");
  }
}
