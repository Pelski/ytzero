import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { configureTimeZoneProvider, DEFAULT_TIME_ZONE, environmentTimeZone } from "./timeZone";
import { configureSQLiteConnection, optimizeSQLite } from "./sqliteMaintenance";
import { applySQLiteMigrations } from "./sqliteMigrations";
import { database, databaseConfig } from "./database";
import { ensureChannelPostsPostgresSchema } from "./channelPostsSchema";
import { migrateSQLiteToPostgres } from "./postgresMigration";
import { applyDatabaseMigrations } from "./databaseMigrations";
export const DB_PATH = process.env.DB_PATH ?? resolve(import.meta.dir, "../../data/db/ytzero.db");
mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH, { create: true });
configureSQLiteConnection(db);
db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
db.exec(readFileSync(new URL("./channelPostsSchema.sql", import.meta.url), "utf8"));

// Per-profile login identity (used by auth_method = per_profile / oidc / proxy_header).
for (const stmt of [
  "ALTER TABLE users ADD COLUMN username TEXT",
  "ALTER TABLE users ADD COLUMN password_hash TEXT",
  "ALTER TABLE users ADD COLUMN oidc_subject TEXT",
  "ALTER TABLE users ADD COLUMN proxy_match TEXT",
  // Instance-local delegated administrator grant. The primary profile remains
  // the immutable owner regardless of this flag.
  "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
  // is_admin grants primary-equivalent powers to OIDC sessions whose groups
  // claim contains the configured admin group (older DBs predate this column).
  "ALTER TABLE auth_sessions ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
  // Child profile: restrictions are enforced server-side; only the primary
  // profile may toggle this flag.
  "ALTER TABLE users ADD COLUMN is_child INTEGER NOT NULL DEFAULT 0",
  // Superseded by watch_time_log (which also feeds the child limits).
  "DROP TABLE IF EXISTS child_watch_time",
]) {
  try { db.exec(stmt); } catch {}
}

try { db.exec("ALTER TABLE scheduling_event_log ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'"); } catch {}

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

for (const col of ["is_short INTEGER", "views INTEGER", "likes INTEGER"]) {
  try {
    db.exec(`ALTER TABLE videos ADD COLUMN ${col}`);
  } catch {}
}
try { db.exec("ALTER TABLE channels ADD COLUMN followed INTEGER NOT NULL DEFAULT 1"); } catch {}
// Per-profile per-channel playback speed override (NULL = inherit player_speed).
try { db.exec("ALTER TABLE user_channels ADD COLUMN playback_speed TEXT"); } catch {}
try { db.exec("ALTER TABLE user_channels ADD COLUMN caption_mode TEXT"); } catch {}
try { db.exec("ALTER TABLE user_channels ADD COLUMN caption_language TEXT"); } catch {}
// NULL inherits the profile setting; 0 always shows and 1 always hides this
// channel's members-only uploads from the main feed.
try { db.exec("ALTER TABLE user_channels ADD COLUMN hide_members_only_from_feed INTEGER"); } catch {}
// NULL inherits the profile-wide visibility setting; 0 always shows and 1
// always hides this channel's members-only uploads on the channel page.
try { db.exec("ALTER TABLE user_channels ADD COLUMN hide_members_only_on_channel INTEGER"); } catch {}
// Explicit mode avoids overloading NULL for inheritance. Some development
// databases briefly received a NOT NULL channel flag, which made "default"
// impossible to persist; this column is the source of truth going forward.
try { db.exec("ALTER TABLE user_channels ADD COLUMN members_only_visibility TEXT"); } catch {}
// Explicit per-channel opt-in used by the selective Shorts feed mode. The
// profile-wide "none" and "all" modes intentionally ignore this preference.
try { db.exec("ALTER TABLE user_channels ADD COLUMN shorts_feed_visibility TEXT"); } catch {}
db.exec(`
  UPDATE user_channels
  SET members_only_visibility = CASE
    WHEN hide_members_only_on_channel = 1 AND hide_members_only_from_feed = 1 THEN 'hidden'
    WHEN hide_members_only_on_channel = 1 THEN 'feed'
    WHEN hide_members_only_from_feed = 1 THEN 'channel'
    WHEN hide_members_only_from_feed = 0 THEN 'everywhere'
    ELSE 'default'
  END
  WHERE members_only_visibility IS NULL
`);
// "Feed only" inverted the channel/feed hierarchy and is no longer a valid
// mode. Preserve feed visibility while restoring the video on its channel.
db.exec(`
  UPDATE user_channels
  SET members_only_visibility = 'everywhere',
      hide_members_only_from_feed = 0,
      hide_members_only_on_channel = 0
  WHERE members_only_visibility = 'feed'
`);
db.exec(`
  UPDATE user_settings
  SET value = '0'
  WHERE key = 'hide_members_only_on_channel'
    AND value = '1'
    AND COALESCE((
      SELECT feed.value
      FROM user_settings AS feed
      WHERE feed.user_id = user_settings.user_id
        AND feed.key = 'hide_members_only_from_feed'
    ), '0') <> '1'
`);
try { db.exec("ALTER TABLE videos ADD COLUMN duration TEXT"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN watch_position REAL"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN watch_duration REAL"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN subscriber_count TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN avatar_checked_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN avatar_refresh_attempted_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channel_playlists ADD COLUMN last_synced_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channel_playlists ADD COLUMN sync_attempted_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channel_playlist_videos ADD COLUMN discovered_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channel_playlist_videos ADD COLUMN last_seen_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channel_playlist_videos ADD COLUMN position INTEGER NOT NULL DEFAULT 0"); } catch {}
db.exec("UPDATE channel_playlist_videos SET discovered_at = COALESCE(discovered_at, datetime('now')), last_seen_at = COALESCE(last_seen_at, datetime('now'))");
db.exec(`CREATE TABLE IF NOT EXISTS user_followed_playlists (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES channel_playlists(playlist_id) ON DELETE CASCADE,
  followed_at TEXT NOT NULL DEFAULT (datetime('now')),
  feed_from TEXT NOT NULL DEFAULT (datetime('now')),
  include_in_feed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, playlist_id)
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_playlist ON user_followed_playlists(playlist_id)");
try { db.exec("ALTER TABLE videos ADD COLUMN show_from TEXT"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN liked INTEGER"); } catch {}
try { db.exec("ALTER TABLE user_videos ADD COLUMN watched INTEGER"); } catch {}
db.exec(`UPDATE user_videos SET watched = 1
  WHERE watched IS NULL AND watch_duration > 0
    AND CAST(watch_position AS REAL) / watch_duration >= 0.9`);
try { db.exec("ALTER TABLE tags ADD COLUMN filter_only INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN external INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN external INTEGER NOT NULL DEFAULT 0"); } catch {}
// Explicit operator classification. Unlike network errors, this is never set
// automatically and can always be reverted to "active" from channel settings.
try { db.exec("ALTER TABLE channels ADD COLUMN manual_status TEXT NOT NULL DEFAULT 'active'"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN manual_status_updated_at TEXT"); } catch {}
// Cached channel "about" payload (description, banner, links, stats, …) so the
// channel page reads from the DB instead of scraping YouTube on every visit.
try { db.exec("ALTER TABLE channels ADD COLUMN about_json TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN about_fetched_at TEXT"); } catch {}
// Cached channel playlists and per-video chapters — same idea: read from the DB
// instead of scraping YouTube on every request.
try { db.exec("ALTER TABLE channels ADD COLUMN playlists_json TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN playlists_fetched_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN playlists_cache_version INTEGER NOT NULL DEFAULT 0"); } catch {}
// Full channel scans are intentionally much slower than the regular RSS
// refresh. Separate timestamps keep their round-robin scheduler independent.
try { db.exec("ALTER TABLE channels ADD COLUMN full_sync_attempted_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN last_full_synced_at TEXT"); } catch {}
// Adaptive RSS scheduling state is derived from local refresh attempts and is
// intentionally excluded from portable backups.
try { db.exec("ALTER TABLE channels ADD COLUMN feed_refresh_attempted_at TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN feed_refresh_failures INTEGER NOT NULL DEFAULT 0"); } catch {}
// Optional operator-owned publication pattern. When both values are valid it
// adds fixed refreshes alongside adaptive RSS timing. Days are JSON weekday
// numbers (0=Sunday); the legacy-named time column stores a JSON array of
// HH:mm values and still accepts the original single value on read.
try { db.exec("ALTER TABLE channels ADD COLUMN refresh_schedule_days TEXT"); } catch {}
try { db.exec("ALTER TABLE channels ADD COLUMN refresh_schedule_time TEXT"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN chapters_json TEXT"); } catch {}
// Priority downloads (viewer is actively waiting) jump the queue and may
// preempt the running job.
try { db.exec("ALTER TABLE downloads ADD COLUMN priority INTEGER NOT NULL DEFAULT 0"); } catch {}
// User-chosen display name; NULL falls back to the original `title` (which the
// refresher keeps in sync with YouTube, so reverting is always possible).
try { db.exec("ALTER TABLE channels ADD COLUMN custom_title TEXT"); } catch {}
// Global downloads serve every profile, so the per-channel automatic-download
// threshold lives on the shared channel rather than a profile association.
try { db.exec("ALTER TABLE channels ADD COLUMN auto_download_min_duration INTEGER NOT NULL DEFAULT 0"); } catch {}
// NULL inherits the downloads feature's global threshold; 0 is an explicit
// per-channel opt-out. Preserve any non-zero threshold saved before overrides
// were introduced, while allowing channels at the old default (0) to inherit.
try {
  db.exec("ALTER TABLE channels ADD COLUMN auto_download_min_duration_override INTEGER");
  db.exec("UPDATE channels SET auto_download_min_duration_override = auto_download_min_duration WHERE auto_download_min_duration > 0");
} catch {}
// Relative output path (no extension) rendered from the downloads feature's
// filename template; sidecar files (nfo/thumbnail/subs) share this base.
try { db.exec("ALTER TABLE downloads ADD COLUMN output_base TEXT"); } catch {}
// Snapshot of the playlist name only for downloads explicitly queued from a
// playlist view. It feeds the optional {playlist} output-template token.
try { db.exec("ALTER TABLE downloads ADD COLUMN playlist_title TEXT"); } catch {}
// Rule attribution makes automatic decisions explainable without coupling
// queue rows to the lifecycle of a rule (deleted rules leave useful history).
try { db.exec("ALTER TABLE downloads ADD COLUMN automation_rule_id INTEGER"); } catch {}
try { db.exec("ALTER TABLE downloads ADD COLUMN requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"); } catch {}
try { db.exec("ALTER TABLE download_rules ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN chapters_fetched_at TEXT"); } catch {}
try { db.exec("ALTER TABLE videos ADD COLUMN creators_fetched_at TEXT"); } catch {}
try { db.exec("ALTER TABLE video_creators ADD COLUMN handle TEXT NOT NULL DEFAULT ''"); } catch {}
// Publication dates discovered only as relative channel-card labels are kept
// distinct until the watch page can provide YouTube's exact publish date.
try { db.exec("ALTER TABLE videos ADD COLUMN published_at_approximate INTEGER NOT NULL DEFAULT 0"); } catch {}
// YouTube exposes members-only status as a badge on channel video cards.
try { db.exec("ALTER TABLE videos ADD COLUMN members_only INTEGER NOT NULL DEFAULT 0"); } catch {}
// Permanent unavailability discovered from YouTube's player response. Private
// videos are kept in the library (Takeout history/playlists still reference
// them), but background jobs must not keep probing them.
try { db.exec("ALTER TABLE videos ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0"); } catch {}
db.exec("UPDATE videos SET bucket = 'today' WHERE bucket = 'morning';");
db.exec("UPDATE videos SET bucket = 'tonight' WHERE bucket = 'evening';");

export const SETTING_DEFAULTS: Record<string, string> = {
  language: "en",
  // 0 = no Shorts in Main, selected = opted-in channels, 1 = every channel.
  // Keeping the legacy 0/1 values makes existing databases and backups retain
  // their exact behaviour without a data migration.
  show_shorts: "0",
  player_hl: "en",
  player_cc: "0",
  player_cc_lang: "en",
  // Subtitle appearance in the local player (per profile), in pixels.
  player_sub_size: "19",
  player_sub_color: "#ffffff",
  player_sub_bg: "75",
  player_quality: "auto",
  player_speed: "1",
  keyboard_seek_seconds: "5",
  // Browser-extension integration for enhancing the embedded YouTube iframe.
  // These are portable presentation preferences and contain no instance secrets.
  enhance_enabled: "1",
  enhance_replace_controls: "1",
  enhance_frame_fps: "30",
  // Frame export settings are portable, per-profile presentation preferences.
  player_screenshot_format: "jpeg",
  player_screenshot_quality: "0.92",
  player_screenshot_filename: "{channel}_{title}_{timestamp_ms}",
  // Mobile: rotating to landscape on the watch page enters fullscreen.
  auto_fullscreen_landscape: "0",
  grid_size: "sm",
  // Portable per-profile UI preference; hover preserves the historical behaviour.
  video_card_actions: "hover", video_card_preview: "all", // Portable card hover controls and preview source policy.
  video_card_action_buttons: '{"version":1,"actions":[{"id":"schedule","hidden":false},{"id":"playlist","hidden":true},{"id":"download","hidden":true},{"id":"archive","hidden":false},{"id":"watched","hidden":false},{"id":"restore","hidden":false},{"id":"remove","hidden":false}]}', // Portable ordered card controls.
  video_card_swipe_devices: '{"version":1,"devices":["desktop","tablet","mobile"]}', // Portable per-device swipe availability.
  // Portable per-profile presentation preference for the child activity
  // shortcut. Live viewing activity remains transient and is never exported.
  child_watching_monitor_enabled: "1",
  child_lock_enabled: "0",
  child_lock_pin_hash: "",
  // Portable, non-secret policy defining which areas non-admin profiles may
  // not change. This is independent from the temporary PIN-based child lock.
  profile_admin_only_areas: '{"version":3,"adminOnlyAreas":["imports","appearance","feed","navigation","playback","plugins","profiles"]}',
  app_name: "YT Zero",
  app_icon_color: "#0a5fff",
  // One instance-wide IANA timezone drives logs, daily rotation, child limits,
  // and Insights/Pulse independently of the container or browser timezone.
  timezone: "UTC",
  shorts_tab: "1",
  show_top_channels: "1",
  // How far back the main feed reaches. Videos older than this stay in the
  // library (and on channel pages) but never surface in the feed, so a fresh
  // import of a large back catalogue doesn't bury today's uploads.
  // Unit "off" disables the limit entirely.
  feed_max_age_value: "6",
  feed_max_age_unit: "months",
  hide_live_from_feed: "0",
  // "More like this" on the watch page. Off keeps a session strictly to what the
  // viewer chose to open, with no suggested next thing.
  watch_show_related: "1",
  // Comments are fetched on demand through yt-dlp. Keep the section opt-in so
  // opening a video never triggers that extra network request by default.
  watch_show_comments: "0",
  // Opt-in channel Posts UI; fetched payloads are transient and never persisted.
  channel_posts_tab: "0",
  hide_members_only_from_feed: "0",
  hide_members_only_on_channel: "0",
  watched_style: "dimmed",
  sidebar_nav: "",
  sponsorblock_enabled: "0",
  sponsorblock_categories: '["sponsor"]',
  // Optional DeArrow presentation layers. Original library metadata is retained.
  dearrow_titles_enabled: "0",
  dearrow_thumbnails_enabled: "0",
  update_check_interval: "off",
  // Context-aware continuation through the list that opened the watch page.
  feed_autoplay_enabled: "0",
  feed_autoplay_behavior: "autoplay", // autoplay | prompt
  feed_autoplay_direction: "newest", // newest = list order | oldest = reverse
  // Main-feed chronology is a portable per-profile viewing preference.
  feed_sort: "published", // published | arrival
  // ---------- authentication (all app-wide, owned by the primary profile) ----------
  // none | shared | per_profile | oidc | proxy_header
  auth_method: "none",
  // For identity-bound login methods, optionally keep other profile names out
  // of the profile picker. Authentication configuration stays instance-local.
  auth_hide_other_profiles: "0",
  auth_shared_username: "",
  auth_shared_password_hash: "",
  auth_oidc_issuer: "",
  auth_oidc_client_id: "",
  auth_oidc_client_secret: "",
  auth_oidc_scopes: "openid profile email",
  // mapped (identity -> one profile, no switching) | gateway (SSO -> profile picker)
  auth_oidc_mode: "mapped",
  auth_oidc_claim: "preferred_username",
  auth_oidc_autocreate: "0",
  auth_oidc_logout_url: "",
  // Group-based admin: an OIDC identity whose `groups_claim` contains
  // `admin_group` gets primary-equivalent powers. Empty admin_group disables it.
  auth_oidc_groups_claim: "groups",
  auth_oidc_admin_group: "",
  // Configurable forward-auth header name (e.g. Remote-User, X-Authentik-Username).
  auth_proxy_header: "Remote-User",
  auth_proxy_logout_url: "",
};

// App-wide settings that are NOT per profile. Everything else in
// SETTING_DEFAULTS is stored per user in `user_settings`.
export const GLOBAL_SETTING_KEYS = new Set([
  "child_lock_enabled",
  "child_lock_pin_hash",
  "profile_admin_only_areas",
  "app_name",
  "app_icon_color",
  "timezone",
  "auth_method",
  "auth_hide_other_profiles",
  "auth_shared_username",
  "auth_shared_password_hash",
  "auth_oidc_issuer",
  "auth_oidc_client_id",
  "auth_oidc_client_secret",
  "auth_oidc_scopes",
  "auth_oidc_mode",
  "auth_oidc_claim",
  "auth_oidc_autocreate",
  "auth_oidc_logout_url",
  "auth_oidc_groups_claim",
  "auth_oidc_admin_group",
  "auth_proxy_header",
  "auth_proxy_logout_url",
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

const settingCache = new Map(
  (db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[])
    .map((row) => [row.key, row.value]),
);
const userSettingCache = new Map(
  (db.prepare("SELECT user_id, key, value FROM user_settings").all() as { user_id: number; key: string; value: string }[])
    .map((row) => [`${row.user_id}:${row.key}`, row.value]),
);
let runtimeSettingsReady = false;

export function getSetting(key: string): string | null {
  return settingCache.get(key) ?? null;
}

configureTimeZoneProvider(() => environmentTimeZone() ?? getSetting("timezone") ?? DEFAULT_TIME_ZONE);

export function setSetting(key: string, value: string): Promise<void> {
  if (databaseConfig.engine === "sqlite" || !runtimeSettingsReady) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    settingCache.set(key, value);
    return Promise.resolve();
  }
  return database.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value).then(() => { settingCache.set(key, value); });
}

export function isGlobalSetting(key: string): boolean {
  return GLOBAL_SETTING_KEYS.has(key);
}

export function getUserSetting(userId: number, key: string): string | null {
  return userSettingCache.get(`${userId}:${key}`) ?? SETTING_DEFAULTS[key] ?? null;
}

export function setUserSetting(userId: number, key: string, value: string): Promise<void> {
  if (databaseConfig.engine === "sqlite" || !runtimeSettingsReady) {
    db.prepare(
      "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
    ).run(userId, key, value);
    userSettingCache.set(`${userId}:${key}`, value);
    return Promise.resolve();
  }
  return database.prepare(
    "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
  ).run(userId, key, value).then(() => { userSettingCache.set(`${userId}:${key}`, value); });
}

export async function reloadSettingCache(): Promise<void> {
  settingCache.clear();
  for (const row of await database.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[]) {
    settingCache.set(row.key, row.value);
  }
  userSettingCache.clear();
  for (const row of await database.prepare("SELECT user_id, key, value FROM user_settings").all() as { user_id: number; key: string; value: string }[]) {
    userSettingCache.set(`${row.user_id}:${row.key}`, row.value);
  }
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

// Downloads used to be instance-wide. Preserve existing rows by assigning
// their ownership, rules and queue configuration to the primary profile. The
// marker is essential: running this backfill on every startup would recreate
// ownership that a profile deliberately removed from a shared physical file.
if (getSetting("downloads_profile_ownership_migrated") !== "1") {
  const legacyDownloadsOwner = (db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as { id: number }).id;
  const migrateLegacyDownloads = db.transaction(() => {
    db.prepare("UPDATE downloads SET requested_by_user_id = ? WHERE requested_by_user_id IS NULL").run(legacyDownloadsOwner);
    db.prepare("UPDATE download_rules SET user_id = ? WHERE user_id IS NULL").run(legacyDownloadsOwner);
    db.prepare(`
      INSERT OR IGNORE INTO download_owners (user_id, video_id, source, automation_rule_id, pinned, created_at)
      SELECT ?, video_id, source, automation_rule_id, pinned, created_at FROM downloads
    `).run(legacyDownloadsOwner);
    setSetting("downloads_profile_ownership_migrated", "1");
  });
  migrateLegacyDownloads();
}
db.exec("CREATE INDEX IF NOT EXISTS idx_download_rules_user_enabled ON download_rules(user_id, enabled)");

// Stable identities used by portable backup/restore. Local integer ids remain
// implementation details and are never written to a portable archive.
for (const stmt of [
  "ALTER TABLE users ADD COLUMN portable_uuid TEXT",
  "ALTER TABLE tags ADD COLUMN portable_uuid TEXT",
  "ALTER TABLE user_playlists ADD COLUMN portable_uuid TEXT",
]) {
  try { db.exec(stmt); } catch {}
}
for (const table of ["users", "tags", "user_playlists"] as const) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE portable_uuid IS NULL OR portable_uuid = ''`).all() as { id: number }[];
  const update = db.prepare(`UPDATE ${table} SET portable_uuid = ? WHERE id = ?`);
  const backfill = db.transaction(() => {
    for (const row of rows) update.run(crypto.randomUUID(), row.id);
  });
  backfill();
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_portable_uuid ON ${table}(portable_uuid)`);
}

// Records where a portable object from another installation landed locally.
// This keeps repeated restores idempotent even when an older target assigned a
// different UUID during a previous import.
db.exec(`CREATE TABLE IF NOT EXISTS portable_object_mappings (
  source_installation_id TEXT NOT NULL,
  object_type            TEXT NOT NULL,
  source_uuid            TEXT NOT NULL,
  local_id               INTEGER NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_installation_id, object_type, source_uuid)
)`);

if (!getSetting("installation_id")) setSetting("installation_id", crypto.randomUUID());

// Keep planner statistics current, but only after every schema/index migration
// above has completed. The feed-order index makes the primary feed plan stable
// after statistics are introduced (covered by sqliteMaintenance tests).
applySQLiteMigrations(db);
optimizeSQLite(db, true);
// The synchronous SQLite bootstrap above remains the canonical local schema
// builder. Runtime reads, however, must come from the selected engine. A
// migrated PostgreSQL database already contains these tables and values.
if (databaseConfig.engine === "postgres") {
  const schema = await database.prepare("SELECT to_regclass('public.settings') AS settings_table").get() as { settings_table: string | null } | null;
  if (!schema?.settings_table) {
    const localRows = (db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM channels) +
        (SELECT COUNT(*) FROM videos) +
        (SELECT COUNT(*) FROM history) +
        (SELECT COUNT(*) FROM user_videos) AS count
    `).get() as { count: number }).count;
    if (localRows > 0) {
      throw new Error("PostgreSQL is empty but the SQLite source contains data; start with SQLite and use Settings > Advanced > Database to migrate safely");
    }
    await migrateSQLiteToPostgres(DB_PATH, databaseConfig.url);
  }
  await applyDatabaseMigrations(database);
  await database.exec("CREATE TABLE IF NOT EXISTS download_settings (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))");
  await ensureChannelPostsPostgresSchema();
  // Social was added after the first PostgreSQL migration path shipped. Keep
  // existing PostgreSQL installations additive and equivalent to the
  // canonical SQLite bootstrap without requiring a destructive remigration.
  await database.exec(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      author_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE RESTRICT,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_social_posts_author ON social_posts(author_user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS social_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      author_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE INDEX IF NOT EXISTS idx_social_comments_post ON social_comments(post_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_social_comments_author ON social_comments(author_user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS social_reactions (
      post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      PRIMARY KEY (post_id, user_id, reaction_key)
    );
    CREATE INDEX IF NOT EXISTS idx_social_reactions_post ON social_reactions(post_id, reaction_key);
    CREATE TABLE IF NOT EXISTS social_recent_emojis (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction_key TEXT NOT NULL,
      used_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, reaction_key)
    );
    CREATE INDEX IF NOT EXISTS idx_social_recent_emojis_user ON social_recent_emojis(user_id, used_at DESC);
    CREATE TABLE IF NOT EXISTS social_comment_likes (
      comment_id TEXT NOT NULL REFERENCES social_comments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      PRIMARY KEY (comment_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS social_post_mentions (
      post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      mentioned_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      PRIMARY KEY (post_id, mentioned_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_social_post_mentions_user ON social_post_mentions(mentioned_user_id, post_id);
    CREATE TABLE IF NOT EXISTS social_comment_mentions (
      comment_id TEXT NOT NULL REFERENCES social_comments(id) ON DELETE CASCADE,
      mentioned_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      PRIMARY KEY (comment_id, mentioned_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_social_comment_mentions_user ON social_comment_mentions(mentioned_user_id, comment_id);
  `);
  runtimeSettingsReady = true;
  await reloadSettingCache();
} else {
  await applyDatabaseMigrations(database);
  runtimeSettingsReady = true;
}
