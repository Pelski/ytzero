import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { database } from "./database";
import { isAllowedRemoteImageUrl, isValidImagePayload, videoIdFromThumbnailUrl } from "./imageCachePolicy";
import { imageCacheTableSql, POSTGRES_IMAGE_CACHE_TIMESTAMP_MIGRATION } from "./imageCacheSchema";

const IMG_DIR = process.env.IMG_CACHE_DIR ?? resolve(import.meta.dir, "../../data/imgcache");
mkdirSync(IMG_DIR, { recursive: true });

// How long a cached image is considered fresh. After this we *try* to refetch,
// but a failed refetch (e.g. 429) keeps serving the old file — it is never
// deleted just because YouTube rate-limited us.
const configuredTtlDays = Number(process.env.IMG_CACHE_TTL_DAYS ?? 7);
const TTL_MS = (Number.isFinite(configuredTtlDays) && configuredTtlDays > 0 ? configuredTtlDays : 7) * 86_400_000;
// After a failed refetch, wait this long before trying again so we don't hammer
// a rate-limited origin on every request.
const RETRY_AFTER_MS = 30 * 60_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MIN_IMAGE_BYTES = 32;

await database.exec(imageCacheTableSql(database.engine));
if (database.engine === "postgres") {
  await database.exec(POSTGRES_IMAGE_CACHE_TIMESTAMP_MIGRATION);
} else {
  try { await database.exec("ALTER TABLE image_cache ADD COLUMN last_error_at INTEGER NOT NULL DEFAULT 0"); } catch {}
}

interface Row {
  url: string;
  path: string;
  content_type: string;
  fetched_at: number;
  last_try_at: number;
  last_error_at: number;
}

const getRow = database.prepare("SELECT * FROM image_cache WHERE url = ?");
const getOldVideo = database.prepare(`
  SELECT 1 FROM videos
  WHERE video_id = ?
    AND COALESCE(NULLIF(published_at, ''), created_at) <= datetime('now', '-1 month')
  LIMIT 1
`);
const upsert = database.prepare(`
  INSERT INTO image_cache (url, path, content_type, fetched_at, last_try_at, last_error_at)
  VALUES (?, ?, ?, ?, ?, 0)
  ON CONFLICT(url) DO UPDATE SET
    path = excluded.path,
    content_type = excluded.content_type,
    fetched_at = excluded.fetched_at,
    last_try_at = excluded.last_try_at,
    last_error_at = 0
`);
const recordFailure = database.prepare(`
  INSERT INTO image_cache (url, path, content_type, fetched_at, last_try_at, last_error_at)
  VALUES (?, ?, 'image/jpeg', 0, ?, ?)
  ON CONFLICT(url) DO UPDATE SET last_try_at = excluded.last_try_at, last_error_at = excluded.last_error_at
`);

function pathFor(url: string): string {
  return `${IMG_DIR}/${createHash("sha1").update(url).digest("hex")}`;
}

// Dedupe concurrent fetches of the same URL (feeds request many at once).
const inflight = new Map<string, Promise<Row | null>>();

function usableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).size >= MIN_IMAGE_BYTES;
  } catch {
    return false;
  }
}

async function failed(url: string, path: string, now: number) {
  await recordFailure.run(url, path, now, now);
}

async function isOldVideoThumbnail(url: string): Promise<boolean> {
  const videoId = videoIdFromThumbnailUrl(url);
  return Boolean(videoId && await getOldVideo.get(videoId));
}

async function download(url: string): Promise<Row | null> {
  const path = pathFor(url);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const now = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Referer: "https://www.youtube.com/",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      await failed(url, path, now);
      return null;
    }
    const declaredSize = Number(res.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_IMAGE_BYTES) {
      await failed(url, path, now);
      return null;
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES || !isValidImagePayload(contentType, bytes)) {
      await failed(url, path, now);
      return null;
    }
    await Bun.write(temporaryPath, bytes);
    renameSync(temporaryPath, path);
    await upsert.run(url, path, contentType, now, now);
    return { url, path, content_type: contentType, fetched_at: now, last_try_at: now, last_error_at: 0 };
  } catch {
    try { unlinkSync(temporaryPath); } catch {}
    await failed(url, path, now);
    return null;
  }
}

function refresh(url: string): Promise<Row | null> {
  const current = inflight.get(url);
  if (current) return current;
  const task = download(url).finally(() => inflight.delete(url));
  inflight.set(url, task);
  return task;
}

export interface CachedImage {
  path: string;
  contentType: string;
}

/**
 * Return a locally cached copy of a YouTube image. Downloads on first hit,
 * refreshes lazily once stale, and—crucially—keeps serving the previous file
 * if a refresh fails (HTTP 429 / network error) instead of dropping it.
 * Returns null only when there is nothing cached and the fetch failed.
 */
export async function getCachedImage(url: string): Promise<CachedImage | null> {
  if (!isAllowedRemoteImageUrl(url)) return null;
  const row = await getRow.get<Row>(url);
  const haveFile = Boolean(row && usableFile(row.path));
  const now = Date.now();

  if (haveFile && now - row!.fetched_at < TTL_MS) {
    return { path: row!.path, contentType: row!.content_type };
  }

  // Video artwork becomes immutable after a month. Keep the last verified
  // local copy indefinitely instead of spending requests refreshing old feed
  // items. Missing files are still downloaded below on their first use.
  if (haveFile && await isOldVideoThumbnail(url)) {
    return { path: row!.path, contentType: row!.content_type };
  }

  // Stale or missing. Avoid stampeding a rate-limited origin: if we recently
  // failed and still have an old file, serve it without retrying yet.
  if (haveFile && now - row!.last_error_at < RETRY_AFTER_MS) {
    return { path: row!.path, contentType: row!.content_type };
  }

  // Stale-while-revalidate: never make the UI wait when a usable copy exists.
  // The atomic download keeps this file in place until a verified replacement
  // is completely written.
  if (haveFile) {
    void refresh(url);
    return { path: row!.path, contentType: row!.content_type };
  }

  if (row && now - row.last_error_at < RETRY_AFTER_MS) return null;

  const fresh = await refresh(url);
  if (fresh) return { path: fresh.path, contentType: fresh.content_type };
  return null;
}
