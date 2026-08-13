import type { Context, Hono } from "hono";
import { database } from "../database";
import { enqueuePlaylistDownloads } from "../downloader";
import { isChildUser } from "../childTime";
import { log } from "../logger";
import { syncPlaylist } from "../refresher";
import { videoSelect, type VideoRow } from "../videoRoutesSupport";
import { profileDownloadsEnabled } from "../downloadConfig";
import { normalizePlaylistSort, sortPlaylistItems } from "../playlistSort";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerChannelPlaylistRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    attachTags: (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;
    playlistChannelSyncIsDisabled: (playlistId: string) => Promise<boolean>;
  },
): void {
  const { currentUserId, attachTags, playlistChannelSyncIsDisabled } = access;

// ---------- followed YouTube playlists ----------
api.get("/channel-playlists/:id", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  let playlist = await database.prepare(`
    SELECT cp.playlist_id, cp.title, cp.thumbnail, cp.video_count, cp.last_synced_at,
           cp.channel_id, COALESCE(NULLIF(ch.custom_title, ''), ch.title) AS channel_title,
           ch.thumbnail AS channel_thumbnail,
           EXISTS(SELECT 1 FROM user_followed_playlists ufp WHERE ufp.user_id = ? AND ufp.playlist_id = cp.playlist_id) AS followed
    FROM channel_playlists cp JOIN channels ch ON ch.channel_id = cp.channel_id
    WHERE cp.playlist_id = ?
  `).get(uid, id) as any;
  if (!playlist) {
    try {
      await syncPlaylist(id);
      playlist = await database.prepare(`
        SELECT cp.playlist_id, cp.title, cp.thumbnail, cp.video_count, cp.last_synced_at,
               cp.channel_id, COALESCE(NULLIF(ch.custom_title, ''), ch.title) AS channel_title,
               ch.thumbnail AS channel_thumbnail, 0 AS followed
        FROM channel_playlists cp JOIN channels ch ON ch.channel_id = cp.channel_id
        WHERE cp.playlist_id = ?
      `).get(id) as any;
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }
  if (!playlist) return c.json({ error: "not found" }, 404);
  return c.json({ playlist });
});

api.get("/channel-playlists/:id/videos", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const exists = await database.prepare("SELECT 1 FROM channel_playlists WHERE playlist_id = ?").get(id);
  if (!exists) {
    try { await syncPlaylist(id); } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }
  const rows = await database.prepare(`${videoSelect(uid)}
    JOIN channel_playlist_videos cpv ON cpv.video_id = v.video_id
    WHERE cpv.playlist_id = ?
    ORDER BY cpv.position ASC`).all(id) as VideoRow[];
  const attached = sortPlaylistItems(await attachTags(uid, rows), normalizePlaylistSort(c.req.query("sort")), (video) => ({ title: video.title, publishedAt: video.published_at }));
  return c.json({
    videos: attached.filter((video) => video.published_at != null && video.published_at !== ""),
    processing: attached.filter((video) => video.published_at == null || video.published_at === ""),
  });
});

api.post("/channel-playlists/:id/download", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  if (!await profileDownloadsEnabled(uid)) return c.json({ error: "downloads disabled" }, 409);
  const playlist = await database.prepare("SELECT title FROM channel_playlists WHERE playlist_id = ?").get(c.req.param("id")) as { title: string } | null;
  if (!playlist) return c.json({ error: "not found" }, 404);
  const rows = await database.prepare(`
    SELECT v.video_id, v.title, v.published_at FROM channel_playlist_videos cpv
    JOIN videos v ON v.video_id = cpv.video_id
    WHERE cpv.playlist_id = ? AND v.is_private = 0 AND v.is_unavailable = 0
      AND v.live_status NOT IN ('live', 'upcoming')
    ORDER BY cpv.position ASC
  `).all(c.req.param("id")) as Array<{ video_id: string; title: string; published_at: string | null }>;
  const videoIds = sortPlaylistItems(rows, normalizePlaylistSort(c.req.query("sort")), (video) => ({ title: video.title, publishedAt: video.published_at })).map((row) => row.video_id);
  const result = await enqueuePlaylistDownloads(uid, videoIds, playlist.title);
  log.info("downloads.playlist_queued", { playlistId: c.req.param("id"), playlistTitle: playlist.title, ...result });
  return c.json(result);
});

api.put("/channel-playlists/:id/follow", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { followed } = await c.req.json<{ followed: boolean }>();
  if (!followed) {
    await database.prepare("DELETE FROM user_followed_playlists WHERE user_id = ? AND playlist_id = ?").run(uid, id);
    return c.json({ ok: true, followed: false });
  }
  try {
    // Establish the complete current snapshot before setting the feed baseline.
    // Only videos discovered by a later sync are allowed into the main feed.
    await syncPlaylist(id);
    await database.prepare(`INSERT INTO user_followed_playlists (user_id, playlist_id, followed_at, feed_from)
      VALUES (?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(user_id, playlist_id) DO UPDATE SET include_in_feed = 1`).run(uid, id);
    return c.json({ ok: true, followed: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.post("/channel-playlists/:id/sync", async (c) => {
  if (await playlistChannelSyncIsDisabled(c.req.param("id"))) return c.json({ error: "channel sync disabled" }, 409);
  try {
    const result = await syncPlaylist(c.req.param("id"));
    return c.json({ ok: true, added: result.added });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.get("/followed-playlists", async (c) => {
  const uid = currentUserId(c);
  const playlists = await database.prepare(`
    SELECT cp.playlist_id, cp.title, cp.thumbnail, cp.video_count, cp.last_synced_at,
           cp.channel_id, COALESCE(NULLIF(ch.custom_title, ''), ch.title) AS channel_title,
           ch.thumbnail AS channel_thumbnail, ufp.followed_at, ufp.include_in_feed
    FROM user_followed_playlists ufp
    JOIN channel_playlists cp ON cp.playlist_id = ufp.playlist_id
    JOIN channels ch ON ch.channel_id = cp.channel_id
    WHERE ufp.user_id = ?
    ORDER BY channel_title COLLATE NOCASE, cp.title COLLATE NOCASE
  `).all(uid);
  return c.json({ playlists });
});

api.get("/followed-playlists/updates", async (c) => {
  const uid = currentUserId(c);
  const playlists = await database.prepare(`
    SELECT cp.playlist_id, cp.title, cp.thumbnail, cp.video_count, cp.last_synced_at,
           cp.channel_id, COALESCE(NULLIF(ch.custom_title, ''), ch.title) AS channel_title,
           ch.thumbnail AS channel_thumbnail, ufp.followed_at, ufp.feed_from, ufp.include_in_feed
    FROM user_followed_playlists ufp
    JOIN channel_playlists cp ON cp.playlist_id = ufp.playlist_id
    JOIN channels ch ON ch.channel_id = cp.channel_id
    WHERE ufp.user_id = ?
    ORDER BY cp.title COLLATE NOCASE
  `).all(uid) as any[];

  const updates = await Promise.all(playlists.map(async (playlist) => {
    const rows = await database.prepare(`${videoSelect(uid)}
      JOIN channel_playlist_videos cpv ON cpv.video_id = v.video_id
      WHERE cpv.playlist_id = ?
        AND v.published_at IS NOT NULL AND v.published_at != ''
        AND cpv.discovered_at > ?
        AND COALESCE(uv.watched, 0) = 0
        AND NOT EXISTS (
          SELECT 1 FROM history h
          WHERE h.user_id = ? AND h.video_id = v.video_id
        )
      ORDER BY COALESCE(v.published_at, cpv.discovered_at) DESC, cpv.position ASC
    `).all(playlist.playlist_id, playlist.feed_from, uid) as VideoRow[];
    const newVideos = await attachTags(uid, rows);
    const { feed_from: _feedFrom, ...publicPlaylist } = playlist;
    return { ...publicPlaylist, new_video_count: newVideos.length, new_videos: newVideos };
  }));

  return c.json({ playlists: updates });
});

}
