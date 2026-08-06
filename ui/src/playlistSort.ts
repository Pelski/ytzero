export const PLAYLIST_SORTS = ["oldest", "newest", "title-asc", "title-desc"] as const;
export type PlaylistSort = (typeof PLAYLIST_SORTS)[number];

export function normalizePlaylistSort(value: unknown): PlaylistSort {
  return typeof value === "string" && (PLAYLIST_SORTS as readonly string[]).includes(value)
    ? value as PlaylistSort
    : "oldest";
}

export function playlistSortSearch(sort: PlaylistSort): string {
  return `?sort=${encodeURIComponent(sort)}`;
}
