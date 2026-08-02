import type { Context, Hono } from "hono";
import { database } from "../database";
import { isChildUser } from "../childTime";
import { refreshDiscoveryInBackground } from "../plugins";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerHistoryRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    attachTags: (userId: number, videos: any[]) => Promise<any[]>;
  },
): void {
  const { currentUserId, attachTags } = access;

  api.get("/history", async (c) => {
    const uid = currentUserId(c);
    const requestedPage = Number(c.req.query("page") ?? 0);
    const page = Number.isFinite(requestedPage) ? Math.max(0, Math.floor(requestedPage)) : 0;
    const pageSize = 60;
    const rows = await database
      .prepare(
        `WITH latest_history AS (
           SELECT video_id, MAX(id) AS history_id, MAX(watched_at) AS watched_at
           FROM history
           WHERE user_id = ?
           GROUP BY video_id
         )
         SELECT h.history_id, h.watched_at,
                v.video_id, v.channel_id, v.title, v.description, v.duration,
                v.thumbnail, v.published_at, v.published_at_approximate, v.members_only,
                v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket,
                uv.watch_position, uv.watch_duration, uv.watched,
                COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail
         FROM latest_history h JOIN videos v ON v.video_id = h.video_id
         JOIN channels c ON c.channel_id = v.channel_id
         LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
         ORDER BY h.watched_at DESC, h.history_id DESC LIMIT ? OFFSET ?`,
      )
      .all(uid, uid, pageSize + 1, page * pageSize) as any[];
    const hasMore = rows.length > pageSize;
    return c.json({ videos: await attachTags(uid, rows.slice(0, pageSize)), page, has_more: hasMore });
  });

  api.delete("/history/:id", async (c) => {
    const uid = currentUserId(c);
    if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
    await database.prepare(
      `DELETE FROM history
       WHERE user_id = ? AND video_id = (
         SELECT video_id FROM history WHERE id = ? AND user_id = ?
       )`,
    ).run(uid, c.req.param("id"), uid);
    refreshDiscoveryInBackground(uid);
    return c.json({ ok: true });
  });
}
