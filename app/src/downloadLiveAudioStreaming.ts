import { AudioSourceCache, audioSourceKey } from "./audioSourceCache";
import { downloadCookieAttempts } from "./downloadStrategy";
import { rewriteLiveAudioPlaylist } from "./liveAudioPlaylist";

interface DownloadLiveAudioDependencies {
  YTDLP: string;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  ytdlpStatus: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
}

interface LiveAudioSession {
  expiresAt: number;
  nextResourceId: number;
  playlistUrl: string;
  resources: Map<string, string>;
  tokensByUrl: Map<string, string>;
}

interface LiveResolution {
  controller: AbortController;
  promise: Promise<LiveAudioSession | null>;
}

const LIVE_AUDIO_FORMAT = "bestaudio[protocol*=m3u8][acodec^=mp4a]/93/94/92/91/95/96";
const RESOLVE_TIMEOUT_MS = 30_000;
const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCES = 512;
const LIVE_EDGE_SEGMENTS = 24;

function safeYouTubeMediaUrl(candidate: string, base?: string): string | null {
  try {
    const url = new URL(candidate, base);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (hostname !== "googlevideo.com" && !hostname.endsWith(".googlevideo.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function directUrlExpiry(url: string): number {
  const match = url.match(/[?&]expire=(\d+)/);
  const expiresAt = match ? Number(match[1]) * 1000 : 0;
  return expiresAt > Date.now() ? expiresAt - 300_000 : Date.now() + 3 * 3_600_000;
}

function proxyHeaders(upstream: Response): Headers {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function readBoundedPlaylist(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PLAYLIST_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function createDownloadLiveAudioStreaming(dependencies: DownloadLiveAudioDependencies) {
  const {
    YTDLP,
    downloadCookiesConfigured,
    downloadCookiesFile,
    ytdlpStatus,
    fetchImpl = fetch,
    spawn = Bun.spawn,
  } = dependencies;
  const sessions = new AudioSourceCache<LiveAudioSession>();
  const resolutions = new Map<string, LiveResolution>();

  async function resolveAttempt(userId: number, videoId: string, useCookies: boolean, signal: AbortSignal): Promise<string | null> {
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--ignore-config", "--no-playlist", "--no-warnings",
      "-f", LIVE_AUDIO_FORMAT,
      "--get-url",
    ];
    if (useCookies) args.push("--cookies", downloadCookiesFile(userId));
    if (signal.aborted) return null;
    let process: ReturnType<typeof Bun.spawn>;
    try {
      process = spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
    } catch {
      return null;
    }
    const stop = () => { try { process.kill(); } catch {} };
    const onAbort = () => stop();
    signal.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(); }, RESOLVE_TIMEOUT_MS);
    try {
      const [stdout, , exitCode] = await Promise.all([
        new Response(process.stdout as ReadableStream<Uint8Array>).text(),
        new Response(process.stderr as ReadableStream<Uint8Array>).text(),
        process.exited,
      ]);
      if (signal.aborted || timedOut || exitCode !== 0) return null;
      for (const line of stdout.trim().split(/\r?\n/)) {
        const url = safeYouTubeMediaUrl(line.trim());
        if (url) return url;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  async function resolveFresh(userId: number, videoId: string, signal: AbortSignal): Promise<LiveAudioSession | null> {
    if (!(await ytdlpStatus()) || signal.aborted) return null;
    for (const useCookies of downloadCookieAttempts(downloadCookiesConfigured(userId))) {
      const playlistUrl = await resolveAttempt(userId, videoId, useCookies, signal);
      if (playlistUrl) {
        return {
          expiresAt: directUrlExpiry(playlistUrl),
          nextResourceId: 0,
          playlistUrl,
          resources: new Map(),
          tokensByUrl: new Map(),
        };
      }
      if (signal.aborted) return null;
    }
    return null;
  }

  async function sessionFor(userId: number, videoId: string): Promise<LiveAudioSession | null> {
    const cached = sessions.get(userId, videoId);
    if (cached) return cached;
    const key = audioSourceKey(userId, videoId);
    const existing = resolutions.get(key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const resolution: LiveResolution = { controller, promise: Promise.resolve(null) };
    resolution.promise = resolveFresh(userId, videoId, controller.signal)
      .then((session) => {
        if (session && !controller.signal.aborted) sessions.set(userId, videoId, session);
        return controller.signal.aborted ? null : session;
      })
      .catch(() => null)
      .finally(() => { if (resolutions.get(key) === resolution) resolutions.delete(key); });
    resolutions.set(key, resolution);
    return resolution.promise;
  }

  async function refreshSession(userId: number, videoId: string, staleUrl: string): Promise<LiveAudioSession | null> {
    const current = sessions.get(userId, videoId);
    if (current?.playlistUrl !== staleUrl) return current ?? sessionFor(userId, videoId);
    sessions.delete(userId, videoId);
    return sessionFor(userId, videoId);
  }

  function resourceToken(session: LiveAudioSession, url: string): string {
    const existing = session.tokensByUrl.get(url);
    if (existing) return existing;
    const token = `r${session.nextResourceId++}`;
    session.resources.set(token, url);
    session.tokensByUrl.set(url, token);
    while (session.resources.size > MAX_RESOURCES) {
      const oldest = session.resources.entries().next().value as [string, string] | undefined;
      if (!oldest) break;
      session.resources.delete(oldest[0]);
      session.tokensByUrl.delete(oldest[1]);
    }
    return token;
  }

  function rewritePlaylist(session: LiveAudioSession, source: string): string | null {
    return rewriteLiveAudioPlaylist(source, LIVE_EDGE_SEGMENTS, (candidate) => {
      const url = safeYouTubeMediaUrl(candidate, session.playlistUrl);
      return url ? resourceToken(session, url) : null;
    });
  }

  async function fetchPlaylist(session: LiveAudioSession, signal?: AbortSignal): Promise<Response | null> {
    return fetchImpl(session.playlistUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "manual",
      signal,
    }).catch(() => null);
  }

  async function getLiveAudioPlaylist(userId: number, videoId: string, signal?: AbortSignal): Promise<string | null> {
    let session = await sessionFor(userId, videoId);
    if (!session || signal?.aborted) return null;
    let upstream = await fetchPlaylist(session, signal);
    if (upstream && (upstream.status === 403 || upstream.status === 404 || upstream.status === 410)) {
      await upstream.body?.cancel().catch(() => {});
      session = await refreshSession(userId, videoId, session.playlistUrl);
      if (!session || signal?.aborted) return null;
      upstream = await fetchPlaylist(session, signal);
    }
    if (!upstream || upstream.status !== 200) {
      await upstream?.body?.cancel().catch(() => {});
      return null;
    }
    const length = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_PLAYLIST_BYTES) {
      await upstream.body?.cancel().catch(() => {});
      return null;
    }
    const source = await readBoundedPlaylist(upstream);
    return source ? rewritePlaylist(session, source) : null;
  }

  async function getLiveAudioResource(
    userId: number,
    videoId: string,
    token: string,
    range: string | null,
    signal?: AbortSignal,
  ): Promise<Response | null> {
    if (!/^r\d+$/.test(token)) return null;
    const session = await sessionFor(userId, videoId);
    const url = session?.resources.get(token);
    if (!url || signal?.aborted) return null;
    const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0" };
    if (range) headers.Range = range;
    const upstream = await fetchImpl(url, { headers, redirect: "manual", signal }).catch(() => null);
    if (!upstream || (upstream.status !== 200 && upstream.status !== 206) || !upstream.body) {
      await upstream?.body?.cancel().catch(() => {});
      return null;
    }
    return new Response(upstream.body, { status: upstream.status, headers: proxyHeaders(upstream) });
  }

  function invalidateLiveAudioSources(userId: number): void {
    sessions.invalidateUser(userId);
    const prefix = `${userId}:`;
    for (const [key, resolution] of resolutions) {
      if (!key.startsWith(prefix)) continue;
      resolutions.delete(key);
      resolution.controller.abort();
    }
  }

  return { getLiveAudioPlaylist, getLiveAudioResource, invalidateLiveAudioSources };
}
