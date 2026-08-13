import { describe, expect, test } from "bun:test";
import { classifyVideoCommentsError, createVideoCommentsFetcher, normalizeVideoComments, validYouTubeVideoId, videoCommentsExtractorArgs, YOUTUBE_COMMENTS_EXTRACTOR_ARGS } from "./youtubeComments";

describe("YouTube comments", () => {
  test("normalizes yt-dlp comment fields and drops unusable entries", () => {
    expect(normalizeVideoComments([
      {
        id: "c1",
        parent: "root",
        text: "A useful comment",
        author: "Viewer",
        author_id: "UC1",
        author_url: "https://www.youtube.com/channel/UC1",
        author_thumbnail: "https://yt3.ggpht.com/avatar",
        timestamp: 1_700_000_000,
        time_text: "2 years ago",
        like_count: 12.8,
        is_pinned: true,
        is_favorited: true,
        author_is_uploader: true,
      },
      { id: "empty", text: "" },
      null,
    ])).toEqual([{
      id: "c1",
      parent: "root",
      text: "A useful comment",
      author: "Viewer",
      authorId: "UC1",
      authorUrl: "https://www.youtube.com/channel/UC1",
      authorThumbnail: "https://yt3.ggpht.com/avatar",
      timestamp: 1_700_000_000,
      timeText: "2 years ago",
      likeCount: 12,
      isPinned: true,
      isFavorited: true,
      authorIsUploader: true,
    }]);
  });

  test("accepts YouTube ids without accepting URLs or shell input", () => {
    expect(validYouTubeVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(validYouTubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(validYouTubeVideoId("abc;touch-x")).toBe(false);
  });

  test("keeps comment extraction bounded without truncating reply depth", () => {
    expect(YOUTUBE_COMMENTS_EXTRACTOR_ARGS).toBe("youtube:comment_sort=top;max_comments=1000,all,all,all,all");
    expect(videoCommentsExtractorArgs("new")).toBe("youtube:comment_sort=new;max_comments=1000,all,all,all,all");
    expect(normalizeVideoComments(Array.from({ length: 1_001 }, (_, index) => ({ id: `c${index}`, text: "Comment" }))).length).toBe(1_000);
  });

  test("keeps successful results in memory for five minutes and supports refresh", async () => {
    let clock = 1_700_000_000_000;
    let calls = 0;
    const comment = normalizeVideoComments([{ id: "c1", text: "Cached", author: "Viewer" }]);
    const fetch = createVideoCommentsFetcher(async () => { calls += 1; return comment; }, () => clock);

    expect((await fetch("dQw4w9WgXcQ")).cached).toBe(false);
    expect((await fetch("dQw4w9WgXcQ")).cached).toBe(true);
    expect(calls).toBe(1);

    await fetch("dQw4w9WgXcQ", "top", true);
    expect(calls).toBe(2);

    clock += 5 * 60_000 + 1;
    expect((await fetch("dQw4w9WgXcQ")).cached).toBe(false);
    expect(calls).toBe(3);
  });

  test("caches popular and newest comment selections independently", async () => {
    const calls: string[] = [];
    const fetch = createVideoCommentsFetcher(async (_id, sort) => {
      calls.push(sort);
      return normalizeVideoComments([{ id: sort, text: sort }]);
    });

    expect((await fetch("dQw4w9WgXcQ", "top")).comments[0]?.id).toBe("top");
    expect((await fetch("dQw4w9WgXcQ", "new")).comments[0]?.id).toBe("new");
    expect((await fetch("dQw4w9WgXcQ", "top")).cached).toBe(true);
    expect(calls).toEqual(["top", "new"]);
  });

  test("classifies friendly failure states while retaining safe details", () => {
    expect(classifyVideoCommentsError("ERROR: Comments are turned off").code).toBe("comments_disabled");
    expect(classifyVideoCommentsError("HTTP Error 429: Too Many Requests").code).toBe("rate_limited");
    expect(classifyVideoCommentsError("yt-dlp executable not found").code).toBe("ytdlp_missing");
    expect(classifyVideoCommentsError("Sign in to confirm your age").code).toBe("login_required");
    expect(classifyVideoCommentsError("process terminated", true).code).toBe("timeout");
    expect(classifyVideoCommentsError("failed at /Users/person/private/file").detail).not.toContain("/Users/person");
  });
});
