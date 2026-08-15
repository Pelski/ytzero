import { describe, expect, test } from "bun:test";
import { adjacentFromOrder, adjacentFromPlaybackOrder, nextFromOrder, watchlistOrder } from "./playbackAdjacent";

describe("playback context adjacency", () => {
  test("walks the current source order in either configured direction", () => {
    expect(adjacentFromOrder(["a", "b", "c"], "b", "newest")).toBe("c");
    expect(adjacentFromOrder(["a", "b", "c"], "b", "oldest")).toBe("a");
    expect(adjacentFromOrder(["a", "b", "c"], "missing", "newest")).toBeNull();
  });

  test("walks an explicitly ordered playlist to the following entry", () => {
    expect(nextFromOrder(["a", "b", "c"], "a")).toBe("b");
    expect(nextFromOrder(["a", "b", "c"], "b")).toBe("c");
    expect(nextFromOrder(["a", "b", "c"], "c")).toBeNull();
    expect(nextFromOrder(["a", "b", "c"], "missing")).toBeNull();
  });

  test("ignores feed direction for user and channel playlist orders only", () => {
    for (const kind of ["user-playlist", "channel-playlist"] as const) {
      expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", kind, "newest")).toBe("c");
      expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", kind, "oldest")).toBe("c");
    }
    expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", "history", "oldest")).toBe("a");
  });

  test("recreates the sectioned Watch later order without snapshots", () => {
    const rows = [
      { video_id: "weekend", bucket: "weekend", show_from: "2026-08-15", duration: "1:00", title: "Z", channel_title: "C" },
      { video_id: "tonight", bucket: "tonight", show_from: "2026-08-10 20:00", duration: "3:00", title: "B", channel_title: "B" },
      { video_id: "today", bucket: "today", show_from: "2026-08-10 10:00", duration: "2:00", title: "A", channel_title: "A" },
    ];
    expect(watchlistOrder(rows, "schedule")).toEqual(["today", "tonight", "weekend"]);
    expect(watchlistOrder(rows, "duration-desc")).toEqual(["tonight", "today", "weekend"]);
  });
});
