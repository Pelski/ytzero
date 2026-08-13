import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadCookiesConfigured, ytdlpCommand } from "./downloadConfig";
import { log } from "./logger";
import { TranscriptCache } from "./transcriptCache";

export type TranscriptFailure = "not_found" | "timeout" | "ytdlp_missing" | "rate_limited" | "unavailable";

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

const transcriptCache = new TranscriptCache();

export function transcriptFailureReason(errorText: string): string {
  if (/sign in|login|authentication|members.only|private video|age.restrict/i.test(errorText)) return "login_required";
  if (/429|too many requests|rate.?limit/i.test(errorText)) return "rate_limited";
  if (/timed? out|network|connection|unable to download/i.test(errorText)) return "network_error";
  if (/no subtitles|not available|requested format is not available/i.test(errorText)) return "not_found";
  return "ytdlp_error";
}

async function fetchTranscriptFresh(userId: number, videoId: string, language: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "ytzero-transcript-"));
  const startedAt = Date.now();
  const cookiesConfigured = downloadCookiesConfigured(userId);
  let timedOut = false;
  log.info("transcript.fetch_start", { userId, videoId, language, cookiesConfigured });
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
    if (timedOut) {
      log.warn("transcript.fetch_failed", { userId, videoId, language, cookiesConfigured, reason: "timeout", ms: Date.now() - startedAt });
      throw new TranscriptError("timeout");
    }
    const subtitle = readdirSync(directory).find((file) => file.endsWith(".vtt"));
    if (!subtitle) {
      if (exitCode === 0 || /no subtitles|not available|requested format is not available/i.test(errorText)) {
        log.info("transcript.fetch_unavailable", {
          userId, videoId, language, cookiesConfigured, reason: "not_found", exitCode, ms: Date.now() - startedAt,
        });
        throw new TranscriptError("not_found");
      }
      const reason = transcriptFailureReason(errorText);
      log.warn("transcript.fetch_failed", { userId, videoId, language, cookiesConfigured, reason, exitCode, ms: Date.now() - startedAt });
      throw new TranscriptError(reason === "rate_limited" ? "rate_limited" : "unavailable");
    }
    const transcript = webVttToTranscript(readFileSync(join(directory, subtitle), "utf8"));
    if (!transcript) throw new TranscriptError("not_found");
    log.info("transcript.fetch_complete", { userId, videoId, language, bytes: transcript.length, ms: Date.now() - startedAt });
    return transcript;
  } catch (error) {
    if (error instanceof TranscriptError) throw error;
    if (error instanceof Error && /ENOENT/.test(error.message)) {
      log.warn("transcript.fetch_failed", { userId, videoId, language, cookiesConfigured, reason: "ytdlp_missing", ms: Date.now() - startedAt });
      throw new TranscriptError("ytdlp_missing");
    }
    log.warn("transcript.fetch_failed", {
      userId, videoId, language, cookiesConfigured, reason: "runtime_error", ms: Date.now() - startedAt,
    });
    throw new TranscriptError("unavailable");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function fetchTranscript(userId: number, videoId: string, language: string): Promise<string> {
  return transcriptCache.get(userId, videoId, language, () => fetchTranscriptFresh(userId, videoId, language));
}
