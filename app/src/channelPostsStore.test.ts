import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_CHANNEL_POSTS_STORE_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("channel posts store suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/channelPostsStore.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-channel-posts-"));
  process.env.DB_PATH = resolve(root, "posts.db");
  const { db, setUserSetting } = await import("./db");
  const { database } = await import("./database");
  const store = await import("./channelPostsStore");
  const { attachLocalPostVideos } = await import("./routes/channelPostRoutes");

  afterAll(async () => {
    db.close();
    await database.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("persisted channel posts", () => {
    test("round-trips normalized posts and records successful empty syncs", async () => {
      db.prepare("INSERT INTO channels(channel_id,title) VALUES('UCposts','Posts')").run();
      db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UCposts',1)").run();
      await setUserSetting(1, "channel_posts_tab", "1");
      const fetchedAt = "2000-01-01T10:00:00.000Z";
      await store.persistChannelPosts("UCposts", [{
        id: "Ugk-stored", authorName: "Posts", authorAvatar: "avatar", text: "Saved",
        publishedAt: "2026-08-03T10:00:00.000Z", publishedText: "1 day ago",
        likeCount: "12", replyCount: "3", images: [{ url: "image", width: 800, height: 600 }],
        attachment: { type: "video", id: "video", title: "Video", thumbnail: "thumb" },
        url: "https://www.youtube.com/post/Ugk-stored",
      }], fetchedAt);

      expect(await store.storedChannelPosts("UCposts")).toEqual({
        posts: [{
          id: "Ugk-stored", authorName: "Posts", authorAvatar: "avatar", text: "Saved",
          publishedAt: "2026-08-03T10:00:00.000Z", publishedText: "1 day ago",
          likeCount: "12", replyCount: "3", images: [{ url: "image", width: 800, height: 600 }],
          attachment: { type: "video", id: "video", title: "Video", thumbnail: "thumb" },
          url: "https://www.youtube.com/post/Ugk-stored",
        }],
        fetchedAt,
        cached: true,
      });
      await store.persistChannelPosts("UCposts", [{
        id: "Ugk-stored", authorName: "Posts", authorAvatar: "avatar", text: "Updated",
        publishedAt: "2026-08-04T10:00:00.000Z", publishedText: "today",
        likeCount: "13", replyCount: "3", images: [], attachment: null,
        url: "https://www.youtube.com/post/Ugk-stored",
      }], fetchedAt);
      expect((await store.storedChannelPosts("UCposts")).posts[0]).toMatchObject({
        text: "Updated", publishedAt: "2026-08-03T10:00:00.000Z", likeCount: "13",
      });
      expect(await store.nextChannelPostsDue(360)).toBe("UCposts");

      await store.persistChannelPosts("UCposts", [], new Date().toISOString());
      expect(await store.nextChannelPostsDue(360)).toBeNull();
      db.prepare("UPDATE user_channels SET followed=0 WHERE channel_id='UCposts'").run();
      db.prepare("UPDATE channel_post_sync_state SET last_attempted_at='2000-01-01T00:00:00.000Z' WHERE channel_id='UCposts'").run();
      expect(await store.nextChannelPostsDue(360)).toBeNull();
    });

    test("attaches the profile-aware horizontal card model only for local videos", async () => {
      db.prepare("INSERT INTO channels(channel_id,title) VALUES('UCvideo','Video channel')").run();
      db.prepare("INSERT INTO videos(video_id,channel_id,title) VALUES('local-video','UCvideo','Stored video')").run();
      const post = {
        id: "post-video", authorName: "", authorAvatar: "", text: "", publishedAt: null, publishedText: "",
        likeCount: "", replyCount: "", images: [], url: "https://youtube.com/post/post-video",
        attachment: { type: "video" as const, id: "local-video", title: "Stored video", thumbnail: null },
      };
      const [enriched] = await attachLocalPostVideos(1, [post], async (_userId, videos) => videos.map((video) => ({ ...video, tags: [] })));
      expect(enriched.localVideo).toMatchObject({ video_id: "local-video", title: "Stored video", channel_title: "Video channel" });
      const [external] = await attachLocalPostVideos(1, [{ ...post, attachment: { ...post.attachment, id: "external-video" } }], async (_userId, videos) => videos.map((video) => ({ ...video })));
      expect(external.localVideo).toBeNull();
    });
  });
}
