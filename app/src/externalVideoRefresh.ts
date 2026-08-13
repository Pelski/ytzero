import { database } from "./database";
import { log } from "./logger";
import { fetchVideoInfo } from "./youtube";
import { persistDirectVideoInfo } from "./videoInfoPersistence";
import { videoSelect, type VideoRow } from "./videoRoutesSupport";

/**
 * RSS has no live marker, so an external row is refreshed from its direct
 * player response before the watch page chooses a player or download policy.
 */
export async function refreshExternalWatchVideo(row: VideoRow, userId: number): Promise<VideoRow> {
  if (row.external !== 1) return row;
  try {
    const info = await fetchVideoInfo(row.video_id);
    await persistDirectVideoInfo(info);
    const refreshed = await database.prepare(`${videoSelect(userId)} WHERE v.video_id = ?`).get(row.video_id) as VideoRow;
    if (refreshed.live_status !== row.live_status) {
      log.info("video.live_status_corrected", {
        videoId: row.video_id,
        from: row.live_status,
        to: refreshed.live_status,
        source: "watch_open",
      });
    }
    return refreshed;
  } catch (error) {
    log.warn("video.metadata_refresh_failed", {
      videoId: row.video_id,
      source: "watch_open",
      error: error instanceof Error ? error.message : String(error),
    });
    return row;
  }
}
