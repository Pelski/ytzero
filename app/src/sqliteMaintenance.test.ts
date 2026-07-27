import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  configureSQLiteConnection,
  DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
  optimizeSQLite,
  sqliteBusyTimeoutMs,
} from "./sqliteMaintenance";

const previousTimeout = process.env.SQLITE_BUSY_TIMEOUT_MS;

afterEach(() => {
  if (previousTimeout === undefined) delete process.env.SQLITE_BUSY_TIMEOUT_MS;
  else process.env.SQLITE_BUSY_TIMEOUT_MS = previousTimeout;
});

describe("SQLite operational configuration", () => {
  test("enables foreign keys and a bounded busy timeout", () => {
    delete process.env.SQLITE_BUSY_TIMEOUT_MS;
    const database = new Database(":memory:");
    configureSQLiteConnection(database);
    expect((database.query("PRAGMA foreign_keys").get() as any).foreign_keys).toBe(1);
    expect((database.query("PRAGMA busy_timeout").get() as any).timeout).toBe(DEFAULT_SQLITE_BUSY_TIMEOUT_MS);
    database.close();
  });

  test("rejects invalid timeout configuration", () => {
    process.env.SQLITE_BUSY_TIMEOUT_MS = "999999";
    expect(sqliteBusyTimeoutMs()).toBe(DEFAULT_SQLITE_BUSY_TIMEOUT_MS);
  });

  test("keeps the analyzed feed ordered from the composite index", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE videos (video_id TEXT PRIMARY KEY, published_at TEXT, channel_id TEXT);
      CREATE INDEX idx_videos_feed_order ON videos(published_at DESC, video_id DESC);
    `);
    const insert = database.prepare("INSERT INTO videos VALUES (?, ?, ?)");
    const seed = database.transaction(() => {
      for (let i = 0; i < 2_000; i++) insert.run(`video-${i}`, new Date(1_700_000_000_000 + i * 1_000).toISOString(), `channel-${i % 50}`);
    });
    seed();
    optimizeSQLite(database, true);
    const plan = database.query("EXPLAIN QUERY PLAN SELECT video_id FROM videos WHERE published_at IS NOT NULL ORDER BY published_at DESC, video_id DESC LIMIT 40").all() as any[];
    expect(plan.map((row) => row.detail).join("\n")).toContain("idx_videos_feed_order");
    expect(database.query("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").get()).not.toBeNull();
    database.close();
  });
});
