import { db } from "./db";
import { checkIsShort, fetchChannelAbout, fetchChannelFeed, fetchChannelPlaylists, fetchChannelStreams, fetchChannelSubscriberCountFromWatch, fetchChannelVideos, fetchChannelVideosDurations, fetchLiveInfo, fetchPlaylistFeed, fetchPlaylistSnapshot, fetchVideoInfo, fetchVideoPublishedAt } from "./youtube";
import { applyAutoTags } from "./autotags";
import { applyPlaylistRulesToVideo } from "./userPlaylists";
import { applyFilterRules } from "./filterRules";
import { log } from "./logger";
import { CHANNEL_PLAYLIST_CACHE_VERSION, ensureChannelPlaylist, saveChannelPlaylists, savePlaylistMemberships } from "./channelPlaylists";
import { preserveChannelMedia, preservePlaylistMedia } from "./channelMedia";

const upsertVideo = db.prepare(`
  INSERT INTO videos (video_id, channel_id, title, description, thumbnail, published_at, views, likes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    thumbnail = CASE WHEN TRIM(excluded.thumbnail) != '' THEN excluded.thumbnail ELSE videos.thumbnail END,
    published_at = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN excluded.published_at ELSE videos.published_at END,
    published_at_approximate = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN 0 ELSE videos.published_at_approximate END,
    views = COALESCE(excluded.views, views),
    likes = COALESCE(excluded.likes, likes)
`);

const videoExists = db.prepare("SELECT 1 FROM videos WHERE video_id = ?");

// Politeness limits for the playlist scan during a manual sync, to avoid
// tripping YouTube's rate limiting (HTTP 429).
const MAX_SYNC_PLAYLISTS = 25;
const PLAYLIST_SYNC_DELAY_MS = 800;
const EXACT_DATE_BACKFILL_LIMIT = 18;
const EXACT_DATE_BACKFILL_CONCURRENCY = 3;
const VIDEO_MAINTENANCE_MAX_AGE_DAYS = positiveNumber(process.env.VIDEO_MAINTENANCE_MAX_AGE_DAYS, 90);
const VIDEO_MAINTENANCE_CUTOFF = `-${VIDEO_MAINTENANCE_MAX_AGE_DAYS} days`;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function backfillExactPublishedDates(channelId: string) {
  const ids = (db.prepare(`
    SELECT video_id FROM videos
    WHERE channel_id = ?
      AND (published_at IS NULL OR published_at = '' OR published_at_approximate = 1)
    ORDER BY
      CASE WHEN published_at IS NULL OR published_at = '' THEN 0 ELSE 1 END,
      created_at DESC,
      published_at DESC
    LIMIT ?
  `).all(channelId, EXACT_DATE_BACKFILL_LIMIT) as { video_id: string }[]).map((row) => row.video_id);
  const update = db.prepare(`
    UPDATE videos
    SET published_at = ?, published_at_approximate = 0
    WHERE video_id = ? AND (published_at IS NULL OR published_at = '' OR published_at_approximate = 1)
  `);
  let recovered = 0;
  for (let i = 0; i < ids.length; i += EXACT_DATE_BACKFILL_CONCURRENCY) {
    await Promise.all(ids.slice(i, i + EXACT_DATE_BACKFILL_CONCURRENCY).map(async (videoId) => {
      try {
        const publishedAt = await fetchVideoPublishedAt(videoId);
        if (publishedAt) recovered += update.run(publishedAt, videoId).changes;
      } catch {
        // Members-only and otherwise restricted videos may not expose a watch
        // payload. Their channel-card relative date remains the honest fallback.
      }
    }));
    if (i + EXACT_DATE_BACKFILL_CONCURRENCY < ids.length) await Bun.sleep(120);
  }
  if (recovered > 0) log.info("video.published_dates_recovered", { requested: ids.length, recovered });
}

async function refreshChannelMetadata(channelId: string, forceSubscriberRefresh = false) {
  const about = await fetchChannelAbout(channelId);
  const watchSubscriber = about.subscriberCount ? null : await fetchChannelSubscriberCountFromWatch(channelId).catch(() => null);
  const subscriberCount = about.subscriberCount || watchSubscriber?.subscriberCount || null;
  const aboutWithSubscriber = subscriberCount && subscriberCount !== about.subscriberCount
    ? { ...about, subscriberCount }
    : about;
  const aboutForStorage = await preserveChannelMedia(channelId, aboutWithSubscriber);
  db.prepare(
    `UPDATE channels SET
       about_json = ?,
       about_fetched_at = datetime('now'),
       thumbnail = COALESCE(?, thumbnail),
       title = COALESCE(?, title),
       subscriber_count = CASE WHEN ? = 1 THEN ? ELSE COALESCE(?, subscriber_count) END,
       avatar_checked_at = datetime('now')
     WHERE channel_id = ?`
  ).run(
    JSON.stringify(aboutForStorage),
    aboutForStorage.avatar || null,
    aboutForStorage.title || null,
    forceSubscriberRefresh ? 1 : 0,
    subscriberCount,
    subscriberCount,
    channelId
  );
  log.info("channel.metadata_refreshed", {
    channelId,
    title: about.title,
    handle: about.handle,
    subscriberCount,
    subscriberCountSource: about.subscriberCount ? "channel-header" : watchSubscriber ? "watch-owner" : null,
    watchOwnerChannelId: watchSubscriber?.ownerChannelId || null,
    hasSubscriberCount: Boolean(subscriberCount),
  });
}

// Playlist snapshots are sparse, while RSS is rich but short. Preserve every
// existing rich value and fill only fields that are still missing.
const insertPlaylistVideo = db.prepare(`
  INSERT INTO videos (video_id, channel_id, title, description, thumbnail, published_at, views, likes, duration)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET
    title = CASE WHEN TRIM(videos.title) = '' THEN excluded.title ELSE videos.title END,
    description = CASE WHEN TRIM(videos.description) = '' THEN excluded.description ELSE videos.description END,
    thumbnail = CASE WHEN TRIM(videos.thumbnail) = '' THEN excluded.thumbnail ELSE videos.thumbnail END,
    published_at = COALESCE(videos.published_at, excluded.published_at),
    views = COALESCE(excluded.views, videos.views),
    likes = COALESCE(excluded.likes, videos.likes),
    duration = CASE
      WHEN (videos.duration IS NULL OR TRIM(videos.duration) = '')
        AND excluded.duration IS NOT NULL AND TRIM(excluded.duration) != ''
      THEN excluded.duration
      ELSE videos.duration
    END
`);

const ensureChannel = db.prepare(`
  INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
  VALUES (?, ?, ?, '', 0, 1)
  ON CONFLICT(channel_id) DO NOTHING
`);

/**
 * Import every video from a playlist feed into the owning channel, skipping
 * duplicates. New videos get the same tagging/rule treatment as RSS uploads.
 * The channel row is created (as external) when not already present.
 */
export async function importPlaylistVideos(playlistId: string, force = false): Promise<{ added: number; channelId: string }> {
  const feed = await fetchPlaylistFeed(playlistId, force);
  if (!feed.channelId) return { added: 0, channelId: "" };
  const snapshot = await fetchPlaylistSnapshot(playlistId, force).catch(() => ({
    videos: feed.videos.map((video, index) => ({
      videoId: video.videoId,
      title: video.title,
      thumbnail: video.thumbnail,
      channelTitle: video.channelTitle || feed.channelTitle,
      channelId: video.channelId || feed.channelId,
      duration: "",
      index,
    })),
    complete: false,
  }));
  const richById = new Map(feed.videos.map((video) => [video.videoId, video]));

  ensureChannel.run(feed.channelId, feed.channelTitle, `https://www.youtube.com/channel/${feed.channelId}`);
  ensureChannelPlaylist(playlistId, feed.channelId);
  db.prepare(`UPDATE channel_playlists SET
      title = CASE WHEN TRIM(?) != '' THEN ? ELSE title END,
      thumbnail = CASE WHEN TRIM(?) != '' THEN ? ELSE thumbnail END,
      video_count = ?, updated_at = datetime('now')
    WHERE playlist_id = ?`).run(
      feed.title, feed.title,
      snapshot.videos[0]?.thumbnail || "", snapshot.videos[0]?.thumbnail || "",
      String(snapshot.videos.length), playlistId,
    );
  const inheritChannelTags = db.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT ?, tag_id, 'channel' FROM channel_tags WHERE channel_id = ?"
  );

  let added = 0;
  const importAll = db.transaction((videos: typeof snapshot.videos) => {
    for (const v of videos) {
      const rich = richById.get(v.videoId);
      const ownerChannelId = v.channelId || rich?.channelId || feed.channelId;
      const ownerChannelTitle = v.channelTitle || rich?.channelTitle || feed.channelTitle;
      ensureChannel.run(ownerChannelId, ownerChannelTitle, `https://www.youtube.com/channel/${ownerChannelId}`);
      const isNew = !videoExists.get(v.videoId);
      insertPlaylistVideo.run(
        v.videoId,
        ownerChannelId,
        rich?.title || v.title,
        rich?.description || "",
        rich?.thumbnail || v.thumbnail,
        rich?.publishedAt || null,
        rich?.views ?? null,
        rich?.likes ?? null,
        v.duration || null,
      );
      if (isNew) {
        applyAutoTags(v.videoId, rich?.title || v.title, rich?.description || "");
        applyFilterRules(v.videoId, ownerChannelId, rich?.title || v.title, rich?.description || "");
        applyPlaylistRulesToVideo(v.videoId);
        inheritChannelTags.run(v.videoId, ownerChannelId);
        added++;
      }
    }
  });
  importAll(snapshot.videos);
  savePlaylistMemberships(playlistId, snapshot.videos.map((video) => video.videoId), snapshot.complete);
  db.prepare("UPDATE channel_playlists SET last_synced_at = datetime('now'), sync_attempted_at = datetime('now') WHERE playlist_id = ?").run(playlistId);

  if (added > 0) {
    backfillShorts(snapshot.videos.map((v) => v.videoId)).catch(() => {});
    log.info("playlist.import.added", { playlistId, channelId: feed.channelId, added });
  }
  return { added, channelId: feed.channelId };
}

const playlistSyncsInFlight = new Map<string, Promise<{ added: number; channelId: string }>>();

export function syncPlaylist(playlistId: string): Promise<{ added: number; channelId: string }> {
  const current = playlistSyncsInFlight.get(playlistId);
  if (current) return current;
  db.prepare("UPDATE channel_playlists SET sync_attempted_at = datetime('now') WHERE playlist_id = ?").run(playlistId);
  const task = importPlaylistVideos(playlistId, true).finally(() => playlistSyncsInFlight.delete(playlistId));
  playlistSyncsInFlight.set(playlistId, task);
  return task;
}

/** Refresh a channel's public playlist catalogue and then every playlist's
 * contents, without scanning the channel's regular videos/shorts tabs. */
export async function syncChannelPlaylists(channelId: string): Promise<{
  playlists: Awaited<ReturnType<typeof fetchChannelPlaylists>>;
  added: number;
  synced: number;
  errors: number;
}> {
  const playlists = await preservePlaylistMedia(channelId, await fetchChannelPlaylists(channelId, true));
  saveChannelPlaylists(channelId, playlists);
  db.prepare("UPDATE channels SET playlists_json = ?, playlists_fetched_at = datetime('now'), playlists_cache_version = ? WHERE channel_id = ?")
    .run(JSON.stringify(playlists), CHANNEL_PLAYLIST_CACHE_VERSION, channelId);

  let added = 0;
  let synced = 0;
  let errors = 0;
  for (let index = 0; index < playlists.length; index++) {
    const playlist = playlists[index];
    try {
      const result = await syncPlaylist(playlist.playlistId);
      added += result.added;
      synced++;
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message : String(error);
      log.warn("channel.playlists_only.playlist_failed", { channelId, playlistId: playlist.playlistId, error: message });
      if (message.includes("429")) break;
    }
    if (index < playlists.length - 1) await Bun.sleep(PLAYLIST_SYNC_DELAY_MS);
  }
  log.info("channel.playlists_only.complete", { channelId, playlists: playlists.length, synced, added, errors });
  return { playlists, added, synced, errors };
}

export async function refreshChannel(channelId: string): Promise<{ added: number }> {
  const startedAt = Date.now();
  const feed = await fetchChannelFeed(channelId);
  const inheritChannelTags = db.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT ?, tag_id, 'channel' FROM channel_tags WHERE channel_id = ?"
  );

  let added = 0;
  for (const v of feed.videos) {
    const isNew = !videoExists.get(v.videoId);
    upsertVideo.run(v.videoId, channelId, v.title, v.description, v.thumbnail, v.publishedAt, v.views, v.likes);
    if (isNew) {
      applyAutoTags(v.videoId, v.title, v.description);
      applyFilterRules(v.videoId, channelId, v.title, v.description);
      applyPlaylistRulesToVideo(v.videoId);
      inheritChannelTags.run(v.videoId, channelId);
      added++;
      log.info("video.added", { source: "rss", channelId, videoId: v.videoId, title: v.title, publishedAt: v.publishedAt });
    }
  }
  await backfillShorts(feed.videos.map((v) => v.videoId));

  const missingDuration = db.prepare(
    `SELECT 1 FROM videos
     WHERE channel_id = ?
       AND (duration IS NULL OR TRIM(duration) = '')
       AND live_status IN ('none', 'was_live')
       AND COALESCE(published_at, created_at) >= datetime('now', ?)
     LIMIT 1`
  ).get(channelId, VIDEO_MAINTENANCE_CUTOFF);
  if (missingDuration) {
    try {
      const durations = await fetchChannelVideosDurations(channelId);
      const upd = db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND (duration IS NULL OR TRIM(duration) = '')");
      for (const d of durations) upd.run(d.duration, d.videoId);
    } catch (error) {
      log.warn("channel.duration_refresh_failed", { channelId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (feed.channelTitle) {
    db.prepare(
      "UPDATE channels SET title = ?, last_refreshed_at = datetime('now') WHERE channel_id = ? AND title = ''"
    ).run(feed.channelTitle, channelId);
  }
  await refreshChannelMetadata(channelId).catch((e) => {
    log.warn("channel.metadata_refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) });
  });
  db.prepare("UPDATE channels SET last_refreshed_at = datetime('now') WHERE channel_id = ?").run(channelId);
  if (added > 0) log.info("channel.refresh.added", { channelId, title: feed.channelTitle, added, ms: Date.now() - startedAt });
  return { added };
}

/**
 * Resolve is_short for videos that haven't been checked yet (is_short IS NULL).
 * Limited per call to stay polite to YouTube; unknowns are treated as regular
 * videos until resolved.
 */
export async function backfillShorts(videoIds?: string[], limit = 50) {
  let rows: { video_id: string; title: string }[];
  if (videoIds && videoIds.length > 0) {
    const ph = videoIds.map(() => "?").join(",");
    rows = db
      .prepare(`SELECT video_id, title FROM videos WHERE is_short IS NULL AND video_id IN (${ph})`)
      .all(...videoIds) as any[];
  } else {
    rows = db
      .prepare(`SELECT video_id, title FROM videos
                WHERE is_short IS NULL
                  AND COALESCE(published_at, created_at) >= datetime('now', ?)
                ORDER BY COALESCE(published_at, created_at) DESC
                LIMIT ?`)
      .all(VIDEO_MAINTENANCE_CUTOFF, limit) as any[];
  }
  const setShort = db.prepare("UPDATE videos SET is_short = ? WHERE video_id = ?");
  for (const r of rows) {
    const short = await checkIsShort(r.video_id, r.title);
    setShort.run(short ? 1 : 0, r.video_id);
    log.info("video.short_checked", { videoId: r.video_id, isShort: short });
    await Bun.sleep(120);
  }
}

export interface ChannelMetadataSyncResult {
  checked: number;
  updated: number;
  dates: number;
  durations: number;
  shorts: number;
  failed: number;
  remaining: number;
}

/** Force-repair only incomplete metadata for videos already stored locally. */
export async function syncChannelMissingMetadata(channelId: string): Promise<ChannelMetadataSyncResult> {
  const rows = db.prepare(`
    SELECT video_id, title, live_status, duration, published_at,
           published_at_approximate, is_short
    FROM videos
    WHERE channel_id = ? AND (
      published_at IS NULL OR published_at = '' OR published_at_approximate = 1
      OR duration IS NULL OR duration = '' OR is_short IS NULL
    )
    ORDER BY created_at DESC, COALESCE(published_at, '1970-01-01') DESC
  `).all(channelId) as {
    video_id: string;
    title: string;
    live_status: string;
    duration: string | null;
    published_at: string | null;
    published_at_approximate: number;
    is_short: number | null;
  }[];

  const saveInfo = db.prepare(`
    UPDATE videos SET
      duration = CASE
        WHEN ? IS NOT NULL AND ? != '' THEN ?
        ELSE duration
      END,
      published_at = CASE
        WHEN ? IS NOT NULL AND ? != '' THEN ?
        ELSE published_at
      END,
      published_at_approximate = CASE
        WHEN ? IS NOT NULL AND ? != '' THEN 0
        ELSE published_at_approximate
      END
    WHERE video_id = ?
  `);
  const savePublishedAt = db.prepare(`
    UPDATE videos SET published_at = ?, published_at_approximate = 0
    WHERE video_id = ? AND (published_at IS NULL OR published_at = '' OR published_at_approximate = 1)
  `);
  const saveShort = db.prepare("UPDATE videos SET is_short = ? WHERE video_id = ? AND is_short IS NULL");
  const updatedVideos = new Set<string>();
  let dates = 0;
  let durations = 0;
  let shorts = 0;
  let failed = 0;
  const concurrency = 3;

  for (let offset = 0; offset < rows.length; offset += concurrency) {
    await Promise.all(rows.slice(offset, offset + concurrency).map(async (row) => {
      let rowFailed = false;
      const needsDate = !row.published_at || row.published_at_approximate === 1;
      const needsDuration = !row.duration && !['live', 'upcoming'].includes(row.live_status);
      if (needsDate || needsDuration) {
        try {
          const info = await fetchVideoInfo(row.video_id);
          const result = saveInfo.run(
            needsDuration ? info.duration : null, needsDuration ? info.duration : null, needsDuration ? info.duration : null,
            needsDate ? info.publishedAt : null, needsDate ? info.publishedAt : null, needsDate ? info.publishedAt : null,
            needsDate ? info.publishedAt : null, needsDate ? info.publishedAt : null,
            row.video_id,
          );
          if (result.changes > 0) {
            if (needsDuration && info.duration) durations++;
            if (needsDate && info.publishedAt) dates++;
            if (info.duration || info.publishedAt) updatedVideos.add(row.video_id);
          }
        } catch {
          try {
            const publishedAt = needsDate ? await fetchVideoPublishedAt(row.video_id) : null;
            if (publishedAt && savePublishedAt.run(publishedAt, row.video_id).changes > 0) {
              dates++;
              updatedVideos.add(row.video_id);
            } else if (needsDuration) {
              rowFailed = true;
            }
          } catch {
            rowFailed = true;
          }
        }
      }

      if (row.is_short == null) {
        try {
          const isShort = await checkIsShort(row.video_id, row.title);
          if (saveShort.run(isShort ? 1 : 0, row.video_id).changes > 0) {
            shorts++;
            updatedVideos.add(row.video_id);
          }
        } catch {
          rowFailed = true;
        }
      }
      if (rowFailed) failed++;
    }));
    if (offset + concurrency < rows.length) await Bun.sleep(180);
  }

  const remaining = (db.prepare(`
    SELECT COUNT(*) AS count FROM videos
    WHERE channel_id = ? AND (
      published_at IS NULL OR published_at = '' OR published_at_approximate = 1
      OR duration IS NULL OR is_short IS NULL
    )
  `).get(channelId) as { count: number }).count;
  const result = { checked: rows.length, updated: updatedVideos.size, dates, durations, shorts, failed, remaining };
  log.info("channel.metadata_sync_complete", { channelId, ...result });
  return result;
}

export async function refreshLiveStatus(channelId: string) {
  const primaryLive = await fetchLiveInfo(channelId);
  // /channel/:id/live resolves to one primary stream even when a channel has
  // many concurrent streams. The /streams cards expose every LIVE badge.
  const streamLives = primaryLive
    ? (await fetchChannelStreams(channelId).catch(() => [])).filter((stream) => stream.isLive)
    : [];
  const active = streamLives.length > 0
    ? streamLives.map((stream) => ({ ...stream, status: "live" as const }))
    : primaryLive
      ? [{ ...primaryLive, status: primaryLive.isLiveNow ? "live" as const : "upcoming" as const }]
      : [];
  const activeIds = active.map((stream) => stream.videoId);

  // Anything previously live/upcoming on this channel that is no longer in
  // the active set becomes was_live / none.
  const inactiveSql = activeIds.length > 0
    ? ` AND video_id NOT IN (${activeIds.map(() => "?").join(",")})`
    : "";
  db.prepare(
    `UPDATE videos SET live_status = CASE live_status WHEN 'live' THEN 'was_live' ELSE 'none' END
     WHERE channel_id = ? AND live_status IN ('live', 'upcoming')${inactiveSql}`
  ).run(channelId, ...activeIds);

  for (const live of active) {
    const existing = videoExists.get(live.videoId);
    if (existing) {
      db.prepare("UPDATE videos SET live_status = ? WHERE video_id = ?").run(live.status, live.videoId);
    } else {
      db.prepare(
        `INSERT INTO videos (video_id, channel_id, title, thumbnail, published_at, live_status)
         VALUES (?, ?, ?, ?, datetime('now'), ?)`
      ).run(live.videoId, channelId, live.title, live.thumbnail, live.status);
      applyAutoTags(live.videoId, live.title, "");
      applyPlaylistRulesToVideo(live.videoId);
      log.info("live.video_added", { channelId, videoId: live.videoId, status: live.status, title: live.title });
    }
  }
}

/**
 * Fetch the channel's /videos tab for more video IDs than the RSS feed provides (~30 vs 15).
 * Merges scraped data with RSS data (RSS has better quality: description + published_at).
 */
const channelSyncsInFlight = new Map<string, Promise<{ added: number }>>();

async function runChannelSync(channelId: string): Promise<{ added: number }> {
  const startedAt = Date.now();
  // A channel page can be opened directly from a YouTube link, before it has
  // been followed or otherwise saved locally. Create an external row first so
  // the video inserts below always have their required parent channel.
  ensureChannel.run(channelId, "", `https://www.youtube.com/channel/${channelId}`);
  db.prepare("UPDATE channels SET full_sync_attempted_at = datetime('now') WHERE channel_id = ?").run(channelId);
  await refreshChannelMetadata(channelId, true).catch((e) => {
    log.warn("channel.metadata_refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) });
  });

  const [feed, scraped, streams] = await Promise.all([
    fetchChannelFeed(channelId).catch(() => ({ videos: [], channelTitle: "", channelId })),
    fetchChannelVideos(channelId),
    fetchChannelStreams(channelId),
  ]);
  // A stream can occasionally also be listed in /videos. Keep one copy while
  // retaining the dedicated /streams results that are otherwise invisible.
  const scrapedVideos = [...new Map([...scraped, ...streams].map((v) => [v.videoId, v])).values()];

  const feedMap = new Map(feed.videos.map((v) => [v.videoId, v]));
  const insertOrUpdate = db.prepare(`
    INSERT INTO videos (video_id, channel_id, title, description, thumbnail, published_at, published_at_approximate, members_only, views, likes, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      title = excluded.title,
      thumbnail = CASE WHEN TRIM(excluded.thumbnail) != '' THEN excluded.thumbnail ELSE videos.thumbnail END,
      published_at = CASE
        WHEN excluded.published_at IS NULL OR excluded.published_at = '' THEN videos.published_at
        WHEN excluded.published_at_approximate = 0 THEN excluded.published_at
        ELSE COALESCE(videos.published_at, excluded.published_at)
      END,
      published_at_approximate = CASE
        WHEN excluded.published_at IS NULL OR excluded.published_at = '' THEN videos.published_at_approximate
        WHEN excluded.published_at_approximate = 0 THEN 0
        WHEN videos.published_at IS NULL OR videos.published_at = '' THEN 1
        ELSE videos.published_at_approximate
      END,
      members_only = excluded.members_only,
      views = COALESCE(excluded.views, views),
      duration = COALESCE(excluded.duration, duration)
  `);
  const markArchivedStream = db.prepare(
    "UPDATE videos SET live_status = 'was_live' WHERE video_id = ? AND live_status = 'none'"
  );

  const inheritChannelTags = db.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT ?, tag_id, 'channel' FROM channel_tags WHERE channel_id = ?"
  );

  let added = 0;
  const seen = new Set<string>();

  for (const v of scrapedVideos) {
    seen.add(v.videoId);
    const isNew = !videoExists.get(v.videoId);
    const rss = feedMap.get(v.videoId);
    const exactPublishedAt = rss?.publishedAt || null;
    const publishedAt = exactPublishedAt ?? v.publishedAt;
    insertOrUpdate.run(
      v.videoId, channelId,
      rss?.title ?? v.title,
      rss?.description ?? "",
      rss?.thumbnail ?? v.thumbnail,
      publishedAt,
      exactPublishedAt ? 0 : publishedAt ? 1 : 0,
      v.membersOnly ? 1 : 0,
      rss?.views ?? v.viewCount,
      rss?.likes ?? null,
      v.duration || null,
    );
    if (v.isStream) {
      if (v.isLive) db.prepare("UPDATE videos SET live_status = 'live' WHERE video_id = ?").run(v.videoId);
      else markArchivedStream.run(v.videoId);
    }
    if (isNew) {
      applyAutoTags(v.videoId, rss?.title ?? v.title, rss?.description ?? "");
      applyFilterRules(v.videoId, channelId, rss?.title ?? v.title, rss?.description ?? "");
      applyPlaylistRulesToVideo(v.videoId);
      inheritChannelTags.run(v.videoId, channelId);
      added++;
      log.info("video.added", { source: "sync", channelId, videoId: v.videoId, title: rss?.title ?? v.title, publishedAt: rss?.publishedAt ?? null });
    }
  }

  // Also add RSS-only videos (not in scraped list) to get description + published_at
  for (const v of feed.videos) {
    if (seen.has(v.videoId)) continue;
    const isNew = !videoExists.get(v.videoId);
    upsertVideo.run(v.videoId, channelId, v.title, v.description, v.thumbnail, v.publishedAt, v.views, v.likes);
    if (isNew) {
      applyAutoTags(v.videoId, v.title, v.description);
      applyFilterRules(v.videoId, channelId, v.title, v.description);
      applyPlaylistRulesToVideo(v.videoId);
      inheritChannelTags.run(v.videoId, channelId);
      added++;
      log.info("video.added", { source: "rss-only", channelId, videoId: v.videoId, title: v.title, publishedAt: v.publishedAt });
    }
  }

  // Surface videos hidden in the channel's playlists — these include older
  // uploads that no longer appear in the RSS feed or /videos tab. Each
  // playlist's videos are imported (deduped) into their owning channel.
  // Throttled and capped to stay under YouTube's rate limiting (429).
  let playlistsScanned = 0;
  try {
    const allPlaylists = await preservePlaylistMedia(channelId, await fetchChannelPlaylists(channelId, true));
    saveChannelPlaylists(channelId, allPlaylists);
    db.prepare("UPDATE channels SET playlists_json = ?, playlists_fetched_at = datetime('now'), playlists_cache_version = ? WHERE channel_id = ?")
      .run(JSON.stringify(allPlaylists), CHANNEL_PLAYLIST_CACHE_VERSION, channelId);
    const playlists = allPlaylists.slice(0, MAX_SYNC_PLAYLISTS);
    for (let i = 0; i < playlists.length; i++) {
      try {
        const r = await importPlaylistVideos(playlists[i].playlistId);
        added += r.added;
        playlistsScanned++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn("channel.sync.playlist_failed", { channelId, playlistId: playlists[i].playlistId, error: msg });
        // Back off entirely once YouTube starts rate-limiting us.
        if (msg.includes("429")) break;
      }
      if (i < playlists.length - 1) await Bun.sleep(PLAYLIST_SYNC_DELAY_MS);
    }
  } catch (e) {
    log.warn("channel.sync.playlists_failed", { channelId, error: e instanceof Error ? e.message : String(e) });
  }

  // Playlist pages expose durations but not publication dates. Run this after
  // importing them so newly discovered videos are repaired in the same sync.
  await backfillExactPublishedDates(channelId);

  // Mark a just-synced current stream immediately, rather than waiting for
  // the periodic live-status refresh before it can appear on the channel page.
  await refreshLiveStatus(channelId);
  db.prepare("UPDATE channels SET last_refreshed_at = datetime('now'), last_full_synced_at = datetime('now') WHERE channel_id = ?").run(channelId);
  log.info("channel.sync.complete", { channelId, added, scraped: scraped.length, streams: streams.length, rss: feed.videos.length, playlists: playlistsScanned, ms: Date.now() - startedAt });
  return { added };
}

/** Full sync shared by the manual button and the background scheduler. Calls
 * for the same channel coalesce instead of scraping YouTube twice in parallel. */
export function syncChannel(channelId: string): Promise<{ added: number }> {
  const current = channelSyncsInFlight.get(channelId);
  if (current) return current;
  const task = runChannelSync(channelId).finally(() => channelSyncsInFlight.delete(channelId));
  channelSyncsInFlight.set(channelId, task);
  return task;
}

/**
 * Fetch and save avatar + subscriber count for a small batch of channels,
 * prioritising those not checked recently. Called on a slow background timer.
 */
export async function refreshAvatarsBatch(limit = 4) {
  const rows = db
    .prepare(
      `SELECT channel_id FROM channels
       WHERE channel_id IN (SELECT channel_id FROM user_channels WHERE followed = 1)
         AND COALESCE(avatar_checked_at, '1970-01-01') <= datetime('now', '-7 days')
         AND COALESCE(avatar_refresh_attempted_at, '1970-01-01') <= datetime('now', '-6 hours')
       ORDER BY COALESCE(avatar_checked_at, '1970-01-01') ASC LIMIT ?`
    )
    .all(limit) as { channel_id: string }[];

  const markAttempted = db.prepare(
    "UPDATE channels SET avatar_refresh_attempted_at = datetime('now') WHERE channel_id = ?"
  );
  const saveAvatar = db.prepare(
    `UPDATE channels SET
       thumbnail = COALESCE(NULLIF(?, ''), thumbnail),
       title = COALESCE(NULLIF(?, ''), title),
       subscriber_count = COALESCE(NULLIF(?, ''), subscriber_count),
       avatar_checked_at = datetime('now'),
       avatar_refresh_attempted_at = datetime('now')
     WHERE channel_id = ?`
  );

  for (let i = 0; i < rows.length; i++) {
    const { channel_id } = rows[i];
    markAttempted.run(channel_id);
    try {
      const about = await preserveChannelMedia(channel_id, await fetchChannelAbout(channel_id));
      saveAvatar.run(about.avatar, about.title, about.subscriberCount, channel_id);
      log.info("channel.avatar_refreshed", { channelId: channel_id, title: about.title });
    } catch (e) {
      log.warn("channel.avatar_refresh_failed", { channelId: channel_id, error: e instanceof Error ? e.message : String(e) });
    }
    if (i < rows.length - 1) await Bun.sleep(5_000);
  }
}

/**
 * Backfill `duration` and exact publication dates one video at a time via the
 * watch page. This is the backstop for recent items the per-channel /videos
 * scrape misses: RSS-only rows, playlist imports and external videos.
 * Automatic maintenance deliberately ignores old, long-settled rows, while
 * newly imported old videos remain eligible by their import date. Videos with
 * complete metadata are untouched. Active/upcoming live videos are skipped,
 * while completed live videos are included once YouTube exposes final data.
 * Most-recent imports are handled first so the active feed fills before the
 * tail.
 *
 * Failed fetches back off exponentially (15m, 30m, ... capped at 6h) so a
 * host whose IP YouTube bot-flags doesn't retry the same videos every cron
 * tick forever. The state is in-memory on purpose: a restart wipes it, giving
 * every video a fresh chance without any schema bookkeeping.
 */
const durationRetry = new Map<string, { attempts: number; nextAt: number }>();
const durationPlaylistRetry = new Map<string, number>();
const DURATION_RETRY_BASE_MS = 15 * 60_000;
const DURATION_RETRY_MAX_MS = 6 * 60 * 60_000;

/**
 * Repair missing durations in bulk from playlist pages before falling back to
 * one watch-page request per video. A full channel sync can discover hundreds
 * of old videos at once; repairing the playlist they came from is both much
 * faster and considerably gentler on YouTube than fetching every watch page.
 */
async function refreshPlaylistDurations(): Promise<number> {
  const now = Date.now();
  const candidates = db.prepare(`
    SELECT cpv.playlist_id, COUNT(*) AS missing_count,
           MAX(v.created_at) AS newest_import
    FROM channel_playlist_videos cpv
    JOIN videos v ON v.video_id = cpv.video_id
    WHERE v.duration IS NULL
      AND v.live_status IN ('none', 'was_live')
      AND (v.published_at >= datetime('now', ?) OR v.created_at >= datetime('now', ?))
    GROUP BY cpv.playlist_id
    ORDER BY newest_import DESC, missing_count DESC
    LIMIT 25
  `).all(VIDEO_MAINTENANCE_CUTOFF, VIDEO_MAINTENANCE_CUTOFF) as { playlist_id: string; missing_count: number }[];
  const candidate = candidates.find((row) => (durationPlaylistRetry.get(row.playlist_id) ?? 0) <= now);
  if (!candidate) return 0;

  try {
    const snapshot = await fetchPlaylistSnapshot(candidate.playlist_id, true);
    const save = db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND (duration IS NULL OR TRIM(duration) = '')");
    let filled = 0;
    db.transaction((videos: typeof snapshot.videos) => {
      for (const video of videos) {
        if (!video.duration) continue;
        const result = save.run(video.duration, video.videoId);
        filled += result.changes;
      }
    })(snapshot.videos);

    // Avoid repeatedly downloading the same large playlist when a handful of
    // unavailable/live entries genuinely have no duration.
    durationPlaylistRetry.set(candidate.playlist_id, now + DURATION_RETRY_MAX_MS);
    log.info("playlist.duration_refresh_complete", {
      playlistId: candidate.playlist_id,
      candidates: candidate.missing_count,
      filled,
    });
    return filled;
  } catch (error) {
    durationPlaylistRetry.set(candidate.playlist_id, now + DURATION_RETRY_BASE_MS);
    log.warn("playlist.duration_refresh_failed", {
      playlistId: candidate.playlist_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function refreshVideoMetadataBatch(limit = 10) {
  await refreshPlaylistDurations();
  const now = Date.now();
  const candidates = db
    .prepare(
      `SELECT video_id, live_status FROM videos
       WHERE (duration IS NULL OR published_at IS NULL OR published_at = '' OR published_at_approximate = 1)
         AND live_status IN ('none', 'was_live')
         AND (published_at >= datetime('now', ?) OR created_at >= datetime('now', ?))
       ORDER BY created_at DESC, COALESCE(published_at, '1970-01-01') DESC
       LIMIT ?`
    )
    .all(VIDEO_MAINTENANCE_CUTOFF, VIDEO_MAINTENANCE_CUTOFF, limit * 3) as { video_id: string; live_status: string }[];
  const rows = candidates
    .filter((r) => (durationRetry.get(r.video_id)?.nextAt ?? 0) <= now)
    .slice(0, limit);
  if (rows.length === 0) return;

  const save = db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL");
  const savePublishedAt = db.prepare(`
    UPDATE videos SET published_at = ?, published_at_approximate = 0
    WHERE video_id = ? AND (published_at IS NULL OR published_at = '' OR published_at_approximate = 1)
  `);
  // The fetch succeeded but the video genuinely has no fixed length (e.g. a
  // live/premiere/members video): write an empty string so it reads as
  // "checked, none" and isn't retried every cron tick. Transient fetch errors
  // are left NULL on purpose so they get another chance later.
  const markNone = db.prepare("UPDATE videos SET duration = '' WHERE video_id = ? AND duration IS NULL");

  let durationsFilled = 0;
  let datesFilled = 0;
  for (let i = 0; i < rows.length; i++) {
    const { video_id, live_status } = rows[i];
    try {
      const info = await fetchVideoInfo(video_id);
      durationRetry.delete(video_id);
      if (info.duration) {
        save.run(info.duration, video_id);
        durationsFilled++;
      } else if (live_status === "none") {
        markNone.run(video_id);
      }
      if (info.publishedAt) datesFilled += savePublishedAt.run(info.publishedAt, video_id).changes;
    } catch (e) {
      // Restricted videos may withhold player details while still exposing a
      // publication date in the watch-page metadata.
      try {
        const publishedAt = await fetchVideoPublishedAt(video_id);
        if (publishedAt) {
          datesFilled += savePublishedAt.run(publishedAt, video_id).changes;
          durationRetry.delete(video_id);
          continue;
        }
      } catch {
        // Fall through to the normal transient-error retry.
      }
      const attempts = (durationRetry.get(video_id)?.attempts ?? 0) + 1;
      const delayMs = Math.min(DURATION_RETRY_BASE_MS * 2 ** (attempts - 1), DURATION_RETRY_MAX_MS);
      durationRetry.set(video_id, { attempts, nextAt: Date.now() + delayMs });
      log.warn("video.metadata_failed", {
        videoId: video_id,
        error: e instanceof Error ? e.message : String(e),
        attempts,
        retryInMin: Math.round(delayMs / 60_000),
      });
    }
    if (i < rows.length - 1) await Bun.sleep(800);
  }
  log.info("video.metadata_batch", { checked: rows.length, durationsFilled, datesFilled });
}

let refreshing = false;

export async function refreshAll(): Promise<{ channels: number; added: number; errors: string[] }> {
  if (refreshing) {
    log.warn("refresh.skipped", { reason: "already_in_progress" });
    return { channels: 0, added: 0, errors: ["refresh already in progress"] };
  }
  refreshing = true;
  const startedAt = Date.now();
  try {
    // Any channel at least one profile follows. A channel followed by several
    // profiles is fetched once here (dedup), then surfaces in each feed.
    const channels = db.prepare(
      `SELECT channel_id FROM channels
       WHERE channel_id IN (SELECT channel_id FROM user_channels WHERE followed = 1)
       ORDER BY COALESCE(last_refreshed_at, '1970-01-01') ASC LIMIT 10`
    ).all() as { channel_id: string }[];
    log.info("refresh.start", { channels: channels.length });
    let added = 0;
    const errors: string[] = [];
    for (const { channel_id } of channels) {
      try {
        const r = await refreshChannel(channel_id);
        added += r.added;
        await refreshLiveStatus(channel_id);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        errors.push(`${channel_id}: ${error}`);
        log.error("channel.refresh_failed", { channelId: channel_id, error });
      }
      await Bun.sleep(1500);
    }
    // Resolve any remaining unchecked videos (e.g. rows from before the
    // shorts column existed).
    await backfillShorts();
    log.info("refresh.complete", { channels: channels.length, added, errors: errors.length, ms: Date.now() - startedAt });
    return { channels: channels.length, added, errors };
  } finally {
    refreshing = false;
  }
}

let liveRefreshing = false;

let scheduledFullSyncRunning = false;
let scheduledPlaylistSyncRunning = false;

/** Run the same deep scan as the channel-page button for one subscribed
 * channel. Attempt time drives rotation so one broken channel cannot starve
 * every channel after it. */
export async function syncNextSubscribedChannel(): Promise<void> {
  if (refreshing) {
    log.info("channel.full_sync.skipped", { reason: "feed_refresh_in_progress" });
    return;
  }
  if (scheduledFullSyncRunning) {
    log.warn("channel.full_sync.skipped", { reason: "already_in_progress" });
    return;
  }
  scheduledFullSyncRunning = true;
  try {
    const channel = db.prepare(`
      SELECT c.channel_id
      FROM channels c
      WHERE c.external = 0
        AND EXISTS (
          SELECT 1 FROM user_channels uc
          WHERE uc.channel_id = c.channel_id AND uc.followed = 1
        )
      ORDER BY COALESCE(c.full_sync_attempted_at, c.last_full_synced_at, '1970-01-01') ASC,
               c.added_at ASC,
               c.channel_id ASC
      LIMIT 1
    `).get() as { channel_id: string } | null;
    if (!channel) {
      log.info("channel.full_sync.skipped", { reason: "no_subscribed_channels" });
      return;
    }
    const startedAt = Date.now();
    log.info("channel.full_sync.start", { channelId: channel.channel_id });
    try {
      const result = await syncChannel(channel.channel_id);
      log.info("channel.full_sync.complete", { channelId: channel.channel_id, added: result.added, ms: Date.now() - startedAt });
    } catch (error) {
      log.error("channel.full_sync.failed", {
        channelId: channel.channel_id,
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - startedAt,
      });
    }
  } finally {
    scheduledFullSyncRunning = false;
  }
}

export async function syncNextFollowedPlaylist(): Promise<void> {
  if (scheduledPlaylistSyncRunning) return;
  scheduledPlaylistSyncRunning = true;
  try {
    const playlist = db.prepare(`
      SELECT cp.playlist_id
      FROM channel_playlists cp
      WHERE EXISTS (SELECT 1 FROM user_followed_playlists ufp WHERE ufp.playlist_id = cp.playlist_id)
      ORDER BY COALESCE(cp.sync_attempted_at, cp.last_synced_at, '1970-01-01') ASC, cp.playlist_id ASC
      LIMIT 1
    `).get() as { playlist_id: string } | null;
    if (!playlist) return;
    try {
      const result = await syncPlaylist(playlist.playlist_id);
      log.info("playlist.sync.complete", { playlistId: playlist.playlist_id, added: result.added });
    } catch (error) {
      log.warn("playlist.sync.failed", { playlistId: playlist.playlist_id, error: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    scheduledPlaylistSyncRunning = false;
  }
}

/**
 * Check live status for all followed channels. Runs on a short interval
 * independent of the full feed refresh. Channels currently live or upcoming
 * are checked first so a stream that just started surfaces quickly.
 */
export async function refreshAllLiveStatuses(): Promise<void> {
  if (liveRefreshing) return;
  liveRefreshing = true;
  try {
    // Prioritise channels that are already live/upcoming so we keep them
    // up-to-date, then channels that have ever gone live (was_live), then rest.
    const channels = db.prepare(`
      SELECT DISTINCT c.channel_id,
        CASE
          WHEN EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = c.channel_id AND v.live_status IN ('live','upcoming')) THEN 0
          WHEN EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = c.channel_id AND v.live_status = 'was_live') THEN 1
          ELSE 2
        END AS priority
      FROM channels c
      WHERE c.channel_id IN (SELECT channel_id FROM user_channels WHERE followed = 1) AND c.external = 0
      ORDER BY priority ASC, c.channel_id ASC
    `).all() as { channel_id: string; priority: number }[];

    log.info("live.refresh_start", { channels: channels.length });
    for (const { channel_id } of channels) {
      try {
        await refreshLiveStatus(channel_id);
      } catch (e) {
        log.error("live.refresh_failed", { channelId: channel_id, error: e instanceof Error ? e.message : String(e) });
      }
      await Bun.sleep(800);
    }
    log.info("live.refresh_complete", { channels: channels.length });
  } finally {
    liveRefreshing = false;
  }
}

export function startScheduler() {
  const refreshIntervalMin = positiveNumber(process.env.REFRESH_INTERVAL_MINUTES, 5);
  setTimeout(() => refreshAll().catch((e) => log.error("refresh.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 3_000);
  setInterval(() => refreshAll().catch((e) => log.error("refresh.cron_failed", { error: e instanceof Error ? e.message : String(e) })), refreshIntervalMin * 60_000);
  log.info("scheduler.feed_refresh", { intervalMin: refreshIntervalMin, batchSize: 10 });

  const fullSyncIntervalMin = positiveNumber(process.env.FULL_SYNC_INTERVAL_MINUTES, 15);
  const runFullSync = () => {
    syncNextSubscribedChannel()
      .catch((e) => log.error("channel.full_sync.cron_failed", { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setTimeout(runFullSync, fullSyncIntervalMin * 60_000));
  };
  setTimeout(runFullSync, 60_000);
  log.info("scheduler.channel_full_sync", { intervalMin: fullSyncIntervalMin, batchSize: 1 });

  const playlistSyncIntervalMin = positiveNumber(process.env.PLAYLIST_SYNC_INTERVAL_MINUTES, 15);
  const runPlaylistSync = () => {
    syncNextFollowedPlaylist()
      .catch((e) => log.error("playlist.sync.cron_failed", { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setTimeout(runPlaylistSync, playlistSyncIntervalMin * 60_000));
  };
  setTimeout(runPlaylistSync, 90_000);
  log.info("scheduler.playlist_sync", { intervalMin: playlistSyncIntervalMin, batchSize: 1 });

  const avatarBatch = positiveNumber(process.env.AVATAR_REFRESH_BATCH_SIZE, 4);
  const avatarIntervalMin = positiveNumber(process.env.AVATAR_REFRESH_INTERVAL_MINUTES, 60);
  setTimeout(() => refreshAvatarsBatch(avatarBatch).catch((e) => log.error("avatars.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 120_000);
  setInterval(() => refreshAvatarsBatch(avatarBatch).catch((e) => log.error("avatars.cron_failed", { error: e instanceof Error ? e.message : String(e) })), avatarIntervalMin * 60_000);
  log.info("scheduler.avatar_refresh", { intervalMin: avatarIntervalMin, batchSize: avatarBatch, maxAgeDays: 7 });

  const liveIntervalMin = positiveNumber(process.env.LIVE_INTERVAL_MINUTES, 3);
  setTimeout(() => refreshAllLiveStatuses().catch((e) => log.error("live.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 15_000);
  setInterval(() => refreshAllLiveStatuses().catch((e) => log.error("live.cron_failed", { error: e instanceof Error ? e.message : String(e) })), liveIntervalMin * 60_000);
  log.info("scheduler.live_refresh", { intervalMin: liveIntervalMin });


  // Metadata backfill: fill missing duration and publication dates,
  // most-recently imported first, in a polite batch every few minutes.
  const durationBatch = positiveNumber(process.env.DURATION_BATCH_SIZE, 20);
  const durationIntervalMin = positiveNumber(process.env.DURATION_INTERVAL_MINUTES, 3);
  setTimeout(() => refreshVideoMetadataBatch(durationBatch).catch((e) => log.error("video_metadata.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 30_000);
  setInterval(() => refreshVideoMetadataBatch(durationBatch).catch((e) => log.error("video_metadata.cron_failed", { error: e instanceof Error ? e.message : String(e) })), durationIntervalMin * 60_000);
  log.info("scheduler.video_metadata_backfill", {
    intervalMin: durationIntervalMin,
    batchSize: durationBatch,
    maxAgeDays: VIDEO_MAINTENANCE_MAX_AGE_DAYS,
  });
}
