// A video inherits tags from its own channel and from the owner of any playlist
// followed by the same profile. Combine those with direct video tags. UNION
// prevents the same tag attached through multiple paths being counted twice.
export const effectiveVideoTagsCte = `
  WITH effective_video_tags AS (
    SELECT vt.video_id, t.id AS tag_id, t.user_id, t.name, t.color
    FROM video_tags vt
    JOIN tags t ON t.id = vt.tag_id
    UNION
    SELECT v.video_id, t.id AS tag_id, t.user_id, t.name, t.color
    FROM videos v
    JOIN channel_tags ct ON ct.channel_id = v.channel_id
    JOIN tags t ON t.id = ct.tag_id
    UNION
    SELECT cpv.video_id, t.id AS tag_id, t.user_id, t.name, t.color
    FROM channel_playlist_videos cpv
    JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
    JOIN user_followed_playlists ufp ON ufp.playlist_id = cp.playlist_id
    JOIN channel_tags ct ON ct.channel_id = cp.channel_id
    JOIN tags t ON t.id = ct.tag_id AND t.user_id = ufp.user_id
  )`;
