import { database } from "./database";
import { dlSettings, profileDownloadsEnabled } from "./downloadConfig";
import { shouldAutoDownloadVideo } from "./downloadContentPolicy";

type EnqueueScheduledDownload = (userId: number, videoId: string) => Promise<boolean>;

export async function enqueueScheduledDownloadsForUser(userId: number, enqueue: EnqueueScheduledDownload): Promise<number> {
  const settings = await dlSettings(userId);
  if (!await profileDownloadsEnabled(userId) || settings.download_scheduled !== 1) return 0;

  // Completed live archives are opt-in; active and upcoming streams never
  // reach the queue. The 30-day window avoids crawling a forgotten backlog.
  const rows = await database.prepare(`
    SELECT DISTINCT uv.user_id, v.video_id, v.is_short FROM user_videos uv
    JOIN videos v ON v.video_id = uv.video_id
    WHERE uv.user_id=? AND uv.status = 'queued'
      AND (v.live_status = 'none' OR (v.live_status = 'was_live' AND ? = 1))
      AND v.is_private = 0
      AND v.is_unavailable = 0
      AND COALESCE(uv.watched, 0) = 0
      AND COALESCE(uv.queued_at, datetime('now')) >= datetime('now', '-30 days')
      AND NOT EXISTS (SELECT 1 FROM download_owners owner WHERE owner.user_id=uv.user_id AND owner.video_id=v.video_id)
    LIMIT 50
  `).all(userId, settings.download_live_archives) as { user_id: number; video_id: string; is_short: number | null }[];

  let queued = 0;
  for (const row of rows) {
    if (!shouldAutoDownloadVideo(row.is_short, settings.download_shorts === 1)) continue;
    if (await enqueue(row.user_id, row.video_id)) queued++;
  }
  return queued;
}
