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
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- Retry metadata for inconclusive YouTube Shorts classification. This is
  -- rebuildable catalog state and is deliberately excluded from portable backup.
  short_check_attempts INTEGER NOT NULL DEFAULT 0,
  short_check_attempted_at TEXT,
  short_check_next_attempt_at TEXT
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
-- Domain-owned configuration for the built-in downloads feature.
CREATE TABLE IF NOT EXISTS download_settings (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key));
-- Local copies fetched with yt-dlp. The physical file remains shared, while
-- download_owners below controls which profiles may see and manage it.
CREATE TABLE IF NOT EXISTS downloads (
  video_id    TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
  -- queued | downloading | done | error
  status      TEXT NOT NULL DEFAULT 'queued',
  -- manual (user asked) | scheduled (watch-later bucket) | feed (fresh upload)
  source      TEXT NOT NULL DEFAULT 'manual',
  -- Snapshot of a playlist-specific quality override while the job is queued.
  -- NULL means the requesting profile's download default.
  requested_quality TEXT CHECK (requested_quality IS NULL OR requested_quality IN ('best', '1440', '1080', '720', '480')),
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
  progress_percent REAL,
  progress_total_bytes INTEGER,
  progress_speed TEXT,
  -- Runtime ownership prevents a replacement worker from taking a live job.
  -- Both fields are transient and cleared when the job leaves downloading.
  worker_id TEXT,
  worker_heartbeat_at_ms INTEGER,
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
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- none | download | keep. `keep` adds playlist-owned cleanup protection.
  offline_policy TEXT NOT NULL DEFAULT 'none' CHECK (offline_policy IN ('none', 'download', 'keep')),
  -- NULL inherits the profile's default download quality.
  download_quality TEXT CHECK (download_quality IS NULL OR download_quality IN ('best', '1440', '1080', '720', '480'))
);

CREATE TABLE IF NOT EXISTS user_playlist_videos (
  playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  video_id    TEXT    NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, video_id)
);

-- A playlist protection is independent from a manual pin. This lets one video
-- be retained by several playlists without removing the other reasons when a
-- single playlist changes policy or membership.
CREATE TABLE IF NOT EXISTS user_playlist_download_protections (
  playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  video_id    TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE,
  PRIMARY KEY (playlist_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_user_playlist_download_protections_video ON user_playlist_download_protections(video_id);

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

-- Profile access control. Groups are portable configuration; direct rows are
-- explicit profile-level allow/deny overrides over the assigned base group.
CREATE TABLE IF NOT EXISTS permission_groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  portable_uuid TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  is_system     INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permission_group_permissions (
  group_id   INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  allowed    INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0,1)),
  PRIMARY KEY (group_id, permission)
);

CREATE TABLE IF NOT EXISTS profile_permission_groups (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS profile_permission_overrides (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  allowed    INTEGER NOT NULL CHECK (allowed IN (0,1)),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE IF NOT EXISTS permission_policy (
  singleton        INTEGER PRIMARY KEY CHECK (singleton = 1),
  default_group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT,
  revision         INTEGER NOT NULL DEFAULT 1
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
  -- "default" inherits the global Shorts feed mode; "show" opts this
  -- channel into the selective mode.
  shorts_feed_visibility TEXT,
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
  -- none | download | keep. `keep` adds followed-playlist cleanup protection.
  offline_policy TEXT NOT NULL DEFAULT 'none' CHECK (offline_policy IN ('none', 'download', 'keep')),
  -- NULL inherits the profile's default download quality.
  download_quality TEXT CHECK (download_quality IS NULL OR download_quality IN ('best', '1440', '1080', '720', '480')),
  PRIMARY KEY (user_id, playlist_id)
);
CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_playlist ON user_followed_playlists(playlist_id);

CREATE TABLE IF NOT EXISTS followed_playlist_download_protections (
  user_id INTEGER NOT NULL,
  playlist_id TEXT NOT NULL,
  video_id TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, playlist_id, video_id),
  FOREIGN KEY (user_id, playlist_id) REFERENCES user_followed_playlists(user_id, playlist_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_followed_playlist_download_protections_video ON followed_playlist_download_protections(video_id);

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
  playback_context_json TEXT,
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_user_videos_video ON user_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_user_videos_status ON user_videos(user_id, status);

-- Profile-owned return points into a video.
CREATE TABLE IF NOT EXISTS bookmarks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  portable_uuid    TEXT NOT NULL UNIQUE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id         TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  description      TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_updated ON bookmarks(user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_video ON bookmarks(video_id);

-- Per-profile settings (the global settings table keeps only app-wide keys).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Portable per-profile notification choices. An empty source_id stores the
-- profile-wide master/category value; a stable YouTube channel or playlist id
-- stores an explicit source override.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  enabled   INTEGER NOT NULL CHECK (enabled IN (0,1)),
  PRIMARY KEY (user_id, kind, source_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

-- Where a profile's notifications are forwarded outside YT Zero. The provider
-- itself is an instance-wide choice made in the External notifications plugin;
-- one row per profile and provider keeps a profile's targets from being lost
-- when the administrator switches providers. `targets` holds provider-specific
-- addresses (Apprise URLs, webhook endpoints, or ntfy topics) and is a secret:
-- it commonly embeds bot tokens and must never leave the installation.
CREATE TABLE IF NOT EXISTS notification_delivery (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT    NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  targets  TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, provider)
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

-- Server-side auth sessions shared by every HTTP replica.
-- scope = 'account' (may pick any profile, e.g. shared / oidc-gateway) or
-- 'profile' (pinned to user_id, e.g. per_profile / oidc-mapped).
CREATE TABLE IF NOT EXISTS auth_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  permission_group_uuid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen  TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

-- Short-lived login challenges are shared by HTTP replicas so an OIDC or
-- WebAuthn callback may land on a different process than the initiating request.
CREATE TABLE IF NOT EXISTS auth_flows (
  id         TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  nonce      TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_flows_expires ON auth_flows(expires_at);

-- The Child Lock unlock cookie is also server-side and shared by replicas.
CREATE TABLE IF NOT EXISTS child_lock_sessions (
  token      TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_child_lock_sessions_expires ON child_lock_sessions(expires_at);

-- Transient playback heartbeat used for cross-replica child accounting and
-- the parent's now-watching panel. Durable aggregate time stays in watch_time_log.
CREATE TABLE IF NOT EXISTS playback_activity (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL,
  seen_at_ms INTEGER NOT NULL
);

-- Cross-replica failed-PIN counter. The resulting timed lock remains in the
-- profile settings; this row is removed on success or after the threshold.
CREATE TABLE IF NOT EXISTS child_pin_failures (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failures INTEGER NOT NULL DEFAULT 0
);

-- Transient cross-replica notification log. PostgreSQL HTTP replicas poll it
-- to forward mutations to their locally connected SSE clients.
CREATE TABLE IF NOT EXISTS app_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  origin     TEXT NOT NULL,
  topic      TEXT NOT NULL,
  user_id    INTEGER,
  data       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events(created_at);

-- Ephemeral membership registry for the PostgreSQL cluster dashboard. Each
-- process refreshes only its own row; stale rows are kept briefly so an
-- administrator can see a replica that disappeared during a rollout.
CREATE TABLE IF NOT EXISTS cluster_instances (
  instance_id       TEXT PRIMARY KEY,
  instance_name     TEXT NOT NULL,
  hostname          TEXT NOT NULL,
  started_at_ms     INTEGER NOT NULL,
  last_seen_at_ms   INTEGER NOT NULL,
  version           TEXT NOT NULL,
  commit_hash       TEXT NOT NULL,
  background_tasks  INTEGER NOT NULL CHECK (background_tasks IN (0,1)),
  settings_json     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cluster_instances_last_seen ON cluster_instances(last_seen_at_ms);

-- Portable per-profile feed composition preferences. Composition sessions are
-- a rebuildable, short-lived cache and intentionally remain separate below.
CREATE TABLE IF NOT EXISTS user_feed_configs (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision   INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rebuildable pagination snapshots for the composed feed. They expire quickly
-- and are not part of portable backups.
CREATE TABLE IF NOT EXISTS feed_composition_sessions (
  id                  TEXT PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_revision     INTEGER NOT NULL,
  columns_count       INTEGER NOT NULL,
  seed                TEXT NOT NULL,
  request_json        TEXT NOT NULL,
  state_json          TEXT NOT NULL,
  created_at_ms       INTEGER NOT NULL,
  last_accessed_at_ms INTEGER NOT NULL,
  expires_at_ms       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_composition_sessions_expiry ON feed_composition_sessions(expires_at_ms);
CREATE TABLE IF NOT EXISTS feed_composition_pages (
  composition_id TEXT NOT NULL REFERENCES feed_composition_sessions(id) ON DELETE CASCADE,
  page_index     INTEGER NOT NULL,
  response_json  TEXT NOT NULL,
  PRIMARY KEY (composition_id, page_index)
);

-- One undo slot per profile for the "clean up the feed" bulk action — a fresh
-- run always replaces the previous slot, there is no history stack.
CREATE TABLE IF NOT EXISTS bulk_undo (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  count      INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
