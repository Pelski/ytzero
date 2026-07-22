// A video inherits its channel's tags in every other part of the app. This CTE
// combines those with tags attached directly to the video. UNION (rather than
// UNION ALL) prevents a tag assigned in both places from being counted twice.
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
  )`;
