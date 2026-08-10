import type { Video } from "./apiTypes";

export const WATCHLIST_SORTS = ["schedule", "duration-asc", "duration-desc", "title-asc", "channel-asc"] as const;
export type WatchlistSort = (typeof WATCHLIST_SORTS)[number];
const PLAYLIST_SORTS = ["oldest", "newest", "title-asc", "title-desc"] as const;

export type PlaybackQueueContext =
  | { version: 1; kind: "feed"; tags: number[]; showAll: boolean; sort: "published" | "arrival" }
  | { version: 1; kind: "liked"; showShorts: boolean }
  | { version: 1; kind: "history" }
  | { version: 1; kind: "archive" }
  | { version: 1; kind: "user-playlist"; playlistUuid: string }
  | { version: 1; kind: "channel-playlist"; playlistId: string; sort: (typeof PLAYLIST_SORTS)[number] }
  | { version: 1; kind: "watchlist"; sort: WatchlistSort; dueOnly: boolean }
  | { version: 1; kind: "recommendations" }
  | { version: 1; kind: "in-progress" };

export type PlayVideo = (video: Video, queue?: PlaybackQueueContext) => void;

export function isPlaybackQueueContext(value: unknown): value is PlaybackQueueContext {
  if (!value || typeof value !== "object") return false;
  const queue = value as Partial<PlaybackQueueContext>;
  if (queue.version !== 1) return false;
  if (queue.kind === "feed") return Array.isArray(queue.tags) && queue.tags.every((tag) => Number.isSafeInteger(tag) && tag > 0)
    && typeof queue.showAll === "boolean" && (queue.sort === "published" || queue.sort === "arrival");
  if (queue.kind === "liked") return typeof queue.showShorts === "boolean";
  if (queue.kind === "user-playlist") return typeof queue.playlistUuid === "string" && queue.playlistUuid.length > 0;
  if (queue.kind === "channel-playlist") return typeof queue.playlistId === "string" && queue.playlistId.length > 0
    && (PLAYLIST_SORTS as readonly unknown[]).includes(queue.sort);
  if (queue.kind === "watchlist") return typeof queue.dueOnly === "boolean" && (WATCHLIST_SORTS as readonly unknown[]).includes(queue.sort);
  return queue.kind === "history" || queue.kind === "archive" || queue.kind === "recommendations" || queue.kind === "in-progress";
}
