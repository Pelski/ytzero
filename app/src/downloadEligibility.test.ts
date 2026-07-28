import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { autoDownloadFollowerExistsSql } from "./downloadEligibility";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE videos (video_id TEXT PRIMARY KEY, channel_id TEXT, members_only INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE user_channels (user_id INTEGER, channel_id TEXT, followed INTEGER, members_only_visibility TEXT);
    CREATE TABLE user_settings (user_id INTEGER, key TEXT, value TEXT);
    INSERT INTO videos VALUES ('regular', 'channel', 0), ('members', 'channel', 1);
  `);
});

function eligible(videoId: string) {
  return Boolean(db.query(`SELECT 1 FROM videos v WHERE v.video_id = ? AND ${autoDownloadFollowerExistsSql("v")}`).get(videoId));
}

describe("members-only auto-download eligibility", () => {
  test("includes regular uploads from a followed channel", () => {
    db.run("INSERT INTO user_channels VALUES (1, 'channel', 1, 'hidden')");
    expect(eligible("regular")).toBe(true);
  });

  test("respects the profile-wide hide-everywhere preference", () => {
    db.run("INSERT INTO user_channels VALUES (1, 'channel', 1, 'default')");
    db.run("INSERT INTO user_settings VALUES (1, 'hide_members_only_from_feed', '1')");
    expect(eligible("members")).toBe(false);
  });

  test("respects a channel override that hides members-only uploads", () => {
    db.run("INSERT INTO user_channels VALUES (1, 'channel', 1, 'hidden')");
    expect(eligible("members")).toBe(false);
  });

  test("allows a channel override that makes members-only uploads visible", () => {
    db.run("INSERT INTO user_channels VALUES (1, 'channel', 1, 'everywhere')");
    db.run("INSERT INTO user_settings VALUES (1, 'hide_members_only_from_feed', '1')");
    expect(eligible("members")).toBe(true);
  });

  test("downloads once when at least one following profile can see the upload", () => {
    db.run("INSERT INTO user_channels VALUES (1, 'channel', 1, 'hidden')");
    db.run("INSERT INTO user_channels VALUES (2, 'channel', 1, 'everywhere')");
    expect(eligible("members")).toBe(true);
  });
});
