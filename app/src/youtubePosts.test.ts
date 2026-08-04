import { describe, expect, test } from "bun:test";
import { parseChannelPosts } from "./youtubePosts";

describe("YouTube Community Posts parser", () => {
  test("parses text, counters, images, video attachments and deduplicates posts", () => {
    const renderer = {
      postId: "Ugk-test",
      contentText: { runs: [{ text: "Hello " }, { text: "world" }] },
      publishedTimeText: { simpleText: "2 days ago" },
      voteCount: { simpleText: "42" },
      actionButtons: { commentActionButtonsRenderer: { replyButton: { buttonRenderer: { text: { simpleText: "7" } } } } },
      backstageAttachment: {
        postMultiImageRenderer: { images: [{ backstageImageRenderer: { image: { thumbnails: [{ url: "small", width: 100, height: 100 }, { url: "large", width: 800, height: 600 }] } } }] },
        videoRenderer: { videoId: "video123", title: { simpleText: "Attached video" }, thumbnail: { thumbnails: [{ url: "thumb" }] } },
      },
    };
    const posts = parseChannelPosts({ contents: [{ backstagePostRenderer: renderer }, { backstagePostRenderer: renderer }] }, new Date("2026-08-04T12:00:00.000Z"));
    expect(posts).toEqual([{
      id: "Ugk-test",
      authorName: "",
      authorAvatar: "",
      text: "Hello world",
      publishedAt: "2026-08-02T12:00:00.000Z",
      publishedText: "2 days ago",
      likeCount: "42",
      replyCount: "7",
      images: [{ url: "large", width: 800, height: 600 }],
      attachment: { type: "video", id: "video123", title: "Attached video", thumbnail: "thumb" },
      url: "https://www.youtube.com/post/Ugk-test",
    }]);
  });

  test("parses a read-only poll", () => {
    const posts = parseChannelPosts({ backstagePostRenderer: {
      postId: "poll-post",
      backstageAttachment: { pollRenderer: { question: { simpleText: "Pick one" }, choices: [
        { text: { simpleText: "A" }, votePercentage: { simpleText: "60%" } },
        { choiceText: { simpleText: "B" } },
      ] } },
    } });
    expect(posts[0].attachment).toEqual({ type: "poll", id: null, title: "Pick one", thumbnail: null, choices: [{ text: "A", votes: "60%" }, { text: "B", votes: null }] });
  });

  test("normalizes protocol-relative author avatars", () => {
    const [post] = parseChannelPosts({ backstagePostRenderer: {
      postId: "avatar-post",
      authorText: { simpleText: "Channel" },
      authorThumbnail: { thumbnails: [{ url: "//yt3.example/avatar" }] },
    } });
    expect(post.authorName).toBe("Channel");
    expect(post.authorAvatar).toBe("https://yt3.example/avatar");
  });
});
