import type { AsyncDatabaseClient } from "./databaseClient";
import type { DatabaseEngine } from "./databaseConfig";
import type { CanonicalSchemaFile } from "./canonicalSchema";

export { CANONICAL_SCHEMA_FILES } from "./canonicalSchema";

interface AddColumnStep {
  kind: "add-column";
  table: string;
  column: string;
  definition: string;
}

interface SqlStep {
  kind: "sql";
  statement: string;
}

interface NoopStep {
  kind: "noop";
  reason: string;
}

export type DatabaseMigrationStep = AddColumnStep | SqlStep | NoopStep;

export interface DatabaseMigration {
  version: number;
  name: string;
  schemaHashes: Partial<Record<CanonicalSchemaFile, string>>;
  sqlite: readonly DatabaseMigrationStep[];
  postgres: readonly DatabaseMigrationStep[];
}

// Version 1 belongs to the older SQLite-only migration runner. Every migration
// from version 2 onward must explicitly support both database engines. The
// repository check enforces the two implementations and schema fingerprints.
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 2,
    name: "postgres-compatibility-columns",
    schemaHashes: {
      "app/src/schema.sql": "76d5ac28c9619f64bf85c9928c1c4e43a8f34069aae9c789e5f12eba8d8c08dd",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
    },
    sqlite: [
      { kind: "add-column", table: "users", column: "is_admin", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "user_channels", column: "shorts_feed_visibility", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "users", column: "is_admin", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "user_channels", column: "shorts_feed_visibility", definition: "TEXT" },
    ],
  },
  {
    version: 3,
    name: "resume-playback-context",
    schemaHashes: {
      "app/src/schema.sql": "a0e8fea9bc340532d0f77b0879eb07207efe2daa6ef5f67366cd6242d6367dcd",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
    },
    sqlite: [
      { kind: "add-column", table: "user_videos", column: "playback_context_json", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "user_videos", column: "playback_context_json", definition: "TEXT" },
    ],
  },
  {
    version: 4,
    name: "personal-playlist-position",
    schemaHashes: {
      "app/src/schema.sql": "5a747328ebeda58f7cc52ee31c045160ef29f0239d15a1d9de0ebf677399b7e2",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
    },
    sqlite: [
      { kind: "add-column", table: "user_playlist_videos", column: "position", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "sql", statement: `
        WITH ranked AS (
          SELECT playlist_id, video_id,
                 ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY added_at ASC, video_id ASC) - 1 AS position
          FROM user_playlist_videos
        )
        UPDATE user_playlist_videos
        SET position = (
          SELECT ranked.position FROM ranked
          WHERE ranked.playlist_id = user_playlist_videos.playlist_id
            AND ranked.video_id = user_playlist_videos.video_id
        )
      ` },
    ],
    postgres: [
      { kind: "add-column", table: "user_playlist_videos", column: "position", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "sql", statement: `
        WITH ranked AS (
          SELECT playlist_id, video_id,
                 ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY added_at ASC, video_id ASC) - 1 AS position
          FROM user_playlist_videos
        )
        UPDATE user_playlist_videos AS target
        SET position = ranked.position
        FROM ranked
        WHERE ranked.playlist_id = target.playlist_id
          AND ranked.video_id = target.video_id
      ` },
    ],
  },
  {
    version: 5,
    name: "tubearchivist-source",
    schemaHashes: {
      "app/src/schema.sql": "5a747328ebeda58f7cc52ee31c045160ef29f0239d15a1d9de0ebf677399b7e2",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_items (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, media_url TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', available INTEGER NOT NULL DEFAULT 1, generation INTEGER NOT NULL DEFAULT 0, downloaded_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))` },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_tube_archivist_items_available ON tube_archivist_items(available, downloaded_at DESC)" },
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_sync_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, last_error TEXT, running INTEGER NOT NULL DEFAULT 0)` },
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_watch_outbox (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')), last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))` },
    ],
    postgres: [
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_items (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, media_url TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', available INTEGER NOT NULL DEFAULT 1, generation INTEGER NOT NULL DEFAULT 0, downloaded_at TEXT, updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))` },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_tube_archivist_items_available ON tube_archivist_items(available, downloaded_at DESC)" },
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_sync_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, last_error TEXT, running INTEGER NOT NULL DEFAULT 0)` },
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_watch_outbox (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), last_error TEXT, created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))` },
    ],
  },
  {
    version: 6,
    name: "video-availability-tombstones",
    schemaHashes: {
      "app/src/schema.sql": "5a747328ebeda58f7cc52ee31c045160ef29f0239d15a1d9de0ebf677399b7e2",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "videos", column: "is_unavailable", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "videos", column: "availability_checked_at", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "videos", column: "is_unavailable", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "videos", column: "availability_checked_at", definition: "TEXT" },
    ],
  },
  {
    version: 7,
    name: "profile-video-bookmarks",
    schemaHashes: {
      "app/src/schema.sql": "f31623dbbbed52b89026cfeaa80cd1e84d455242a9b78c426ebee60af463a0e8",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, portable_uuid TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE, position_seconds REAL NOT NULL DEFAULT 0 CHECK (position_seconds >= 0), description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (user_id, video_id))` },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_bookmarks_user_updated ON bookmarks(user_id, updated_at DESC, id DESC)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_bookmarks_video ON bookmarks(video_id)" },
    ],
    postgres: [
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS bookmarks (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, portable_uuid TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE, position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (position_seconds >= 0), description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), UNIQUE (user_id, video_id))` },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_bookmarks_user_updated ON bookmarks(user_id, updated_at DESC, id DESC)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_bookmarks_video ON bookmarks(video_id)" },
    ],
  },
  {
    version: 8,
    name: "shorts-classification-retry",
    schemaHashes: {
      "app/src/schema.sql": "b8b7d541e396d5fe9a6b9e259996e92a2636a282467b27068404d6d57aea58e6",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      // These legacy catalog columns predate cross-database migrations. Keep
      // the retry index safe when upgrading an older PostgreSQL/SQLite schema.
      { kind: "add-column", table: "videos", column: "is_short", definition: "INTEGER" },
      { kind: "add-column", table: "videos", column: "is_private", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "videos", column: "short_check_attempts", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "videos", column: "short_check_attempted_at", definition: "TEXT" },
      { kind: "add-column", table: "videos", column: "short_check_next_attempt_at", definition: "TEXT" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_videos_shorts_retry ON videos(is_short, is_private, is_unavailable, short_check_next_attempt_at)" },
    ],
    postgres: [
      { kind: "add-column", table: "videos", column: "is_short", definition: "INTEGER" },
      { kind: "add-column", table: "videos", column: "is_private", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "videos", column: "short_check_attempts", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "videos", column: "short_check_attempted_at", definition: "TEXT" },
      { kind: "add-column", table: "videos", column: "short_check_next_attempt_at", definition: "TEXT" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_videos_shorts_retry ON videos(is_short, is_private, is_unavailable, short_check_next_attempt_at)" },
    ],
  },
  {
    version: 100,
    name: "bookmarks-per-video",
    schemaHashes: {
      "app/src/schema.sql": "f31623dbbbed52b89026cfeaa80cd1e84d455242a9b78c426ebee60af463a0e8",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE bookmarks_multi (id INTEGER PRIMARY KEY AUTOINCREMENT, portable_uuid TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE, position_seconds REAL NOT NULL DEFAULT 0 CHECK (position_seconds >= 0), description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))" },
      { kind: "sql", statement: "INSERT INTO bookmarks_multi SELECT id, portable_uuid, user_id, video_id, position_seconds, description, created_at, updated_at FROM bookmarks" },
      { kind: "sql", statement: "DROP TABLE bookmarks" },
      { kind: "sql", statement: "ALTER TABLE bookmarks_multi RENAME TO bookmarks" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_bookmarks_user_updated ON bookmarks(user_id, updated_at DESC, id DESC)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_bookmarks_video ON bookmarks(video_id)" },
    ],
    postgres: [
      { kind: "sql", statement: "ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_user_id_video_id_key" },
    ],
  },
  {
    version: 101,
    name: "profile-permission-groups",
    schemaHashes: {
      "app/src/schema.sql": "f49d9e1a5b3df6f116bd70a8b6131c271cc18fdf4782cbd67a6d4858f927ae91",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, portable_uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_group_permissions (group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0,1)), PRIMARY KEY (group_id, permission))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS profile_permission_groups (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS profile_permission_overrides (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL CHECK (allowed IN (0,1)), PRIMARY KEY (user_id, permission))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_policy (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), default_group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT, revision INTEGER NOT NULL DEFAULT 1)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_groups (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, portable_uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_group_permissions (group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0,1)), PRIMARY KEY (group_id, permission))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS profile_permission_groups (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS profile_permission_overrides (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL CHECK (allowed IN (0,1)), PRIMARY KEY (user_id, permission))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_policy (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), default_group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT, revision INTEGER NOT NULL DEFAULT 1)" },
    ],
  },
  {
    version: 102,
    name: "permission-group-order",
    schemaHashes: {
      "app/src/schema.sql": "7ebc8a637ac2aa8c29630650b453b4432484dc32c4aff85f7a9b8824ccae9e49",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "permission_groups", column: "sort_order", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "sql", statement: "UPDATE permission_groups SET sort_order=id WHERE sort_order=0" },
    ],
    postgres: [
      { kind: "add-column", table: "permission_groups", column: "sort_order", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "sql", statement: "UPDATE permission_groups SET sort_order=id WHERE sort_order=0" },
    ],
  },
  {
    version: 103,
    name: "external-role-session",
    schemaHashes: {
      "app/src/schema.sql": "9b2cbec713410c5f3a5754205b137fde77a906725963f7353fa8ad1503a1986b",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, permission_group_uuid TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, last_seen TEXT)" },
      { kind: "add-column", table: "auth_sessions", column: "permission_group_uuid", definition: "TEXT" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, permission_group_uuid TEXT, created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), expires_at TEXT NOT NULL, last_seen TEXT)" },
      { kind: "add-column", table: "auth_sessions", column: "permission_group_uuid", definition: "TEXT" },
    ],
  },
  {
    version: 104,
    name: "profile-notification-preferences",
    schemaHashes: {
      "app/src/schema.sql": "8c0bc0ca87a8b3ad0ca28d09f3ec500d6463427899476fa6414097fae737b777",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS notification_preferences (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), PRIMARY KEY (user_id,kind,source_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS notification_preferences (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), PRIMARY KEY (user_id,kind,source_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id)" },
    ],
  },
  {
    version: 105,
    name: "cluster-runtime-state",
    schemaHashes: {
      "app/src/schema.sql": "6f5171419b14024349284382ab45119686e8fcb7206153b5811b7b8263a3510c",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS auth_flows (id TEXT PRIMARY KEY, value TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, nonce TEXT, expires_at TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_auth_flows_expires ON auth_flows(expires_at)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS child_lock_sessions (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_child_lock_sessions_expires ON child_lock_sessions(expires_at)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS playback_activity (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL, seen_at_ms INTEGER NOT NULL)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS child_pin_failures (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, failures INTEGER NOT NULL DEFAULT 0)" },
      { kind: "add-column", table: "downloads", column: "progress_percent", definition: "REAL" },
      { kind: "add-column", table: "downloads", column: "progress_total_bytes", definition: "INTEGER" },
      { kind: "add-column", table: "downloads", column: "progress_speed", definition: "TEXT" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS app_events (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, topic TEXT NOT NULL, user_id INTEGER, data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events(created_at)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS auth_flows (id TEXT PRIMARY KEY, value TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, nonce TEXT, expires_at TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_auth_flows_expires ON auth_flows(expires_at)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS child_lock_sessions (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_child_lock_sessions_expires ON child_lock_sessions(expires_at)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS playback_activity (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL, seen_at_ms BIGINT NOT NULL)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS child_pin_failures (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, failures INTEGER NOT NULL DEFAULT 0)" },
      { kind: "add-column", table: "downloads", column: "progress_percent", definition: "DOUBLE PRECISION" },
      { kind: "add-column", table: "downloads", column: "progress_total_bytes", definition: "BIGINT" },
      { kind: "add-column", table: "downloads", column: "progress_speed", definition: "TEXT" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS app_events (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, origin TEXT NOT NULL, topic TEXT NOT NULL, user_id BIGINT, data TEXT, created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events(created_at)" },
    ],
  },
  {
    version: 106,
    name: "download-worker-ownership",
    schemaHashes: {
      "app/src/schema.sql": "de0bae3f423af39c3269019683f0f87439ca38c1f3fa3211ef09085570f773a1",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "downloads", column: "worker_id", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_heartbeat_at_ms", definition: "INTEGER" },
    ],
    postgres: [
      { kind: "add-column", table: "downloads", column: "worker_id", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_heartbeat_at_ms", definition: "BIGINT" },
    ],
  },
  {
    version: 107,
    name: "cluster-instance-heartbeats",
    schemaHashes: {
      "app/src/schema.sql": "6560b93d2aa8f8985992148c9f15f08f04f3168056d9955efe261ffbd0285974",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS cluster_instances (instance_id TEXT PRIMARY KEY, instance_name TEXT NOT NULL, hostname TEXT NOT NULL, started_at_ms INTEGER NOT NULL, last_seen_at_ms INTEGER NOT NULL, version TEXT NOT NULL, commit_hash TEXT NOT NULL, background_tasks INTEGER NOT NULL CHECK (background_tasks IN (0,1)), settings_json TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_cluster_instances_last_seen ON cluster_instances(last_seen_at_ms)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS cluster_instances (instance_id TEXT PRIMARY KEY, instance_name TEXT NOT NULL, hostname TEXT NOT NULL, started_at_ms BIGINT NOT NULL, last_seen_at_ms BIGINT NOT NULL, version TEXT NOT NULL, commit_hash TEXT NOT NULL, background_tasks INTEGER NOT NULL CHECK (background_tasks IN (0,1)), settings_json TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_cluster_instances_last_seen ON cluster_instances(last_seen_at_ms)" },
    ],
  },
  {
    version: 108,
    name: "cluster-download-columns-reconciliation",
    schemaHashes: {
      "app/src/schema.sql": "6560b93d2aa8f8985992148c9f15f08f04f3168056d9955efe261ffbd0285974",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    // Some development databases recorded an earlier form of migration 105
    // before download progress was added. Reconcile every cluster-era queue
    // column under a fresh version so those databases can upgrade safely.
    sqlite: [
      { kind: "add-column", table: "downloads", column: "progress_percent", definition: "REAL" },
      { kind: "add-column", table: "downloads", column: "progress_total_bytes", definition: "INTEGER" },
      { kind: "add-column", table: "downloads", column: "progress_speed", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_id", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_heartbeat_at_ms", definition: "INTEGER" },
    ],
    postgres: [
      { kind: "add-column", table: "downloads", column: "progress_percent", definition: "DOUBLE PRECISION" },
      { kind: "add-column", table: "downloads", column: "progress_total_bytes", definition: "BIGINT" },
      { kind: "add-column", table: "downloads", column: "progress_speed", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_id", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_heartbeat_at_ms", definition: "BIGINT" },
    ],
  },
  {
    version: 109,
    name: "playlist-offline-policies",
    schemaHashes: {
      "app/src/schema.sql": "910b1ab5aabd47f187b2d0119bf61278ab0b5571741719c73a04e3b6536a0114",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "user_playlists", column: "offline_policy", definition: "TEXT NOT NULL DEFAULT 'none' CHECK (offline_policy IN ('none', 'download', 'keep'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS user_playlist_download_protections (playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE, PRIMARY KEY (playlist_id, video_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_user_playlist_download_protections_video ON user_playlist_download_protections(video_id)" },
    ],
    postgres: [
      { kind: "add-column", table: "user_playlists", column: "offline_policy", definition: "TEXT NOT NULL DEFAULT 'none' CHECK (offline_policy IN ('none', 'download', 'keep'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS user_playlist_download_protections (playlist_id BIGINT NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE, PRIMARY KEY (playlist_id, video_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_user_playlist_download_protections_video ON user_playlist_download_protections(video_id)" },
    ],
  },
  {
    version: 110,
    name: "followed-playlist-offline-policies",
    schemaHashes: {
      "app/src/schema.sql": "cd063217769b7a5184cbb80a370d64f6ecc37ab15cf26b94e0bc7f8685a4bdce",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "user_followed_playlists", column: "offline_policy", definition: "TEXT NOT NULL DEFAULT 'none' CHECK (offline_policy IN ('none', 'download', 'keep'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS followed_playlist_download_protections (user_id INTEGER NOT NULL, playlist_id TEXT NOT NULL, video_id TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE, PRIMARY KEY (user_id, playlist_id, video_id), FOREIGN KEY (user_id, playlist_id) REFERENCES user_followed_playlists(user_id, playlist_id) ON DELETE CASCADE)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_followed_playlist_download_protections_video ON followed_playlist_download_protections(video_id)" },
    ],
    postgres: [
      { kind: "add-column", table: "user_followed_playlists", column: "offline_policy", definition: "TEXT NOT NULL DEFAULT 'none' CHECK (offline_policy IN ('none', 'download', 'keep'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS followed_playlist_download_protections (user_id BIGINT NOT NULL, playlist_id TEXT NOT NULL, video_id TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE, PRIMARY KEY (user_id, playlist_id, video_id), FOREIGN KEY (user_id, playlist_id) REFERENCES user_followed_playlists(user_id, playlist_id) ON DELETE CASCADE)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_followed_playlist_download_protections_video ON followed_playlist_download_protections(video_id)" },
    ],
  },
  {
    version: 111,
    // Preserve the identity already recorded by development databases that
    // received this migration before it entered the shared registry.
    name: "profile-feed-builder",
    schemaHashes: {
      "app/src/schema.sql": "8259bf588c8829ee6388d5d4b877208b5f4c33effb090bf63341211a35cb7849",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS user_feed_configs (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, config_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS feed_composition_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, config_revision INTEGER NOT NULL, columns_count INTEGER NOT NULL, seed TEXT NOT NULL, request_json TEXT NOT NULL, state_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL, last_accessed_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_feed_composition_sessions_expiry ON feed_composition_sessions(expires_at_ms)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS feed_composition_pages (composition_id TEXT NOT NULL REFERENCES feed_composition_sessions(id) ON DELETE CASCADE, page_index INTEGER NOT NULL, response_json TEXT NOT NULL, PRIMARY KEY (composition_id, page_index))" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS user_feed_configs (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, config_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS feed_composition_sessions (id TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, config_revision INTEGER NOT NULL, columns_count INTEGER NOT NULL, seed TEXT NOT NULL, request_json TEXT NOT NULL, state_json TEXT NOT NULL, created_at_ms BIGINT NOT NULL, last_accessed_at_ms BIGINT NOT NULL, expires_at_ms BIGINT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_feed_composition_sessions_expiry ON feed_composition_sessions(expires_at_ms)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS feed_composition_pages (composition_id TEXT NOT NULL REFERENCES feed_composition_sessions(id) ON DELETE CASCADE, page_index INTEGER NOT NULL, response_json TEXT NOT NULL, PRIMARY KEY (composition_id, page_index))" },
    ],
  },
  {
    version: 112,
    name: "playlist-download-quality",
    schemaHashes: {
      "app/src/schema.sql": "41f7f19c62c9af2d2f79983c130ec5d7ecf94ba85274ec8a713887838cc81670",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "user_playlists", column: "download_quality", definition: "TEXT CHECK (download_quality IS NULL OR download_quality IN ('best', '1440', '1080', '720', '480'))" },
      { kind: "add-column", table: "user_followed_playlists", column: "download_quality", definition: "TEXT CHECK (download_quality IS NULL OR download_quality IN ('best', '1440', '1080', '720', '480'))" },
      { kind: "add-column", table: "downloads", column: "requested_quality", definition: "TEXT CHECK (requested_quality IS NULL OR requested_quality IN ('best', '1440', '1080', '720', '480'))" },
    ],
    postgres: [
      { kind: "add-column", table: "user_playlists", column: "download_quality", definition: "TEXT CHECK (download_quality IS NULL OR download_quality IN ('best', '1440', '1080', '720', '480'))" },
      { kind: "add-column", table: "user_followed_playlists", column: "download_quality", definition: "TEXT CHECK (download_quality IS NULL OR download_quality IN ('best', '1440', '1080', '720', '480'))" },
      { kind: "add-column", table: "downloads", column: "requested_quality", definition: "TEXT CHECK (requested_quality IS NULL OR requested_quality IN ('best', '1440', '1080', '720', '480'))" },
    ],
  },
  {
    version: 113,
    name: "external-notification-delivery",
    schemaHashes: {
      "app/src/schema.sql": "b3eed272dc7687831970765bc2c12f023e72ac3809e71626cf5b078a8d56d026",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS notification_delivery (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)), targets TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, provider))" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS notification_delivery (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)), targets TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, provider))" },
    ],
  },
  {
    version: 114,
    name: "tubearchivist-two-way-watched",
    schemaHashes: {
      "app/src/schema.sql": "b3eed272dc7687831970765bc2c12f023e72ac3809e71626cf5b078a8d56d026",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "31e77b7af023276f38d1075b0a5a2197fef150513f010b90bab5909971871056",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS tube_archivist_imported_watched (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES tube_archivist_items(video_id) ON DELETE CASCADE, PRIMARY KEY (user_id, video_id))" },
      { kind: "add-column", table: "tube_archivist_watch_outbox", column: "is_watched", definition: "INTEGER NOT NULL DEFAULT 1 CHECK (is_watched IN (0,1))" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS tube_archivist_imported_watched (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES tube_archivist_items(video_id) ON DELETE CASCADE, PRIMARY KEY (user_id, video_id))" },
      { kind: "add-column", table: "tube_archivist_watch_outbox", column: "is_watched", definition: "INTEGER NOT NULL DEFAULT 1 CHECK (is_watched IN (0,1))" },
    ],
  },
  {
    version: 115,
    name: "public-share-links",
    schemaHashes: {
      "app/src/schema.sql": "7cc9b23b227d3cc3be8ec33051d4f943dda4df2a29e7d3e3c62edd8775100a9a",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "31e77b7af023276f38d1075b0a5a2197fef150513f010b90bab5909971871056",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS public_share_policy (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)), updated_at TEXT NOT NULL DEFAULT (datetime('now')))" },
      { kind: "sql", statement: "INSERT OR IGNORE INTO public_share_policy(singleton,enabled) VALUES(1,0)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS public_shares (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, resource_type TEXT NOT NULL CHECK (resource_type IN ('video','user_playlist','followed_playlist')), resource_id TEXT NOT NULL, allow_local_media INTEGER NOT NULL DEFAULT 0 CHECK (allow_local_media IN (0,1)), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(owner_user_id,resource_type,resource_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_public_shares_owner ON public_shares(owner_user_id, created_at DESC)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS public_share_policy (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)), updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))" },
      { kind: "sql", statement: "INSERT INTO public_share_policy(singleton,enabled) VALUES(1,0) ON CONFLICT(singleton) DO NOTHING" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS public_shares (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, resource_type TEXT NOT NULL CHECK (resource_type IN ('video','user_playlist','followed_playlist')), resource_id TEXT NOT NULL, allow_local_media INTEGER NOT NULL DEFAULT 0 CHECK (allow_local_media IN (0,1)), created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), UNIQUE(owner_user_id,resource_type,resource_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_public_shares_owner ON public_shares(owner_user_id, created_at DESC)" },
    ],
  },
];

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`unsafe database identifier: ${identifier}`);
  return `"${identifier}"`;
}

async function columnExists(
  client: AsyncDatabaseClient,
  engine: DatabaseEngine,
  table: string,
  column: string,
): Promise<boolean> {
  if (engine === "sqlite") {
    const rows = await client.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all<{ name: string }>();
    return rows.some((row) => row.name === column);
  }
  const row = await client.prepare(`
    SELECT 1 AS present
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
  `).get(table, column);
  return Boolean(row);
}

async function applyStep(
  client: AsyncDatabaseClient,
  engine: DatabaseEngine,
  step: DatabaseMigrationStep,
): Promise<void> {
  if (step.kind === "noop") return;
  if (step.kind === "sql") {
    await client.exec(step.statement);
    return;
  }
  if (await columnExists(client, engine, step.table, step.column)) return;
  await client.exec(
    `ALTER TABLE ${quoteIdentifier(step.table)} ADD COLUMN ${quoteIdentifier(step.column)} ${step.definition}`,
  );
}

export async function applyDatabaseMigrations(client: AsyncDatabaseClient): Promise<number> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  let latest = 0;

  for (const migration of DATABASE_MIGRATIONS) {
    latest = Math.max(latest, migration.version);
    await client.transaction(async () => {
      // PostgreSQL replicas may boot together during a rollout. A transaction
      // advisory lock makes schema ownership explicit and is released even if
      // a migration fails or the process disappears.
      if (client.engine === "postgres") await client.prepare("SELECT pg_advisory_xact_lock(1498565714)").get();
      const recorded = await client.prepare("SELECT name FROM schema_migrations WHERE version = ?").get<{ name: string }>(migration.version);
      if (recorded?.name && recorded.name !== migration.name) {
        throw new Error(`database migration ${migration.version} checksum mismatch: expected ${migration.name}, found ${recorded.name}`);
      }
      if (recorded) return;
      for (const step of migration[client.engine]) await applyStep(client, client.engine, step);
      await client.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
  return latest;
}
