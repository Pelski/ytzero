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
