import { describe, expect, test } from "bun:test";
import { isPlaybackQueueContext } from "./playbackQueue";

describe("playback queue context", () => {
  test("accepts every durable source descriptor", () => {
    const contexts = [
      { version: 1, kind: "feed", tags: [1, 2], sort: "arrival", showAll: false },
      { version: 1, kind: "liked", showShorts: true },
      { version: 1, kind: "history" },
      { version: 1, kind: "archive" },
      { version: 1, kind: "user-playlist", playlistUuid: "playlist-uuid", sort: "added-newest" },
      { version: 1, kind: "channel-playlist", playlistId: "PL1234567890", sort: "playlist-order" },
      { version: 1, kind: "watchlist", sort: "duration-desc", dueOnly: false },
      { version: 1, kind: "recommendations" },
      { version: 1, kind: "in-progress" },
    ];
    for (const context of contexts) expect(isPlaybackQueueContext(context)).toBe(true);
  });

  test("rejects snapshots and malformed filters", () => {
    expect(isPlaybackQueueContext({ version: 1, kind: "snapshot", videoIds: ["a", "b"] })).toBe(false);
    expect(isPlaybackQueueContext({ version: 1, kind: "feed", tags: [0], sort: "arrival", showAll: false })).toBe(false);
    expect(isPlaybackQueueContext({ version: 1, kind: "watchlist", sort: "random", dueOnly: false })).toBe(false);
    expect(isPlaybackQueueContext({ kind: "history" })).toBe(false);
  });
});
