import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applySQLiteMigrations, SQLITE_MIGRATIONS, sqliteSchemaVersion } from "./sqliteMigrations";

function legacyDatabase(): Database {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE videos (video_id TEXT PRIMARY KEY, channel_id TEXT, published_at TEXT, status TEXT);
    CREATE INDEX idx_videos_channel ON videos(channel_id);
    CREATE INDEX idx_videos_published ON videos(published_at DESC);
    CREATE INDEX idx_videos_status ON videos(status);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE history (id INTEGER PRIMARY KEY, user_id INTEGER, video_id TEXT, watched_at TEXT);
    CREATE TABLE user_videos (user_id INTEGER, video_id TEXT, status TEXT, queued_at TEXT, PRIMARY KEY(user_id, video_id));
  `);
  return database;
}

describe("versioned SQLite migrations", () => {
  test("upgrades a legacy schema once and records its version", () => {
    const database = legacyDatabase();
    const expected = SQLITE_MIGRATIONS.at(-1)!.version;
    expect(applySQLiteMigrations(database)).toBe(expected);
    expect(applySQLiteMigrations(database)).toBe(expected);
    expect(sqliteSchemaVersion(database)).toBe(expected);

    const indexes = new Set((database.query("SELECT name FROM sqlite_master WHERE type='index'").all() as any[]).map((row) => row.name));
    expect(indexes.has("idx_videos_feed_order")).toBe(true);
    expect(indexes.has("idx_history_user_video_watched")).toBe(true);
    expect(indexes.has("idx_user_videos_status_queued")).toBe(true);
    expect(indexes.has("idx_videos_status")).toBe(false);
    expect(indexes.has("idx_videos_published")).toBe(false);
    expect(indexes.has("idx_videos_channel")).toBe(false);
    database.close();
  });

  test("refuses a changed migration identity", () => {
    const database = legacyDatabase();
    database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    database.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(1, "different", new Date().toISOString());
    expect(() => applySQLiteMigrations(database)).toThrow("checksum mismatch");
    database.close();
  });
});
