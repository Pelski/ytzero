import { db } from "./db";
import { checkIsShort, fetchChannelAbout, fetchChannelFeed, fetchChannelPlaylists, fetchChannelStreams, fetchChannelSubscriberCountFromWatch, fetchChannelVideos, fetchChannelVideosDurations, fetchLiveInfo, fetchPlaylistFeed, fetchVideoInfo, fetchVideoPublishedAt } from "./youtube";
import { applyAutoTags } from "./autotags";
import { applyPlaylistRulesToVideo } from "./userPlaylists";
import { applyFilterRules } from "./filterRules";
import { log } from "./logger";
import { ensureChannelPlaylist, saveChannelPlaylists, savePlaylistMemberships } from "./channelPlaylists";

const upsertVideo = db.prepare(`
  INSERT INTO videos (video_id, channel_id, title, description, thumbnail, published_at, views, likes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    thumbnail = excluded.thumbnail,
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
    ORDER BY COALESCE(published_at, '1970-01-01') DESC
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
  const aboutForStorage = subscriberCount && subscriberCount !== about.subscriberCount
    ? { ...about, subscriberCount }
    : about;
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
    about.avatar || null,
    about.title || null,
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
  ensureChannelPlaylist(playlistId, feed.channelId);
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
  savePlaylistMemberships(playlistId, feed.videos.map((video) => video.videoId));

  if (added > 0) {
    backfillShorts(feed.videos.map((v) => v.videoId)).catch(() => {});
    log.info("playlist.import.added", { playlistId, channelId: feed.channelId, added });
  }
  return { added, channelId: feed.channelId };
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
       AND duration IS NULL
       AND live_status IN ('none', 'was_live')
       AND COALESCE(published_at, created_at) >= datetime('now', ?)
     LIMIT 1`
  ).get(channelId, VIDEO_MAINTENANCE_CUTOFF);
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
      thumbnail = excluded.thumbnail,
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

  await backfillExactPublishedDates(channelId);

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
    const allPlaylists = await fetchChannelPlaylists(channelId);
    saveChannelPlaylists(channelId, allPlaylists);
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
export async function refreshAvatarsBatch() {
  const rows = db
    .prepare(
      `SELECT channel_id FROM channels
       WHERE channel_id IN (SELECT channel_id FROM user_channels WHERE followed = 1)
       ORDER BY COALESCE(avatar_checked_at, '1970-01-01') ASC LIMIT 2`
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
      saveAvatar.run(about.avatar || null, about.title || null, about.subscriberCount || null, channel_id);
      log.info("channel.avatar_refreshed", { channelId: channel_id, title: about.title });
    } catch (e) {
      markChecked.run(channel_id);
      log.warn("channel.avatar_refresh_failed", { channelId: channel_id, error: e instanceof Error ? e.message : String(e) });
    }
    if (i < rows.length - 1) await Bun.sleep(20_000);
  }
}

/**
 * Backfill `duration` for videos that don't have it yet, one video at a time
 * via the watch page (reliable `lengthSeconds`). This is the backstop for
 * recent items the per-channel /videos scrape misses: RSS-only rows and
 * externally imported "related" videos. Automatic maintenance deliberately
 * ignores old rows; opening a video still resolves its metadata on demand.
 * Videos that already have a duration are never touched. Active/upcoming live
 * videos are skipped (no fixed length yet), but completed live videos are
 * included once YouTube exposes their final length. Shorts are fine to fill —
 * the UI just hides the badge for them. Most-recent first so the active feed
 * fills before the tail.
 *
 * Failed fetches back off exponentially (15m, 30m, ... capped at 6h) so a
 * host whose IP YouTube bot-flags doesn't retry the same videos every cron
 * tick forever. The state is in-memory on purpose: a restart wipes it, giving
 * every video a fresh chance without any schema bookkeeping.
 */
const durationRetry = new Map<string, { attempts: number; nextAt: number }>();
const DURATION_RETRY_BASE_MS = 15 * 60_000;
const DURATION_RETRY_MAX_MS = 6 * 60 * 60_000;
export async function refreshDurationsBatch(limit = 10) {
  const now = Date.now();
  const candidates = db
    .prepare(
      `SELECT video_id, live_status FROM videos
       WHERE duration IS NULL
         AND live_status IN ('none', 'was_live')
         AND COALESCE(published_at, created_at) >= datetime('now', ?)
       ORDER BY COALESCE(published_at, '1970-01-01') DESC
       LIMIT ?`
    )
    .all(VIDEO_MAINTENANCE_CUTOFF, limit * 3) as { video_id: string; live_status: string }[];
  const rows = candidates
    .filter((r) => (durationRetry.get(r.video_id)?.nextAt ?? 0) <= now)
    .slice(0, limit);
  if (rows.length === 0) return;

  const save = db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL");
  // The fetch succeeded but the video genuinely has no fixed length (e.g. a
  // live/premiere/members video): write an empty string so it reads as
  // "checked, none" and isn't retried every cron tick. Transient fetch errors
  // are left NULL on purpose so they get another chance later.
  const markNone = db.prepare("UPDATE videos SET duration = '' WHERE video_id = ? AND duration IS NULL");

  let filled = 0;
  for (let i = 0; i < rows.length; i++) {
    const { video_id, live_status } = rows[i];
    try {
      const info = await fetchVideoInfo(video_id);
      durationRetry.delete(video_id);
      if (info.duration) {
        save.run(info.duration, video_id);
        filled++;
      } else if (live_status === "none") {
        markNone.run(video_id);
      }
    } catch (e) {
      const attempts = (durationRetry.get(video_id)?.attempts ?? 0) + 1;
      const delayMs = Math.min(DURATION_RETRY_BASE_MS * 2 ** (attempts - 1), DURATION_RETRY_MAX_MS);
      durationRetry.set(video_id, { attempts, nextAt: Date.now() + delayMs });
      log.warn("video.duration_failed", {
        videoId: video_id,
        error: e instanceof Error ? e.message : String(e),
        attempts,
        retryInMin: Math.round(delayMs / 60_000),
      });
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

  const liveIntervalMin = positiveNumber(process.env.LIVE_INTERVAL_MINUTES, 3);
  setTimeout(() => refreshAllLiveStatuses().catch((e) => log.error("live.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 15_000);
  setInterval(() => refreshAllLiveStatuses().catch((e) => log.error("live.cron_failed", { error: e instanceof Error ? e.message : String(e) })), liveIntervalMin * 60_000);
  log.info("scheduler.live_refresh", { intervalMin: liveIntervalMin });


  // Duration backfill cron: fill `duration` for videos still missing it,
  // most-recent first, a small polite batch every few minutes.
  const durationBatch = positiveNumber(process.env.DURATION_BATCH_SIZE, 20);
  const durationIntervalMin = positiveNumber(process.env.DURATION_INTERVAL_MINUTES, 3);
  setTimeout(() => refreshDurationsBatch(durationBatch).catch((e) => log.error("durations.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 30_000);
  setInterval(() => refreshDurationsBatch(durationBatch).catch((e) => log.error("durations.cron_failed", { error: e instanceof Error ? e.message : String(e) })), durationIntervalMin * 60_000);
  log.info("scheduler.duration_backfill", {
    intervalMin: durationIntervalMin,
    batchSize: durationBatch,
    maxAgeDays: VIDEO_MAINTENANCE_MAX_AGE_DAYS,
  });
}
