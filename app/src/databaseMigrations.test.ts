import { describe, expect, test } from "bun:test";
import { AsyncDatabaseClient } from "./databaseClient";
import { applyDatabaseMigrations, DATABASE_MIGRATIONS } from "./databaseMigrations";

describe("cross-database schema migrations", () => {
  test("requires an implementation for SQLite and PostgreSQL", () => {
    for (const migration of DATABASE_MIGRATIONS) {
      expect(migration.sqlite.length).toBeGreaterThan(0);
      expect(migration.postgres.length).toBeGreaterThan(0);
    }
  });

  test("upgrades an old SQLite schema once", async () => {
    const database = new AsyncDatabaseClient("sqlite", ":memory:");
    await database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    await database.exec("CREATE TABLE user_channels (user_id INTEGER, channel_id TEXT)");
    await database.exec("CREATE TABLE user_videos (user_id INTEGER, video_id TEXT)");

    expect(await applyDatabaseMigrations(database)).toBe(3);
    expect(await applyDatabaseMigrations(database)).toBe(3);

    const columns = await database.prepare('PRAGMA table_info("user_channels")').all<{ name: string }>();
    expect(columns.some((column) => column.name === "shorts_feed_visibility")).toBe(true);
    const videoColumns = await database.prepare('PRAGMA table_info("user_videos")').all<{ name: string }>();
    expect(videoColumns.some((column) => column.name === "playback_context_json")).toBe(true);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 2").get<{ count: number }>())
      .toEqual({ count: 1 });
    await database.close();
  });
});
