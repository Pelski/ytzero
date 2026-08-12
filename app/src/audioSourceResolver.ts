import { AudioSourceCache, audioSourceKey } from "./audioSourceCache";
import { downloadCookieAttempts } from "./downloadStrategy";

export interface AudioSource {
  url: string;
  mime: string;
  expiresAt: number;
}

interface AudioResolution {
  controller: AbortController;
  promise: Promise<AudioSource | null>;
  waiters: number;
  settled: boolean;
}

interface AudioSourceResolverDependencies {
  YTDLP: string;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  ytdlpStatus: () => Promise<string | null>;
  spawn?: typeof Bun.spawn;
}

const AUDIO_RESOLVE_TIMEOUT_MS = 30_000;

export function createAudioSourceResolver(dependencies: AudioSourceResolverDependencies) {
  const { YTDLP, downloadCookiesConfigured, downloadCookiesFile, ytdlpStatus, spawn = Bun.spawn } = dependencies;
  const audioSources = new AudioSourceCache<AudioSource>();
  const audioResolutions = new Map<string, AudioResolution>();

  function audioUrlExpiry(url: string): number {
    const match = url.match(/[?&]expire=(\d+)/);
    const expiresAt = match ? Number(match[1]) * 1000 : 0;
    return expiresAt ? Math.max(Date.now(), expiresAt - 300_000) : Date.now() + 3 * 3_600_000;
  }

  function safeDirectAudioUrl(candidate: string): string | null {
    try {
      const url = new URL(candidate);
      const hostname = url.hostname.toLowerCase();
      if (url.protocol !== "https:") return null;
      if (hostname !== "googlevideo.com" && !hostname.endsWith(".googlevideo.com")) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  async function runResolverAttempt(
    userId: number,
    videoId: string,
    useCookies: boolean,
    signal: AbortSignal,
  ): Promise<AudioSource | null> {
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--ignore-config", "--no-playlist", "--no-warnings",
      "-f", "bestaudio[acodec^=mp4a]/bestaudio[ext=m4a]/140",
      "--print", "urls",
      "--print", "%(ext)s",
    ];
    if (useCookies) args.push("--cookies", downloadCookiesFile(userId));
    if (signal.aborted) return null;

    let process: ReturnType<typeof Bun.spawn>;
    try {
      process = spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
    } catch {
      return null;
    }

    let timedOut = false;
    const stop = () => { try { process.kill(); } catch {} };
    const onAbort = () => stop();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, AUDIO_RESOLVE_TIMEOUT_MS);
    try {
      const [stdout, , exitCode] = await Promise.all([
        new Response(process.stdout as ReadableStream<Uint8Array>).text(),
        new Response(process.stderr as ReadableStream<Uint8Array>).text(),
        process.exited,
      ]);
      if (signal.aborted || timedOut || exitCode !== 0) return null;
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const url = safeDirectAudioUrl(lines[0] ?? "");
      const extension = lines[1] ?? "m4a";
      if (!url || (extension !== "m4a" && extension !== "mp4")) return null;
      return { url, mime: "audio/mp4", expiresAt: audioUrlExpiry(url) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  async function resolveFresh(userId: number, videoId: string, signal: AbortSignal): Promise<AudioSource | null> {
    if (!(await ytdlpStatus()) || signal.aborted) return null;
    for (const useCookies of downloadCookieAttempts(downloadCookiesConfigured(userId))) {
      const source = await runResolverAttempt(userId, videoId, useCookies, signal);
      if (source || signal.aborted) return source;
    }
    return null;
  }

  function release(key: string, resolution: AudioResolution): void {
    resolution.waiters = Math.max(0, resolution.waiters - 1);
    if (resolution.waiters === 0 && !resolution.settled && audioResolutions.get(key) === resolution) {
      audioResolutions.delete(key);
      resolution.controller.abort();
    }
  }

  function waitFor(key: string, resolution: AudioResolution, signal?: AbortSignal): Promise<AudioSource | null> {
    if (signal?.aborted) return Promise.resolve(null);
    resolution.waiters++;
    return new Promise((resolve) => {
      let finished = false;
      const finish = (source: AudioSource | null) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        release(key, resolution);
        resolve(source);
      };
      const onAbort = () => finish(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      resolution.promise.then(finish, () => finish(null));
    });
  }

  async function resolveAudioSource(userId: number, videoId: string, signal?: AbortSignal): Promise<AudioSource | null> {
    if (signal?.aborted) return null;
    const cached = audioSources.get(userId, videoId);
    if (cached) return cached;
    const key = audioSourceKey(userId, videoId);
    let resolution = audioResolutions.get(key);
    if (!resolution) {
      const controller = new AbortController();
      resolution = { controller, promise: Promise.resolve(null), waiters: 0, settled: false };
      const current = resolution;
      current.promise = resolveFresh(userId, videoId, controller.signal)
        .then((source) => {
          if (source && !controller.signal.aborted) audioSources.set(userId, videoId, source);
          return controller.signal.aborted ? null : source;
        })
        .catch(() => null)
        .finally(() => {
          current.settled = true;
          if (audioResolutions.get(key) === current) audioResolutions.delete(key);
        });
      audioResolutions.set(key, current);
    }
    return waitFor(key, resolution, signal);
  }

  async function refreshAudioSource(
    userId: number,
    videoId: string,
    staleUrl: string,
    signal?: AbortSignal,
  ): Promise<AudioSource | null> {
    const current = audioSources.get(userId, videoId);
    if (current?.url !== staleUrl) return current ?? resolveAudioSource(userId, videoId, signal);
    audioSources.delete(userId, videoId);
    return resolveAudioSource(userId, videoId, signal);
  }

  function invalidateAudioSources(userId: number): void {
    audioSources.invalidateUser(userId);
    const prefix = `${userId}:`;
    for (const [key, resolution] of audioResolutions) {
      if (!key.startsWith(prefix)) continue;
      audioResolutions.delete(key);
      resolution.controller.abort();
    }
  }

  return { invalidateAudioSources, refreshAudioSource, resolveAudioSource };
}
