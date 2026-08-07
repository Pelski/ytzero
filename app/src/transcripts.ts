import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ytdlpCommand } from "./downloadConfig";
import { log } from "./logger";

export type TranscriptFailure = "not_found" | "timeout" | "ytdlp_missing" | "unavailable";

export class TranscriptError extends Error {
  constructor(public readonly code: TranscriptFailure) {
    super(code);
  }
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'",
  };
  return value.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => entities[entity]);
}

function shortTimestamp(value: string): string {
  const timestamp = value.trim().replace(/\.\d+$/, "");
  return timestamp.startsWith("00:") ? timestamp.slice(3) : timestamp;
}

/** Convert WebVTT cues to a compact, timestamped transcript suitable for copy/paste. */
export function webVttToTranscript(vtt: string): string {
  const output: string[] = [];
  let previous = "";
  for (const block of vtt.replace(/^\uFEFF/, "").replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const text = decodeEntities(lines.slice(timingIndex + 1).join(" ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim());
    if (!text || text === previous) continue;
    output.push(`[${shortTimestamp(lines[timingIndex].split("-->")[0])}] ${text}`);
    previous = text;
  }
  return output.join("\n");
}

export async function fetchTranscript(userId: number, videoId: string, language: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "ytzero-transcript-"));
  let timedOut = false;
  try {
    const args = [
      "--ignore-config",
      "--no-playlist",
      "--no-warnings",
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs", language,
      "--sub-format", "vtt",
      "-o", join(directory, "transcript.%(ext)s"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ];
    const proc = Bun.spawn(ytdlpCommand(userId, args, true), { stdout: "ignore", stderr: "pipe" });
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill(); } catch { /* process already exited */ }
    }, 60_000);
    const errorText = await new Response(proc.stderr as ReadableStream<Uint8Array>).text().catch(() => "");
    const exitCode = await proc.exited;
    clearTimeout(timer);
    if (timedOut) throw new TranscriptError("timeout");
    const subtitle = readdirSync(directory).find((file) => file.endsWith(".vtt"));
    if (!subtitle) {
      if (exitCode === 0 || /no subtitles|not available|requested format is not available/i.test(errorText)) {
        throw new TranscriptError("not_found");
      }
      log.warn("transcript.fetch_failed", { videoId, language, error: errorText.trim().split("\n").at(-1) ?? `yt-dlp exited with ${exitCode}` });
      throw new TranscriptError("unavailable");
    }
    const transcript = webVttToTranscript(readFileSync(join(directory, subtitle), "utf8"));
    if (!transcript) throw new TranscriptError("not_found");
    return transcript;
  } catch (error) {
    if (error instanceof TranscriptError) throw error;
    if (error instanceof Error && /ENOENT/.test(error.message)) throw new TranscriptError("ytdlp_missing");
    log.warn("transcript.fetch_failed", { videoId, language, error: error instanceof Error ? error.message : String(error) });
    throw new TranscriptError("unavailable");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
