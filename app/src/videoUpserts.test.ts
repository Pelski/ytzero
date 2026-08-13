import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { RSS_VIDEO_UPSERT_SQL } from "./videoUpserts";

describe("RSS video upsert", () => {
  test("clears a stale members-only flag when an upload becomes public", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        description TEXT,
        thumbnail TEXT,
        published_at TEXT,
        published_at_approximate INTEGER NOT NULL DEFAULT 0,
        views INTEGER,
        likes INTEGER,
        members_only INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        is_unavailable INTEGER NOT NULL DEFAULT 0,
        availability_checked_at TEXT
      );
      INSERT INTO videos (video_id, channel_id, title, members_only, is_unavailable)
      VALUES ('unlock-me', 'channel', 'Members preview', 1, 1);
    `);

    db.query(RSS_VIDEO_UPSERT_SQL).run(
      "unlock-me",
      "channel",
      "Public release",
      "Now available to everyone",
      "thumbnail.jpg",
      "2026-08-07T12:00:00Z",
      100,
      10,
    );

    expect(db.query("SELECT title, members_only, is_unavailable, availability_checked_at IS NOT NULL AS checked FROM videos WHERE video_id = 'unlock-me'").get())
      .toEqual({ title: "Public release", members_only: 0, is_unavailable: 0, checked: 1 });
  });
});
