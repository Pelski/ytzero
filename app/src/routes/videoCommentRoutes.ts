import type { Context, Hono } from "hono";
import { childLocalOnly } from "../childTime";
import { tubeArchivistComments } from "../tubeArchivist";
import { fetchVideoComments, validYouTubeVideoId, VideoCommentsError } from "../youtubeComments";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerVideoCommentRoutes(api: Api, currentUserId: (context: ApiContext) => number): void {
  api.get("/videos/:id/comments", async (c) => {
    const videoId = c.req.param("id");
    if (!validYouTubeVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
    const sort = c.req.query("sort") ?? "top";
    if (sort !== "top" && sort !== "new") return c.json({ error: "invalid comment sort" }, 400);
    try {
      const archived = await tubeArchivistComments(videoId);
      if (archived) return c.json(archived);
      if (childLocalOnly(currentUserId(c))) return c.json({ error: "restricted" }, 403);
      return c.json(await fetchVideoComments(currentUserId(c), videoId, sort, c.req.query("refresh") === "1"));
    } catch (error) {
      const failure = error instanceof VideoCommentsError
        ? error
        : new VideoCommentsError("unavailable", error instanceof Error ? error.message : String(error));
      const status = failure.code === "comments_disabled" ? 409
        : failure.code === "rate_limited" ? 429
        : failure.code === "ytdlp_missing" ? 503
        : failure.code === "timeout" ? 504
        : 502;
      return c.json({ error: "comments unavailable", code: failure.code }, status);
    }
  });
}
