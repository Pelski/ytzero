import { db } from "./db";
import { checkIsShort, fetchChannelAbout, fetchChannelFeed, fetchChannelPlaylists, fetchChannelVideos, fetchChannelVideosDurations, fetchLiveInfo, fetchPlaylistFeed, fetchVideoInfo } from "./youtube";
import { applyAutoTags } from "./autotags";
import { applyPlaylistRulesToVideo } from "./userPlaylists";
import { applyFilterRules } from "./filterRules";
import { log } from "./logger";

const upsertVideo = db.prepare(`
  INSERT INTO videos (video_id, channel_id, title, description, thumbnail, published_at, views, likes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    thumbnail = excluded.thumbnail,
    published_at = excluded.published_at,
    views = COALESCE(excluded.views, views),
    likes = COALESCE(excluded.likes, likes)
`);

const videoExists = db.prepare("SELECT 1 FROM videos WHERE video_id = ?");

// Politeness limits for the playlist scan during a manual sync, to avoid
// tripping YouTube's rate limiting (HTTP 429).
const MAX_SYNC_PLAYLISTS = 25;
const PLAYLIST_SYNC_DELAY_MS = 800;

// Insert-only: never clobber an existing video's richer fields (e.g. a real
// upload's description) with the sparse data a playlist feed carries.
const insertPlaylistVideo = db.prepare(`
  INSERT OR IGNORE INTO videos (video_id, channel_id, title, description, thumbnail, published_at, views, likes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
export async function importPlaylistVideos(playlistId: string): Promise<{ added: number; channelId: string }> {
  const feed = await fetchPlaylistFeed(playlistId);
  if (!feed.channelId) return { added: 0, channelId: "" };

  ensureChannel.run(feed.channelId, feed.channelTitle, `https://www.youtube.com/channel/${feed.channelId}`);
  const inheritChannelTags = db.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT ?, tag_id, 'channel' FROM channel_tags WHERE channel_id = ?"
  );

  let added = 0;
  const importAll = db.transaction((videos: typeof feed.videos) => {
    for (const v of videos) {
      const res = insertPlaylistVideo.run(
        v.videoId, feed.channelId, v.title, v.description, v.thumbnail, v.publishedAt, v.views, v.likes
      );
      if (res.changes > 0) {
        applyAutoTags(v.videoId, v.title, v.description);
        applyFilterRules(v.videoId, feed.channelId, v.title, v.description);
        applyPlaylistRulesToVideo(v.videoId);
        inheritChannelTags.run(v.videoId, feed.channelId);
        added++;
      }
    }
  });
  importAll(feed.videos);

  if (added > 0) {
    backfillShorts(feed.videos.map((v) => v.videoId)).catch(() => {});
    log.info("playlist.import.added", { playlistId, channelId: feed.channelId, added });
  }
  return { added, channelId: feed.channelId };
}

export async function refreshChannel(channelId: string): Promise<{ added: number }> {
  const startedAt = Date.now();
  let feed: Awaited<ReturnType<typeof fetchChannelFeed>>;
  try {
    feed = await fetchChannelFeed(channelId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("(404)")) {
      const row = db.prepare("SELECT rss_fail_count FROM channels WHERE channel_id = ?").get(channelId) as { rss_fail_count: number } | null;
      const count = (row?.rss_fail_count ?? 0) + 1;
      if (count >= 3) {
        db.prepare("UPDATE channels SET followed = 0, rss_fail_count = ? WHERE channel_id = ?").run(count, channelId);
        log.warn("channel.auto_unfollowed", { channelId, reason: "rss_404_x3" });
      } else {
        db.prepare("UPDATE channels SET rss_fail_count = ? WHERE channel_id = ?").run(count, channelId);
        log.warn("channel.rss_404", { channelId, failCount: count });
      }
    }
    throw e;
  }
  db.prepare("UPDATE channels SET rss_fail_count = 0 WHERE channel_id = ?").run(channelId);
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
    "SELECT 1 FROM videos WHERE channel_id = ? AND duration IS NULL AND live_status = 'none' LIMIT 1"
  ).get(channelId);
  if (missingDuration) {
    fetchChannelVideosDurations(channelId).then((durations) => {
      const upd = db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL");
      for (const d of durations) upd.run(d.duration, d.videoId);
    }).catch(() => {});
  }

  if (feed.channelTitle) {
    db.prepare(
      "UPDATE channels SET title = ?, last_refreshed_at = datetime('now') WHERE channel_id = ? AND title = ''"
    ).run(feed.channelTitle, channelId);
  }
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
      .prepare("SELECT video_id, title FROM videos WHERE is_short IS NULL LIMIT ?")
      .all(limit) as any[];
  }
  const setShort = db.prepare("UPDATE videos SET is_short = ? WHERE video_id = ?");
  for (const r of rows) {
    const short = await checkIsShort(r.video_id, r.title);
    setShort.run(short ? 1 : 0, r.video_id);
    log.info("video.short_checked", { videoId: r.video_id, isShort: short });
    await Bun.sleep(120);
  }
}

export async function refreshLiveStatus(channelId: string) {
  const live = await fetchLiveInfo(channelId);

  // Anything previously live/upcoming on this channel that is no longer the
  // current livestream becomes was_live / none.
  db.prepare(
    `UPDATE videos SET live_status = CASE live_status WHEN 'live' THEN 'was_live' ELSE 'none' END
     WHERE channel_id = ? AND live_status IN ('live', 'upcoming') AND video_id != ?`
  ).run(channelId, live?.videoId ?? "");

  if (!live) return;
  const status = live.isLiveNow ? "live" : live.isUpcoming ? "upcoming" : "was_live";
  const existing = videoExists.get(live.videoId);
  if (existing) {
    db.prepare("UPDATE videos SET live_status = ? WHERE video_id = ?").run(status, live.videoId);
  } else {
    db.prepare(
      `INSERT INTO videos (video_id, channel_id, title, thumbnail, published_at, live_status)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`
    ).run(live.videoId, channelId, live.title, live.thumbnail, status);
    applyAutoTags(live.videoId, live.title, "");
    applyPlaylistRulesToVideo(live.videoId);
    log.info("live.video_added", { channelId, videoId: live.videoId, status, title: live.title });
  }
}

/**
 * Fetch the channel's /videos tab for more video IDs than the RSS feed provides (~30 vs 15).
 * Merges scraped data with RSS data (RSS has better quality: description + published_at).
 */
export async function syncChannel(channelId: string): Promise<{ added: number }> {
  const startedAt = Date.now();
  const [feed, scraped] = await Promise.all([
    fetchChannelFeed(channelId).catch(() => ({ videos: [], channelTitle: "", channelId })),
    fetchChannelVideos(channelId),
  ]);

  const feedMap = new Map(feed.videos.map((v) => [v.videoId, v]));
  const insertOrUpdate = db.prepare(`
    INSERT INTO videos (video_id, channel_id, title, description, thumbnail, published_at, views, likes, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      title = excluded.title,
      thumbnail = excluded.thumbnail,
      views = COALESCE(excluded.views, views),
      duration = COALESCE(excluded.duration, duration)
  `);

  const inheritChannelTags = db.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT ?, tag_id, 'channel' FROM channel_tags WHERE channel_id = ?"
  );

  let added = 0;
  const seen = new Set<string>();

  for (const v of scraped) {
    seen.add(v.videoId);
    const isNew = !videoExists.get(v.videoId);
    const rss = feedMap.get(v.videoId);
    insertOrUpdate.run(
      v.videoId, channelId,
      rss?.title ?? v.title,
      rss?.description ?? "",
      rss?.thumbnail ?? v.thumbnail,
      rss?.publishedAt ?? null,
      rss?.views ?? v.viewCount,
      rss?.likes ?? null,
      v.duration || null,
    );
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
    const playlists = (await fetchChannelPlaylists(channelId)).slice(0, MAX_SYNC_PLAYLISTS);
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

  db.prepare("UPDATE channels SET last_refreshed_at = datetime('now') WHERE channel_id = ?").run(channelId);
  log.info("channel.sync.complete", { channelId, added, scraped: scraped.length, rss: feed.videos.length, playlists: playlistsScanned, ms: Date.now() - startedAt });
  return { added };
}

/**
 * Fetch and save avatar + subscriber count for a small batch of channels,
 * prioritising those not checked recently. Called on a slow background timer.
 */
export async function refreshAvatarsBatch() {
  const rows = db
    .prepare(
      "SELECT channel_id FROM channels ORDER BY COALESCE(avatar_checked_at, '1970-01-01') ASC LIMIT 5"
    )
    .all() as { channel_id: string }[];

  const markChecked = db.prepare(
    "UPDATE channels SET avatar_checked_at = datetime('now') WHERE channel_id = ?"
  );
  const saveAvatar = db.prepare(
    "UPDATE channels SET thumbnail = ?, title = ?, subscriber_count = ?, avatar_checked_at = datetime('now') WHERE channel_id = ?"
  );

  for (let i = 0; i < rows.length; i++) {
    const { channel_id } = rows[i];
    try {
      const about = await fetchChannelAbout(channel_id);
      saveAvatar.run(about.avatar || null, about.title || null, about.stats[0] ?? null, channel_id);
      log.info("channel.avatar_refreshed", { channelId: channel_id, title: about.title });
    } catch (e) {
      markChecked.run(channel_id);
      log.warn("channel.avatar_refresh_failed", { channelId: channel_id, error: e instanceof Error ? e.message : String(e) });
    }
    if (i < rows.length - 1) await Bun.sleep(5_000);
  }
}

/**
 * Backfill `duration` for videos that don't have it yet, one video at a time
 * via the watch page (reliable `lengthSeconds`). This is the backstop for
 * everything the per-channel /videos scrape misses: older uploads beyond the
 * recent tab, RSS-only rows, and externally imported "related" videos.
 * Videos that already have a duration are never touched. Live videos are
 * skipped (no fixed length); shorts are fine to fill — the UI just hides the
 * badge for them. Most-recent first so the active feed fills before the tail.
 */
export async function refreshDurationsBatch(limit = 10) {
  const rows = db
    .prepare(
      `SELECT video_id FROM videos
       WHERE duration IS NULL AND live_status = 'none'
       ORDER BY COALESCE(published_at, '1970-01-01') DESC
       LIMIT ?`
    )
    .all(limit) as { video_id: string }[];
  if (rows.length === 0) return;

  const save = db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL");
  // The fetch succeeded but the video genuinely has no fixed length (e.g. a
  // live/premiere/members video): write an empty string so it reads as
  // "checked, none" and isn't retried every cron tick. Transient fetch errors
  // are left NULL on purpose so they get another chance later.
  const markNone = db.prepare("UPDATE videos SET duration = '' WHERE video_id = ? AND duration IS NULL");

  let filled = 0;
  for (let i = 0; i < rows.length; i++) {
    const { video_id } = rows[i];
    try {
      const info = await fetchVideoInfo(video_id);
      if (info.duration) {
        save.run(info.duration, video_id);
        filled++;
      } else {
        markNone.run(video_id);
      }
    } catch (e) {
      log.warn("video.duration_failed", { videoId: video_id, error: e instanceof Error ? e.message : String(e) });
    }
    if (i < rows.length - 1) await Bun.sleep(800);
  }
  log.info("durations.batch", { checked: rows.length, filled });
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
    const channels = db.prepare(
      "SELECT channel_id FROM channels WHERE followed = 1 ORDER BY COALESCE(last_refreshed_at, '1970-01-01') ASC LIMIT 10"
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

export function startScheduler() {
  setTimeout(() => refreshAll().catch((e) => log.error("refresh.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 3_000);
  setInterval(() => refreshAll().catch((e) => log.error("refresh.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 10 * 60_000);
  log.info("scheduler.feed_refresh", { intervalMin: 10, batchSize: 10 });

  // Avatar cron: fetch 5 channels every 5 minutes, 5 s gap between each
  setTimeout(() => refreshAvatarsBatch().catch((e) => log.error("avatars.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 15_000);
  setInterval(() => refreshAvatarsBatch().catch((e) => log.error("avatars.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 5 * 60_000);
  log.info("scheduler.avatar_refresh", { intervalMin: 5, batchSize: 5 });

  // Duration backfill cron: fill `duration` for videos still missing it,
  // most-recent first, a small polite batch every few minutes.
  const durationBatch = Number(process.env.DURATION_BATCH_SIZE ?? 20);
  const durationIntervalMin = Number(process.env.DURATION_INTERVAL_MINUTES ?? 3);
  setTimeout(() => refreshDurationsBatch(durationBatch).catch((e) => log.error("durations.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 30_000);
  setInterval(() => refreshDurationsBatch(durationBatch).catch((e) => log.error("durations.cron_failed", { error: e instanceof Error ? e.message : String(e) })), durationIntervalMin * 60_000);
  log.info("scheduler.duration_backfill", { intervalMin: durationIntervalMin, batchSize: durationBatch });
}
