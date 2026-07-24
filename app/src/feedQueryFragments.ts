// Pure SQL-fragment builders shared by the feed and the cleanup view. No `db`
// import here on purpose — keeps this module safe to unit test without
// touching the real database (see feedQuery.ts for the db-backed pieces).

/** WHERE fragment matching videos that have ANY of the given tags (own or via channel). */
export function tagFilterSql(uid: number, tagIds: number[]) {
  const ph = tagIds.map(() => "?").join(",");
  return {
    sql: `(EXISTS (SELECT 1 FROM video_tags vt JOIN tags t ON t.id = vt.tag_id AND t.user_id = ${uid} WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
       OR EXISTS (SELECT 1 FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ${uid} WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph}))
       OR EXISTS (
         SELECT 1 FROM channel_playlist_videos cpv
         JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
         JOIN user_followed_playlists ufp ON ufp.playlist_id = cp.playlist_id AND ufp.user_id = ${uid}
         JOIN channel_tags ct ON ct.channel_id = cp.channel_id
         JOIN tags t ON t.id = ct.tag_id AND t.user_id = ${uid}
         WHERE cpv.video_id = v.video_id AND ct.tag_id IN (${ph})
       ))`,
    params: [...tagIds, ...tagIds, ...tagIds],
  };
}

/** WHERE fragment excluding videos that have a filter_only tag unless one of those tags is selected.
 *  For channels: hidden only when ALL channel tags are filter_only (not just any one). */
export function filterOnlySql(uid: number, tagIds: number[]) {
  // Video-level: exclude if video itself has any filter_only tag (owned by the user).
  const noVideoFO = `NOT EXISTS (SELECT 1 FROM video_tags vt2 JOIN tags t2 ON t2.id = vt2.tag_id AND t2.user_id = ${uid} WHERE vt2.video_id = v.video_id AND t2.filter_only = 1)`;
  // Channel-level: exclude only when channel has (user's) tags and every one of them is filter_only.
  const noChannelFO = `(NOT EXISTS (SELECT 1 FROM channel_tags ct2 JOIN tags t2 ON t2.id = ct2.tag_id AND t2.user_id = ${uid} WHERE ct2.channel_id = v.channel_id)
     OR EXISTS (SELECT 1 FROM channel_tags ct2 JOIN tags t2 ON t2.id = ct2.tag_id AND t2.user_id = ${uid} WHERE ct2.channel_id = v.channel_id AND t2.filter_only = 0))`;
  const noPlaylistChannelFO = `NOT EXISTS (
    SELECT 1 FROM channel_playlist_videos cpv2
    JOIN channel_playlists cp2 ON cp2.playlist_id = cpv2.playlist_id
    JOIN user_followed_playlists ufp2 ON ufp2.playlist_id = cp2.playlist_id AND ufp2.user_id = ${uid}
    WHERE cpv2.video_id = v.video_id
      AND EXISTS (SELECT 1 FROM channel_tags ct4 JOIN tags t4 ON t4.id = ct4.tag_id AND t4.user_id = ${uid} WHERE ct4.channel_id = cp2.channel_id)
      AND NOT EXISTS (SELECT 1 FROM channel_tags ct5 JOIN tags t5 ON t5.id = ct5.tag_id AND t5.user_id = ${uid} WHERE ct5.channel_id = cp2.channel_id AND t5.filter_only = 0)
  )`;
  const noFO = `(${noVideoFO} AND ${noChannelFO} AND ${noPlaylistChannelFO})`;
  if (tagIds.length === 0) return { sql: noFO, params: [] };
  const ph = tagIds.map(() => "?").join(",");
  return {
    sql: `(${noFO}
      OR EXISTS (SELECT 1 FROM video_tags vt3 JOIN tags t3 ON t3.id = vt3.tag_id AND t3.user_id = ${uid} WHERE vt3.video_id = v.video_id AND t3.filter_only = 1 AND t3.id IN (${ph}))
      OR EXISTS (SELECT 1 FROM channel_tags ct3 JOIN tags t3 ON t3.id = ct3.tag_id AND t3.user_id = ${uid} WHERE ct3.channel_id = v.channel_id AND t3.filter_only = 1 AND t3.id IN (${ph}))
      OR EXISTS (
        SELECT 1 FROM channel_playlist_videos cpv3
        JOIN channel_playlists cp3 ON cp3.playlist_id = cpv3.playlist_id
        JOIN user_followed_playlists ufp3 ON ufp3.playlist_id = cp3.playlist_id AND ufp3.user_id = ${uid}
        JOIN channel_tags ct6 ON ct6.channel_id = cp3.channel_id
        JOIN tags t6 ON t6.id = ct6.tag_id AND t6.user_id = ${uid}
        WHERE cpv3.video_id = v.video_id AND t6.filter_only = 1 AND t6.id IN (${ph})
      ))`,
    params: [...tagIds, ...tagIds, ...tagIds],
  };
}

/** EXISTS fragment: the active user follows this video's channel. */
export function followedExists(uid: number) {
  return `EXISTS (SELECT 1 FROM user_channels uc WHERE uc.channel_id = v.channel_id AND uc.user_id = ${uid} AND uc.followed = 1)`;
}

export function followedPlaylistExists(uid: number) {
  return `EXISTS (
    SELECT 1 FROM channel_playlist_videos cpv
    JOIN user_followed_playlists ufp ON ufp.playlist_id = cpv.playlist_id
    WHERE cpv.video_id = v.video_id AND ufp.user_id = ${uid}
      AND ufp.include_in_feed = 1
  )`;
}

export function feedSortSql() {
  // Playlist membership must not make old videos look newly published. The
  // feed already excludes incomplete rows, so the real publication date is
  // always available here.
  return "v.published_at";
}
