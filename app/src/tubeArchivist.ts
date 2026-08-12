import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { database } from "./database";
import { DB_PATH, getSetting, setSetting } from "./db";
import { log } from "./logger";
import { pluginEnabled } from "./plugins";
import { normalizeVideoComments, type VideoCommentsResult } from "./youtubeComments";

const PLUGIN_ID = "tubearchivist";
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
const CONFIG_DIR = process.env.TUBE_ARCHIVIST_CONFIG_DIR ?? resolve(dirname(DB_PATH), "../tubearchivist");
const TOKEN_FILE = resolve(CONFIG_DIR, "token");
const MAX_PAGES = 20_000;
let syncPromise: Promise<TubeArchivistSyncResult> | null = null;
let syncAbortController: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let watchedTimer: ReturnType<typeof setTimeout> | null = null;

export interface TubeArchivistConfigStatus {
  baseUrl: string;
  tokenConfigured: boolean;
  configured: boolean;
  running: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  itemCount: number;
}

export interface TubeArchivistSyncResult { imported: number; pages: number }

function configuredBaseUrl(): string {
  return getSetting("plugin_tubearchivist_base_url")?.trim() ?? "";
}

export function normalizeTubeArchivistBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new URL(value.trim());
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.hash) {
    throw new Error("TubeArchivist URL must be an http(s) origin without credentials or a fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

function token(): string {
  if (!existsSync(TOKEN_FILE)) return "";
  return readFileSync(TOKEN_FILE, "utf8").trim();
}

export function tubeArchivistConfigured(): boolean {
  return Boolean(configuredBaseUrl() && token());
}

export function saveTubeArchivistConfig(input: { baseUrl?: unknown; token?: unknown; clearToken?: boolean }): void {
  if (input.baseUrl !== undefined) setSetting("plugin_tubearchivist_base_url", normalizeTubeArchivistBaseUrl(input.baseUrl));
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (input.clearToken) {
    if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
  } else if (typeof input.token === "string" && input.token.trim()) {
    const temporary = `${TOKEN_FILE}.tmp`;
    writeFileSync(temporary, `${input.token.trim()}\n`, { mode: 0o600 });
    renameSync(temporary, TOKEN_FILE);
    try { chmodSync(TOKEN_FILE, 0o600); } catch { /* unsupported filesystem */ }
  }
}

function apiUrl(path: string, query?: URLSearchParams): URL {
  const base = normalizeTubeArchivistBaseUrl(configuredBaseUrl());
  if (!base) throw new Error("TubeArchivist is not configured");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) url.search = query.toString();
  return url;
}

async function request(path: string, init: RequestInit = {}, query?: URLSearchParams): Promise<Response> {
  const secret = token();
  if (!secret) throw new Error("TubeArchivist token is not configured");
  let response: Response;
  try {
    response = await fetch(apiUrl(path, query), {
      ...init,
      redirect: "manual",
      headers: { Accept: "application/json", ...init.headers, Authorization: `Token ${secret}` },
    });
  } catch {
    throw new Error("TubeArchivist request failed");
  }
  if (response.status >= 300 && response.status < 400) throw new Error("TubeArchivist redirect was rejected");
  if (response.status === 401 || response.status === 403) throw new Error("TubeArchivist authentication failed");
  return response;
}

export async function testTubeArchivistConnection(): Promise<{ version: string | null }> {
  const response = await request("/api/ping/");
  if (!response.ok) throw new Error(`TubeArchivist returned HTTP ${response.status}`);
  const body = await response.json().catch(() => ({})) as any;
  return { version: typeof body?.version === "string" ? body.version : null };
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function date(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1_000).toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function rawVideos(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.results)) return body.results;
  return [];
}

function hasNextPage(body: any, count: number): boolean {
  const paginate = body?.paginate ?? body?.pagination ?? {};
  if (paginate.next_pages === null || paginate.next_page === null) return false;
  if (Array.isArray(paginate.next_pages)) return paginate.next_pages.length > 0;
  if (typeof paginate.last_page === "number" && typeof paginate.current_page === "number") return paginate.current_page < paginate.last_page;
  return count > 0;
}

async function importPage(items: any[], generation: number): Promise<number> {
  let imported = 0;
  await database.transaction(async () => {
    for (const raw of items) {
      const videoId = text(raw?.youtube_id ?? raw?.video_id ?? raw?.id);
      if (!VIDEO_ID.test(videoId)) continue;
      const channel = raw?.channel && typeof raw.channel === "object" ? raw.channel : {};
      const channelId = text(channel.channel_id ?? raw?.channel_id);
      if (!channelId) continue;
      const channelTitle = text(channel.channel_name ?? channel.channel_title ?? raw?.channel_name, channelId);
      const publishedAt = date(raw?.published ?? raw?.published_at ?? raw?.upload_date);
      const downloadedAt = date(raw?.date_downloaded ?? raw?.downloaded_at);
      const durationValue = raw?.player?.duration ?? raw?.duration;
      const duration = Number.isFinite(Number(durationValue)) ? String(Math.max(0, Math.floor(Number(durationValue)))) : text(durationValue) || null;
      const views = Number(raw?.stats?.view_count ?? raw?.view_count);
      const likes = Number(raw?.stats?.like_count ?? raw?.like_count);
      const isShort = raw?.vid_type === "shorts" || raw?.type === "shorts" ? 1 : 0;
      const thumbnail = `/api/plugins/tubearchivist/thumbnail/${encodeURIComponent(videoId)}`;
      await database.prepare(`
        INSERT INTO channels (channel_id, title, url, thumbnail)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
          title = CASE WHEN excluded.title != '' THEN excluded.title ELSE channels.title END,
          thumbnail = CASE WHEN channels.thumbnail = '' THEN excluded.thumbnail ELSE channels.thumbnail END
      `).run(channelId, channelTitle, `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`, text(channel.channel_thumb, thumbnail));
      await database.prepare(`
        INSERT INTO videos (video_id, channel_id, title, description, thumbnail, published_at, live_status, created_at, duration, views, likes, is_short)
        VALUES (?, ?, ?, ?, ?, ?, 'none', COALESCE(?, datetime('now')), ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
          channel_id = excluded.channel_id,
          title = CASE WHEN excluded.title != '' THEN excluded.title ELSE videos.title END,
          description = CASE WHEN excluded.description != '' THEN excluded.description ELSE videos.description END,
          thumbnail = CASE WHEN excluded.thumbnail != '' THEN excluded.thumbnail ELSE videos.thumbnail END,
          published_at = COALESCE(excluded.published_at, videos.published_at),
          duration = COALESCE(excluded.duration, videos.duration),
          views = COALESCE(excluded.views, videos.views),
          likes = COALESCE(excluded.likes, videos.likes),
          is_short = COALESCE(excluded.is_short, videos.is_short)
      `).run(videoId, channelId, text(raw?.title, videoId), text(raw?.description), thumbnail, publishedAt, downloadedAt, duration, Number.isFinite(views) ? views : null, Number.isFinite(likes) ? likes : null, isShort);
      await database.prepare(`
        INSERT INTO tube_archivist_items (video_id, media_url, metadata_json, available, generation, downloaded_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
        ON CONFLICT(video_id) DO UPDATE SET media_url=excluded.media_url, metadata_json=excluded.metadata_json,
          available=1, generation=excluded.generation, downloaded_at=excluded.downloaded_at, updated_at=datetime('now')
      `).run(videoId, text(raw?.media_url) || null, JSON.stringify(raw), generation, downloadedAt);
      imported++;
    }
  })();
  return imported;
}

async function performSync(): Promise<TubeArchivistSyncResult> {
  if (!pluginEnabled(PLUGIN_ID)) throw new Error("TubeArchivist plugin is disabled");
  if (!tubeArchivistConfigured()) throw new Error("TubeArchivist is not configured");
  const controller = new AbortController();
  syncAbortController = controller;
  const previous = await database.prepare("SELECT generation FROM tube_archivist_sync_state WHERE singleton=1").get() as { generation: number } | null;
  const generation = Number(previous?.generation ?? 0) + 1;
  await database.prepare(`INSERT INTO tube_archivist_sync_state(singleton,generation,running,last_error) VALUES(1,?,1,NULL)
    ON CONFLICT(singleton) DO UPDATE SET running=1,last_error=NULL`).run(generation);
  let imported = 0;
  let pages = 0;
  const pageSignatures = new Set<string>();
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (!pluginEnabled(PLUGIN_ID)) throw new Error("TubeArchivist plugin was disabled");
      const response = await request("/api/video/", { signal: controller.signal }, new URLSearchParams({ page: String(page) }));
      if (!response.ok) throw new Error(`TubeArchivist catalog returned HTTP ${response.status}`);
      const body = await response.json();
      const items = rawVideos(body);
      if (items.length === 0) break;
      const signature = items.map((item) => text(item?.youtube_id ?? item?.video_id ?? item?.id)).join("|");
      if (pageSignatures.has(signature)) throw new Error("TubeArchivist pagination repeated a page");
      pageSignatures.add(signature);
      imported += await importPage(items, generation);
      pages++;
      if (!hasNextPage(body, items.length)) break;
    }
    await database.transaction(async () => {
      await database.prepare("UPDATE tube_archivist_items SET available=0 WHERE generation != ?").run(generation);
      await database.prepare("UPDATE tube_archivist_sync_state SET generation=?, running=0, last_synced_at=datetime('now'), last_error=NULL WHERE singleton=1").run(generation);
    })();
    return { imported, pages };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await database.prepare("UPDATE tube_archivist_sync_state SET running=0,last_error=? WHERE singleton=1").run(message.slice(0, 500));
    throw error;
  }
}

export function syncTubeArchivist(): Promise<TubeArchivistSyncResult> {
  if (syncPromise) return syncPromise;
  syncPromise = performSync().finally(() => { syncPromise = null; syncAbortController = null; scheduleTubeArchivistSync(); });
  return syncPromise;
}

export function scheduleTubeArchivistSync(immediate = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pluginEnabled(PLUGIN_ID) || !tubeArchivistConfigured()) return;
  const minutes = Math.max(15, Number(getSetting("plugin_tubearchivist_sync_interval_minutes")) || 60);
  timer = setTimeout(() => void syncTubeArchivist().catch((error) => log.warn("tubearchivist.sync_failed", { error: error instanceof Error ? error.message : String(error) })), immediate ? 0 : minutes * 60_000);
  scheduleWatchedFlush(immediate ? 0 : 60_000);
}

function scheduleWatchedFlush(delay = 60_000): void {
  if (watchedTimer) clearTimeout(watchedTimer);
  watchedTimer = null;
  if (!pluginEnabled(PLUGIN_ID) || !tubeArchivistConfigured()) return;
  watchedTimer = setTimeout(() => void flushTubeArchivistWatched(), delay);
}

export function stopTubeArchivistSync(): void {
  syncAbortController?.abort();
  if (timer) clearTimeout(timer);
  timer = null;
  if (watchedTimer) clearTimeout(watchedTimer);
  watchedTimer = null;
}

export async function tubeArchivistStatus(): Promise<TubeArchivistConfigStatus> {
  const state = await database.prepare("SELECT last_synced_at,last_error,running FROM tube_archivist_sync_state WHERE singleton=1").get() as any;
  const count = await database.prepare("SELECT COUNT(*) AS count FROM tube_archivist_items WHERE available=1").get() as { count: number };
  const baseUrl = configuredBaseUrl();
  return { baseUrl, tokenConfigured: Boolean(token()), configured: Boolean(baseUrl && token()), running: state?.running === 1 || Boolean(syncPromise), lastSyncedAt: state?.last_synced_at ?? null, lastError: state?.last_error ?? null, itemCount: Number(count?.count ?? 0) };
}

function storedItem(videoId: string): Promise<{ media_url: string | null; metadata_json: string } | null> {
  return database.prepare("SELECT media_url,metadata_json FROM tube_archivist_items WHERE video_id=? AND available=1").get(videoId) as any;
}

function storedResourceUrl(item: { media_url: string | null; metadata_json: string }, kind: "media" | "thumbnail"): URL | null {
  let candidate = kind === "media" ? item.media_url : "";
  if (kind === "thumbnail") {
    try { const raw = JSON.parse(item.metadata_json); candidate = text(raw?.vid_thumb_url ?? raw?.thumbnail ?? raw?.channel?.channel_thumb); } catch { return null; }
  }
  return safeStoredUrl(candidate);
}

function safeStoredUrl(candidate: unknown): URL | null {
  if (typeof candidate !== "string" || !candidate) return null;
  try {
    const resolved = new URL(candidate, `${configuredBaseUrl()}/`);
    return resolved.origin === new URL(configuredBaseUrl()).origin ? resolved : null;
  } catch { return null; }
}

function storedSubtitles(item: { metadata_json: string }): Array<{ lang: string; url: URL }> {
  try {
    const raw = JSON.parse(item.metadata_json);
    const entries = Array.isArray(raw?.subtitles) ? raw.subtitles : [];
    return entries.flatMap((entry: any) => {
      const lang = text(entry?.lang ?? entry?.language ?? entry?.name).trim();
      const url = safeStoredUrl(entry?.media_url ?? entry?.url ?? entry?.path);
      return lang && url ? [{ lang: lang.slice(0, 40), url }] : [];
    });
  } catch { return []; }
}

export async function tubeArchivistSubtitleList(videoId: string): Promise<Array<{ lang: string; url: string }> | null> {
  if (!pluginEnabled(PLUGIN_ID) || !tubeArchivistConfigured() || !VIDEO_ID.test(videoId)) return null;
  const item = await storedItem(videoId);
  if (!item) return null;
  return storedSubtitles(item).map(({ lang }) => ({ lang, url: `/api/videos/${encodeURIComponent(videoId)}/subtitles/${encodeURIComponent(lang)}` }));
}

export async function tubeArchivistSubtitleResponse(videoId: string, lang: string, signal?: AbortSignal): Promise<Response | null> {
  if (!pluginEnabled(PLUGIN_ID) || !tubeArchivistConfigured() || !VIDEO_ID.test(videoId)) return null;
  const item = await storedItem(videoId);
  if (!item) return null;
  const subtitle = storedSubtitles(item).find((entry) => entry.lang === lang);
  if (!subtitle) return null;
  const response = await request(subtitle.url.pathname + subtitle.url.search, { signal });
  if (!response.ok) return new Response(null, { status: 502 });
  const value = await response.text();
  const webvtt = /^WEBVTT\b/.test(value) ? value : `WEBVTT\n\n${value.replace(/(\d\d:\d\d:\d\d),(\d{3})/g, "$1.$2")}`;
  return new Response(webvtt, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, max-age=3600" } });
}

export async function tubeArchivistResource(videoId: string, kind: "media" | "thumbnail", range?: string, signal?: AbortSignal): Promise<Response | null> {
  if (!pluginEnabled(PLUGIN_ID) || !tubeArchivistConfigured() || !VIDEO_ID.test(videoId)) return null;
  const item = await storedItem(videoId);
  if (!item) return null;
  const url = storedResourceUrl(item, kind);
  if (!url) return null;
  const headers: Record<string, string> = {};
  if (range && /^bytes=(?:\d+-\d*|-\d+)$/.test(range)) headers.Range = range;
  else if (range) return new Response(null, { status: 416 });
  const response = await request(url.pathname + url.search, { headers, signal });
  if (!response.ok && response.status !== 206) return new Response(null, { status: response.status === 416 ? 416 : 502 });
  const contentType = response.headers.get("content-type") ?? "";
  if (kind === "media" && !/^(video\/(mp4|webm)|application\/octet-stream)(?:;|$)/i.test(contentType)) return new Response(null, { status: 502 });
  if (kind === "thumbnail" && !/^image\//i.test(contentType)) return new Response(null, { status: 502 });
  const safe = new Headers({ "Content-Type": contentType, "Cache-Control": kind === "thumbnail" ? "private, max-age=3600" : "no-store" });
  for (const name of ["content-length", "content-range", "accept-ranges"]) { const value = response.headers.get(name); if (value) safe.set(name, value); }
  return new Response(kind === "thumbnail" ? await response.arrayBuffer() : response.body, { status: response.status, headers: safe });
}

export async function tubeArchivistComments(videoId: string): Promise<VideoCommentsResult | null> {
  if (!pluginEnabled(PLUGIN_ID) || !tubeArchivistConfigured() || !await storedItem(videoId)) return null;
  const response = await request(`/api/video/${encodeURIComponent(videoId)}/comment/`);
  if (!response.ok) throw new Error(`TubeArchivist comments returned HTTP ${response.status}`);
  const body = await response.json();
  const raw = Array.isArray(body) ? body : body?.data ?? body?.comments ?? [];
  const compatible = Array.isArray(raw) ? raw.map((comment: any) => ({
    id: comment?.id ?? comment?.comment_id,
    parent: comment?.parent ?? comment?.comment_parent,
    text: comment?.text ?? comment?.comment_text,
    author: comment?.author ?? comment?.comment_author,
    author_id: comment?.author_id ?? comment?.comment_author_id,
    author_url: comment?.author_url,
    author_thumbnail: comment?.author_thumbnail ?? comment?.comment_author_thumbnail,
    timestamp: comment?.timestamp ?? comment?.comment_timestamp,
    time_text: comment?.time_text,
    like_count: comment?.like_count ?? comment?.comment_likecount,
    is_pinned: comment?.is_pinned,
    is_favorited: comment?.is_favorited,
    author_is_uploader: comment?.author_is_uploader,
  })) : [];
  return { comments: normalizeVideoComments(compatible), fetchedAt: new Date().toISOString(), cached: true };
}

export async function enqueueTubeArchivistWatched(videoId: string): Promise<void> {
  if (!pluginEnabled(PLUGIN_ID) || getSetting("plugin_tubearchivist_sync_watched") === "0") return;
  if (!await storedItem(videoId)) return;
  await database.prepare("INSERT INTO tube_archivist_watch_outbox(video_id) VALUES(?) ON CONFLICT(video_id) DO NOTHING").run(videoId);
  // The local completion transaction must commit independently from the remote
  // service. A later task drains this durable row with retry/backoff.
  scheduleWatchedFlush(0);
}

export async function flushTubeArchivistWatched(): Promise<void> {
  if (!pluginEnabled(PLUGIN_ID) || !tubeArchivistConfigured()) return;
  const rows = await database.prepare("SELECT video_id,attempts FROM tube_archivist_watch_outbox WHERE next_attempt_at <= datetime('now') ORDER BY created_at LIMIT 25").all() as any[];
  for (const row of rows) {
    try {
      const response = await request("/api/watched/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.video_id, is_watched: true }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await database.prepare("DELETE FROM tube_archivist_watch_outbox WHERE video_id=?").run(row.video_id);
    } catch (error) {
      const attempts = Number(row.attempts) + 1;
      const delayMinutes = Math.min(360, 2 ** Math.min(attempts, 8));
      await database.prepare("UPDATE tube_archivist_watch_outbox SET attempts=?,next_attempt_at=datetime('now', ?),last_error=? WHERE video_id=?")
        .run(attempts, `+${delayMinutes} minutes`, error instanceof Error ? error.message.slice(0, 300) : "failed", row.video_id);
    }
  }
  scheduleWatchedFlush();
}
