import type { Context, Hono } from "hono";
import { database } from "../database";
import { enqueuePlaylistDownloads } from "../downloader";
import { isChildUser } from "../childTime";
import { log } from "../logger";
import { refreshDiscoveryInBackground } from "../plugins";
import { applyPlaylistRuleToAllVideos, applyPlaylistRulesForPlaylist } from "../userPlaylists";
import { videoPlaylistsForUser } from "../channelPlaylists";
import { normalizePlaylistSort } from "../playlistSort";
import { sortFetchedPlaylistVideos } from "../playlistVideoOrder";
import { fetchPlaylistVideos } from "../youtube";
import { importPlaylistVideos } from "../refresher";
import type { VideoRow } from "../videoRoutesSupport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerUserPlaylistRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    videoSelect: (userId: number) => string;
    attachTags: (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;
    attachWatchedState: typeof import("../videoRoutesSupport").attachWatchedState;
    profileDownloadsEnabled: (userId: number) => Promise<boolean>;
  },
): void {
  const { currentUserId, videoSelect, attachTags, attachWatchedState, profileDownloadsEnabled } = access;
  async function ownsPlaylist(uid: number, id: number | string) {
    return Boolean(await database.prepare("SELECT 1 FROM user_playlists WHERE id = ? AND user_id = ?").get(id, uid));
  }
  api.get("/playlists", async (c) => {
    const uid = currentUserId(c);
    const videoId = c.req.query("video_id");
    const rows = await database.prepare(
      `SELECT p.id, p.portable_uuid, p.name, p.icon, p.sort_order, p.created_at,
              COUNT(pv.video_id) AS video_count
              ${videoId ? ", EXISTS(SELECT 1 FROM user_playlist_videos cpv WHERE cpv.playlist_id = p.id AND cpv.video_id = ?) AS has_video" : ""}
       FROM user_playlists p
       LEFT JOIN user_playlist_videos pv ON pv.playlist_id = p.id
       WHERE p.user_id = ?
       GROUP BY p.id, p.portable_uuid, p.name, p.icon, p.sort_order, p.created_at
       ORDER BY p.sort_order ASC, p.name COLLATE NOCASE`,
    ).all(...(videoId ? [videoId] : []), uid);
    return c.json({ playlists: rows });
  });
  api.post("/playlists", async (c) => {
    const uid = currentUserId(c);
    const { name, icon = "ListMusic" } = await c.req.json();
    if (!name?.trim()) return c.json({ error: "name required" }, 400);
    const nextOrder = await database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM user_playlists WHERE user_id = ?").get(uid) as { sort_order: number };
    const row = await database.prepare(
      "INSERT INTO user_playlists (name, icon, sort_order, user_id, portable_uuid) VALUES (?, ?, ?, ?, ?) RETURNING id, portable_uuid, name, icon, sort_order, created_at",
    ).get(name.trim(), String(icon || "ListMusic").trim() || "ListMusic", nextOrder.sort_order, uid, crypto.randomUUID());
    return c.json({ playlist: row });
  });

  api.put("/playlists/:id", async (c) => {
    const uid = currentUserId(c);
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const current = await database.prepare("SELECT * FROM user_playlists WHERE id = ? AND user_id = ?").get(id, uid) as any;
    if (!current) return c.json({ error: "not found" }, 404);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
    const icon = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : current.icon;
    const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : current.sort_order;
    const row = await database.prepare(
      "UPDATE user_playlists SET name = ?, icon = ?, sort_order = ? WHERE id = ? RETURNING id, portable_uuid, name, icon, sort_order, created_at",
    ).get(name, icon, sortOrder, id);
    return c.json({ playlist: row });
  });

  api.delete("/playlists/:id", async (c) => {
    const uid = currentUserId(c);
    await database.prepare("DELETE FROM user_playlists WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
    return c.json({ ok: true });
  });

  api.get("/playlists/:id", async (c) => {
    const uid = currentUserId(c);
    const id = Number(c.req.param("id"));
    const playlist = await database.prepare(
      `SELECT p.id, p.portable_uuid, p.name, p.icon, p.sort_order, p.created_at, COUNT(pv.video_id) AS video_count
       FROM user_playlists p
       LEFT JOIN user_playlist_videos pv ON pv.playlist_id = p.id
       WHERE p.id = ? AND p.user_id = ?
       GROUP BY p.id, p.portable_uuid, p.name, p.icon, p.sort_order, p.created_at`,
    ).get(id, uid) as any;
    if (!playlist) return c.json({ error: "not found" }, 404);
    const rows = await database.prepare(
      `${videoSelect(uid)}
       JOIN user_playlist_videos upv ON upv.video_id = v.video_id
       WHERE upv.playlist_id = ?
       ORDER BY upv.added_at DESC`,
    ).all(id) as VideoRow[];
    return c.json({ playlist, videos: await attachTags(uid, rows) });
  });

  api.post("/playlists/:id/download", async (c) => {
    const uid = currentUserId(c);
    if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
    if (!await profileDownloadsEnabled(uid)) return c.json({ error: "downloads disabled" }, 409);
    const playlist = await database.prepare("SELECT name FROM user_playlists WHERE id = ? AND user_id = ?").get(c.req.param("id"), uid) as { name: string } | null;
    if (!playlist) return c.json({ error: "not found" }, 404);
    const videoIds = (await database.prepare(`
      SELECT v.video_id FROM user_playlist_videos upv
      JOIN videos v ON v.video_id = upv.video_id
      WHERE upv.playlist_id = ? AND v.is_private = 0
        AND v.live_status NOT IN ('live', 'upcoming')
      ORDER BY upv.added_at ASC
    `).all(c.req.param("id")) as { video_id: string }[]).map((row) => row.video_id);
    const result = await enqueuePlaylistDownloads(uid, videoIds, playlist.name);
    log.info("downloads.playlist_queued", { playlistId: c.req.param("id"), playlistTitle: playlist.name, ...result });
    return c.json(result);
  });

  api.post("/playlists/:id/videos", async (c) => {
    const uid = currentUserId(c);
    const { video_id } = await c.req.json();
    if (!video_id) return c.json({ error: "video_id required" }, 400);
    if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
    await database.prepare("INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id) VALUES (?, ?)").run(c.req.param("id"), video_id);
    refreshDiscoveryInBackground(uid);
    return c.json({ ok: true });
  });

  api.delete("/playlists/:id/videos/:videoId", async (c) => {
    const uid = currentUserId(c);
    if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
    await database.prepare("DELETE FROM user_playlist_videos WHERE playlist_id = ? AND video_id = ?").run(c.req.param("id"), c.req.param("videoId"));
    refreshDiscoveryInBackground(uid);
    return c.json({ ok: true });
  });

  api.get("/playlists/:id/rules", async (c) => {
    const uid = currentUserId(c);
    if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
    const rules = await database.prepare("SELECT * FROM user_playlist_rules WHERE playlist_id = ? ORDER BY id").all(c.req.param("id"));
    return c.json({ rules });
  });

  api.post("/playlists/:id/rules", async (c) => {
    const uid = currentUserId(c);
    const { pattern, match_type = "contains", field = "title" } = await c.req.json();
    if (!pattern?.trim()) return c.json({ error: "pattern required" }, 400);
    if (!["contains", "regex"].includes(match_type)) return c.json({ error: "invalid match_type" }, 400);
    if (!["title", "description", "both"].includes(field)) return c.json({ error: "invalid field" }, 400);
    if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
    const row = await database.prepare("INSERT INTO user_playlist_rules (playlist_id, pattern, match_type, field) VALUES (?, ?, ?, ?) RETURNING *")
      .get(c.req.param("id"), pattern.trim(), match_type, field) as any;
    const matched = await applyPlaylistRuleToAllVideos(row.id);
    return c.json({ rule: row, matched });
  });

  api.delete("/playlists/:id/rules/:ruleId", async (c) => {
    const uid = currentUserId(c);
    if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
    await database.prepare("DELETE FROM user_playlist_rules WHERE playlist_id = ? AND id = ?").run(c.req.param("id"), c.req.param("ruleId"));
    return c.json({ ok: true });
  });

  api.post("/playlists/:id/rules/apply", async (c) => {
    const uid = currentUserId(c);
    if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
    const matched = await applyPlaylistRulesForPlaylist(Number(c.req.param("id")));
    return c.json({ ok: true, matched });
  });

  api.get("/playlists/:id/videos", async (c) => {
    try {
      const id = c.req.param("id");
      const videos = await fetchPlaylistVideos(id);
      const sorted = await sortFetchedPlaylistVideos(videos, normalizePlaylistSort(c.req.query("sort")));
      importPlaylistVideos(id).catch((error) => log.error("playlist.import.failed", {
        playlistId: id,
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ videos: await attachWatchedState(currentUserId(c), sorted, (video) => video.videoId) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  });

  api.get("/videos/:id/playlists", async (c) => {
    return c.json({ playlists: await videoPlaylistsForUser(currentUserId(c), c.req.param("id")) });
  });
}
