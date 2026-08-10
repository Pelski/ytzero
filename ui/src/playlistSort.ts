export const PLAYLIST_SORTS = ["playlist-order", "oldest", "newest", "title-asc", "title-desc"] as const;
export type PlaylistSort = (typeof PLAYLIST_SORTS)[number];
export const USER_PLAYLIST_SORTS = [...PLAYLIST_SORTS, "added-oldest", "added-newest"] as const;
export type UserPlaylistSort = (typeof USER_PLAYLIST_SORTS)[number];

export function normalizePlaylistSort(value: unknown): PlaylistSort {
  return typeof value === "string" && (PLAYLIST_SORTS as readonly string[]).includes(value)
    ? value as PlaylistSort
    : "oldest";
}

export function normalizeUserPlaylistSort(value: unknown): UserPlaylistSort {
  return typeof value === "string" && (USER_PLAYLIST_SORTS as readonly string[]).includes(value)
    ? value as UserPlaylistSort
    : "added-newest";
}

export function playlistSortSearch(sort: PlaylistSort): string {
  return `?sort=${encodeURIComponent(sort)}`;
}
