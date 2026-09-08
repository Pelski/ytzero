import { database } from "./database";
import { log } from "./logger";
import { persistDirectVideoInfo } from "./videoInfoPersistence";
import { videoExistsStmt } from "./videoRoutesSupport";
import { fetchChannelAbout, fetchChannelFeed, type ChannelFeed, type VideoInfo } from "./youtube";

export interface VideoInfoImportResult {
  feed: ChannelFeed | null;
  feedError: unknown | null;
}

/** Store a directly opened video and enough of its channel feed for related videos. */
export async function importExternalVideoInfo(info: VideoInfo, userId: number): Promise<VideoInfoImportResult> {
  const [aboutResult, feedResult] = await Promise.allSettled([
    fetchChannelAbout(info.channelId), fetchChannelFeed(info.channelId, userId),
  ]);
  const about = aboutResult.status === "fulfilled" ? aboutResult.value : null;
  const feed = feedResult.status === "fulfilled" ? feedResult.value : null;

  await database.prepare(`
    INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
    VALUES (?, ?, ?, ?, 0, 1)
    ON CONFLICT(channel_id) DO UPDATE SET
      thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL
                       THEN excluded.thumbnail ELSE channels.thumbnail END
  `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, about?.avatar ?? "");

  const existing = await videoExistsStmt.get(info.videoId);
  await persistDirectVideoInfo(info);
  if (feed) {
    const insertRelatedVideo = database.prepare(`
      INSERT OR IGNORE INTO videos
        (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, external)
      VALUES (?, ?, ?, ?, ?, ?, 'none', 'inbox', ?, ?, 1)
    `);
    const insertMany = database.transaction(async (videos: typeof feed.videos) => {
      for (const video of videos) {
        await insertRelatedVideo.run(
          video.videoId, info.channelId, video.title, video.description,
          video.thumbnail, video.publishedAt, video.views, null,
        );
      }
    });
    await insertMany(feed.videos);
  }
  log.info("external.video_info_loaded", {
    videoId: info.videoId, channelId: info.channelId, inserted: !existing, relatedImported: feed?.videos.length ?? 0,
  });
  return { feed, feedError: feedResult.status === "rejected" ? feedResult.reason : null };
}
