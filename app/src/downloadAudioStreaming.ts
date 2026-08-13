import {
  audioRangeHeader,
  parseAudioRange,
  parseAudioUnsatisfiedTotal,
  validateAudioRangeResponse,
  type AudioByteRange,
} from "./audioRange";
import { defaultAudioDiagnostic, type AudioDiagnostic } from "./audioDiagnostics";
import { createAudioSourceResolver, type AudioSource } from "./audioSourceResolver";
import { googleVideoHost, safeGoogleVideoUrl } from "./audioUpstreamUrl";
import { createDownloadAudioVodStreaming } from "./downloadAudioVodStreaming";

interface DownloadAudioStreamingDependencies {
  YTDLP: string;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  ytdlpStatus: () => Promise<string | null>;
  audioDiagnostic?: AudioDiagnostic;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
}

const AUDIO_REQUEST_TIMEOUT_MS = 45_000;
const AUDIO_REDIRECT_LIMIT = 4;
const AUDIO_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function createDownloadAudioStreaming(dependencies: DownloadAudioStreamingDependencies) {
  const { audioDiagnostic = defaultAudioDiagnostic, fetchImpl = fetch } = dependencies;
  const {
    discardAudioSource,
    invalidateAudioSources: invalidateResolvedAudioSources,
    refreshAudioSource,
    resolveAudioSource,
    retryAudioSource: retryResolvedAudioSource,
  } = createAudioSourceResolver(dependencies);

  function rangeNotSatisfiable(total?: number): Response {
    const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
    if (total != null) headers.set("Content-Range", `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }

  function requestAbortSignal(parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort();
    else parent?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("audio proxy timeout")), AUDIO_REQUEST_TIMEOUT_MS);
    return {
      signal: controller.signal,
      dispose: () => {
        clearTimeout(timer);
        parent?.removeEventListener("abort", abort);
      },
    };
  }

  interface ValidatedAudioUpstream {
    source: AudioSource;
    response: Response;
    contentRange: { start: number; end: number; total: number };
    contentLength: number;
  }

  type AudioUpstreamResult =
    | { kind: "ok"; value: ValidatedAudioUpstream }
    | { kind: "response"; value: Response }
    | null;

  async function fetchAudioUpstream(
    userId: number,
    videoId: string,
    sourceUrl: string,
    range: AudioByteRange,
    signal: AbortSignal,
  ): Promise<Response | null> {
    let currentUrl = sourceUrl;
    for (let hop = 0; hop <= AUDIO_REDIRECT_LIMIT; hop++) {
      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          headers: { "User-Agent": "Mozilla/5.0", Range: audioRangeHeader(range) },
          redirect: "manual",
          signal,
        });
      } catch {
        if (!signal.aborted) audioDiagnostic("warn", "audio.upstream_failed", {
          userId, videoId, reason: "network_error", rangeStart: range.start, rangeEnd: range.end,
        });
        return null;
      }

      if (!AUDIO_REDIRECT_STATUSES.has(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (hop === AUDIO_REDIRECT_LIMIT) {
        audioDiagnostic("warn", "audio.upstream_failed", {
          userId, videoId, reason: "redirect_limit", status: response.status, redirects: hop + 1,
        });
        return null;
      }
      const nextUrl = location ? safeGoogleVideoUrl(location, currentUrl) : null;
      if (!nextUrl) {
        audioDiagnostic("warn", "audio.upstream_failed", {
          userId, videoId, reason: "redirect_rejected", status: response.status, redirects: hop + 1,
        });
        return null;
      }
      audioDiagnostic("info", "audio.upstream_redirect", {
        userId,
        videoId,
        status: response.status,
        redirects: hop + 1,
        fromHost: googleVideoHost(currentUrl),
        toHost: googleVideoHost(nextUrl),
      });
      currentUrl = nextUrl;
    }
    return null;
  }

  async function validatedAudioUpstream(
    userId: number,
    videoId: string,
    range: AudioByteRange,
    signal: AbortSignal,
  ): Promise<AudioUpstreamResult> {
    let source = await resolveAudioSource(userId, videoId, signal);
    if (!source) return null;

    let upstream = await fetchAudioUpstream(userId, videoId, source.url, range, signal);
    if (upstream && (upstream.status === 403 || upstream.status === 410)) {
      audioDiagnostic("info", "audio.source_refresh", {
        userId, videoId, reason: "upstream_status", status: upstream.status,
      });
      await upstream.body?.cancel().catch(() => {});
      source = await refreshAudioSource(userId, videoId, source.url, signal);
      if (!source) return null;
      upstream = await fetchAudioUpstream(userId, videoId, source.url, range, signal);
    }
    if (!upstream) {
      if (!signal.aborted) discardAudioSource(userId, videoId, source.url);
      return null;
    }

    if (upstream.status === 416) {
      const total = parseAudioUnsatisfiedTotal(upstream.headers.get("content-range"));
      await upstream.body?.cancel().catch(() => {});
      return { kind: "response", value: rangeNotSatisfiable(total ?? undefined) };
    }
    if (upstream.status !== 206 || !upstream.body) {
      audioDiagnostic("warn", "audio.upstream_failed", {
        userId,
        videoId,
        reason: upstream.body ? "unexpected_status" : "missing_body",
        status: upstream.status,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      await upstream.body?.cancel().catch(() => {});
      if (!signal.aborted) discardAudioSource(userId, videoId, source.url);
      return null;
    }

    const contentRange = validateAudioRangeResponse(
      upstream.status,
      upstream.headers.get("content-range"),
      upstream.headers.get("content-length"),
      range,
    );
    if (!contentRange) {
      audioDiagnostic("warn", "audio.upstream_failed", {
        userId,
        videoId,
        reason: "invalid_range_headers",
        status: upstream.status,
        contentRange: upstream.headers.get("content-range"),
        contentLength: upstream.headers.get("content-length"),
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      await upstream.body.cancel().catch(() => {});
      if (!signal.aborted) discardAudioSource(userId, videoId, source.url);
      return null;
    }
    const expectedLength = contentRange.end - contentRange.start + 1;
    return { kind: "ok", value: { source, response: upstream, contentRange, contentLength: expectedLength } };
  }

  /** Proxy one verified, bounded audio chunk with an explicit Content-Length. */
  async function getAudioResponse(
    userId: number,
    videoId: string,
    range: string | null,
    signal?: AbortSignal,
  ): Promise<Response | null> {
    const parsed = parseAudioRange(range);
    if (!parsed) return rangeNotSatisfiable();
    const operation = requestAbortSignal(signal);
    try {
      const result = await validatedAudioUpstream(userId, videoId, parsed, operation.signal);
      if (!result) return null;
      if (result.kind === "response") return result.value;
      const { source, response, contentRange, contentLength } = result.value;
      const body = await response.arrayBuffer().catch(() => null);
      if (!body || body.byteLength !== contentLength || operation.signal.aborted) {
        if (!operation.signal.aborted) {
          audioDiagnostic("warn", "audio.upstream_failed", {
            userId,
            videoId,
            reason: body ? "body_length_mismatch" : "body_read_failed",
            expectedLength: contentLength,
            receivedLength: body?.byteLength,
          });
          discardAudioSource(userId, videoId, source.url);
        }
        return null;
      }
      return new Response(body, {
        status: 206,
        headers: {
          "Content-Type": source.mime,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${contentRange.start}-${contentRange.end}/${contentRange.total}`,
        },
      });
    } finally {
      operation.dispose();
    }
  }

  async function readAudioPrefix(
    userId: number,
    videoId: string,
    bytes: number,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; source: AudioSource; total: number } | null> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return null;
    const operation = requestAbortSignal(signal);
    try {
      const range: AudioByteRange = { start: 0, end: bytes - 1, requested: true };
      const result = await validatedAudioUpstream(userId, videoId, range, operation.signal);
      if (!result || result.kind === "response") return null;
      const { source, response, contentRange, contentLength } = result.value;
      const body = await response.arrayBuffer().catch(() => null);
      if (!body || body.byteLength !== contentLength || operation.signal.aborted) {
        if (!operation.signal.aborted) {
          audioDiagnostic("warn", "audio.upstream_failed", {
            userId,
            videoId,
            reason: body ? "index_body_length_mismatch" : "index_body_read_failed",
            expectedLength: contentLength,
            receivedLength: body?.byteLength,
          });
          discardAudioSource(userId, videoId, source.url);
        }
        return null;
      }
      return { bytes: new Uint8Array(body), source, total: contentRange.total };
    } finally {
      operation.dispose();
    }
  }

  /** Probe one byte to obtain full-resource metadata without buffering media. */
  async function getAudioHeadResponse(
    userId: number,
    videoId: string,
    range: string | null,
    signal?: AbortSignal,
  ): Promise<Response | null> {
    const requested = parseAudioRange(range);
    if (!requested) return rangeNotSatisfiable();
    const operation = requestAbortSignal(signal);
    try {
      const probe: AudioByteRange = { start: 0, end: 0, requested: true };
      const result = await validatedAudioUpstream(userId, videoId, probe, operation.signal);
      if (!result) return null;
      if (result.kind === "response") return result.value;
      const { source, response, contentRange } = result.value;
      await response.body?.cancel().catch(() => {});
      if (range != null && requested.start >= contentRange.total) {
        return rangeNotSatisfiable(contentRange.total);
      }
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": source.mime,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Content-Length": String(contentRange.total),
        },
      });
    } finally {
      operation.dispose();
    }
  }

  const audioVod = createDownloadAudioVodStreaming({
    audioDiagnostic,
    readPrefix: readAudioPrefix,
    resolveAudioSource,
  });

  function invalidateAudioSources(userId: number): void {
    audioVod.invalidateAudioVodSources(userId);
    invalidateResolvedAudioSources(userId);
  }

  async function retryAudioSource(userId: number, videoId: string, signal?: AbortSignal): Promise<boolean> {
    audioVod.invalidateAudioVodSource(userId, videoId);
    return retryResolvedAudioSource(userId, videoId, signal);
  }

  return { getAudioHeadResponse, getAudioResponse, ...audioVod, invalidateAudioSources, retryAudioSource };
}
