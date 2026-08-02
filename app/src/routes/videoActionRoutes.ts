import type { Context, Hono } from "hono";
import { database } from "../database";
import { isChildUser, recordWatchTick } from "../childTime";
import { computeShowFrom } from "../scheduleTime";
import { recordSchedulingSignal } from "../contentSignals";
import { refreshDiscoveryInBackground } from "../plugins";
import { cancelAutoDownloadIfUnwanted } from "../downloader";
import { videoExistsStmt } from "../videoRoutesSupport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerVideoActionRoutes(api: Api, currentUserId: (context: ApiContext) => number): void {
// ---------- video actions ----------

const BUCKETS = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];

api.post("/videos/:id/queue", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { bucket } = await c.req.json();
  if (!BUCKETS.includes(bucket)) return c.json({ error: "invalid bucket" }, 400);
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  const showFrom = computeShowFrom(bucket);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status, bucket, queued_at, show_from)
     VALUES (?, ?, 'queued', ?, datetime('now'), ?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'queued', bucket = excluded.bucket, queued_at = excluded.queued_at, show_from = excluded.show_from`
  ).run(uid, id, bucket, showFrom);
  await recordSchedulingSignal(uid, id, bucket);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/archive", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'archived')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'archived', bucket = NULL, show_from = NULL`
  ).run(uid, id);
  // Rejecting a video also stops a pending auto download nobody else waits for.
  await cancelAutoDownloadIfUnwanted(uid, id);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/restore", async (c) => {
  const uid = currentUserId(c);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'inbox')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'inbox', bucket = NULL, show_from = NULL`
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/dequeue", async (c) => {
  const uid = currentUserId(c);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'inbox')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'inbox', bucket = NULL, queued_at = NULL, show_from = NULL`
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/watch", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (await videoExistsStmt.get(id)) {
    await database.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(id, uid);
    refreshDiscoveryInBackground(uid);
  }
  return c.json({ ok: true });
});

api.post("/videos/:id/complete", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, watched) VALUES (?, ?, 1)
     ON CONFLICT(user_id, video_id) DO UPDATE SET watched = 1`
  ).run(uid, id);
  await database.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(id, uid);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/videos/:id/complete", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const preserveHistory = await isChildUser(uid);
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.transaction(async () => {
    const state = await database.prepare("SELECT watched FROM user_videos WHERE user_id = ? AND video_id = ?")
      .get(uid, id) as { watched: number | null } | null;
    await database.prepare(
      `INSERT INTO user_videos (user_id, video_id, status, watched) VALUES (?, ?, 'inbox', NULL)
       ON CONFLICT(user_id, video_id) DO UPDATE SET
         status = 'inbox', watched = NULL, watch_position = NULL, watch_duration = NULL,
         bucket = NULL, queued_at = NULL, show_from = NULL`
    ).run(uid, id);
    // Completing a video creates one history entry. Remove only the newest one
    // so undoing an accidental click does not erase older, legitimate watches.
    // Checking the old state also keeps repeated DELETE requests idempotent.
    if (state?.watched === 1 && !preserveHistory) {
      await database.prepare(
        `DELETE FROM history WHERE id = (
           SELECT id FROM history WHERE user_id = ? AND video_id = ?
           ORDER BY watched_at DESC, id DESC LIMIT 1
         )`
      ).run(uid, id);
    }
  })();
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.put("/videos/:id/like", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { liked } = await c.req.json() as { liked: boolean };
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, liked) VALUES (?, ?, ?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET liked = excluded.liked`
  ).run(uid, id, liked ? 1 : null);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.put("/videos/:id/progress", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { position, duration } = await c.req.json() as { position: number; duration: number };
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, watch_position, watch_duration) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET watch_position = excluded.watch_position, watch_duration = excluded.watch_duration`
  ).run(uid, id, position, duration);
  await recordWatchTick(uid, id);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/videos/:id/progress", async (c) => {
  const uid = currentUserId(c);
  await database.prepare(
    "UPDATE user_videos SET watch_position = NULL, watch_duration = NULL WHERE user_id = ? AND video_id = ?"
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/tags", async (c) => {
  const uid = currentUserId(c);
  const { tag_id } = await c.req.json();
  // Only allow tagging with a tag the active profile owns.
  if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) {
    return c.json({ error: "tag not found" }, 404);
  }
  await database.prepare("INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) VALUES (?, ?, 'manual')").run(
    c.req.param("id"),
    tag_id
  );
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/videos/:id/tags/:tagId", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?").run(
    c.req.param("id"),
    c.req.param("tagId")
  );
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

}
