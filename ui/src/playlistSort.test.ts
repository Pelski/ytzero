import { describe, expect, test } from "bun:test";
import { normalizePlaylistSort, playlistSortSearch } from "./playlistSort";

describe("playlist sort navigation", () => {
  test("uses oldest first by default and preserves a valid selection", () => {
    expect(normalizePlaylistSort(null)).toBe("oldest");
    expect(normalizePlaylistSort("title-desc")).toBe("title-desc");
    expect(normalizePlaylistSort("invalid")).toBe("oldest");
    expect(playlistSortSearch("title-asc")).toBe("?sort=title-asc");
  });
});
