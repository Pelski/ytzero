import { pluginEnabled } from "./plugins";

function localMediaSourceSelect(uid: number): string {
  const tubeArchivistEnabled = pluginEnabled("tubearchivist") ? 1 : 0;
  return `CASE
           WHEN EXISTS(SELECT 1 FROM downloads d JOIN download_owners owner ON owner.video_id=d.video_id WHERE owner.user_id=${uid} AND d.video_id=v.video_id AND d.status='done') THEN 'download'
           WHEN ${tubeArchivistEnabled}=1 AND EXISTS(SELECT 1 FROM tube_archivist_items tai WHERE tai.video_id=v.video_id AND tai.available=1) THEN 'tubearchivist'
           ELSE NULL
         END`;
}

// Per-profile video projection: status/bucket/liked/progress come from the
// active user's user_videos row (absent = default inbox); history is per user.
// uid is a validated integer, safe to inline.
export function videoSelect(uid: number): string {
  return `
  SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail,
         v.published_at, v.created_at AS found_at, v.published_at_approximate, v.members_only, v.is_private,
         v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
         v.is_short, v.views, v.likes, uv.liked, uv.watched,
         v.duration, uv.watch_position, uv.watch_duration, uv.playback_context_json, v.external,
         (SELECT cp.title
          FROM channel_playlist_videos cpv
          JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
          JOIN user_followed_playlists ufp ON ufp.playlist_id = cpv.playlist_id AND ufp.user_id = ${uid}
          WHERE cpv.video_id = v.video_id AND ufp.include_in_feed = 1
          ORDER BY cpv.discovered_at DESC LIMIT 1) AS source_playlist_title,
         (SELECT cp.playlist_id
          FROM channel_playlist_videos cpv
          JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
          JOIN user_followed_playlists ufp ON ufp.playlist_id = cpv.playlist_id AND ufp.user_id = ${uid}
          WHERE cpv.video_id = v.video_id AND ufp.include_in_feed = 1
          ORDER BY cpv.discovered_at DESC LIMIT 1) AS source_playlist_id,
         EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ${uid}) AS in_history,
         (SELECT d.status FROM downloads d JOIN download_owners owner ON owner.video_id=d.video_id WHERE owner.user_id=${uid} AND d.video_id=v.video_id AND d.status!='deleted') AS download_status,
         ${localMediaSourceSelect(uid)} AS local_media_source,
         COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count
  FROM videos v JOIN channels c ON c.channel_id = v.channel_id
  LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${uid}`;
}
