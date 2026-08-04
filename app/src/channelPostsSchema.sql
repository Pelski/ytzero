-- Rebuildable local catalog of YouTube Community Posts. Normalized fields
-- support a future cross-channel feed; ordered media remains post-owned JSON.
CREATE TABLE IF NOT EXISTS channel_posts (
  post_id          TEXT PRIMARY KEY,
  channel_id       TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  author_name      TEXT NOT NULL DEFAULT '',
  author_avatar    TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL DEFAULT '',
  published_at     TEXT,
  published_text   TEXT NOT NULL DEFAULT '',
  like_count_text  TEXT NOT NULL DEFAULT '',
  reply_count_text TEXT NOT NULL DEFAULT '',
  images_json      TEXT NOT NULL DEFAULT '[]',
  attachment_json  TEXT,
  url              TEXT NOT NULL DEFAULT '',
  source_position  INTEGER NOT NULL DEFAULT 0,
  discovered_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_channel_posts_channel_published
  ON channel_posts(channel_id, published_at DESC, source_position ASC);

-- Empty channels also need a backoff, otherwise every pass selects them again.
CREATE TABLE IF NOT EXISTS channel_post_sync_state (
  channel_id        TEXT PRIMARY KEY REFERENCES channels(channel_id) ON DELETE CASCADE,
  last_attempted_at TEXT NOT NULL,
  last_success_at   TEXT,
  last_error        TEXT
);
