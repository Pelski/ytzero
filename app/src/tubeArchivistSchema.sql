-- TubeArchivist is a source for the shared video catalog. These rows retain
-- source ownership and remote locators without pretending the files belong to
-- YTZero's Downloads feature.
CREATE TABLE IF NOT EXISTS tube_archivist_items (
  video_id       TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
  media_url      TEXT,
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  available      INTEGER NOT NULL DEFAULT 1,
  generation     INTEGER NOT NULL DEFAULT 0,
  downloaded_at  TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tube_archivist_items_available ON tube_archivist_items(available, downloaded_at DESC);

CREATE TABLE IF NOT EXISTS tube_archivist_sync_state (
  singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
  generation     INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_error     TEXT,
  running        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tube_archivist_watch_outbox (
  video_id        TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
