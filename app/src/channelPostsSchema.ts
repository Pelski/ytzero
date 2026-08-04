import { database } from "./database";

/** Additive schema path for PostgreSQL installations created before Posts. */
export async function ensureChannelPostsPostgresSchema(): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS channel_posts (
      post_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
      author_name TEXT NOT NULL DEFAULT '',
      author_avatar TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      published_text TEXT NOT NULL DEFAULT '',
      like_count_text TEXT NOT NULL DEFAULT '',
      reply_count_text TEXT NOT NULL DEFAULT '',
      images_json TEXT NOT NULL DEFAULT '[]',
      attachment_json TEXT,
      url TEXT NOT NULL DEFAULT '',
      source_position INTEGER NOT NULL DEFAULT 0,
      discovered_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      last_seen_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE INDEX IF NOT EXISTS idx_channel_posts_channel_published
      ON channel_posts(channel_id, published_at DESC, source_position ASC);
    CREATE TABLE IF NOT EXISTS channel_post_sync_state (
      channel_id TEXT PRIMARY KEY REFERENCES channels(channel_id) ON DELETE CASCADE,
      last_attempted_at TEXT NOT NULL,
      last_success_at TEXT,
      last_error TEXT
    );
  `);
}
