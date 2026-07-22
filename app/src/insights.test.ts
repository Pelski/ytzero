import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { effectiveVideoTagsCte } from "./insightTags";
import { summarizeCompletion } from "./insightMetrics";

describe("insights effective video tags", () => {
  test("includes channel tags and does not duplicate a direct copy", () => {
    const testDb = new Database(":memory:");
    testDb.exec(`
      CREATE TABLE tags (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, color TEXT);
      CREATE TABLE videos (video_id TEXT PRIMARY KEY, channel_id TEXT);
      CREATE TABLE video_tags (video_id TEXT, tag_id INTEGER);
      CREATE TABLE channel_tags (channel_id TEXT, tag_id INTEGER);
      CREATE TABLE channel_playlists (playlist_id TEXT, channel_id TEXT);
      CREATE TABLE channel_playlist_videos (playlist_id TEXT, video_id TEXT);
      CREATE TABLE user_followed_playlists (user_id INTEGER, playlist_id TEXT);
      INSERT INTO tags VALUES (1, 7, 'Gaming', '#20c45a'), (2, 7, 'Focus', '#3ea6ff');
      INSERT INTO videos VALUES ('direct-and-channel', 'rock-play'), ('channel-only', 'rock-play'), ('curated-video', 'other-channel');
      INSERT INTO channel_tags VALUES ('rock-play', 1);
      INSERT INTO channel_tags VALUES ('curator', 2);
      INSERT INTO video_tags VALUES ('direct-and-channel', 1);
      INSERT INTO channel_playlists VALUES ('focus-playlist', 'curator');
      INSERT INTO channel_playlist_videos VALUES ('focus-playlist', 'curated-video');
      INSERT INTO user_followed_playlists VALUES (7, 'focus-playlist');
    `);

    const rows = testDb.prepare(`${effectiveVideoTagsCte}
      SELECT video_id, name, color FROM effective_video_tags ORDER BY video_id
    `).all();

    expect(rows).toEqual([
      { video_id: "channel-only", name: "Gaming", color: "#20c45a" },
      { video_id: "curated-video", name: "Focus", color: "#3ea6ff" },
      { video_id: "direct-and-channel", name: "Gaming", color: "#20c45a" },
    ]);
    testDb.close();
  });
});

describe("insights completion summary", () => {
  test("separates brief, in-progress and completed videos at stable thresholds", () => {
    expect(summarizeCompletion([0.04, 0.1, 0.56, 0.9, 1.4])).toEqual({
      completed: 2,
      in_progress: 2,
      brief: 1,
      total: 5,
      average_percent: 52,
    });
  });

  test("returns a zero average when no progress is known", () => {
    expect(summarizeCompletion([])).toEqual({ completed: 0, in_progress: 0, brief: 0, total: 0, average_percent: 0 });
  });
});
