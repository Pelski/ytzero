import { inflateRawSync } from "node:zlib";
import { decodeHtmlEntities } from "./htmlEntities";

// Placeholder channel every imported video is parked on until the background
// enrichment fetches its real metadata (title/channel/thumbnail). Kept external
// so imported videos never leak into any profile's feed.
export const IMPORTED_CHANNEL_ID = "YTZERO_IMPORTED";

export interface TakeoutPlaylist {
  name: string;
  videoIds: string[];
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Playlist name from a Takeout CSV filename ("Favorites-videos.csv" -> "Favorites"). */
function playlistNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.csv$/i, "").replace(/-videos$/i, "").trim() || "Imported playlist";
}

/**
 * Parse a single Google Takeout playlist CSV. The file lists one video id per
 * row (column "Video Id"); the playlist name comes from the filename. Returns an
 * empty video list for files that are not per-playlist exports (e.g. the
 * `subscriptions.csv` or the `playlists.csv` index), so callers can skip them.
 */
export function parseTakeoutPlaylistCsv(filename: string, content: string): TakeoutPlaylist {
  const lines = content.split(/\r?\n/);
  // A subscriptions export lists channels, not videos — never a playlist.
  if (lines.some((l) => /channel\s*id/i.test(l))) return { name: playlistNameFromFilename(filename), videoIds: [] };

  let started = false;
  const seen = new Set<string>();
  const videoIds: string[] = [];
  for (const line of lines) {
    const first = line.split(",")[0]?.trim() ?? "";
    if (/video\s*id/i.test(line)) {
      started = true; // header row: video rows follow
      continue;
    }
    if (!first) continue;
    if (!VIDEO_ID.test(first)) {
      // Before the header, non-id lines are metadata; ignore them. Once video
      // rows have started, a stray non-id line just gets skipped.
      continue;
    }
    if (!started) started = true; // headerless export: first id row starts data
    if (!seen.has(first)) {
      seen.add(first);
      videoIds.push(first);
    }
  }
  return { name: playlistNameFromFilename(filename), videoIds };
}

/** True for entries that look like a per-playlist Takeout CSV (not the index / subscriptions). */
export function isPlaylistCsvName(name: string): boolean {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  if (!base.endsWith(".csv")) return false;
  if (base === "playlists.csv" || base === "subscriptions.csv") return false;
  return true;
}

// ---------- Watch history ----------

export interface TakeoutHistoryEntry {
  videoId: string;
  /** SQLite datetime ("YYYY-MM-DD HH:MM:SS", UTC) or null when the export's date couldn't be parsed. */
  watchedAt: string | null;
  title: string;
  channelId: string;
  channelTitle: string;
}

export interface TakeoutChannel {
  channelId: string;
  title: string;
}

/** Everything recognized inside a Takeout upload. */
export interface TakeoutBundle {
  channels: TakeoutChannel[];
  playlists: TakeoutPlaylist[];
  history: TakeoutHistoryEntry[];
}

const CHANNEL_ID = /UC[\w-]{22}/;

function toSqliteUtc(value: string | number): string | null {
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

// Takeout localizes the "Watched " prefix on history titles; strip the common
// ones and fall back to the raw string (a prefixed title beats an empty one).
const WATCHED_PREFIX = /^(watched|obejrzano|angesehen|vu|visto|regardé|assistiu(?: a)?|bekeken|megtekintve|shledněno|zhlédnuto)[:\s]\s*/i;

function stripWatchedPrefix(title: string): string {
  return title.replace(WATCHED_PREFIX, "").trim();
}

function videoIdFromUrl(url: string): string | null {
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ?? url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/**
 * Parse a Takeout watch-history.json. Ads and deleted videos (no watch URL)
 * are skipped. Unparseable timestamps yield watchedAt = null rather than
 * dropping the entry.
 */
export function parseWatchHistoryJson(content: string): TakeoutHistoryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const entries: TakeoutHistoryEntry[] = [];
  for (const item of data as any[]) {
    const videoId = typeof item?.titleUrl === "string" ? videoIdFromUrl(item.titleUrl) : null;
    if (!videoId) continue;
    if (Array.isArray(item?.details) && item.details.some((d: any) => /ads/i.test(d?.name ?? ""))) continue;
    const channelUrl: string = item?.subtitles?.[0]?.url ?? "";
    entries.push({
      videoId,
      watchedAt: typeof item?.time === "string" ? toSqliteUtc(item.time) : null,
      title: stripWatchedPrefix(decodeHtmlEntities(String(item?.title ?? ""))),
      channelId: channelUrl.match(CHANNEL_ID)?.[0] ?? "",
      channelTitle: decodeHtmlEntities(String(item?.subtitles?.[0]?.name ?? "")),
    });
  }
  return entries;
}

/**
 * Parse a Takeout watch-history.html (the default export format). Each entry
 * lives in an "outer-cell" block: watch link + optional channel link + a
 * localized timestamp as the trailing text. Timestamps that Date.parse can't
 * handle (non-English locales) become watchedAt = null.
 */
export function parseWatchHistoryHtml(content: string): TakeoutHistoryEntry[] {
  const entries: TakeoutHistoryEntry[] = [];
  const blocks = content.split(/class="outer-cell/).slice(1);
  for (const block of blocks) {
    const watch = block.match(/<a href="[^"]*[?&]v=([A-Za-z0-9_-]{11})[^"]*"\s*>([^<]*)<\/a>/);
    if (!watch) continue;
    const channel = block.match(/<a href="[^"]*\/channel\/(UC[\w-]{22})[^"]*"\s*>([^<]*)<\/a>/);
    // The timestamp is the last text line of the content cell, after a <br>.
    const when = block.match(/<br\s*\/?>([^<>]+?)\s*<\/div>/);
    const rawDate = when ? when[1].trim().replace(/\s+[A-Z]{2,5}$/, "") : "";
    entries.push({
      videoId: watch[1],
      watchedAt: rawDate ? toSqliteUtc(rawDate) : null,
      title: stripWatchedPrefix(decodeHtmlEntities(watch[2].trim())),
      channelId: channel?.[1] ?? "",
      channelTitle: channel ? decodeHtmlEntities(channel[2].trim()) : "",
    });
  }
  return entries;
}

// ---------- Bundle assembly ----------

/** Content-based CSV classification: Takeout localizes filenames, so names alone can't be trusted. */
export function classifyCsv(content: string): "subscriptions" | "playlist" | "other" {
  const lines = content.split(/\r?\n/, 50);
  for (const line of lines) {
    const first = line.split(",")[0]?.trim() ?? "";
    if (CHANNEL_ID.test(first) && first.length === 24) return "subscriptions";
    if (VIDEO_ID.test(first)) return "playlist";
  }
  return "other";
}

/** Parse a Takeout subscriptions CSV (Channel Id, Channel Url, Channel Title). */
export function parseSubscriptionsCsv(content: string): TakeoutChannel[] {
  const channels: TakeoutChannel[] = [];
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(CHANNEL_ID);
    if (!m || seen.has(m[0])) continue;
    seen.add(m[0]);
    const cols = line.split(",");
    channels.push({
      channelId: m[0],
      title: decodeHtmlEntities(cols.length >= 3 ? cols.slice(2).join(",").trim() : ""),
    });
  }
  return channels;
}

/** True for files worth extracting from a Takeout zip (classified further by content). */
export function isRelevantEntryName(name: string): boolean {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  return base.endsWith(".csv") || base.endsWith(".json") || base.endsWith(".html");
}

/**
 * Sort a set of loose files / zip entries into channels, playlists and watch
 * history. Files that don't look like any known Takeout export are ignored, so
 * the whole archive can be thrown at this safely.
 */
export function parseTakeoutFiles(files: { name: string; content: string }[]): TakeoutBundle {
  const bundle: TakeoutBundle = { channels: [], playlists: [], history: [] };
  const seenChannels = new Set<string>();
  const seenHistory = new Set<string>();
  for (const file of files) {
    const base = (file.name.split(/[\\/]/).pop() ?? file.name).toLowerCase();
    if (base.endsWith(".csv")) {
      const kind = classifyCsv(file.content);
      if (kind === "subscriptions") {
        for (const ch of parseSubscriptionsCsv(file.content)) {
          if (!seenChannels.has(ch.channelId)) {
            seenChannels.add(ch.channelId);
            bundle.channels.push(ch);
          }
        }
      } else if (kind === "playlist") {
        const playlist = parseTakeoutPlaylistCsv(file.name, file.content);
        if (playlist.videoIds.length > 0) bundle.playlists.push(playlist);
      }
    } else if (base.endsWith(".json") || base.endsWith(".html")) {
      const entries = base.endsWith(".json")
        ? parseWatchHistoryJson(file.content)
        : parseWatchHistoryHtml(file.content);
      for (const entry of entries) {
        // The same watch event can appear in both a .json and an .html upload.
        const key = `${entry.videoId}@${entry.watchedAt ?? "?"}`;
        if (seenHistory.has(key)) continue;
        seenHistory.add(key);
        bundle.history.push(entry);
      }
    }
  }
  bundle.history.sort((a, b) => (b.watchedAt ?? "").localeCompare(a.watchedAt ?? ""));
  return bundle;
}

// ---------- Minimal ZIP reader (Takeout archives) ----------
// Only what a Google Takeout needs: stored (0) and deflate (8) entries, no
// ZIP64. Anything unexpected throws so the caller can fall back to loose files.

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
}

/** Extract only the entries whose name passes `wanted` from a ZIP archive. */
export function unzipEntries(buffer: Uint8Array, wanted: (name: string) => boolean): ZipEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error("not a valid ZIP archive");

  const entryCount = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // central directory offset
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break; // central dir header
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(buffer.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (!name.endsWith("/") && wanted(name)) {
      if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported");
      entries.push({ name, bytes: readLocalEntry(buffer, view, localOffset, method, compressedSize) });
    }
  }
  return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
  // EOCD is at the end, before an optional comment (max 65535 bytes).
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

function readLocalEntry(buffer: Uint8Array, view: DataView, offset: number, method: number, compressedSize: number): Uint8Array {
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("corrupt ZIP: bad local header");
  const nameLen = view.getUint16(offset + 26, true);
  const extraLen = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLen + extraLen;
  const data = buffer.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`unsupported ZIP compression method ${method}`);
}
