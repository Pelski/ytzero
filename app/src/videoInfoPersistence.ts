import { database } from "./database";
import type { VideoInfo } from "./youtube";
import { DIRECT_VIDEO_INFO_UPSERT_SQL } from "./videoUpserts";

/** Persist metadata obtained directly from the video's player response. */
export async function persistDirectVideoInfo(info: VideoInfo): Promise<void> {
  await database.prepare(DIRECT_VIDEO_INFO_UPSERT_SQL).run(
    info.videoId,
    info.channelId,
    info.title,
    info.description,
    info.thumbnail,
    info.publishedAt,
    info.liveStatus,
    info.viewCount,
    info.duration,
  );
}
