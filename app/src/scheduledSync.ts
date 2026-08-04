import { channelSyncJobIsRunning } from "./channelSyncRuntime";
import { database } from "./database";
import { listDownloadRules } from "./downloadRules";
import { log } from "./logger";
import { beginMutation, maintenanceActive } from "./maintenance";
import { feedRefreshIsRunning, followedChannelStatusCounts, syncChannel, syncPlaylist } from "./refresher";

let scheduledFullSyncRunning = false;
let scheduledPlaylistSyncRunning = false;

export function scheduledSyncIsRunning(): boolean {
  return scheduledFullSyncRunning || scheduledPlaylistSyncRunning;
}

/** Run the same deep scan as the channel-page button for one subscribed
 * channel. Attempt time drives rotation so one broken channel cannot starve
 * every channel after it. */
export async function syncNextSubscribedChannel(): Promise<void> {
  if (maintenanceActive()) {
    log.info("channel.full_sync.skipped", { reason: "maintenance" });
    return;
  }
  if (feedRefreshIsRunning()) {
    log.info("channel.full_sync.skipped", { reason: "feed_refresh_in_progress" });
    return;
  }
  if (channelSyncJobIsRunning()) {
    log.info("channel.full_sync.skipped", { reason: "channel_sync_job_in_progress" });
    return;
  }
  if (scheduledSyncIsRunning()) {
    log.warn("channel.full_sync.skipped", { reason: "already_in_progress" });
    return;
  }
  const releaseMutation = beginMutation();
  if (!releaseMutation) return;
  scheduledFullSyncRunning = true;
  try {
    const channel = await database.prepare(`
      SELECT c.channel_id
      FROM channels c
      WHERE c.external = 0
        AND c.manual_status = 'active'
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
      log.info("channel.full_sync.skipped", { reason: "no_eligible_subscribed_channels", followedByStatus: await followedChannelStatusCounts() });
      return;
    }
    const startedAt = Date.now();
    log.info("channel.full_sync.start", { channelId: channel.channel_id });
    try {
      const result = await syncChannel(channel.channel_id);
      if (result.rateLimited) log.warn("channel.full_sync.halted", { channelId: channel.channel_id, reason: "youtube_rate_limit", added: result.added, ms: Date.now() - startedAt });
      else log.info("channel.full_sync.complete", { channelId: channel.channel_id, added: result.added, ms: Date.now() - startedAt });
    } catch (error) {
      log.error("channel.full_sync.failed", {
        channelId: channel.channel_id,
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - startedAt,
      });
    }
  } finally {
    scheduledFullSyncRunning = false;
    releaseMutation();
  }
}

export async function syncNextFollowedPlaylist(): Promise<void> {
  if (maintenanceActive()) {
    log.info("playlist.sync.skipped", { reason: "maintenance" });
    return;
  }
  if (feedRefreshIsRunning()) {
    log.info("playlist.sync.skipped", { reason: "feed_refresh_in_progress" });
    return;
  }
  if (scheduledSyncIsRunning()) {
    log.info("playlist.sync.skipped", { reason: "already_in_progress" });
    return;
  }
  if (channelSyncJobIsRunning()) {
    log.info("playlist.sync.skipped", { reason: "channel_sync_job_in_progress" });
    return;
  }
  const releaseMutation = beginMutation();
  if (!releaseMutation) return;
  scheduledPlaylistSyncRunning = true;
  try {
    const automatedPlaylistIds = [...new Set((await listDownloadRules())
      .filter((rule) => rule.enabled)
      .flatMap((rule) => rule.playlist_ids))];
    const automatedSql = automatedPlaylistIds.length
      ? ` OR cp.playlist_id IN (${automatedPlaylistIds.map(() => "?").join(",")})`
      : "";
    const playlist = await database.prepare(`
      SELECT cp.playlist_id
      FROM channel_playlists cp
      JOIN channels c ON c.channel_id = cp.channel_id
      WHERE c.manual_status = 'active'
        AND (EXISTS (SELECT 1 FROM user_followed_playlists ufp WHERE ufp.playlist_id = cp.playlist_id)${automatedSql})
      ORDER BY COALESCE(cp.sync_attempted_at, cp.last_synced_at, '1970-01-01') ASC, cp.playlist_id ASC
      LIMIT 1
    `).get(...automatedPlaylistIds) as { playlist_id: string } | null;
    if (!playlist) {
      log.info("playlist.sync.skipped", { reason: "no_eligible_followed_playlists", followedByStatus: await followedChannelStatusCounts() });
      return;
    }
    const startedAt = Date.now();
    try {
      const result = await syncPlaylist(playlist.playlist_id);
      log.info("playlist.sync.complete", { playlistId: playlist.playlist_id, added: result.added, ms: Date.now() - startedAt });
    } catch (error) {
      log.warn("playlist.sync.failed", { playlistId: playlist.playlist_id, error: error instanceof Error ? error.message : String(error), ms: Date.now() - startedAt });
    }
  } finally {
    scheduledPlaylistSyncRunning = false;
    releaseMutation();
  }
}
