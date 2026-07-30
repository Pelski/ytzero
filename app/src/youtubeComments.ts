import { downloadCookiesConfigured, ytdlpCommand } from "./downloader";
import { downloadCookieAttempts } from "./downloadStrategy";
import { log } from "./logger";

const COMMENTS_TTL_MS = 5 * 60_000;
const COMMENTS_TIMEOUT_MS = 60_000;
const MAX_COMMENTS = 1_000;
const MAX_TEXT_LENGTH = 20_000;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
export const YOUTUBE_COMMENTS_EXTRACTOR_ARGS = "youtube:comment_sort=top;max_comments=1000,all,all,all,all";

export interface VideoComment {
  id: string;
  parent: string | null;
  text: string;
  author: string;
  authorId: string | null;
  authorUrl: string | null;
  authorThumbnail: string | null;
  timestamp: number | null;
  timeText: string | null;
  likeCount: number;
  isPinned: boolean;
  isFavorited: boolean;
  authorIsUploader: boolean;
}

interface RawComment {
  id?: unknown;
  parent?: unknown;
  text?: unknown;
  author?: unknown;
  author_id?: unknown;
  author_url?: unknown;
  author_thumbnail?: unknown;
  timestamp?: unknown;
  time_text?: unknown;
  like_count?: unknown;
  is_pinned?: unknown;
  is_favorited?: unknown;
  author_is_uploader?: unknown;
}

export interface VideoCommentsResult {
  comments: VideoComment[];
  fetchedAt: string;
  cached: boolean;
}

export type VideoCommentsErrorCode = "comments_disabled" | "ytdlp_missing" | "rate_limited" | "login_required" | "timeout" | "unavailable";

export class VideoCommentsError extends Error {
  constructor(public readonly code: VideoCommentsErrorCode, public readonly detail: string) {
    super(code);
    this.name = "VideoCommentsError";
  }
}

function safeErrorDetail(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || "Unknown yt-dlp error");
  return raw
    .replace(/\/(?:Users|home)\/[^\s'"\]]+/g, "<local-path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_500) || "Unknown yt-dlp error";
}

export function classifyVideoCommentsError(value: unknown, timedOut = false): VideoCommentsError {
  const detail = safeErrorDetail(value);
  const normalized = detail.toLocaleLowerCase();
  if (timedOut) return new VideoCommentsError("timeout", detail);
  if (/comments? (?:are |have been )?(?:turned off|disabled)|commenting (?:is|has been) (?:turned off|disabled)/i.test(detail)) {
    return new VideoCommentsError("comments_disabled", detail);
  }
  if (/executable not found|enoent|failed to spawn|no such file or directory/.test(normalized) && normalized.includes("yt-dlp")) {
    return new VideoCommentsError("ytdlp_missing", detail);
  }
  if (/http error 429|too many requests|rate.?limit|confirm you(?:'|’)re not a bot/.test(normalized)) {
    return new VideoCommentsError("rate_limited", detail);
  }
  if (/sign in|log in|login required|private video|members[- ]only|age.restricted/.test(normalized)) {
    return new VideoCommentsError("login_required", detail);
  }
  return new VideoCommentsError("unavailable", detail);
}

function optionalString(value: unknown, maxLength = 2_000): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function optionalHttpUrl(value: unknown): string | null {
  const candidate = optionalString(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeVideoComments(value: unknown): VideoComment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_COMMENTS).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as RawComment;
    const text = optionalString(raw.text, MAX_TEXT_LENGTH);
    if (!text) return [];
    const timestamp = Number(raw.timestamp);
    const likes = Number(raw.like_count);
    return [{
      id: optionalString(raw.id, 300) ?? `comment-${index}`,
      parent: optionalString(raw.parent, 300),
      text,
      author: optionalString(raw.author, 300) ?? "YouTube",
      authorId: optionalString(raw.author_id, 300),
      authorUrl: optionalHttpUrl(raw.author_url),
      authorThumbnail: optionalHttpUrl(raw.author_thumbnail),
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : null,
      timeText: optionalString(raw.time_text, 200),
      likeCount: Number.isFinite(likes) && likes > 0 ? Math.floor(likes) : 0,
      isPinned: raw.is_pinned === true,
      isFavorited: raw.is_favorited === true,
      authorIsUploader: raw.author_is_uploader === true,
    }];
  });
}

async function runYtdlp(userId: number, videoId: string, useCookies: boolean): Promise<VideoComment[]> {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--skip-download",
    "--write-comments",
    // Keep the payload bounded while allowing yt-dlp to follow reply chains at
    // every depth: total, parents, replies, replies/thread, depth.
    "--extractor-args", YOUTUBE_COMMENTS_EXTRACTOR_ARGS,
    "--print", "%(comments)j",
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(ytdlpCommand(userId, args, useCookies), { stdout: "pipe", stderr: "pipe" });
  } catch (error) {
    throw classifyVideoCommentsError(error);
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { proc.kill(); } catch {} }, COMMENTS_TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      const detail = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? `yt-dlp exited with code ${code}`;
      throw classifyVideoCommentsError(detail, timedOut);
    }
    const serialized = stdout.trim();
    if (!serialized || serialized === "NA" || serialized === "null") {
      if (/comments? (?:are |have been )?(?:turned off|disabled)|commenting (?:is|has been) (?:turned off|disabled)/i.test(stderr)) {
        throw classifyVideoCommentsError(stderr);
      }
      return [];
    }
    try {
      return normalizeVideoComments(JSON.parse(serialized));
    } catch {
      throw new VideoCommentsError("unavailable", "yt-dlp returned an invalid comments response");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function extractVideoComments(userId: number, videoId: string): Promise<VideoComment[]> {
  let lastError: unknown;
  for (const useCookies of downloadCookieAttempts(downloadCookiesConfigured(userId))) {
    try {
      return await runYtdlp(userId, videoId, useCookies);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof VideoCommentsError ? lastError : classifyVideoCommentsError(lastError);
}

interface CacheEntry {
  expiresAt: number;
  fetchedAt: string;
  comments: VideoComment[];
}

export function validYouTubeVideoId(videoId: string): boolean {
  return YOUTUBE_VIDEO_ID.test(videoId);
}

export function createVideoCommentsFetcher(
  extract: (videoId: string) => Promise<VideoComment[]>,
  now: () => number = Date.now,
) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<CacheEntry>>();

  return async (videoId: string, force = false): Promise<VideoCommentsResult> => {
    if (!validYouTubeVideoId(videoId)) throw new Error("invalid video id");
    const cached = cache.get(videoId);
    if (!force && cached && cached.expiresAt > now()) {
      return { comments: cached.comments, fetchedAt: cached.fetchedAt, cached: true };
    }

    const existing = inFlight.get(videoId);
    if (existing) {
      const entry = await existing;
      return { comments: entry.comments, fetchedAt: entry.fetchedAt, cached: false };
    }

    const request = extract(videoId).then((comments) => {
      const completedAt = now();
      const entry = { comments, fetchedAt: new Date(completedAt).toISOString(), expiresAt: completedAt + COMMENTS_TTL_MS };
      cache.set(videoId, entry);
      return entry;
    });
    inFlight.set(videoId, request);
    try {
      const entry = await request;
      return { comments: entry.comments, fetchedAt: entry.fetchedAt, cached: false };
    } finally {
      if (inFlight.get(videoId) === request) inFlight.delete(videoId);
    }
  };
}

const profileCommentFetchers = new Map<number, ReturnType<typeof createVideoCommentsFetcher>>();

export async function fetchVideoComments(userId: number, videoId: string, force = false): Promise<VideoCommentsResult> {
  try {
    let fetcher = profileCommentFetchers.get(userId);
    if (!fetcher) {
      fetcher = createVideoCommentsFetcher((id) => extractVideoComments(userId, id));
      profileCommentFetchers.set(userId, fetcher);
    }
    return await fetcher(videoId, force);
  } catch (error) {
    log.warn("youtube.comments_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
