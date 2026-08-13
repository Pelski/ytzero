import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { database } from "./database";
import { log } from "./logger";
import { safeGoogleVideoUrl } from "./audioUpstreamUrl";
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
  spawn?: typeof Bun.spawn;
  videoAvailable?: (videoId: string) => Promise<boolean>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  segmentWaitMs?: number;
  regionStallMs?: number;
  probeTimeoutMs?: number;
}

const SEG_SECONDS = 6;
const REGION_SEGMENTS = 20;
const HLS_IDLE_MS = 120_000;
const DEFAULT_SEGMENT_WAIT_MS = 25_000;
const DEFAULT_REGION_STALL_MS = 12_000;
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const SOURCE_EXPIRY_MARGIN_MS = 60_000;
const MAX_REGION_STARTS = 3;
const MAX_SOURCE_REFRESHES = 2;
const SEGMENT_RE = /^seg(\d{5})\.ts$/;

interface SourceProbe {
  durationSec: number;
  fps: number;
  videoUrl: string;
  audioUrl: string | null;
  expiresAt: number | null;
}

interface HlsRegion {
  proc: ReturnType<typeof Bun.spawn>;
  startIndex: number;
  exited: boolean;
  exitCode: number | null;
  cancelled: boolean;
  lastProgressAt: number;
  progressSignature: string;
  stderrTail: string[];
}

interface SharedOperation<T> {
  controller: AbortController;
  promise: Promise<T>;
  waiters: number;
  settled: boolean;
}

interface HlsSession extends SourceProbe {
  userId: number;
  videoId: string;
  dir: string;
  segCount: number;
  playlist: string;
  region: HlsRegion | null;
  lastAccess: number;
  refresh: SharedOperation<boolean> | null;
}

function redactMediaDiagnostic(line: string): string {
  return line
    .replace(/https?:\/\/\S+/gi, "<redacted-url>")
    .replace(/\b(?:sig|signature|token|lsig|expire)=\S+/gi, (value) => `${value.split("=")[0]}=<redacted>`)
    .slice(0, 400);
}

function sourceExpiry(urls: Array<string | null>): number | null {
  const expiries = urls.flatMap((candidate) => {
    if (!candidate) return [];
    try {
      const seconds = Number(new URL(candidate).searchParams.get("expire"));
      return Number.isFinite(seconds) && seconds > 0 ? [seconds * 1000] : [];
    } catch {
      return [];
    }
  });
  return expiries.length ? Math.min(...expiries) : null;
}

function buildVodPlaylist(durationSec: number, segCount: number): string {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${SEG_SECONDS}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
  ];
  for (let index = 0; index < segCount; index += 1) {
    const duration = index === segCount - 1 ? durationSec - (segCount - 1) * SEG_SECONDS : SEG_SECONDS;
    lines.push(`#EXTINF:${(duration > 0 ? duration : SEG_SECONDS).toFixed(6)},`);
    lines.push(`seg${String(index).padStart(5, "0")}.ts`);
  }
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}

export function createDownloadVideoTranscodeStreaming(dependencies: DownloadVideoStreamingDependencies) {
  const {
    DOWNLOADS_DIR,
    YTDLP,
    dlEnabled,
    dlSettings,
    downloadCookiesConfigured,
    downloadCookiesFile,
    prioritizeDownload,
    readLines,
    ytdlpStatus,
    spawn = Bun.spawn,
    videoAvailable = async (videoId) => Boolean(await database.prepare(
      "SELECT 1 FROM videos WHERE video_id = ? AND is_private = 0 AND is_unavailable = 0",
    ).get(videoId)),
    now = Date.now,
    wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
    segmentWaitMs = DEFAULT_SEGMENT_WAIT_MS,
    regionStallMs = DEFAULT_REGION_STALL_MS,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  } = dependencies;
  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  const hlsDir = resolve(DOWNLOADS_DIR, "..", "hls-stream");
  const sessions = new Map<string, HlsSession>();
  const creations = new Map<string, SharedOperation<HlsSession | null>>();
  let sweeper: ReturnType<typeof setInterval> | null = null;

  const sessionKey = (userId: number, videoId: string) => `${userId}:${videoId}`;
  const sessionDir = (userId: number, videoId: string) => join(
    hlsDir,
    String(userId),
    videoId.replace(/[^A-Za-z0-9_-]/g, "_"),
  );

  async function liveStreamEnabled(userId?: number): Promise<boolean> {
    return await dlEnabled(userId) && (await dlSettings(userId)).experimental_streaming === 1;
  }

  function isSegmentName(name: string): boolean {
    return SEGMENT_RE.test(name);
  }

  async function streamFormat(userId: number): Promise<string> {
    const settings = await dlSettings(userId);
    const height = settings.quality === "best" ? null : Number(settings.quality);
    const cap = height ? `[height<=${height}]` : "";
    return `bestvideo*[vcodec^=avc1]${cap}+bestaudio[acodec^=mp4a]/best[vcodec^=avc1]${cap}/best${cap}`;
  }

  async function probeSource(userId: number, videoId: string, signal?: AbortSignal): Promise<SourceProbe | null> {
    if (signal?.aborted) return null;
    const startedAt = now();
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--ignore-config", "--no-playlist", "--no-warnings",
      "-f", await streamFormat(userId),
      "--print", "%(duration)s",
      "--print", "%(fps)s",
      "--print", "urls",
    ];
    if (downloadCookiesConfigured(userId)) args.push("--cookies", downloadCookiesFile(userId));
    if (signal?.aborted) return null;
    try {
      const proc = spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
      const completion = Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]).then(([output, stderr, exitCode]) => ({ kind: "complete" as const, output, stderr, exitCode }))
        .catch(() => ({ kind: "io_failed" as const }));
      let resolveInterruption!: (result: { kind: "aborted" } | { kind: "timeout" }) => void;
      const interrupted = new Promise<{ kind: "aborted" } | { kind: "timeout" }>((resolveInterrupt) => {
        resolveInterruption = resolveInterrupt;
      });
      const interrupt = (reason: "aborted" | "timeout") => {
        resolveInterruption(reason === "aborted" ? { kind: "aborted" } : { kind: "timeout" });
      };
      const onAbort = () => interrupt("aborted");
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) interrupt("aborted");
      const timer = setTimeout(() => interrupt("timeout"), probeTimeoutMs);
      const result = await Promise.race([completion, interrupted]);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (result.kind === "aborted" || result.kind === "timeout") {
        try { proc.kill(); } catch {}
        if (result.kind === "timeout") log.warn("downloads.stream_probe_failed", {
          userId, videoId, reason: "timeout", ms: now() - startedAt,
        });
        return null;
      }
      if (result.kind === "io_failed") {
        log.warn("downloads.stream_probe_failed", {
          userId, videoId, reason: "process_io_failed", ms: now() - startedAt,
        });
        return null;
      }
      const { output, stderr, exitCode } = result;
      if (exitCode !== 0) {
        log.warn("downloads.stream_probe_failed", {
          userId,
          videoId,
          exitCode,
          ms: now() - startedAt,
          stderr: stderr.split(/\r?\n/).filter(Boolean).slice(-3).map(redactMediaDiagnostic),
        });
        return null;
      }
      const lines = output.trim().split(/\r?\n/).filter(Boolean);
      const durationSec = Math.floor(Number(lines[0]));
      const fps = Math.max(1, Math.round(Number(lines[1]) || 30));
      const urls = lines.slice(2);
      if (!Number.isFinite(durationSec) || durationSec <= 0 || urls.length === 0) return null;
      const videoUrl = safeGoogleVideoUrl(urls[0]);
      const audioUrl = urls[1] == null ? null : safeGoogleVideoUrl(urls[1]);
      if (!videoUrl || (urls[1] != null && !audioUrl)) {
        log.warn("downloads.stream_probe_failed", {
          userId, videoId, reason: "unsafe_media_url", ms: now() - startedAt,
        });
        return null;
      }
      return { durationSec, fps, videoUrl, audioUrl, expiresAt: sourceExpiry([videoUrl, audioUrl]) };
    } catch (error) {
      log.warn("downloads.stream_probe_failed", {
        userId,
        videoId,
        reason: "spawn_failed",
        ms: now() - startedAt,
        error: error instanceof Error ? redactMediaDiagnostic(error.message) : "unknown",
      });
      return null;
    }
  }

  function killRegion(session: HlsSession): void {
    if (!session.region) return;
    session.region.cancelled = true;
    try { session.region.proc.kill(); } catch {}
    session.region.exited = true;
    session.region = null;
  }

  function regionProgressSignature(session: HlsSession, startIndex: number): string {
    const markers: string[] = [];
    const end = Math.min(session.segCount, startIndex + REGION_SEGMENTS);
    for (let index = startIndex; index < end; index += 1) {
      const base = join(session.dir, `seg${String(index).padStart(5, "0")}.ts`);
      for (const candidate of [base, `${base}.tmp`]) {
        try {
          const stat = statSync(candidate);
          markers.push(`${index}:${candidate.endsWith(".tmp") ? "tmp" : "done"}:${stat.size}:${stat.mtimeMs}`);
        } catch {}
      }
    }
    return markers.join("|");
  }

  function spawnRegion(session: HlsSession, startIndex: number): HlsRegion | null {
    killRegion(session);
    const start = startIndex * SEG_SECONDS;
    const fast = Math.max(0, start - 4);
    const accurate = start - fast;
    const windowDuration = Math.min(REGION_SEGMENTS * SEG_SECONDS, session.durationSec - start) + 1;
    const args = [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-protocol_whitelist", "file,https,tcp,tls",
      "-protocol_blacklist", "concat,crypto,data,ftp,gopher,http,httpproxy,icecast,md5,rtmp,sftp,subfile,udp,unix",
    ];
    args.push("-ss", String(fast), "-i", session.videoUrl);
    if (session.audioUrl) args.push("-ss", String(fast), "-i", session.audioUrl);
    if (accurate > 0) args.push("-ss", String(accurate));
    args.push("-t", String(windowDuration));
    args.push("-map", "0:v:0", "-map", session.audioUrl ? "1:a:0" : "0:a:0?");
    args.push("-r", String(session.fps), "-vsync", "cfr", "-sc_threshold", "0");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p");
    args.push("-force_key_frames", `expr:gte(t,n_forced*${SEG_SECONDS})`);
    args.push("-c:a", "aac", "-ac", "2");
    args.push("-output_ts_offset", String(start), "-muxdelay", "0", "-muxpreload", "0");
    args.push(
      "-f", "hls",
      "-hls_time", String(SEG_SECONDS),
      "-hls_list_size", "0",
      "-hls_flags", "independent_segments+omit_endlist+temp_file",
      "-hls_segment_type", "mpegts",
      "-start_number", String(startIndex),
      "-hls_segment_filename", join(session.dir, "seg%05d.ts"),
      join(session.dir, "_region.m3u8"),
    );
    try {
      const proc = spawn([ffmpeg, ...args], { stdout: "ignore", stderr: "pipe" });
      const region: HlsRegion = {
        proc,
        startIndex,
        exited: false,
        exitCode: null,
        cancelled: false,
        lastProgressAt: now(),
        progressSignature: regionProgressSignature(session, startIndex),
        stderrTail: [],
      };
      session.region = region;
      void readLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
        region.stderrTail.push(redactMediaDiagnostic(line));
        if (region.stderrTail.length > 3) region.stderrTail.shift();
      }).catch(() => {});
      void proc.exited.then((exitCode) => {
        region.exitCode = exitCode;
        region.exited = true;
      }).catch(() => {
        region.exitCode = -1;
        region.exited = true;
      });
      return region;
    } catch (error) {
      log.warn("downloads.stream_region_failed", {
        userId: session.userId,
        videoId: session.videoId,
        startIndex,
        reason: "spawn_failed",
        error: error instanceof Error ? redactMediaDiagnostic(error.message) : "unknown",
      });
      return null;
    }
  }

  function waitForOperation<T>(
    operation: SharedOperation<T>,
    signal: AbortSignal | undefined,
    abortedValue: T,
    onLastWaiter: () => void,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(abortedValue);
    operation.waiters += 1;
    return new Promise((resolveOperation) => {
      let finished = false;
      const finish = (value: T) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        operation.waiters = Math.max(0, operation.waiters - 1);
        if (operation.waiters === 0 && !operation.settled) onLastWaiter();
        resolveOperation(value);
      };
      const onAbort = () => finish(abortedValue);
      signal?.addEventListener("abort", onAbort, { once: true });
      operation.promise.then(finish, () => finish(abortedValue));
    });
  }

  async function refreshSources(session: HlsSession, reason: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    let operation = session.refresh;
    if (!operation) {
      const controller = new AbortController();
      operation = { controller, promise: Promise.resolve(false), waiters: 0, settled: false };
      const current = operation;
      const previousVideoUrl = session.videoUrl;
      current.promise = probeSource(session.userId, session.videoId, controller.signal)
        .then((probe) => {
          if (!probe || controller.signal.aborted) return false;
          session.videoUrl = probe.videoUrl;
          session.audioUrl = probe.audioUrl;
          session.fps = probe.fps;
          session.expiresAt = probe.expiresAt;
          log.info("downloads.stream_source_refreshed", {
            userId: session.userId,
            videoId: session.videoId,
            reason,
            changed: previousVideoUrl !== probe.videoUrl,
          });
          return true;
        })
        .catch(() => false)
        .finally(() => {
          current.settled = true;
          if (session.refresh === current) session.refresh = null;
        });
      session.refresh = current;
    }
    const current = operation;
    return waitForOperation(current, signal, false, () => {
      if (session.refresh === current) session.refresh = null;
      current.controller.abort();
    });
  }

  function destroyByKey(key: string): void {
    const session = sessions.get(key);
    if (!session) return;
    sessions.delete(key);
    session.refresh?.controller.abort();
    session.refresh = null;
    killRegion(session);
    try { rmSync(session.dir, { recursive: true, force: true }); } catch {}
  }

  /** Preserves the old one-argument API by clearing every profile's session. */
  function destroyHlsSession(videoId: string, userId?: number): void {
    if (userId != null) {
      const key = sessionKey(userId, videoId);
      const creation = creations.get(key);
      if (creation) {
        creations.delete(key);
        creation.controller.abort();
      }
      destroyByKey(key);
      return;
    }
    for (const [key, creation] of creations) {
      if (key.endsWith(`:${videoId}`)) {
        creations.delete(key);
        creation.controller.abort();
      }
    }
    for (const [key, session] of sessions) {
      if (session.videoId === videoId) destroyByKey(key);
    }
  }

  function sweepSessions(): void {
    const currentTime = now();
    for (const [key, session] of sessions) {
      if (currentTime - session.lastAccess > HLS_IDLE_MS) destroyByKey(key);
    }
  }

  async function createSession(userId: number, videoId: string, signal: AbortSignal): Promise<HlsSession | null> {
    if (!(await ytdlpStatus()) || signal.aborted || !await videoAvailable(videoId)) return null;
    const probe = await probeSource(userId, videoId, signal);
    if (!probe || signal.aborted) return null;
    const key = sessionKey(userId, videoId);
    const segCount = Math.max(1, Math.ceil(probe.durationSec / SEG_SECONDS));
    const dir = sessionDir(userId, videoId);
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    mkdirSync(dir, { recursive: true });
    const session: HlsSession = {
      ...probe,
      userId,
      videoId,
      dir,
      segCount,
      playlist: buildVodPlaylist(probe.durationSec, segCount),
      region: null,
      lastAccess: now(),
      refresh: null,
    };
    try {
      await prioritizeDownload(userId, videoId);
    } catch (error) {
      log.warn("downloads.stream_start_failed", {
        userId,
        videoId,
        reason: "download_priority_failed",
        error: error instanceof Error ? redactMediaDiagnostic(error.message) : "unknown",
      });
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      return null;
    }
    if (signal.aborted) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      return null;
    }
    sessions.set(key, session);
    if (!sweeper) {
      sweeper = setInterval(sweepSessions, 30_000);
      sweeper.unref?.();
    }
    log.info("downloads.stream_start", {
      userId,
      videoId,
      durationSec: probe.durationSec,
      segCount,
      fps: probe.fps,
    });
    return session;
  }

  async function getHlsPlaylist(userId: number, videoId: string, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return null;
    const key = sessionKey(userId, videoId);
    const existing = sessions.get(key);
    if (existing) {
      existing.lastAccess = now();
      return existing.playlist;
    }
    let operation = creations.get(key);
    if (!operation) {
      const controller = new AbortController();
      operation = { controller, promise: Promise.resolve(null), waiters: 0, settled: false };
      const current = operation;
      current.promise = createSession(userId, videoId, controller.signal)
        .catch(() => null)
        .finally(() => {
          current.settled = true;
          if (creations.get(key) === current) creations.delete(key);
        });
      creations.set(key, current);
    }
    const current = operation;
    const session = await waitForOperation(current, signal, null, () => {
      if (creations.get(key) === current) creations.delete(key);
      current.controller.abort();
    });
    return session?.playlist ?? null;
  }

  async function getHlsSegment(
    userId: number,
    videoId: string,
    file: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const session = sessions.get(sessionKey(userId, videoId));
    if (!session) return null;
    session.lastAccess = now();
    const match = file.match(SEGMENT_RE);
    if (!match) return null;
    const index = Number(match[1]);
    if (index < 0 || index >= session.segCount) return null;
    const path = join(session.dir, file);
    if (existsSync(path)) return path;

    let starts = 0;
    let refreshes = 0;
    let handledRegion: HlsRegion | null = null;
    const deadline = now() + segmentWaitMs;
    while (now() < deadline) {
      if (signal?.aborted) return null;
      if (existsSync(path)) return path;
      const region = session.region;
      const coversIndex = Boolean(
        region && index >= region.startIndex && index < region.startIndex + REGION_SEGMENTS,
      );
      if (region && coversIndex && !region.exited) {
        const progressSignature = regionProgressSignature(session, region.startIndex);
        if (progressSignature !== region.progressSignature) {
          region.progressSignature = progressSignature;
          region.lastProgressAt = now();
        }
        if (now() - region.lastProgressAt < regionStallMs) {
          await wait(150);
          continue;
        }
        log.warn("downloads.stream_region_stalled", {
          userId,
          videoId,
          startIndex: region.startIndex,
          requestedIndex: index,
          stalledMs: now() - region.lastProgressAt,
        });
        killRegion(session);
        if (refreshes < MAX_SOURCE_REFRESHES) {
          refreshes += 1;
          await refreshSources(session, "region_stalled", signal);
        }
      } else if (region?.exited && coversIndex && region !== handledRegion) {
        handledRegion = region;
        log.warn("downloads.stream_region_failed", {
          userId,
          videoId,
          startIndex: region.startIndex,
          requestedIndex: index,
          exitCode: region.exitCode,
          stderr: region.stderrTail,
        });
        if (refreshes < MAX_SOURCE_REFRESHES) {
          refreshes += 1;
          await refreshSources(session, "region_failed", signal);
        }
      }
      if (signal?.aborted) return null;
      if (starts >= MAX_REGION_STARTS) break;
      if (session.expiresAt != null && session.expiresAt <= now() + SOURCE_EXPIRY_MARGIN_MS
        && refreshes < MAX_SOURCE_REFRESHES) {
        refreshes += 1;
        await refreshSources(session, "source_expiring", signal);
      }
      if (spawnRegion(session, index)) starts += 1;
      else {
        starts += 1;
        if (refreshes < MAX_SOURCE_REFRESHES) {
          refreshes += 1;
          await refreshSources(session, "region_spawn_failed", signal);
        }
      }
      await wait(150);
    }
    if (existsSync(path)) return path;
    log.warn("downloads.stream_segment_unavailable", {
      userId,
      videoId,
      index,
      starts,
      refreshes,
      aborted: Boolean(signal?.aborted),
    });
    return null;
  }

  function resetHlsScratch(): void {
    for (const operation of creations.values()) operation.controller.abort();
    creations.clear();
    for (const key of [...sessions.keys()]) destroyByKey(key);
    if (sweeper) clearInterval(sweeper);
    sweeper = null;
    try { rmSync(hlsDir, { recursive: true, force: true }); } catch {}
  }

  return {
    destroyHlsSession,
    getHlsPlaylist,
    getHlsSegment,
    isSegmentName,
    liveStreamEnabled,
    resetHlsScratch,
  };
}
