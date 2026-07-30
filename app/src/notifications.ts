import { database } from "./database";
import { publishAppEvent } from "./appEvents";

const insertNotification = database.prepare(`
  INSERT OR IGNORE INTO notifications (user_id, kind, dedupe_key, payload, target)
  VALUES (?, ?, ?, ?, ?)
`);

export async function createNotification(userId: number, kind: string, dedupeKey: string, payload: Record<string, unknown>, target: string): Promise<boolean> {
  const created = (await insertNotification.run(userId, kind, dedupeKey, JSON.stringify(payload), target)).changes > 0;
  if (created) publishAppEvent("notifications");
  return created;
}

export async function notifyFollowedPlaylistVideos(playlistId: string, videoIds: string[]): Promise<number> {
  if (videoIds.length === 0) return 0;
  const followers = await database.prepare("SELECT user_id FROM user_followed_playlists WHERE playlist_id = ?").all<{ user_id: number }>(playlistId);
  if (followers.length === 0) return 0;
  const playlist = await database.prepare("SELECT title FROM channel_playlists WHERE playlist_id = ?").get<{ title: string }>(playlistId);
  const videoQuery = database.prepare(`
    SELECT v.video_id, v.title, v.thumbnail,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title,
           c.thumbnail AS channel_thumbnail
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `);
  let created = 0;
  for (const videoId of videoIds) {
    const video = await videoQuery.get<{ video_id: string; title: string; thumbnail: string; channel_title: string; channel_thumbnail: string }>(videoId);
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
      if (await createNotification(follower.user_id, "playlist_video", `playlist_video:${playlistId}:${video.video_id}`, payload, `/watch/${video.video_id}/playlist/${playlistId}`)) created++;
    }
  }
  return created;
}

export async function notifyDownloadFailed(videoId: string, error: string): Promise<number> {
  const video = await database.prepare(`
    SELECT v.video_id, v.title, v.thumbnail,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title,
           d.created_at, d.attempts
    FROM downloads d
    JOIN videos v ON v.video_id = d.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE d.video_id = ?
  `).get<{
    video_id: string;
    title: string;
    thumbnail: string;
    channel_title: string;
    created_at: string;
    attempts: number;
  }>(videoId);
  if (!video) return 0;

  const users = await database.prepare(`
    SELECT u.id FROM download_owners owner
    JOIN users u ON u.id=owner.user_id
    WHERE owner.video_id=? AND COALESCE(u.is_child,0)=0
  `).all<{ id: number }>(videoId);
  const payload = {
    videoId: video.video_id,
    videoTitle: video.title,
    thumbnail: video.thumbnail,
    channelTitle: video.channel_title,
    error,
    attempts: video.attempts,
  };
  let created = 0;
  for (const user of users) {
    const dedupeKey = `download_failed:${video.video_id}:${video.created_at}`;
    if (await createNotification(user.id, "download_failed", dedupeKey, payload, "/downloads")) created++;
  }
  return created;
}
