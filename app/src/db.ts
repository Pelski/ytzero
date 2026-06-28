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
  -- today | tonight | tomorrow | tomorrow_evening | weekend (only when status = 'queued')
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

-- ---------- Multi-user (profiles) ----------
-- Channels and videos stay global (one fetch per channel, deduped across
-- profiles); per-user state lives in the tables below, keyed by user_id.

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  avatar       TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#7c5cff',
  pin_hash     TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A profile's subscriptions. followed = 1 (subscribed) / 0 (unfollowed/hidden).
CREATE TABLE IF NOT EXISTS user_channels (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT    NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  followed   INTEGER NOT NULL DEFAULT 1,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_user_channels_channel ON user_channels(channel_id);

-- A profile's per-video state. No row = default inbox / unwatched; a row is
-- created only when the profile acts on the video (queue/archive/like/progress).
CREATE TABLE IF NOT EXISTS user_videos (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id       TEXT    NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'inbox',
  bucket         TEXT,
  queued_at      TEXT,
  show_from      TEXT,
  watch_position REAL,
  watch_duration REAL,
  liked          INTEGER,
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_user_videos_video ON user_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_user_videos_status ON user_videos(user_id, status);

-- Per-profile settings (the global settings table keeps only app-wide keys).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
`);

// Per-user ownership columns on previously global state tables.
for (const stmt of [
  "ALTER TABLE tags ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
  "ALTER TABLE auto_tag_rules ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
  "ALTER TABLE filter_rules ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
  "ALTER TABLE user_playlists ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
  "ALTER TABLE history ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
]) {
  try { db.exec(stmt); } catch {}
}

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
try { db.exec("ALTER TABLE videos ADD COLUMN liked INTEGER"); } catch {}
try { db.exec("ALTER TABLE tags ADD COLUMN filter_only INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN external INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN external INTEGER NOT NULL DEFAULT 0"); } catch {}
// Cached channel "about" payload (description, banner, links, stats, …) so the
// channel page reads from the DB instead of scraping YouTube on every visit.
try { db.exec("ALTER TABLE channels ADD COLUMN about_json TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN about_fetched_at TEXT"); } catch {}
// Cached channel playlists and per-video chapters — same idea: read from the DB
// instead of scraping YouTube on every request.
try { db.exec("ALTER TABLE channels ADD COLUMN playlists_json TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN playlists_fetched_at TEXT"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN chapters_json TEXT"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN chapters_fetched_at TEXT"); } catch {}
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
  app_name: "YT Zero",
  app_icon_color: "#f2293a",
  shorts_tab: "1",
  show_top_channels: "1",
  sidebar_nav: "",
  sponsorblock_enabled: "0",
  sponsorblock_categories: '["sponsor"]',
};

// App-wide settings that are NOT per profile. Everything else in
// SETTING_DEFAULTS is stored per user in `user_settings`.
export const GLOBAL_SETTING_KEYS = new Set([
  "child_lock_enabled",
  "child_lock_pin_hash",
  "app_name",
  "app_icon_color",
]);
// Keys that live per profile (used for the /settings response and migration).
export const USER_SETTING_KEYS = Object.keys(SETTING_DEFAULTS).filter((k) => !GLOBAL_SETTING_KEYS.has(k));

// Seed only app-wide defaults into the global table. Per-profile keys live in
// `user_settings` (see GLOBAL_SETTING_KEYS / migration below).
for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
  if (GLOBAL_SETTING_KEYS.has(key)) {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  }
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function isGlobalSetting(key: string): boolean {
  return GLOBAL_SETTING_KEYS.has(key);
}

export function getUserSetting(userId: number, key: string): string | null {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?").get(userId, key) as { value: string } | null;
  return row?.value ?? SETTING_DEFAULTS[key] ?? null;
}

export function setUserSetting(userId: number, key: string, value: string) {
  db.prepare(
    "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
  ).run(userId, key, value);
}

// ---------- one-time multi-user migration ----------
// Rebuilds `tags` with a per-user unique constraint, creates the default
// default profile and moves all existing single-user state onto it.
if (getSetting("multiuser_migrated") !== "1") {
  db.exec("PRAGMA foreign_keys=OFF;");
  const migrate = db.transaction(() => {
    // Ensure a default profile exists (id reused as the owner of legacy data).
    const existing = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as { id: number } | null;
    const defaultUserId = existing?.id
      ?? (db.prepare("INSERT INTO users (name, avatar_color) VALUES (?, ?)").run("Default", "#f2293a").lastInsertRowid as number);

    // Rebuild tags so the unique constraint is (user_id, name) instead of global name.
    db.exec(`
      CREATE TABLE tags_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL COLLATE NOCASE,
        color       TEXT NOT NULL DEFAULT '#7c5cff',
        filter_only INTEGER NOT NULL DEFAULT 0,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE (user_id, name)
      );
    `);
    db.prepare(
      "INSERT INTO tags_new (id, name, color, filter_only, user_id) SELECT id, name, color, COALESCE(filter_only, 0), ? FROM tags"
    ).run(defaultUserId);
    db.exec("DROP TABLE tags;");
    db.exec("ALTER TABLE tags_new RENAME TO tags;");

    // Claim existing per-user state for the default profile.
    for (const t of ["auto_tag_rules", "filter_rules", "user_playlists", "history"]) {
      db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(defaultUserId);
    }

    // Subscriptions: one row per channel for the default profile.
    db.prepare(
      "INSERT OR IGNORE INTO user_channels (user_id, channel_id, followed) SELECT ?, channel_id, followed FROM channels"
    ).run(defaultUserId);

    // Per-video state: only rows that carry real state (the rest default to inbox).
    db.prepare(
      `INSERT OR IGNORE INTO user_videos (user_id, video_id, status, bucket, queued_at, show_from, watch_position, watch_duration, liked)
       SELECT ?, video_id, status, bucket, queued_at, show_from, watch_position, watch_duration, liked
       FROM videos
       WHERE status != 'inbox' OR liked IS NOT NULL OR watch_position IS NOT NULL OR show_from IS NOT NULL`
    ).run(defaultUserId);

    // Move per-user settings off the global table onto the default profile.
    for (const key of USER_SETTING_KEYS) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
      if (row) {
        db.prepare("INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)").run(defaultUserId, key, row.value);
        db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      }
    }
  });
  migrate();
  db.exec("PRAGMA foreign_keys=ON;");
  setSetting("multiuser_migrated", "1");
}

// First profile for a brand-new install (no legacy data to migrate).
if ((db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n === 0) {
  db.prepare("INSERT INTO users (name, avatar_color) VALUES (?, ?)").run("Default", "#f2293a");
}
