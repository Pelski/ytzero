export const WATCHLIST_SORTS = ["schedule", "duration-asc", "duration-desc", "title-asc", "channel-asc"] as const;
export type WatchlistSort = (typeof WATCHLIST_SORTS)[number];
export const PLAYLIST_SORTS = ["oldest", "newest", "title-asc", "title-desc"] as const;
export type PlaylistSort = (typeof PLAYLIST_SORTS)[number];

export type PlaybackContext =
  | { version: 1; kind: "feed"; tags: number[]; showAll: boolean; sort: "published" | "arrival" }
  | { version: 1; kind: "liked"; showShorts: boolean }
  | { version: 1; kind: "history" }
  | { version: 1; kind: "archive" }
  | { version: 1; kind: "user-playlist"; playlistUuid: string }
  | { version: 1; kind: "channel-playlist"; playlistId: string; sort: PlaylistSort }
  | { version: 1; kind: "watchlist"; sort: WatchlistSort; dueOnly: boolean }
  | { version: 1; kind: "recommendations" }
  | { version: 1; kind: "in-progress" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePlaybackContext(value: unknown): PlaybackContext | null {
  if (typeof value === "string") {
    try { return parsePlaybackContext(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const context = value as Record<string, unknown>;
  if (context.version !== 1 || typeof context.kind !== "string") return null;
  if (context.kind === "feed") {
    if (!Array.isArray(context.tags) || context.tags.length > 50 || !context.tags.every((tag) => Number.isSafeInteger(tag) && Number(tag) > 0)) return null;
    if (typeof context.showAll !== "boolean" || (context.sort !== "published" && context.sort !== "arrival")) return null;
    return { version: 1, kind: "feed", tags: [...new Set(context.tags as number[])], showAll: context.showAll, sort: context.sort };
  }
  if (context.kind === "liked" && typeof context.showShorts === "boolean") return { version: 1, kind: "liked", showShorts: context.showShorts };
  if (["history", "archive", "recommendations", "in-progress"].includes(context.kind)) return { version: 1, kind: context.kind } as PlaybackContext;
  if (context.kind === "user-playlist" && typeof context.playlistUuid === "string" && UUID.test(context.playlistUuid)) {
    return { version: 1, kind: "user-playlist", playlistUuid: context.playlistUuid };
  }
  if (context.kind === "channel-playlist" && typeof context.playlistId === "string" && /^[A-Za-z0-9_-]{10,100}$/.test(context.playlistId)
    && (PLAYLIST_SORTS as readonly unknown[]).includes(context.sort)) {
    return { version: 1, kind: "channel-playlist", playlistId: context.playlistId, sort: context.sort as PlaylistSort };
  }
  if (context.kind === "watchlist" && typeof context.dueOnly === "boolean" && (WATCHLIST_SORTS as readonly unknown[]).includes(context.sort)) {
    return { version: 1, kind: "watchlist", sort: context.sort as WatchlistSort, dueOnly: context.dueOnly };
  }
  return null;
}

export async function playbackContextBelongsToUser(context: PlaybackContext, userId: number, query: (sql: string, ...params: unknown[]) => Promise<unknown>): Promise<boolean> {
  if (context.kind === "feed" && context.tags.length > 0) {
    const placeholders = context.tags.map(() => "?").join(",");
    const row = await query(`SELECT COUNT(*) AS count FROM tags WHERE user_id = ? AND id IN (${placeholders})`, userId, ...context.tags) as { count?: number } | null;
    return Number(row?.count ?? 0) === context.tags.length;
  }
  if (context.kind === "user-playlist") {
    return Boolean(await query("SELECT 1 FROM user_playlists WHERE user_id = ? AND portable_uuid = ?", userId, context.playlistUuid));
  }
  return true;
}
