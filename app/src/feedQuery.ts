import { getUserSetting } from "./db";
import { childHidesLive } from "./childTime";
import { feedSortSql, filterOnlySql, followedExists, followedPlaylistExists, tagFilterSql } from "./feedQueryFragments";
import { feedMaxAgeCutoff } from "./feedMaxAge";
import { pluginEnabled } from "./plugins";

export { feedSortSql, filterOnlySql, followedExists, followedPlaylistExists, tagFilterSql };

export function feedSourceExists(uid: number): string {
  const archived = pluginEnabled("tubearchivist")
    ? " OR EXISTS (SELECT 1 FROM tube_archivist_items tai WHERE tai.video_id=v.video_id AND tai.available=1)"
    : "";
  return `(${followedExists(uid)} OR ${followedPlaylistExists(uid)}${archived})`;
}

export interface FeedVisibilityQuery {
  status?: string;
  tags?: string;
  show_all?: string;
  shorts?: string;
}

export type ShortsFeedMode = "0" | "selected" | "1";

export function shortsFeedMode(userId: number): ShortsFeedMode {
  const value = getUserSetting(userId, "show_shorts");
  return value === "1" || value === "selected" ? value : "0";
}

export function appendShortsFeedVisibility(where: string[], userId: number): void {
  const mode = shortsFeedMode(userId);
  if (mode === "0") {
    where.push("COALESCE(v.is_short, 0) = 0");
  } else if (mode === "selected") {
    where.push(`(
      COALESCE(v.is_short, 0) = 0 OR COALESCE((
        SELECT shorts_pref.shorts_feed_visibility FROM user_channels shorts_pref
        WHERE shorts_pref.user_id = ${userId} AND shorts_pref.channel_id = v.channel_id
      ), 'default') = 'show'
    )`);
  }
}

// The WHERE clause for the plain, unfiltered-by-channel/search main feed —
// shared by GET /feed (when none of channel/q/all_sources/liked/only_shorts
// apply), GET /feed/adjacent and the cleanup view, so "what the feed shows"
// can never drift from what any of those consider deletable/keepable.
// `includeHidden` skips every taste-based hiding rule (shorts, live, members-only
// visibility, filter-only tags) while keeping the core "belongs to this profile's
// library" + status conditions — used by cleanup's "also match videos hidden from
// the feed" toggle.
export function feedVisibilityWhere(
  q: FeedVisibilityQuery,
  uid: number,
  opts: { includeHidden?: boolean } = {},
): { where: string[]; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  where.push("COALESCE(v.is_unavailable, 0) = 0");
  where.push("(v.published_at IS NOT NULL AND v.published_at != '')");
  const status = q.status ?? "inbox";
  if (status !== "all") {
    where.push("COALESCE(uv.status, 'inbox') = ?");
    params.push(status);
  }
  // Watched state is independent from inbox/archive state. Takeout imports and
  // older clients may mark a video watched without archiving it, but the main
  // feed is an inbox of things still left to watch.
  where.push("COALESCE(uv.watched, 0) = 0");
  // Following is the profile-level source of truth. A video may have first
  // entered storage as a temporary Recommendation (`external = 1`), but once
  // its channel is followed it belongs in Main just like an RSS-first upload.
  where.push(feedSourceExists(uid));
  if (!opts.includeHidden) {
    // Age limit: old uploads stay in the library and on channel pages, they just
    // never surface in the feed (see feed_max_age_* in SETTING_DEFAULTS).
    const cutoff = feedMaxAgeCutoff(getUserSetting(uid, "feed_max_age_value"), getUserSetting(uid, "feed_max_age_unit"));
    if (cutoff) {
      where.push("v.published_at >= ?");
      params.push(cutoff);
    }
    const shortsParam = q.shorts;
    if (shortsParam === "0") {
      where.push("COALESCE(v.is_short, 0) = 0");
    } else if (shortsParam !== "1") {
      appendShortsFeedVisibility(where, uid);
    }
    if (getUserSetting(uid, "hide_live_from_feed") === "1" || childHidesLive(uid)) {
      where.push("v.live_status NOT IN ('live', 'upcoming')");
    }
    where.push(`NOT (
      v.members_only = 1 AND CASE COALESCE(
        (SELECT member_pref.members_only_visibility FROM user_channels member_pref
         WHERE member_pref.user_id = ${uid} AND member_pref.channel_id = v.channel_id), 'default'
      )
        WHEN 'channel' THEN 1
        WHEN 'hidden' THEN 1
        WHEN 'everywhere' THEN 0
        WHEN 'feed' THEN 0
        ELSE ?
      END = 1
    )`);
    params.push(getUserSetting(uid, "hide_members_only_from_feed") === "1" ? 1 : 0);
  }
  const tagsParam = q.tags;
  const tagIds = tagsParam ? tagsParam.split(",").map(Number).filter(Boolean) : [];
  if (tagIds.length) {
    const f = tagFilterSql(uid, tagIds);
    where.push(f.sql);
    params.push(...f.params);
  }
  const showAll = q.show_all === "1";
  if (!opts.includeHidden && !showAll) {
    const fo = filterOnlySql(uid, tagIds);
    where.push(fo.sql);
    params.push(...fo.params);
  }
  return { where, params };
}
