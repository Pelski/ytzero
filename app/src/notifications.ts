import { db } from "./db";

const insertNotification = db.prepare(`
  INSERT OR IGNORE INTO notifications (user_id, kind, dedupe_key, payload, target)
  VALUES (?, ?, ?, ?, ?)
`);

export function createNotification(userId: number, kind: string, dedupeKey: string, payload: Record<string, unknown>, target: string): boolean {
  return insertNotification.run(userId, kind, dedupeKey, JSON.stringify(payload), target).changes > 0;
}

export function notifyFollowedPlaylistVideos(playlistId: string, videoIds: string[]): number {
  if (videoIds.length === 0) return 0;
  const followers = db.prepare("SELECT user_id FROM user_followed_playlists WHERE playlist_id = ?").all(playlistId) as { user_id: number }[];
  if (followers.length === 0) return 0;
  const playlist = db.prepare("SELECT title FROM channel_playlists WHERE playlist_id = ?").get(playlistId) as { title: string } | null;
  const videoQuery = db.prepare(`
    SELECT v.video_id, v.title, v.thumbnail,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title,
           c.thumbnail AS channel_thumbnail
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `);
  let created = 0;
  for (const videoId of videoIds) {
    const video = videoQuery.get(videoId) as { video_id: string; title: string; thumbnail: string; channel_title: string; channel_thumbnail: string } | null;
    if (!video) continue;
    const payload = {
      videoId: video.video_id,
      videoTitle: video.title,
      thumbnail: video.thumbnail,
      playlistId,
      playlistTitle: playlist?.title || "",
      channelTitle: video.channel_title,
      channelThumbnail: video.channel_thumbnail,
    };
    for (const follower of followers) {
      if (createNotification(follower.user_id, "playlist_video", `playlist_video:${playlistId}:${video.video_id}`, payload, `/watch/${video.video_id}/playlist/${playlistId}`)) created++;
    }
  }
  return created;
}
