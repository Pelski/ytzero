import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.DB_PATH ?? resolve(import.meta.dir, "../../data/db/ytzero.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '',
  thumbnail  TEXT NOT NULL DEFAULT '',
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at TEXT
);

CREATE TABLE IF NOT EXISTS videos (
  video_id     TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  thumbnail    TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  -- none | upcoming | live | was_live
  live_status  TEXT NOT NULL DEFAULT 'none',
  -- inbox | queued | archived
  status       TEXT NOT NULL DEFAULT 'inbox',
  -- today | tonight | tomorrow | weekend (only when status = 'queued')
  bucket       TEXT,
  queued_at    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT '#7c5cff'
);

CREATE TABLE IF NOT EXISTS channel_tags (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, tag_id)
);

CREATE TABLE IF NOT EXISTS video_tags (
  video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  -- manual | auto
  source   TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (video_id, tag_id)
);

CREATE TABLE IF NOT EXISTS auto_tag_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  pattern    TEXT NOT NULL,
  -- contains | regex
  match_type TEXT NOT NULL DEFAULT 'contains',
  -- title | description | both
  field      TEXT NOT NULL DEFAULT 'title'
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  watched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_watched ON history(watched_at DESC);

CREATE TABLE IF NOT EXISTS user_playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'ListMusic',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_playlist_videos (
  playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  video_id    TEXT    NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (playlist_id, video_id)
);

CREATE TABLE IF NOT EXISTS user_playlist_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,
  match_type  TEXT NOT NULL CHECK (match_type IN ('contains', 'regex')),
  field       TEXT NOT NULL CHECK (field IN ('title', 'description', 'both'))
);

CREATE TABLE IF NOT EXISTS filter_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL,
  match_type  TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'regex')),
  field       TEXT NOT NULL DEFAULT 'title' CHECK (field IN ('title', 'description', 'both')),
  action      TEXT NOT NULL DEFAULT 'reject' CHECK (action IN ('reject', 'whitelist')),
  channel_id  TEXT REFERENCES channels(channel_id) ON DELETE CASCADE
);
`);

// is_short: NULL = not checked yet, 0 = regular video, 1 = YouTube Short
for (const col of ["is_short INTEGER", "views INTEGER", "likes INTEGER"]) {
  try {
    db.exec(`ALTER TABLE videos ADD COLUMN ${col}`);
  } catch {}
}
// followed: 1 = subscribed (default), 0 = unfollowed (hidden from feed)
try { db.exec("ALTER TABLE channels ADD COLUMN followed INTEGER NOT NULL DEFAULT 1"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN duration TEXT"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN watch_position REAL"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN watch_duration REAL"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN subscriber_count TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN avatar_checked_at TEXT"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN show_from TEXT"); } catch {}
db.exec("UPDATE videos SET bucket = 'today' WHERE bucket = 'morning';");
db.exec("UPDATE videos SET bucket = 'tonight' WHERE bucket = 'evening';");

export const SETTING_DEFAULTS: Record<string, string> = {
  language: "en",
  show_shorts: "0",
  player_hl: "en",
  player_cc: "0",
  player_cc_lang: "en",
  player_quality: "auto",
  grid_size: "sm",
  child_lock_enabled: "0",
  child_lock_pin_hash: "",
  sponsorblock_enabled: "0",
  sponsorblock_categories: '["sponsor"]',
};
for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
