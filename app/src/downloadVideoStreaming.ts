import {
  createDownloadVideoDirectStreaming,
  type DirectVideoResourceResult,
} from "./downloadVideoDirectStreaming";
import { createDownloadVideoTranscodeStreaming } from "./downloadVideoTranscodeStreaming";
import type { DlSettings } from "./downloader";

interface DownloadVideoStreamingDependencies {
  DOWNLOADS_DIR: string;
  YTDLP: string;
  dlEnabled: (userId?: number) => Promise<boolean>;
  dlSettings: (userId?: number) => Promise<Pick<DlSettings, "experimental_streaming" | "quality">>;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  prioritizeDownload: (userId: number, videoId: string) => Promise<boolean>;
  readLines: (stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) => Promise<void>;
  ytdlpStatus: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
  videoAvailable?: (videoId: string) => Promise<boolean>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  segmentWaitMs?: number;
  regionStallMs?: number;
  probeTimeoutMs?: number;
  resolveTimeoutMs?: number;
  rangeTimeoutMs?: number;
}

const DIRECT_PLAYLIST_FILES = new Set(["index.m3u8", "video.m3u8", "audio.m3u8"]);
const DIRECT_RESOURCE_FILES = new Set(["video.mp4", "audio.mp4"]);
const DIRECT_MODE_IDLE_MS = 30 * 60_000;
const MAX_DIRECT_MODES = 128;

/**
 * Prefer a validated, zero-transcode fMP4 presentation. The older on-demand
 * ffmpeg implementation remains an internal fallback for sources whose MP4
 * indexes cannot safely be exposed as HLS byte ranges.
 */
export function createDownloadVideoStreaming(dependencies: DownloadVideoStreamingDependencies) {
  const direct = createDownloadVideoDirectStreaming(dependencies);
  const transcode = createDownloadVideoTranscodeStreaming(dependencies);
  const directModes = new Map<string, number>();
  const keyFor = (userId: number, videoId: string) => `${userId}:${videoId}`;

  function rememberDirect(key: string): void {
    const current = dependencies.now?.() ?? Date.now();
    directModes.delete(key);
    directModes.set(key, current);
    for (const [candidate, lastAccess] of directModes) {
      if (current - lastAccess > DIRECT_MODE_IDLE_MS) directModes.delete(candidate);
    }
    while (directModes.size > MAX_DIRECT_MODES) {
      const oldest = directModes.keys().next().value as string | undefined;
      if (!oldest) break;
      directModes.delete(oldest);
    }
  }

  async function getHlsPlaylist(
    userId: number,
    videoId: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const key = keyFor(userId, videoId);
    const directResult = await direct.getDirectHlsPlaylist(userId, videoId, "index.m3u8", signal);
    if (directResult.kind === "playlist") {
      rememberDirect(key);
      return directResult.playlist;
    }
    // A resolver/network failure is transient. Starting the expensive
    // transcode path here would pin this session to the fallback even though
    // the direct representation may work on the next request.
    if (directResult.kind === "failed") return null;
    return transcode.getHlsPlaylist(userId, videoId, signal);
  }

  async function getHlsResource(
    userId: number,
    videoId: string,
    file: string,
    range: string | null,
    generation: string | null,
    signal?: AbortSignal,
  ): Promise<DirectVideoResourceResult> {
    const key = keyFor(userId, videoId);
    if (!directModes.has(key) && !direct.hasDirectHlsSession(userId, videoId)) return { kind: "not_found" };
    if (DIRECT_PLAYLIST_FILES.has(file)) {
      const playlist = await direct.getDirectHlsPlaylist(
        userId,
        videoId,
        file as "index.m3u8" | "video.m3u8" | "audio.m3u8",
        signal,
        generation,
      );
      if (playlist.kind === "playlist") {
        rememberDirect(key);
        return { kind: "response", response: new Response(playlist.playlist, {
          headers: { "Cache-Control": "no-store", "Content-Type": "application/vnd.apple.mpegurl" },
        }) };
      }
      if (playlist.kind === "unsupported") return { kind: "not_found" };
      return { kind: playlist.kind };
    }
    if (!DIRECT_RESOURCE_FILES.has(file)) return { kind: "not_found" };
    return direct.getDirectHlsResource(
      userId,
      videoId,
      file as "video.mp4" | "audio.mp4",
      range,
      signal,
      generation,
    );
  }

  function hasHlsSession(userId: number, videoId: string): boolean {
    const active = direct.hasDirectHlsSession(userId, videoId);
    if (active) rememberDirect(keyFor(userId, videoId));
    return active;
  }

  function destroyHlsSession(videoId: string, userId?: number): void {
    direct.invalidateDirectHlsSession(videoId, userId);
    transcode.destroyHlsSession(videoId, userId);
    if (userId != null) {
      directModes.delete(keyFor(userId, videoId));
      return;
    }
    for (const key of directModes.keys()) {
      if (key.endsWith(`:${videoId}`)) directModes.delete(key);
    }
  }

  function resetHlsScratch(): void {
    directModes.clear();
    direct.resetDirectHlsSessions();
    transcode.resetHlsScratch();
  }

  return {
    destroyHlsSession,
    getHlsPlaylist,
    getHlsResource,
    getHlsSegment: transcode.getHlsSegment,
    hasHlsSession,
    isSegmentName: transcode.isSegmentName,
    liveStreamEnabled: transcode.liveStreamEnabled,
    resetHlsScratch,
  };
}
