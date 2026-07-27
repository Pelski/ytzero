import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { database } from "./database";
import { getSetting } from "./db";
import { downloadCookieAttempts, downloadFormat, renderDownloadOutputTemplate } from "./downloadStrategy";
import { log } from "./logger";
import { beginMutation, maintenanceActive } from "./maintenance";
import { publishAppEvent } from "./appEvents";

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
  // HEAVILY EXPERIMENTAL: play a not-yet-downloaded video immediately by piping
  // yt-dlp straight into ffmpeg and streaming a fragmented MP4 to the browser as
  // it is produced (see startLiveStream). Off by default.
  experimental_streaming: 0,
  // Filename template, rendered server-side from the DB (so {channel} honours
  // the custom channel name). "/" creates subdirectories; the extension is
  // appended automatically; a missing {id} is added as " [id]" to keep files
  // unique and trackable.
  // Playlist bulk downloads land in an optional playlist folder. For every
  // other source {playlist} is empty and the renderer removes that segment.
  output_template: "{playlist}/{id}",
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
  feed_min_duration_minutes: 0,
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

async function dlEnabled(): Promise<boolean> {
  const row = await database.prepare("SELECT enabled FROM plugins WHERE id = 'downloads'").get() as { enabled: number } | null;
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
let lastProgressEventAt = 0;
const notifyDownloadChanged = (videoId: string) => publishAppEvent("downloads", { videoId });

export function activeDownloadProgress(): { video_id: string; percent: number; total_bytes: number | null; speed: string | null } | null {
  if (!active) return null;
  return { video_id: active.videoId, percent: active.percent, total_bytes: active.totalBytes, speed: active.speed };
}

// ---------- output template ----------
// The template is rendered here (not by yt-dlp) so {channel} can use the
// user's custom channel name and so every produced file shares a known base —
// that's what lets cleanup find sidecars (.nfo, thumbnails, subtitles).

export async function renderOutputTemplate(videoId: string, template: string): Promise<string> {
  const row = await database.prepare(`
    SELECT v.title, v.published_at, v.channel_id,
           COALESCE(c.custom_title, c.title) AS channel_title,
           d.playlist_title
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN downloads d ON d.video_id = v.video_id
    WHERE v.video_id = ?
  `).get(videoId) as { title: string; published_at: string | null; channel_id: string; channel_title: string; playlist_title: string | null } | null;
  const date = row?.published_at?.slice(0, 10) ?? "";
  const values: Record<string, string> = {
    id: videoId,
    title: row?.title ?? videoId,
    channel: row?.channel_title || row?.channel_id || "",
    channel_id: row?.channel_id ?? "",
    playlist: row?.playlist_title ?? "",
    date,
    year: date.slice(0, 4),
    month: date.slice(5, 7),
    day: date.slice(8, 10),
  };
  return renderDownloadOutputTemplate(template, values, videoId);
}

async function outputBaseFor(videoId: string): Promise<string | null> {
  const row = await database.prepare("SELECT output_base FROM downloads WHERE video_id = ?").get(videoId) as { output_base: string | null } | null;
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

async function filesFor(videoId: string): Promise<string[]> {
  const files = new Set<string>(filesForBase(videoId)); // legacy flat {id}.* layout
  const base = await outputBaseFor(videoId);
  if (base && base !== videoId) for (const f of filesForBase(base)) files.add(f);
  return [...files];
}

async function unlinkFiles(videoId: string) {
  for (const f of await filesFor(videoId)) {
    try { unlinkSync(f); } catch {}
  }
  pruneEmptyDirs(await outputBaseFor(videoId));
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

interface SubtitleFetchOptions {
  manual: boolean;
  automatic: boolean;
}

/** Subtitle sidecars already on disk for this video (one entry per language). */
export async function listSubtitleFiles(videoId: string): Promise<SubtitleFile[]> {
  const bases = new Set<string>([videoId]);
  const stored = await outputBaseFor(videoId);
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
async function fetchSubtitleSidecars(videoId: string, langs: string, options: SubtitleFetchOptions): Promise<boolean> {
  const base = await outputBaseFor(videoId) ?? videoId;
  mkdirSync(dirname(join(DOWNLOADS_DIR, base)), { recursive: true });
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--no-playlist",
    "--no-warnings",
    "--skip-download",
    "-o", join(DOWNLOADS_DIR, `${base}.%(ext)s`),
  ];
  if (options.manual) args.push("--write-subs");
  if (options.automatic) args.push("--write-auto-subs");
  if (langs.trim()) args.push("--sub-langs", langs.trim());
  if (downloadCookiesConfigured()) args.push("--cookies", DOWNLOAD_COOKIES_FILE);
  try {
    const stderrTail: string[] = [];
    const proc = Bun.spawn([YTDLP, ...args], { stdout: "ignore", stderr: "pipe" });
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 60_000);
    await readLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
      if (!line.trim()) return;
      stderrTail.push(line.trim());
      if (stderrTail.length > 4) stderrTail.shift();
    }).catch(() => {});
    const code = await proc.exited;
    clearTimeout(timer);
    if (code !== 0) {
      log.warn("downloads.subtitles_skipped", {
        videoId,
        langs,
        error: stderrTail.at(-1) ?? `yt-dlp exited with code ${code}`,
      });
    }
    return code === 0;
  } catch (e) {
    log.warn("downloads.subtitles_skipped", { videoId, langs, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export async function fetchSubtitles(videoId: string, lang: string): Promise<boolean> {
  return fetchSubtitleSidecars(videoId, lang, { manual: true, automatic: true });
}

/** Naive SRT → WebVTT conversion, enough for <track> playback. */
export function srtToVtt(srt: string): string {
  return "WEBVTT\n\n" + srt
    .replace(/\r/g, "")
    .replace(/^\d+\n(?=\d{2}:)/gm, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

// ---------- public queue operations ----------

export async function enqueueDownload(videoId: string, source: "manual" | "scheduled" | "feed", priority = false, reviveDeleted = false, context: { playlistTitle?: string | null; notify?: boolean } = {}): Promise<boolean> {
  const row = await database.prepare("SELECT status, path FROM downloads WHERE video_id = ?").get(videoId) as { status: string; path: string | null } | null;
  if (row) {
    if (row.status === "downloading") return false;
    if (row.status === "done" && row.path && existsSync(row.path)) return false;
    // Auto policies never resurrect rows they've already handled (incl. the
    // 'deleted' removal tombstone); a manual request always re-queues, and the
    // scheduled policy may revive a tombstone when the user re-queued the video
    // after the file was removed (reviveDeleted).
    if (source !== "manual" && !(reviveDeleted && row.status === "deleted")) return false;
    await database.prepare("UPDATE downloads SET status = 'queued', source = ?, priority = ?, playlist_title = ?, error = NULL, attempts = 0, created_at = datetime('now') WHERE video_id = ?")
      .run(source, priority ? 1 : 0, context.playlistTitle ?? null, videoId);
    if (context.notify !== false) notifyDownloadChanged(videoId);
    return true;
  }
  const exists = await database.prepare("SELECT 1 FROM videos WHERE video_id = ? AND is_private = 0").get(videoId);
  if (!exists) return false;
  await database.prepare("INSERT INTO downloads (video_id, status, source, priority, playlist_title) VALUES (?, 'queued', ?, ?, ?)").run(videoId, source, priority ? 1 : 0, context.playlistTitle ?? null);
  if (context.notify !== false) notifyDownloadChanged(videoId);
  return true;
}

export async function enqueuePlaylistDownloads(videoIds: string[], playlistTitle: string) {
  let queued = 0;
  const existingDownload = database.prepare("SELECT status FROM downloads WHERE video_id = ?");
  for (const videoId of videoIds) {
    const existing = await existingDownload.get(videoId) as { status: string } | null;
    if (existing?.status === "queued" || existing?.status === "downloading") continue;
    if (await enqueueDownload(videoId, "manual", false, false, { playlistTitle, notify: false })) queued++;
  }
  publishAppEvent("downloads", { playlistTitle, queued });
  if (queued > 0) setTimeout(() => tick().catch((error) => log.error("downloads.tick_failed", { error: error instanceof Error ? error.message : String(error) })), 300);
  return { queued, skipped: videoIds.length - queued, total: videoIds.length };
}

/**
 * The viewer is waiting for this file: queue it with top priority, shove the
 * currently running job back into the queue (its .part files survive, so it
 * resumes later) and start immediately instead of on the next tick.
 */
export async function prioritizeDownload(videoId: string): Promise<boolean> {
  const queued = await enqueueDownload(videoId, "manual", true);
  const row = await database.prepare("SELECT status FROM downloads WHERE video_id = ?").get(videoId) as { status: string } | null;
  if (!row || (row.status !== "queued" && row.status !== "downloading")) return queued;
  await database.prepare("UPDATE downloads SET priority = 1 WHERE video_id = ?").run(videoId);
  notifyDownloadChanged(videoId);
  if (active && active.videoId !== videoId) {
    active.preempted = true;
    try { active.proc.kill(); } catch {}
  }
  // Kick the loop so the wait is seconds, not a whole tick interval.
  setTimeout(() => tick().catch((error) => log.error("downloads.tick_failed", { error: error instanceof Error ? error.message : String(error) })), 300);
  return true;
}

// Removal keeps a 'deleted' tombstone row so the auto policies never bring the
// video back — from the user's perspective it was rejected, not merely purged.
export async function removeDownload(videoId: string) {
  if (active?.videoId === videoId) {
    active.cancelled = true;
    try { active.proc.kill(); } catch {}
  }
  await unlinkFiles(videoId);
  await database.prepare("UPDATE downloads SET status = 'deleted', path = NULL, size_bytes = NULL, error = NULL, priority = 0 WHERE video_id = ?").run(videoId);
  notifyDownloadChanged(videoId);
}

/**
 * A profile rejected (archived) the video: an in-flight auto download (feed /
 * scheduled) is pointless unless some other profile still waits for it. Manual
 * requests and finished files are left alone — retention handles those.
 */
export async function cancelAutoDownloadIfUnwanted(videoId: string) {
  const row = await database.prepare("SELECT status, source FROM downloads WHERE video_id = ?").get(videoId) as { status: string; source: string } | null;
  if (!row || row.source === "manual") return;
  if (row.status !== "queued" && row.status !== "downloading") return;
  const stillWanted = await database.prepare(
    "SELECT 1 FROM user_videos uv WHERE uv.video_id = ? AND uv.status = 'queued' AND COALESCE(uv.watched, 0) = 0"
  ).get(videoId);
  if (stillWanted) return;
  await removeDownload(videoId);
  log.info("downloads.cancelled_after_reject", { videoId, source: row.source });
}

export async function setDownloadPinned(videoId: string, pinned: boolean): Promise<boolean> {
  const r = await database.prepare("UPDATE downloads SET pinned = ? WHERE video_id = ?").run(pinned ? 1 : 0, videoId);
  if (r.changes > 0) notifyDownloadChanged(videoId);
  return r.changes > 0;
}

export async function listDownloads() {
  const rows = await database.prepare(`
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

export async function downloadStats() {
  const row = await database.prepare("SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM downloads WHERE status = 'done'").get() as { files: number; bytes: number };
  const queued = (await database.prepare("SELECT COUNT(*) AS n FROM downloads WHERE status IN ('queued','downloading')").get() as { n: number }).n;
  const s = dlSettings();
  return { files: row.files, bytes: row.bytes, queued, cap_bytes: s.max_storage_gb * 1024 ** 3 };
}

export async function getDownload(videoId: string) {
  return await database.prepare("SELECT video_id, status, quality, path, size_bytes, error, pinned FROM downloads WHERE video_id = ? AND status != 'deleted'")
    .get(videoId) as { video_id: string; status: string; quality: string | null; path: string | null; size_bytes: number | null; error: string | null; pinned: number } | null;
}

/** Full reset for the plugin: kill the active job, drop every file and row. */
export async function resetDownloadsState() {
  if (active) {
    active.cancelled = true;
    try { active.proc.kill(); } catch {}
    active = null;
  }
  const rows = await database.prepare("SELECT video_id FROM downloads").all() as { video_id: string }[];
  for (const { video_id } of rows) await unlinkFiles(video_id);
  await database.prepare("DELETE FROM downloads").run();
  for (const key of Object.keys(DL_DEFAULTS)) {
    await database.prepare("DELETE FROM settings WHERE key = ?").run(`plugin_downloads_${key}`);
  }
}

// ---------- auto-enqueue policies ----------

function parseDurationSeconds(duration: string | null): number | null {
  if (!duration) return null;
  const parts = duration.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const values = parts.map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 0)) return null;
  // A duration such as 99:10 is valid (99 minutes), while middle segments of
  // hour-based durations must still be conventional minutes/seconds. Seconds
  // are always conventional.
  if (values.at(-1)! >= 60 || (values.length === 3 && values[1] >= 60)) return null;
  return values.reduce((total, value) => total * 60 + value, 0);
}

async function autoEnqueue(s: DlSettings) {
  if (s.download_scheduled === 1) {
    // Anything any profile put on a watch-later bucket and hasn't watched yet.
    // An explicit schedule is intent enough to download even a Short. The
    // 30-day window keeps a fresh plugin enable from crawling years of
    // long-forgotten watch-later backlog.
    const rows = await database.prepare(`
      SELECT DISTINCT v.video_id FROM user_videos uv
      JOIN videos v ON v.video_id = uv.video_id
      WHERE uv.status = 'queued'
        AND v.live_status = 'none'
        AND v.is_private = 0
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
    for (const { video_id } of rows) await enqueueDownload(video_id, "scheduled", false, true);
  }

  if (s.download_feed === 1) {
    const shortsFilter = s.download_shorts === 1 ? "" : "AND COALESCE(v.is_short, 0) = 0";
    const rows = await database.prepare(`
      SELECT v.video_id, v.duration,
             COALESCE(c.auto_download_min_duration_override, ?) AS min_duration
      FROM videos v
      JOIN channels c ON c.channel_id = v.channel_id
      WHERE v.live_status = 'none' AND v.external = 0 AND v.is_private = 0
        ${shortsFilter}
        AND v.published_at >= datetime('now', ?)
        AND EXISTS (SELECT 1 FROM user_channels uc WHERE uc.channel_id = v.channel_id AND uc.followed = 1)
        AND NOT EXISTS (SELECT 1 FROM downloads d WHERE d.video_id = v.video_id)
        AND NOT EXISTS (SELECT 1 FROM user_videos uv WHERE uv.video_id = v.video_id AND (uv.watched = 1 OR uv.status = 'archived'))
      ORDER BY v.published_at DESC
      LIMIT 250
    `).all(s.feed_min_duration_minutes * 60, `-${s.feed_max_age_hours} hours`) as { video_id: string; duration: string | null; min_duration: number }[];
    let enqueued = 0;
    for (const { video_id, duration, min_duration } of rows) {
      // With a threshold, an unknown duration cannot safely be included. It
      // will be considered by a later pass once the metadata refresher fills it.
      if (min_duration > 0 && (parseDurationSeconds(duration) ?? -1) < min_duration) continue;
      await enqueueDownload(video_id, "feed");
      if (++enqueued >= 50) break;
    }
  }
}

async function retryErrors() {
  await database.prepare(`
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
async function tombstone(videoId: string) {
  await unlinkFiles(videoId);
  await database.prepare("UPDATE downloads SET status = 'deleted', path = NULL, size_bytes = NULL WHERE video_id = ?").run(videoId);
  notifyDownloadChanged(videoId);
}

async function cleanup(s: DlSettings) {
  const prot = protectedSql(s);

  // 1. Age-based retention: N days after the download finished.
  const aged = await database.prepare(`
    SELECT d.video_id FROM downloads d
    WHERE d.status = 'done' AND d.finished_at <= datetime('now', ?) AND NOT ${prot}
  `).all(`-${s.retention_days} days`) as { video_id: string }[];
  for (const { video_id } of aged) await tombstone(video_id);

  // 2. Watched: a grace period after the last watch, then gone.
  if (s.delete_watched === 1) {
    const watched = await database.prepare(`
      SELECT d.video_id FROM downloads d
      WHERE d.status = 'done' AND NOT ${prot}
        AND EXISTS (SELECT 1 FROM user_videos uv WHERE uv.video_id = d.video_id AND uv.watched = 1)
        AND COALESCE(
          (SELECT MAX(h.watched_at) FROM history h WHERE h.video_id = d.video_id),
          d.finished_at
        ) <= datetime('now', ?)
    `).all(`-${s.delete_watched_hours} hours`) as { video_id: string }[];
    for (const { video_id } of watched) await tombstone(video_id);
  }

  // 3. Storage cap: drop oldest unprotected files until under the limit.
  const cap = s.max_storage_gb * 1024 ** 3;
  let total = (await database.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS b FROM downloads WHERE status = 'done'").get() as { b: number }).b;
  if (total > cap) {
    const candidates = await database.prepare(`
      SELECT d.video_id, d.size_bytes FROM downloads d
      WHERE d.status = 'done' AND NOT ${prot}
      ORDER BY d.finished_at ASC
    `).all() as { video_id: string; size_bytes: number | null }[];
    for (const row of candidates) {
      if (total <= cap) break;
      await tombstone(row.video_id);
      total -= row.size_bytes ?? 0;
      log.info("downloads.evicted_for_space", { videoId: row.video_id });
    }
  }

  // 4. Rows whose file vanished behind our back.
  const done = await database.prepare("SELECT video_id, path FROM downloads WHERE status = 'done'").all() as { video_id: string; path: string | null }[];
  for (const row of done) {
    if (row.path && existsSync(row.path)) continue;
    await database.prepare("UPDATE downloads SET status = 'deleted', path = NULL, size_bytes = NULL WHERE video_id = ?").run(row.video_id);
    notifyDownloadChanged(row.video_id);
  }

  // 5. Orphan files no live row accounts for. A file belongs to a row when its
  // path minus extensions equals the row's output base (covers the video and
  // every sidecar: .nfo, thumbnails, .info.json, subtitles, .part resumes).
  const live = await database.prepare("SELECT video_id, output_base FROM downloads WHERE status != 'deleted'").all() as { video_id: string; output_base: string | null }[];
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

async function pickNext(): Promise<string | null> {
  const row = await database.prepare(`
    SELECT d.video_id FROM downloads d
    JOIN videos v ON v.video_id = d.video_id
    WHERE d.status = 'queued' AND v.is_private = 0
    ORDER BY d.priority DESC, CASE d.source WHEN 'manual' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, d.created_at ASC
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
async function writeNfoFile(videoId: string, base: string) {
  const row = await database.prepare(`
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
  const format = downloadFormat(String(s.quality));
  const base = await renderOutputTemplate(videoId, String(s.output_template));
  mkdirSync(dirname(join(DOWNLOADS_DIR, base)), { recursive: true });
  const baseArgs = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--no-playlist",
    "--newline",
    "--no-warnings",
    "--no-mtime",
    "--retry-sleep", "http:exp=1:20",
    // Chunked, concurrent range download — defeats YouTube's per-connection
    // throttling so files land in seconds, not near real time.
    "--http-chunk-size", "10M",
    "--concurrent-fragments", "4",
    "-f", format,
    "--merge-output-format", "mp4",
    "-o", join(DOWNLOADS_DIR, `${base}.%(ext)s`),
  ];
  if (s.write_thumbnail === 1) baseArgs.push("--write-thumbnail");
  if (s.embed_metadata === 1) baseArgs.push("--embed-metadata");
  if (s.write_info_json === 1) baseArgs.push("--write-info-json");

  await database.prepare("UPDATE downloads SET status = 'downloading', quality = ?, output_base = ?, error = NULL, attempts = attempts + 1, started_at = datetime('now') WHERE video_id = ?")
    .run(s.quality, base, videoId);
  notifyDownloadChanged(videoId);
  log.info("downloads.start", { videoId, quality: s.quality, base });

  const cookieAttempts = downloadCookieAttempts(downloadCookiesConfigured());
  let job: ActiveDownload | null = null;
  let code = 1;
  let stderrTail: string[] = [];

  for (let attemptIndex = 0; attemptIndex < cookieAttempts.length; attemptIndex++) {
    const useCookies = cookieAttempts[attemptIndex];
    const args = [...baseArgs];
    if (useCookies) args.push("--cookies", DOWNLOAD_COOKIES_FILE);

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await database.prepare("UPDATE downloads SET status = 'error', error = ? WHERE video_id = ?").run(error, videoId);
      notifyDownloadChanged(videoId);
      ytdlpVersion = undefined; // binary may have moved — re-check on next tick
      log.error("downloads.spawn_failed", { videoId, error });
      active = null;
      return;
    }

    if (job) job.proc = proc;
    else job = { videoId, proc, percent: 0, totalBytes: null, speed: null, cancelled: false, preempted: false };
    active = job;
    const attemptStderr: string[] = [];

    try {
      await Promise.all([
        readLines(proc.stdout as ReadableStream<Uint8Array>, (line) => {
          const m = line.match(PROGRESS_RE);
          if (!m || !job) return;
          job.percent = Number(m[1]);
          if (m[2] && m[3]) job.totalBytes = parseBytes(m[2], m[3]);
          if (m[4]) job.speed = m[4];
          if (Date.now() - lastProgressEventAt >= 1_000) {
            lastProgressEventAt = Date.now();
            notifyDownloadChanged(videoId);
          }
        }),
        readLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
          if (!line.trim()) return;
          attemptStderr.push(line.trim());
          if (attemptStderr.length > 8) attemptStderr.shift();
        }),
      ]);
    } catch {}
    code = await proc.exited;
    stderrTail = attemptStderr;

    if (code === 0 || job.cancelled || job.preempted) break;
    if (cookieAttempts[attemptIndex + 1]) {
      log.info("downloads.retry_with_cookies", {
        videoId,
        reason: stderrTail.at(-1) ?? `yt-dlp exited with code ${code}`,
      });
    }
  }
  active = null;

  if (!job) return;

  if (job.cancelled) {
    await unlinkFiles(videoId);
    return;
  }

  if (job.preempted) {
    // Killed to make room for a priority download — back in line, partial
    // files intact so the resume picks up where it stopped.
    await database.prepare("UPDATE downloads SET status = 'queued', attempts = attempts - 1 WHERE video_id = ? AND status = 'downloading'").run(videoId);
    notifyDownloadChanged(videoId);
    return;
  }

  if (code === 0) {
    const files = (await filesFor(videoId)).filter((f) => !SIDECAR_EXT.some((ext) => f.toLowerCase().endsWith(ext)));
    const path = files.sort((a, b) => statSync(b).size - statSync(a).size)[0];
    if (path) {
      const size = statSync(path).size;
      if (s.write_nfo === 1) {
        try { await writeNfoFile(videoId, base); } catch (e) {
          log.warn("downloads.nfo_failed", { videoId, error: e instanceof Error ? e.message : String(e) });
        }
      }
      await database.prepare("UPDATE downloads SET status = 'done', path = ?, size_bytes = ?, error = NULL, finished_at = datetime('now') WHERE video_id = ?")
        .run(path, size, videoId);
      notifyDownloadChanged(videoId);
      log.info("downloads.done", { videoId, size, path });
      if (s.write_subs === 1 || s.write_auto_subs === 1) {
        // Subtitles are optional sidecars. A missing language or a YouTube 429
        // must never turn a successfully downloaded video into a failed job.
        await fetchSubtitleSidecars(videoId, String(s.sub_langs ?? ""), {
          manual: s.write_subs === 1,
          automatic: s.write_auto_subs === 1,
        });
      }
      return;
    }
  }
  const error = stderrTail.slice(-3).join(" | ") || `yt-dlp exited with code ${code}`;
  await database.prepare("UPDATE downloads SET status = 'error', error = ? WHERE video_id = ?").run(error, videoId);
  notifyDownloadChanged(videoId);
  log.error("downloads.failed", { videoId, code, error });
}

// ---------- experimental: on-demand transcoding HLS (seek anywhere) ----------
// HEAVILY EXPERIMENTAL. A static VOD playlist for the WHOLE video (fixed-size
// segments, computed from the known duration) is served immediately, so the
// browser can seek anywhere. Segments don't exist up front — each is produced
// on demand by an ffmpeg "region" that seeks (-ss) into the direct googlevideo
// stream and transcodes forward from there (like Plex/Jellyfin). Seek far ahead
// → we respawn the region at that point. A clean copy of the file is saved in
// the background via the normal download queue, so the next visit plays locally.

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
// HLS scratch lives OUTSIDE the downloads dir so retention/orphan cleanup
// (which walks DOWNLOADS_DIR) never touches transcoded segments.
const HLS_DIR = resolve(DOWNLOADS_DIR, "..", "hls-stream");
const SEG_SECONDS = 6;              // fixed grid segment length
const REGION_SEGMENTS = 20;         // how far ahead one ffmpeg region transcodes (~120s)
const HLS_IDLE_MS = 120_000;
const SEGMENT_WAIT_MS = 25_000;
const SEGMENT_RE = /^seg(\d{5})\.ts$/;

interface HlsRegion {
  proc: ReturnType<typeof Bun.spawn>;
  startIndex: number;
  exited: boolean;
}

interface HlsSession {
  videoId: string;
  dir: string;
  durationSec: number;
  segCount: number;
  fps: number;
  videoUrl: string;
  audioUrl: string | null;
  playlist: string;
  region: HlsRegion | null;
  lastAccess: number;
}

const hlsSessions = new Map<string, HlsSession>();
let hlsSweeper: ReturnType<typeof setInterval> | null = null;

export async function liveStreamEnabled(): Promise<boolean> {
  return await dlEnabled() && dlSettings().experimental_streaming === 1;
}

export function isSegmentName(name: string): boolean {
  return SEGMENT_RE.test(name);
}

function hlsSessionDir(videoId: string): string {
  return join(HLS_DIR, videoId.replace(/[^A-Za-z0-9_-]/g, "_"));
}

function streamFormat(): string {
  const s = dlSettings();
  const height = s.quality === "best" ? null : Number(s.quality);
  // H.264 + AAC keeps the on-demand transcode a cheap H.264->H.264 re-encode.
  const cap = height ? `[height<=${height}]` : "";
  return `bestvideo*[vcodec^=avc1]${cap}+bestaudio[acodec^=mp4a]/best[vcodec^=avc1]${cap}/best${cap}`;
}

/** One yt-dlp call: total duration, source fps and the direct stream URL(s). */
async function probeSource(videoId: string): Promise<{ durationSec: number; fps: number; videoUrl: string; audioUrl: string | null } | null> {
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--no-playlist", "--no-warnings",
    "-f", streamFormat(),
    "--print", "%(duration)s",
    "--print", "%(fps)s",
    "--print", "urls",
  ];
  if (downloadCookiesConfigured()) args.push("--cookies", DOWNLOAD_COOKIES_FILE);
  try {
    const proc = Bun.spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    const lines = out.trim().split(/\r?\n/).filter(Boolean);
    const durationSec = Math.floor(Number(lines[0]));
    const fps = Math.max(1, Math.round(Number(lines[1]) || 30));
    const urls = lines.slice(2);
    if (!Number.isFinite(durationSec) || durationSec <= 0 || urls.length === 0) return null;
    return { durationSec, fps, videoUrl: urls[0], audioUrl: urls[1] ?? null };
  } catch {
    return null;
  }
}

function buildVodPlaylist(durationSec: number, segCount: number): string {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${SEG_SECONDS}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
  ];
  for (let i = 0; i < segCount; i++) {
    const dur = i === segCount - 1 ? durationSec - (segCount - 1) * SEG_SECONDS : SEG_SECONDS;
    lines.push(`#EXTINF:${(dur > 0 ? dur : SEG_SECONDS).toFixed(6)},`);
    lines.push(`seg${String(i).padStart(5, "0")}.ts`);
  }
  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

function killRegion(session: HlsSession) {
  if (session.region) {
    try { session.region.proc.kill(); } catch {}
    session.region.exited = true;
    session.region = null;
  }
}

/** Start transcoding a window of segments forward from segment `startIndex`. */
function spawnRegion(session: HlsSession, startIndex: number) {
  killRegion(session);
  const start = startIndex * SEG_SECONDS;
  // Two-stage seek: fast (keyframe) input seek near the target, then an accurate
  // output seek for the remainder, so the region starts exactly on the grid.
  const fast = Math.max(0, start - 4);
  const acc = start - fast;
  const windowDur = Math.min(REGION_SEGMENTS * SEG_SECONDS, session.durationSec - start) + 1;

  const args = ["-nostdin", "-hide_banner", "-loglevel", "error"];
  args.push("-ss", String(fast), "-i", session.videoUrl);
  if (session.audioUrl) args.push("-ss", String(fast), "-i", session.audioUrl);
  if (acc > 0) args.push("-ss", String(acc));
  args.push("-t", String(windowDur));
  args.push("-map", "0:v:0", "-map", session.audioUrl ? "1:a:0" : "0:a:0?");
  // Constant frame rate + a forced keyframe on every grid boundary makes each
  // segment exactly SEG_SECONDS long, so the pre-built playlist's timings match
  // and there is no A/V drift across segments.
  args.push("-r", String(session.fps), "-vsync", "cfr", "-sc_threshold", "0");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p");
  args.push("-force_key_frames", `expr:gte(t,n_forced*${SEG_SECONDS})`);
  args.push("-c:a", "aac", "-ac", "2");
  // Absolute output timestamps so every region shares ONE continuous timeline
  // (segment N starts at N*SEG). Without this each region restarts at PTS 0 and
  // collides with earlier segments, which corrupts the player's timeline.
  args.push("-output_ts_offset", String(start), "-muxdelay", "0", "-muxpreload", "0");
  args.push(
    "-f", "hls",
    "-hls_time", String(SEG_SECONDS),
    "-hls_list_size", "0",
    "-hls_flags", "independent_segments+omit_endlist+temp_file",
    "-hls_segment_type", "mpegts",
    "-start_number", String(startIndex),
    "-hls_segment_filename", join(session.dir, "seg%05d.ts"),
    join(session.dir, "_region.m3u8"),
  );

  const proc = Bun.spawn([FFMPEG, ...args], { stdout: "ignore", stderr: "pipe" });
  const region: HlsRegion = { proc, startIndex, exited: false };
  session.region = region;
  readLines(proc.stderr as ReadableStream<Uint8Array>, () => {}).catch(() => {});
  void proc.exited.then(() => { region.exited = true; });
}

export function destroyHlsSession(videoId: string) {
  const session = hlsSessions.get(videoId);
  if (!session) return;
  hlsSessions.delete(videoId);
  killRegion(session);
  try { rmSync(session.dir, { recursive: true, force: true }); } catch {}
}

function sweepHlsSessions() {
  const now = Date.now();
  for (const [videoId, session] of hlsSessions) {
    if (now - session.lastAccess > HLS_IDLE_MS) destroyHlsSession(videoId);
  }
}

/**
 * Create (or reuse) a seek-anywhere streaming session and return its static VOD
 * playlist. Null when yt-dlp/ffmpeg can't resolve the video. Also enqueues a
 * clean background copy download so the next visit plays the local file.
 */
export async function getHlsPlaylist(videoId: string): Promise<string | null> {
  const existing = hlsSessions.get(videoId);
  if (existing) { existing.lastAccess = Date.now(); return existing.playlist; }
  if (!(await ytdlpStatus())) return null;
  if (!await database.prepare("SELECT 1 FROM videos WHERE video_id = ? AND is_private = 0").get(videoId)) return null;

  const probe = await probeSource(videoId);
  if (!probe) return null;

  // A second concurrent request may have created the session while we probed.
  const raced = hlsSessions.get(videoId);
  if (raced) { raced.lastAccess = Date.now(); return raced.playlist; }

  const segCount = Math.max(1, Math.ceil(probe.durationSec / SEG_SECONDS));
  const dir = hlsSessionDir(videoId);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  mkdirSync(dir, { recursive: true });

  const session: HlsSession = {
    videoId, dir,
    durationSec: probe.durationSec,
    segCount,
    fps: probe.fps,
    videoUrl: probe.videoUrl,
    audioUrl: probe.audioUrl,
    playlist: buildVodPlaylist(probe.durationSec, segCount),
    region: null,
    lastAccess: Date.now(),
  };
  hlsSessions.set(videoId, session);
  if (!hlsSweeper) hlsSweeper = setInterval(sweepHlsSessions, 30_000);

  // Kick off the clean full download at top priority and start it immediately
  // (not on the next 30s tick). yt-dlp's chunked range download defeats
  // YouTube's per-connection throttling, so the whole file lands in seconds —
  // the moment it's done the player switches to the local, natively seekable
  // file. Until then the on-demand transcode covers playback.
  void prioritizeDownload(videoId).catch(() => {});

  log.info("downloads.stream_start", { videoId, durationSec: probe.durationSec, segCount, fps: probe.fps });
  return session.playlist;
}

/** Serve a segment, transcoding it on demand (waiting for the region to reach it). */
export async function getHlsSegment(videoId: string, file: string, signal?: AbortSignal): Promise<string | null> {
  const session = hlsSessions.get(videoId);
  if (!session) return null;
  session.lastAccess = Date.now();
  const m = file.match(SEGMENT_RE);
  if (!m) return null;
  const index = Number(m[1]);
  if (index < 0 || index >= session.segCount) return null;

  const path = join(session.dir, file);
  if (existsSync(path)) return path;

  // A region starts exactly at the requested segment (so a seek produces that
  // segment first, not after grinding from a block boundary) and transcodes
  // forward for REGION_SEGMENTS. Contiguous requests fall inside that window and
  // reuse it; only a real jump outside it repositions the transcoder. Aborted
  // requests (a seek dropping its stale read-ahead) bail without respawning, so
  // concurrent segment fetches never thrash the single transcoder.
  let spawns = 0;
  const deadline = Date.now() + SEGMENT_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) return null;
    if (existsSync(path)) return path;
    const r = session.region;
    const usable = r && !r.exited && index >= r.startIndex && index < r.startIndex + REGION_SEGMENTS;
    if (!usable && spawns < 3) { spawnRegion(session, index); spawns++; }
    await new Promise((res) => setTimeout(res, 150));
  }
  return existsSync(path) ? path : null;
}

/** Drop any HLS scratch left over from a previous run (called on boot). */
export function resetHlsScratch() {
  try { rmSync(HLS_DIR, { recursive: true, force: true }); } catch {}
}

// ---------- scheduler ----------

let ticking = false;
let lastCleanupAt = 0;

async function tick() {
  if (maintenanceActive()) return;
  if (ticking) return;
  const releaseMutation = beginMutation();
  if (!releaseMutation) return;
  ticking = true;
  try {
    if (!await dlEnabled()) return;
    if (!(await ytdlpStatus())) return;
    const s = dlSettings();
    await autoEnqueue(s);
    await retryErrors();
    if (Date.now() - lastCleanupAt > CLEANUP_INTERVAL_MS) {
      lastCleanupAt = Date.now();
      await cleanup(s);
    }
    if (!active) {
      const next = await pickNext();
      // Fire and forget: `active` guards concurrency, ticks keep flowing.
      if (next) {
        const runRelease = beginMutation();
        if (runRelease) runDownload(next, s)
          .catch((e) => log.error("downloads.run_failed", { videoId: next, error: e instanceof Error ? e.message : String(e) }))
          .finally(runRelease);
      }
    }
  } finally {
    ticking = false;
    releaseMutation();
  }
}

export async function startDownloader() {
  // Drop any HLS streaming scratch left behind by a previous run.
  resetHlsScratch();
  // Crash recovery: an interrupted download restarts from the queue.
  const crashRecovered = (await database.prepare("UPDATE downloads SET status = 'queued' WHERE status = 'downloading'").run()).changes;
  if (crashRecovered > 0) log.warn("downloads.crash_recovered", { count: crashRecovered });
  // Older versions treated optional subtitle failures as a failed video. Give
  // those jobs one clean run through the new video-first pipeline.
  const recoveredSubtitleFailures = (await database.prepare(`
    UPDATE downloads SET status = 'queued', error = NULL, attempts = 0
    WHERE status = 'error' AND (
      error LIKE '%Unable to download video subtitles%'
      OR error LIKE '%Unable to download subtitles%'
      OR error LIKE '%Unable to download automatic captions%'
    )
  `).run()).changes;
  if (recoveredSubtitleFailures > 0) log.info("downloads.subtitle_failures_requeued", { count: recoveredSubtitleFailures });
  const reportTickError = (error: unknown) => log.error("downloads.tick_failed", { error: error instanceof Error ? error.message : String(error) });
  setTimeout(() => tick().catch(reportTickError), 8_000);
  setInterval(() => tick().catch(reportTickError), TICK_INTERVAL_MS);
  setInterval(() => ytdlpSelfUpdate().catch((error) => log.warn("downloads.ytdlp_update_failed", { error: error instanceof Error ? error.message : String(error) })), 24 * 60 * 60_000);
  const queue = Object.fromEntries((await database.prepare("SELECT status AS name, COUNT(*) AS count FROM downloads GROUP BY status").all() as { name: string; count: number }[]).map((row) => [row.name, Number(row.count)]));
  log.info("scheduler.downloads", { dir: DOWNLOADS_DIR, intervalMs: TICK_INTERVAL_MS, enabled: await dlEnabled(), queue });
}
