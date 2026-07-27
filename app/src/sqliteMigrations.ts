import type { Database } from "bun:sqlite";

export interface SQLiteMigration {
  version: number;
  name: string;
  up(database: Database): void;
}

export const SQLITE_MIGRATIONS: readonly SQLiteMigration[] = [
  {
    version: 1,
    name: "planner-and-queue-indexes",
    up(database) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_videos_feed_order
          ON videos(published_at DESC, video_id DESC);
        CREATE INDEX IF NOT EXISTS idx_history_user_video_watched
          ON history(user_id, video_id, watched_at DESC);
        CREATE INDEX IF NOT EXISTS idx_user_videos_status_queued
          ON user_videos(user_id, status, queued_at DESC);

        DROP INDEX IF EXISTS idx_videos_status;
        DROP INDEX IF EXISTS idx_videos_published;
        DROP INDEX IF EXISTS idx_videos_channel;
      `);
    },
  },
];

export function applySQLiteMigrations(database: Database): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Map(
    (database.query("SELECT version, name FROM schema_migrations ORDER BY version").all() as { version: number; name: string }[])
      .map((row) => [Number(row.version), row.name]),
  );
  const record = database.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)");
  let latest = 0;

  for (const migration of SQLITE_MIGRATIONS) {
    latest = Math.max(latest, migration.version);
    const recordedName = applied.get(migration.version);
    if (recordedName && recordedName !== migration.name) {
      throw new Error(`database migration ${migration.version} checksum mismatch: expected ${migration.name}, found ${recordedName}`);
    }
    if (recordedName) continue;
    database.transaction(() => {
      migration.up(database);
      record.run(migration.version, migration.name);
    })();
  }
  return latest;
}

export function sqliteSchemaVersion(database: Database): number {
  const exists = database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!exists) return 0;
  return Number((database.query("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as any)?.version ?? 0);
}
