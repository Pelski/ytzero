import { database } from "./database";
import { getSetting, GLOBAL_SETTING_KEYS, reloadSettingCache, SETTING_DEFAULTS, USER_SETTING_KEYS } from "./db";
import { PLUGINS, PLUGIN_BACKUP_ADAPTERS, setPluginEnabled } from "./plugins";
import { VERSION } from "./version";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { BACKUP_LIMITS, createZip, readPortableZip, safePath, stableNegativeId, validAvatar, type ArchiveEntry } from "./portableArchive";
export { BACKUP_LIMITS, createZip, readPortableZip } from "./portableArchive";
import { acquireMaintenance } from "./maintenance";
import { isChannelManualStatus } from "./channelStatus";
import { parseAdminOnlyAreas, serializeAdminOnlyAreas } from "./profilePermissions";
import { configuredTimeZone, DEFAULT_TIME_ZONE, isValidTimeZone } from "./timeZone";
import { computeShowFrom, SCHEDULE_BUCKETS } from "./scheduleTime";
import { parseManualRefreshSchedule } from "./channelRefreshSchedule";
import { listDownloadRules } from "./downloadRules";
import { normalizeSocialReaction } from "./social";
import { optimizeProfileAvatar, optimizedProfileAvatarToken, removeStoredProfileAvatar } from "./profileAvatars";
import { DOWNLOAD_INSTANCE_BACKUP_SCHEMA_VERSION, DOWNLOAD_PROFILE_BACKUP_SCHEMA_VERSION, exportDownloadInstanceSettings, exportDownloadPreferences, restoreDownloadInstanceSettings, restoreDownloadPreferences } from "./downloadBackup";
import { normalizeVideoCardSetting } from "./videoCardActions";
import { normalizeKeyboardShortcutSetting } from "./keyboardShortcutSettings";
import { exportPlaybackContext, restorePlaybackContext } from "./playbackContextBackup";
export const BACKUP_FORMAT = "ytzero.portable-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_TTL_MS = 30 * 60_000;
const SESSION_DIR = process.env.RESTORE_SESSION_DIR ?? resolve(import.meta.dir, "../../data/restore-sessions");
const AVATAR_DIR = process.env.AVATAR_DIR ?? resolve(import.meta.dir, "../../data/avatars");
const DB_PATH = process.env.DB_PATH ?? resolve(import.meta.dir, "../../data/db/ytzero.db");
mkdirSync(SESSION_DIR, { recursive: true });
export type BackupScope = "instance" | "profile"; export type BackupSensitivity = "normal" | "personal" | "secret";
export interface BackupSectionDefinition {
  id: string;
  schemaVersion: number;
  scope: BackupScope;
  sensitivity: BackupSensitivity;
  dependencies: string[];
  category: string;
  optional?: boolean;
  path(profileUuid?: string): string;
}
const profilePath = (name: string) => (uuid = "") => `profiles/${uuid}/${name}`;
export const BACKUP_SECTIONS: readonly BackupSectionDefinition[] = [
  { id: "instance.settings", schemaVersion: 1, scope: "instance", sensitivity: "normal", dependencies: [], category: "configuration", path: () => "instance/settings.json" },
  { id: "instance.plugins", schemaVersion: 1, scope: "instance", sensitivity: "normal", dependencies: [], category: "configuration", path: () => "instance/plugins.jsonl" },
  { id: "instance.downloads", schemaVersion: DOWNLOAD_INSTANCE_BACKUP_SCHEMA_VERSION, scope: "instance", sensitivity: "normal", dependencies: [], category: "configuration", path: () => "instance/downloads.json" },
  { id: "instance.channels", schemaVersion: 4, scope: "instance", sensitivity: "normal", dependencies: [], category: "organization", path: () => "instance/channels.jsonl" },
  { id: "profiles.index", schemaVersion: 1, scope: "instance", sensitivity: "normal", dependencies: [], category: "profiles", path: () => "profiles/index.json" },
  { id: "profile.avatar", schemaVersion: 1, scope: "profile", sensitivity: "normal", dependencies: ["profiles.index"], category: "profiles", optional: true, path: (uuid = "") => `assets/avatars/${uuid}` },
  { id: "profile.settings", schemaVersion: 5, scope: "profile", sensitivity: "normal", dependencies: ["profiles.index"], category: "configuration", path: profilePath("settings.json") },
  { id: "profile.downloads", schemaVersion: DOWNLOAD_PROFILE_BACKUP_SCHEMA_VERSION, scope: "profile", sensitivity: "normal", dependencies: ["profiles.index", "instance.channels"], category: "configuration", path: profilePath("downloads.json") },
  { id: "profile.subscriptions", schemaVersion: 2, scope: "profile", sensitivity: "normal", dependencies: ["profiles.index", "instance.channels"], category: "organization", path: profilePath("subscriptions.jsonl") },
  { id: "profile.followed-playlists", schemaVersion: 1, scope: "profile", sensitivity: "normal", dependencies: ["profiles.index", "instance.channels"], category: "organization", path: profilePath("followed-playlists.jsonl") },
  { id: "profile.tags", schemaVersion: 1, scope: "profile", sensitivity: "normal", dependencies: ["profiles.index", "library.referenced-videos"], category: "organization", path: profilePath("tags.jsonl") },
  { id: "profile.rules", schemaVersion: 1, scope: "profile", sensitivity: "normal", dependencies: ["profiles.index", "profile.tags"], category: "organization", path: profilePath("rules.jsonl") },
  { id: "profile.playlists", schemaVersion: 2, scope: "profile", sensitivity: "normal", dependencies: ["profiles.index", "library.referenced-videos"], category: "organization", path: profilePath("playlists.jsonl") },
  { id: "profile.video-state", schemaVersion: 2, scope: "profile", sensitivity: "personal", dependencies: ["profiles.index", "profile.tags", "profile.playlists", "library.referenced-videos"], category: "personal", path: profilePath("video-state.jsonl") },
  { id: "profile.history", schemaVersion: 1, scope: "profile", sensitivity: "personal", dependencies: ["profiles.index", "library.referenced-videos"], category: "personal", path: profilePath("history.jsonl") },
  { id: "profile.discovery-feedback", schemaVersion: 1, scope: "profile", sensitivity: "personal", dependencies: ["profiles.index", "library.referenced-videos"], category: "discovery", optional: true, path: profilePath("analytics/discovery-feedback.jsonl") },
  { id: "profile.analytics", schemaVersion: 1, scope: "profile", sensitivity: "personal", dependencies: ["profiles.index", "library.referenced-videos"], category: "analytics", optional: true, path: profilePath("analytics/events.jsonl") },
  { id: "plugin.social.activity", schemaVersion: 1, scope: "instance", sensitivity: "personal", dependencies: ["profiles.index", "library.referenced-videos"], category: "social", optional: true, path: () => "plugins/social/activity.json" },
  { id: "library.referenced-videos", schemaVersion: 1, scope: "instance", sensitivity: "personal", dependencies: ["instance.channels"], category: "dependency", path: () => "library/referenced-videos.jsonl" },
] as const;
export const BACKUP_PRESETS: Record<string, string[]> = {
  configuration: ["instance.settings", "instance.plugins", "instance.downloads", "profile.settings", "profile.downloads"],
  setup: ["instance.settings", "instance.plugins", "instance.downloads", "profiles.index", "profile.avatar", "profile.settings", "profile.downloads", "profile.subscriptions", "profile.followed-playlists", "profile.tags", "profile.rules", "profile.playlists", "instance.channels", "library.referenced-videos"],
  full: BACKUP_SECTIONS.filter((section) => section.sensitivity !== "secret").map((section) => section.id),
};
const SECTION_BY_ID = new Map(BACKUP_SECTIONS.map((section) => [section.id, section]));
const SAFE_GLOBAL_SETTINGS = new Set(["app_name", "app_icon_color", "profile_admin_only_areas", "timezone"]);
const SECRET_SETTING_KEYS = new Set([...GLOBAL_SETTING_KEYS].filter((key) => key.startsWith("auth_") || key.includes("hash") || key.includes("secret")));
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function portableGlobalSettingValue(key: string, value: unknown): string {
  if (key === "profile_admin_only_areas") return serializeAdminOnlyAreas(parseAdminOnlyAreas(String(value)));
  if (key === "timezone") return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
  return String(value);
}
function portableUserSettingValue(key: string, value: unknown): string {
  if (key === "keyboard_shortcuts") return normalizeKeyboardShortcutSetting(value) ?? SETTING_DEFAULTS.keyboard_shortcuts; if (key.startsWith("video_card_")) return normalizeVideoCardSetting(key, value);
  if (key === "show_shorts") return value === "1" || value === "selected" ? value : "0";
  return String(value);
}
export interface BackupManifestSection {
  id: string;
  schemaVersion: number;
  profileId?: string;
  path: string;
  records: number;
  bytes: number;
  sha256: string;
  optional?: boolean;
}
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  sourceInstallationId: string;
  exportPreset: string;
  profiles: { id: string; name: string; isChild: boolean }[];
  sections: BackupManifestSection[];
}

function json(value: unknown): Uint8Array { return encoder.encode(`${JSON.stringify(value, null, 2)}\n`); }
function jsonl(values: unknown[]): Uint8Array { return encoder.encode(values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
async function sha256(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", input))].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function selectedWithDependencies(ids: string[]): Set<string> {
  const selected = new Set(ids.filter((id) => SECTION_BY_ID.has(id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...selected]) for (const dep of SECTION_BY_ID.get(id)?.dependencies ?? []) if (!selected.has(dep)) { selected.add(dep); changed = true; }
  }
  return selected;
}

async function portableProfiles(requested: string[]) {
  const rows = await database.prepare("SELECT id, portable_uuid, name, avatar, avatar_color, sort_order, is_child FROM users ORDER BY sort_order, id").all() as any[];
  const requestedSet = new Set(requested);
  return rows.filter((row) => requestedSet.size === 0 || requestedSet.has(row.portable_uuid));
}

async function referencedVideoIds(userIds: number[], selected: Set<string>): Promise<Set<string>> {
  const ids = new Set<string>();
  const add = async (sql: string, uid: number) => { for (const row of await database.prepare(sql).all(uid) as { video_id: string }[]) ids.add(row.video_id); };
  for (const uid of userIds) {
    if (selected.has("profile.tags")) await add("SELECT vt.video_id FROM video_tags vt JOIN tags t ON t.id=vt.tag_id WHERE t.user_id=? AND vt.source='manual'", uid);
    if (selected.has("profile.playlists")) await add("SELECT pv.video_id FROM user_playlist_videos pv JOIN user_playlists p ON p.id=pv.playlist_id WHERE p.user_id=?", uid);
    if (selected.has("profile.video-state")) await add("SELECT video_id FROM user_videos WHERE user_id=?", uid);
    if (selected.has("profile.history")) await add("SELECT video_id FROM history WHERE user_id=?", uid);
    if (selected.has("profile.discovery-feedback")) await add("SELECT video_id FROM recommendation_feedback WHERE user_id=?", uid);
    if (selected.has("plugin.social.activity")) await add("SELECT video_id FROM social_posts WHERE author_user_id=?", uid);
    if (selected.has("profile.analytics")) {
      for (const table of ["watch_time_log", "scheduling_event_log", "sponsorblock_skip_log"]) await add(`SELECT video_id FROM ${table} WHERE user_id=?`, uid);
    }
  }
  return ids;
}

async function sectionData(id: string, profile: any | null, referenced: Set<string>, exportProfiles: any[] = []): Promise<unknown | unknown[]> {
  const uid = profile?.id;
  switch (id) {
    case "instance.settings": {
      const settings: Record<string, string> = {};
      for (const row of await database.prepare("SELECT key, value FROM settings").all() as any[]) if (SAFE_GLOBAL_SETTINGS.has(row.key)) settings[row.key] = portableGlobalSettingValue(row.key, row.value);
      return { settings };
    }
    case "instance.plugins": return Promise.all(PLUGINS.map(async (plugin) => {
      const adapter = PLUGIN_BACKUP_ADAPTERS.find((item) => item.id === plugin.id && item.scope === "instance");
      return { id: plugin.id, enabled: Boolean((await database.prepare("SELECT enabled FROM plugins WHERE id=?").get(plugin.id) as any)?.enabled), payload: adapter ? await adapter.export(uid ?? 0) : undefined, schemaVersion: adapter?.schemaVersion };
    }));
    case "instance.downloads": return await exportDownloadInstanceSettings();
    case "profiles.index": return (await portableProfiles([])).filter((row) => !profile || row.id === uid).map((row) => ({ id: row.portable_uuid, name: row.name, color: row.avatar_color, order: row.sort_order, isChild: Boolean(row.is_child), avatar: row.avatar ? `assets/avatars/${row.portable_uuid}.${basename(row.avatar.split(":")[0]).split(".").pop()}` : null }));
    case "instance.channels": {
      const channelIds = new Set<string>();
      for (const row of await database.prepare("SELECT channel_id FROM user_channels").all() as any[]) channelIds.add(row.channel_id);
      for (const row of await database.prepare("SELECT channel_id FROM channel_playlists").all() as any[]) channelIds.add(row.channel_id);
      for (const rule of await listDownloadRules()) {
        for (const channelId of rule.channel_ids) channelIds.add(channelId);
      }
      if (referenced.size) {
        const ph = [...referenced].map(() => "?").join(",");
        for (const row of await database.prepare(`SELECT DISTINCT channel_id FROM videos WHERE video_id IN (${ph})`).all(...referenced) as any[]) channelIds.add(row.channel_id);
      }
      return (await Promise.all([...channelIds].map((channelId) => database.prepare("SELECT channel_id, title, url, thumbnail, custom_title, auto_download_min_duration_override, manual_status, refresh_schedule_days, refresh_schedule_time FROM channels WHERE channel_id=?").get(channelId)))).filter(Boolean);
    }
    case "library.referenced-videos": return (await Promise.all([...referenced].map((videoId) => database.prepare("SELECT video_id, channel_id, title, description, thumbnail, published_at, live_status, duration, external FROM videos WHERE video_id=?").get(videoId)))).filter(Boolean);
    case "profile.settings": {
      const settings: Record<string, string> = {};
      for (const row of await database.prepare("SELECT key, value FROM user_settings WHERE user_id=?").all(uid) as any[]) if (USER_SETTING_KEYS.includes(row.key)) settings[row.key] = row.value;
      const plugins: Record<string, unknown> = {};
      for (const adapter of PLUGIN_BACKUP_ADAPTERS.filter((item) => item.scope === "profile")) plugins[adapter.id] = { schemaVersion: adapter.schemaVersion, payload: await adapter.export(uid) };
      return { settings, plugins };
    }
    case "profile.downloads": return await exportDownloadPreferences(uid);
    case "profile.subscriptions": return await database.prepare(`SELECT uc.channel_id, uc.followed, uc.playback_speed, uc.caption_mode, uc.caption_language, uc.hide_members_only_from_feed, uc.hide_members_only_on_channel, uc.members_only_visibility, uc.shorts_feed_visibility, uc.added_at FROM user_channels uc WHERE uc.user_id=?`).all(uid);
    case "profile.followed-playlists": return await database.prepare(`SELECT fp.playlist_id, fp.followed_at, fp.feed_from, fp.include_in_feed, cp.channel_id, cp.title, cp.thumbnail, cp.video_count FROM user_followed_playlists fp JOIN channel_playlists cp ON cp.playlist_id=fp.playlist_id WHERE fp.user_id=?`).all(uid);
    case "profile.tags": return Promise.all((await database.prepare("SELECT id, portable_uuid, name, color, filter_only FROM tags WHERE user_id=?").all(uid) as any[]).map(async (tag) => ({ uuid: tag.portable_uuid, name: tag.name, color: tag.color, filterOnly: Boolean(tag.filter_only), channels: (await database.prepare("SELECT channel_id FROM channel_tags WHERE tag_id=?").all(tag.id) as any[]).map((r) => r.channel_id), videos: (await database.prepare("SELECT video_id FROM video_tags WHERE tag_id=? AND source='manual'").all(tag.id) as any[]).map((r) => r.video_id) })));
    case "profile.rules": return [
      ...(await database.prepare("SELECT r.pattern, r.match_type, r.field, t.portable_uuid AS tag_uuid FROM auto_tag_rules r JOIN tags t ON t.id=r.tag_id WHERE r.user_id=?").all(uid) as any[]).map((r) => ({ type: "auto-tag", ...r })),
      ...(await database.prepare("SELECT pattern, match_type, field, action, channel_id FROM filter_rules WHERE user_id=?").all(uid) as any[]).map((r) => ({ type: "filter", ...r })),
    ];
    case "profile.playlists": return Promise.all((await database.prepare("SELECT id, portable_uuid, name, icon, sort_order, created_at FROM user_playlists WHERE user_id=?").all(uid) as any[]).map(async (playlist) => ({ uuid: playlist.portable_uuid, name: playlist.name, icon: playlist.icon, order: playlist.sort_order, createdAt: playlist.created_at, videos: (await database.prepare("SELECT video_id, added_at, position FROM user_playlist_videos WHERE playlist_id=? ORDER BY position, video_id").all(playlist.id) as any[]), rules: await database.prepare("SELECT pattern, match_type, field FROM user_playlist_rules WHERE playlist_id=?").all(playlist.id) })));
    case "profile.video-state": return Promise.all((await database.prepare("SELECT video_id, status, bucket, queued_at, show_from, watch_position, watch_duration, watched, liked, playback_context_json FROM user_videos WHERE user_id=?").all(uid) as any[]).map(async ({ playback_context_json, ...row }) => ({ ...row, playbackContext: await exportPlaybackContext(uid, playback_context_json) })));
    case "profile.history": return await database.prepare("SELECT video_id, watched_at FROM history WHERE user_id=? ORDER BY watched_at").all(uid);
    case "profile.discovery-feedback": return await database.prepare("SELECT video_id, action, created_at FROM recommendation_feedback WHERE user_id=?").all(uid);
    case "profile.analytics": return [
      ...(await database.prepare("SELECT video_id, day, hour, seconds FROM watch_time_log WHERE user_id=?").all(uid) as any[]).map((r) => ({ type: "watch-time", ...r })),
      ...(await database.prepare("SELECT video_id, channel_id, bucket, source, tags_json, local_day, local_hour, created_at FROM scheduling_event_log WHERE user_id=?").all(uid) as any[]).map((r) => ({ type: "scheduling", ...r })),
      ...(await database.prepare("SELECT tag_name, tag_color, day, hour, seconds FROM watch_tag_time_log WHERE user_id=?").all(uid) as any[]).map((r) => ({ type: "tag-time", ...r })),
      ...(await database.prepare("SELECT event_id, video_id, segment_uuid, category, skipped_seconds, day, created_at FROM sponsorblock_skip_log WHERE user_id=?").all(uid) as any[]).map((r) => ({ type: "sponsorblock", ...r })),
    ];
    case "plugin.social.activity": {
      const userIds = exportProfiles.map((item) => item.id as number);
      if (!userIds.length) return { posts: [], comments: [], reactions: [], commentLikes: [], postMentions: [], commentMentions: [] };
      const userPlaceholders = userIds.map(() => "?").join(",");
      const posts = await database.prepare(`SELECT sp.id,sp.video_id,sp.body,sp.created_at,sp.updated_at,u.portable_uuid AS authorProfileId FROM social_posts sp JOIN users u ON u.id=sp.author_user_id WHERE sp.author_user_id IN (${userPlaceholders})`).all(...userIds) as any[];
      const postIds = posts.map((item) => item.id as string);
      if (!postIds.length) return { posts, comments: [], reactions: [], commentLikes: [], postMentions: [], commentMentions: [] };
      const postPlaceholders = postIds.map(() => "?").join(",");
      const comments = await database.prepare(`SELECT sc.id,sc.post_id,sc.body,sc.created_at,sc.updated_at,u.portable_uuid AS authorProfileId FROM social_comments sc JOIN users u ON u.id=sc.author_user_id WHERE sc.post_id IN (${postPlaceholders}) AND sc.author_user_id IN (${userPlaceholders})`).all(...postIds, ...userIds) as any[];
      const reactions = await database.prepare(`SELECT sr.post_id,sr.reaction_key,sr.created_at,u.portable_uuid AS profileId FROM social_reactions sr JOIN users u ON u.id=sr.user_id WHERE sr.post_id IN (${postPlaceholders}) AND sr.user_id IN (${userPlaceholders})`).all(...postIds, ...userIds) as any[];
      const postMentions = await database.prepare(`SELECT sm.post_id,sm.token,u.portable_uuid AS mentionedProfileId FROM social_post_mentions sm JOIN users u ON u.id=sm.mentioned_user_id WHERE sm.post_id IN (${postPlaceholders}) AND sm.mentioned_user_id IN (${userPlaceholders})`).all(...postIds, ...userIds) as any[];
      const commentIds = comments.map((item) => item.id as string);
      if (!commentIds.length) return { posts, comments, reactions, commentLikes: [], postMentions, commentMentions: [] };
      const commentPlaceholders = commentIds.map(() => "?").join(",");
      const commentLikes = await database.prepare(`SELECT sl.comment_id,sl.created_at,u.portable_uuid AS profileId FROM social_comment_likes sl JOIN users u ON u.id=sl.user_id WHERE sl.comment_id IN (${commentPlaceholders}) AND sl.user_id IN (${userPlaceholders})`).all(...commentIds, ...userIds) as any[];
      const commentMentions = await database.prepare(`SELECT sm.comment_id,sm.token,u.portable_uuid AS mentionedProfileId FROM social_comment_mentions sm JOIN users u ON u.id=sm.mentioned_user_id WHERE sm.comment_id IN (${commentPlaceholders}) AND sm.mentioned_user_id IN (${userPlaceholders})`).all(...commentIds, ...userIds) as any[];
      return { posts, comments, reactions, commentLikes, postMentions, commentMentions };
    }
    default: throw new Error(`unsupported section ${id}`);
  }
}

export async function backupOptions() {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    presets: BACKUP_PRESETS,
    sections: BACKUP_SECTIONS.map(({ path: _path, ...section }) => section),
    profiles: (await portableProfiles([])).map((row) => ({ id: row.portable_uuid, name: row.name, isChild: Boolean(row.is_child) })),
    exclusions: ["authentication and passwords", "passkeys and sessions", "download cookies, paths and media", "network-derived caches"],
  };
}

export async function createPortableBackup(input: { preset?: string; profiles?: string[]; sections?: string[] }): Promise<Uint8Array> {
  const preset = input.preset && BACKUP_PRESETS[input.preset] ? input.preset : "custom";
  const selected = selectedWithDependencies(input.sections?.length ? input.sections : BACKUP_PRESETS[preset] ?? BACKUP_PRESETS.setup);
  const profiles = await portableProfiles(input.profiles ?? []);
  if (!profiles.length) throw new Error("select at least one profile");
  const referenced = await referencedVideoIds(profiles.map((row) => row.id), selected);
  const entries: ArchiveEntry[] = [];
  const manifestSections: BackupManifestSection[] = [];
  for (const definition of BACKUP_SECTIONS) {
    if (!selected.has(definition.id)) continue;
    if (definition.id === "profile.avatar") continue;
    const targets = definition.scope === "profile" ? profiles : [null];
    for (const profile of targets) {
      let value = await sectionData(definition.id, profile, referenced, profiles);
      if (definition.id === "profiles.index") value = profiles.map((row) => ({ id: row.portable_uuid, name: row.name, color: row.avatar_color, order: row.sort_order, isChild: Boolean(row.is_child), avatar: row.avatar ? `assets/avatars/${row.portable_uuid}.${basename(row.avatar.split(":")[0]).split(".").pop()}` : null }));
      const values = Array.isArray(value) ? value : null;
      const bytes = definition.path(profile?.portable_uuid).endsWith(".jsonl") ? jsonl(values ?? [value]) : json(value);
      const path = definition.path(profile?.portable_uuid);
      entries.push({ name: path, bytes });
      manifestSections.push({ id: definition.id, schemaVersion: definition.schemaVersion, ...(profile ? { profileId: profile.portable_uuid } : {}), path, records: values?.length ?? 1, bytes: bytes.length, sha256: await sha256(bytes), ...(definition.optional ? { optional: true } : {}) });
    }
  }
  for (const profile of profiles) {
    if (!selected.has("profiles.index") || !profile.avatar) continue;
    const source = resolve(AVATAR_DIR, basename(profile.avatar.split(":")[0]));
    if (!existsSync(source)) continue;
    const ext = basename(source).split(".").pop() || "jpg";
    const bytes = new Uint8Array(readFileSync(source));
    if (bytes.length <= 5 * 1024 * 1024 && validAvatar(bytes, ext)) {
      const path = `assets/avatars/${profile.portable_uuid}.${ext}`;
      entries.push({ name: path, bytes });
      manifestSections.push({ id: "profile.avatar", schemaVersion: 1, profileId: profile.portable_uuid, path, records: 1, bytes: bytes.length, sha256: await sha256(bytes), optional: true });
    }
  }
  const manifest: BackupManifest = { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, createdAt: new Date().toISOString(), appVersion: VERSION, sourceInstallationId: getSetting("installation_id")!, exportPreset: preset, profiles: profiles.map((row) => ({ id: row.portable_uuid, name: row.name, isChild: Boolean(row.is_child) })), sections: manifestSections };
  return createZip([{ name: "manifest.json", bytes: json(manifest) }, ...entries]);
}

function parseJson(bytes: Uint8Array, name: string): any { try { return JSON.parse(decoder.decode(bytes)); } catch { throw new Error(`malformed JSON: ${name}`); } }
function parseJsonl(bytes: Uint8Array, name: string): any[] {
  const lines = decoder.decode(bytes).split("\n"); const records: any[] = [];
  for (let i = 0; i < lines.length; i++) { if (!lines[i].trim()) continue; if (records.length >= BACKUP_LIMITS.records) throw new Error("archive has too many records"); try { records.push(JSON.parse(lines[i])); } catch { throw new Error(`malformed JSONL: ${name}:${i + 1}`); } }
  return records;
}

function sessionPaths(id: string) { const dir = resolve(SESSION_DIR, id); return { dir, archive: resolve(dir, "archive.zip"), state: resolve(dir, "session.json") }; }
function sweepSessions() { if (!existsSync(SESSION_DIR)) return; for (const name of readdirSync(SESSION_DIR)) { const p = resolve(SESSION_DIR, name); try { if (Date.now() - statSync(p).mtimeMs > BACKUP_TTL_MS) rmSync(p, { recursive: true, force: true }); } catch {} } }
interface RestoreSessionState { id: string; adminId: number; createdAt: number; manifest: BackupManifest; warnings: string[]; planRevision: number; plan?: RestorePlan }
function loadSession(id: string, adminId: number): RestoreSessionState { safePath(id); const paths = sessionPaths(id); if (!existsSync(paths.state)) throw new Error("restore session expired"); const state = JSON.parse(readFileSync(paths.state, "utf8")) as RestoreSessionState; if (state.adminId !== adminId || Date.now() - state.createdAt > BACKUP_TTL_MS) throw new Error("restore session expired"); return state; }
function saveSession(state: RestoreSessionState) { writeFileSync(sessionPaths(state.id).state, JSON.stringify(state)); }

function validateManifest(entries: Map<string, Uint8Array>): BackupManifest {
  const manifest = parseJson(entries.get("manifest.json")!, "manifest.json") as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT) throw new Error("not a YT Zero portable backup");
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > BACKUP_FORMAT_VERSION) throw new Error("backup format is newer than this YT Zero version");
  if (!Array.isArray(manifest.sections) || !Array.isArray(manifest.profiles)) throw new Error("invalid backup manifest");
  if (!manifest.profiles.every((profile) => UUID.test(profile.id) && typeof profile.name === "string")) throw new Error("invalid profile identity in manifest");
  const declared = new Set(["manifest.json"]);
  for (const section of manifest.sections) { safePath(section.path); if (declared.has(section.path)) throw new Error(`duplicate manifest path: ${section.path}`); declared.add(section.path); const definition = SECTION_BY_ID.get(section.id); if (definition && section.id !== "profile.avatar" && section.path !== definition.path(section.profileId)) throw new Error(`unexpected path for ${section.id}`); if (section.id === "profile.avatar" && !new RegExp(`^assets/avatars/${section.profileId}\\.(png|jpe?g|webp)$`, "i").test(section.path)) throw new Error("unexpected avatar path"); if (!entries.has(section.path)) throw new Error(`missing section: ${section.path}`); }
  const sectionIds = new Set(manifest.sections.map((section) => section.id));
  for (const section of manifest.sections) {
    const definition = SECTION_BY_ID.get(section.id);
    if (definition) for (const dependency of definition.dependencies) if (!sectionIds.has(dependency)) throw new Error(`missing dependency ${dependency} for ${section.id}`);
  }
  for (const name of entries.keys()) if (!declared.has(name)) throw new Error(`unexpected archive entry: ${name}`);
  return manifest;
}

export async function analyzePortableBackup(adminId: number, bytes: Uint8Array) {
  sweepSessions(); const started = Date.now(); const entries = readPortableZip(bytes); const manifest = validateManifest(entries); const warnings: string[] = [];
  let records = 0;
  for (const section of manifest.sections) {
    const content = entries.get(section.path)!; if (content.length !== section.bytes || await sha256(content) !== section.sha256) throw new Error(`checksum mismatch: ${section.path}`);
    const definition = SECTION_BY_ID.get(section.id);
    if (!definition) { if (section.optional) { warnings.push(`Unknown optional section ${section.id} will be skipped`); continue; } else throw new Error(`unsupported required section: ${section.id}`); }
    else if (section.schemaVersion > definition.schemaVersion) { if (section.optional) { warnings.push(`Newer optional section ${section.id} will be skipped`); continue; } else throw new Error(`section ${section.id} is newer than supported`); }
    if (section.id === "profile.avatar") { const ext=section.path.split(".").pop()!; if (!validAvatar(content,ext)) throw new Error(`invalid avatar image: ${section.path}`); records++; continue; }
    const value = section.path.endsWith(".jsonl") ? parseJsonl(content, section.path) : parseJson(content, section.path); records += Array.isArray(value) ? value.length : 1;
    if (records > BACKUP_LIMITS.records) throw new Error("archive has too many records"); if (Date.now() - started > 20_000) throw new Error("archive parse time limit exceeded");
  }
  const id = crypto.randomUUID(), paths = sessionPaths(id); mkdirSync(paths.dir, { recursive: true }); writeFileSync(paths.archive, bytes);
  const state: RestoreSessionState = { id, adminId, createdAt: Date.now(), manifest, warnings, planRevision: 0 }; saveSession(state);
  const existing = await database.prepare("SELECT id, portable_uuid, name FROM users ORDER BY sort_order, id").all();
  return { sessionId: id, expiresAt: new Date(Date.now() + BACKUP_TTL_MS).toISOString(), manifest, archiveBytes: bytes.length, integrity: "verified", sameSource: manifest.sourceInstallationId === getSetting("installation_id"), warnings, existingProfiles: existing, exclusions: (await backupOptions()).exclusions };
}

export interface RestorePlan { mappings: Record<string, { action: "create" | "merge" | "skip"; targetProfileId?: number }>; sections: string[]; strategy: "merge" | "replace" }
function decodedSections(state: RestoreSessionState) { const entries = readPortableZip(new Uint8Array(readFileSync(sessionPaths(state.id).archive))); const data = new Map<string, any>(); for (const section of state.manifest.sections) { if (!SECTION_BY_ID.has(section.id) || section.id === "profile.avatar") continue; const bytes = entries.get(section.path)!; data.set(`${section.id}:${section.profileId ?? ""}`, section.path.endsWith(".jsonl") ? parseJsonl(bytes, section.path) : parseJson(bytes, section.path)); } return { entries, data }; }
export async function planPortableRestore(adminId: number, id: string, plan: RestorePlan) {
  const state = loadSession(id, adminId); const available = new Set(state.manifest.sections.map((section) => section.id)); const selected = selectedWithDependencies(plan.sections).intersection(available);
  for (const profile of state.manifest.profiles) { const mapping = plan.mappings[profile.id]; if (!mapping || !["create", "merge", "skip"].includes(mapping.action)) throw new Error(`mapping required for ${profile.name}`); if (mapping.action === "merge" && (!mapping.targetProfileId || !await database.prepare("SELECT 1 FROM users WHERE id=?").get(mapping.targetProfileId))) throw new Error(`target profile not found for ${profile.name}`); }
  const normalized: RestorePlan = { mappings: plan.mappings, sections: [...selected], strategy: plan.strategy === "replace" ? "replace" : "merge" }; state.plan = normalized; state.planRevision++; saveSession(state);
  const changes = { createProfiles: 0, mergeProfiles: 0, skipProfiles: 0, records: 0, sections: normalized.sections.length, strategy: normalized.strategy };
  for (const profile of state.manifest.profiles) { const action = normalized.mappings[profile.id].action; if (action === "create") changes.createProfiles++; else if (action === "merge") changes.mergeProfiles++; else changes.skipProfiles++; }
  for (const section of state.manifest.sections) if (normalized.sections.includes(section.id) && (!section.profileId || normalized.mappings[section.profileId]?.action !== "skip")) changes.records += section.records;
  return { sessionId: id, planRevision: state.planRevision, changes, warnings: state.warnings };
}

async function ensureChannel(row: any) { if (!row?.channel_id || typeof row.channel_id !== "string") return; await database.prepare("INSERT INTO channels (channel_id,title,url,thumbnail,external) VALUES (?,?,?,?,1) ON CONFLICT(channel_id) DO UPDATE SET title=CASE WHEN channels.title='' THEN excluded.title ELSE channels.title END, thumbnail=CASE WHEN channels.thumbnail='' THEN excluded.thumbnail ELSE channels.thumbnail END").run(row.channel_id, String(row.title ?? ""), String(row.url ?? ""), String(row.thumbnail ?? "")); }
async function ensureVideo(row: any) { if (!row?.video_id || !row?.channel_id) return; await ensureChannel({ channel_id: row.channel_id }); await database.prepare("INSERT INTO videos (video_id,channel_id,title,description,thumbnail,published_at,live_status,duration,external) VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(video_id) DO UPDATE SET title=CASE WHEN videos.title='' THEN excluded.title ELSE videos.title END").run(row.video_id, row.channel_id, String(row.title ?? ""), String(row.description ?? ""), String(row.thumbnail ?? ""), row.published_at ?? null, row.live_status ?? "none", row.duration ?? null); }
async function mappedObject(sourceInstallationId: string, type: string, uuid: string): Promise<number | null> { return (await database.prepare("SELECT local_id FROM portable_object_mappings WHERE source_installation_id=? AND object_type=? AND source_uuid=?").get(sourceInstallationId, type, uuid) as any)?.local_id ?? null; }
async function saveMapping(sourceInstallationId: string, type: string, uuid: string, id: number) { await database.prepare("INSERT INTO portable_object_mappings(source_installation_id,object_type,source_uuid,local_id) VALUES(?,?,?,?) ON CONFLICT(source_installation_id,object_type,source_uuid) DO UPDATE SET local_id=excluded.local_id").run(sourceInstallationId, type, uuid, id); }

export async function commitPortableRestore(adminId: number, id: string, revision: number) {
  const state = loadSession(id, adminId); if (!state.plan || state.planRevision !== revision) throw new Error("restore plan changed; review it again"); const releaseMaintenance = await acquireMaintenance("portable restore");
  const safetyDir = resolve(dirname(DB_PATH), "backups"); mkdirSync(safetyDir, { recursive: true }); const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const snapshot = database.engine === "sqlite" ? resolve(safetyDir, `pre-restore-${stamp}.db`) : "postgresql-transaction"; const avatarStages: { from: string; to: string; previous: string; nextFileName: string }[] = [];
  try {
    if (database.engine === "sqlite") { await database.exec("PRAGMA wal_checkpoint(FULL)"); copyFileSync(DB_PATH, snapshot); }
    const { entries, data } = decodedSections(state), selected = new Set(state.plan.sections), counts = { created: 0, updated: 0, skipped: 0, warnings: [...state.warnings] as string[] }, profileIds = new Map<string, number>();
    const legacyDownloadsEnabled = (data.get("instance.plugins:") ?? []).find((row: any) => row?.id === "downloads")?.enabled;
    const tx = database.transaction(async () => {
      const profilesIndex = data.get("profiles.index:") ?? state.manifest.profiles;
      const needsProfiles = selected.has("profiles.index") || [...selected].some((sectionId) => SECTION_BY_ID.get(sectionId)?.scope === "profile");
      for (const source of needsProfiles ? profilesIndex : []) {
        const mapping = state.plan!.mappings[source.id]; if (!mapping || mapping.action === "skip") { counts.skipped++; continue; }
        let uid: number | null = mapping.action === "merge" ? mapping.targetProfileId! : await mappedObject(state.manifest.sourceInstallationId, "profile", source.id);
        if (!uid) uid = (await database.prepare("SELECT id FROM users WHERE portable_uuid=?").get(source.id) as any)?.id ?? null;
        if (!uid) { const order = (await database.prepare("SELECT COALESCE(MAX(sort_order),-1)+1 n FROM users").get() as any).n; uid = Number((await database.prepare("INSERT INTO users(name,avatar_color,sort_order,is_child,portable_uuid) VALUES(?,?,?,?,?) RETURNING id").run(String(source.name || "Restored profile"), String(source.color || "#7c5cff"), order, source.isChild ? 1 : 0, source.id)).lastInsertRowid); counts.created++; }
        else { await database.prepare("UPDATE users SET name=?, avatar_color=?, is_child=? WHERE id=?").run(String(source.name || "Restored profile"), String(source.color || "#7c5cff"), source.isChild ? 1 : 0, uid); counts.updated++; }
        await saveMapping(state.manifest.sourceInstallationId, "profile", source.id, uid); profileIds.set(source.id, uid);
      }
      if (selected.has("instance.settings")) { const doc = data.get("instance.settings:"); for (const [key, value] of Object.entries(doc?.settings ?? {})) if (SAFE_GLOBAL_SETTINGS.has(key) && !SECRET_SETTING_KEYS.has(key)) await database.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, portableGlobalSettingValue(key, value)); }
      if (selected.has("instance.downloads")) await restoreDownloadInstanceSettings(data.get("instance.downloads:"));
      if (selected.has("instance.channels")) for (const row of data.get("instance.channels:") ?? []) {
        await ensureChannel(row);
        await database.prepare("UPDATE channels SET custom_title=?, auto_download_min_duration_override=? WHERE channel_id=?")
          .run(row.custom_title ?? null, Number.isInteger(row.auto_download_min_duration_override) ? row.auto_download_min_duration_override : null, row.channel_id);
        if (Object.hasOwn(row, "refresh_schedule_days") || Object.hasOwn(row, "refresh_schedule_time")) {
          const schedule = parseManualRefreshSchedule(row.refresh_schedule_days, row.refresh_schedule_time);
          await database.prepare("UPDATE channels SET refresh_schedule_days=?, refresh_schedule_time=? WHERE channel_id=?")
            .run(schedule ? JSON.stringify(schedule.days) : null, schedule ? JSON.stringify(schedule.times) : null, row.channel_id);
        }
        if (isChannelManualStatus(row.manual_status)) await database.prepare("UPDATE channels SET manual_status=?, manual_status_updated_at=datetime('now') WHERE channel_id=?").run(row.manual_status,row.channel_id);
      }
      if (selected.has("library.referenced-videos")) for (const row of data.get("library.referenced-videos:") ?? []) await ensureVideo(row);
      if (selected.has("instance.plugins")) for (const row of data.get("instance.plugins:") ?? []) { if (row.id === "downloads") continue; if (!PLUGINS.some((p) => p.id === row.id)) { counts.warnings.push(`Plugin ${row.id} is unavailable`); continue; } await setPluginEnabled(row.id, Boolean(row.enabled), { activate: false }); const adapter=PLUGIN_BACKUP_ADAPTERS.find((item)=>item.id===row.id&&item.scope==="instance"); if(adapter&&row.payload) await adapter.restore(adminId,row.payload); }
      for (const profile of state.manifest.profiles) {
        const uid = profileIds.get(profile.id); if (!uid) continue; const get = (section: string) => data.get(`${section}:${profile.id}`);
        if (selected.has("profile.settings")) { const doc = get("profile.settings") ?? {}; if (state.plan!.strategy === "replace") await database.prepare(`DELETE FROM user_settings WHERE user_id=? AND key IN (${USER_SETTING_KEYS.map(() => "?").join(",")})`).run(uid, ...USER_SETTING_KEYS); for (const [key, value] of Object.entries(doc.settings ?? {})) if (USER_SETTING_KEYS.includes(key) && key in SETTING_DEFAULTS) await database.prepare("INSERT INTO user_settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run(uid, key, portableUserSettingValue(key, value)); for (const [pluginId, wrapped] of Object.entries(doc.plugins ?? {})) { if (pluginId === "downloads") { if (state.plan!.strategy === "replace") { await database.prepare("DELETE FROM download_settings WHERE user_id=?").run(uid); await database.prepare("DELETE FROM download_rules WHERE user_id=?").run(uid); } await restoreDownloadPreferences(uid,(wrapped as any)?.payload,typeof legacyDownloadsEnabled === "boolean" ? legacyDownloadsEnabled : undefined); continue; } const adapter=PLUGIN_BACKUP_ADAPTERS.find((item)=>item.id===pluginId&&item.scope==="profile"); if(adapter) await adapter.restore(uid,(wrapped as any)?.payload); else counts.warnings.push(`Plugin ${pluginId} is unavailable`); } }
        if (selected.has("profile.downloads")) { if (state.plan!.strategy === "replace") { await database.prepare("DELETE FROM download_settings WHERE user_id=?").run(uid); await database.prepare("DELETE FROM download_rules WHERE user_id=?").run(uid); } await restoreDownloadPreferences(uid,get("profile.downloads")); }
        if (selected.has("profile.subscriptions")) { if (state.plan!.strategy === "replace") await database.prepare("DELETE FROM user_channels WHERE user_id=?").run(uid); for (const row of get("profile.subscriptions") ?? []) { await ensureChannel({ channel_id: row.channel_id }); await database.prepare("INSERT INTO user_channels(user_id,channel_id,followed,playback_speed,caption_mode,caption_language,hide_members_only_from_feed,hide_members_only_on_channel,members_only_visibility,shorts_feed_visibility,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET followed=excluded.followed,playback_speed=excluded.playback_speed,caption_mode=excluded.caption_mode,caption_language=excluded.caption_language,hide_members_only_from_feed=excluded.hide_members_only_from_feed,hide_members_only_on_channel=excluded.hide_members_only_on_channel,members_only_visibility=excluded.members_only_visibility,shorts_feed_visibility=excluded.shorts_feed_visibility").run(uid,row.channel_id,row.followed?1:0,row.playback_speed??null,row.caption_mode??null,row.caption_language??null,row.hide_members_only_from_feed??null,row.hide_members_only_on_channel??null,row.members_only_visibility??"default",row.shorts_feed_visibility === "show" ? "show" : "default",row.added_at??new Date().toISOString()); if (row.followed) await database.prepare("UPDATE channels SET external=0 WHERE channel_id=?").run(row.channel_id); } }
        if (selected.has("profile.followed-playlists")) { if (state.plan!.strategy === "replace") await database.prepare("DELETE FROM user_followed_playlists WHERE user_id=?").run(uid); for (const row of get("profile.followed-playlists") ?? []) { await ensureChannel({ channel_id: row.channel_id }); await database.prepare("INSERT INTO channel_playlists(playlist_id,channel_id,title,thumbnail,video_count) VALUES(?,?,?,?,?) ON CONFLICT(playlist_id) DO UPDATE SET title=excluded.title").run(row.playlist_id,row.channel_id,row.title??"",row.thumbnail??"",row.video_count??""); await database.prepare("INSERT INTO user_followed_playlists(user_id,playlist_id,followed_at,feed_from,include_in_feed) VALUES(?,?,?,?,?) ON CONFLICT(user_id,playlist_id) DO UPDATE SET feed_from=excluded.feed_from,include_in_feed=excluded.include_in_feed").run(uid,row.playlist_id,row.followed_at,row.feed_from,row.include_in_feed?1:0); } }
        const tagIds = new Map<string, number>();
        if (selected.has("profile.tags")) { if (state.plan!.strategy === "replace") await database.prepare("DELETE FROM tags WHERE user_id=?").run(uid); for (const row of get("profile.tags") ?? []) { let tagId = await mappedObject(state.manifest.sourceInstallationId,"tag",row.uuid) ?? (await database.prepare("SELECT id FROM tags WHERE portable_uuid=? OR (user_id=? AND name=? COLLATE NOCASE) LIMIT 1").get(row.uuid,uid,row.name) as any)?.id; if (!tagId) tagId=Number((await database.prepare("INSERT INTO tags(name,color,filter_only,user_id,portable_uuid) VALUES(?,?,?,?,?) RETURNING id").run(String(row.name),String(row.color||"#7c5cff"),row.filterOnly?1:0,uid,row.uuid)).lastInsertRowid); else await database.prepare("UPDATE tags SET name=?,color=?,filter_only=? WHERE id=? AND user_id=?").run(row.name,row.color,row.filterOnly?1:0,tagId,uid); await saveMapping(state.manifest.sourceInstallationId,"tag",row.uuid,tagId); tagIds.set(row.uuid,tagId); for (const channelId of row.channels??[]) { await ensureChannel({channel_id:channelId}); await database.prepare("INSERT OR IGNORE INTO channel_tags(channel_id,tag_id) VALUES(?,?)").run(channelId,tagId); } for (const videoId of row.videos??[]) if (await database.prepare("SELECT 1 FROM videos WHERE video_id=?").get(videoId)) await database.prepare("INSERT INTO video_tags(video_id,tag_id,source) VALUES(?,?,'manual') ON CONFLICT(video_id,tag_id) DO UPDATE SET source='manual'").run(videoId,tagId); } }
        if (selected.has("profile.rules")) { if (state.plan!.strategy === "replace") { await database.prepare("DELETE FROM auto_tag_rules WHERE user_id=?").run(uid); await database.prepare("DELETE FROM filter_rules WHERE user_id=?").run(uid); } for (const row of get("profile.rules") ?? []) { if (row.type==="auto-tag") { const tagId=tagIds.get(row.tag_uuid)??await mappedObject(state.manifest.sourceInstallationId,"tag",row.tag_uuid); if (tagId && !await database.prepare("SELECT 1 FROM auto_tag_rules WHERE user_id=? AND tag_id=? AND lower(pattern)=lower(?) AND match_type=? AND field=?").get(uid,tagId,row.pattern,row.match_type,row.field)) await database.prepare("INSERT INTO auto_tag_rules(user_id,tag_id,pattern,match_type,field) VALUES(?,?,?,?,?)").run(uid,tagId,row.pattern,row.match_type,row.field); } else if (row.type==="filter" && !await database.prepare("SELECT 1 FROM filter_rules WHERE user_id=? AND lower(pattern)=lower(?) AND match_type=? AND field=? AND action=? AND channel_id IS ?").get(uid,row.pattern,row.match_type,row.field,row.action,row.channel_id??null)) await database.prepare("INSERT INTO filter_rules(user_id,pattern,match_type,field,action,channel_id) VALUES(?,?,?,?,?,?)").run(uid,row.pattern,row.match_type,row.field,row.action,row.channel_id??null); } }
        if (selected.has("profile.playlists")) { if (state.plan!.strategy === "replace") await database.prepare("DELETE FROM user_playlists WHERE user_id=?").run(uid); for (const row of get("profile.playlists") ?? []) { let playlistId=await mappedObject(state.manifest.sourceInstallationId,"playlist",row.uuid)??(await database.prepare("SELECT id FROM user_playlists WHERE portable_uuid=?").get(row.uuid) as any)?.id; if (!playlistId) playlistId=Number((await database.prepare("INSERT INTO user_playlists(name,icon,sort_order,created_at,user_id,portable_uuid) VALUES(?,?,?,?,?,?) RETURNING id").run(row.name,row.icon??"ListMusic",row.order??0,row.createdAt??new Date().toISOString(),uid,row.uuid)).lastInsertRowid); else await database.prepare("UPDATE user_playlists SET name=?,icon=?,sort_order=? WHERE id=? AND user_id=?").run(row.name,row.icon,row.order,playlistId,uid); await saveMapping(state.manifest.sourceInstallationId,"playlist",row.uuid,playlistId); for (const [videoIndex,video] of (row.videos??[]).entries()) if (await database.prepare("SELECT 1 FROM videos WHERE video_id=?").get(video.video_id)) await database.prepare("INSERT OR IGNORE INTO user_playlist_videos(playlist_id,video_id,added_at,position) VALUES(?,?,?,?)").run(playlistId,video.video_id,video.added_at??new Date().toISOString(),video.position??videoIndex); for (const rule of row.rules??[]) if (!await database.prepare("SELECT 1 FROM user_playlist_rules WHERE playlist_id=? AND lower(pattern)=lower(?) AND match_type=? AND field=?").get(playlistId,rule.pattern,rule.match_type,rule.field)) await database.prepare("INSERT INTO user_playlist_rules(playlist_id,pattern,match_type,field) VALUES(?,?,?,?)").run(playlistId,rule.pattern,rule.match_type,rule.field); } }
        if (selected.has("profile.video-state")) { if (state.plan!.strategy === "replace") await database.prepare("DELETE FROM user_videos WHERE user_id=?").run(uid); for (const row of get("profile.video-state")??[]) if (await database.prepare("SELECT 1 FROM videos WHERE video_id=?").get(row.video_id)) { const playbackContext=await restorePlaybackContext(uid,row.playbackContext,tagIds); await database.prepare("INSERT INTO user_videos(user_id,video_id,status,bucket,queued_at,show_from,watch_position,watch_duration,watched,liked,playback_context_json) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET status=excluded.status,bucket=excluded.bucket,queued_at=excluded.queued_at,show_from=excluded.show_from,watch_position=excluded.watch_position,watch_duration=excluded.watch_duration,watched=excluded.watched,liked=excluded.liked,playback_context_json=excluded.playback_context_json").run(uid,row.video_id,row.status??"inbox",row.bucket??null,row.queued_at??null,row.show_from??null,row.watch_position??null,row.watch_duration??null,row.watched??null,row.liked??null,playbackContext?JSON.stringify(playbackContext):null); } }
        if (selected.has("profile.history")) { if (state.plan!.strategy === "replace") await database.prepare("DELETE FROM history WHERE user_id=?").run(uid); for (const row of get("profile.history")??[]) if (await database.prepare("SELECT 1 FROM videos WHERE video_id=?").get(row.video_id) && !await database.prepare("SELECT 1 FROM history WHERE user_id=? AND video_id=? AND watched_at=?").get(uid,row.video_id,row.watched_at)) await database.prepare("INSERT INTO history(user_id,video_id,watched_at) VALUES(?,?,?)").run(uid,row.video_id,row.watched_at); }
        if (selected.has("profile.discovery-feedback")) { if (state.plan!.strategy === "replace") await database.prepare("DELETE FROM recommendation_feedback WHERE user_id=?").run(uid); for (const row of get("profile.discovery-feedback")??[]) await database.prepare("INSERT INTO recommendation_feedback(user_id,video_id,action,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET action=excluded.action,created_at=excluded.created_at").run(uid,row.video_id,row.action,row.created_at); }
        if (selected.has("profile.analytics")) { if (state.plan!.strategy === "replace") for (const table of ["watch_time_log","scheduling_event_log","watch_tag_time_log","sponsorblock_skip_log"]) await database.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(uid); for (const row of get("profile.analytics")??[]) { if(row.type==="watch-time") await database.prepare("INSERT INTO watch_time_log(user_id,video_id,day,hour,seconds) VALUES(?,?,?,?,?) ON CONFLICT(user_id,video_id,day,hour) DO UPDATE SET seconds=max(watch_time_log.seconds,excluded.seconds)").run(uid,row.video_id,row.day,row.hour,row.seconds); else if(row.type==="scheduling" && !await database.prepare("SELECT 1 FROM scheduling_event_log WHERE user_id=? AND video_id=? AND created_at=?").get(uid,row.video_id,row.created_at)) await database.prepare("INSERT INTO scheduling_event_log(user_id,video_id,channel_id,bucket,source,tags_json,local_day,local_hour,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(uid,row.video_id,row.channel_id,row.bucket,row.source,row.tags_json,row.local_day,row.local_hour,row.created_at); else if(row.type==="tag-time") { const tagId=(await database.prepare("SELECT id FROM tags WHERE user_id=? AND name=? COLLATE NOCASE").get(uid,row.tag_name) as any)?.id??stableNegativeId(`${state.manifest.sourceInstallationId}:${row.tag_name}`); await database.prepare("INSERT INTO watch_tag_time_log(user_id,tag_id,tag_name,tag_color,day,hour,seconds) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,tag_id,day,hour) DO UPDATE SET seconds=max(watch_tag_time_log.seconds,excluded.seconds)").run(uid,tagId,row.tag_name,row.tag_color,row.day,row.hour,row.seconds); } else if(row.type==="sponsorblock") await database.prepare("INSERT OR IGNORE INTO sponsorblock_skip_log(event_id,user_id,video_id,segment_uuid,category,skipped_seconds,day,created_at) VALUES(?,?,?,?,?,?,?,?)").run(row.event_id,uid,row.video_id,row.segment_uuid,row.category,row.skipped_seconds,row.day,row.created_at); } }
        const sourceProfile = (data.get("profiles.index:")??[]).find((p:any)=>p.id===profile.id); if (selected.has("profile.avatar") && sourceProfile?.avatar && entries.has(sourceProfile.avatar)) { const nextFileName=`${uid}.webp`, stage=resolve(sessionPaths(id).dir,`avatar-${uid}.webp.stage`), target=resolve(AVATAR_DIR,nextFileName), previous=((await database.prepare("SELECT avatar FROM users WHERE id=?").get(uid) as { avatar: string } | null)?.avatar ?? ""); writeFileSync(stage,await optimizeProfileAvatar(entries.get(sourceProfile.avatar)!)); await database.prepare("UPDATE users SET avatar=? WHERE id=?").run(optimizedProfileAvatarToken(uid),uid); avatarStages.push({from:stage,to:target,previous,nextFileName}); }
      }
      if (selected.has("plugin.social.activity")) {
        const doc = data.get("plugin.social.activity:") ?? {};
        const mappedUserIds = [...profileIds.values()];
        if (state.plan!.strategy === "replace" && mappedUserIds.length) {
          const placeholders = mappedUserIds.map(() => "?").join(",");
          await database.prepare(`DELETE FROM social_comment_likes WHERE user_id IN (${placeholders})`).run(...mappedUserIds);
          await database.prepare(`DELETE FROM social_reactions WHERE user_id IN (${placeholders})`).run(...mappedUserIds);
          await database.prepare(`DELETE FROM social_comments WHERE author_user_id IN (${placeholders})`).run(...mappedUserIds);
          await database.prepare(`DELETE FROM social_posts WHERE author_user_id IN (${placeholders})`).run(...mappedUserIds);
        }
        const validId = (value: unknown) => typeof value === "string" && UUID.test(value);
        for (const row of doc.posts ?? []) {
          const authorId = profileIds.get(row.authorProfileId);
          if (!authorId || !validId(row.id) || typeof row.video_id !== "string" || !await database.prepare("SELECT 1 FROM videos WHERE video_id=?").get(row.video_id)) { counts.skipped++; continue; }
          await database.prepare("INSERT OR IGNORE INTO social_posts(id,author_user_id,video_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(row.id,authorId,row.video_id,String(row.body??"").slice(0,1000),row.created_at??new Date().toISOString(),row.updated_at??row.created_at??new Date().toISOString());
        }
        for (const row of doc.comments ?? []) {
          const authorId = profileIds.get(row.authorProfileId);
          if (!authorId || !validId(row.id) || !validId(row.post_id) || !await database.prepare("SELECT 1 FROM social_posts WHERE id=?").get(row.post_id)) { counts.skipped++; continue; }
          await database.prepare("INSERT OR IGNORE INTO social_comments(id,post_id,author_user_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(row.id,row.post_id,authorId,String(row.body??"").slice(0,2000),row.created_at??new Date().toISOString(),row.updated_at??row.created_at??new Date().toISOString());
        }
        for (const row of doc.reactions ?? []) {
          const userId = profileIds.get(row.profileId);
          let reaction: string | null = null;
          try { reaction = normalizeSocialReaction(row.reaction_key); } catch {}
          if (userId && reaction && validId(row.post_id) && await database.prepare("SELECT 1 FROM social_posts WHERE id=?").get(row.post_id)) await database.prepare("INSERT OR IGNORE INTO social_reactions(post_id,user_id,reaction_key,created_at) VALUES(?,?,?,?)").run(row.post_id,userId,reaction,row.created_at??new Date().toISOString());
        }
        for (const row of doc.commentLikes ?? []) {
          const userId = profileIds.get(row.profileId);
          if (userId && validId(row.comment_id) && await database.prepare("SELECT 1 FROM social_comments WHERE id=?").get(row.comment_id)) await database.prepare("INSERT OR IGNORE INTO social_comment_likes(comment_id,user_id,created_at) VALUES(?,?,?)").run(row.comment_id,userId,row.created_at??new Date().toISOString());
        }
        for (const row of doc.postMentions ?? []) {
          const mentionedId = profileIds.get(row.mentionedProfileId);
          if (mentionedId && validId(row.post_id) && await database.prepare("SELECT 1 FROM social_posts WHERE id=?").get(row.post_id)) await database.prepare("INSERT OR IGNORE INTO social_post_mentions(post_id,mentioned_user_id,token) VALUES(?,?,?)").run(row.post_id,mentionedId,String(row.token??"").slice(0,81));
        }
        for (const row of doc.commentMentions ?? []) {
          const mentionedId = profileIds.get(row.mentionedProfileId);
          if (mentionedId && validId(row.comment_id) && await database.prepare("SELECT 1 FROM social_comments WHERE id=?").get(row.comment_id)) await database.prepare("INSERT OR IGNORE INTO social_comment_mentions(comment_id,mentioned_user_id,token) VALUES(?,?,?)").run(row.comment_id,mentionedId,String(row.token??"").slice(0,81));
        }
      }
    }); await tx();
    await reloadSettingCache();
    if (selected.has("instance.settings")) {
      const timeZone = configuredTimeZone();
      const now = new Date();
      for (const bucket of SCHEDULE_BUCKETS) await database.prepare("UPDATE user_videos SET show_from=? WHERE status='queued' AND bucket=?").run(computeShowFrom(bucket, now, timeZone), bucket);
    }
    mkdirSync(AVATAR_DIR,{recursive:true}); for(const file of avatarStages) { renameSync(file.from,file.to); removeStoredProfileAvatar(file.previous,file.nextFileName,AVATAR_DIR); } rmSync(sessionPaths(id).dir,{recursive:true,force:true}); return { ok:true, snapshot, counts };
  } catch (error) {
    for (const file of avatarStages) try { rmSync(file.from, { force: true }); } catch {}
    // Plugin adapters can refresh the synchronous settings cache from inside
    // the restore transaction. If a later restore step rolls back, reload the
    // committed values so reads cannot observe data that never committed.
    await reloadSettingCache();
    throw error;
  } finally { releaseMaintenance(); }
}
export function deleteRestoreSession(adminId: number, id: string) { loadSession(id, adminId); rmSync(sessionPaths(id).dir, { recursive: true, force: true }); }
