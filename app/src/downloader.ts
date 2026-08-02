import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { database } from "./database";
import { DB_PATH, getSetting, setSetting } from "./db";
import { downloadCookieAttempts, downloadFormat, renderDownloadOutputTemplate } from "./downloadStrategy";
import { log } from "./logger";
import { beginMutation, maintenanceActive } from "./maintenance";
import { publishAppEvent } from "./appEvents";
import { notifyDownloadFailed } from "./notifications";
import { createDownloadStreaming } from "./downloadStreaming";
import { autoDownloadFollowerExistsSql } from "./downloadEligibility";
import { automaticDownloadCandidates, migrateLegacyDownloadAutomation } from "./downloadRules";
import { shouldAutoDownloadVideo } from "./downloadContentPolicy";
import {
  DOWNLOADS_DIR,
  YTDLP,
  dlEnabled,
  dlSettings,
  downloadCookiesConfigured,
  downloadCookiesFile,
  invalidateYtdlpStatus,
  migrateLegacyDownloadCookies,
  ytdlpSelfUpdate,
  ytdlpStatus,
  type DlSettings,
} from "./downloadConfig";
export {
  DL_DEFAULTS,
  dlSettings,
  downloadCookiesConfigured,
  migrateLegacyDownloadCookies,
  removeDownloadCookies,
  saveDownloadCookies,
  ytdlpCommand,
  ytdlpStatus,
} from "./downloadConfig";
export type { DlSettings } from "./downloadConfig";
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MIN = 30;
const CLEANUP_INTERVAL_MS = 10 * 60_000;
const TICK_INTERVAL_MS = 30_000;
export const DOWNLOAD_MANIFEST_SUFFIX = ".ytz.json";
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
const notifyDownloadFailure = async (videoId: string, error: string) => {
  try {
    await notifyDownloadFailed(videoId, error);
  } catch (notificationError) {
    log.warn("downloads.failure_notification_failed", {
      videoId,
      error: notificationError instanceof Error ? notificationError.message : String(notificationError),
    });
  }
};

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
  for (const baseDir of new Set([dirname(videoId), ...(base ? [dirname(base)] : [])])) {
    const manifest = join(DOWNLOADS_DIR, baseDir, `${videoId}${DOWNLOAD_MANIFEST_SUFFIX}`);
    if (existsSync(manifest)) files.add(manifest);
  }
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

interface DownloadManifest {
  schemaVersion: 1;
  videoId: string;
  /** Relative to the manifest. Never an absolute host path. */
  file: string;
  sizeBytes: number;
  downloadedAt: string;
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 1_024) return false;
  if (value.includes("\\") || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return true;
}

function manifestPathFor(videoId: string, filePath: string): string {
  return join(dirname(filePath), `${videoId}${DOWNLOAD_MANIFEST_SUFFIX}`);
}

export function writeDownloadManifest(videoId: string, filePath: string, sizeBytes: number) {
  const manifest: DownloadManifest = {
    schemaVersion: 1,
    videoId,
    file: basename(filePath),
    sizeBytes,
    downloadedAt: new Date().toISOString(),
  };
  const path = manifestPathFor(videoId, filePath);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest)}\n`);
  renameSync(temporaryPath, path);
}

/**
 * Reconnect files moved with their small recovery manifest before cleanup can
 * classify their former database paths as missing. Manifests without a known
 * download are still returned as protected, so an unfamiliar file is never
 * deleted merely because it lives under DOWNLOADS_DIR.
 */
async function recoverManifestDownloads(): Promise<{ recovered: number; recoveredVideoIds: Set<string>; protectedFiles: Set<string> }> {
  const root = resolve(DOWNLOADS_DIR);
  const protectedFiles = new Set<string>();
  const recoveredVideoIds = new Set<string>();
  let recovered = 0;
  for (const manifestPath of walkFiles(DOWNLOADS_DIR).filter((path) => path.endsWith(DOWNLOAD_MANIFEST_SUFFIX))) {
    protectedFiles.add(manifestPath);
    let value: Partial<DownloadManifest>;
    try { value = JSON.parse(await Bun.file(manifestPath).text()); } catch { continue; }
    if (value.schemaVersion !== 1 || typeof value.videoId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.videoId) || !isSafeRelativePath(value.file)) continue;
    const filePath = resolve(dirname(manifestPath), value.file);
    if (!filePath.startsWith(`${root}/`) || !existsSync(filePath)) continue;
    let size: number;
    try { size = statSync(filePath).size; } catch { continue; }
    protectedFiles.add(filePath);
    const result = await database.prepare(`
      UPDATE downloads
      SET status='done', path=?, size_bytes=?, error=NULL, finished_at=COALESCE(finished_at, datetime('now'))
      WHERE video_id=? AND status IN ('done', 'deleted')
    `).run(filePath, size, value.videoId);
    if (result.changes > 0) {
      recovered++;
      recoveredVideoIds.add(value.videoId);
      notifyDownloadChanged(value.videoId);
      log.info("downloads.recovered_from_manifest", { videoId: value.videoId, path: filePath });
    }
  }
  return { recovered, recoveredVideoIds, protectedFiles };
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
async function fetchSubtitleSidecars(userId: number, videoId: string, langs: string, options: SubtitleFetchOptions): Promise<boolean> {
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
  if (downloadCookiesConfigured(userId)) args.push("--cookies", downloadCookiesFile(userId));
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

export async function fetchSubtitles(userId: number, videoId: string, lang: string): Promise<boolean> {
  return fetchSubtitleSidecars(userId, videoId, lang, { manual: true, automatic: true });
}

/** Naive SRT → WebVTT conversion, enough for <track> playback. */
export function srtToVtt(srt: string): string {
  return "WEBVTT\n\n" + srt
    .replace(/\r/g, "")
    .replace(/^\d+\n(?=\d{2}:)/gm, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

// ---------- public queue operations ----------

async function claimDownload(userId: number, videoId: string, source: "manual" | "scheduled" | "feed", automationRuleId?: number | null) {
  await database.prepare(`
    INSERT INTO download_owners (user_id, video_id, source, automation_rule_id, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, video_id) DO UPDATE SET
      source=excluded.source,
      automation_rule_id=excluded.automation_rule_id,
      created_at=excluded.created_at
  `).run(userId, videoId, source, source === "feed" ? automationRuleId ?? null : null);
}

export async function enqueueDownload(userId: number, videoId: string, source: "manual" | "scheduled" | "feed", priority = false, reviveDeleted = false, context: { playlistTitle?: string | null; notify?: boolean; automationRuleId?: number | null } = {}): Promise<boolean> {
  const row = await database.prepare("SELECT status, path FROM downloads WHERE video_id = ?").get(videoId) as { status: string; path: string | null } | null;
  if (row) {
    await claimDownload(userId, videoId, source, context.automationRuleId);
    if (row.status === "downloading") return false;
    if (row.status === "done" && row.path && existsSync(row.path)) return false;
    // Auto policies never resurrect rows they've already handled (incl. the
    // 'deleted' removal tombstone); a manual request always re-queues, and the
    // scheduled policy may revive a tombstone when the user re-queued the video
    // after the file was removed (reviveDeleted).
    if (source !== "manual" && !(reviveDeleted && row.status === "deleted")) return false;
    await database.prepare("UPDATE downloads SET status = 'queued', source = ?, priority = ?, playlist_title = ?, automation_rule_id = ?, requested_by_user_id = ?, error = NULL, attempts = 0, created_at = datetime('now') WHERE video_id = ?")
      .run(source, priority ? 1 : 0, context.playlistTitle ?? null, source === "feed" ? context.automationRuleId ?? null : null, userId, videoId);
    if (context.notify !== false) notifyDownloadChanged(videoId);
    return true;
  }
  const exists = await database.prepare("SELECT 1 FROM videos WHERE video_id = ? AND is_private = 0").get(videoId);
  if (!exists) return false;
  await database.prepare("INSERT INTO downloads (video_id, status, source, priority, playlist_title, automation_rule_id, requested_by_user_id) VALUES (?, 'queued', ?, ?, ?, ?, ?)").run(videoId, source, priority ? 1 : 0, context.playlistTitle ?? null, source === "feed" ? context.automationRuleId ?? null : null, userId);
  await claimDownload(userId, videoId, source, context.automationRuleId);
  if (context.notify !== false) notifyDownloadChanged(videoId);
  return true;
}

export async function enqueuePlaylistDownloads(userId: number, videoIds: string[], playlistTitle: string) {
  let queued = 0;
  const existingDownload = database.prepare("SELECT status FROM downloads WHERE video_id = ?");
  for (const videoId of videoIds) {
    const existing = await existingDownload.get(videoId) as { status: string } | null;
    const owned = await database.prepare("SELECT 1 FROM download_owners WHERE user_id=? AND video_id=?").get(userId, videoId);
    if (owned && (existing?.status === "queued" || existing?.status === "downloading" || existing?.status === "done")) continue;
    if (await enqueueDownload(userId, videoId, "manual", false, false, { playlistTitle, notify: false })) queued++;
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
export async function prioritizeDownload(userId: number, videoId: string): Promise<boolean> {
  const queued = await enqueueDownload(userId, videoId, "manual", true);
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
export async function removeDownload(userId: number, videoId: string) {
  await database.prepare("DELETE FROM download_owners WHERE user_id=? AND video_id=?").run(userId, videoId);
  const remaining = await database.prepare("SELECT user_id FROM download_owners WHERE video_id=? ORDER BY created_at,user_id LIMIT 1").get(videoId) as { user_id: number } | null;
  if (remaining) {
    await database.prepare("UPDATE downloads SET requested_by_user_id=? WHERE video_id=? AND requested_by_user_id=?").run(remaining.user_id, videoId, userId);
    notifyDownloadChanged(videoId);
    return;
  }
  if (active?.videoId === videoId) {
    active.cancelled = true;
    try { active.proc.kill(); } catch {}
  }
  await unlinkFiles(videoId);
  await database.prepare("UPDATE downloads SET status = 'deleted', path = NULL, size_bytes = NULL, error = NULL, priority = 0 WHERE video_id = ?").run(videoId);
  notifyDownloadChanged(videoId);
}

/** Stop every unfinished job without touching completed downloads. Deleted
 * tombstones keep automatic rules from immediately recreating the queue. */
export async function cancelAllPendingDownloads(userId: number): Promise<number> {
  const rows = await database.prepare(`
    SELECT d.video_id FROM downloads d
    JOIN download_owners owner ON owner.video_id=d.video_id
    WHERE owner.user_id=? AND d.status IN ('queued', 'downloading', 'error')
  `).all(userId) as { video_id: string }[];
  if (rows.length === 0) return 0;
  for (const { video_id } of rows) await removeDownload(userId, video_id);
  publishAppEvent("downloads", { cancelled: rows.length });
  log.info("downloads.queue_cancelled", { count: rows.length });
  return rows.length;
}

/**
 * A profile rejected (archived) the video: an in-flight auto download (feed /
 * scheduled) is pointless unless some other profile still waits for it. Manual
 * requests and finished files are left alone — retention handles those.
 */
export async function cancelAutoDownloadIfUnwanted(userId: number, videoId: string) {
  const row = await database.prepare("SELECT d.status, owner.source FROM downloads d JOIN download_owners owner ON owner.video_id=d.video_id WHERE d.video_id=? AND owner.user_id=?").get(videoId, userId) as { status: string; source: string } | null;
  if (!row || row.source === "manual") return;
  if (row.status !== "queued" && row.status !== "downloading") return;
  const stillWanted = await database.prepare("SELECT 1 FROM user_videos uv WHERE uv.user_id=? AND uv.video_id=? AND uv.status='queued' AND COALESCE(uv.watched,0)=0").get(userId, videoId);
  if (stillWanted) return;
  await removeDownload(userId, videoId);
  log.info("downloads.cancelled_after_reject", { videoId, source: row.source });
}

export async function setDownloadPinned(userId: number, videoId: string, pinned: boolean): Promise<boolean> {
  const r = await database.prepare("UPDATE download_owners SET pinned = ? WHERE user_id=? AND video_id = ?").run(pinned ? 1 : 0, userId, videoId);
  if (r.changes > 0) notifyDownloadChanged(videoId);
  return r.changes > 0;
}

export async function listDownloads(userId: number, includeAllProfiles = false) {
  const rows = await database.prepare(`
    SELECT d.video_id, d.status, owner.source, d.quality, d.size_bytes, d.error, d.attempts, owner.pinned,
           owner.created_at, d.finished_at, owner.automation_rule_id, dr.name AS automation_rule_name,
           owner.user_id, u.name AS profile_name, u.avatar_color AS profile_color,
           v.title, v.thumbnail, v.duration, v.is_short, v.published_at,
           c.channel_id, COALESCE(c.custom_title, c.title) AS channel_title
    FROM downloads d
    JOIN download_owners owner ON owner.video_id=d.video_id
    JOIN users u ON u.id=owner.user_id
    JOIN videos v ON v.video_id = d.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN download_rules dr ON dr.id = owner.automation_rule_id AND dr.user_id=owner.user_id
    WHERE d.status != 'deleted' AND (?=1 OR owner.user_id=?)
    ORDER BY CASE d.status WHEN 'downloading' THEN 0 WHEN 'queued' THEN 1 WHEN 'error' THEN 2 ELSE 3 END,
             COALESCE(d.finished_at, d.created_at) DESC
  `).all(includeAllProfiles ? 1 : 0, userId) as any[];
  return rows;
}

export async function downloadStats(userId: number, includeAllProfiles = false) {
  const row = await database.prepare(`
    SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes),0) AS bytes FROM (
      SELECT DISTINCT d.video_id, d.size_bytes
      FROM downloads d JOIN download_owners owner ON owner.video_id=d.video_id
      WHERE d.status='done' AND (?=1 OR owner.user_id=?)
    ) scoped_downloads
  `).get(includeAllProfiles ? 1 : 0, userId) as { files: number; bytes: number };
  const queued = (await database.prepare("SELECT COUNT(DISTINCT d.video_id) AS n FROM downloads d JOIN download_owners owner ON owner.video_id=d.video_id WHERE d.status IN ('queued','downloading') AND (?=1 OR owner.user_id=?)").get(includeAllProfiles ? 1 : 0, userId) as { n: number }).n;
  const s = await dlSettings(userId);
  return { files: row.files, bytes: row.bytes, queued, cap_bytes: s.max_storage_gb * 1024 ** 3 };
}

export async function downloadStatusSummary(userId: number) {
  const row = await database.prepare(`
    SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) AS downloading,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
    FROM downloads d JOIN download_owners owner ON owner.video_id=d.video_id
    WHERE owner.user_id=?
  `).get(userId) as { queued: number | string | null; downloading: number | string | null; completed: number | string | null; errors: number | string | null };
  return {
    queued: Number(row.queued ?? 0),
    downloading: Number(row.downloading ?? 0),
    completed: Number(row.completed ?? 0),
    errors: Number(row.errors ?? 0),
  };
}

export async function getDownload(userId: number, videoId: string) {
  return await database.prepare("SELECT d.video_id, d.status, d.quality, d.path, d.size_bytes, d.error, owner.pinned FROM downloads d JOIN download_owners owner ON owner.video_id=d.video_id WHERE owner.user_id=? AND d.video_id=? AND d.status!='deleted'")
    .get(userId, videoId) as { video_id: string; status: string; quality: string | null; path: string | null; size_bytes: number | null; error: string | null; pinned: number } | null;
}

/** Reset only the active profile's download ownership and preferences. Shared
 * files survive while another profile still owns them. */
export async function resetDownloadsState(userId: number) {
  const rows = await database.prepare("SELECT video_id FROM download_owners WHERE user_id=?").all(userId) as { video_id: string }[];
  for (const { video_id } of rows) await removeDownload(userId, video_id);
  await database.prepare("DELETE FROM download_rules WHERE user_id=?").run(userId);
  await database.prepare("DELETE FROM plugin_settings WHERE plugin_id='downloads' AND user_id=?").run(userId);
  publishAppEvent("downloads", { reset: true, userId });
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

async function autoEnqueue() {
  // A members-only badge can arrive after a feed job was queued. Remove stale
  // automatic jobs (including visible errors) when no following profile would
  // see that upload in its feed. Manual and scheduled intent is untouched.
  const prunedMembersOnly = await database.prepare(`
    UPDATE downloads
    SET status = 'deleted', error = NULL, finished_at = datetime('now')
    WHERE source = 'feed' AND automation_rule_id IS NULL
      AND status IN ('queued', 'error')
      AND video_id IN (
        SELECT v.video_id
        FROM videos v
        WHERE v.members_only = 1
          AND NOT (${autoDownloadFollowerExistsSql("v")})
      )
  `).run();
  if (prunedMembersOnly.changes > 0) {
    log.info("downloads.members_only_pruned", { count: prunedMembersOnly.changes });
    publishAppEvent("downloads", { pruned: prunedMembersOnly.changes });
  }

  const users = await database.prepare("SELECT id FROM users").all() as { id: number }[];
  for (const user of users) {
    const enabled = await database.prepare("SELECT value FROM plugin_settings WHERE plugin_id='downloads' AND user_id=? AND key='profile_enabled'").get(user.id) as { value: string } | null;
    const settings = await dlSettings(user.id);
    if (enabled?.value === "0" || settings.download_scheduled !== 1) continue;
    // Anything any profile put on a watch-later bucket and hasn't watched yet.
    // 30-day window keeps a fresh plugin enable from crawling years of
    // long-forgotten watch-later backlog.
    const rows = await database.prepare(`
      SELECT DISTINCT uv.user_id, v.video_id, v.is_short FROM user_videos uv
      JOIN videos v ON v.video_id = uv.video_id
      WHERE uv.user_id=? AND uv.status = 'queued'
        AND v.live_status = 'none'
        AND v.is_private = 0
        AND COALESCE(uv.watched, 0) = 0
        AND COALESCE(uv.queued_at, datetime('now')) >= datetime('now', '-30 days')
        AND NOT EXISTS (SELECT 1 FROM download_owners owner WHERE owner.user_id=uv.user_id AND owner.video_id=v.video_id)
      LIMIT 50
    `).all(user.id) as { user_id: number; video_id: string; is_short: number | null }[];
    for (const { user_id, video_id, is_short } of rows) {
      if (!shouldAutoDownloadVideo(is_short, settings.download_shorts === 1)) continue;
      await enqueueDownload(user_id, video_id, "scheduled", false, true);
    }
  }

  for (const candidate of await automaticDownloadCandidates(50)) {
    const enabled = await database.prepare("SELECT value FROM plugin_settings WHERE plugin_id='downloads' AND user_id=? AND key='profile_enabled'").get(candidate.user_id) as { value: string } | null;
    if (enabled?.value === "0") continue;
    await enqueueDownload(candidate.user_id, candidate.video_id, "feed", false, false, { automationRuleId: candidate.rule_id });
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

interface CleanupOwnerRow {
  user_id: number;
  video_id: string;
  pinned: number;
  finished_at: string | null;
  status: string | null;
  watched: number;
  liked: number;
  watched_at: string | null;
}

function sqliteTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function ownerProtected(row: CleanupOwnerRow, settings: DlSettings) {
  return row.pinned === 1
    || (row.status === "queued" && row.watched !== 1)
    || (row.liked === 1 && settings.keep_liked === 1);
}

async function physicalDownloadProtected(videoId: string) {
  const owners = await database.prepare(`
    SELECT owner.user_id, owner.video_id, owner.pinned, d.finished_at,
           uv.status, COALESCE(uv.watched, 0) AS watched,
           COALESCE(uv.liked, 0) AS liked, NULL AS watched_at
    FROM download_owners owner
    JOIN downloads d ON d.video_id=owner.video_id
    LEFT JOIN user_videos uv ON uv.user_id=owner.user_id AND uv.video_id=owner.video_id
    WHERE owner.video_id=?
  `).all(videoId) as CleanupOwnerRow[];
  for (const owner of owners) {
    if (ownerProtected(owner, await dlSettings(owner.user_id))) return true;
  }
  return false;
}

// Retention keeps a 'deleted' tombstone so auto policies don't re-download;
// a manual request clears it (see enqueueDownload).
async function tombstone(videoId: string) {
  await unlinkFiles(videoId);
  await database.prepare("UPDATE downloads SET status = 'deleted', path = NULL, size_bytes = NULL WHERE video_id = ?").run(videoId);
  notifyDownloadChanged(videoId);
}

async function cleanup(s: DlSettings) {
  const manifestRecovery = await recoverManifestDownloads();
  if (manifestRecovery.recovered > 0) publishAppEvent("downloads", { recovered: manifestRecovery.recovered });
  // 1–2. Retention and watched cleanup are profile policies. Remove only that
  // profile's ownership; removeDownload tombstones the physical file only when
  // no other profile still owns it.
  const owners = await database.prepare(`
    SELECT owner.user_id, owner.video_id, owner.pinned, d.finished_at,
           uv.status, COALESCE(uv.watched, 0) AS watched,
           COALESCE(uv.liked, 0) AS liked,
           (SELECT MAX(h.watched_at) FROM history h WHERE h.user_id=owner.user_id AND h.video_id=owner.video_id) AS watched_at
    FROM download_owners owner
    JOIN downloads d ON d.video_id=owner.video_id
    LEFT JOIN user_videos uv ON uv.user_id=owner.user_id AND uv.video_id=owner.video_id
    WHERE d.status='done'
  `).all() as CleanupOwnerRow[];
  const now = Date.now();
  const settingsByUser = new Map<number, DlSettings>();
  for (const owner of owners) {
    if (manifestRecovery.recoveredVideoIds.has(owner.video_id)) continue;
    let profileSettings = settingsByUser.get(owner.user_id);
    if (!profileSettings) {
      profileSettings = await dlSettings(owner.user_id);
      settingsByUser.set(owner.user_id, profileSettings);
    }
    if (ownerProtected(owner, profileSettings)) continue;
    const finishedAt = sqliteTime(owner.finished_at);
    const watchedAt = sqliteTime(owner.watched_at) ?? finishedAt;
    const retentionExpired = finishedAt != null && finishedAt <= now - profileSettings.retention_days * 86_400_000;
    const watchedExpired = profileSettings.delete_watched === 1 && owner.watched === 1
      && watchedAt != null && watchedAt <= now - profileSettings.delete_watched_hours * 3_600_000;
    if (!retentionExpired && !watchedExpired) continue;
    await removeDownload(owner.user_id, owner.video_id);
    log.info("downloads.profile_retention_removed", { videoId: owner.video_id, userId: owner.user_id, reason: watchedExpired ? "watched" : "age" });
  }

  // 3. The physical storage cap remains administrator-owned. A file is still
  // protected when any owner pins/schedules it or protects their own like.
  const cap = s.max_storage_gb * 1024 ** 3;
  let total = (await database.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS b FROM downloads WHERE status = 'done'").get() as { b: number }).b;
  if (total > cap) {
    const candidates = await database.prepare(`
      SELECT d.video_id, d.size_bytes FROM downloads d
      WHERE d.status = 'done'
      ORDER BY d.finished_at ASC
    `).all() as { video_id: string; size_bytes: number | null }[];
    for (const row of candidates) {
      if (total <= cap) break;
      if (manifestRecovery.recoveredVideoIds.has(row.video_id)) continue;
      if (await physicalDownloadProtected(row.video_id)) continue;
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
    if (manifestRecovery.protectedFiles.has(full)) continue;
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

/** Explicit entry point used by maintenance flows and migration regression
 * tests; the scheduler invokes the same profile-aware cleanup internally. */
export async function cleanupDownloadsNow() {
  await cleanup(await dlSettings());
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

async function runDownload(userId: number, videoId: string, s: DlSettings) {
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

  const cookieAttempts = downloadCookieAttempts(downloadCookiesConfigured(userId));
  let job: ActiveDownload | null = null;
  let code = 1;
  let stderrTail: string[] = [];

  for (let attemptIndex = 0; attemptIndex < cookieAttempts.length; attemptIndex++) {
    const useCookies = cookieAttempts[attemptIndex];
    const args = [...baseArgs];
    if (useCookies) args.push("--cookies", downloadCookiesFile(userId));

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await database.prepare("UPDATE downloads SET status = 'error', error = ? WHERE video_id = ?").run(error, videoId);
      notifyDownloadChanged(videoId);
      await notifyDownloadFailure(videoId, error);
      invalidateYtdlpStatus(); // binary may have moved — re-check on next tick
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
      try { writeDownloadManifest(videoId, path, size); } catch (e) {
        log.warn("downloads.manifest_failed", { videoId, error: e instanceof Error ? e.message : String(e) });
      }
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
        await fetchSubtitleSidecars(userId, videoId, String(s.sub_langs ?? ""), {
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
  await notifyDownloadFailure(videoId, error);
  log.error("downloads.failed", { videoId, code, error });
}

const {
  destroyHlsSession,
  getHlsPlaylist,
  getHlsSegment,
  isSegmentName,
  liveStreamEnabled,
  resetHlsScratch,
} = createDownloadStreaming({
  DOWNLOADS_DIR,
  YTDLP,
  dlEnabled,
  dlSettings,
  downloadCookiesConfigured,
  downloadCookiesFile,
  prioritizeDownload,
  readLines,
  ytdlpStatus,
});

export { destroyHlsSession, getHlsPlaylist, getHlsSegment, isSegmentName, liveStreamEnabled };
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
    const cleanupSettings = await dlSettings();
    await autoEnqueue();
    await retryErrors();
    if (Date.now() - lastCleanupAt > CLEANUP_INTERVAL_MS) {
      lastCleanupAt = Date.now();
      await cleanup(cleanupSettings);
    }
    if (!active) {
      const next = await pickNext();
      // Fire and forget: `active` guards concurrency, ticks keep flowing.
      if (next) {
        const owner = await database.prepare("SELECT requested_by_user_id AS user_id FROM downloads WHERE video_id=?").get(next) as { user_id: number | null } | null;
        const fallbackOwner = owner?.user_id == null
          ? await database.prepare("SELECT id AS user_id FROM users ORDER BY id LIMIT 1").get() as { user_id: number } | null
          : null;
        const userId = owner?.user_id ?? fallbackOwner?.user_id;
        if (userId == null) return;
        const jobSettings = await dlSettings(userId);
        const runRelease = beginMutation();
        if (runRelease) runDownload(userId, next, jobSettings)
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
  await migrateLegacyDownloadCookies();
  await migrateLegacyDownloadAutomation();
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
