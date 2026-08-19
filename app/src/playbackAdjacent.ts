import { childDownloadsOnly, childHidesLive } from "./childTime";
import { database } from "./database";
import { getUserSetting } from "./db";
import { feedSortSql, feedVisibilityWhere, shortsUiVisibilitySql } from "./feedQuery";
import type { PlaybackContext, WatchlistSort } from "./playbackContext";
import { sortFetchedPlaylistVideos } from "./playlistVideoOrder";
import { recommendationQueueVideoIds } from "./plugins";
import { fetchPlaylistVideos } from "./youtube";
import { sortUserPlaylistRows, type UserPlaylistSortable } from "./userPlaylistSort";

export type PlaybackDirection = "oldest" | "newest";

export function nextFromOrder(ids: readonly string[], currentVideoId: string): string | null {
  const index = ids.indexOf(currentVideoId);
  if (index < 0) return null;
  return ids[index + 1] ?? null;
}

export function adjacentFromOrder(ids: readonly string[], currentVideoId: string, direction: PlaybackDirection): string | null {
  if (direction === "newest") return nextFromOrder(ids, currentVideoId);
  const index = ids.indexOf(currentVideoId);
  if (index < 0) return null;
  return ids[index - 1] ?? null;
}

type OrderedPlaybackKind = Exclude<PlaybackContext["kind"], "feed">;

export function adjacentFromPlaybackOrder(ids: readonly string[], currentVideoId: string, kind: OrderedPlaybackKind, direction: PlaybackDirection): string | null {
  if (kind === "user-playlist" || kind === "channel-playlist") return nextFromOrder(ids, currentVideoId);
  return adjacentFromOrder(ids, currentVideoId, direction);
}

async function feedAdjacent(userId: number, currentVideoId: string, context: Extract<PlaybackContext, { kind: "feed" }>, direction: PlaybackDirection) {
  const sortColumn = feedSortSql(context.sort);
  const anchor = await database.prepare("SELECT video_id, published_at, created_at FROM videos WHERE video_id = ?").get(currentVideoId) as { video_id: string; published_at: string | null; created_at: string } | null;
  const anchorTime = context.sort === "arrival" ? anchor?.created_at : anchor?.published_at;
  if (!anchor || !anchorTime) return null;
  const { where, params } = feedVisibilityWhere({ tags: context.tags.join(","), show_all: context.showAll ? "1" : undefined }, userId);
  where.push(shortsUiVisibilitySql(userId));
  const comparison = direction === "oldest" ? ">" : "<";
  where.push(`(${sortColumn} ${comparison} ? OR (${sortColumn} = ? AND v.video_id ${comparison} ?))`);
  params.push(anchorTime, anchorTime, anchor.video_id);
  where.push(`NOT (
    uv.watch_position IS NOT NULL AND uv.watch_duration IS NOT NULL
    AND uv.watch_duration > 30 AND uv.watch_position >= 3
    AND CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92
  )`);
  const order = direction === "oldest" ? "ASC" : "DESC";
  const row = await database.prepare(`SELECT v.video_id FROM videos v
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${userId}
    WHERE ${where.join(" AND ")} ORDER BY ${sortColumn} ${order}, v.video_id ${order} LIMIT 1`).get(...params) as { video_id: string } | null;
  return row?.video_id ?? null;
}

function durationSeconds(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

interface WatchlistRow { video_id: string; bucket: string | null; show_from: string | null; queued_at?: string | null; duration: string | null; title: string; channel_title: string }
const BUCKET_ORDER = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];

export function watchlistOrder(rows: WatchlistRow[], sort: WatchlistSort, locale?: string): string[] {
  const baseOrder = (a: WatchlistRow, b: WatchlistRow) =>
    String(b.queued_at ?? "").localeCompare(String(a.queued_at ?? "")) || b.video_id.localeCompare(a.video_id);
  const schedule = (a: WatchlistRow, b: WatchlistRow) => {
    const bucket = BUCKET_ORDER.indexOf(a.bucket ?? "") - BUCKET_ORDER.indexOf(b.bucket ?? "");
    return bucket || String(a.show_from ?? "").localeCompare(String(b.show_from ?? "")) || baseOrder(a, b);
  };
  const comparator = (a: WatchlistRow, b: WatchlistRow) => {
    if (sort === "schedule") return schedule(a, b);
    if (sort === "title-asc") return a.title.localeCompare(b.title, locale) || baseOrder(a, b);
    if (sort === "channel-asc") return a.channel_title.localeCompare(b.channel_title, locale) || baseOrder(a, b);
    const left = durationSeconds(a.duration), right = durationSeconds(b.duration);
    if (left == null && right == null) return schedule(a, b);
    if (left == null) return 1;
    if (right == null) return -1;
    return (left - right) * (sort === "duration-desc" ? -1 : 1) || baseOrder(a, b);
  };
  const sections = [["today", "tonight"], ["tomorrow", "tomorrow_evening"], ["weekend"]];
  return sections.flatMap((buckets) => rows.filter((row) => buckets.includes(row.bucket ?? "")).sort(comparator)).map((row) => row.video_id);
}

async function orderedVideoIds(userId: number, context: Exclude<PlaybackContext, { kind: "feed" }>): Promise<string[]> {
  if (context.kind === "liked") {
    const where = ["uv.user_id = ?", "uv.liked = 1", "v.published_at IS NOT NULL", "v.published_at != ''"];
    if (!context.showShorts || getUserSetting(userId, "show_shorts") === "disabled") where.push("COALESCE(v.is_short, 0) = 0");
    if (getUserSetting(userId, "hide_live_from_feed") === "1" || childHidesLive(userId)) where.push("v.live_status NOT IN ('live', 'upcoming')");
    return (await database.prepare(`SELECT v.video_id FROM videos v JOIN user_videos uv ON uv.video_id=v.video_id WHERE ${where.join(" AND ")} ORDER BY COALESCE(v.published_at,v.created_at) DESC,v.video_id DESC`).all(userId) as { video_id: string }[]).map((row) => row.video_id);
  }
  if (context.kind === "history") {
    return (await database.prepare(`SELECT h.video_id FROM (SELECT video_id,MAX(id) history_id,MAX(watched_at) watched_at FROM history WHERE user_id=? GROUP BY video_id) h JOIN videos v ON v.video_id=h.video_id WHERE ${shortsUiVisibilitySql(userId)} ORDER BY h.watched_at DESC,h.history_id DESC`).all(userId) as { video_id: string }[]).map((row) => row.video_id);
  }
  if (context.kind === "archive") {
    return (await database.prepare(`SELECT v.video_id FROM videos v JOIN user_videos uv ON uv.video_id=v.video_id AND uv.user_id=? WHERE uv.status='archived' AND ${shortsUiVisibilitySql(userId)} ORDER BY COALESCE(v.published_at,v.created_at) DESC,v.video_id DESC`).all(userId) as { video_id: string }[]).map((row) => row.video_id);
  }
  if (context.kind === "user-playlist") {
    const rows = await database.prepare(`SELECT upv.video_id,upv.added_at,upv.position,v.title,v.published_at
      FROM user_playlist_videos upv JOIN user_playlists up ON up.id=upv.playlist_id JOIN videos v ON v.video_id=upv.video_id
      WHERE up.user_id=? AND up.portable_uuid=? AND ${shortsUiVisibilitySql(userId)} ORDER BY upv.position ASC,upv.video_id ASC`)
      .all(userId, context.playlistUuid) as Array<{ video_id: string } & UserPlaylistSortable>;
    return sortUserPlaylistRows(rows, context.sort).map((row) => row.video_id);
  }
  if (context.kind === "channel-playlist") {
    return (await sortFetchedPlaylistVideos(await fetchPlaylistVideos(context.playlistId), context.sort)).map((video) => video.videoId);
  }
  if (context.kind === "recommendations") return recommendationQueueVideoIds(userId, { downloadsOnly: childDownloadsOnly(userId) });
  if (context.kind === "in-progress") {
    return (await database.prepare(`SELECT uv.video_id FROM user_videos uv JOIN (SELECT video_id,MAX(watched_at) last_watched FROM history WHERE user_id=? GROUP BY video_id) lw ON lw.video_id=uv.video_id JOIN videos v ON v.video_id=uv.video_id WHERE uv.user_id=? AND v.published_at IS NOT NULL AND v.published_at!='' AND uv.watch_position IS NOT NULL AND uv.watch_duration>30 AND uv.watch_position>=3 AND CAST(uv.watch_position AS REAL)/uv.watch_duration<0.92 AND uv.status='inbox' AND ${shortsUiVisibilitySql(userId)} ORDER BY lw.last_watched DESC,uv.video_id DESC`).all(userId, userId) as { video_id: string }[]).map((row) => row.video_id);
  }
  const due = context.dueOnly ? "AND (uv.show_from IS NULL OR uv.show_from <= datetime('now'))" : "";
  const rows = await database.prepare(`SELECT v.video_id,uv.bucket,uv.show_from,uv.queued_at,v.duration,v.title,COALESCE(c.custom_title,c.title) channel_title FROM user_videos uv JOIN videos v ON v.video_id=uv.video_id JOIN channels c ON c.channel_id=v.channel_id WHERE uv.user_id=? AND uv.status='queued' AND ${shortsUiVisibilitySql(userId)} ${due} ORDER BY uv.queued_at DESC,v.video_id DESC`).all(userId) as WatchlistRow[];
  const language = getUserSetting(userId, "language") ?? "en";
  const locale = ({ pl: "pl-PL", de: "de-DE", en: "en-US" } as Record<string, string>)[language];
  return watchlistOrder(rows, context.sort, locale);
}

export async function resolveAdjacentPlaybackVideoId(userId: number, currentVideoId: string, context: PlaybackContext, direction: PlaybackDirection): Promise<string | null> {
  if (context.kind === "feed") return feedAdjacent(userId, currentVideoId, context, direction);
  const ids = await orderedVideoIds(userId, context);
  return adjacentFromPlaybackOrder(ids, currentVideoId, context.kind, direction);
}
