import { describe, expect, test } from "bun:test";
import type { VideoComment } from "./api";
import { buildVideoCommentThreads } from "./videoCommentThreads";

const comment = (id: string, likeCount: number, timestamp: number, parent: string | null = "root"): VideoComment => ({
  id, parent, likeCount, timestamp, text: id, author: "Viewer", authorId: null,
  authorUrl: null, authorThumbnail: null, timeText: null, isPinned: false,
  isFavorited: false, authorIsUploader: false,
});

describe("video comment threads", () => {
  test("sorts root threads by likes without separating replies", () => {
    const threads = buildVideoCommentThreads([
      comment("older", 2, 100), comment("reply", 100, 400, "older"), comment("popular", 8, 200),
    ], "top");
    expect(threads.map((thread) => thread.comment.id)).toEqual(["popular", "older"]);
    expect(threads[1]?.replies.map((reply) => reply.comment.id)).toEqual(["reply"]);
  });

  test("sorts root threads newest first and leaves unknown dates last", () => {
    const threads = buildVideoCommentThreads([
      comment("unknown", 50, 0), comment("old", 1, 100), comment("new", 0, 300),
    ].map((entry) => entry.id === "unknown" ? { ...entry, timestamp: null } : entry), "new");
    expect(threads.map((thread) => thread.comment.id)).toEqual(["new", "old", "unknown"]);
  });
});
