import { describe, expect, test } from "bun:test";
import { normalizePlaylistSort, normalizeUserPlaylistSort, sortPlaylistItems, sortUserPlaylistItems } from "./playlistSort";

const items = [
  { id: "three", title: "Part 10", publishedAt: "2026-03-01" },
  { id: "one", title: "Part 2", publishedAt: "2026-01-01" },
  { id: "two", title: "Alpha", publishedAt: "2026-02-01" },
];
const fields = (item: (typeof items)[number]) => item;

describe("playlist sorting", () => {
  test("normalizes unsupported values to oldest first", () => {
    expect(normalizePlaylistSort("newest")).toBe("newest");
    expect(normalizePlaylistSort("creator-order")).toBe("oldest");
    expect(normalizePlaylistSort("playlist-order")).toBe("playlist-order");
    expect(normalizeUserPlaylistSort("added-oldest")).toBe("added-oldest");
    expect(normalizeUserPlaylistSort("invalid")).toBe("added-newest");
  });

  test("sorts by publication date in both directions", () => {
    expect(sortPlaylistItems(items, "oldest", fields).map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(sortPlaylistItems(items, "newest", fields).map((item) => item.id)).toEqual(["three", "two", "one"]);
  });

  test("sorts titles naturally in both directions", () => {
    expect(sortPlaylistItems(items, "title-asc", fields).map((item) => item.id)).toEqual(["two", "one", "three"]);
    expect(sortPlaylistItems(items, "title-desc", fields).map((item) => item.id)).toEqual(["three", "one", "two"]);
  });

  test("preserves source order and sorts personal playlists by addition date", () => {
    const personal = [
      { ...items[0], addedAt: "2026-01-03", position: 2 },
      { ...items[1], addedAt: "2026-01-01", position: 0 },
      { ...items[2], addedAt: "2026-01-02", position: 1 },
    ];
    const personalFields = (item: (typeof personal)[number]) => item;
    expect(sortUserPlaylistItems(personal, "playlist-order", personalFields).map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(sortUserPlaylistItems(personal, "added-oldest", personalFields).map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(sortUserPlaylistItems(personal, "added-newest", personalFields).map((item) => item.id)).toEqual(["three", "two", "one"]);
  });
});
