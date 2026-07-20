import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { db, getSetting } from "./db";
import { log } from "./logger";

// Files land in one global directory: a video downloaded once serves every
// profile. Retention below is the only thing that removes them.
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? resolve(import.meta.dir, "../../data/downloads");
mkdirSync(DOWNLOADS_DIR, { recursive: true });
const DOWNLOAD_COOKIES_FILE = resolve(import.meta.dir, "../../data/yt-dlp-cookies.txt");
const MAX_COOKIES_BYTES = 4 * 1024 * 1024;

const YTDLP = process.env.YTDLP_PATH ?? "yt-dlp";
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MIN = 30;
const CLEANUP_INTERVAL_MS = 10 * 60_000;
const TICK_INTERVAL_MS = 30_000;

// ---------- settings ----------
// Stored in the global `settings` table under plugin_downloads_<key> (written
// by the plugin settings framework with settingsScope = "global").

export const DL_DEFAULTS = {
  quality: "1080",
  watch_source_mode: "youtube",
  // Filename template, rendered server-side from the DB (so {channel} honours
  // the custom channel name). "/" creates subdirectories; the extension is
  // appended automatically; a missing {id} is added as " [id]" to keep files
  // unique and trackable.
  output_template: "{id}",
  write_thumbnail: 0,
  embed_metadata: 0,
  write_info_json: 0,
  write_nfo: 0,
  write_subs: 0,
  write_auto_subs: 0,
  sub_langs: "en",
  thumb_progress: 1,
  download_scheduled: 1,
  download_feed: 0,
  feed_max_age_hours: 48,
  download_shorts: 0,
  retention_days: 14,
  delete_watched: 1,
  delete_watched_hours: 24,
  keep_liked: 1,
  max_storage_gb: 25,
} as const;

export type DlSettings = { [K in keyof typeof DL_DEFAULTS]: (typeof DL_DEFAULTS)[K] extends number ? number : string };

export function dlSettings(): DlSettings {
  const out: Record<string, number | string> = {};
  for (const [key, def] of Object.entries(DL_DEFAULTS)) {
    const raw = getSetting(`plugin_downloads_${key}`);
    if (raw == null) { out[key] = def; continue; }
    out[key] = typeof def === "number" ? (Number.isFinite(Number(raw)) ? Number(raw) : def) : raw;
  }
  return out as DlSettings;
}

/** Cookie jar is deliberately stored outside the settings database, so it is
 * never returned by a settings API response or rendered back into the UI. */
export function downloadCookiesConfigured() {
  return existsSync(DOWNLOAD_COOKIES_FILE);
}

export function saveDownloadCookies(contents: string) {
  if (!contents.trim()) throw new Error("cookies file is empty");
  if (new TextEncoder().encode(contents).byteLength > MAX_COOKIES_BYTES) {
    throw new Error("cookies file is too large");
  }
  const normalized = contents.replace(/^\uFEFF/, "");
  if (!/^# (?:(?:Netscape )?HTTP Cookie File|Netscape Cookie File)\b/m.test(normalized)) {
    throw new Error("cookies must be in Netscape cookies.txt format");
  }
  const temporary = `${DOWNLOAD_COOKIES_FILE}.tmp`;
  writeFileSync(temporary, normalized, { mode: 0o600 });
  renameSync(temporary, DOWNLOAD_COOKIES_FILE);
  try { chmodSync(DOWNLOAD_COOKIES_FILE, 0o600); } catch { /* unsupported on some hosts */ }
}

export function removeDownloadCookies() {
  if (existsSync(DOWNLOAD_COOKIES_FILE)) unlinkSync(DOWNLOAD_COOKIES_FILE);
}

function dlEnabled(): boolean {
  const row = db.prepare("SELECT enabled FROM plugins WHERE id = 'downloads'").get() as { enabled: number } | null;
  return row?.enabled === 1;
}

// ---------- yt-dlp binary ----------

let ytdlpVersion: string | null | undefined;

export async function ytdlpStatus(): Promise<string | null> {
  if (ytdlpVersion !== undefined) return ytdlpVersion;
  try {
    const proc = Bun.spawn([YTDLP, "--version"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    ytdlpVersion = (await proc.exited) === 0 ? out.trim() : null;
  } catch {
    ytdlpVersion = null;
  }
  if (!ytdlpVersion) log.warn("downloads.ytdlp_missing", { path: YTDLP });
  return ytdlpVersion;
}

async function ytdlpSelfUpdate() {
  if (process.env.YTDLP_AUTO_UPDATE !== "1") return;
  try {
    const proc = Bun.spawn([YTDLP, "-U"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    ytdlpVersion = undefined; // re-read version on next status call
  } catch {}
}

// ---------- queue state ----------

interface ActiveDownload {
  videoId: string;
  proc: ReturnType<typeof Bun.spawn>;
  percent: number;
  totalBytes: number | null;
  speed: string | null;
  cancelled: boolean;
  // Preempted by a priority download: goes back to the queue and keeps its
  // .part files so yt-dlp resumes instead of restarting.
  preempted: boolean;
}

let active: ActiveDownload | null = null;

export function activeDownloadProgress(): { video_id: string; percent: number; total_bytes: number | null; speed: string | null } | null {
  if (!active) return null;
  return { video_id: active.videoId, percent: active.percent, total_bytes: active.totalBytes, speed: active.speed };
}

// ---------- output template ----------
// The template is rendered here (not by yt-dlp) so {channel} can use the
// user's custom channel name and so every produced file shares a known base —
// that's what lets cleanup find sidecars (.nfo, thumbnails, subtitles).

function sanitizePathComponent(segment: string): string {
  const cleaned = segment
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return cleaned;
}

export function renderOutputTemplate(videoId: string, template: string): string {
  const row = db.prepare(`
    SELECT v.title, v.published_at, v.channel_id,
           COALESCE(c.custom_title, c.title) AS channel_title
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `).get(videoId) as { title: string; published_at: string | null; channel_id: string; channel_title: string } | null;
  const date = row?.published_at?.slice(0, 10) ?? "";
  const values: Record<string, string> = {
    id: videoId,
    title: row?.title ?? videoId,
    channel: row?.channel_title || row?.channel_id || "",
    channel_id: row?.channel_id ?? "",
    date,
    year: date.slice(0, 4),
    month: date.slice(5, 7),
    day: date.slice(8, 10),
  };
  const rendered = (template.trim() || "{id}").replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
  // Sanitizing each segment also neutralises ".." (trailing dots stripped), so
  // the template can never escape the downloads directory.
  const segments = rendered.split("/").map(sanitizePathComponent).filter(Boolean);
  let base = segments.join("/") || videoId;
  // Without the id in the name two videos could collide on one file; the id is
  // also what maps legacy files back to their row.
  if (!base.includes(videoId)) base += ` [${videoId}]`;
  return base;
}

function outputBaseFor(videoId: string): string | null {
  const row = db.prepare("SELECT output_base FROM downloads WHERE video_id = ?").get(videoId) as { output_base: string | null } | null;
  return row?.output_base ?? null;
}

/** Every file produced for this base: the video itself plus sidecars (base.*). */
function filesForBase(base: string): string[] {
  const dir = join(DOWNLOADS_DIR, dirname(base));
  const name = basename(base);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f === name || f.startsWith(`${name}.`))
    .map((f) => join(dir, f));
}

function filesFor(videoId: string): string[] {
  const files = new Set<string>(filesForBase(videoId)); // legacy flat {id}.* layout
  const base = outputBaseFor(videoId);
  if (base && base !== videoId) for (const f of filesForBase(base)) files.add(f);
  return [...files];
}

function unlinkFiles(videoId: string) {
  for (const f of filesFor(videoId)) {
    try { unlinkSync(f); } catch {}
  }
  pruneEmptyDirs(outputBaseFor(videoId));
}

/** Remove now-empty template subdirectories, walking up to the downloads root. */
function pruneEmptyDirs(base: string | null) {
  if (!base) return;
  const root = resolve(DOWNLOADS_DIR);
  let dir = resolve(DOWNLOADS_DIR, dirname(base));
  while (dir !== root && dir.startsWith(root + "/")) {
    try {
      if (readdirSync(dir).length > 0) break;
      rmdirSync(dir);
    } catch {
      break;
    }
    dir = dirname(dir);
  }
}

// ---------- subtitles ----------

export interface SubtitleFile {
  lang: string;
  path: string;
  ext: "vtt" | "srt";
}

/** Subtitle sidecars already on disk for this video (one entry per language). */
export function listSubtitleFiles(videoId: string): SubtitleFile[] {
  const bases = new Set<string>([videoId]);
  const stored = outputBaseFor(videoId);
  if (stored) bases.add(stored);
  const byLang = new Map<string, SubtitleFile>();
  for (const base of bases) {
    const name = basename(base);
    for (const file of filesForBase(base)) {
      const m = basename(file).slice(name.length).match(/^\.([A-Za-z0-9_-]+)\.(vtt|srt)$/);
      if (!m) continue;
      const entry: SubtitleFile = { lang: m[1], path: file, ext: m[2] as "vtt" | "srt" };
      const current = byLang.get(entry.lang);
      // Browsers only play WebVTT natively, so a .vtt beats a .srt duplicate.
      if (!current || (current.ext === "srt" && entry.ext === "vtt")) byLang.set(entry.lang, entry);
    }
  }
  return [...byLang.values()].sort((a, b) => a.lang.localeCompare(b.lang));
}

/**
 * On-demand subtitle fetch for one language (viewer picked a language that
 * wasn't downloaded with the video). --skip-download makes this a quick,
 * metadata-only yt-dlp run writing next to the existing file.
 */
export async function fetchSubtitles(videoId: string, lang: string): Promise<boolean> {
  const base = outputBaseFor(videoId) ?? videoId;
  mkdirSync(dirname(join(DOWNLOADS_DIR, base)), { recursive: true });
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--no-playlist",
    "--no-warnings",
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs", lang,
    "-o", join(DOWNLOADS_DIR, `${base}.%(ext)s`),
  ];
  if (downloadCookiesConfigured()) args.push("--cookies", DOWNLOAD_COOKIES_FILE);
  try {
    const proc = Bun.spawn([YTDLP, ...args], { stdout: "ignore", stderr: "ignore" });
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 60_000);
    const code = await proc.exited;
    clearTimeout(timer);
    return code === 0;
  } catch (e) {
    log.error("downloads.subtitles_failed", { videoId, lang, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Naive SRT → WebVTT conversion, enough for <track> playback. */
export function srtToVtt(srt: string): string {
  return "WEBVTT\n\n" + srt
    .replace(/\r/g, "")
    .replace(/^\d+\n(?=\d{2}:)/gm, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

// ---------- public queue operations ----------

export function enqueueDownload(videoId: string, source: "manual" | "scheduled" | "feed", priority = false, reviveDeleted = false): boolean {
  const row = db.prepare("SELECT status, path FROM downloads WHERE video_id = ?").get(videoId) as { status: string; path: string | null } | null;
  if (row) {
    if (row.status === "downloading") return false;
    if (row.status === "done" && row.path && existsSync(row.path)) return false;
    // Auto policies never resurrect rows they've already handled (incl. the
    // 'deleted' removal tombstone); a manual request always re-queues, and the
    // scheduled policy may revive a tombstone when the user re-queued the video
    // after the file was removed (reviveDeleted).
    if (source !== "manual" && !(reviveDeleted && row.status === "deleted")) return false;
    db.prepare("UPDATE downloads SET status = 'queued', source = ?, priority = ?, error = NULL, attempts = 0, created_at = datetime('now') WHERE video_id = ?")
      .run(source, priority ? 1 : 0, videoId);
    return true;
  }
  const exists = db.prepare("SELECT 1 FROM videos WHERE video_id = ?").get(videoId);
  if (!exists) return false;
  db.prepare("INSERT INTO downloads (video_id, status, source, priority) VALUES (?, 'queued', ?, ?)").run(videoId, source, priority ? 1 : 0);
  return true;
}

/**
 * The viewer is waiting for this file: queue it with top priority, shove the
 * currently running job back into the queue (its .part files survive, so it
 * resumes later) and start immediately instead of on the next tick.
 */
export function prioritizeDownload(videoId: string): boolean {
  const queued = enqueueDownload(videoId, "manual", true);
  const row = db.prepare("SELECT status FROM downloads WHERE video_id = ?").get(videoId) as { status: string } | null;
  if (!row || (row.status !== "queued" && row.status !== "downloading")) return queued;
  db.prepare("UPDATE downloads SET priority = 1 WHERE video_id = ?").run(videoId);
  if (active && active.videoId !== videoId) {
    active.preempted = true;
    try { active.proc.kill(); } catch {}
  }
  // Kick the loop so the wait is seconds, not a whole tick interval.
  setTimeout(() => tick().catch(() => {}), 300);
  return true;
}

// Removal keeps a 'deleted' tombstone row so the auto policies never bring the
// video back — from the user's perspective it was rejected, not merely purged.
export function removeDownload(videoId: string) {
  if (active?.videoId === videoId) {
    active.cancelled = true;
    try { active.proc.kill(); } catch {}
  }
  unlinkFiles(videoId);
  db.prepare("UPDATE downloads SET status = 'deleted', path = NULL, size_bytes = NULL, error = NULL, priority = 0 WHERE video_id = ?").run(videoId);
}

/**
 * A profile rejected (archived) the video: an in-flight auto download (feed /
 * scheduled) is pointless unless some other profile still waits for it. Manual
 * requests and finished files are left alone — retention handles those.
 */
export function cancelAutoDownloadIfUnwanted(videoId: string) {
  const row = db.prepare("SELECT status, source FROM downloads WHERE video_id = ?").get(videoId) as { status: string; source: string } | null;
  if (!row || row.source === "manual") return;
  if (row.status !== "queued" && row.status !== "downloading") return;
  const stillWanted = db.prepare(
    "SELECT 1 FROM user_videos uv WHERE uv.video_id = ? AND uv.status = 'queued' AND COALESCE(uv.watched, 0) = 0"
  ).get(videoId);
  if (stillWanted) return;
  removeDownload(videoId);
  log.info("downloads.cancelled_after_reject", { videoId, source: row.source });
}

export function setDownloadPinned(videoId: string, pinned: boolean): boolean {
  const r = db.prepare("UPDATE downloads SET pinned = ? WHERE video_id = ?").run(pinned ? 1 : 0, videoId);
  return r.changes > 0;
}

export function listDownloads() {
  const rows = db.prepare(`
    SELECT d.video_id, d.status, d.source, d.quality, d.size_bytes, d.error, d.attempts, d.pinned,
           d.created_at, d.finished_at,
           v.title, v.thumbnail, v.duration, v.is_short, v.published_at,
           c.channel_id, COALESCE(c.custom_title, c.title) AS channel_title
    FROM downloads d
    JOIN videos v ON v.video_id = d.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE d.status != 'deleted'
    ORDER BY CASE d.status WHEN 'downloading' THEN 0 WHEN 'queued' THEN 1 WHEN 'error' THEN 2 ELSE 3 END,
             COALESCE(d.finished_at, d.created_at) DESC
  `).all() as any[];
  return rows;
}

export function downloadStats() {
  const row = db.prepare("SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM downloads WHERE status = 'done'").get() as { files: number; bytes: number };
  const queued = (db.prepare("SELECT COUNT(*) AS n FROM downloads WHERE status IN ('queued','downloading')").get() as { n: number }).n;
  const s = dlSettings();
  return { files: row.files, bytes: row.bytes, queued, cap_bytes: s.max_storage_gb * 1024 ** 3 };
}

export function getDownload(videoId: string) {
  return db.prepare("SELECT video_id, status, quality, path, size_bytes, error, pinned FROM downloads WHERE video_id = ? AND status != 'deleted'")
    .get(videoId) as { video_id: string; status: string; quality: string | null; path: string | null; size_bytes: number | null; error: string | null; pinned: number } | null;
}

/** Full reset for the plugin: kill the active job, drop every file and row. */
export function resetDownloadsState() {
  if (active) {
    active.cancelled = true;
    try { active.proc.kill(); } catch {}
    active = null;
  }
  const rows = db.prepare("SELECT video_id FROM downloads").all() as { video_id: string }[];
  for (const { video_id } of rows) unlinkFiles(video_id);
  db.prepare("DELETE FROM downloads").run();
  for (const key of Object.keys(DL_DEFAULTS)) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(`plugin_downloads_${key}`);
  }
}

// ---------- auto-enqueue policies ----------

function autoEnqueue(s: DlSettings) {
  if (s.download_scheduled === 1) {
    // Anything any profile put on a watch-later bucket and hasn't watched yet.
    // An explicit schedule is intent enough to download even a Short. The
    // 30-day window keeps a fresh plugin enable from crawling years of
    // long-forgotten watch-later backlog.
    const rows = db.prepare(`
      SELECT DISTINCT v.video_id FROM user_videos uv
      JOIN videos v ON v.video_id = uv.video_id
      WHERE uv.status = 'queued'
        AND v.live_status = 'none'
        AND COALESCE(uv.watched, 0) = 0
        AND COALESCE(uv.queued_at, datetime('now')) >= datetime('now', '-30 days')
        AND NOT EXISTS (
          SELECT 1 FROM downloads d WHERE d.video_id = v.video_id
            -- A removed download ('deleted' tombstone) is fair game again once
            -- the user re-queued the video AFTER the removal.
            AND NOT (d.status = 'deleted' AND uv.queued_at > COALESCE(d.finished_at, d.created_at))
        )
      LIMIT 50
    `).all() as { video_id: string }[];
    for (const { video_id } of rows) enqueueDownload(video_id, "scheduled", false, true);
  }

  if (s.download_feed === 1) {
    const shortsFilter = s.download_shorts === 1 ? "" : "AND COALESCE(v.is_short, 0) = 0";
    const rows = db.prepare(`
      SELECT v.video_id FROM videos v
      WHERE v.live_status = 'none' AND v.external = 0
        ${shortsFilter}
        AND v.published_at >= datetime('now', ?)
        AND EXISTS (SELECT 1 FROM user_channels uc WHERE uc.channel_id = v.channel_id AND uc.followed = 1)
        AND NOT EXISTS (SELECT 1 FROM downloads d WHERE d.video_id = v.video_id)
        AND NOT EXISTS (SELECT 1 FROM user_videos uv WHERE uv.video_id = v.video_id AND (uv.watched = 1 OR uv.status = 'archived'))
      ORDER BY v.published_at DESC
      LIMIT 50
    `).all(`-${s.feed_max_age_hours} hours`) as { video_id: string }[];
    for (const { video_id } of rows) enqueueDownload(video_id, "feed");
  }
}

function retryErrors() {
  db.prepare(`
    UPDATE downloads SET status = 'queued'
    WHERE status = 'error' AND attempts < ?
      AND COALESCE(started_at, created_at) <= datetime('now', ?)
  `).run(MAX_ATTEMPTS, `-${RETRY_AFTER_MIN} minutes`);
}

// ---------- retention / cleanup ----------

// A download survives auto-cleanup while it's pinned, still scheduled by an
// unwatched profile, or liked (when keep_liked is on).
function protectedSql(s: DlSettings) {
  let sql = `(d.pinned = 1
    OR EXISTS (SELECT 1 FROM user_videos uv WHERE uv.video_id = d.video_id AND uv.status = 'queued' AND COALESCE(uv.watched, 0) = 0)`;
  if (s.keep_liked === 1) {
    sql += ` OR EXISTS (SELECT 1 FROM user_videos uv2 WHERE uv2.video_id = d.video_id AND uv2.liked = 1)`;
  }
  return sql + ")";
}

// Retention keeps a 'deleted' tombstone so auto policies don't re-download;
// a manual request clears it (see enqueueDownload).
function tombstone(videoId: string) {
  unlinkFiles(videoId);
  db.prepare("UPDATE downloads SET status = 'deleted', path = NULL, size_bytes = NULL WHERE video_id = ?").run(videoId);
}

function cleanup(s: DlSettings) {
  const prot = protectedSql(s);

  // 1. Age-based retention: N days after the download finished.
  const aged = db.prepare(`
    SELECT d.video_id FROM downloads d
    WHERE d.status = 'done' AND d.finished_at <= datetime('now', ?) AND NOT ${prot}
  `).all(`-${s.retention_days} days`) as { video_id: string }[];
  for (const { video_id } of aged) tombstone(video_id);

  // 2. Watched: a grace period after the last watch, then gone.
  if (s.delete_watched === 1) {
    const watched = db.prepare(`
      SELECT d.video_id FROM downloads d
      WHERE d.status = 'done' AND NOT ${prot}
        AND EXISTS (SELECT 1 FROM user_videos uv WHERE uv.video_id = d.video_id AND uv.watched = 1)
        AND COALESCE(
          (SELECT MAX(h.watched_at) FROM history h WHERE h.video_id = d.video_id),
          d.finished_at
        ) <= datetime('now', ?)
    `).all(`-${s.delete_watched_hours} hours`) as { video_id: string }[];
    for (const { video_id } of watched) tombstone(video_id);
  }

  // 3. Storage cap: drop oldest unprotected files until under the limit.
  const cap = s.max_storage_gb * 1024 ** 3;
  let total = (db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS b FROM downloads WHERE status = 'done'").get() as { b: number }).b;
  if (total > cap) {
    const candidates = db.prepare(`
      SELECT d.video_id, d.size_bytes FROM downloads d
      WHERE d.status = 'done' AND NOT ${prot}
      ORDER BY d.finished_at ASC
    `).all() as { video_id: string; size_bytes: number | null }[];
    for (const row of candidates) {
      if (total <= cap) break;
      tombstone(row.video_id);
      total -= row.size_bytes ?? 0;
      log.info("downloads.evicted_for_space", { videoId: row.video_id });
    }
  }

  // 4. Rows whose file vanished behind our back.
  const done = db.prepare("SELECT video_id, path FROM downloads WHERE status = 'done'").all() as { video_id: string; path: string | null }[];
  for (const row of done) {
    if (row.path && existsSync(row.path)) continue;
    db.prepare("UPDATE downloads SET status = 'deleted', path = NULL, size_bytes = NULL WHERE video_id = ?").run(row.video_id);
  }

  // 5. Orphan files no live row accounts for. A file belongs to a row when its
  // path minus extensions equals the row's output base (covers the video and
  // every sidecar: .nfo, thumbnails, .info.json, subtitles, .part resumes).
  const live = db.prepare("SELECT video_id, output_base FROM downloads WHERE status != 'deleted'").all() as { video_id: string; output_base: string | null }[];
  const liveBases = new Set<string>();
  for (const row of live) {
    liveBases.add(row.video_id); // legacy flat {id}.* layout
    if (row.output_base) liveBases.add(row.output_base);
  }
  for (const full of walkFiles(DOWNLOADS_DIR)) {
    const rel = full.slice(resolve(DOWNLOADS_DIR).length + 1);
    let stem = rel;
    let owned = false;
    while (true) {
      if (liveBases.has(stem)) { owned = true; break; }
      const dot = stem.lastIndexOf(".");
      if (dot <= stem.lastIndexOf("/")) break;
      stem = stem.slice(0, dot);
    }
    if (!owned) {
      try { unlinkSync(full); } catch {}
    }
  }
  pruneAllEmptyDirs(DOWNLOADS_DIR);
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** Depth-first removal of empty template subdirectories (the root stays). */
function pruneAllEmptyDirs(dir: string, isRoot = true) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneAllEmptyDirs(join(dir, entry.name), false);
  }
  if (!isRoot) {
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {}
  }
}

// ---------- the download itself ----------

function pickNext(): string | null {
  const row = db.prepare(`
    SELECT video_id FROM downloads
    WHERE status = 'queued'
    ORDER BY priority DESC, CASE source WHEN 'manual' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, created_at ASC
    LIMIT 1
  `).get() as { video_id: string } | null;
  return row?.video_id ?? null;
}

const PROGRESS_RE = /\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+)(K|M|G)iB)?(?:.*?at\s+(\S+))?/;

function parseBytes(value: string, unit: string): number {
  const mult = unit === "G" ? 1024 ** 3 : unit === "M" ? 1024 ** 2 : 1024;
  return Math.round(Number(value) * mult);
}

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  }
  if (buf) onLine(buf);
}

// Sidecar extensions that must never be mistaken for the downloaded video.
const SIDECAR_EXT = [".part", ".ytdl", ".json", ".nfo", ".vtt", ".srt", ".ass", ".lrc", ".jpg", ".jpeg", ".png", ".webp"];

/** Kodi/Jellyfin-style companion metadata next to the video file. */
function writeNfoFile(videoId: string, base: string) {
  const row = db.prepare(`
    SELECT v.title, v.description, v.published_at, v.channel_id,
           COALESCE(c.custom_title, c.title) AS channel_title
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `).get(videoId) as { title: string; description: string; published_at: string | null; channel_id: string; channel_title: string } | null;
  if (!row) return;
  const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const date = row.published_at?.slice(0, 10) ?? "";
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${esc(row.title)}</title>
  <plot>${esc(row.description)}</plot>
  <studio>${esc(row.channel_title)}</studio>
  <premiered>${date}</premiered>
  <aired>${date}</aired>
  <uniqueid type="youtube" default="true">${esc(videoId)}</uniqueid>
  <trailer>https://www.youtube.com/watch?v=${esc(videoId)}</trailer>
</movie>
`;
  writeFileSync(join(DOWNLOADS_DIR, `${base}.nfo`), xml);
}

async function runDownload(videoId: string, s: DlSettings) {
  const height = s.quality === "best" ? null : Number(s.quality);
  // Explicitly pick the best separate video and audio streams. Sorting by
  // codec (H.264 + M4A) made a lower-resolution progressive format win over
  // a higher-resolution stream, even when the user selected "Best".
  const format = height
    ? `bestvideo*[height<=${height}]+bestaudio/best[height<=${height}]`
    : "bestvideo*+bestaudio/best";
  const base = renderOutputTemplate(videoId, String(s.output_template));
  mkdirSync(dirname(join(DOWNLOADS_DIR, base)), { recursive: true });
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--no-playlist",
    "--newline",
    "--no-warnings",
    "--no-mtime",
    "-f", format,
    "--merge-output-format", "mp4",
    "-o", join(DOWNLOADS_DIR, `${base}.%(ext)s`),
  ];
  if (s.write_thumbnail === 1) args.push("--write-thumbnail");
  if (s.embed_metadata === 1) args.push("--embed-metadata");
  if (s.write_info_json === 1) args.push("--write-info-json");
  if (s.write_subs === 1) args.push("--write-subs");
  if (s.write_auto_subs === 1) args.push("--write-auto-subs");
  if (s.write_subs === 1 || s.write_auto_subs === 1) {
    const langs = String(s.sub_langs).trim();
    if (langs) args.push("--sub-langs", langs);
  }

  db.prepare("UPDATE downloads SET status = 'downloading', quality = ?, output_base = ?, error = NULL, attempts = attempts + 1, started_at = datetime('now') WHERE video_id = ?")
    .run(s.quality, base, videoId);
  log.info("downloads.start", { videoId, quality: s.quality, base });

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    db.prepare("UPDATE downloads SET status = 'error', error = ? WHERE video_id = ?").run(error, videoId);
    ytdlpVersion = undefined; // binary may have moved — re-check on next tick
    log.error("downloads.spawn_failed", { videoId, error });
    return;
  }
  const job: ActiveDownload = { videoId, proc, percent: 0, totalBytes: null, speed: null, cancelled: false, preempted: false };
  active = job;

  const stderrTail: string[] = [];
  try {
    await Promise.all([
      readLines(proc.stdout as ReadableStream<Uint8Array>, (line) => {
        const m = line.match(PROGRESS_RE);
        if (!m) return;
        job.percent = Number(m[1]);
        if (m[2] && m[3]) job.totalBytes = parseBytes(m[2], m[3]);
        if (m[4]) job.speed = m[4];
      }),
      readLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
        if (!line.trim()) return;
        stderrTail.push(line.trim());
        if (stderrTail.length > 8) stderrTail.shift();
      }),
    ]);
  } catch {}
  const code = await proc.exited;
  active = null;

  if (job.cancelled) {
    unlinkFiles(videoId);
    return;
  }

  if (job.preempted) {
    // Killed to make room for a priority download — back in line, partial
    // files intact so the resume picks up where it stopped.
    db.prepare("UPDATE downloads SET status = 'queued', attempts = attempts - 1 WHERE video_id = ? AND status = 'downloading'").run(videoId);
    return;
  }

  if (code === 0) {
    const files = filesFor(videoId).filter((f) => !SIDECAR_EXT.some((ext) => f.toLowerCase().endsWith(ext)));
    const path = files.sort((a, b) => statSync(b).size - statSync(a).size)[0];
    if (path) {
      const size = statSync(path).size;
      if (s.write_nfo === 1) {
        try { writeNfoFile(videoId, base); } catch (e) {
          log.warn("downloads.nfo_failed", { videoId, error: e instanceof Error ? e.message : String(e) });
        }
      }
      db.prepare("UPDATE downloads SET status = 'done', path = ?, size_bytes = ?, error = NULL, finished_at = datetime('now') WHERE video_id = ?")
        .run(path, size, videoId);
      log.info("downloads.done", { videoId, size, path });
      return;
    }
  }
  const error = stderrTail.slice(-3).join(" | ") || `yt-dlp exited with code ${code}`;
  db.prepare("UPDATE downloads SET status = 'error', error = ? WHERE video_id = ?").run(error, videoId);
  log.error("downloads.failed", { videoId, code, error });
}

// ---------- scheduler ----------

let ticking = false;
let lastCleanupAt = 0;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    if (!dlEnabled()) return;
    if (!(await ytdlpStatus())) return;
    const s = dlSettings();
    autoEnqueue(s);
    retryErrors();
    if (Date.now() - lastCleanupAt > CLEANUP_INTERVAL_MS) {
      lastCleanupAt = Date.now();
      cleanup(s);
    }
    if (!active) {
      const next = pickNext();
      // Fire and forget: `active` guards concurrency, ticks keep flowing.
      if (next) runDownload(next, s).catch((e) => log.error("downloads.run_failed", { videoId: next, error: e instanceof Error ? e.message : String(e) }));
    }
  } finally {
    ticking = false;
  }
}

export function startDownloader() {
  // Crash recovery: an interrupted download restarts from the queue.
  db.prepare("UPDATE downloads SET status = 'queued' WHERE status = 'downloading'").run();
  setTimeout(() => tick().catch(() => {}), 8_000);
  setInterval(() => tick().catch(() => {}), TICK_INTERVAL_MS);
  setInterval(() => ytdlpSelfUpdate().catch(() => {}), 24 * 60 * 60_000);
  log.info("scheduler.downloads", { dir: DOWNLOADS_DIR, intervalMs: TICK_INTERVAL_MS });
}
