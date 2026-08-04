import type { Context, Hono } from "hono";
import { storedChannelPosts, syncChannelPosts } from "../channelPostsStore";
import { database } from "../database";
import { getUserSetting } from "../db";
import { videoSelect, type VideoRow } from "../videoRoutesSupport";
import type { ChannelPost } from "../youtubePosts";

type ApiEnvironment = { Variables: { userId: number } };
type AttachTags = (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;

export async function attachLocalPostVideos(userId: number, posts: ChannelPost[], attachTags: AttachTags) {
  const videoIds = [...new Set(posts.flatMap((post) => post.attachment?.type === "video" && post.attachment.id ? [post.attachment.id] : []))];
  const localVideos = videoIds.length > 0
    ? await attachTags(userId, await database.prepare(`${videoSelect(userId)} WHERE v.video_id IN (${videoIds.map(() => "?").join(",")})`).all(...videoIds) as VideoRow[])
    : [];
  const videosById = new Map(localVideos.map((video) => [video.video_id, video]));
  return posts.map((post) => ({
    ...post,
    localVideo: post.attachment?.type === "video" && post.attachment.id ? videosById.get(post.attachment.id) ?? null : null,
  }));
}

export function registerChannelPostRoutes(
  api: Hono<ApiEnvironment>,
  currentUserId: (context: Context<ApiEnvironment>) => number,
  attachTags: AttachTags,
): void {
  api.get("/channels/:id/posts", async (c) => {
    const channelId = c.req.param("id");
    const userId = currentUserId(c);
    if (getUserSetting(userId, "channel_posts_tab") !== "1") return c.json({ error: "posts tab disabled" }, 403);
    if (!await database.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId)) return c.json({ error: "not found" }, 404);
    const requestedLanguage = c.req.query("language");
    const language = requestedLanguage === "pl" || requestedLanguage === "de" ? requestedLanguage : "en";
    const stored = await storedChannelPosts(channelId);
    const result = c.req.query("refresh") === "1" || !stored.fetchedAt
      ? await syncChannelPosts(channelId, language)
      : stored;
    return c.json({ ...result, posts: await attachLocalPostVideos(userId, result.posts, attachTags) });
  });
}
