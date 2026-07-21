import { db } from "./db";
import type { PlaylistInfo } from "./youtube";

export interface VideoChannelPlaylist extends PlaylistInfo {
  channelId: string;
  channelTitle: string;
}

const upsertPlaylist = db.prepare(`
  INSERT INTO channel_playlists (playlist_id, channel_id, title, thumbnail, video_count, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(playlist_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    title = excluded.title,
    thumbnail = excluded.thumbnail,
    video_count = excluded.video_count,
    updated_at = datetime('now')
`);

const addMembership = db.prepare(`
  INSERT OR IGNORE INTO channel_playlist_videos (playlist_id, video_id) VALUES (?, ?)
`);

const ensurePlaylist = db.prepare(`
  INSERT OR IGNORE INTO channel_playlists (playlist_id, channel_id) VALUES (?, ?)
`);

export function saveChannelPlaylists(channelId: string, playlists: PlaylistInfo[]) {
  db.transaction((items: PlaylistInfo[]) => {
    for (const playlist of items) {
      upsertPlaylist.run(
        playlist.playlistId,
        channelId,
        playlist.title,
        playlist.thumbnail,
        playlist.videoCount,
      );
    }
  })(playlists);
}

export function savePlaylistMemberships(playlistId: string, videoIds: string[]) {
  db.transaction((ids: string[]) => {
    for (const videoId of ids) addMembership.run(playlistId, videoId);
  })(videoIds);
}

export function ensureChannelPlaylist(playlistId: string, channelId: string) {
  ensurePlaylist.run(playlistId, channelId);
}

export function videoPlaylistsForUser(userId: number, videoId: string): VideoChannelPlaylist[] {
  return db.prepare(`
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
  `).all(userId, videoId) as VideoChannelPlaylist[];
}
