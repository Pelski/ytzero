/**
 * RSS contains only publicly available uploads. Seeing a previously
 * members-only video there is therefore authoritative evidence that YouTube
 * has unlocked it for everyone.
 */
export const RSS_VIDEO_UPSERT_SQL = `
  INSERT INTO videos (video_id, channel_id, title, description, thumbnail, published_at, views, likes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    thumbnail = CASE WHEN TRIM(excluded.thumbnail) != '' THEN excluded.thumbnail ELSE videos.thumbnail END,
    published_at = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN excluded.published_at ELSE videos.published_at END,
    published_at_approximate = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN 0 ELSE videos.published_at_approximate END,
    views = COALESCE(excluded.views, videos.views),
    likes = COALESCE(excluded.likes, videos.likes),
    members_only = 0,
    is_private = 0,
    is_unavailable = 0,
    availability_checked_at = datetime('now')
`;

/**
 * A direct watch-page lookup is authoritative for the video's current live
 * state. Unlike RSS, it can distinguish an active/upcoming/ended stream from
 * an ordinary upload, so it must replace a stale status imported earlier from
 * a channel feed while preserving profile-independent library ownership.
 */
export const DIRECT_VIDEO_INFO_UPSERT_SQL = `
  INSERT INTO videos
    (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, external)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'inbox', ?, ?, 1)
  ON CONFLICT(video_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    title = CASE WHEN TRIM(excluded.title) != '' THEN excluded.title ELSE videos.title END,
    description = CASE WHEN TRIM(excluded.description) != '' THEN excluded.description ELSE videos.description END,
    thumbnail = CASE WHEN TRIM(excluded.thumbnail) != '' THEN excluded.thumbnail ELSE videos.thumbnail END,
    published_at = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN excluded.published_at ELSE videos.published_at END,
    published_at_approximate = CASE WHEN excluded.published_at IS NOT NULL AND excluded.published_at != '' THEN 0 ELSE videos.published_at_approximate END,
    live_status = excluded.live_status,
    views = COALESCE(excluded.views, videos.views),
    duration = CASE
      WHEN excluded.live_status IN ('live', 'upcoming') THEN NULL
      ELSE COALESCE(excluded.duration, videos.duration)
    END,
    is_private = 0,
    is_unavailable = 0,
    availability_checked_at = datetime('now')
`;
