import type { Context, Hono } from "hono";
import { database } from "../database";
import { getFeedBuilderConfig, saveFeedBuilderConfig } from "../feedBuilderStore";
import { compositionPage, createComposition, previewRecipe } from "../feedComposer";
import { normalizeFeedRecipe, type FeedRecipe } from "../../../shared/feedBuilder";
import type { VideoRow } from "../videoRoutesSupport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerFeedBuilderRoutes(api: Api, access: {
  currentUserId: (context: ApiContext) => number;
  attachTags: (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;
}): void {
  const { currentUserId, attachTags } = access;

  api.get("/feed-builder", async (c) => c.json({ config: await getFeedBuilderConfig(currentUserId(c)) }));

  api.put("/feed-builder", async (c) => {
    const userId = currentUserId(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
      return c.json({ error: "expectedRevision required" }, 400);
    }
    const result = await saveFeedBuilderConfig(userId, body.config, Number(body.expectedRevision));
    return result.conflict ? c.json({ error: "revision conflict", config: result.config }, 409) : c.json({ config: result.config });
  });

  api.get("/feed-builder/options", async (c) => {
    const userId = currentUserId(c);
    const [channels, tags, youtubePlaylists, userPlaylists] = await Promise.all([
      database.prepare(`SELECT ch.channel_id AS id, COALESCE(NULLIF(ch.custom_title,''),ch.title) AS label FROM user_channels uc JOIN channels ch ON ch.channel_id=uc.channel_id WHERE uc.user_id=? AND uc.followed=1 ORDER BY label COLLATE NOCASE`).all(userId),
      database.prepare("SELECT portable_uuid AS id, name AS label, color, filter_only FROM tags WHERE user_id=? ORDER BY name COLLATE NOCASE").all(userId),
      database.prepare(`SELECT cp.playlist_id AS id, cp.title AS label FROM user_followed_playlists ufp JOIN channel_playlists cp ON cp.playlist_id=ufp.playlist_id WHERE ufp.user_id=? ORDER BY cp.title COLLATE NOCASE`).all(userId),
      database.prepare("SELECT portable_uuid AS id, name AS label FROM user_playlists WHERE user_id=? ORDER BY sort_order,name COLLATE NOCASE").all(userId),
    ]);
    return c.json({ channels, tags, youtubePlaylists, userPlaylists });
  });

  api.post("/feed-builder/preview", async (c) => {
    const userId = currentUserId(c);
    const rawBody = await c.req.json().catch(() => ({}));
    const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? rawBody as { recipe?: unknown; columns?: unknown }
      : {};
    const recipe: FeedRecipe = normalizeFeedRecipe(body.recipe);
    const columns = Math.max(1, Math.min(12, Math.round(Number(body.columns) || 4)));
    return c.json(await previewRecipe(userId, recipe, columns, attachTags));
  });

  api.post("/feed/compositions", async (c) => {
    const userId = currentUserId(c);
    const config = await getFeedBuilderConfig(userId);
    if (config.mode !== "composed") return c.json({ error: "composed feed disabled" }, 409);
    const rawBody = await c.req.json().catch(() => ({}));
    const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {};
    return c.json(await createComposition(userId, config, body, attachTags));
  });

  api.post("/feed/compositions/:id/pages", async (c) => {
    const userId = currentUserId(c);
    const config = await getFeedBuilderConfig(userId);
    const rawBody = await c.req.json().catch(() => ({}));
    const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? rawBody as { pageIndex?: unknown }
      : {};
    const pageIndex = Number(body.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 1) return c.json({ error: "invalid page" }, 400);
    const page = await compositionPage(userId, c.req.param("id"), pageIndex, config, attachTags);
    if (page === "expired") return c.json({ error: "composition expired" }, 410);
    if (page === "invalid-page") return c.json({ error: "invalid page order" }, 409);
    return c.json(page);
  });

  api.delete("/feed/compositions/:id", async (c) => {
    await database.prepare("DELETE FROM feed_composition_sessions WHERE id=? AND user_id=?").run(c.req.param("id"), currentUserId(c));
    return c.json({ ok: true });
  });
}
