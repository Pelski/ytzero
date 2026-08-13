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

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

async function audioVideo(videoId: string): Promise<AudioVideoState | null> {
  return await database.prepare("SELECT live_status, is_private, members_only FROM videos WHERE video_id = ?")
    .get(videoId) as AudioVideoState | null;
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
    const resolved = await retryAudioSource(userId, videoId, live, context.req.raw.signal);
    return resolved ? context.json({ ok: true }) : context.json({ error: "audio unavailable" }, 502);
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
    return response ?? context.json({ error: "audio unavailable" }, 502);
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
      if (!playlist) return context.json({ error: "live audio unavailable" }, 502);
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
