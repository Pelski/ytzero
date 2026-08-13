import { createHash } from "node:crypto";
import { database } from "./database";
import { downloadCookieAttempts } from "./downloadStrategy";
import { fetchGoogleVideoResponse, safeGoogleVideoUrl } from "./audioUpstreamUrl";
import { log } from "./logger";
import { parseMediaSidx, type MediaSidxIndex } from "./mediaSidx";
import {
  createVideoVodPresentation,
  DIRECT_VIDEO_HLS_MAX_RANGE_BYTES,
  type VideoVodPresentation,
} from "./videoVodPlaylist";
import type { DlSettings } from "./downloader";

interface DownloadVideoDirectStreamingDependencies {
  YTDLP: string;
  dlSettings: (userId?: number) => Promise<Pick<DlSettings, "quality">>;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  prioritizeDownload: (userId: number, videoId: string) => Promise<boolean>;
  ytdlpStatus: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
  videoAvailable?: (videoId: string) => Promise<boolean>;
  now?: () => number;
  resolveTimeoutMs?: number;
  rangeTimeoutMs?: number;
}

interface YtdlpFormat {
  format_id?: unknown;
  url?: unknown;
  ext?: unknown;
  protocol?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  tbr?: unknown;
  vbr?: unknown;
  abr?: unknown;
  filesize?: unknown;
  filesize_approx?: unknown;
  audio_channels?: unknown;
}

interface YtdlpSelection {
  duration?: unknown;
  requested_formats?: unknown;
  requested_downloads?: unknown;
}

export interface DirectVideoMediaSource {
  formatId: string;
  url: string;
  expiresAt: number;
  codec: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate: number | null;
  channels: number | null;
}

interface DirectVideoSources {
  video: DirectVideoMediaSource;
  audio: DirectVideoMediaSource;
  durationSeconds: number;
  expiresAt: number;
}

type SourceResolutionResult =
  | { kind: "sources"; sources: DirectVideoSources }
  | { kind: "unsupported" }
  | { kind: "failed" };

interface IndexedSource {
  fingerprint: string;
  index: MediaSidxIndex;
  source: DirectVideoMediaSource;
}

interface DirectVideoSession {
  userId: number;
  videoId: string;
  sources: DirectVideoSources;
  video: IndexedSource;
  audio: IndexedSource;
  presentation: VideoVodPresentation;
  generation: string;
  refresh: SharedOperation<DirectVideoSession | null> | null;
  lastAccess: number;
}

interface SharedOperation<T> {
  controller: AbortController;
  promise: Promise<T>;
  settled: boolean;
  waiters: number;
}

type CachedResolution = { expiresAt: number; sources: DirectVideoSources };

export type DirectVideoPlaylistResult =
  | { kind: "playlist"; playlist: string }
  | { kind: "unsupported" }
  | { kind: "stale" }
  | { kind: "failed" };

export type DirectVideoResourceResult =
  | { kind: "response"; response: Response }
  | { kind: "not_found" }
  | { kind: "stale" }
  | { kind: "failed" };

type SessionBuildResult =
  | { kind: "ready"; session: DirectVideoSession }
  | { kind: "unsupported"; expiresAt: number }
  | { kind: "failed" };

const INITIAL_INDEX_BYTES = 64 * 1024;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const DEFAULT_RESOLVE_TIMEOUT_MS = 30_000;
const DEFAULT_RANGE_TIMEOUT_MS = 45_000;
const SOURCE_EXPIRY_MARGIN_MS = 5 * 60_000;
const DIRECT_SESSION_IDLE_MS = 30 * 60_000;
const MAX_DIRECT_SESSIONS = 128;
const TRANSIENT_UNSUPPORTED_CACHE_MS = 10 * 60_000;
const MAX_BUFFERED_RANGE_REQUESTS_PER_PROFILE = 4;

function keyFor(userId: number, videoId: string): string {
  return `${userId}:${videoId}`;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function signedUrlExpiry(url: string, now: number): number {
  try {
    const seconds = Number(new URL(url).searchParams.get("expire"));
    if (Number.isFinite(seconds) && seconds > 0) return Math.max(now, seconds * 1000 - SOURCE_EXPIRY_MARGIN_MS);
  } catch {}
  return now + 3 * 60 * 60_000;
}

function selectedSource(format: YtdlpFormat, kind: "audio" | "video", now: number): DirectVideoMediaSource | null {
  const formatId = typeof format.format_id === "string" ? format.format_id : "";
  const url = typeof format.url === "string" ? safeGoogleVideoUrl(format.url) : null;
  const extension = typeof format.ext === "string" ? format.ext : "";
  const protocol = typeof format.protocol === "string" ? format.protocol : "";
  const videoCodec = typeof format.vcodec === "string" ? format.vcodec : "";
  const audioCodec = typeof format.acodec === "string" ? format.acodec : "";
  if (!formatId || !url || !/^https?$/.test(protocol)) return null;
  if (kind === "video") {
    if (extension !== "mp4" || !videoCodec.startsWith("avc1") || (audioCodec && audioCodec !== "none")) return null;
  } else if ((extension !== "m4a" && extension !== "mp4")
    || !audioCodec.startsWith("mp4a") || (videoCodec && videoCodec !== "none")) return null;
  const bitrate = numberOrNull(kind === "video" ? (format.vbr ?? format.tbr) : (format.abr ?? format.tbr));
  const result = {
    formatId,
    url,
    expiresAt: signedUrlExpiry(url, now),
    codec: kind === "video" ? videoCodec : audioCodec,
    width: numberOrNull(format.width),
    height: numberOrNull(format.height),
    fps: numberOrNull(format.fps),
    bitrate: bitrate == null ? null : bitrate * 1000,
    channels: numberOrNull(format.audio_channels),
  };
  if (kind === "video" && (result.width == null || result.width <= 0 || result.height == null || result.height <= 0
    || result.fps == null || result.fps <= 0 || result.bitrate == null || result.bitrate <= 0)) return null;
  if (kind === "audio" && (result.bitrate == null || result.bitrate <= 0)) return null;
  return result;
}

function parseSelection(stdout: string, now: number): DirectVideoSources | null {
  const line = stdout.trim();
  if (!line) return null;
  let selection: YtdlpSelection;
  try {
    selection = JSON.parse(line) as YtdlpSelection;
  } catch {
    return null;
  }
  const requestedFormats = Array.isArray(selection.requested_formats)
    ? selection.requested_formats as YtdlpFormat[]
    : [];
  const requestedDownloads = Array.isArray(selection.requested_downloads)
    ? selection.requested_downloads as Array<YtdlpFormat & { requested_formats?: unknown }>
    : [];
  const nestedFormats = requestedDownloads.flatMap((download) => (
    Array.isArray(download.requested_formats) ? download.requested_formats as YtdlpFormat[] : [download]
  ));
  const formats = requestedFormats.length ? requestedFormats : nestedFormats;
  const videoFormat = formats.find((format) => typeof format.vcodec === "string" && format.vcodec !== "none");
  const audioFormat = formats.find((format) => typeof format.acodec === "string" && format.acodec !== "none"
    && (typeof format.vcodec !== "string" || format.vcodec === "none"));
  if (!videoFormat || !audioFormat) return null;
  const video = selectedSource(videoFormat, "video", now);
  const audio = selectedSource(audioFormat, "audio", now);
  const durationSeconds = numberOrNull(selection.duration);
  if (!video || !audio || durationSeconds == null || durationSeconds <= 0) return null;
  return { video, audio, durationSeconds, expiresAt: Math.min(video.expiresAt, audio.expiresAt) };
}

function redactDiagnostic(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "<redacted-url>").slice(0, 400);
}

function requestSignal(parent: AbortSignal | undefined, timeoutMs: number, timeoutMessage: string) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function waitFor<T>(operation: SharedOperation<T>, signal: AbortSignal | undefined, abortedValue: T, onEmpty: () => void): Promise<T> {
  if (signal?.aborted) return Promise.resolve(abortedValue);
  operation.waiters += 1;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value: T) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      operation.waiters = Math.max(0, operation.waiters - 1);
      if (operation.waiters === 0 && !operation.settled) onEmpty();
      resolve(signal?.aborted ? abortedValue : value);
    };
    const onAbort = () => finish(abortedValue);
    signal?.addEventListener("abort", onAbort, { once: true });
    operation.promise.then(finish, () => finish(abortedValue));
  });
}

export function createDownloadVideoDirectStreaming(dependencies: DownloadVideoDirectStreamingDependencies) {
  const {
    YTDLP,
    dlSettings,
    downloadCookiesConfigured,
    downloadCookiesFile,
    prioritizeDownload,
    ytdlpStatus,
    fetchImpl = fetch,
    spawn = Bun.spawn,
    videoAvailable = async (videoId) => Boolean(await database.prepare(
      "SELECT 1 FROM videos WHERE video_id = ? AND is_private = 0 AND is_unavailable = 0",
    ).get(videoId)),
    now = Date.now,
    resolveTimeoutMs = DEFAULT_RESOLVE_TIMEOUT_MS,
    rangeTimeoutMs = DEFAULT_RANGE_TIMEOUT_MS,
  } = dependencies;
  const sourceCache = new Map<string, CachedResolution>();
  const sourceResolutions = new Map<string, SharedOperation<SourceResolutionResult>>();
  const sessions = new Map<string, DirectVideoSession>();
  const sessionBuilds = new Map<string, SharedOperation<SessionBuildResult>>();
  const unsupported = new Map<string, number>();
  const bufferedRangeRequests = new Map<number, number>();

  async function formatSelector(userId: number): Promise<string> {
    const setting = await dlSettings(userId);
    const parsedHeight = setting.quality === "best" ? null : Number(setting.quality);
    const cap = Number.isFinite(parsedHeight) && Number(parsedHeight) > 0
      ? `[height<=${Math.floor(Number(parsedHeight))}]`
      : "";
    return `bestvideo[ext=mp4][vcodec^=avc1][protocol^=http]${cap}+bestaudio[ext=m4a][acodec^=mp4a][protocol^=http]`;
  }

  async function resolveAttempt(
    userId: number,
    videoId: string,
    useCookies: boolean,
    signal: AbortSignal,
  ): Promise<SourceResolutionResult> {
    if (signal.aborted) return { kind: "failed" };
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--ignore-config", "--no-playlist", "--no-warnings",
      "-f", await formatSelector(userId),
      "--dump-single-json",
    ];
    if (useCookies) args.push("--cookies", downloadCookiesFile(userId));
    let process: ReturnType<typeof Bun.spawn>;
    try {
      process = spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
    } catch {
      return { kind: "failed" };
    }
    const stop = () => { try { process.kill(); } catch {} };
    signal.addEventListener("abort", stop, { once: true });
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout as ReadableStream<Uint8Array>).text(),
        new Response(process.stderr as ReadableStream<Uint8Array>).text(),
        process.exited,
      ]);
      if (signal.aborted) return { kind: "failed" };
      if (exitCode !== 0) {
        log.warn("downloads.direct_stream_source_attempt_failed", {
          userId, videoId, usedCookies: useCookies, exitCode,
          stderr: stderr.split(/\r?\n/).filter(Boolean).slice(-3).map(redactDiagnostic),
        });
        return /requested format (?:is )?not available/i.test(stderr)
          ? { kind: "unsupported" }
          : { kind: "failed" };
      }
      if (!stdout.trim()) return { kind: "failed" };
      try {
        JSON.parse(stdout);
      } catch {
        return { kind: "failed" };
      }
      const sources = parseSelection(stdout, now());
      return sources ? { kind: "sources", sources } : { kind: "unsupported" };
    } catch {
      return { kind: "failed" };
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }

  async function resolveFresh(userId: number, videoId: string, signal: AbortSignal): Promise<SourceResolutionResult> {
    if (!(await ytdlpStatus()) || signal.aborted) return { kind: "failed" };
    const operation = requestSignal(signal, resolveTimeoutMs, "direct video source timeout");
    try {
      let failed = false;
      for (const useCookies of downloadCookieAttempts(downloadCookiesConfigured(userId))) {
        const result = await resolveAttempt(userId, videoId, useCookies, operation.signal);
        if (result.kind === "sources") return result;
        if (result.kind === "failed") failed = true;
        if (operation.signal.aborted) return { kind: "failed" };
      }
      return failed ? { kind: "failed" } : { kind: "unsupported" };
    } finally {
      operation.dispose();
    }
  }

  async function resolveSources(
    userId: number,
    videoId: string,
    signal?: AbortSignal,
    force = false,
  ): Promise<SourceResolutionResult> {
    const key = keyFor(userId, videoId);
    if (force) sourceCache.delete(key);
    const cached = sourceCache.get(key);
    if (cached && cached.expiresAt > now()) return { kind: "sources", sources: cached.sources };
    if (cached) sourceCache.delete(key);
    let operation = sourceResolutions.get(key);
    if (!operation || force) {
      if (force && operation) {
        sourceResolutions.delete(key);
        operation.controller.abort();
      }
      const controller = new AbortController();
      operation = { controller, promise: Promise.resolve({ kind: "failed" }), settled: false, waiters: 0 };
      const current = operation;
      current.promise = resolveFresh(userId, videoId, controller.signal)
        .then((result) => {
          if (result.kind === "sources" && !controller.signal.aborted) {
            sourceCache.set(key, { expiresAt: result.sources.expiresAt, sources: result.sources });
          }
          return controller.signal.aborted ? { kind: "failed" as const } : result;
        })
        .catch(() => ({ kind: "failed" as const }))
        .finally(() => {
          current.settled = true;
          if (sourceResolutions.get(key) === current) sourceResolutions.delete(key);
        });
      sourceResolutions.set(key, current);
    }
    const current = operation;
    return waitFor(current, signal, { kind: "failed" }, () => {
      if (sourceResolutions.get(key) === current) sourceResolutions.delete(key);
      current.controller.abort();
    });
  }

  async function fetchRange(
    source: DirectVideoMediaSource,
    start: number,
    end: number,
    signal: AbortSignal,
  ): Promise<Response | null> {
    return fetchGoogleVideoResponse(fetchImpl, source.url, {
      headers: { "User-Agent": "Mozilla/5.0", Range: `bytes=${start}-${end}` },
      signal,
    });
  }

  function validatedContentRange(response: Response, start: number, end: number) {
    if (response.status !== 206 || !response.body) return null;
    const match = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
    const contentLength = response.headers.get("content-length");
    if (!match || !contentLength || !/^\d+$/.test(contentLength)) return null;
    const actualStart = Number(match[1]);
    const actualEnd = Number(match[2]);
    const total = Number(match[3]);
    const length = Number(contentLength);
    if (![actualStart, actualEnd, total, length].every(Number.isSafeInteger)) return null;
    if (actualStart !== start || actualEnd !== Math.min(end, total - 1) || total <= actualEnd) return null;
    if (length !== actualEnd - actualStart + 1) return null;
    return { start: actualStart, end: actualEnd, total, length };
  }

  function upstreamRangeDiagnostic(response: Response | null, start: number, end: number) {
    return {
      status: response?.status ?? null,
      contentRange: response?.headers.get("content-range") ?? null,
      contentLength: response?.headers.get("content-length") ?? null,
      requestedStart: start,
      requestedEnd: end,
    };
  }

  async function readIndex(source: DirectVideoMediaSource, signal: AbortSignal): Promise<
    | { kind: "ok"; indexed: IndexedSource }
    | { kind: "unsupported" }
    | { kind: "failed" }
  > {
    let requestedBytes = INITIAL_INDEX_BYTES;
    while (!signal.aborted && requestedBytes <= MAX_INDEX_BYTES) {
      const operation = requestSignal(signal, rangeTimeoutMs, "direct video index timeout");
      try {
        const response = await fetchRange(source, 0, requestedBytes - 1, operation.signal);
        if (!response || response.status === 403 || response.status === 404 || response.status === 410) {
          await response?.body?.cancel().catch(() => {});
          return { kind: "failed" };
        }
        const range = validatedContentRange(response, 0, requestedBytes - 1);
        if (!range) {
          await response.body?.cancel().catch(() => {});
          return { kind: "failed" };
        }
        const buffer = await response.arrayBuffer().catch(() => null);
        if (!buffer || buffer.byteLength !== range.length || operation.signal.aborted) return { kind: "failed" };
        const bytes = new Uint8Array(buffer);
        const parsed = parseMediaSidx(bytes, range.total);
        if (parsed.kind === "need_more") {
          if (parsed.minimumBytes <= requestedBytes || parsed.minimumBytes > MAX_INDEX_BYTES) return { kind: "unsupported" };
          requestedBytes = parsed.minimumBytes;
          continue;
        }
        if (parsed.kind === "unsupported") return { kind: "unsupported" };
        const fingerprintLength = parsed.index.sidxOffset + parsed.index.sidxLength;
        const fingerprint = createHash("sha256").update(bytes.subarray(0, fingerprintLength)).digest("hex");
        return { kind: "ok", indexed: { fingerprint, index: parsed.index, source } };
      } finally {
        operation.dispose();
      }
    }
    return { kind: "failed" };
  }

  function presentationFor(videoId: string, sources: DirectVideoSources, video: IndexedSource, audio: IndexedSource) {
    const generation = createHash("sha256").update([
      video.fingerprint,
      audio.fingerprint,
      sources.video.formatId,
      sources.audio.formatId,
    ].join(":"), "utf8").digest("hex").slice(0, 24);
    return createVideoVodPresentation({
      videoId,
      resourceVersion: generation,
      video: video.index,
      audio: audio.index,
      metadata: {
        videoCodec: sources.video.codec,
        audioCodec: sources.audio.codec,
        width: sources.video.width!,
        height: sources.video.height!,
        fps: sources.video.fps!,
        videoBitrate: sources.video.bitrate!,
        audioBitrate: sources.audio.bitrate!,
        audioChannels: sources.audio.channels,
      },
    });
  }

  async function buildSession(userId: number, videoId: string, signal: AbortSignal): Promise<SessionBuildResult> {
    if (!await videoAvailable(videoId) || signal.aborted) return { kind: "failed" };
    const resolution = await resolveSources(userId, videoId, signal);
    if (resolution.kind === "unsupported") return {
      kind: "unsupported",
      expiresAt: now() + TRANSIENT_UNSUPPORTED_CACHE_MS,
    };
    if (resolution.kind === "failed" || signal.aborted) return { kind: "failed" };
    const sources = resolution.sources;
    const [video, audio] = await Promise.all([
      readIndex(sources.video, signal),
      readIndex(sources.audio, signal),
    ]);
    if (signal.aborted || video.kind === "failed" || audio.kind === "failed") return { kind: "failed" };
    if (video.kind === "unsupported" || audio.kind === "unsupported") return {
      kind: "unsupported",
      expiresAt: Math.min(sources.expiresAt, now() + TRANSIENT_UNSUPPORTED_CACHE_MS),
    };
    const presentationResult = presentationFor(videoId, sources, video.indexed, audio.indexed);
    if (presentationResult.kind === "unsupported") {
      log.info("downloads.direct_stream_unavailable", {
        userId, videoId, reason: presentationResult.reason,
      });
      return { kind: "unsupported", expiresAt: Math.min(sources.expiresAt, now() + TRANSIENT_UNSUPPORTED_CACHE_MS) };
    }
    const presentation = presentationResult.presentation;
    const generation = createHash("sha256").update([
      video.indexed.fingerprint,
      audio.indexed.fingerprint,
      sources.video.formatId,
      sources.audio.formatId,
    ].join(":"), "utf8").digest("hex").slice(0, 24);
    try { await prioritizeDownload(userId, videoId); } catch {
      log.warn("downloads.direct_stream_download_priority_failed", { userId, videoId });
    }
    if (signal.aborted) return { kind: "failed" };
    const session: DirectVideoSession = {
      userId, videoId, sources,
      video: video.indexed,
      audio: audio.indexed,
      presentation,
      generation,
      refresh: null,
      lastAccess: now(),
    };
    return { kind: "ready", session };
  }

  function sweep(): void {
    const current = now();
    for (const [key, session] of sessions) {
      if (current - session.lastAccess > DIRECT_SESSION_IDLE_MS) sessions.delete(key);
    }
    for (const [key, expiresAt] of unsupported) {
      if (expiresAt <= current) unsupported.delete(key);
    }
    while (sessions.size > MAX_DIRECT_SESSIONS) {
      const oldest = [...sessions].sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0]?.[0];
      if (!oldest) break;
      sessions.delete(oldest);
    }
  }

  async function getSession(userId: number, videoId: string, signal?: AbortSignal): Promise<SessionBuildResult> {
    if (signal?.aborted) return { kind: "failed" };
    sweep();
    const key = keyFor(userId, videoId);
    const existing = sessions.get(key);
    if (existing) {
      existing.lastAccess = now();
      return { kind: "ready", session: existing };
    }
    const unsupportedUntil = unsupported.get(key);
    if (unsupportedUntil && unsupportedUntil > now()) return { kind: "unsupported", expiresAt: unsupportedUntil };
    let operation = sessionBuilds.get(key);
    if (!operation) {
      const controller = new AbortController();
      operation = { controller, promise: Promise.resolve({ kind: "failed" }), settled: false, waiters: 0 };
      const current = operation;
      current.promise = buildSession(userId, videoId, controller.signal)
        .then((result) => {
          if (result.kind === "ready" && !controller.signal.aborted) sessions.set(key, result.session);
          if (result.kind === "unsupported" && !controller.signal.aborted) unsupported.set(key, result.expiresAt);
          return controller.signal.aborted ? { kind: "failed" as const } : result;
        })
        .catch(() => ({ kind: "failed" as const }))
        .finally(() => {
          current.settled = true;
          if (sessionBuilds.get(key) === current) sessionBuilds.delete(key);
        });
      sessionBuilds.set(key, current);
    }
    const current = operation;
    return waitFor(current, signal, { kind: "failed" }, () => {
      if (sessionBuilds.get(key) === current) sessionBuilds.delete(key);
      current.controller.abort();
    });
  }

  async function refreshSession(session: DirectVideoSession, signal?: AbortSignal): Promise<DirectVideoSession | null> {
    if (signal?.aborted) return null;
    let operation = session.refresh;
    if (!operation) {
      const controller = new AbortController();
      operation = { controller, promise: Promise.resolve(null), settled: false, waiters: 0 };
      const current = operation;
      const staleVideoUrl = session.sources.video.url;
      const staleAudioUrl = session.sources.audio.url;
      current.promise = (async () => {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const resolution = await resolveSources(session.userId, session.videoId, controller.signal, true);
          if (resolution.kind !== "sources" || controller.signal.aborted) return null;
          const sources = resolution.sources;
          if (sources.video.formatId !== session.sources.video.formatId
            || sources.audio.formatId !== session.sources.audio.formatId) return null;
          // YouTube can hand back the same expired bearer URL briefly. Do not
          // issue the exact request that just failed; retry one fresh resolve.
          if (sources.video.url === staleVideoUrl && sources.audio.url === staleAudioUrl) {
            if (attempt === 1) {
              await Promise.resolve();
              continue;
            }
            return null;
          }
          const [video, audio] = await Promise.all([
            readIndex(sources.video, controller.signal),
            readIndex(sources.audio, controller.signal),
          ]);
          if (video.kind !== "ok" || audio.kind !== "ok") {
            if (attempt === 1 && !controller.signal.aborted) continue;
            return null;
          }
          if (video.indexed.fingerprint !== session.video.fingerprint
            || audio.indexed.fingerprint !== session.audio.fingerprint) return null;
          session.sources = sources;
          session.video = video.indexed;
          session.audio = audio.indexed;
          session.lastAccess = now();
          log.info("downloads.direct_stream_source_refreshed", {
            userId: session.userId,
            videoId: session.videoId,
            videoFormatId: sources.video.formatId,
            audioFormatId: sources.audio.formatId,
          });
          return session;
        }
        return null;
      })().catch(() => null).finally(() => {
        current.settled = true;
        if (session.refresh === current) session.refresh = null;
      });
      session.refresh = current;
    }
    const current = operation;
    return waitFor(current, signal, null, () => {
      if (session.refresh === current) session.refresh = null;
      current.controller.abort();
    });
  }

  async function getDirectHlsPlaylist(
    userId: number,
    videoId: string,
    file: "index.m3u8" | "video.m3u8" | "audio.m3u8",
    signal?: AbortSignal,
    generation?: string | null,
  ): Promise<DirectVideoPlaylistResult> {
    const result = await getSession(userId, videoId, signal);
    if (result.kind !== "ready") return { kind: result.kind };
    result.session.lastAccess = now();
    if (file === "index.m3u8") return { kind: "playlist", playlist: result.session.presentation.masterPlaylist };
    if (!generation || generation !== result.session.generation) return { kind: "stale" };
    if (file === "video.m3u8") return { kind: "playlist", playlist: result.session.presentation.videoPlaylist };
    return { kind: "playlist", playlist: result.session.presentation.audioPlaylist };
  }

  function requestedRange(value: string | null): { start: number; end: number } | null {
    const match = value?.trim().match(/^bytes=(\d+)-(\d+)$/i);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
    if (end - start + 1 > DIRECT_VIDEO_HLS_MAX_RANGE_BYTES) return null;
    return { start, end };
  }

  async function proxyResource(
    session: DirectVideoSession,
    kind: "audio" | "video",
    rangeValue: string | null,
    signal?: AbortSignal,
  ): Promise<DirectVideoResourceResult> {
    const range = requestedRange(rangeValue);
    if (!range) return { kind: "response", response: new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Cache-Control": "no-store" },
    }) };
    const activeRequests = bufferedRangeRequests.get(session.userId) ?? 0;
    if (activeRequests >= MAX_BUFFERED_RANGE_REQUESTS_PER_PROFILE) return { kind: "response", response: new Response(null, {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": "1" },
    }) };
    bufferedRangeRequests.set(session.userId, activeRequests + 1);
    let active = session;
    try {
      if (active.sources.expiresAt <= now()) {
        const refreshed = await refreshSession(active, signal);
        if (!refreshed) {
          if (signal?.aborted) return { kind: "failed" };
          sessions.delete(keyFor(active.userId, active.videoId));
          return { kind: "stale" };
        }
        active = refreshed;
      }
      const operation = requestSignal(signal, rangeTimeoutMs, "direct video range timeout");
      try {
        let source = active[kind].source;
        let response = await fetchRange(source, range.start, range.end, operation.signal);
        if (!response || response.status === 403 || response.status === 404 || response.status === 410) {
          await response?.body?.cancel().catch(() => {});
          const refreshed = await refreshSession(active, operation.signal);
          if (!refreshed) {
            if (operation.signal.aborted) return { kind: "failed" };
            sessions.delete(keyFor(active.userId, active.videoId));
            return { kind: "stale" };
          }
          source = refreshed[kind].source;
          response = await fetchRange(source, range.start, range.end, operation.signal);
        }
        if (!response) return { kind: "failed" };
        if (response.status === 416) {
          const total = response.headers.get("content-range")?.match(/^bytes \*\/(\d+)$/i)?.[1];
          await response.body?.cancel().catch(() => {});
          return { kind: "response", response: new Response(null, {
            status: 416,
            headers: {
              "Accept-Ranges": "bytes",
              "Cache-Control": "no-store",
              ...(total ? { "Content-Range": `bytes */${total}` } : {}),
            },
          }) };
        }
        const contentRange = validatedContentRange(response, range.start, range.end);
        if (!contentRange) {
          log.warn("downloads.direct_stream_range_rejected", {
            userId: active.userId,
            videoId: active.videoId,
            media: kind,
            ...upstreamRangeDiagnostic(response, range.start, range.end),
          });
          await response.body?.cancel().catch(() => {});
          return { kind: "failed" };
        }
        const body = await response.arrayBuffer().catch(() => null);
        if (!body || body.byteLength !== contentRange.length || operation.signal.aborted) return { kind: "failed" };
        active.lastAccess = now();
        return { kind: "response", response: new Response(body, {
          status: 206,
          headers: {
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Length": String(contentRange.length),
            "Content-Range": `bytes ${contentRange.start}-${contentRange.end}/${contentRange.total}`,
            "Content-Type": kind === "video" ? "video/mp4" : "audio/mp4",
          },
        }) };
      } finally {
        operation.dispose();
      }
    } finally {
      const remaining = (bufferedRangeRequests.get(session.userId) ?? 1) - 1;
      if (remaining > 0) bufferedRangeRequests.set(session.userId, remaining);
      else bufferedRangeRequests.delete(session.userId);
    }
  }

  async function getDirectHlsResource(
    userId: number,
    videoId: string,
    file: "video.mp4" | "audio.mp4",
    range: string | null,
    signal?: AbortSignal,
    generation?: string | null,
  ): Promise<DirectVideoResourceResult> {
    const result = await getSession(userId, videoId, signal);
    if (result.kind === "unsupported") return { kind: "not_found" };
    if (result.kind === "failed") return { kind: "failed" };
    if (!generation || generation !== result.session.generation) return { kind: "stale" };
    return proxyResource(result.session, file === "video.mp4" ? "video" : "audio", range, signal);
  }

  /** Lightweight ownership check for child playlist/resource requests. */
  function hasDirectHlsSession(userId: number, videoId: string): boolean {
    const session = sessions.get(keyFor(userId, videoId));
    if (!session) return false;
    session.lastAccess = now();
    return true;
  }

  function invalidateDirectHlsSession(videoId: string, userId?: number): void {
    const invalidateKey = (key: string) => {
      sourceCache.delete(key);
      unsupported.delete(key);
      sessions.delete(key);
      const resolution = sourceResolutions.get(key);
      if (resolution) {
        sourceResolutions.delete(key);
        resolution.controller.abort();
      }
      const build = sessionBuilds.get(key);
      if (build) {
        sessionBuilds.delete(key);
        build.controller.abort();
      }
    };
    if (userId != null) {
      invalidateKey(keyFor(userId, videoId));
      return;
    }
    for (const key of new Set([...sourceCache.keys(), ...sessions.keys(), ...sessionBuilds.keys()])) {
      if (key.endsWith(`:${videoId}`)) invalidateKey(key);
    }
  }

  function resetDirectHlsSessions(): void {
    for (const operation of sourceResolutions.values()) operation.controller.abort();
    for (const operation of sessionBuilds.values()) operation.controller.abort();
    sourceCache.clear();
    sourceResolutions.clear();
    sessions.clear();
    sessionBuilds.clear();
    unsupported.clear();
    bufferedRangeRequests.clear();
  }

  return {
    getDirectHlsPlaylist,
    getDirectHlsResource,
    hasDirectHlsSession,
    invalidateDirectHlsSession,
    resetDirectHlsSessions,
  };
}
