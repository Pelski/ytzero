import { database } from "./database";
import { downloadCookiesConfigured, ytdlpCommand } from "./downloadConfig";
import { log } from "./logger";
import { redactYtdlpDiagnostic } from "./downloadStrategy";
import { DeletedVideoError, isDeletedVideoError, isPrivateVideoError, PrivateVideoError } from "./youtubeVideoAvailability";
import type { VideoInfo } from "./youtube";

const METADATA_TIMEOUT_MS = 45_000;

export class MetadataCookieFallbackBudget {
  private used = 0;

  constructor(public readonly limit = 3) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error("invalid metadata cookie fallback budget");
  }

  reserve(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  remaining(): number {
    return Math.max(0, this.limit - this.used);
  }
}

export interface MetadataCookieFallbackDependencies {
  listProfileIds(): Promise<number[]>;
  cookiesConfigured(userId: number): boolean;
  command(userId: number, args: string[]): string[];
  run(command: string[]): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>;
  logger: Pick<typeof log, "info" | "warn">;
}

async function runMetadataCommand(command: string[]) {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); } catch { /* process already exited */ }
  }, METADATA_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

const defaultDependencies: MetadataCookieFallbackDependencies = {
  listProfileIds: async () => (await database.prepare("SELECT id FROM users ORDER BY sort_order ASC, id ASC").all() as { id: number }[]).map((row) => row.id),
  cookiesConfigured: downloadCookiesConfigured,
  command: (userId, args) => ytdlpCommand(userId, args, true),
  run: runMetadataCommand,
  logger: log,
};

export function chooseMetadataCookieProfile(
  profileIds: number[],
  requestedUserId: number | undefined,
  cookiesConfigured: (userId: number) => boolean,
): number | null {
  if (requestedUserId && profileIds.includes(requestedUserId) && cookiesConfigured(requestedUserId)) {
    return requestedUserId;
  }
  return profileIds.find(cookiesConfigured) ?? null;
}

function ytdlpDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function ytdlpDuration(raw: Record<string, unknown>): string | null {
  if (typeof raw.duration_string === "string" && /^\d+(?::\d{2})+$/.test(raw.duration_string)) {
    return raw.duration_string;
  }
  const seconds = Number(raw.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function ytdlpLiveStatus(raw: Record<string, unknown>): VideoInfo["liveStatus"] {
  if (raw.live_status === "is_live" || raw.is_live === true) return "live";
  if (raw.live_status === "is_upcoming") return "upcoming";
  if (raw.live_status === "was_live" || raw.live_status === "post_live") return "was_live";
  return "none";
}

export function parseYtdlpVideoInfo(videoId: string, serialized: string): VideoInfo {
  const raw = JSON.parse(serialized) as Record<string, unknown>;
  const thumbnails = Array.isArray(raw.thumbnails) ? raw.thumbnails as Array<{ url?: unknown }> : [];
  const thumbnail = typeof raw.thumbnail === "string"
    ? raw.thumbnail
    : [...thumbnails].reverse().find((item) => typeof item?.url === "string")?.url;
  const viewCount = typeof raw.view_count === "number" ? raw.view_count : Number.NaN;
  return {
    videoId: typeof raw.id === "string" && raw.id ? raw.id : videoId,
    title: typeof raw.title === "string" ? raw.title : "",
    channelId: typeof raw.channel_id === "string"
      ? raw.channel_id
      : typeof raw.uploader_id === "string" && raw.uploader_id.startsWith("UC") ? raw.uploader_id : "",
    channelTitle: typeof raw.channel === "string"
      ? raw.channel
      : typeof raw.uploader === "string" ? raw.uploader : "",
    description: typeof raw.description === "string" ? raw.description : "",
    thumbnail: typeof thumbnail === "string" ? thumbnail : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    viewCount: Number.isFinite(viewCount) && viewCount >= 0 ? viewCount : null,
    publishedAt: ytdlpDate(raw.upload_date) ?? ytdlpDate(raw.release_date),
    duration: ytdlpDuration(raw),
    liveStatus: ytdlpLiveStatus(raw),
  };
}

/** Retry an address refusal through one cookie jar already configured on the
 * instance. Prefer the requesting profile, then deliberately borrow the first
 * configured profile in display order so background work has the same access. */
export async function retryVideoInfoWithCookies(
  videoId: string,
  refusal: unknown,
  options: { userId?: number; budget?: MetadataCookieFallbackBudget } = {},
  dependencies: MetadataCookieFallbackDependencies = defaultDependencies,
): Promise<VideoInfo> {
  const profileIds = await dependencies.listProfileIds();
  const cookieProfileId = chooseMetadataCookieProfile(profileIds, options.userId, dependencies.cookiesConfigured);
  if (cookieProfileId == null || (options.budget && !options.budget.reserve())) throw refusal;

  const borrowed = cookieProfileId !== options.userId;
  if (borrowed) {
    dependencies.logger.info("youtube.metadata_cookie_profile_borrowed", {
      videoId,
      requestedProfileId: options.userId ?? null,
      cookieProfileId,
    });
  }
  dependencies.logger.info("youtube.metadata_retry_with_cookies", {
    videoId,
    requestedProfileId: options.userId ?? null,
    cookieProfileId,
    borrowed,
    budgetRemaining: options.budget?.remaining() ?? null,
  });

  const args = [
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    "--skip-download",
    "--dump-single-json",
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  try {
    const result = await dependencies.run(dependencies.command(cookieProfileId, args));
    if (result.timedOut) throw new Error("yt-dlp metadata lookup timed out");
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1)
        ?? `yt-dlp exited with code ${result.exitCode}`;
      throw new Error(detail);
    }
    const info = parseYtdlpVideoInfo(videoId, result.stdout);
    dependencies.logger.info("youtube.metadata_cookie_retry_complete", { videoId, cookieProfileId });
    return info;
  } catch (error) {
    if (isPrivateVideoError(error)) throw new PrivateVideoError();
    if (isDeletedVideoError(error)) throw new DeletedVideoError();
    dependencies.logger.warn("youtube.metadata_cookie_retry_failed", {
      videoId,
      cookieProfileId,
      error: redactYtdlpDiagnostic(error instanceof Error ? error.message : String(error)),
    });
    throw refusal;
  }
}
