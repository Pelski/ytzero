import type { Context, Hono } from "hono";
import { publishAppEvent } from "../appEvents";
import { database } from "../database";
import { getUserSetting } from "../db";
import { fetchChannelAbout, fetchChannelFeed, fetchVideoChapters, fetchVideoCreators, fetchVideoInfo } from "../youtube";
import { discoveryRecommendations, dismissDiscoveryRecommendation, recommendationFeed, refreshDiscoveryInBackground, refreshDiscoveryNow } from "../plugins";
import { fetchVideoComments, validYouTubeVideoId, VideoCommentsError } from "../youtubeComments";
import { childDownloadsOnly, childHidesLive, childLocalOnly, isChildUser, isParentLocked } from "../childTime";
import { followedExists } from "../feedQuery";
import { getDeArrowBranding } from "../dearrow";
import { log } from "../logger";
import { ageMs, CHAPTERS_DB_TTL, CREATORS_DB_TTL } from "../routeCache";
import { videoExistsStmt, videoSelect, type VideoRow } from "../videoRoutesSupport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerVideoRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    isAdmin: (context: ApiContext) => boolean;
    attachTags: (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;
  },
): void {
  const { currentUserId, isAdmin, attachTags } = access;

api.get("/recommendations", async (c) => {
  const uid = currentUserId(c);
  const requestedPage = Number(c.req.query("page") ?? 0);
  const requestedLimit = Number(c.req.query("limit") ?? 40);
  const page = Number.isFinite(requestedPage) ? Math.max(0, Math.floor(requestedPage)) : 0;
  const limit = Number.isFinite(requestedLimit) ? Math.min(60, Math.max(1, Math.floor(requestedLimit))) : 40;
  const data = await recommendationFeed(uid, {
    page,
    limit,
    refresh: page === 0 && c.req.query("refresh") === "1",
    allowExternal: !childLocalOnly(uid),
    downloadsOnly: childDownloadsOnly(uid),
  });

  // Hydrate the ranked ids through the same complete per-profile projection as
  // Feed (download state, progress, source playlist, channel metadata), then
  // restore the deterministic ranking order. Scores/reasons stay server-side.
  const ids = data.recommendations
    .map((recommendation) => recommendation.video?.video_id as string | undefined)
    .filter((id): id is string => Boolean(id));
  let videos: Awaited<ReturnType<typeof attachTags>> = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await database.prepare(`${videoSelect(uid)}
      WHERE v.video_id IN (${placeholders})
        AND v.is_short = 0 AND v.live_status = 'none' AND COALESCE(v.is_private, 0) = 0
    `).all(...ids) as VideoRow[];
    const tagged = await attachTags(uid, rows);
    const byId = new Map(tagged.map((video) => [video.video_id, video]));
    videos = ids.map((id) => byId.get(id)).filter((video): video is (typeof tagged)[number] => Boolean(video));
  }

  return c.json({
    enabled: data.enabled,
    external_enabled: data.external_enabled,
    videos,
    page: data.page,
    limit: data.limit,
    has_more: data.has_more,
    summary: data.summary,
  });
});

api.get("/discovery/recommendations", async (c) => {
  const uid = currentUserId(c);
  // Discovery mixes in external videos — off for restricted child profiles.
  if (childLocalOnly(uid)) return c.json({ enabled: false, recommendations: [] });
  const data = c.req.query("refresh") === "1"
    ? await refreshDiscoveryNow(uid)
    : await discoveryRecommendations(uid);
  const localVideos = data.recommendations
    .filter((r) => r.kind === "local" && r.video)
    .map((r) => r.video as VideoRow);
  const tagged = await attachTags(uid, localVideos);
  let localIndex = 0;
  return c.json({
    enabled: data.enabled,
    recommendations: data.recommendations.map((r) => {
      if (r.kind !== "local") return r;
      return { ...r, video: tagged[localIndex++] };
    }),
  });
});

api.post("/discovery/recommendations/:id/dismiss", async (c) => {
  await dismissDiscoveryRecommendation(currentUserId(c), c.req.param("id"));
  return c.json({ ok: true });
});

api.get("/live", async (c) => {
  const uid = currentUserId(c);
  if (childHidesLive(uid)) return c.json({ videos: [] });
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE v.live_status IN ('live','upcoming') AND ${followedExists(uid)} ORDER BY v.live_status = 'live' DESC, v.published_at DESC`)
    .all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

// Unlike the global Live page, a channel page can be opened before the channel
// is followed, so this intentionally does not require a subscription.
api.get("/channels/:id/live", async (c) => {
  const uid = currentUserId(c);
  if (childHidesLive(uid)) return c.json({ videos: [] });
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE v.channel_id = ? AND v.live_status = 'live' ORDER BY COALESCE(v.published_at, v.created_at) DESC`)
    .all(c.req.param("id")) as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

api.get("/watchlist", async (c) => {
  const uid = currentUserId(c);
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE uv.status = 'queued' ORDER BY uv.queued_at DESC`)
    .all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

api.get("/archive", async (c) => {
  const uid = currentUserId(c);
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE uv.status = 'archived' ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT 60 OFFSET ?`)
    .all(page * 60) as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows), page });
});

// External ("orphan") videos pulled in for one-off watching: anything that
// belongs to an external channel (not followed, brought in just to watch).
// Watched ones (with a saved position) float to the top.
api.get("/external", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const uid = currentUserId(c);
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE c.external = 1
      ORDER BY (uv.watch_position IS NOT NULL) DESC, v.created_at DESC LIMIT 200`)
    .all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

// Clear orphan externals. Protects anything the user actively saved
// (queued, liked or added to a playlist), then drops now-empty external channels.
api.delete("/external", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  // Protect anything ANY profile actively saved (queued, liked, or in a playlist).
  const res = await database.prepare(`
    DELETE FROM videos
    WHERE channel_id IN (SELECT channel_id FROM channels WHERE external = 1)
      AND video_id NOT IN (SELECT video_id FROM user_videos WHERE status = 'queued' OR liked = 1)
      AND video_id NOT IN (SELECT video_id FROM user_playlist_videos)
      AND video_id NOT IN (SELECT video_id FROM social_posts)
  `).run();
  await database.prepare(`
    DELETE FROM channels
    WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)
  `).run();
  return c.json({ deleted: res.changes });
});

// Remove a single external video, then drop its channel if now empty + external.
api.delete("/external/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const id = c.req.param("id");
  if (await database.prepare("SELECT 1 FROM social_posts WHERE video_id=? LIMIT 1").get(id)) {
    return c.json({ error: "video is shared in Social", code: "social_video_in_use" }, 409);
  }
  const res = await database.prepare(`
    DELETE FROM videos
    WHERE video_id = ?
      AND channel_id IN (SELECT channel_id FROM channels WHERE external = 1)
  `).run(id);
  await database.prepare(`
    DELETE FROM channels
    WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)
  `).run();
  return c.json({ deleted: res.changes });
});

api.get("/videos/:id/info", async (c) => {
  const uid = currentUserId(c);
  // Restricted child profiles may only open videos already in the library.
  if (childLocalOnly(uid) && !await videoExistsStmt.get(c.req.param("id"))) {
    return c.json({ error: "restricted" }, 403);
  }
  try {
    const info = await fetchVideoInfo(c.req.param("id"));
    if (childHidesLive(uid) && info.liveStatus !== "none") {
      return c.json({ error: "live streams are disabled for this profile" }, 403);
    }
    // Channel avatar + the channel's recent uploads (for the "related" panel).
    const [about, feed] = await Promise.all([
      fetchChannelAbout(info.channelId).catch(() => null),
      fetchChannelFeed(info.channelId).catch(() => null),
    ]);
    const avatar = about?.avatar ?? "";

    // Upsert channel: insert as external if new, or update avatar if missing
    await database.prepare(`
      INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
      VALUES (?, ?, ?, ?, 0, 1)
      ON CONFLICT(channel_id) DO UPDATE SET
        thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL
                         THEN excluded.thumbnail ELSE channels.thumbnail END
    `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, avatar);

    const insertVideo = database.prepare(`
      INSERT OR IGNORE INTO videos
        (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, external)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'inbox', ?, ?, 1)
    `);

    // Insert the watched video (no-op if already in DB as a real video)
    const inserted = await insertVideo.run(
      info.videoId, info.channelId, info.title, info.description,
      info.thumbnail, info.publishedAt, info.liveStatus, info.viewCount, info.duration
    );
    if (info.duration) {
      await database.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL")
        .run(info.duration, info.videoId);
    }

    // Insert the channel's recent uploads as external so the related panel fills.
    if (feed) {
      const insertMany = database.transaction(async (videos: typeof feed.videos) => {
        for (const v of videos) {
          await insertVideo.run(
            v.videoId, info.channelId, v.title, v.description,
            v.thumbnail, v.publishedAt, "none", v.views, null
          );
        }
      });
      await insertMany(feed.videos);
    }
    log.info("external.video_info_loaded", {
      videoId: info.videoId,
      channelId: info.channelId,
      inserted: inserted.changes > 0,
      relatedImported: feed?.videos.length ?? 0,
    });
    return c.json({ info });
  } catch (e) {
    log.error("external.video_info_failed", { videoId: c.req.param("id"), error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.get("/videos/:id/dearrow", async (c) => {
  const uid = currentUserId(c);
  const titlesEnabled = getUserSetting(uid, "dearrow_titles_enabled") === "1";
  const thumbnailsEnabled = getUserSetting(uid, "dearrow_thumbnails_enabled") === "1";
  if (!titlesEnabled && !thumbnailsEnabled) return c.json({ title: null, thumbnail: null });
  const videoId = c.req.param("id");
  if (!validYouTubeVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
  const branding = await getDeArrowBranding(videoId);
  return c.json({
    title: titlesEnabled ? branding.title : null,
    thumbnail: thumbnailsEnabled ? branding.thumbnail : null,
  });
});

async function refreshVideoChapters(videoId: string) {
  const chapters = await fetchVideoChapters(videoId);
  // Persist only when the video is in our DB (UPDATE no-ops otherwise).
  await database.prepare("UPDATE videos SET chapters_json = ?, chapters_fetched_at = datetime('now') WHERE video_id = ?")
    .run(JSON.stringify(chapters), videoId);
  return chapters;
}

api.get("/videos/:id/chapters", async (c) => {
  const videoId = c.req.param("id");
  const cached = await database.prepare("SELECT chapters_json, chapters_fetched_at, is_private FROM videos WHERE video_id = ?")
    .get(videoId) as { chapters_json: string | null; chapters_fetched_at: string | null; is_private: number } | null;
  if (cached?.is_private === 1) return c.json({ chapters: [] });

  if (cached?.chapters_json) {
    if (ageMs(cached.chapters_fetched_at) > CHAPTERS_DB_TTL) {
      refreshVideoChapters(videoId).catch((error) => {
        log.warn("video.chapters_background_refresh_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
      });
    }
    try {
      return c.json({ chapters: JSON.parse(cached.chapters_json) });
    } catch { /* corrupted cache — fall through */ }
  }

  try {
    return c.json({ chapters: await refreshVideoChapters(videoId) });
  } catch {
    return c.json({ chapters: [] });
  }
});

api.get("/videos/:id/comments", async (c) => {
  const videoId = c.req.param("id");
  if (!validYouTubeVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
  if (childLocalOnly(currentUserId(c))) return c.json({ error: "restricted" }, 403);
  try {
    return c.json(await fetchVideoComments(currentUserId(c), videoId, c.req.query("refresh") === "1"));
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

interface StoredVideoCreator {
  channelId: string;
  title: string;
  avatar: string;
  subscriberCount: string;
  handle: string;
  isOwner: boolean;
}

async function storedVideoCreators(videoId: string): Promise<StoredVideoCreator[]> {
  return (await database.prepare(`
    SELECT vc.channel_id AS channelId,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS title,
           c.thumbnail AS avatar,
           COALESCE(c.subscriber_count, '') AS subscriberCount,
           COALESCE(vc.handle, '') AS handle,
           vc.is_owner AS isOwner
    FROM video_creators vc
    JOIN channels c ON c.channel_id = vc.channel_id
    WHERE vc.video_id = ?
    ORDER BY vc.sort_order, vc.channel_id
  `).all(videoId) as (Omit<StoredVideoCreator, "isOwner"> & { isOwner: number })[])
    .map((creator) => ({ ...creator, isOwner: creator.isOwner === 1 }));
}

api.get("/videos/:id/creators", async (c) => {
  const videoId = c.req.param("id");
  const video = await database.prepare(`
    SELECT v.video_id, v.channel_id,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS title,
           c.thumbnail AS avatar,
           COALESCE(c.subscriber_count, '') AS subscriberCount,
           v.creators_fetched_at, v.is_private
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `).get(videoId) as {
    video_id: string;
    channel_id: string;
    title: string;
    avatar: string;
    subscriberCount: string;
    creators_fetched_at: string | null;
    is_private: number;
  } | null;
  if (!video) return c.json({ error: "not found" }, 404);

  const fallback: StoredVideoCreator = {
    channelId: video.channel_id,
    title: video.title,
    avatar: video.avatar,
    subscriberCount: video.subscriberCount,
    handle: "",
    isOwner: true,
  };
  if (video.is_private === 1) return c.json({ creators: [fallback] });
  const cached = await storedVideoCreators(videoId);
  const missingCollaboratorHandles = cached.length > 1 && cached.some((creator) => !creator.handle);
  if (cached.length > 0 && !missingCollaboratorHandles && ageMs(video.creators_fetched_at) <= CREATORS_DB_TTL) {
    return c.json({ creators: cached });
  }

  try {
    const fetched = await fetchVideoCreators(videoId);
    const creators = fetched.length > 1 ? fetched : [fallback];
    await database.transaction(async () => {
      await database.prepare("DELETE FROM video_creators WHERE video_id = ?").run(videoId);
      const ensureChannel = database.prepare(`
        INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
        VALUES (?, ?, ?, ?, 0, 1)
        ON CONFLICT(channel_id) DO UPDATE SET
          title = CASE WHEN channels.title = '' THEN excluded.title ELSE channels.title END,
          thumbnail = CASE WHEN channels.thumbnail = '' THEN excluded.thumbnail ELSE channels.thumbnail END
      `);
      const addCreator = database.prepare(`
        INSERT INTO video_creators (video_id, channel_id, handle, sort_order, is_owner) VALUES (?, ?, ?, ?, ?)
      `);
      for (const [index, creator] of creators.entries()) {
        await ensureChannel.run(
          creator.channelId,
          creator.title,
          `https://www.youtube.com/channel/${creator.channelId}`,
          creator.avatar,
        );
        await addCreator.run(videoId, creator.channelId, creator.handle, index, creator.isOwner ? 1 : 0);
      }
      await database.prepare("UPDATE videos SET creators_fetched_at = datetime('now') WHERE video_id = ?").run(videoId);
    })();
    return c.json({ creators: await storedVideoCreators(videoId) });
  } catch (error) {
    log.warn("video.creators.fetch_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
    return c.json({ creators: cached.length > 0 ? cached : [fallback] });
  }
});

api.get("/videos/:id", async (c) => {
  const uid = currentUserId(c);
  const row = await database
    .prepare(`${videoSelect(uid)} WHERE v.video_id = ?`)
    .get(c.req.param("id")) as VideoRow | null;
  if (!row) return c.json({ error: "not found" }, 404);
  if (childHidesLive(uid) && (row.live_status === "live" || row.live_status === "upcoming")) {
    return c.json({ error: "live streams are disabled for this profile" }, 403);
  }
  const [video] = await attachTags(uid, [row]);

  // Collect all tag IDs for this video (direct + via channel)
  const tagRows = await database.prepare(`
    SELECT DISTINCT x.tag_id FROM (
      SELECT tag_id FROM video_tags WHERE video_id = ?
      UNION
      SELECT tag_id FROM channel_tags WHERE channel_id = ?
    ) x JOIN tags t ON t.id = x.tag_id AND t.user_id = ?
  `).all(row.video_id, row.channel_id, uid) as { tag_id: number }[];

  const RELATED_TARGET = 15;
  const seen = new Set<string>([row.video_id]);
  const related: VideoRow[] = [];

  const fill = (rows: VideoRow[]) => {
    for (const r of rows) {
      if (seen.has(r.video_id) || r.is_short !== 0 || r.watched === 1) continue;
      seen.add(r.video_id);
      related.push(r);
      if (related.length >= RELATED_TARGET) break;
    }
  };

  const need = () => RELATED_TARGET - related.length;

  // Step 1 — same tags (own + channel-inherited), non-archived, most recent
  if (tagRows.length > 0) {
    const tagIds = tagRows.map((t) => t.tag_id);
    const ph = tagIds.map(() => "?").join(",");
    fill(await database.prepare(
      `${videoSelect(uid)} WHERE v.video_id != ? AND v.published_at IS NOT NULL AND v.published_at != '' AND COALESCE(uv.status, 'inbox') != 'archived' AND COALESCE(uv.watched, 0) != 1 AND v.is_short = 0
       AND (EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
         OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))
       ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`
    ).all(row.video_id, ...tagIds, ...tagIds, RELATED_TARGET) as VideoRow[]);
  }

  // Step 2 — same channel, fill what's missing
  if (need() > 0) {
    const seenPh = [...seen].map(() => "?").join(",");
    fill(await database.prepare(
      `${videoSelect(uid)} WHERE v.channel_id = ? AND v.video_id NOT IN (${seenPh}) AND v.published_at IS NOT NULL AND v.published_at != '' AND COALESCE(uv.status, 'inbox') != 'archived' AND COALESCE(uv.watched, 0) != 1 AND v.is_short = 0
       ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`
    ).all(row.channel_id, ...seen, need()) as VideoRow[]);
  }

  // Step 3 — other channels with any shared tag, fill what's missing
  if (need() > 0 && tagRows.length > 0) {
    const tagIds = tagRows.map((t) => t.tag_id);
    const ph = tagIds.map(() => "?").join(",");
    const seenPh = [...seen].map(() => "?").join(",");
    fill(await database.prepare(
      `${videoSelect(uid)} WHERE v.video_id NOT IN (${seenPh}) AND v.published_at IS NOT NULL AND v.published_at != '' AND COALESCE(uv.status, 'inbox') != 'archived' AND COALESCE(uv.watched, 0) != 1 AND v.is_short = 0
       AND (EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
         OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))
       ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`
    ).all(...seen, ...tagIds, ...tagIds, need()) as VideoRow[]);
  }

  // Step 4 — any recent non-archived non-short inbox/queued videos
  if (need() > 0) {
    const seenPh = [...seen].map(() => "?").join(",");
    fill(await database.prepare(
      `${videoSelect(uid)} WHERE v.video_id NOT IN (${seenPh}) AND v.published_at IS NOT NULL AND v.published_at != '' AND COALESCE(uv.status, 'inbox') != 'archived' AND COALESCE(uv.watched, 0) != 1 AND v.is_short = 0
       ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`
    ).all(...seen, need()) as VideoRow[]);
  }

  // Active profile's channel-level player overrides (NULL = use global).
  const channelPlayerRow = await database.prepare(
    "SELECT playback_speed, caption_mode, caption_language FROM user_channels WHERE user_id = ? AND channel_id = ?"
  ).get(uid, row.channel_id) as { playback_speed: string | null; caption_mode: string | null; caption_language: string | null } | null;
  (video as any).channel_playback_speed = channelPlayerRow?.playback_speed ?? null;
  (video as any).channel_caption_mode = channelPlayerRow?.caption_mode ?? null;
  (video as any).channel_caption_language = channelPlayerRow?.caption_language ?? null;

  return c.json({ video, related: await attachTags(uid, related) });
});

}
