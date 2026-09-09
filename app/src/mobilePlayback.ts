import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

type MobilePlaybackResult = { path: string; transcoded: boolean } | null;

interface CodecProbe {
  video: string | null;
  audio: string | null;
}

const probes = new Map<string, { mtimeMs: number; codecs: CodecProbe }>();
const pending = new Map<string, Promise<MobilePlaybackResult>>();

function cachePath(downloadsDir: string, sourcePath: string): string {
  const key = createHash("sha256").update(sourcePath).digest("hex");
  return resolve(downloadsDir, "..", "mobile-playback", `${key}.mp4`);
}

async function probe(sourcePath: string, ffprobe: string): Promise<CodecProbe | null> {
  const mtimeMs = statSync(sourcePath).mtimeMs;
  const cached = probes.get(sourcePath);
  if (cached?.mtimeMs === mtimeMs) return cached.codecs;
  const process = Bun.spawn([
    ffprobe, "-v", "error", "-show_entries", "stream=codec_type,codec_name",
    "-of", "json", sourcePath,
  ], { stdout: "pipe", stderr: "ignore" });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) return null;
  try {
    const streams = (JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; codec_name?: string }> }).streams ?? [];
    const codecs = {
      video: streams.find((stream) => stream.codec_type === "video")?.codec_name ?? null,
      audio: streams.find((stream) => stream.codec_type === "audio")?.codec_name ?? null,
    };
    probes.set(sourcePath, { mtimeMs, codecs });
    return codecs;
  } catch {
    return null;
  }
}

function compatible(codecs: CodecProbe): boolean {
  return codecs.video === "h264" && (codecs.audio === null || codecs.audio === "aac");
}

/**
 * Return a local H.264/AAC presentation for browsers such as iOS Safari that
 * cannot decode the AV1/Opus combinations used by the highest-quality YouTube
 * downloads. The original file is never modified; the derived file is a
 * machine-local cache and is written atomically.
 */
export function createMobilePlayback(downloadsDir: string, ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg", ffprobe = process.env.FFPROBE_PATH ?? "ffprobe") {
  async function build(sourcePath: string): Promise<MobilePlaybackResult> {
    let sourceStat: ReturnType<typeof statSync>;
    try { sourceStat = statSync(sourcePath); } catch { return null; }
    const codecs = await probe(sourcePath, ffprobe);
    if (!codecs) return null;
    if (compatible(codecs)) return { path: sourcePath, transcoded: false };

    const outputPath = cachePath(downloadsDir, sourcePath);
    try {
      if (existsSync(outputPath) && statSync(outputPath).mtimeMs >= sourceStat.mtimeMs && statSync(outputPath).size > 0) {
        return { path: outputPath, transcoded: true };
      }
    } catch {}

    mkdirSync(dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${globalThis.process.pid}.tmp.mp4`;
    const child = Bun.spawn([
      ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-i", sourcePath, "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", temporaryPath,
    ], { stdout: "ignore", stderr: "ignore" });
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      try { unlinkSync(temporaryPath); } catch {}
      return null;
    }
    try {
      renameSync(temporaryPath, outputPath);
      return { path: outputPath, transcoded: true };
    } catch {
      try { unlinkSync(temporaryPath); } catch {}
      return null;
    }
  }

  async function ensure(sourcePath: string): Promise<MobilePlaybackResult> {
    const existing = pending.get(sourcePath);
    if (existing) return existing;
    const operation = build(sourcePath).catch(() => null).finally(() => pending.delete(sourcePath));
    pending.set(sourcePath, operation);
    return operation;
  }

  return { ensure };
}
