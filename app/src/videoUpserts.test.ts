import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { DIRECT_VIDEO_INFO_UPSERT_SQL, RSS_VIDEO_UPSERT_SQL } from "./videoUpserts";

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

describe("direct video info upsert", () => {
  test("replaces a stale RSS status with the authoritative live status", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        description TEXT,
        thumbnail TEXT,
        published_at TEXT,
        published_at_approximate INTEGER NOT NULL DEFAULT 1,
        live_status TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'inbox',
        views INTEGER,
        duration TEXT,
        external INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        is_unavailable INTEGER NOT NULL DEFAULT 0,
        availability_checked_at TEXT
      );
      INSERT INTO videos
        (video_id, channel_id, title, description, thumbnail, live_status, status, duration, external)
      VALUES
        ('live-radio', 'channel', 'RSS title', '', 'rss.jpg', 'none', 'queued', '10:00', 0);
    `);

    db.query(DIRECT_VIDEO_INFO_UPSERT_SQL).run(
      "live-radio",
      "channel",
      "Live radio",
      "Broadcasting now",
      "live.jpg",
      "2026-08-13T20:00:00Z",
      "live",
      123,
      null,
    );

    expect(db.query(`
      SELECT title, live_status, status, duration, external,
             published_at_approximate, availability_checked_at IS NOT NULL AS checked
      FROM videos WHERE video_id = 'live-radio'
    `).get()).toEqual({
      title: "Live radio",
      live_status: "live",
      status: "queued",
      duration: null,
      external: 0,
      published_at_approximate: 0,
      checked: 1,
    });
  });

  test("records a live status when inserting a directly opened video", () => {
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
        live_status TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'inbox',
        views INTEGER,
        duration TEXT,
        external INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        is_unavailable INTEGER NOT NULL DEFAULT 0,
        availability_checked_at TEXT
      );
    `);

    db.query(DIRECT_VIDEO_INFO_UPSERT_SQL).run(
      "live-radio", "channel", "Live radio", "", "live.jpg", null, "live", 123, null,
    );

    expect(db.query("SELECT live_status, external FROM videos WHERE video_id = 'live-radio'").get())
      .toEqual({ live_status: "live", external: 1 });
  });
});
