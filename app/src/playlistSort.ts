export const PLAYLIST_SORTS = ["oldest", "newest", "title-asc", "title-desc"] as const;
export type PlaylistSort = (typeof PLAYLIST_SORTS)[number];

export function normalizePlaylistSort(value: unknown): PlaylistSort {
  return typeof value === "string" && (PLAYLIST_SORTS as readonly string[]).includes(value)
    ? value as PlaylistSort
    : "oldest";
}

export function sortPlaylistItems<T>(
  items: readonly T[],
  sort: PlaylistSort,
  fields: (item: T) => { title: string; publishedAt: string | null | undefined },
): T[] {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  return items.map((item, index) => ({ item, index, ...fields(item) })).sort((left, right) => {
    let compared = 0;
    if (sort === "title-asc" || sort === "title-desc") {
      compared = collator.compare(left.title, right.title) * (sort === "title-desc" ? -1 : 1);
    } else if (left.publishedAt && right.publishedAt) {
      compared = left.publishedAt.localeCompare(right.publishedAt) * (sort === "newest" ? -1 : 1);
    } else if (left.publishedAt || right.publishedAt) {
      compared = left.publishedAt ? -1 : 1;
    }
    return compared || left.index - right.index;
  }).map(({ item }) => item);
}
