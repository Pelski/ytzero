import { database } from "./database";
import type { PlaylistVideo } from "./youtube";
import { sortPlaylistItems, type PlaylistSort } from "./playlistSort";

export async function sortFetchedPlaylistVideos(
  videos: readonly PlaylistVideo[],
  sort: PlaylistSort,
): Promise<Array<PlaylistVideo & { publishedAt: string | null }>> {
  const rows = videos.length > 0
    ? await database.prepare(`SELECT video_id, published_at FROM videos WHERE video_id IN (${videos.map(() => "?").join(",")})`)
      .all(...videos.map((video) => video.videoId)) as { video_id: string; published_at: string | null }[]
    : [];
  const publishedAt = new Map(rows.map((row) => [row.video_id, row.published_at]));
  return sortPlaylistItems(videos.map((video) => ({
    ...video,
    publishedAt: publishedAt.get(video.videoId) ?? null,
  })), sort, (video) => ({ title: video.title, publishedAt: video.publishedAt }));
}
