import type { Context, Hono } from "hono";
import { audioVideoIsEligible, liveAudioVideoIsEligible, type AudioVideoState } from "../audioEligibility";
import { parseAudioRange } from "../audioRange";
import { database } from "../database";
import { isChildUser } from "../childTime";
import {
  getAudioHeadResponse,
  getAudioResponse,
  getLiveAudioPlaylist,
  getLiveAudioResource,
  retryAudioSource,
  ytdlpStatus,
} from "../downloader";
import { log } from "../logger";
import { fetchVideoInfo } from "../youtube";
import { persistDirectVideoInfo } from "../videoInfoPersistence";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

async function audioVideo(videoId: string): Promise<AudioVideoState | null> {
  return await database.prepare("SELECT live_status, is_private, is_unavailable, members_only FROM videos WHERE video_id = ?")
    .get(videoId) as AudioVideoState | null;
}

async function refreshAudioVideoState(videoId: string, source: string): Promise<AudioVideoState | null> {
  const previous = await audioVideo(videoId);
  if (!previous) return null;
  try {
    // A missing progressive format can be the first evidence that an RSS row
    // was actually imported for an active livestream. Bypass the short video
    // info cache here because this path exists specifically to repair state.
    const info = await fetchVideoInfo(videoId, { force: true });
    await persistDirectVideoInfo(info);
    const current = await audioVideo(videoId);
    if (current && current.live_status !== previous.live_status) {
      log.info("video.live_status_corrected", {
        videoId,
        from: previous.live_status,
        to: current.live_status,
        source,
      });
    }
    return current;
  } catch (error) {
    log.warn("audio.live_status_probe_failed", {
      videoId,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return previous;
  }
}

export function registerAudioRoutes(api: Api, currentUserId: (context: ApiContext) => number): void {
  api.post("/videos/:id/audio/retry", async (context) => {
    const userId = currentUserId(context);
    if (await isChildUser(userId)) return context.json({ error: "not allowed" }, 403);
    const videoId = context.req.param("id");
    const video = await audioVideo(videoId);
    if (!video) return context.json({ error: "not found" }, 404);
    const live = video.live_status === "live";
    if (!(live ? liveAudioVideoIsEligible(video) : audioVideoIsEligible(video))) {
      return context.json({ error: "audio unavailable" }, 409);
    }
    if (!await ytdlpStatus()) return context.json({ error: "yt-dlp unavailable" }, 503);
    let resolved = await retryAudioSource(userId, videoId, live, context.req.raw.signal);
    if (resolved) return context.json({ ok: true, live });

    const refreshed = await refreshAudioVideoState(videoId, "audio_retry");
    const correctedLive = refreshed?.live_status === "live";
    if (refreshed && correctedLive !== live) {
      const eligible = correctedLive ? liveAudioVideoIsEligible(refreshed) : audioVideoIsEligible(refreshed);
      if (eligible) resolved = await retryAudioSource(userId, videoId, correctedLive, context.req.raw.signal);
    }
    return resolved
      ? context.json({ ok: true, live: correctedLive })
      : context.json({ error: "audio unavailable" }, 502);
  });

  api.get("/videos/:id/audio", async (context) => {
    const userId = currentUserId(context);
    if (await isChildUser(userId)) return context.json({ error: "not allowed" }, 403);
    const videoId = context.req.param("id");
    const video = await audioVideo(videoId);
    if (!video) return context.json({ error: "not found" }, 404);
    if (!audioVideoIsEligible(video)) return context.json({ error: "audio unavailable" }, 409);
    const range = context.req.header("range") ?? null;
    if (!parseAudioRange(range)) {
      return new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes", "Cache-Control": "no-store" } });
    }
    if (!await ytdlpStatus()) return context.json({ error: "yt-dlp unavailable" }, 503);
    const response = context.req.method === "HEAD"
      ? await getAudioHeadResponse(userId, videoId, range, context.req.raw.signal)
      : await getAudioResponse(userId, videoId, range, context.req.raw.signal);
    if (response) return response;
    const refreshed = await refreshAudioVideoState(videoId, "progressive_audio_failure");
    if (refreshed?.live_status === "live") {
      return context.json({ error: "video is live", code: "video_is_live" }, 409);
    }
    return context.json({ error: "audio unavailable" }, 502);
  });

  api.get("/videos/:id/audio-live/:resource", async (context) => {
    const userId = currentUserId(context);
    if (await isChildUser(userId)) return context.json({ error: "not allowed" }, 403);
    const videoId = context.req.param("id");
    const video = await audioVideo(videoId);
    if (!video) return context.json({ error: "not found" }, 404);
    if (!liveAudioVideoIsEligible(video)) return context.json({ error: "live audio unavailable" }, 409);
    if (!await ytdlpStatus()) return context.json({ error: "yt-dlp unavailable" }, 503);
    const resource = context.req.param("resource");
    if (resource === "index.m3u8") {
      const playlist = await getLiveAudioPlaylist(userId, videoId, context.req.raw.signal);
      if (!playlist) {
        const refreshed = await refreshAudioVideoState(videoId, "live_audio_failure");
        if (refreshed && refreshed.live_status !== "live") {
          return context.json({ error: "video is no longer live", code: "video_is_not_live" }, 409);
        }
        return context.json({ error: "live audio unavailable" }, 502);
      }
      return new Response(playlist, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      });
    }
    const response = await getLiveAudioResource(
      userId,
      videoId,
      resource,
      context.req.header("range") ?? null,
      context.req.raw.signal,
    );
    return response ?? context.json({ error: "live audio resource unavailable" }, 404);
  });
}
