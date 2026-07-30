import { describe, expect, test } from "bun:test";
import { isPlaybackQueueContext, nextSnapshotVideoId, snapshotPlaybackQueue } from "./playbackQueue";

const videos = ["a", "b", "c"].map((video_id) => ({ video_id })) as any[];

describe("playback queue context", () => {
  test("preserves the exact visible list order", () => {
    expect(JSON.stringify(snapshotPlaybackQueue(videos, "Scheduled"))).toBe(JSON.stringify({
      kind: "snapshot",
      videoIds: ["a", "b", "c"],
      label: "Scheduled",
    }));
  });

  test("walks forward or in reverse without wrapping", () => {
    const queue = snapshotPlaybackQueue(videos, "Scheduled");
    if (queue.kind !== "snapshot") throw new Error("snapshot expected");
    expect(nextSnapshotVideoId(queue, "b", "newest")).toBe("c");
    expect(nextSnapshotVideoId(queue, "b", "oldest")).toBe("a");
    expect(nextSnapshotVideoId(queue, "c", "newest")).toBe(null);
    expect(nextSnapshotVideoId(queue, "a", "oldest")).toBe(null);
  });

  test("rejects malformed router state", () => {
    expect(isPlaybackQueueContext({ kind: "snapshot", videoIds: ["a", 2] })).toBe(false);
    expect(isPlaybackQueueContext({ kind: "feed", tags: [], sort: "arrival", showAll: false })).toBe(true);
  });
});
