import { database } from "./database";
import { log } from "./logger";
import {
  backfillImportedVideos,
  refreshAll,
  refreshAllLiveStatuses,
  refreshAvatarsBatch,
  refreshVideoMetadataBatch,
} from "./refresher";
import { syncNextFollowedPlaylist, syncNextSubscribedChannel } from "./scheduledSync";
import { runAutomaticUpdateChecks } from "./updates";
const FEED_REFRESH_BATCH_SIZE = 10;
const FEED_REFRESH_FAIRNESS_SLOTS = 2;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const VIDEO_MAINTENANCE_MAX_AGE_DAYS = positiveNumber(process.env.VIDEO_MAINTENANCE_MAX_AGE_DAYS, 90);

export function startScheduler() {
  setTimeout(() => runAutomaticUpdateChecks().catch(() => {}), 60_000);
  setInterval(() => runAutomaticUpdateChecks().catch(() => {}), 60_000);
  log.info("scheduler.update_checks", { pollIntervalMin: 1 });

  const refreshIntervalMin = positiveNumber(process.env.REFRESH_INTERVAL_MINUTES, 5);
  setTimeout(() => refreshAll().catch((e) => log.error("refresh.cron_failed", { error: e instanceof Error ? e.message : String(e) })), 3_000);
  setInterval(() => refreshAll().catch((e) => log.error("refresh.cron_failed", { error: e instanceof Error ? e.message : String(e) })), refreshIntervalMin * 60_000);
  log.info("scheduler.feed_refresh", {
    intervalMin: refreshIntervalMin,
    batchSize: FEED_REFRESH_BATCH_SIZE,
    fairnessSlots: FEED_REFRESH_FAIRNESS_SLOTS,
    adaptiveMinIntervalMin: positiveNumber(process.env.ADAPTIVE_REFRESH_MIN_MINUTES, 10),
    adaptiveMaxIntervalMin: positiveNumber(process.env.ADAPTIVE_REFRESH_MAX_MINUTES, 12 * 60),
    adaptiveInactiveMaxIntervalMin: Math.min(3 * 24 * 60, positiveNumber(process.env.ADAPTIVE_REFRESH_INACTIVE_MAX_MINUTES, 3 * 24 * 60)),
  });

  // A cheap due-only pass gives fixed HH:mm schedules minute precision without
  // running adaptive maintenance work more often than configured above.
  const manualSchedulesExist = database.prepare(`
    SELECT 1 FROM channels c
    WHERE c.manual_status = 'active'
      AND c.refresh_schedule_days IS NOT NULL AND c.refresh_schedule_time IS NOT NULL
      AND EXISTS (SELECT 1 FROM user_channels uc WHERE uc.channel_id = c.channel_id AND uc.followed = 1)
    LIMIT 1
  `);
  setInterval(async () => {
    if (!await manualSchedulesExist.get()) return;
    refreshAll({ manualOnly: true }).catch((e) => log.error("refresh.manual_cron_failed", { error: e instanceof Error ? e.message : String(e) }));
  }, 60_000);
  log.info("scheduler.manual_feed_refresh", { intervalMin: 1 });

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

  // Fill real metadata for videos brought in by a Takeout import.
  const importBatch = positiveNumber(process.env.IMPORT_ENRICH_BATCH_SIZE, 15);
  const importIntervalMin = positiveNumber(process.env.IMPORT_ENRICH_INTERVAL_MINUTES, 2);
  setTimeout(() => backfillImportedVideos(importBatch).catch((e) => log.error("import.enrich_cron_failed", { error: e instanceof Error ? e.message : String(e) })), 45_000);
  setInterval(() => backfillImportedVideos(importBatch).catch((e) => log.error("import.enrich_cron_failed", { error: e instanceof Error ? e.message : String(e) })), importIntervalMin * 60_000);
  log.info("scheduler.import_enrich", { intervalMin: importIntervalMin, batchSize: importBatch });
}
