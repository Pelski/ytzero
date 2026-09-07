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

-- Tracks only watched flags introduced by the remote catalog. This lets a
-- later remote "unwatched" change undo its own import without erasing a
-- profile's independent local watched state.
CREATE TABLE IF NOT EXISTS tube_archivist_imported_watched (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES tube_archivist_items(video_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, video_id)
);

CREATE TABLE IF NOT EXISTS tube_archivist_sync_state (
  singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
  generation     INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_error     TEXT,
  running        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tube_archivist_watch_outbox (
  video_id        TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
  is_watched      INTEGER NOT NULL DEFAULT 1 CHECK (is_watched IN (0,1)),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
