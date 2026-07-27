import { database } from "./database";
import type { PlaylistInfo } from "./youtube";

// Increment when playlist extraction changes in a way that invalidates stored
// empty/incomplete results. Older cache entries are refreshed on first read.
export const CHANNEL_PLAYLIST_CACHE_VERSION = 1;

export interface VideoChannelPlaylist extends PlaylistInfo {
  channelId: string;
  channelTitle: string;
}

const upsertPlaylist = database.prepare(`
  INSERT INTO channel_playlists (playlist_id, channel_id, title, thumbnail, video_count, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(playlist_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    title = excluded.title,
    thumbnail = CASE WHEN TRIM(excluded.thumbnail) != '' THEN excluded.thumbnail ELSE channel_playlists.thumbnail END,
    video_count = excluded.video_count,
    updated_at = datetime('now')
`);

const addMembership = database.prepare(`
  INSERT INTO channel_playlist_videos (playlist_id, video_id, discovered_at, last_seen_at, position)
  VALUES (?, ?, datetime('now'), datetime('now'), ?)
  ON CONFLICT(playlist_id, video_id) DO UPDATE SET
    last_seen_at = datetime('now'), position = excluded.position
`);

const ensurePlaylist = database.prepare(`
  INSERT OR IGNORE INTO channel_playlists (playlist_id, channel_id) VALUES (?, ?)
`);

export async function saveChannelPlaylists(channelId: string, playlists: PlaylistInfo[]) {
  await database.transaction(async (items: PlaylistInfo[]) => {
    for (const playlist of items) {
      await upsertPlaylist.run(
        playlist.playlistId,
        channelId,
        playlist.title,
        playlist.thumbnail,
        playlist.videoCount,
      );
    }
  })(playlists);
}

export async function savePlaylistMemberships(playlistId: string, videoIds: string[], complete = false): Promise<string[]> {
  const existing = new Set((await database.prepare("SELECT video_id FROM channel_playlist_videos WHERE playlist_id = ?").all<{ video_id: string }>(playlistId)).map((row) => row.video_id));
  const discovered = videoIds.filter((videoId) => !existing.has(videoId));
  await database.transaction(async (ids: string[]) => {
    for (const [position, videoId] of ids.entries()) await addMembership.run(playlistId, videoId, position);
    if (complete) {
      const current = await database.prepare("SELECT video_id FROM channel_playlist_videos WHERE playlist_id = ?").all<{ video_id: string }>(playlistId);
      const seen = new Set(ids);
      const remove = database.prepare("DELETE FROM channel_playlist_videos WHERE playlist_id = ? AND video_id = ?");
      for (const row of current) if (!seen.has(row.video_id)) await remove.run(playlistId, row.video_id);
    }
  })(videoIds);
  return discovered;
}

export async function ensureChannelPlaylist(playlistId: string, channelId: string) {
  await ensurePlaylist.run(playlistId, channelId);
}

export async function videoPlaylistsForUser(userId: number, videoId: string): Promise<VideoChannelPlaylist[]> {
  return database.prepare(`
    SELECT
      cp.playlist_id AS playlistId,
      cp.title,
      cp.thumbnail,
      cp.video_count AS videoCount,
      cp.channel_id AS channelId,
      COALESCE(NULLIF(c.custom_title, ''), c.title) AS channelTitle
    FROM channel_playlist_videos cpv
    JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
    JOIN channels c ON c.channel_id = cp.channel_id
    JOIN user_channels uc ON uc.channel_id = cp.channel_id
      AND uc.user_id = ? AND uc.followed = 1
    WHERE cpv.video_id = ?
    ORDER BY cp.title COLLATE NOCASE
  `).all<VideoChannelPlaylist>(userId, videoId);
}
