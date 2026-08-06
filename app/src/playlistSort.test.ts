import { describe, expect, test } from "bun:test";
import { normalizePlaylistSort, sortPlaylistItems } from "./playlistSort";

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
  });

  test("sorts by publication date in both directions", () => {
    expect(sortPlaylistItems(items, "oldest", fields).map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(sortPlaylistItems(items, "newest", fields).map((item) => item.id)).toEqual(["three", "two", "one"]);
  });

  test("sorts titles naturally in both directions", () => {
    expect(sortPlaylistItems(items, "title-asc", fields).map((item) => item.id)).toEqual(["two", "one", "three"]);
    expect(sortPlaylistItems(items, "title-desc", fields).map((item) => item.id)).toEqual(["three", "one", "two"]);
  });
});
