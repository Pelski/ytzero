/**
 * A download is global, so a feed item is eligible when at least one profile
 * follows its channel and would actually see the item in that profile's feed.
 * Keep the members-only modes aligned with feedVisibilityWhere.
 */
export function autoDownloadFollowerExistsSql(videoAlias = "v") {
  return `EXISTS (
    SELECT 1
    FROM user_channels download_follower
    WHERE download_follower.channel_id = ${videoAlias}.channel_id
      AND download_follower.followed = 1
      AND NOT (
        ${videoAlias}.members_only = 1
        AND CASE COALESCE(download_follower.members_only_visibility, 'default')
          WHEN 'channel' THEN 1
          WHEN 'hidden' THEN 1
          WHEN 'everywhere' THEN 0
          WHEN 'feed' THEN 0
          ELSE COALESCE((
            SELECT CAST(download_setting.value AS INTEGER)
            FROM user_settings download_setting
            WHERE download_setting.user_id = download_follower.user_id
              AND download_setting.key = 'hide_members_only_from_feed'
          ), 0)
        END = 1
      )
  )`;
}
