import type { Context, Hono } from "hono";
import { database } from "../database";
import { getUserSetting } from "../db";
import { childHidesLive } from "../childTime";
import { feedVisibilityWhere, feedSortSql, feedSourceExists, tagFilterSql, filterOnlySql } from "../feedQuery";
import { videoSelect, type VideoRow } from "../videoRoutesSupport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerFeedRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    attachTags: (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;
  },
): void {
  const { currentUserId, attachTags } = access;

// ---------- feed ----------

api.get("/feed", async (c) => {
  const uid = currentUserId(c);
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const limit = Math.min(100, Number(c.req.query("limit") ?? 40));
  const q = c.req.query("q")?.trim();
  const channel = c.req.query("channel");
  const allSources = c.req.query("all_sources") === "1";
  const processing = c.req.query("processing") === "1";
  if (processing && !channel) return c.json({ videos: [], page, limit });

  // Channel defaults inherit the profile-wide visibility for each surface.
  const isMainFeed = !processing && !channel && !allSources && !q && c.req.query("liked") !== "1" && c.req.query("only_shorts") !== "1";

  let where: string[];
  let params: any[];
  if (isMainFeed) {
    ({ where, params } = feedVisibilityWhere(c.req.query(), uid));
  } else {
    where = [];
    params = [];
    // Videos without a publication date are incomplete imports. Never let them
    // use created_at as a fake feed date; expose them only through the channel's
    // dedicated processing tab.
    where.push(processing
      ? "(v.published_at IS NULL OR v.published_at = '')"
      : "(v.published_at IS NOT NULL AND v.published_at != '')");
    const status = c.req.query("status") ?? "inbox";
    if (status !== "all") {
      where.push("COALESCE(uv.status, 'inbox') = ?");
      params.push(status);
    }
    if (channel) {
      where.push("v.channel_id = ?");
      params.push(channel);
    } else if (!allSources) {
      where.push(feedSourceExists(uid));
    }
    if (q) {
      where.push("(v.title LIKE ? OR v.description LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    // Outside Main, only an explicit query parameter controls Shorts. The
    // profile policy is deliberately scoped to the main feed.
    const shortsParam = c.req.query("shorts");
    if (shortsParam === "0") {
      where.push("COALESCE(v.is_short, 0) = 0");
    }
    if (c.req.query("only_shorts") === "1") {
      where.push("v.is_short = 1");
    }
    // Keep live/upcoming streams available in the dedicated Live tab, while
    // allowing each profile to keep its main feed focused on regular uploads.
    if (c.req.query("only_shorts") !== "1" && (getUserSetting(uid, "hide_live_from_feed") === "1" || childHidesLive(uid))) {
      where.push("v.live_status NOT IN ('live', 'upcoming')");
    }
    if (channel) {
      where.push(`NOT (
        v.members_only = 1 AND CASE COALESCE(
          (SELECT member_pref.members_only_visibility FROM user_channels member_pref
           WHERE member_pref.user_id = ${uid} AND member_pref.channel_id = v.channel_id), 'default'
        )
          WHEN 'feed' THEN 0
          WHEN 'hidden' THEN 1
          WHEN 'everywhere' THEN 0
          WHEN 'channel' THEN 0
          ELSE ?
        END = 1
      )`);
      params.push(getUserSetting(uid, "hide_members_only_on_channel") === "1" ? 1 : 0);
    }
    if (c.req.query("liked") === "1") {
      where.push("uv.liked = 1");
    }
    const tagsParam = c.req.query("tags");
    const tagIds = tagsParam ? tagsParam.split(",").map(Number).filter(Boolean) : [];
    if (tagIds.length) {
      const f = tagFilterSql(uid, tagIds);
      where.push(f.sql);
      params.push(...f.params);
    }
    // Exclude filter_only-tagged videos unless the relevant tag is actively selected.
    // show_all=1 bypasses this entirely and shows everything regardless of filter_only tags.
    const showAll = c.req.query("show_all") === "1";
    if (!channel && !allSources && !showAll) {
      const fo = filterOnlySql(uid, tagIds);
      where.push(fo.sql);
      params.push(...fo.params);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const feedSort = c.req.query("sort") === "arrival" ? "arrival" : "published";
  const rows = await database
    .prepare(`${videoSelect(uid)} ${whereSql} ORDER BY ${isMainFeed ? feedSortSql(feedSort) : "COALESCE(v.published_at, v.created_at)"} DESC, v.video_id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, page * limit) as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows), page, limit });
});

// The next/previous video in the selected main-feed order, skipping
// anything already watched. Backs the "autoplay my feed" setting — resolved
// server-side (rather than walking the client's loaded pages) so it always
// matches the full feed regardless of how many pages the UI has fetched.
api.get("/feed/adjacent", async (c) => {
  const uid = currentUserId(c);
  const videoId = c.req.query("video_id");
  const direction = c.req.query("direction") === "newest" ? "newest" : "oldest";
  const feedSort = c.req.query("sort") === "arrival" ? "arrival" : "published";
  const sortColumn = feedSortSql(feedSort);
  if (!videoId) return c.json({ video: null });
  const anchor = await database.prepare("SELECT video_id, published_at, created_at FROM videos WHERE video_id = ?").get(videoId) as { video_id: string; published_at: string | null; created_at: string } | null;
  const anchorTime = feedSort === "arrival" ? anchor?.created_at : anchor?.published_at;
  if (!anchor || !anchorTime) return c.json({ video: null });

  const { where, params } = feedVisibilityWhere(c.req.query(), uid);
  const comparison = direction === "oldest" ? ">" : "<";
  where.push(`(${sortColumn} ${comparison} ? OR (${sortColumn} = ? AND v.video_id ${comparison} ?))`);
  params.push(anchorTime, anchorTime, anchor.video_id);
  // FeedPage lifts meaningful partials into its separate Continue shelf, so
  // the chronological grid's queue must skip them too.
  where.push(`NOT (
    uv.watch_position IS NOT NULL AND uv.watch_duration IS NOT NULL
    AND uv.watch_duration > 30 AND uv.watch_position >= 3
    AND CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92
  )`);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const orderDirection = direction === "oldest" ? "ASC" : "DESC";
  const order = `${sortColumn} ${orderDirection}, v.video_id ${orderDirection}`;
  const row = await database.prepare(`${videoSelect(uid)} ${whereSql} ORDER BY ${order} LIMIT 1`).get(...params) as VideoRow | undefined;
  return c.json({ video: row ? (await attachTags(uid, [row]))[0] : null });
});

}
