import { describe, expect, test } from "bun:test";
import { parsePlaybackContext, type PlaybackContext } from "./playbackContext";

describe("persisted playback context", () => {
  test("normalizes every supported source without storing video ids", () => {
    const contexts = [
      { version: 1, kind: "feed", tags: [2, 2, 5], sort: "published", showAll: true },
      { version: 1, kind: "liked", showShorts: false },
      { version: 1, kind: "history" },
      { version: 1, kind: "archive" },
      { version: 1, kind: "user-playlist", playlistUuid: "123e4567-e89b-42d3-a456-426614174000", sort: "added-oldest" },
      { version: 1, kind: "channel-playlist", playlistId: "PL1234567890", sort: "playlist-order" },
      { version: 1, kind: "watchlist", sort: "channel-asc", dueOnly: true },
      { version: 1, kind: "recommendations" },
      { version: 1, kind: "in-progress" },
    ] satisfies PlaybackContext[];
    for (const input of contexts) {
      const parsed = parsePlaybackContext(input);
      expect(parsed).not.toBeNull();
      expect(JSON.stringify(parsed)).not.toContain("videoIds");
    }
    expect(parsePlaybackContext(contexts[0])).toEqual({ version: 1, kind: "feed", tags: [2, 5], sort: "published", showAll: true });
    expect(parsePlaybackContext({ version: 1, kind: "user-playlist", playlistUuid: "123e4567-e89b-42d3-a456-426614174000" }))
      .toEqual({ version: 1, kind: "user-playlist", playlistUuid: "123e4567-e89b-42d3-a456-426614174000", sort: "added-newest" });
  });

  test("rejects unversioned, oversized and snapshot contexts", () => {
    expect(parsePlaybackContext({ kind: "history" })).toBeNull();
    expect(parsePlaybackContext({ version: 1, kind: "snapshot", videoIds: ["video"] })).toBeNull();
    expect(parsePlaybackContext({ version: 1, kind: "feed", tags: Array.from({ length: 51 }, (_, index) => index + 1), showAll: false, sort: "published" })).toBeNull();
  });
});
