import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { database } from "./database";
import { createDownloadAudioStreaming } from "./downloadAudioStreaming";
import { createDownloadLiveAudioStreaming } from "./downloadLiveAudioStreaming";
import { createAudioStreamingControls } from "./audioStreamingControls";
import { log } from "./logger";
import type { DlSettings } from "./downloader";
interface DownloadStreamingDependencies {
  DOWNLOADS_DIR: string;
  YTDLP: string;
  dlEnabled: (userId?: number) => Promise<boolean>;
  dlSettings: (userId?: number) => Promise<DlSettings>;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  prioritizeDownload: (userId: number, videoId: string) => Promise<boolean>;
  readLines: (stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) => Promise<void>;
  ytdlpStatus: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
}
export function createDownloadStreaming(dependencies: DownloadStreamingDependencies) {
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
  } = dependencies;

// Experimental seek-anywhere HLS with segments transcoded on demand.

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
// HLS scratch lives OUTSIDE the downloads dir so retention/orphan cleanup
// (which walks DOWNLOADS_DIR) never touches transcoded segments.
const HLS_DIR = resolve(DOWNLOADS_DIR, "..", "hls-stream");
const SEG_SECONDS = 6;              // fixed grid segment length
const REGION_SEGMENTS = 20;         // how far ahead one ffmpeg region transcodes (~120s)
const HLS_IDLE_MS = 120_000;
const SEGMENT_WAIT_MS = 25_000;
const SEGMENT_RE = /^seg(\d{5})\.ts$/;

interface HlsRegion {
  proc: ReturnType<typeof Bun.spawn>;
  startIndex: number;
  exited: boolean;
}

interface HlsSession {
  videoId: string;
  dir: string;
  durationSec: number;
  segCount: number;
  fps: number;
  videoUrl: string;
  audioUrl: string | null;
  playlist: string;
  region: HlsRegion | null;
  lastAccess: number;
}

const hlsSessions = new Map<string, HlsSession>();
let hlsSweeper: ReturnType<typeof setInterval> | null = null;

async function liveStreamEnabled(userId?: number): Promise<boolean> {
  return await dlEnabled(userId) && (await dlSettings(userId)).experimental_streaming === 1;
}

function isSegmentName(name: string): boolean {
  return SEGMENT_RE.test(name);
}

function hlsSessionDir(videoId: string): string {
  return join(HLS_DIR, videoId.replace(/[^A-Za-z0-9_-]/g, "_"));
}

async function streamFormat(userId: number): Promise<string> {
  const s = await dlSettings(userId);
  const height = s.quality === "best" ? null : Number(s.quality);
  // H.264 + AAC keeps the on-demand transcode a cheap H.264->H.264 re-encode.
  const cap = height ? `[height<=${height}]` : "";
  return `bestvideo*[vcodec^=avc1]${cap}+bestaudio[acodec^=mp4a]/best[vcodec^=avc1]${cap}/best${cap}`;
}

/** One yt-dlp call: total duration, source fps and the direct stream URL(s). */
async function probeSource(userId: number, videoId: string): Promise<{ durationSec: number; fps: number; videoUrl: string; audioUrl: string | null } | null> {
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--no-playlist", "--no-warnings",
    "-f", await streamFormat(userId),
    "--print", "%(duration)s",
    "--print", "%(fps)s",
    "--print", "urls",
  ];
  if (downloadCookiesConfigured(userId)) args.push("--cookies", downloadCookiesFile(userId));
  try {
    const proc = spawn([YTDLP, ...args], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    const lines = out.trim().split(/\r?\n/).filter(Boolean);
    const durationSec = Math.floor(Number(lines[0]));
    const fps = Math.max(1, Math.round(Number(lines[1]) || 30));
    const urls = lines.slice(2);
    if (!Number.isFinite(durationSec) || durationSec <= 0 || urls.length === 0) return null;
    return { durationSec, fps, videoUrl: urls[0], audioUrl: urls[1] ?? null };
  } catch {
    return null;
  }
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
  for (let i = 0; i < segCount; i++) {
    const dur = i === segCount - 1 ? durationSec - (segCount - 1) * SEG_SECONDS : SEG_SECONDS;
    lines.push(`#EXTINF:${(dur > 0 ? dur : SEG_SECONDS).toFixed(6)},`);
    lines.push(`seg${String(i).padStart(5, "0")}.ts`);
  }
  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

function killRegion(session: HlsSession) {
  if (session.region) {
    try { session.region.proc.kill(); } catch {}
    session.region.exited = true;
    session.region = null;
  }
}

/** Start transcoding a window of segments forward from segment `startIndex`. */
function spawnRegion(session: HlsSession, startIndex: number) {
  killRegion(session);
  const start = startIndex * SEG_SECONDS;
  // Two-stage seek: fast (keyframe) input seek near the target, then an accurate
  // output seek for the remainder, so the region starts exactly on the grid.
  const fast = Math.max(0, start - 4);
  const acc = start - fast;
  const windowDur = Math.min(REGION_SEGMENTS * SEG_SECONDS, session.durationSec - start) + 1;

  const args = ["-nostdin", "-hide_banner", "-loglevel", "error"];
  args.push("-ss", String(fast), "-i", session.videoUrl);
  if (session.audioUrl) args.push("-ss", String(fast), "-i", session.audioUrl);
  if (acc > 0) args.push("-ss", String(acc));
  args.push("-t", String(windowDur));
  args.push("-map", "0:v:0", "-map", session.audioUrl ? "1:a:0" : "0:a:0?");
  // Constant frame rate + a forced keyframe on every grid boundary makes each
  // segment exactly SEG_SECONDS long, so the pre-built playlist's timings match
  // and there is no A/V drift across segments.
  args.push("-r", String(session.fps), "-vsync", "cfr", "-sc_threshold", "0");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p");
  args.push("-force_key_frames", `expr:gte(t,n_forced*${SEG_SECONDS})`);
  args.push("-c:a", "aac", "-ac", "2");
  // Absolute output timestamps so every region shares ONE continuous timeline
  // (segment N starts at N*SEG). Without this each region restarts at PTS 0 and
  // collides with earlier segments, which corrupts the player's timeline.
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

  const proc = spawn([FFMPEG, ...args], { stdout: "ignore", stderr: "pipe" });
  const region: HlsRegion = { proc, startIndex, exited: false };
  session.region = region;
  readLines(proc.stderr as ReadableStream<Uint8Array>, () => {}).catch(() => {});
  void proc.exited.then(() => { region.exited = true; });
}

function destroyHlsSession(videoId: string) {
  const session = hlsSessions.get(videoId);
  if (!session) return;
  hlsSessions.delete(videoId);
  killRegion(session);
  try { rmSync(session.dir, { recursive: true, force: true }); } catch {}
}

function sweepHlsSessions() {
  const now = Date.now();
  for (const [videoId, session] of hlsSessions) {
    if (now - session.lastAccess > HLS_IDLE_MS) destroyHlsSession(videoId);
  }
}

/**
 * Create (or reuse) a seek-anywhere streaming session and return its static VOD
 * playlist. Null when yt-dlp/ffmpeg can't resolve the video. Also enqueues a
 * clean background copy download so the next visit plays the local file.
 */
async function getHlsPlaylist(userId: number, videoId: string): Promise<string | null> {
  const existing = hlsSessions.get(videoId);
  if (existing) { existing.lastAccess = Date.now(); return existing.playlist; }
  if (!(await ytdlpStatus())) return null;
  if (!await database.prepare("SELECT 1 FROM videos WHERE video_id = ? AND is_private = 0").get(videoId)) return null;

  const probe = await probeSource(userId, videoId);
  if (!probe) return null;

  // A second concurrent request may have created the session while we probed.
  const raced = hlsSessions.get(videoId);
  if (raced) { raced.lastAccess = Date.now(); return raced.playlist; }

  const segCount = Math.max(1, Math.ceil(probe.durationSec / SEG_SECONDS));
  const dir = hlsSessionDir(videoId);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  mkdirSync(dir, { recursive: true });

  const session: HlsSession = {
    videoId, dir,
    durationSec: probe.durationSec,
    segCount,
    fps: probe.fps,
    videoUrl: probe.videoUrl,
    audioUrl: probe.audioUrl,
    playlist: buildVodPlaylist(probe.durationSec, segCount),
    region: null,
    lastAccess: Date.now(),
  };
  hlsSessions.set(videoId, session);
  if (!hlsSweeper) hlsSweeper = setInterval(sweepHlsSessions, 30_000);

  // Kick off the clean full download at top priority and start it immediately
  // (not on the next 30s tick). yt-dlp's chunked range download defeats
  // YouTube's per-connection throttling, so the whole file lands in seconds —
  // the moment it's done the player switches to the local, natively seekable
  // file. Until then the on-demand transcode covers playback.
  await prioritizeDownload(userId, videoId);

  log.info("downloads.stream_start", { videoId, durationSec: probe.durationSec, segCount, fps: probe.fps });
  return session.playlist;
}

/** Serve a segment, transcoding it on demand (waiting for the region to reach it). */
async function getHlsSegment(videoId: string, file: string, signal?: AbortSignal): Promise<string | null> {
  const session = hlsSessions.get(videoId);
  if (!session) return null;
  session.lastAccess = Date.now();
  const m = file.match(SEGMENT_RE);
  if (!m) return null;
  const index = Number(m[1]);
  if (index < 0 || index >= session.segCount) return null;

  const path = join(session.dir, file);
  if (existsSync(path)) return path;

  // A region starts exactly at the requested segment (so a seek produces that
  // segment first, not after grinding from a block boundary) and transcodes
  // forward for REGION_SEGMENTS. Contiguous requests fall inside that window and
  // reuse it; only a real jump outside it repositions the transcoder. Aborted
  // requests (a seek dropping its stale read-ahead) bail without respawning, so
  // concurrent segment fetches never thrash the single transcoder.
  let spawns = 0;
  const deadline = Date.now() + SEGMENT_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) return null;
    if (existsSync(path)) return path;
    const r = session.region;
    const usable = r && !r.exited && index >= r.startIndex && index < r.startIndex + REGION_SEGMENTS;
    if (!usable && spawns < 3) { spawnRegion(session, index); spawns++; }
    await new Promise((res) => setTimeout(res, 150));
  }
  return existsSync(path) ? path : null;
}
/** Drop any HLS scratch left over from a previous run (called on boot). */
function resetHlsScratch() {
  try { rmSync(HLS_DIR, { recursive: true, force: true }); } catch {}
}
  const audioStreaming = createDownloadAudioStreaming(dependencies);
  const liveAudioStreaming = createDownloadLiveAudioStreaming(dependencies);
  const audioSourceControls = createAudioStreamingControls(audioStreaming, liveAudioStreaming);
  return {
    ...audioStreaming,
    ...liveAudioStreaming,
    destroyHlsSession,
    getHlsPlaylist,
    getHlsSegment,
    ...audioSourceControls,
    isSegmentName,
    liveStreamEnabled,
    resetHlsScratch,
  };
}
