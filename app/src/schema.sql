CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '',
  thumbnail  TEXT NOT NULL DEFAULT '',
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at TEXT,
  manual_status TEXT NOT NULL DEFAULT 'active',
  manual_status_updated_at TEXT
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
CREATE INDEX IF NOT EXISTS idx_videos_channel_published ON videos(channel_id, published_at DESC);

CREATE TABLE IF NOT EXISTS video_creators (
  video_id   TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  handle     TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_owner   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_video_creators_video ON video_creators(video_id, sort_order);

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

CREATE TABLE IF NOT EXISTS plugins (
  id         TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 0,
  version    TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugin_settings (
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  PRIMARY KEY (plugin_id, user_id, key)
);

CREATE TABLE IF NOT EXISTS plugin_state (
  plugin_id  TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, user_id, key)
);

-- Local copies fetched with yt-dlp. The physical file remains shared, while
-- download_owners below controls which profiles may see and manage it.
CREATE TABLE IF NOT EXISTS downloads (
  video_id    TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
  -- queued | downloading | done | error
  status      TEXT NOT NULL DEFAULT 'queued',
  -- manual (user asked) | scheduled (watch-later bucket) | feed (fresh upload)
  source      TEXT NOT NULL DEFAULT 'manual',
  quality     TEXT,
  path        TEXT,
  size_bytes  INTEGER,
  error       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  -- pinned downloads are never auto-deleted by retention/storage cleanup
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  started_at  TEXT,
  finished_at TEXT,
  automation_rule_id INTEGER,
  requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);

CREATE TABLE IF NOT EXISTS download_owners (
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id            TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE,
  source              TEXT NOT NULL DEFAULT 'manual',
  automation_rule_id  INTEGER,
  pinned              INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_download_owners_video ON download_owners(video_id);

-- Portable, instance-wide automation rules for the shared download library.
-- JSON columns contain stable YouTube ids or simple keyword strings; runtime
-- queue state remains in downloads and is deliberately not portable.
CREATE TABLE IF NOT EXISTS download_rules (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  portable_uuid        TEXT NOT NULL UNIQUE,
  user_id              INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  source_mode          TEXT NOT NULL DEFAULT 'selected' CHECK (source_mode IN ('subscriptions', 'selected')),
  channel_ids_json     TEXT NOT NULL DEFAULT '[]',
  playlist_ids_json    TEXT NOT NULL DEFAULT '[]',
  include_keywords_json TEXT NOT NULL DEFAULT '[]',
  exclude_keywords_json TEXT NOT NULL DEFAULT '[]',
  keyword_mode         TEXT NOT NULL DEFAULT 'any' CHECK (keyword_mode IN ('any', 'all')),
  match_field          TEXT NOT NULL DEFAULT 'title' CHECK (match_field IN ('title', 'description', 'both')),
  include_shorts       INTEGER NOT NULL DEFAULT 0,
  include_members_only INTEGER NOT NULL DEFAULT 0,
  min_duration_seconds INTEGER NOT NULL DEFAULT 0,
  backfill_mode        TEXT NOT NULL DEFAULT 'future' CHECK (backfill_mode IN ('future', 'recent', 'all')),
  lookback_hours       INTEGER NOT NULL DEFAULT 48,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_download_rules_enabled ON download_rules(enabled);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('dismiss', 'less_like_this')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, video_id)
);

CREATE TABLE IF NOT EXISTS discovery_recommendations (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id     TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  score        REAL NOT NULL DEFAULT 0,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  query        TEXT,
  rank         INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_discovery_recommendations_user_rank ON discovery_recommendations(user_id, rank);
CREATE INDEX IF NOT EXISTS idx_discovery_recommendations_generated ON discovery_recommendations(generated_at DESC);

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

-- Public YouTube playlists published by subscribed channels. Keeping the
-- membership locally makes the watch-page widget instant and avoids a burst
-- of YouTube requests every time a video is opened.
CREATE TABLE IF NOT EXISTS channel_playlists (
  playlist_id TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT NOT NULL DEFAULT '',
  video_count TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_channel_playlists_channel ON channel_playlists(channel_id);

CREATE TABLE IF NOT EXISTS channel_playlist_videos (
  playlist_id TEXT NOT NULL REFERENCES channel_playlists(playlist_id) ON DELETE CASCADE,
  video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  position     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_playlist_videos_video ON channel_playlist_videos(video_id);

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
  is_admin     INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A profile's subscriptions. followed = 1 (subscribed) / 0 (unfollowed/hidden).
CREATE TABLE IF NOT EXISTS user_channels (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT    NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  followed   INTEGER NOT NULL DEFAULT 1,
  -- NULL inherits the profile-wide player caption preference; "off" disables
  -- captions for this channel and "language" forces caption_language.
  caption_mode TEXT,
  caption_language TEXT,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_user_channels_channel ON user_channels(channel_id);

-- Public YouTube playlists followed independently by each profile. The
-- playlist and its fetched videos stay global; only the follow choice and feed
-- baseline are per profile.
CREATE TABLE IF NOT EXISTS user_followed_playlists (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id  TEXT NOT NULL REFERENCES channel_playlists(playlist_id) ON DELETE CASCADE,
  followed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  feed_from    TEXT NOT NULL DEFAULT (datetime('now')),
  include_in_feed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, playlist_id)
);
CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_playlist ON user_followed_playlists(playlist_id);

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
  watched        INTEGER,
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

CREATE TABLE IF NOT EXISTS update_check_state (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  target     TEXT NOT NULL DEFAULT '',
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at);

-- ---------- Social plugin ----------
-- Social content is shared between profiles in this installation. UUID text
-- keys are stable portable identities; local profile ids remain internal.
CREATE TABLE IF NOT EXISTS social_posts (
  id             TEXT PRIMARY KEY,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id       TEXT NOT NULL REFERENCES videos(video_id) ON DELETE RESTRICT,
  body           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_author ON social_posts(author_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS social_comments (
  id             TEXT PRIMARY KEY,
  post_id        TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_social_comments_post_created ON social_comments(post_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_social_comments_author ON social_comments(author_user_id, created_at DESC);

-- A profile may select multiple distinct reactions on one post, but each
-- reaction key can occur only once for that profile/post pair.
CREATE TABLE IF NOT EXISTS social_reactions (
  post_id      TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_key TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id, reaction_key)
);
CREATE INDEX IF NOT EXISTS idx_social_reactions_post ON social_reactions(post_id, reaction_key);

-- Bounded, profile-owned picker shortcuts. This remains independent from
-- current post reactions so removing a reaction does not erase recent usage.
CREATE TABLE IF NOT EXISTS social_recent_emojis (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_key TEXT NOT NULL,
  used_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, reaction_key)
);
CREATE INDEX IF NOT EXISTS idx_social_recent_emojis_user ON social_recent_emojis(user_id, used_at DESC);

CREATE TABLE IF NOT EXISTS social_comment_likes (
  comment_id TEXT NOT NULL REFERENCES social_comments(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_social_comment_likes_comment ON social_comment_likes(comment_id);

-- Mention relations preserve identity across profile renames. The raw token is
-- retained so old text still renders exactly as authored.
CREATE TABLE IF NOT EXISTS social_post_mentions (
  post_id            TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  mentioned_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token              TEXT NOT NULL,
  PRIMARY KEY (post_id, mentioned_user_id)
);
CREATE INDEX IF NOT EXISTS idx_social_post_mentions_user ON social_post_mentions(mentioned_user_id, post_id);

CREATE TABLE IF NOT EXISTS social_comment_mentions (
  comment_id          TEXT NOT NULL REFERENCES social_comments(id) ON DELETE CASCADE,
  mentioned_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token               TEXT NOT NULL,
  PRIMARY KEY (comment_id, mentioned_user_id)
);
CREATE INDEX IF NOT EXISTS idx_social_comment_mentions_user ON social_comment_mentions(mentioned_user_id, comment_id);

-- ---------- Watch-time log & child profiles ----------
-- Seconds of actual playback for every profile, per video / local day / hour.
-- Feeds the child-profile daily limits and the (future) stats pages: channel
-- and tag breakdowns come from joining videos / video tags, the daily heatmap
-- from the hour column.
CREATE TABLE IF NOT EXISTS watch_time_log (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  day      TEXT NOT NULL,
  hour     INTEGER NOT NULL,
  seconds  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, video_id, day, hour)
);
CREATE INDEX IF NOT EXISTS idx_watch_time_log_day ON watch_time_log(user_id, day);

-- Every explicit scheduling choice. Unlike user_videos.bucket this is an
-- append-only history, so rescheduling and recurring channel habits remain
-- measurable. tags_json snapshots the profile's effective tags at that time.
CREATE TABLE IF NOT EXISTS scheduling_event_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  bucket       TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'manual',
  tags_json    TEXT NOT NULL DEFAULT '[]',
  local_day    TEXT NOT NULL DEFAULT (date('now')),
  local_hour   INTEGER NOT NULL DEFAULT (CAST(strftime('%H', 'now') AS INTEGER)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduling_event_user_time ON scheduling_event_log(user_id, local_day, local_hour);
CREATE INDEX IF NOT EXISTS idx_scheduling_event_channel_bucket ON scheduling_event_log(user_id, channel_id, bucket);

-- Stable tag snapshots aggregated from actual playback heartbeats. This keeps
-- time-of-day preferences honest even if tags are renamed or reassigned later.
CREATE TABLE IF NOT EXISTS watch_tag_time_log (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL,
  tag_name  TEXT NOT NULL,
  tag_color TEXT NOT NULL,
  day       TEXT NOT NULL,
  hour      INTEGER NOT NULL,
  seconds   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, tag_id, day, hour)
);
CREATE INDEX IF NOT EXISTS idx_watch_tag_time_hour ON watch_tag_time_log(user_id, hour, tag_id);

-- SponsorBlock segments that were actually skipped by the player. Each event
-- is recorded once so Pulse can report time genuinely saved, rather than all
-- segments merely returned by the public SponsorBlock API.
CREATE TABLE IF NOT EXISTS sponsorblock_skip_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id        TEXT NOT NULL,
  segment_uuid    TEXT NOT NULL,
  category        TEXT NOT NULL,
  skipped_seconds REAL NOT NULL,
  day             TEXT NOT NULL DEFAULT (date('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sponsorblock_skip_day ON sponsorblock_skip_log(user_id, day);

-- Per-day limit extensions granted by a parent (unlimited = limit off today).
CREATE TABLE IF NOT EXISTS child_time_extras (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  extra_seconds REAL NOT NULL DEFAULT 0,
  unlimited     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- "More time" requests; pending ones are shown to parent profiles for 1 hour.
CREATE TABLE IF NOT EXISTS child_time_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  grant_type  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_child_time_requests_status ON child_time_requests(status, created_at);

-- ---------- Authentication ----------
-- WebAuthn / passkey credentials. user_id NULL = the shared-account credential
-- (auth_method = 'shared'); a real user_id = a per-profile passkey.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    BLOB NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  label         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);

-- Server-side auth sessions (survive restart, unlike the in-memory child lock).
-- scope = 'account' (may pick any profile, e.g. shared / oidc-gateway) or
-- 'profile' (pinned to user_id, e.g. per_profile / oidc-mapped).
CREATE TABLE IF NOT EXISTS auth_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen  TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

-- One undo slot per profile for the "clean up the feed" bulk action — a fresh
-- run always replaces the previous slot, there is no history stack.
CREATE TABLE IF NOT EXISTS bulk_undo (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  count      INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
