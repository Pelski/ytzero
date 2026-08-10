import { normalizeUserPlaylistSort, sortUserPlaylistItems } from "./playlistSort";
import { database } from "./database";

export interface UserPlaylistSortable {
  title: string;
  published_at: string | null;
  added_at: string;
  position: number;
}

export function sortUserPlaylistRows<T extends UserPlaylistSortable>(rows: readonly T[], sort: unknown): T[] {
  return sortUserPlaylistItems(rows, normalizeUserPlaylistSort(sort), (video) => ({
    title: video.title,
    publishedAt: video.published_at,
    addedAt: video.added_at,
    position: video.position,
  }));
}

export async function downloadableUserPlaylistVideoIds(playlistId: string, sort: unknown): Promise<string[]> {
  const rows = await database.prepare(`
    SELECT v.video_id, v.title, v.published_at, upv.added_at, upv.position FROM user_playlist_videos upv
    JOIN videos v ON v.video_id = upv.video_id
    WHERE upv.playlist_id = ? AND v.is_private = 0
      AND v.live_status NOT IN ('live', 'upcoming')
    ORDER BY upv.position ASC, upv.video_id ASC
  `).all(playlistId) as Array<{ video_id: string } & UserPlaylistSortable>;
  return sortUserPlaylistRows(rows, sort).map((row) => row.video_id);
}
