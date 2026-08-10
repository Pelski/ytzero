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

export function sortPlaylistItems<T>(
  items: readonly T[],
  sort: PlaylistSort,
  fields: (item: T) => { title: string; publishedAt: string | null | undefined },
): T[] {
  if (sort === "playlist-order") return [...items];
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

export function sortUserPlaylistItems<T>(
  items: readonly T[],
  sort: UserPlaylistSort,
  fields: (item: T) => { title: string; publishedAt: string | null | undefined; addedAt: string; position: number },
): T[] {
  if (sort === "playlist-order") {
    return items.map((item, index) => ({ item, index, position: fields(item).position }))
      .sort((left, right) => left.position - right.position || left.index - right.index)
      .map(({ item }) => item);
  }
  if (sort === "added-oldest" || sort === "added-newest") {
    const direction = sort === "added-newest" ? -1 : 1;
    return items.map((item, index) => ({ item, index, addedAt: fields(item).addedAt }))
      .sort((left, right) => left.addedAt.localeCompare(right.addedAt) * direction || left.index - right.index)
      .map(({ item }) => item);
  }
  return sortPlaylistItems(items, sort, (item) => fields(item));
}
