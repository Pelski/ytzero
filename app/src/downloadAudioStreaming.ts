import {
  audioRangeHeader,
  parseAudioRange,
  parseAudioUnsatisfiedTotal,
  validateAudioRangeResponse,
  type AudioByteRange,
} from "./audioRange";
import { createAudioSourceResolver, type AudioSource } from "./audioSourceResolver";

interface DownloadAudioStreamingDependencies {
  YTDLP: string;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  ytdlpStatus: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
}

const AUDIO_REQUEST_TIMEOUT_MS = 45_000;

export function createDownloadAudioStreaming(dependencies: DownloadAudioStreamingDependencies) {
  const { fetchImpl = fetch } = dependencies;
  const { invalidateAudioSources, refreshAudioSource, resolveAudioSource } = createAudioSourceResolver(dependencies);

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

  async function validatedAudioUpstream(
    userId: number,
    videoId: string,
    range: AudioByteRange,
    signal: AbortSignal,
  ): Promise<AudioUpstreamResult> {
    let source = await resolveAudioSource(userId, videoId, signal);
    if (!source) return null;

    const fetchUpstream = (url: string) => fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0", Range: audioRangeHeader(range) },
      redirect: "manual",
      signal,
    }).catch(() => null);

    let upstream = await fetchUpstream(source.url);
    if (upstream && (upstream.status === 403 || upstream.status === 410)) {
      await upstream.body?.cancel().catch(() => {});
      source = await refreshAudioSource(userId, videoId, source.url, signal);
      if (!source) return null;
      upstream = await fetchUpstream(source.url);
    }
    if (!upstream) return null;

    if (upstream.status === 416) {
      const total = parseAudioUnsatisfiedTotal(upstream.headers.get("content-range"));
      await upstream.body?.cancel().catch(() => {});
      return { kind: "response", value: rangeNotSatisfiable(total ?? undefined) };
    }
    if (upstream.status !== 206 || !upstream.body) {
      await upstream.body?.cancel().catch(() => {});
      return null;
    }

    const contentRange = validateAudioRangeResponse(
      upstream.status,
      upstream.headers.get("content-range"),
      upstream.headers.get("content-length"),
      range,
    );
    if (!contentRange) {
      await upstream.body.cancel().catch(() => {});
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
      if (!body || body.byteLength !== contentLength || operation.signal.aborted) return null;
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

  return { getAudioHeadResponse, getAudioResponse, invalidateAudioSources };
}
