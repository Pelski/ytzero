import type { Context, Hono } from "hono";
import { database } from "../database";
import { SUBTITLE_LANGUAGE_CODES } from "../subtitleLanguages";
import { fetchTranscript, TranscriptError } from "../transcripts";
import { validYouTubeVideoId } from "../youtubeComments";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type ApiContext = Context<ApiEnvironment>;

export function registerTranscriptRoutes(api: Hono<ApiEnvironment>, currentUserId: (context: ApiContext) => number): void {
  api.post("/videos/:id/transcript", async (c) => {
    const videoId = c.req.param("id");
    const body = await c.req.json().catch(() => ({})) as { language?: unknown };
    const language = typeof body.language === "string" ? body.language : "";
    if (!validYouTubeVideoId(videoId) || !SUBTITLE_LANGUAGE_CODES.has(language)) {
      return c.json({ error: "invalid transcript request" }, 400);
    }
    const video = await database.prepare("SELECT 1 FROM videos WHERE video_id = ?").get(videoId);
    if (!video) return c.json({ error: "video not found" }, 404);
    try {
      return c.json({ language, transcript: await fetchTranscript(currentUserId(c), videoId, language) });
    } catch (error) {
      const failure = error instanceof TranscriptError ? error.code : "unavailable";
      const status = failure === "not_found" ? 404 : failure === "timeout" ? 504 : failure === "ytdlp_missing" ? 503 : 502;
      return c.json({ error: "transcript unavailable", code: failure }, status);
    }
  });
}
