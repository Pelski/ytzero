import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { database } from "./database";
import { DB_PATH, getSetting, setSetting } from "./db";
import { log } from "./logger";


// Files land in one global directory: a video downloaded once serves every
// profile. Retention below is the only thing that removes them.
export const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? resolve(import.meta.dir, "../../data/downloads");
mkdirSync(DOWNLOADS_DIR, { recursive: true });
const DOWNLOAD_COOKIES_DIR = process.env.DOWNLOAD_COOKIES_DIR ?? resolve(dirname(DB_PATH), "../download-cookies");
const LEGACY_DOWNLOAD_COOKIES_FILE = process.env.LEGACY_DOWNLOAD_COOKIES_FILE ?? resolve(import.meta.dir, "../../data/yt-dlp-cookies.txt");
mkdirSync(DOWNLOAD_COOKIES_DIR, { recursive: true });
const MAX_COOKIES_BYTES = 4 * 1024 * 1024;
export const YTDLP = process.env.YTDLP_PATH ?? "yt-dlp";



// ---------- settings ----------

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

const ADMIN_DOWNLOAD_SETTING_KEYS = new Set([
  "output_template", "write_thumbnail", "embed_metadata", "write_info_json", "write_nfo",
  "write_subs", "max_storage_gb",
]);

export async function dlSettings(userId?: number): Promise<DlSettings> {
  const profileValues = new Map<string, string>();
  if (userId != null) {
    const rows = await database.prepare("SELECT key,value FROM plugin_settings WHERE plugin_id='downloads' AND user_id=?").all(userId) as { key: string; value: string }[];
    for (const row of rows) profileValues.set(row.key, row.value);
  }
  const out: Record<string, number | string> = {};
  for (const [key, def] of Object.entries(DL_DEFAULTS)) {
    const raw = ADMIN_DOWNLOAD_SETTING_KEYS.has(key)
      ? getSetting(`plugin_downloads_${key}`)
      : profileValues.get(key);
    if (raw == null) { out[key] = def; continue; }
    out[key] = typeof def === "number" ? (Number.isFinite(Number(raw)) ? Number(raw) : def) : raw;
  }
  return out as DlSettings;
}

export function downloadCookiesFile(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("invalid profile id");
  return join(DOWNLOAD_COOKIES_DIR, `${userId}.txt`);
}

/** Cookie jars are deliberately stored outside the settings database, one per
 * profile, so they are never returned by a settings API or portable backup. */
export function downloadCookiesConfigured(userId: number) {
  return existsSync(downloadCookiesFile(userId));
}

/** Build an argv list for metadata-only features that share yt-dlp and its
 * optional cookie jar without exposing the cookie path outside this module. */
export function ytdlpCommand(userId: number, args: string[], useCookies = false): string[] {
  return [YTDLP, ...args, ...(useCookies && downloadCookiesConfigured(userId) ? ["--cookies", downloadCookiesFile(userId)] : [])];
}

export function saveDownloadCookies(userId: number, contents: string) {
  if (!contents.trim()) throw new Error("cookies file is empty");
  if (new TextEncoder().encode(contents).byteLength > MAX_COOKIES_BYTES) {
    throw new Error("cookies file is too large");
  }
  const normalized = contents.replace(/^\uFEFF/, "");
  if (!/^# (?:(?:Netscape )?HTTP Cookie File|Netscape Cookie File)\b/m.test(normalized)) {
    throw new Error("cookies must be in Netscape cookies.txt format");
  }
  const destination = downloadCookiesFile(userId);
  const temporary = `${destination}.tmp`;
  writeFileSync(temporary, normalized, { mode: 0o600 });
  renameSync(temporary, destination);
  try { chmodSync(destination, 0o600); } catch { /* unsupported on some hosts */ }
}

export function removeDownloadCookies(userId: number) {
  const path = downloadCookiesFile(userId);
  if (existsSync(path)) unlinkSync(path);
}

/** Move the former instance-wide cookie jar into each existing profile once.
 * Copying preserves the old behavior immediately; profiles can then replace or
 * remove their own secret independently. */
export async function migrateLegacyDownloadCookies() {
  if (getSetting("downloads_profile_cookies_migrated") === "1") return;
  if (existsSync(LEGACY_DOWNLOAD_COOKIES_FILE)) {
    const users = await database.prepare("SELECT id FROM users").all() as { id: number }[];
    for (const user of users) {
      const destination = downloadCookiesFile(user.id);
      if (!existsSync(destination)) copyFileSync(LEGACY_DOWNLOAD_COOKIES_FILE, destination);
      try { chmodSync(destination, 0o600); } catch { /* unsupported on some hosts */ }
    }
    unlinkSync(LEGACY_DOWNLOAD_COOKIES_FILE);
  }
  setSetting("downloads_profile_cookies_migrated", "1");
}

export async function dlEnabled(): Promise<boolean> {
  const row = await database.prepare("SELECT enabled FROM plugins WHERE id = 'downloads'").get() as { enabled: number } | null;
  return row?.enabled === 1;
}

// ---------- yt-dlp binary ----------

let ytdlpVersion: string | null | undefined;

export function invalidateYtdlpStatus(): void {
  ytdlpVersion = undefined;
}

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

export async function ytdlpSelfUpdate() {
  if (process.env.YTDLP_AUTO_UPDATE !== "1") return;
  try {
    const proc = Bun.spawn([YTDLP, "-U"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    ytdlpVersion = undefined; // re-read version on next status call
  } catch {}
}

