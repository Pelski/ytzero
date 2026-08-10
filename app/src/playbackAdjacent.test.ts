import { describe, expect, test } from "bun:test";
import { adjacentFromOrder, watchlistOrder } from "./playbackAdjacent";

describe("playback context adjacency", () => {
  test("walks the current source order in either configured direction", () => {
    expect(adjacentFromOrder(["a", "b", "c"], "b", "newest")).toBe("c");
    expect(adjacentFromOrder(["a", "b", "c"], "b", "oldest")).toBe("a");
    expect(adjacentFromOrder(["a", "b", "c"], "missing", "newest")).toBeNull();
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
