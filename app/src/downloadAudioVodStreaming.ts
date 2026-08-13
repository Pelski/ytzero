import { AudioSourceCache, audioSourceKey } from "./audioSourceCache";
import type { AudioDiagnostic } from "./audioDiagnostics";
import type { AudioSource } from "./audioSourceResolver";
import { parseAudioSidx } from "./audioSidx";
import { createAudioVodPlaylist } from "./audioVodPlaylist";

export type AudioVodPlaylistResult =
  | { kind: "playlist"; playlist: string }
  | { kind: "unsupported" }
  | { kind: "failed" };

interface AudioPrefix {
  bytes: Uint8Array;
  source: AudioSource;
  total: number;
}

interface CachedAudioVodIndex {
  expiresAt: number;
  result: Exclude<AudioVodPlaylistResult, { kind: "failed" }>;
  sourceUrl: string;
}

interface AudioVodResolution {
  controller: AbortController;
  promise: Promise<AudioVodPlaylistResult>;
  sourceUrl: string;
  waiters: number;
  settled: boolean;
}

interface AudioVodStreamingDependencies {
  audioDiagnostic: AudioDiagnostic;
  readPrefix: (userId: number, videoId: string, bytes: number, signal: AbortSignal) => Promise<AudioPrefix | null>;
  resolveAudioSource: (userId: number, videoId: string, signal?: AbortSignal) => Promise<AudioSource | null>;
}

const INITIAL_PREFIX_BYTES = 64 * 1024;
const MAX_PREFIX_BYTES = 2 * 1024 * 1024;

/** Build and cache a per-profile HLS view over an indexed fragmented MP4 source. */
export function createDownloadAudioVodStreaming(dependencies: AudioVodStreamingDependencies) {
  const { audioDiagnostic, readPrefix, resolveAudioSource } = dependencies;
  const indexes = new AudioSourceCache<CachedAudioVodIndex>();
  const resolutions = new Map<string, AudioVodResolution>();

  function cacheResult(
    userId: number,
    videoId: string,
    source: AudioSource,
    result: CachedAudioVodIndex["result"],
  ): AudioVodPlaylistResult {
    indexes.set(userId, videoId, { expiresAt: source.expiresAt, result, sourceUrl: source.url });
    return result;
  }

  async function build(
    userId: number,
    videoId: string,
    signal: AbortSignal,
  ): Promise<AudioVodPlaylistResult> {
    let requestedBytes = INITIAL_PREFIX_BYTES;
    while (!signal.aborted && requestedBytes <= MAX_PREFIX_BYTES) {
      const prefix = await readPrefix(userId, videoId, requestedBytes, signal);
      if (!prefix || signal.aborted) return { kind: "failed" };
      const parsed = parseAudioSidx(prefix.bytes, prefix.total);
      if (parsed.kind === "need_more") {
        if (parsed.minimumBytes <= requestedBytes || parsed.minimumBytes > MAX_PREFIX_BYTES) {
          audioDiagnostic("info", "audio.vod_index_unavailable", {
            userId, videoId, reason: "index_prefix_too_large", minimumBytes: parsed.minimumBytes,
          });
          return cacheResult(userId, videoId, prefix.source, { kind: "unsupported" });
        }
        requestedBytes = parsed.minimumBytes;
        continue;
      }
      if (parsed.kind === "unsupported") {
        audioDiagnostic("info", "audio.vod_index_unavailable", {
          userId, videoId, reason: parsed.reason,
        });
        return cacheResult(userId, videoId, prefix.source, { kind: "unsupported" });
      }
      const playlist = createAudioVodPlaylist(videoId, parsed.index);
      if (!playlist) {
        audioDiagnostic("info", "audio.vod_index_unavailable", {
          userId, videoId, reason: "playlist_constraints",
        });
        return cacheResult(userId, videoId, prefix.source, { kind: "unsupported" });
      }
      audioDiagnostic("info", "audio.vod_index_ready", {
        userId, videoId, fragments: parsed.index.references.length, prefixBytes: prefix.bytes.byteLength,
      });
      return cacheResult(userId, videoId, prefix.source, { kind: "playlist", playlist });
    }
    return { kind: "failed" };
  }

  function release(key: string, resolution: AudioVodResolution): void {
    resolution.waiters = Math.max(0, resolution.waiters - 1);
    if (resolution.waiters === 0 && !resolution.settled && resolutions.get(key) === resolution) {
      resolutions.delete(key);
      resolution.controller.abort();
    }
  }

  function waitFor(
    key: string,
    resolution: AudioVodResolution,
    signal?: AbortSignal,
  ): Promise<AudioVodPlaylistResult> {
    if (signal?.aborted) return Promise.resolve({ kind: "failed" });
    resolution.waiters++;
    return new Promise((resolve) => {
      let finished = false;
      const finish = (result: AudioVodPlaylistResult) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        release(key, resolution);
        resolve(signal?.aborted ? { kind: "failed" } : result);
      };
      const onAbort = () => finish({ kind: "failed" });
      signal?.addEventListener("abort", onAbort, { once: true });
      resolution.promise.then(finish, () => finish({ kind: "failed" }));
    });
  }

  async function getAudioVodPlaylist(
    userId: number,
    videoId: string,
    signal?: AbortSignal,
  ): Promise<AudioVodPlaylistResult> {
    const source = await resolveAudioSource(userId, videoId, signal);
    if (!source || signal?.aborted) return { kind: "failed" };
    const cached = indexes.get(userId, videoId);
    if (cached?.sourceUrl === source.url) return cached.result;
    if (cached) indexes.delete(userId, videoId);

    const key = audioSourceKey(userId, videoId);
    let resolution = resolutions.get(key);
    if (resolution && resolution.sourceUrl !== source.url) {
      resolutions.delete(key);
      resolution.controller.abort();
      resolution = undefined;
    }
    if (!resolution) {
      const controller = new AbortController();
      resolution = {
        controller,
        promise: Promise.resolve({ kind: "failed" }),
        sourceUrl: source.url,
        waiters: 0,
        settled: false,
      };
      const current = resolution;
      current.promise = build(userId, videoId, controller.signal)
        .catch(() => ({ kind: "failed" as const }))
        .finally(() => {
          current.settled = true;
          if (resolutions.get(key) === current) resolutions.delete(key);
        });
      resolutions.set(key, current);
    }
    return waitFor(key, resolution, signal);
  }

  function invalidateAudioVodSource(userId: number, videoId: string): void {
    indexes.delete(userId, videoId);
    const key = audioSourceKey(userId, videoId);
    const resolution = resolutions.get(key);
    if (!resolution) return;
    resolutions.delete(key);
    resolution.controller.abort();
  }

  function invalidateAudioVodSources(userId: number): void {
    indexes.invalidateUser(userId);
    const prefix = `${userId}:`;
    for (const [key, resolution] of resolutions) {
      if (!key.startsWith(prefix)) continue;
      resolutions.delete(key);
      resolution.controller.abort();
    }
  }

  return { getAudioVodPlaylist, invalidateAudioVodSource, invalidateAudioVodSources };
}
