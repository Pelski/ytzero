import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { publishAppEvent, subscribeToAppEvents } from "./appEvents";
import { database, databaseConfig } from "./database";
import { getSetting, setSetting, getUserSetting, setUserSetting, SETTING_DEFAULTS, GLOBAL_SETTING_KEYS, USER_SETTING_KEYS } from "./db";
import {
  type ChannelAbout,
  fetchChannelAbout,
  fetchChannelFeed,
  fetchChannelPlaylists,
  fetchChannelSubscriberCountFromWatch,
  fetchChannelVideosDurations,
  fetchPlaylistVideos,
  fetchVideoChapters,
  fetchVideoCreators,
  fetchVideoInfo,
  parseOpml,
  parseTakeoutCsv,
  resolveChannelId,
  searchYouTube,
} from "./youtube";
import { getCachedImage } from "./imgcache";
import { isAllowedRemoteImageUrl } from "./imageCachePolicy";
import { preserveChannelMedia, preservePlaylistMedia } from "./channelMedia";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { backfillImportedVideos, channelRefreshDiagnostics, importPlaylistVideos, refreshAll, refreshChannel, refreshLiveStatus, syncChannel, syncChannelMissingMetadata, syncChannelPlaylists, syncPlaylist } from "./refresher";
import { IMPORTED_CHANNEL_ID, isRelevantEntryName, isZip, parseTakeoutFiles, unzipEntries, type TakeoutBundle, type TakeoutHistoryEntry, type TakeoutPlaylist } from "./takeout";
import { createImportSession, deleteImportSession, getImportSession } from "./importSession";
import { applyRuleToAllVideos } from "./autotags";
import { applyPlaylistRuleToAllVideos, applyPlaylistRulesForPlaylist } from "./userPlaylists";
import { applyFilterRuleToAll } from "./filterRules";
import { log, readRecentLogs, subscribeToLogs } from "./logger";
import { isValidTimeZone, zonedDayHour } from "./timeZone";
import { computeShowFrom, SCHEDULE_BUCKETS } from "./scheduleTime";
import { COMMIT, VERSION } from "./version";
import { checkLatestRelease } from "./updates";
import { DOWNLOADS_ADMIN_SETTING_KEYS, discoveryRecommendations, dismissDiscoveryRecommendation, getPluginSettings, listPlugins, pluginAdminSettingKeys, pluginEnabled, recommendationFeed, refreshDiscoveryInBackground, refreshDiscoveryNow, resetPluginState, setPluginEnabled, setPluginSettings } from "./plugins";
import { activeDownloadProgress, cancelAllPendingDownloads, cancelAutoDownloadIfUnwanted, downloadCookiesConfigured, downloadStats, downloadStatusSummary, enqueueDownload, enqueuePlaylistDownloads, fetchSubtitles, getDownload, getHlsPlaylist, getHlsSegment, listDownloads, listSubtitleFiles, liveStreamEnabled, prioritizeDownload, removeDownload, removeDownloadCookies, saveDownloadCookies, setDownloadPinned, srtToVtt, ytdlpStatus } from "./downloader";
import { createDownloadRule, deleteDownloadRule, DownloadRuleValidationError, listDownloadRules, previewDownloadRule, updateDownloadRule, type DownloadRuleInput } from "./downloadRules";
import { fetchVideoComments, validYouTubeVideoId, VideoCommentsError } from "./youtubeComments";
import { SUBTITLE_LANGUAGE_CODES } from "./subtitleLanguages";
import { activeChildPlayback, applyGrant, CHILD_GRANTS, type ChildGrant, childDownloadsOnly, childHidesLive, childLocalOnly, childStatus, clearChildLockFailures, isChildUser, isParentLocked, isPinLocked, lastWatchedVideo, lockChildByParent, recordWatchTick, registerChildLockFailure, unlockChildProfile } from "./childTime";
import { buildHouseholdInsights, INSIGHT_RANGES } from "./insights";
import { recordSchedulingSignal } from "./contentSignals";
import { CHANNEL_PLAYLIST_CACHE_VERSION, saveChannelPlaylists, videoPlaylistsForUser } from "./channelPlaylists";
import { feedVisibilityWhere, feedSortSql, followedExists, followedPlaylistExists, tagFilterSql, filterOnlySql } from "./feedQuery";
import { buildCleanupWhere, countCleanupMatches, listCleanupVideoIds, snapshotUserVideoState, applyCleanupAction, restoreUserVideoState, saveBulkUndo, loadBulkUndo, clearBulkUndo, type CleanupFilter } from "./cleanup";
import { analyzePortableBackup, backupOptions, commitPortableRestore, createPortableBackup, deleteRestoreSession, planPortableRestore } from "./portableBackup";
import { isChannelManualStatus } from "./channelStatus";
import { acquireMaintenance, beginMutation, maintenanceStatus } from "./maintenance";
import { migrateSQLiteToPostgres } from "./postgresMigration";
import { acceptCurrentDatabase, databaseRuntimeStatus, recordCompletedPostgresMigration } from "./databaseState";
import { isProfilePermissionArea, parseAdminOnlyAreas, permissionAreaForMutation, permissionAreasForSettings, serializeAdminOnlyAreas, settingsMutationRequiresAdmin, type ProfilePermissionArea } from "./profilePermissions";
import {
  authMethod,
  hashPassword,
  verifyPassword,
  requestOrigin,
  AUTH_SESSION_COOKIE,
  createSession,
  validateSession,
  destroySession,
  authSessionCookie,
  clearAuthSessionCookie,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  passkeyLoginOptions,
  passkeyLoginVerify,
  listPasskeys,
  deletePasskey,
  hasPasskeys,
  oidcAuthUrl,
  oidcCallback,
  testOidc,
  invalidateOidcConfig,
  resolveProxyUser,
  proxyHeaderValue,
} from "./auth";
import { generateTemporaryPassword, uniqueProfileUsername } from "./profileCredentials";
import { getDeArrowBranding } from "./dearrow";
import {
  createSocialComment,
  createSocialPost,
  deleteSocialComment,
  deleteSocialPost,
  listSocialComments,
  listSocialPosts,
  mentionableSocialProfiles,
  recentSocialEmojis,
  setSocialEmojiSkinTone,
  setSocialCommentLike,
  setSocialReaction,
  SocialError,
  socialPost,
  socialEmojiSkinTone,
  updateSocialComment,
  updateSocialPost,
} from "./social";
import { commitStagedProfileAvatar, optimizeProfileAvatar, PROFILE_AVATAR_DIR, profileAvatarFileName, removeStoredProfileAvatar, stageProfileAvatarBytes } from "./profileAvatars";

export const api = new Hono<{ Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } }>();

api.onError((err, c) => {
  log.error("api.unhandled_error", { path: c.req.path, method: c.req.method, error: err.message });
  return c.json({ error: err.message }, 500);
});

// Log only failed or unusually slow requests. Query strings, request bodies,
// headers and cookies are intentionally excluded from diagnostic logs.
api.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  const ms = Date.now() - startedAt;
  const meta = {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms,
    userId: c.get("userId") || undefined,
  };
  if (c.res.status >= 500) log.error("api.request_failed", meta);
  else if (c.res.status >= 400) log.warn("api.request_failed", meta);
  else if (ms >= 2_000) log.warn("api.request_slow", meta);
});

// ---------- helpers ----------

const CHILD_LOCK_SESSION_COOKIE = "ytzero_child_lock";
const CHILD_LOCK_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CHILD_LOCK_PIN_PROTECTED_AREAS = new Set<ProfilePermissionArea>([
  "channels",
  "followed_playlists",
  "imports",
  "appearance",
  "feed",
  "navigation",
  "playback",
  "plugins",
  "profiles",
]);
const childLockSessions = new Map<string, number>();

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    const raw = rawValue.join("=");
    // A single malformed cookie (e.g. a %-containing value set by another app on
    // the same domain) must not crash every request — decodeURIComponent throws
    // a URIError on bad escapes, so fall back to the raw value.
    try {
      cookies[rawKey] = decodeURIComponent(raw);
    } catch {
      cookies[rawKey] = raw;
    }
  }
  return cookies;
}

function isSixDigitPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

function isChildLockEnabled() {
  return getSetting("child_lock_enabled") === "1" && Boolean(getSetting("child_lock_pin_hash"));
}

function cleanupChildLockSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of childLockSessions) {
    if (expiresAt <= now) childLockSessions.delete(token);
  }
}

function hasChildLockSession(c: any) {
  if (!isChildLockEnabled()) return true;
  cleanupChildLockSessions();
  const token = parseCookies(c.req.header("cookie"))[CHILD_LOCK_SESSION_COOKIE];
  return Boolean(token && (childLockSessions.get(token) ?? 0) > Date.now());
}

function childLockStatus(c: any) {
  const enabled = isChildLockEnabled();
  return {
    enabled,
    // Admin authority already proves who is operating the app. The lock protects
    // other profiles and never hides settings from the primary/admin profile.
    locked: enabled && !isAdmin(c) && !hasChildLockSession(c),
  };
}

function adminOnlyAreas(): ProfilePermissionArea[] {
  return parseAdminOnlyAreas(getSetting("profile_admin_only_areas"));
}

async function verifyChildLockPin(pin: string) {
  const hash = getSetting("child_lock_pin_hash");
  if (!hash) return false;
  return Bun.password.verify(pin, hash);
}

async function hashChildLockPin(pin: string) {
  return Bun.password.hash(pin);
}

function setChildLockSession(c: any) {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + CHILD_LOCK_SESSION_TTL_MS;
  childLockSessions.set(token, expiresAt);
  c.header(
    "Set-Cookie",
    `${CHILD_LOCK_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(CHILD_LOCK_SESSION_TTL_MS / 1000)}; SameSite=Lax; HttpOnly`
  );
}

function clearChildLockSession(c: any) {
  const token = parseCookies(c.req.header("cookie"))[CHILD_LOCK_SESSION_COOKIE];
  if (token) childLockSessions.delete(token);
  c.header("Set-Cookie", `${CHILD_LOCK_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
}

// ---------- active profile (multi-user) ----------

const PROFILE_COOKIE = "ytzero_profile";

function profileCookie(userId: number) {
  return `${PROFILE_COOKIE}=${userId}; Path=/; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax`;
}

const userExists = database.prepare("SELECT 1 FROM users WHERE id = ?");
const firstUserId = database.prepare("SELECT id FROM users ORDER BY sort_order ASC, id ASC LIMIT 1");
// The primary profile (lowest id = the original "Default"). It is the only one
// that owns app-wide settings (app name, icon color, child lock) and can't be
// deleted.
const primaryUserIdStmt = database.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1");
const primaryUserIdValue = (await primaryUserIdStmt.get() as { id: number }).id;
function primaryUserId(): number {
  return primaryUserIdValue;
}
function isPrimaryUser(c: any): boolean {
  return currentUserId(c) === primaryUserId();
}
// Admin = the immutable primary owner, an OIDC group administrator, or a
// delegated profile administrator. Authentication configuration and role
// delegation remain owner-only even when other admin capabilities are granted.
function isAdmin(c: any): boolean {
  return isPrimaryUser(c) || Boolean(c.get("sessionAdmin")) || Boolean(c.get("profileAdmin"));
}
// Who may edit a profile's general settings (name/color/avatar): the owner, or
// an admin. Nobody except the owner may mutate the primary profile.
function canManageProfile(c: any, id: number): boolean {
  if (id === primaryUserId()) return isPrimaryUser(c);
  return currentUserId(c) === id || isAdmin(c);
}

async function setDelegatedProfileAdmin(c: any, userId: number): Promise<void> {
  if (!canDelegateProfileAdmins() || userId <= 0 || userId === primaryUserId()) return;
  const row = await database.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as { is_admin: number } | null;
  c.set("profileAdmin", row?.is_admin === 1);
}

/** Active profile id for the request (validated; falls back to the first profile). */
function currentUserId(c: any): number {
  return c.get("userId");
}

// Falls back to the cookie-selected profile (or the first profile). Used by the
// 'none' method and by any session whose scope allows free profile switching.
async function profileFromCookie(c: any): Promise<number> {
  const raw = Number(parseCookies(c.req.header("cookie"))[PROFILE_COOKIE]);
  const valid = Number.isInteger(raw) && raw > 0 && await userExists.get(raw);
  return valid ? raw : (await firstUserId.get() as { id: number } | null)?.id ?? 0;
}

// Endpoints reachable without an authenticated session (login flow + app config).
function isAuthFreePath(path: string): boolean {
  return path.startsWith("/auth") || path === "/config";
}

// Resolve the active profile for every API request, honouring the auth method.
api.use("*", async (c, next) => {
  const method = authMethod();
  const path = new URL(c.req.url).pathname.replace(/^\/api/, "");

  if (method === "none") {
    c.set("userId", await profileFromCookie(c));
    return next();
  }

  if (method === "proxy_header") {
    const uid = await resolveProxyUser(c);
    if (uid) {
      c.set("userId", uid);
      await setDelegatedProfileAdmin(c, uid);
      return next();
    }
    c.set("userId", 0);
    if (isAuthFreePath(path)) return next();
    return c.json({ error: "unauthenticated", method }, 401);
  }

  // shared | per_profile | oidc → server-side session
  const session = await validateSession(parseCookies(c.req.header("cookie"))[AUTH_SESSION_COOKIE]);
  if (session) {
    const userId = session.scope === "account" ? await profileFromCookie(c) : session.user_id ?? 0;
    c.set("userId", userId);
    c.set("sessionAdmin", session.is_admin);
    if (session.scope === "profile") await setDelegatedProfileAdmin(c, userId);
    return next();
  }
  c.set("userId", 0);
  if (isAuthFreePath(path)) return next();
  return c.json({ error: "unauthenticated", method }, 401);
});

// Maintenance operations (restore and database migration) take an exclusive
// application-level write lease. Existing mutations are allowed to finish;
// new authenticated ones receive a retryable response until maintenance ends.
api.use("*", async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method.toUpperCase())) return next();
  const path = new URL(c.req.url).pathname.replace(/^\/api/, "");
  const ownsMaintenance = path === "/restore/commit" || path.startsWith("/database/migration/");
  if (ownsMaintenance) return next();
  const release = beginMutation();
  if (!release) {
    c.header("Retry-After", "2");
    return c.json({ error: "maintenance in progress", maintenance: maintenanceStatus() }, 503);
  }
  try {
    await next();
  } finally {
    release();
  }
});

/** True when the active auth method permits internal profile switching. */
function canSwitchProfiles(): boolean {
  const method = authMethod();
  if (method === "none" || method === "shared") return true;
  if (method === "oidc") return (getSetting("auth_oidc_mode") || "mapped") === "gateway";
  return false;
}

/** Delegation is safe only when authentication binds a request to one profile. */
function canDelegateProfileAdmins(): boolean {
  const method = authMethod();
  if (method === "per_profile" || method === "proxy_header") return true;
  return method === "oidc" && (getSetting("auth_oidc_mode") || "mapped") === "mapped";
}

function hideOtherProfilesInPicker(): boolean {
  const method = authMethod();
  return method !== "none" && method !== "shared" && getSetting("auth_hide_other_profiles") === "1";
}

function methodLogoutUrl(): string {
  const method = authMethod();
  if (method === "oidc") return getSetting("auth_oidc_logout_url") || "";
  if (method === "proxy_header") return getSetting("auth_proxy_logout_url") || "";
  return "";
}

async function hashPin(pin: string) {
  return Bun.password.hash(pin);
}

api.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/^\/api/, "");
  const method = c.req.method.toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const settingsBody = isMutation && path === "/settings" ? await c.req.json().catch(() => null) : null;
  if (!isAdmin(c) && settingsBody != null && settingsMutationRequiresAdmin(settingsBody)) {
    return c.json({ error: "admin only" }, 403);
  }
  const areas = !isMutation
    ? []
    : path === "/settings"
      ? permissionAreasForSettings(settingsBody)
      : [permissionAreaForMutation(path)].filter((area): area is ProfilePermissionArea => area != null);
  if (!isAdmin(c) && areas.some((area) => adminOnlyAreas().includes(area))) {
    return c.json({ error: "admin only" }, 403);
  }
  // Child Lock keeps its original role: a temporary PIN gate for shared
  // settings. Personal tags and playlists remain usable while it is locked.
  const isPinProtected = areas.some((area) => CHILD_LOCK_PIN_PROTECTED_AREAS.has(area));
  if (isPinProtected && !isAdmin(c) && !hasChildLockSession(c)) {
    return c.json({ error: "settings locked" }, 423);
  }
  await next();
});

// ---------- portable backup and restore (admin only) ----------

api.get("/database/status", (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  return c.json(databaseRuntimeStatus());
});

api.post("/database/migration/sqlite-to-postgres", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  if (databaseConfig.engine !== "sqlite") return c.json({ error: "migration must be started while SQLite is active" }, 409);
  const { target_url } = await c.req.json().catch(() => ({}));
  if (typeof target_url !== "string" || !/^postgres(?:ql)?:\/\//i.test(target_url)) {
    return c.json({ error: "valid PostgreSQL URL required" }, 400);
  }
  const release = await acquireMaintenance("SQLite to PostgreSQL migration");
  try {
    const result = await migrateSQLiteToPostgres(databaseConfig.sqlitePath, target_url);
    recordCompletedPostgresMigration(target_url, result.receiptId);
    log.info("database.migrated", { source: "sqlite", target: "postgres", receiptId: result.receiptId, tables: result.tables, rows: result.rows });
    return c.json({ ...result, next: "Set DATABASE_URL to the PostgreSQL URL and restart the application." });
  } finally {
    release();
  }
});

api.post("/database/migration/confirm", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const status = databaseRuntimeStatus();
  if (status.state !== "migration_ready" || databaseConfig.engine !== "postgres" || !status.pendingReceiptId) {
    return c.json({ error: "no verified migrated database is awaiting confirmation" }, 409);
  }
  const receipt = await database.prepare("SELECT id FROM database_migration_receipts WHERE id = ?").get(status.pendingReceiptId);
  if (!receipt) return c.json({ error: "migration receipt not found in the active database" }, 409);
  acceptCurrentDatabase();
  return c.json({ ok: true, status: databaseRuntimeStatus() });
});

api.get("/backup/options", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  c.header("Cache-Control", "private, no-store");
  return c.json(await backupOptions());
});

api.post("/backup/export", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const startedAt = Date.now();
  const input = await c.req.json().catch(() => ({}));
  const archive = await createPortableBackup(input);
  log.info("backup.exported", {
    userId: currentUserId(c),
    preset: typeof input.preset === "string" ? input.preset : "default",
    profiles: Array.isArray(input.profiles) ? input.profiles.length : "all",
    selectedSections: Array.isArray(input.sections) ? input.sections.length : "preset",
    bytes: archive.length,
    ms: Date.now() - startedAt,
  });
  const date = zonedDayHour().day;
  const body = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
  return new Response(body, { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="ytzero-backup-${date}.zip"`,
    "Cache-Control": "private, no-store",
    "Content-Length": String(archive.length),
  } });
});

api.post("/restore/analyze", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "backup file required" }, 400);
  if (!/\.(zip|ytzero-backup)$/i.test(file.name)) return c.json({ error: "choose a .zip or .ytzero-backup file" }, 400);
  const startedAt = Date.now();
  const result = await analyzePortableBackup(currentUserId(c), new Uint8Array(await file.arrayBuffer()));
  log.info("restore.analyzed", {
    userId: currentUserId(c),
    bytes: result.archiveBytes,
    profiles: result.manifest.profiles.length,
    sections: result.manifest.sections.length,
    warnings: result.warnings.length,
    sameSource: result.sameSource,
    ms: Date.now() - startedAt,
  });
  c.header("Cache-Control", "private, no-store");
  return c.json(result);
});

api.post("/restore/plan", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const { sessionId, mappings, sections, strategy } = await c.req.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !mappings || !Array.isArray(sections)) return c.json({ error: "invalid restore plan" }, 400);
  const result = await planPortableRestore(currentUserId(c), sessionId, { mappings, sections, strategy });
  log.info("restore.planned", { userId: currentUserId(c), ...result.changes, warnings: result.warnings.length });
  return c.json(result);
});

api.post("/restore/commit", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const { sessionId, planRevision } = await c.req.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !Number.isInteger(planRevision)) return c.json({ error: "invalid restore commit" }, 400);
  const startedAt = Date.now();
  const result = await commitPortableRestore(currentUserId(c), sessionId, planRevision);
  log.info("restore.committed", {
    userId: currentUserId(c),
    ...result.counts,
    warnings: result.counts.warnings.length,
    safetySnapshot: true,
    ms: Date.now() - startedAt,
  });
  return c.json(result);
});

api.delete("/restore/session/:id", (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  deleteRestoreSession(currentUserId(c), c.req.param("id"));
  log.info("restore.canceled", { userId: currentUserId(c) });
  return c.json({ ok: true });
});

interface VideoRow {
  video_id: string;
  channel_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: string | null;
  found_at: string;
  published_at_approximate: number;
  members_only: number;
  is_private: number;
  live_status: string;
  status: string;
  bucket: string | null;
  is_short: number | null;
  views: number | null;
  likes: number | null;
  liked: number | null;
  watched: number | null;
  in_history: number;
  channel_title: string;
}

async function attachWatchedState<T>(uid: number, items: T[], videoId: (item: T) => string | null | undefined) {
  const ids = [...new Set(items.map(videoId).filter((id): id is string => !!id))];
  if (ids.length === 0) return items.map((item) => ({ ...item, watched: 0, watch_position: null, watch_duration: null }));
  const placeholders = ids.map(() => "?").join(",");
  const rows = await database.prepare(
    `SELECT video_id, watched, watch_position, watch_duration
     FROM user_videos WHERE user_id = ? AND video_id IN (${placeholders})`
  ).all(uid, ...ids) as { video_id: string; watched: number | null; watch_position: number | null; watch_duration: number | null }[];
  const state = new Map(rows.map((row) => [row.video_id, row]));
  return items.map((item) => {
    const progress = state.get(videoId(item) ?? "");
    return {
      ...item,
      watched: progress?.watched === 1 ? 1 : 0,
      watch_position: progress?.watch_position ?? null,
      watch_duration: progress?.watch_duration ?? null,
    };
  });
}

async function attachTags(uid: number, videos: VideoRow[]) {
  if (videos.length === 0) return [];
  // downloads_allowed: the profile may use downloads at all (not a child);
  // downloads_enabled additionally requires the plugin to be turned on. The UI
  // shows the download action for allowed-but-disabled and links to settings.
  const downloadsAllowed = !await isChildUser(uid);
  const downloadsEnabled = downloadsAllowed && await profileDownloadsEnabled(uid);
  // Live percentage for the one video the downloader is fetching right now,
  // so lists can paint a download progress bar without a dedicated request.
  const dlProgress = activeDownloadProgress();
  const ids = videos.map((v) => v.video_id);
  const ph = ids.map(() => "?").join(",");
  // Tags are per profile: only surface tags owned by the active user.
  const videoTags = await database
    .prepare(
      `SELECT vt.video_id, t.id, t.name, t.color, t.filter_only, vt.source FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id AND t.user_id = ? WHERE vt.video_id IN (${ph})`
    )
    .all(uid, ...ids) as any[];
  const channelIds = [...new Set(videos.map((v) => v.channel_id))];
  const chPh = channelIds.map(() => "?").join(",");
  const channelTags = await database
    .prepare(
      `SELECT ct.channel_id, t.id, t.name, t.color, t.filter_only FROM channel_tags ct
       JOIN tags t ON t.id = ct.tag_id AND t.user_id = ? WHERE ct.channel_id IN (${chPh})`
    )
    .all(uid, ...channelIds) as any[];
  const playlistChannelTags = await database
    .prepare(
      `SELECT DISTINCT cpv.video_id, t.id, t.name, t.color, t.filter_only
       FROM channel_playlist_videos cpv
       JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
       JOIN user_followed_playlists ufp ON ufp.playlist_id = cp.playlist_id AND ufp.user_id = ?
       JOIN channel_tags ct ON ct.channel_id = cp.channel_id
       JOIN tags t ON t.id = ct.tag_id AND t.user_id = ?
       WHERE cpv.video_id IN (${ph})`
    )
    .all(uid, uid, ...ids) as any[];

  return videos.map((v) => {
    const own = videoTags
      .filter((t) => t.video_id === v.video_id)
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: t.source }));
    const inherited = channelTags
      .filter((t) => t.channel_id === v.channel_id && !own.some((o) => o.id === t.id))
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: "channel" }));
    const playlistInherited = playlistChannelTags
      .filter((t) => t.video_id === v.video_id && !own.some((o) => o.id === t.id) && !inherited.some((i) => i.id === t.id))
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: "channel" }));
    const download_progress = (v as any).download_status === "downloading" && dlProgress?.video_id === v.video_id
      ? dlProgress.percent
      : null;
    return { ...v, downloads_enabled: downloadsEnabled, downloads_allowed: downloadsAllowed, download_progress, tags: [...own, ...inherited, ...playlistInherited] };
  });
}

// Per-profile video projection: status/bucket/liked/progress come from the
// active user's user_videos row (absent = default inbox); history is per user.
// uid is a validated integer, safe to inline.
function videoSelect(uid: number) {
  return `
  SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail,
         v.published_at, v.created_at AS found_at, v.published_at_approximate, v.members_only, v.is_private,
         v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
         v.is_short, v.views, v.likes, uv.liked, uv.watched,
         v.duration, uv.watch_position, uv.watch_duration, v.external,
         (SELECT cp.title
          FROM channel_playlist_videos cpv
          JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
          JOIN user_followed_playlists ufp ON ufp.playlist_id = cpv.playlist_id AND ufp.user_id = ${uid}
          WHERE cpv.video_id = v.video_id AND ufp.include_in_feed = 1
          ORDER BY cpv.discovered_at DESC LIMIT 1) AS source_playlist_title,
         (SELECT cp.playlist_id
          FROM channel_playlist_videos cpv
          JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
          JOIN user_followed_playlists ufp ON ufp.playlist_id = cpv.playlist_id AND ufp.user_id = ${uid}
          WHERE cpv.video_id = v.video_id AND ufp.include_in_feed = 1
          ORDER BY cpv.discovered_at DESC LIMIT 1) AS source_playlist_id,
         EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ${uid}) AS in_history,
         (SELECT d.status FROM downloads d JOIN download_owners owner ON owner.video_id=d.video_id WHERE owner.user_id=${uid} AND d.video_id=v.video_id AND d.status!='deleted') AS download_status,
         COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count
  FROM videos v JOIN channels c ON c.channel_id = v.channel_id
  LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${uid}`;
}

// ---------- feed ----------

api.get("/feed", async (c) => {
  const uid = currentUserId(c);
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const limit = Math.min(100, Number(c.req.query("limit") ?? 40));
  const q = c.req.query("q")?.trim();
  const channel = c.req.query("channel");
  const allSources = c.req.query("all_sources") === "1";
  const processing = c.req.query("processing") === "1";
  if (processing && !channel) return c.json({ videos: [], page, limit });

  // Channel defaults inherit the profile-wide visibility for each surface.
  const isMainFeed = !processing && !channel && !allSources && !q && c.req.query("liked") !== "1" && c.req.query("only_shorts") !== "1";

  let where: string[];
  let params: any[];
  if (isMainFeed) {
    ({ where, params } = feedVisibilityWhere(c.req.query(), uid));
  } else {
    where = [];
    params = [];
    // Videos without a publication date are incomplete imports. Never let them
    // use created_at as a fake feed date; expose them only through the channel's
    // dedicated processing tab.
    where.push(processing
      ? "(v.published_at IS NULL OR v.published_at = '')"
      : "(v.published_at IS NOT NULL AND v.published_at != '')");
    const status = c.req.query("status") ?? "inbox";
    if (status !== "all") {
      where.push("COALESCE(uv.status, 'inbox') = ?");
      params.push(status);
    }
    if (channel) {
      where.push("v.channel_id = ?");
      params.push(channel);
    } else if (!allSources) {
      where.push(`(${followedExists(uid)} OR ${followedPlaylistExists(uid)})`);
    }
    if (q) {
      where.push("(v.title LIKE ? OR v.description LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    // shorts=1 forces shorts in, shorts=0 forces them out; otherwise the active
    // profile's setting decides.
    const shortsParam = c.req.query("shorts");
    if (shortsParam === "0" || (shortsParam !== "1" && getUserSetting(uid, "show_shorts") !== "1")) {
      where.push("COALESCE(v.is_short, 0) = 0");
    }
    if (c.req.query("only_shorts") === "1") {
      where.push("v.is_short = 1");
    }
    // Keep live/upcoming streams available in the dedicated Live tab, while
    // allowing each profile to keep its main feed focused on regular uploads.
    if (c.req.query("only_shorts") !== "1" && (getUserSetting(uid, "hide_live_from_feed") === "1" || childHidesLive(uid))) {
      where.push("v.live_status NOT IN ('live', 'upcoming')");
    }
    if (channel) {
      where.push(`NOT (
        v.members_only = 1 AND CASE COALESCE(
          (SELECT member_pref.members_only_visibility FROM user_channels member_pref
           WHERE member_pref.user_id = ${uid} AND member_pref.channel_id = v.channel_id), 'default'
        )
          WHEN 'feed' THEN 0
          WHEN 'hidden' THEN 1
          WHEN 'everywhere' THEN 0
          WHEN 'channel' THEN 0
          ELSE ?
        END = 1
      )`);
      params.push(getUserSetting(uid, "hide_members_only_on_channel") === "1" ? 1 : 0);
    }
    if (c.req.query("liked") === "1") {
      where.push("uv.liked = 1");
    }
    const tagsParam = c.req.query("tags");
    const tagIds = tagsParam ? tagsParam.split(",").map(Number).filter(Boolean) : [];
    if (tagIds.length) {
      const f = tagFilterSql(uid, tagIds);
      where.push(f.sql);
      params.push(...f.params);
    }
    // Exclude filter_only-tagged videos unless the relevant tag is actively selected.
    // show_all=1 bypasses this entirely and shows everything regardless of filter_only tags.
    const showAll = c.req.query("show_all") === "1";
    if (!channel && !allSources && !showAll) {
      const fo = filterOnlySql(uid, tagIds);
      where.push(fo.sql);
      params.push(...fo.params);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const feedSort = c.req.query("sort") === "arrival" ? "arrival" : "published";
  const rows = await database
    .prepare(`${videoSelect(uid)} ${whereSql} ORDER BY ${isMainFeed ? feedSortSql(feedSort) : "COALESCE(v.published_at, v.created_at)"} DESC, v.video_id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, page * limit) as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows), page, limit });
});

// The next/previous video in the selected main-feed order, skipping
// anything already watched. Backs the "autoplay my feed" setting — resolved
// server-side (rather than walking the client's loaded pages) so it always
// matches the full feed regardless of how many pages the UI has fetched.
api.get("/feed/adjacent", async (c) => {
  const uid = currentUserId(c);
  const videoId = c.req.query("video_id");
  const direction = c.req.query("direction") === "newest" ? "newest" : "oldest";
  const feedSort = c.req.query("sort") === "arrival" ? "arrival" : "published";
  const sortColumn = feedSortSql(feedSort);
  if (!videoId) return c.json({ video: null });
  const anchor = await database.prepare("SELECT video_id, published_at, created_at FROM videos WHERE video_id = ?").get(videoId) as { video_id: string; published_at: string | null; created_at: string } | null;
  const anchorTime = feedSort === "arrival" ? anchor?.created_at : anchor?.published_at;
  if (!anchor || !anchorTime) return c.json({ video: null });

  const { where, params } = feedVisibilityWhere(c.req.query(), uid);
  const comparison = direction === "oldest" ? ">" : "<";
  where.push(`(${sortColumn} ${comparison} ? OR (${sortColumn} = ? AND v.video_id ${comparison} ?))`);
  params.push(anchorTime, anchorTime, anchor.video_id);
  // FeedPage lifts meaningful partials into its separate Continue shelf, so
  // the chronological grid's queue must skip them too.
  where.push(`NOT (
    uv.watch_position IS NOT NULL AND uv.watch_duration IS NOT NULL
    AND uv.watch_duration > 30 AND uv.watch_position >= 3
    AND CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92
  )`);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const orderDirection = direction === "oldest" ? "ASC" : "DESC";
  const order = `${sortColumn} ${orderDirection}, v.video_id ${orderDirection}`;
  const row = await database.prepare(`${videoSelect(uid)} ${whereSql} ORDER BY ${order} LIMIT 1`).get(...params) as VideoRow | undefined;
  return c.json({ video: row ? (await attachTags(uid, [row]))[0] : null });
});

// ---------- feed cleanup ----------
// "clean" previews/counts what the filter would affect; "remain" previews what
// the feed would still look like afterwards. Both share buildCleanupWhere with
// GET /feed's own visibility rules, so what's shown here can never drift from
// what /cleanup/apply actually touches.
const CLEANUP_PAGE_SIZE = 24;

api.post("/cleanup/preview", async (c) => {
  const uid = currentUserId(c);
  const body = await c.req.json() as { filter?: CleanupFilter; exclude_video_ids?: string[]; side?: "clean" | "remain"; page?: number };
  const filter = body.filter ?? {};
  const excludeIds = body.exclude_video_ids ?? [];
  const side = body.side === "remain" ? "remain" : "clean";
  const page = Math.max(0, Number(body.page ?? 0));

  const { where, params } = buildCleanupWhere(filter, uid, side, excludeIds);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await database
    .prepare(`${videoSelect(uid)} ${whereSql} ORDER BY ${feedSortSql()} DESC LIMIT ? OFFSET ?`)
    .all(...params, CLEANUP_PAGE_SIZE, page * CLEANUP_PAGE_SIZE) as VideoRow[];
  const total = await countCleanupMatches(filter, uid, side, excludeIds);
  return c.json({ videos: await attachTags(uid, rows), total, page, limit: CLEANUP_PAGE_SIZE });
});

api.post("/cleanup/apply", async (c) => {
  const uid = currentUserId(c);
  const body = await c.req.json() as { filter?: CleanupFilter; exclude_video_ids?: string[]; action?: "archive" | "watched" };
  const filter = body.filter ?? {};
  const excludeIds = body.exclude_video_ids ?? [];
  if (body.action !== "archive" && body.action !== "watched") return c.json({ error: "invalid action" }, 400);

  const videoIds = await listCleanupVideoIds(filter, uid, excludeIds);
  if (videoIds.length === 0) return c.json({ affected: 0 });

  const snapshot = await snapshotUserVideoState(uid, videoIds);
  await applyCleanupAction(uid, videoIds, body.action);
  // Both outcomes end in status=archived, so a pending auto download nobody
  // will see anymore should stop the same way a single reject/watch does.
  for (const id of videoIds) await cancelAutoDownloadIfUnwanted(uid, id);
  await saveBulkUndo(uid, body.action, snapshot);
  refreshDiscoveryInBackground(uid);
  return c.json({ affected: videoIds.length });
});

api.post("/cleanup/undo", async (c) => {
  const uid = currentUserId(c);
  const entry = await loadBulkUndo(uid);
  if (!entry) return c.json({ error: "nothing to undo" }, 404);
  await restoreUserVideoState(uid, entry.snapshot);
  await clearBulkUndo(uid);
  refreshDiscoveryInBackground(uid);
  return c.json({ restored: entry.count });
});

api.get("/in-progress", async (c) => {
  const uid = currentUserId(c);
  const rows = await database.prepare(`
    ${videoSelect(uid)}
    JOIN (SELECT video_id, MAX(watched_at) AS last_watched FROM history WHERE user_id = ${uid} GROUP BY video_id) lw ON lw.video_id = v.video_id
    WHERE v.published_at IS NOT NULL AND v.published_at != ''
      AND uv.watch_position IS NOT NULL AND uv.watch_duration IS NOT NULL
      AND uv.watch_duration > 30
      AND uv.watch_position >= 3
      AND CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92
      AND COALESCE(uv.status, 'inbox') = 'inbox'
    ORDER BY lw.last_watched DESC
    LIMIT 20
  `).all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

api.get("/search/youtube", async (c) => {
  const uid = currentUserId(c);
  // Restricted child profiles search only the local library.
  if (childLocalOnly(uid)) return c.json({ results: [] });
  const q = c.req.query("q");
  if (!q?.trim()) return c.json({ results: [] });
  try {
    const search = await searchYouTube(q.trim());
    return c.json({
      results: await attachWatchedState(uid, search.results, (result) => result.videoId),
      channels: search.channels,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ---------- child profiles (time limits & requests) ----------

api.get("/child/status", async (c) => c.json(await childStatus(currentUserId(c))));

api.get("/child/now-watching", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ watching: [] });
  const active = await activeChildPlayback();
  if (active.length === 0) return c.json({ watching: [] });
  const rows = (await Promise.all(active.map(async ({ userId, videoId }) => {
    const row = await database.prepare(
      `SELECT u.id AS user_id, u.name, u.avatar, u.avatar_color,
              v.video_id, v.title, v.thumbnail, v.channel_id,
              COALESCE(ch.custom_title, ch.title) AS channel_title, ch.thumbnail AS channel_thumbnail
       FROM users u JOIN videos v ON v.video_id = ?
       JOIN channels ch ON ch.channel_id = v.channel_id
       WHERE u.id = ? AND u.is_child = 1`
    ).get(videoId, userId) as any;
    if (!row) return [];
    const status = await childStatus(userId);
    return [{
      ...row,
      avatar: row.avatar ? `/api/profiles/${row.user_id}/avatar?v=${encodeURIComponent(row.avatar)}` : "",
      remaining_seconds: status.remaining_seconds,
      unlimited_today: status.unlimited_today,
    }];
  }))).flat();
  return c.json({ watching: rows });
});

api.post("/child/now-watching/:id/stop", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const childId = Number(c.req.param("id"));
  if (!Number.isInteger(childId) || !await isChildUser(childId)) return c.json({ error: "not found" }, 404);
  await lockChildByParent(childId);
  publishAppEvent("child-status");
  publishAppEvent("child-watching");
  log.info("child.playback_stopped", { user_id: childId, by_user_id: currentUserId(c) });
  return c.json({ ok: true });
});

// Child asks for more watch time; parents see it on their home feed for 1 h.
api.post("/child/time-request", async (c) => {
  const uid = currentUserId(c);
  if (!await isChildUser(uid)) return c.json({ error: "not a child profile" }, 403);
  const { video_id } = await c.req.json().catch(() => ({}));
  const existing = await database.prepare(
    "SELECT id FROM child_time_requests WHERE user_id = ? AND status = 'pending' AND created_at > datetime('now', '-1 hour')"
  ).get(uid) as { id: number } | null;
  if (existing) return c.json({ ok: true, id: existing.id });
  const videoId = typeof video_id === "string" && video_id ? video_id : lastWatchedVideo(uid);
  const row = await database.prepare(
    "INSERT INTO child_time_requests (user_id, video_id) VALUES (?, ?) RETURNING id"
  ).get(uid, videoId) as { id: number };
  publishAppEvent("child-requests");
  log.info("child.time_requested", { user_id: uid, video_id: videoId });
  return c.json({ ok: true, id: row.id });
});

// Pending requests, for parent (non-child) profiles.
api.get("/child/time-requests", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ requests: [] });
  const rows = await database.prepare(
    `SELECT r.id, r.user_id, r.video_id, r.created_at, u.name, u.avatar, u.avatar_color
     FROM child_time_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'pending' AND r.created_at > datetime('now', '-1 hour')
     ORDER BY r.created_at DESC`
  ).all() as (UserRow & { id: number; user_id: number; video_id: string | null; created_at: string })[];
  return c.json({
    requests: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      video_id: r.video_id,
      created_at: r.created_at,
      name: r.name,
      avatar: r.avatar ? `/api/profiles/${r.user_id}/avatar?v=${encodeURIComponent(r.avatar)}` : "",
      avatar_color: r.avatar_color,
      // Approving is confirmed with the app-wide child lock PIN when set.
      requires_pin: isChildLockEnabled(),
    })),
  });
});

api.post("/child/time-requests/:id/resolve", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const reqId = Number(c.req.param("id"));
  const request = await database.prepare(
    "SELECT * FROM child_time_requests WHERE id = ? AND status = 'pending'"
  ).get(reqId) as { id: number; user_id: number; video_id: string | null } | null;
  if (!request) return c.json({ error: "not found" }, 404);
  const { action, grant, pin } = await c.req.json().catch(() => ({}));

  if (action === "dismiss") {
    await database.prepare("UPDATE child_time_requests SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?").run(reqId);
    publishAppEvent("child-requests");
    return c.json({ ok: true });
  }
  if (action !== "approve" || !CHILD_GRANTS.includes(grant)) return c.json({ error: "invalid action" }, 400);

  // Approvals are confirmed with the app-wide child lock PIN, so the child
  // can't approve their own request from an unattended parent screen. Wrong
  // attempts count against the child profile's lockout.
  if (isChildLockEnabled()) {
    if (!isSixDigitPin(pin) || !(await verifyChildLockPin(pin))) {
      await registerChildLockFailure(request.user_id);
      publishAppEvent("child-status");
      publishAppEvent("child-watching");
      return c.json({ error: "invalid PIN", pin_locked: isPinLocked(request.user_id) }, 401);
    }
    clearChildLockFailures(request.user_id);
  }
  await applyGrant(request.user_id, grant as ChildGrant, request.video_id);
  await database.prepare(
    "UPDATE child_time_requests SET status = 'approved', grant_type = ?, resolved_at = datetime('now') WHERE id = ?"
  ).run(grant, reqId);
  publishAppEvent("child-status");
  publishAppEvent("child-watching");
  publishAppEvent("child-requests");
  log.info("child.time_granted", { user_id: request.user_id, grant });
  return c.json({ ok: true });
});

// Clear a child profile's failed-PIN lockout (primary only).
api.post("/profiles/:id/unlock-child", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "primary only" }, 403);
  const id = Number(c.req.param("id"));
  if (!await isChildUser(id)) return c.json({ error: "not a child profile" }, 400);
  await unlockChildProfile(id);
  publishAppEvent("child-status");
  publishAppEvent("child-watching");
  log.info("child.pin_unlocked", { id });
  return c.json({ ok: true });
});

// ---------- household viewing insights ----------

api.get("/insights", async (c) => {
  const uid = currentUserId(c);
  // The page compares every household profile, so keep it on the parent side
  // of the product just like child controls and the activity panel.
  if (await isChildUser(uid)) return c.json({ error: "parent profile required" }, 403);

  const requestedDays = Number(c.req.query("days") ?? 30);
  const days = INSIGHT_RANGES.includes(requestedDays as (typeof INSIGHT_RANGES)[number]) ? requestedDays : 30;
  const requestedProfile = c.req.query("profile");
  const profileId = requestedProfile && requestedProfile !== "all" ? Number(requestedProfile) : null;
  if (profileId != null && (!Number.isInteger(profileId) || profileId <= 0)) {
    return c.json({ error: "invalid profile" }, 400);
  }
  try {
    return c.json(await buildHouseholdInsights(days, profileId));
  } catch (error) {
    if (error instanceof Error && error.message === "profile not found") {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }
});

api.post("/videos/:id/sponsorblock-skip", async (c) => {
  const videoId = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const uid = currentUserId(c);
  const category = typeof body.category === "string" ? body.category : "";
  const seconds = Number(body.skipped_seconds);
  const segmentStart = Number(body.segment_start);
  const segmentEnd = Number(body.segment_end);
  const suppliedSegmentUuid = typeof body.segment_uuid === "string" ? body.segment_uuid.trim() : "";
  const segmentUuid = suppliedSegmentUuid || `${videoId}:${category}:${segmentStart}:${segmentEnd}`;
  const suppliedEventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const eventId = suppliedEventId || `${uid}:${videoId}:${segmentUuid}:${Date.now()}`;
  if (!category || category.length > 50 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 21_600 ||
      segmentUuid.length > 240 || eventId.length > 400) {
    return c.json({ error: "invalid SponsorBlock skip" }, 400);
  }
  const result = await database.prepare(`
    INSERT OR IGNORE INTO sponsorblock_skip_log
      (event_id, user_id, video_id, segment_uuid, category, skipped_seconds, day)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, uid, videoId, segmentUuid, category, seconds, zonedDayHour().day);
  const recorded = result.changes > 0;
  if (recorded) log.info("sponsorblock.skip_recorded", { userId: uid, videoId, category, seconds });
  return c.json({ ok: true, recorded });
});

// ---------- built-in plugins ----------

api.get("/plugins", async (c) => {
  const uid = currentUserId(c);
  return c.json({ plugins: await listPlugins(getUserSetting(uid, "language")) });
});

api.put("/plugins/:id", async (c) => {
  const { enabled } = await c.req.json() as { enabled?: boolean };
  try {
    const pluginId = c.req.param("id");
    await setPluginEnabled(pluginId, !!enabled);
    if (pluginId === "downloads") publishAppEvent("downloads", { enabled: !!enabled });
    return c.json({ plugins: await listPlugins(getUserSetting(currentUserId(c), "language")) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.get("/plugins/:id/settings", async (c) => {
  try {
    const uid = currentUserId(c);
    return c.json(await getPluginSettings(uid, c.req.param("id"), getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.put("/plugins/:id/settings", async (c) => {
  try {
    const uid = currentUserId(c);
    const body = await c.req.json();
    if (!isAdmin(c) && body && typeof body === "object" && Object.keys(body).some((key) => pluginAdminSettingKeys(c.req.param("id")).has(key))) {
      return c.json({ error: "administrator setting" }, 403);
    }
    if (c.req.param("id") === "downloads") {
      if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
      if (!isAdmin(c) && body && typeof body === "object" && Object.keys(body).some((key) => DOWNLOADS_ADMIN_SETTING_KEYS.has(key))) {
        return c.json({ error: "administrator setting" }, 403);
      }
    }
    return c.json(await setPluginSettings(uid, c.req.param("id"), body, getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.post("/plugins/:id/reset", async (c) => {
  try {
    const uid = currentUserId(c);
    if (c.req.param("id") === "social" && !isAdmin(c)) return c.json({ error: "admin only" }, 403);
    if (c.req.param("id") === "downloads" && await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
    return c.json(await resetPluginState(uid, c.req.param("id"), getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

// ---------- Social ----------

function socialFailure(c: any, error: unknown) {
  if (error instanceof SocialError) return c.json({ error: error.message, code: error.code }, error.status);
  throw error;
}

api.get("/social/mentionable-profiles", async (c) => {
  try {
    return c.json({ profiles: await mentionableSocialProfiles(currentUserId(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.get("/social/reactions/recent", async (c) => {
  try {
    const userId = currentUserId(c);
    const [emojis, skinTone] = await Promise.all([recentSocialEmojis(userId), socialEmojiSkinTone(userId)]);
    return c.json({ emojis, skinTone });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.put("/social/reactions/skin-tone", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ skinTone: await setSocialEmojiSkinTone(currentUserId(c), body.skinTone) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.get("/social/posts", async (c) => {
  try {
    return c.json(await listSocialPosts(
      currentUserId(c),
      c.req.query("cursor"),
      Number(c.req.query("limit") ?? 20),
      isAdmin(c),
    ));
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.get("/social/posts/:id", async (c) => {
  try {
    return c.json({ post: await socialPost(currentUserId(c), c.req.param("id"), isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.post("/social/posts", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ post: await createSocialPost(currentUserId(c), body, isAdmin(c)) }, 201);
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.patch("/social/posts/:id", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ post: await updateSocialPost(currentUserId(c), c.req.param("id"), body.body, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.delete("/social/posts/:id", async (c) => {
  try {
    await deleteSocialPost(currentUserId(c), c.req.param("id"), isAdmin(c));
    return c.json({ ok: true });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.put("/social/posts/:id/reactions/:reaction", async (c) => {
  try {
    return c.json({ post: await setSocialReaction(currentUserId(c), c.req.param("id"), c.req.param("reaction"), true, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.delete("/social/posts/:id/reactions/:reaction", async (c) => {
  try {
    return c.json({ post: await setSocialReaction(currentUserId(c), c.req.param("id"), c.req.param("reaction"), false, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.get("/social/posts/:id/comments", async (c) => {
  try {
    return c.json(await listSocialComments(
      currentUserId(c),
      c.req.param("id"),
      c.req.query("cursor"),
      Number(c.req.query("limit") ?? 40),
      isAdmin(c),
    ));
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.post("/social/posts/:id/comments", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ comment: await createSocialComment(currentUserId(c), c.req.param("id"), body.body, isAdmin(c)) }, 201);
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.patch("/social/comments/:id", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ comment: await updateSocialComment(currentUserId(c), c.req.param("id"), body.body, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.delete("/social/comments/:id", async (c) => {
  try {
    await deleteSocialComment(currentUserId(c), c.req.param("id"), isAdmin(c));
    return c.json({ ok: true });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.put("/social/comments/:id/like", async (c) => {
  try {
    return c.json({ comment: await setSocialCommentLike(currentUserId(c), c.req.param("id"), true, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.delete("/social/comments/:id/like", async (c) => {
  try {
    return c.json({ comment: await setSocialCommentLike(currentUserId(c), c.req.param("id"), false, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

// Legacy plugin URLs remain available for older clients. The current UI uses
// the dedicated downloads configuration endpoints below.
// yt-dlp accepts a Netscape-format cookie jar. Keep the secret in a private
// server-side file rather than the settings table, which is returned to UI.
api.get("/plugins/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  return await isChildUser(uid) ? c.json({ error: "not allowed" }, 403) : c.json({ configured: downloadCookiesConfigured(uid) });
});

api.post("/plugins/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "cookies.txt file required" }, 400);
    saveDownloadCookies(uid, await file.text());
    return c.json({ configured: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

api.delete("/plugins/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  removeDownloadCookies(uid);
  return c.json({ configured: false });
});

// ---------- downloads plugin ----------

async function profileDownloadsEnabled(userId: number) {
  const row = await database.prepare("SELECT value FROM plugin_settings WHERE plugin_id='downloads' AND user_id=? AND key='profile_enabled'").get(userId) as { value: string } | null;
  return pluginEnabled("downloads") && row?.value !== "0";
}

async function setProfileDownloadsEnabled(userId: number, enabled: boolean) {
  await database.prepare(`
    INSERT INTO plugin_settings(plugin_id,user_id,key,value) VALUES('downloads',?,'profile_enabled',?)
    ON CONFLICT(plugin_id,user_id,key) DO UPDATE SET value=excluded.value
  `).run(userId, enabled ? "1" : "0");
}

api.get("/downloads/config", async (c) => {
  const uid = currentUserId(c);
  return c.json({
    can_manage: !await isChildUser(uid),
    can_manage_admin_settings: isAdmin(c),
    admin_setting_keys: [...DOWNLOADS_ADMIN_SETTING_KEYS],
    enabled: await profileDownloadsEnabled(uid),
    plugin_available: pluginEnabled("downloads"),
    ...(await getPluginSettings(uid, "downloads", getUserSetting(uid, "language"))),
    cookies_configured: downloadCookiesConfigured(uid),
  });
});

api.put("/downloads/config", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.json<{ enabled?: boolean; settings?: Record<string, unknown> }>();
  if (typeof body.enabled === "boolean") {
    if (body.enabled && !pluginEnabled("downloads")) {
      if (!isAdmin(c)) return c.json({ error: "downloads are disabled by administrator" }, 403);
      await setPluginEnabled("downloads", true);
    }
    await setProfileDownloadsEnabled(uid, body.enabled);
  }
  if (!isAdmin(c) && body.settings && Object.keys(body.settings).some((key) => DOWNLOADS_ADMIN_SETTING_KEYS.has(key))) {
    return c.json({ error: "administrator setting" }, 403);
  }
  const settings = body.settings && typeof body.settings === "object"
    ? await setPluginSettings(uid, "downloads", body.settings, getUserSetting(uid, "language"))
    : await getPluginSettings(uid, "downloads", getUserSetting(uid, "language"));
  const enabled = await profileDownloadsEnabled(uid);
  publishAppEvent("downloads", { enabled, config: true, userId: uid });
  return c.json({ can_manage: true, can_manage_admin_settings: isAdmin(c), admin_setting_keys: [...DOWNLOADS_ADMIN_SETTING_KEYS], enabled, plugin_available: pluginEnabled("downloads"), ...settings, cookies_configured: downloadCookiesConfigured(uid) });
});

api.get("/downloads/automation", async (c) => {
  const uid = currentUserId(c);
  return c.json({ rules: await listDownloadRules(uid), can_manage: !await isChildUser(uid) });
});

api.get("/downloads/automation/options", async (c) => {
  const uid = currentUserId(c);
  const channels = await database.prepare(`
    SELECT DISTINCT c.channel_id, COALESCE(NULLIF(c.custom_title, ''), c.title) AS title, c.thumbnail
    FROM user_channels uc JOIN channels c ON c.channel_id=uc.channel_id
    WHERE uc.user_id=? AND uc.followed=1 ORDER BY title COLLATE NOCASE
  `).all(uid);
  const playlists = await database.prepare(`
    SELECT DISTINCT cp.playlist_id, cp.title, cp.thumbnail,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title
    FROM channel_playlists cp
    JOIN channels c ON c.channel_id=cp.channel_id
    WHERE EXISTS (SELECT 1 FROM user_followed_playlists ufp WHERE ufp.user_id=? AND ufp.playlist_id=cp.playlist_id)
       OR EXISTS (SELECT 1 FROM user_channels uc WHERE uc.user_id=? AND uc.channel_id=cp.channel_id AND uc.followed=1)
    ORDER BY channel_title COLLATE NOCASE, cp.title COLLATE NOCASE
  `).all(uid, uid);
  return c.json({ channels, playlists });
});

api.post("/downloads/automation/preview", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  return c.json(await previewDownloadRule(uid, await c.req.json<Partial<DownloadRuleInput>>()));
});

api.post("/downloads/automation", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  try {
    const rule = await createDownloadRule(uid, await c.req.json<Partial<DownloadRuleInput>>());
    publishAppEvent("downloads", { automation: true, ruleId: rule.id });
    return c.json({ rule }, 201);
  } catch (error) {
    if (error instanceof DownloadRuleValidationError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

api.put("/downloads/automation/:id", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid rule id" }, 400);
  try {
    const rule = await updateDownloadRule(uid, id, await c.req.json<Partial<DownloadRuleInput>>());
    if (!rule) return c.json({ error: "not found" }, 404);
    publishAppEvent("downloads", { automation: true, ruleId: rule.id });
    return c.json({ rule });
  } catch (error) {
    if (error instanceof DownloadRuleValidationError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

api.delete("/downloads/automation/:id", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid rule id" }, 400);
  if (!await deleteDownloadRule(uid, id)) return c.json({ error: "not found" }, 404);
  publishAppEvent("downloads", { automation: true, ruleId: id });
  return c.json({ ok: true });
});

api.get("/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  return await isChildUser(uid) ? c.json({ error: "not allowed" }, 403) : c.json({ configured: downloadCookiesConfigured(uid) });
});

api.post("/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "cookies.txt file required" }, 400);
    saveDownloadCookies(uid, await file.text());
    return c.json({ configured: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

api.delete("/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  removeDownloadCookies(uid);
  return c.json({ configured: false });
});

api.get("/downloads", async (c) => {
  const uid = currentUserId(c);
  const includeAllProfiles = c.req.query("scope") === "all" && isAdmin(c);
  const downloads = await listDownloads(uid, includeAllProfiles);
  const progress = activeDownloadProgress();
  return c.json({
    enabled: await profileDownloadsEnabled(uid),
    can_view_all: isAdmin(c),
    scope: includeAllProfiles ? "all" : "mine",
    ytdlp_version: await ytdlpStatus(),
    stats: await downloadStats(uid, includeAllProfiles),
    active: progress && downloads.some((item) => item.video_id === progress.video_id) ? progress : null,
    downloads,
  });
});

api.get("/downloads/summary", async (c) => {
  const uid = currentUserId(c);
  return c.json({ enabled: await profileDownloadsEnabled(uid), ...await downloadStatusSummary(uid) });
});

api.delete("/downloads/queue", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  return c.json({ ok: true, cancelled: await cancelAllPendingDownloads(currentUserId(c)) });
});

api.post("/videos/:id/download", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const uid = currentUserId(c);
  if (!await profileDownloadsEnabled(uid)) return c.json({ error: "plugin disabled" }, 409);
  const id = c.req.param("id");
  const video = await database.prepare("SELECT live_status, is_private FROM videos WHERE video_id = ?").get(id) as { live_status: string; is_private: number } | null;
  if (!video) return c.json({ error: "not found" }, 404);
  if (video.is_private === 1) return c.json({ error: "private videos cannot be downloaded" }, 409);
  if (video.live_status === "live" || video.live_status === "upcoming") {
    return c.json({ error: "live streams cannot be downloaded while they are active" }, 409);
  }
  const body = await c.req.json().catch(() => ({} as { priority?: boolean }));
  if (body.priority) await prioritizeDownload(uid, id);
  else await enqueueDownload(uid, id, "manual");
  return c.json({ ok: true, download: await getDownload(uid, id) });
});

// Download state for one video, with live progress while it's the active job.
api.get("/videos/:id/download", async (c) => {
  const id = c.req.param("id");
  const download = await getDownload(currentUserId(c), id);
  const progress = activeDownloadProgress();
  return c.json({
    download,
    progress: download?.status === "downloading" && progress?.video_id === id ? progress : null,
  });
});

api.delete("/videos/:id/download", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const requestedProfile = Number(c.req.query("profile_id"));
  const ownerId = Number.isInteger(requestedProfile) && requestedProfile > 0 && isAdmin(c) ? requestedProfile : uid;
  await removeDownload(ownerId, c.req.param("id"));
  return c.json({ ok: true });
});

api.put("/videos/:id/download/pin", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const { pinned } = await c.req.json() as { pinned?: boolean };
  const requestedProfile = Number(c.req.query("profile_id"));
  const ownerId = Number.isInteger(requestedProfile) && requestedProfile > 0 && isAdmin(c) ? requestedProfile : uid;
  await setDownloadPinned(ownerId, c.req.param("id"), !!pinned);
  return c.json({ ok: true, download: await getDownload(ownerId, c.req.param("id")) });
});

// Serves the downloaded file to the <video> element. Range support is what
// makes seeking work, so it's handled explicitly.
api.get("/videos/:id/stream", async (c) => {
  const row = await getDownload(currentUserId(c), c.req.param("id"));
  if (!row || row.status !== "done" || !row.path || !existsSync(row.path)) {
    return c.json({ error: "not downloaded" }, 404);
  }
  const size = statSync(row.path).size;
  const contentType = row.path.endsWith(".webm") ? "video/webm" : "video/mp4";
  const file = Bun.file(row.path);
  const range = c.req.header("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m?.[1] ? Number(m[1]) : 0;
    let end = m?.[2] ? Number(m[2]) : size - 1;
    if (!Number.isFinite(start) || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    end = Math.min(end, size - 1);
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(file, {
    headers: { "Content-Type": contentType, "Accept-Ranges": "bytes", "Content-Length": String(size) },
  });
});

// EXPERIMENTAL: play + seek a not-yet-downloaded video via on-demand HLS. The
// playlist is a static VOD for the whole (known) duration, so the browser can
// seek anywhere; each segment is transcoded on demand from the direct stream.
// A clean copy is saved in the background so /stream serves it locally later.
//   GET .../hls/index.m3u8  -> the static VOD playlist
//   GET .../hls/segNNNNN.ts -> a media segment (produced on demand)
api.get("/videos/:id/hls/:file", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  if (!await liveStreamEnabled(uid)) return c.json({ error: "streaming disabled" }, 409);
  const id = c.req.param("id");
  const file = c.req.param("file");

  if (file === "index.m3u8") {
    const done = await getDownload(uid, id);
    if (done && done.status === "done" && done.path && existsSync(done.path)) {
      return c.json({ error: "already downloaded" }, 409);
    }
    if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
    const playlist = await getHlsPlaylist(uid, id);
    if (!playlist) return c.json({ error: "stream unavailable" }, 502);
    return new Response(playlist, {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }

  if (!await getDownload(uid, id)) return c.json({ error: "not found" }, 404);
  const path = await getHlsSegment(id, file, c.req.raw.signal);
  if (!path) return c.json({ error: "not found" }, 404);
  return new Response(Bun.file(path), {
    headers: { "Content-Type": "video/mp2t", "Cache-Control": "no-store" },
  });
});

// ---------- subtitles for the local player ----------

async function subtitleList(videoId: string) {
  return (await listSubtitleFiles(videoId)).map((s) => ({
    lang: s.lang,
    url: `/api/videos/${videoId}/subtitles/${encodeURIComponent(s.lang)}`,
  }));
}

api.get("/videos/:id/subtitles", async (c) => {
  if (!await getDownload(currentUserId(c), c.req.param("id"))) return c.json({ subtitles: [] });
  return c.json({ subtitles: await subtitleList(c.req.param("id")) });
});

api.get("/videos/:id/subtitles/:lang", async (c) => {
  if (!await getDownload(currentUserId(c), c.req.param("id"))) return c.json({ error: "not found" }, 404);
  const file = (await listSubtitleFiles(c.req.param("id"))).find((s) => s.lang === c.req.param("lang"));
  if (!file || !existsSync(file.path)) return c.json({ error: "not found" }, 404);
  let text = await Bun.file(file.path).text();
  if (file.ext === "srt") text = srtToVtt(text);
  return new Response(text, {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store" },
  });
});

// Viewer picked a language that wasn't downloaded with the video: fetch just
// the subtitles (no video re-download) and hand back the refreshed list.
api.post("/videos/:id/subtitles", async (c) => {
  const uid = currentUserId(c);
  if (childLocalOnly(uid)) return c.json({ error: "restricted" }, 403);
  if (!await profileDownloadsEnabled(uid)) return c.json({ error: "plugin disabled" }, 409);
  const id = c.req.param("id");
  if (!await getDownload(uid, id)) return c.json({ error: "not downloaded" }, 404);
  const { lang } = await c.req.json().catch(() => ({}));
  if (typeof lang !== "string" || !SUBTITLE_LANGUAGE_CODES.has(lang)) {
    return c.json({ error: "invalid language" }, 400);
  }
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  const ok = await fetchSubtitles(uid, id, lang);
  const subtitles = await subtitleList(id);
  return c.json({ ok, downloaded: subtitles.some((s) => s.lang === lang), subtitles });
});

// Download a locally saved video as a file rather than streaming it in the
// player. Kept separate from /stream so local playback retains range support.
api.get("/videos/:id/file", async (c) => {
  const row = await getDownload(currentUserId(c), c.req.param("id"));
  if (!row || row.status !== "done" || !row.path || !existsSync(row.path)) {
    return c.json({ error: "not downloaded" }, 404);
  }
  const title = (await database.prepare("SELECT title FROM videos WHERE video_id = ?").get(c.req.param("id")) as { title: string } | null)?.title
    ?? c.req.param("id");
  const extension = row.path.endsWith(".webm") ? "webm" : "mp4";
  const filename = `${title.replace(/[\\/:*?\"<>|]/g, "_")}.${extension}`;
  return new Response(Bun.file(row.path), {
    headers: {
      "Content-Type": extension === "webm" ? "video/webm" : "video/mp4",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

api.get("/recommendations", async (c) => {
  const uid = currentUserId(c);
  const requestedPage = Number(c.req.query("page") ?? 0);
  const requestedLimit = Number(c.req.query("limit") ?? 40);
  const page = Number.isFinite(requestedPage) ? Math.max(0, Math.floor(requestedPage)) : 0;
  const limit = Number.isFinite(requestedLimit) ? Math.min(60, Math.max(1, Math.floor(requestedLimit))) : 40;
  const data = await recommendationFeed(uid, {
    page,
    limit,
    refresh: page === 0 && c.req.query("refresh") === "1",
    allowExternal: !childLocalOnly(uid),
    downloadsOnly: childDownloadsOnly(uid),
  });

  // Hydrate the ranked ids through the same complete per-profile projection as
  // Feed (download state, progress, source playlist, channel metadata), then
  // restore the deterministic ranking order. Scores/reasons stay server-side.
  const ids = data.recommendations
    .map((recommendation) => recommendation.video?.video_id as string | undefined)
    .filter((id): id is string => Boolean(id));
  let videos: Awaited<ReturnType<typeof attachTags>> = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await database.prepare(`${videoSelect(uid)}
      WHERE v.video_id IN (${placeholders})
        AND v.is_short = 0 AND v.live_status = 'none' AND COALESCE(v.is_private, 0) = 0
    `).all(...ids) as VideoRow[];
    const tagged = await attachTags(uid, rows);
    const byId = new Map(tagged.map((video) => [video.video_id, video]));
    videos = ids.map((id) => byId.get(id)).filter((video): video is (typeof tagged)[number] => Boolean(video));
  }

  return c.json({
    enabled: data.enabled,
    external_enabled: data.external_enabled,
    videos,
    page: data.page,
    limit: data.limit,
    has_more: data.has_more,
    summary: data.summary,
  });
});

api.get("/discovery/recommendations", async (c) => {
  const uid = currentUserId(c);
  // Discovery mixes in external videos — off for restricted child profiles.
  if (childLocalOnly(uid)) return c.json({ enabled: false, recommendations: [] });
  const data = c.req.query("refresh") === "1"
    ? await refreshDiscoveryNow(uid)
    : await discoveryRecommendations(uid);
  const localVideos = data.recommendations
    .filter((r) => r.kind === "local" && r.video)
    .map((r) => r.video as VideoRow);
  const tagged = await attachTags(uid, localVideos);
  let localIndex = 0;
  return c.json({
    enabled: data.enabled,
    recommendations: data.recommendations.map((r) => {
      if (r.kind !== "local") return r;
      return { ...r, video: tagged[localIndex++] };
    }),
  });
});

api.post("/discovery/recommendations/:id/dismiss", async (c) => {
  await dismissDiscoveryRecommendation(currentUserId(c), c.req.param("id"));
  return c.json({ ok: true });
});

api.get("/live", async (c) => {
  const uid = currentUserId(c);
  if (childHidesLive(uid)) return c.json({ videos: [] });
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE v.live_status IN ('live','upcoming') AND ${followedExists(uid)} ORDER BY v.live_status = 'live' DESC, v.published_at DESC`)
    .all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

// Unlike the global Live page, a channel page can be opened before the channel
// is followed, so this intentionally does not require a subscription.
api.get("/channels/:id/live", async (c) => {
  const uid = currentUserId(c);
  if (childHidesLive(uid)) return c.json({ videos: [] });
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE v.channel_id = ? AND v.live_status = 'live' ORDER BY COALESCE(v.published_at, v.created_at) DESC`)
    .all(c.req.param("id")) as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

api.get("/watchlist", async (c) => {
  const uid = currentUserId(c);
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE uv.status = 'queued' ORDER BY uv.queued_at DESC`)
    .all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

api.get("/archive", async (c) => {
  const uid = currentUserId(c);
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE uv.status = 'archived' ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT 60 OFFSET ?`)
    .all(page * 60) as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows), page });
});

// External ("orphan") videos pulled in for one-off watching: anything that
// belongs to an external channel (not followed, brought in just to watch).
// Watched ones (with a saved position) float to the top.
api.get("/external", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const uid = currentUserId(c);
  const rows = await database
    .prepare(`${videoSelect(uid)} WHERE c.external = 1
      ORDER BY (uv.watch_position IS NOT NULL) DESC, v.created_at DESC LIMIT 200`)
    .all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

// Clear orphan externals. Protects anything the user actively saved
// (queued, liked or added to a playlist), then drops now-empty external channels.
api.delete("/external", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  // Protect anything ANY profile actively saved (queued, liked, or in a playlist).
  const res = await database.prepare(`
    DELETE FROM videos
    WHERE channel_id IN (SELECT channel_id FROM channels WHERE external = 1)
      AND video_id NOT IN (SELECT video_id FROM user_videos WHERE status = 'queued' OR liked = 1)
      AND video_id NOT IN (SELECT video_id FROM user_playlist_videos)
      AND video_id NOT IN (SELECT video_id FROM social_posts)
  `).run();
  await database.prepare(`
    DELETE FROM channels
    WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)
  `).run();
  return c.json({ deleted: res.changes });
});

// Remove a single external video, then drop its channel if now empty + external.
api.delete("/external/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const id = c.req.param("id");
  if (await database.prepare("SELECT 1 FROM social_posts WHERE video_id=? LIMIT 1").get(id)) {
    return c.json({ error: "video is shared in Social", code: "social_video_in_use" }, 409);
  }
  const res = await database.prepare(`
    DELETE FROM videos
    WHERE video_id = ?
      AND channel_id IN (SELECT channel_id FROM channels WHERE external = 1)
  `).run(id);
  await database.prepare(`
    DELETE FROM channels
    WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)
  `).run();
  return c.json({ deleted: res.changes });
});

api.get("/videos/:id/info", async (c) => {
  const uid = currentUserId(c);
  // Restricted child profiles may only open videos already in the library.
  if (childLocalOnly(uid) && !await videoExistsStmt.get(c.req.param("id"))) {
    return c.json({ error: "restricted" }, 403);
  }
  try {
    const info = await fetchVideoInfo(c.req.param("id"));
    if (childHidesLive(uid) && info.liveStatus !== "none") {
      return c.json({ error: "live streams are disabled for this profile" }, 403);
    }
    // Channel avatar + the channel's recent uploads (for the "related" panel).
    const [about, feed] = await Promise.all([
      fetchChannelAbout(info.channelId).catch(() => null),
      fetchChannelFeed(info.channelId).catch(() => null),
    ]);
    const avatar = about?.avatar ?? "";

    // Upsert channel: insert as external if new, or update avatar if missing
    await database.prepare(`
      INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
      VALUES (?, ?, ?, ?, 0, 1)
      ON CONFLICT(channel_id) DO UPDATE SET
        thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL
                         THEN excluded.thumbnail ELSE channels.thumbnail END
    `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, avatar);

    const insertVideo = database.prepare(`
      INSERT OR IGNORE INTO videos
        (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, external)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'inbox', ?, ?, 1)
    `);

    // Insert the watched video (no-op if already in DB as a real video)
    const inserted = await insertVideo.run(
      info.videoId, info.channelId, info.title, info.description,
      info.thumbnail, info.publishedAt, info.liveStatus, info.viewCount, info.duration
    );
    if (info.duration) {
      await database.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL")
        .run(info.duration, info.videoId);
    }

    // Insert the channel's recent uploads as external so the related panel fills.
    if (feed) {
      const insertMany = database.transaction(async (videos: typeof feed.videos) => {
        for (const v of videos) {
          await insertVideo.run(
            v.videoId, info.channelId, v.title, v.description,
            v.thumbnail, v.publishedAt, "none", v.views, null
          );
        }
      });
      await insertMany(feed.videos);
    }
    log.info("external.video_info_loaded", {
      videoId: info.videoId,
      channelId: info.channelId,
      inserted: inserted.changes > 0,
      relatedImported: feed?.videos.length ?? 0,
    });
    return c.json({ info });
  } catch (e) {
    log.error("external.video_info_failed", { videoId: c.req.param("id"), error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.get("/videos/:id/dearrow", async (c) => {
  const uid = currentUserId(c);
  const titlesEnabled = getUserSetting(uid, "dearrow_titles_enabled") === "1";
  const thumbnailsEnabled = getUserSetting(uid, "dearrow_thumbnails_enabled") === "1";
  if (!titlesEnabled && !thumbnailsEnabled) return c.json({ title: null, thumbnail: null });
  const videoId = c.req.param("id");
  if (!validYouTubeVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
  const branding = await getDeArrowBranding(videoId);
  return c.json({
    title: titlesEnabled ? branding.title : null,
    thumbnail: thumbnailsEnabled ? branding.thumbnail : null,
  });
});

async function refreshVideoChapters(videoId: string) {
  const chapters = await fetchVideoChapters(videoId);
  // Persist only when the video is in our DB (UPDATE no-ops otherwise).
  await database.prepare("UPDATE videos SET chapters_json = ?, chapters_fetched_at = datetime('now') WHERE video_id = ?")
    .run(JSON.stringify(chapters), videoId);
  return chapters;
}

api.get("/videos/:id/chapters", async (c) => {
  const videoId = c.req.param("id");
  const cached = await database.prepare("SELECT chapters_json, chapters_fetched_at, is_private FROM videos WHERE video_id = ?")
    .get(videoId) as { chapters_json: string | null; chapters_fetched_at: string | null; is_private: number } | null;
  if (cached?.is_private === 1) return c.json({ chapters: [] });

  if (cached?.chapters_json) {
    if (ageMs(cached.chapters_fetched_at) > CHAPTERS_DB_TTL) {
      refreshVideoChapters(videoId).catch((error) => {
        log.warn("video.chapters_background_refresh_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
      });
    }
    try {
      return c.json({ chapters: JSON.parse(cached.chapters_json) });
    } catch { /* corrupted cache — fall through */ }
  }

  try {
    return c.json({ chapters: await refreshVideoChapters(videoId) });
  } catch {
    return c.json({ chapters: [] });
  }
});

api.get("/videos/:id/comments", async (c) => {
  const videoId = c.req.param("id");
  if (!validYouTubeVideoId(videoId)) return c.json({ error: "invalid video id" }, 400);
  if (childLocalOnly(currentUserId(c))) return c.json({ error: "restricted" }, 403);
  try {
    return c.json(await fetchVideoComments(currentUserId(c), videoId, c.req.query("refresh") === "1"));
  } catch (error) {
    const failure = error instanceof VideoCommentsError
      ? error
      : new VideoCommentsError("unavailable", error instanceof Error ? error.message : String(error));
    const status = failure.code === "comments_disabled" ? 409
      : failure.code === "rate_limited" ? 429
      : failure.code === "ytdlp_missing" ? 503
      : failure.code === "timeout" ? 504
      : 502;
    return c.json({ error: "comments unavailable", code: failure.code }, status);
  }
});

interface StoredVideoCreator {
  channelId: string;
  title: string;
  avatar: string;
  subscriberCount: string;
  handle: string;
  isOwner: boolean;
}

async function storedVideoCreators(videoId: string): Promise<StoredVideoCreator[]> {
  return (await database.prepare(`
    SELECT vc.channel_id AS channelId,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS title,
           c.thumbnail AS avatar,
           COALESCE(c.subscriber_count, '') AS subscriberCount,
           COALESCE(vc.handle, '') AS handle,
           vc.is_owner AS isOwner
    FROM video_creators vc
    JOIN channels c ON c.channel_id = vc.channel_id
    WHERE vc.video_id = ?
    ORDER BY vc.sort_order, vc.channel_id
  `).all(videoId) as (Omit<StoredVideoCreator, "isOwner"> & { isOwner: number })[])
    .map((creator) => ({ ...creator, isOwner: creator.isOwner === 1 }));
}

api.get("/videos/:id/creators", async (c) => {
  const videoId = c.req.param("id");
  const video = await database.prepare(`
    SELECT v.video_id, v.channel_id,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS title,
           c.thumbnail AS avatar,
           COALESCE(c.subscriber_count, '') AS subscriberCount,
           v.creators_fetched_at, v.is_private
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ?
  `).get(videoId) as {
    video_id: string;
    channel_id: string;
    title: string;
    avatar: string;
    subscriberCount: string;
    creators_fetched_at: string | null;
    is_private: number;
  } | null;
  if (!video) return c.json({ error: "not found" }, 404);

  const fallback: StoredVideoCreator = {
    channelId: video.channel_id,
    title: video.title,
    avatar: video.avatar,
    subscriberCount: video.subscriberCount,
    handle: "",
    isOwner: true,
  };
  if (video.is_private === 1) return c.json({ creators: [fallback] });
  const cached = await storedVideoCreators(videoId);
  const missingCollaboratorHandles = cached.length > 1 && cached.some((creator) => !creator.handle);
  if (cached.length > 0 && !missingCollaboratorHandles && ageMs(video.creators_fetched_at) <= CREATORS_DB_TTL) {
    return c.json({ creators: cached });
  }

  try {
    const fetched = await fetchVideoCreators(videoId);
    const creators = fetched.length > 1 ? fetched : [fallback];
    await database.transaction(async () => {
      await database.prepare("DELETE FROM video_creators WHERE video_id = ?").run(videoId);
      const ensureChannel = database.prepare(`
        INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
        VALUES (?, ?, ?, ?, 0, 1)
        ON CONFLICT(channel_id) DO UPDATE SET
          title = CASE WHEN channels.title = '' THEN excluded.title ELSE channels.title END,
          thumbnail = CASE WHEN channels.thumbnail = '' THEN excluded.thumbnail ELSE channels.thumbnail END
      `);
      const addCreator = database.prepare(`
        INSERT INTO video_creators (video_id, channel_id, handle, sort_order, is_owner) VALUES (?, ?, ?, ?, ?)
      `);
      for (const [index, creator] of creators.entries()) {
        await ensureChannel.run(
          creator.channelId,
          creator.title,
          `https://www.youtube.com/channel/${creator.channelId}`,
          creator.avatar,
        );
        await addCreator.run(videoId, creator.channelId, creator.handle, index, creator.isOwner ? 1 : 0);
      }
      await database.prepare("UPDATE videos SET creators_fetched_at = datetime('now') WHERE video_id = ?").run(videoId);
    })();
    return c.json({ creators: await storedVideoCreators(videoId) });
  } catch (error) {
    log.warn("video.creators.fetch_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
    return c.json({ creators: cached.length > 0 ? cached : [fallback] });
  }
});

api.get("/videos/:id", async (c) => {
  const uid = currentUserId(c);
  const row = await database
    .prepare(`${videoSelect(uid)} WHERE v.video_id = ?`)
    .get(c.req.param("id")) as VideoRow | null;
  if (!row) return c.json({ error: "not found" }, 404);
  if (childHidesLive(uid) && (row.live_status === "live" || row.live_status === "upcoming")) {
    return c.json({ error: "live streams are disabled for this profile" }, 403);
  }
  const [video] = await attachTags(uid, [row]);

  // Collect all tag IDs for this video (direct + via channel)
  const tagRows = await database.prepare(`
    SELECT DISTINCT x.tag_id FROM (
      SELECT tag_id FROM video_tags WHERE video_id = ?
      UNION
      SELECT tag_id FROM channel_tags WHERE channel_id = ?
    ) x JOIN tags t ON t.id = x.tag_id AND t.user_id = ?
  `).all(row.video_id, row.channel_id, uid) as { tag_id: number }[];

  const RELATED_TARGET = 15;
  const seen = new Set<string>([row.video_id]);
  const related: VideoRow[] = [];

  const fill = (rows: VideoRow[]) => {
    for (const r of rows) {
      if (seen.has(r.video_id) || r.is_short !== 0 || r.watched === 1) continue;
      seen.add(r.video_id);
      related.push(r);
      if (related.length >= RELATED_TARGET) break;
    }
  };

  const need = () => RELATED_TARGET - related.length;

  // Step 1 — same tags (own + channel-inherited), non-archived, most recent
  if (tagRows.length > 0) {
    const tagIds = tagRows.map((t) => t.tag_id);
    const ph = tagIds.map(() => "?").join(",");
    fill(await database.prepare(
      `${videoSelect(uid)} WHERE v.video_id != ? AND v.published_at IS NOT NULL AND v.published_at != '' AND COALESCE(uv.status, 'inbox') != 'archived' AND COALESCE(uv.watched, 0) != 1 AND v.is_short = 0
       AND (EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
         OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))
       ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`
    ).all(row.video_id, ...tagIds, ...tagIds, RELATED_TARGET) as VideoRow[]);
  }

  // Step 2 — same channel, fill what's missing
  if (need() > 0) {
    const seenPh = [...seen].map(() => "?").join(",");
    fill(await database.prepare(
      `${videoSelect(uid)} WHERE v.channel_id = ? AND v.video_id NOT IN (${seenPh}) AND v.published_at IS NOT NULL AND v.published_at != '' AND COALESCE(uv.status, 'inbox') != 'archived' AND COALESCE(uv.watched, 0) != 1 AND v.is_short = 0
       ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`
    ).all(row.channel_id, ...seen, need()) as VideoRow[]);
  }

  // Step 3 — other channels with any shared tag, fill what's missing
  if (need() > 0 && tagRows.length > 0) {
    const tagIds = tagRows.map((t) => t.tag_id);
    const ph = tagIds.map(() => "?").join(",");
    const seenPh = [...seen].map(() => "?").join(",");
    fill(await database.prepare(
      `${videoSelect(uid)} WHERE v.video_id NOT IN (${seenPh}) AND v.published_at IS NOT NULL AND v.published_at != '' AND COALESCE(uv.status, 'inbox') != 'archived' AND COALESCE(uv.watched, 0) != 1 AND v.is_short = 0
       AND (EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
         OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))
       ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`
    ).all(...seen, ...tagIds, ...tagIds, need()) as VideoRow[]);
  }

  // Step 4 — any recent non-archived non-short inbox/queued videos
  if (need() > 0) {
    const seenPh = [...seen].map(() => "?").join(",");
    fill(await database.prepare(
      `${videoSelect(uid)} WHERE v.video_id NOT IN (${seenPh}) AND v.published_at IS NOT NULL AND v.published_at != '' AND COALESCE(uv.status, 'inbox') != 'archived' AND COALESCE(uv.watched, 0) != 1 AND v.is_short = 0
       ORDER BY COALESCE(v.published_at, v.created_at) DESC LIMIT ?`
    ).all(...seen, need()) as VideoRow[]);
  }

  // Active profile's channel-level player overrides (NULL = use global).
  const channelPlayerRow = await database.prepare(
    "SELECT playback_speed, caption_mode, caption_language FROM user_channels WHERE user_id = ? AND channel_id = ?"
  ).get(uid, row.channel_id) as { playback_speed: string | null; caption_mode: string | null; caption_language: string | null } | null;
  (video as any).channel_playback_speed = channelPlayerRow?.playback_speed ?? null;
  (video as any).channel_caption_mode = channelPlayerRow?.caption_mode ?? null;
  (video as any).channel_caption_language = channelPlayerRow?.caption_language ?? null;

  return c.json({ video, related: await attachTags(uid, related) });
});

// ---------- video actions ----------

const BUCKETS = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];

// Upsert helpers for the active profile's per-video state. A row is created on
// first action; subsequent actions update it. (videoExists guards FK errors.)
const videoExistsStmt = database.prepare("SELECT 1 FROM videos WHERE video_id = ?");

// Whether this install has ever had a channel or video added, by any profile —
// gates the full "start from scratch" onboarding (see GET /channels), as
// opposed to a profile that simply hasn't followed anything yet.
const anyChannelStmt = database.prepare("SELECT 1 FROM channels LIMIT 1");
const anyVideoStmt = database.prepare("SELECT 1 FROM videos LIMIT 1");
async function instanceHasData(): Promise<boolean> {
  return !!await anyChannelStmt.get() || !!await anyVideoStmt.get();
}

api.post("/videos/:id/queue", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { bucket } = await c.req.json();
  if (!BUCKETS.includes(bucket)) return c.json({ error: "invalid bucket" }, 400);
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  const showFrom = computeShowFrom(bucket);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status, bucket, queued_at, show_from)
     VALUES (?, ?, 'queued', ?, datetime('now'), ?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'queued', bucket = excluded.bucket, queued_at = excluded.queued_at, show_from = excluded.show_from`
  ).run(uid, id, bucket, showFrom);
  await recordSchedulingSignal(uid, id, bucket);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/archive", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'archived')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'archived', bucket = NULL, show_from = NULL`
  ).run(uid, id);
  // Rejecting a video also stops a pending auto download nobody else waits for.
  await cancelAutoDownloadIfUnwanted(uid, id);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/restore", async (c) => {
  const uid = currentUserId(c);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'inbox')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'inbox', bucket = NULL, show_from = NULL`
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/dequeue", async (c) => {
  const uid = currentUserId(c);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'inbox')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'inbox', bucket = NULL, queued_at = NULL, show_from = NULL`
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/watch", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (await videoExistsStmt.get(id)) {
    await database.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(id, uid);
    refreshDiscoveryInBackground(uid);
  }
  return c.json({ ok: true });
});

api.post("/videos/:id/complete", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, watched) VALUES (?, ?, 1)
     ON CONFLICT(user_id, video_id) DO UPDATE SET watched = 1`
  ).run(uid, id);
  await database.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(id, uid);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/videos/:id/complete", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const preserveHistory = await isChildUser(uid);
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.transaction(async () => {
    const state = await database.prepare("SELECT watched FROM user_videos WHERE user_id = ? AND video_id = ?")
      .get(uid, id) as { watched: number | null } | null;
    await database.prepare(
      `INSERT INTO user_videos (user_id, video_id, status, watched) VALUES (?, ?, 'inbox', NULL)
       ON CONFLICT(user_id, video_id) DO UPDATE SET
         status = 'inbox', watched = NULL, watch_position = NULL, watch_duration = NULL,
         bucket = NULL, queued_at = NULL, show_from = NULL`
    ).run(uid, id);
    // Completing a video creates one history entry. Remove only the newest one
    // so undoing an accidental click does not erase older, legitimate watches.
    // Checking the old state also keeps repeated DELETE requests idempotent.
    if (state?.watched === 1 && !preserveHistory) {
      await database.prepare(
        `DELETE FROM history WHERE id = (
           SELECT id FROM history WHERE user_id = ? AND video_id = ?
           ORDER BY watched_at DESC, id DESC LIMIT 1
         )`
      ).run(uid, id);
    }
  })();
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.put("/videos/:id/like", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { liked } = await c.req.json() as { liked: boolean };
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, liked) VALUES (?, ?, ?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET liked = excluded.liked`
  ).run(uid, id, liked ? 1 : null);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.put("/videos/:id/progress", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { position, duration } = await c.req.json() as { position: number; duration: number };
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  await database.prepare(
    `INSERT INTO user_videos (user_id, video_id, watch_position, watch_duration) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET watch_position = excluded.watch_position, watch_duration = excluded.watch_duration`
  ).run(uid, id, position, duration);
  await recordWatchTick(uid, id);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/videos/:id/progress", async (c) => {
  const uid = currentUserId(c);
  await database.prepare(
    "UPDATE user_videos SET watch_position = NULL, watch_duration = NULL WHERE user_id = ? AND video_id = ?"
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/tags", async (c) => {
  const uid = currentUserId(c);
  const { tag_id } = await c.req.json();
  // Only allow tagging with a tag the active profile owns.
  if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) {
    return c.json({ error: "tag not found" }, 404);
  }
  await database.prepare("INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) VALUES (?, ?, 'manual')").run(
    c.req.param("id"),
    tag_id
  );
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/videos/:id/tags/:tagId", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?").run(
    c.req.param("id"),
    c.req.param("tagId")
  );
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

// ---------- history ----------

api.get("/history", async (c) => {
  const uid = currentUserId(c);
  const requestedPage = Number(c.req.query("page") ?? 0);
  const page = Number.isFinite(requestedPage) ? Math.max(0, Math.floor(requestedPage)) : 0;
  const pageSize = 60;
  const rows = await database
    .prepare(
      `SELECT MAX(h.id) AS history_id, MAX(h.watched_at) AS watched_at,
              v.video_id, v.channel_id, v.title, v.description, v.duration,
              v.thumbnail, v.published_at, v.published_at_approximate, v.members_only,
              v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket,
              uv.watch_position, uv.watch_duration, uv.watched,
              COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail
       FROM history h JOIN videos v ON v.video_id = h.video_id
       JOIN channels c ON c.channel_id = v.channel_id
       LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
       WHERE h.user_id = ?
       GROUP BY v.video_id
       ORDER BY MAX(h.watched_at) DESC, MAX(h.id) DESC LIMIT ? OFFSET ?`
    )
    .all(uid, uid, pageSize + 1, page * pageSize) as (VideoRow & { history_id: number; watched_at: string })[];
  const hasMore = rows.length > pageSize;
  return c.json({ videos: await attachTags(uid, rows.slice(0, pageSize) as VideoRow[]), page, has_more: hasMore });
});

api.delete("/history/:id", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  // The history view groups repeat watches into one card. Remove every watch
  // for that card so an older occurrence does not immediately take its place.
  await database.prepare(
    `DELETE FROM history
     WHERE user_id = ? AND video_id = (
       SELECT video_id FROM history WHERE id = ? AND user_id = ?
     )`
  ).run(uid, c.req.param("id"), uid);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

// ---------- channels ----------

// The effective display name is the user-set custom title when present; the
// original YouTube title stays in `title` (exposed as original_title) so the
// custom name can always be reverted.
function serializeChannel(ch: any) {
  return {
    ...ch,
    title: ch.custom_title || ch.title,
    original_title: ch.title,
    custom_title: ch.custom_title ?? null,
  };
}

async function channelSyncIsDisabled(channelId: string): Promise<boolean> {
  const row = await database.prepare("SELECT manual_status FROM channels WHERE channel_id=?").get(channelId) as { manual_status: string } | null;
  return Boolean(row && row.manual_status !== "active");
}

async function playlistChannelSyncIsDisabled(playlistId: string): Promise<boolean> {
  const row = await database.prepare("SELECT c.manual_status FROM channel_playlists cp JOIN channels c ON c.channel_id=cp.channel_id WHERE cp.playlist_id=?").get(playlistId) as { manual_status: string } | null;
  return Boolean(row && row.manual_status !== "active");
}

api.get("/channels", async (c) => {
  const uid = currentUserId(c);
  const channels = await database.prepare(
    `SELECT ch.*, uc.added_at AS subscribed_at,
       (SELECT MAX(v.published_at) FROM videos v WHERE v.channel_id = ch.channel_id) AS latest_video_at,
       (SELECT COUNT(*) FROM videos v WHERE v.channel_id = ch.channel_id) AS video_count
     FROM channels ch
     JOIN user_channels uc ON uc.channel_id = ch.channel_id AND uc.user_id = ? AND uc.followed = 1
     WHERE ch.external = 0 ORDER BY COALESCE(ch.custom_title, ch.title) COLLATE NOCASE`
  ).all(uid) as any[];
  const tags = await database
    .prepare(
      `SELECT ct.channel_id, t.id, t.name, t.color FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ?`
    )
    .all(uid) as any[];
  return c.json({
    channels: channels.map((ch) => ({
      ...serializeChannel(ch),
      // This endpoint only returns subscriptions of the active profile. Do not
      // leak the legacy global channels.followed value into profile UI state.
      followed: 1,
      ...(() => {
        try {
          const about = JSON.parse(ch.about_json ?? "{}") as { handle?: unknown; description?: unknown };
          return {
            handle: typeof about.handle === "string" ? about.handle : "",
            description: typeof about.description === "string" ? about.description : "",
          };
        } catch {
          return { handle: "", description: "" };
        }
      })(),
      tags: tags.filter((t) => t.channel_id === ch.channel_id).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    })),
    // Distinguishes a genuinely fresh install (show the full onboarding) from a
    // profile that simply isn't following anything yet on an instance that
    // already has channels/videos from another profile or an import.
    instance_has_data: await instanceHasData(),
  });
});

api.post("/channels", async (c) => {
  // A child may subscribe only after a parent unlocked settings for this browser.
  if (await isChildUser(currentUserId(c)) && !hasChildLockSession(c)) return c.json({ error: "settings locked" }, 423);
  const uid = currentUserId(c);
  const { url, custom_name } = await c.req.json();
  if (!url) return c.json({ error: "url required" }, 400);
  const info = await resolveChannelId(url);
  const inserted = await database.prepare(
    "INSERT OR IGNORE INTO channels (channel_id, title, url, thumbnail) VALUES (?, ?, ?, ?)"
  ).run(info.channelId, info.title, `https://www.youtube.com/channel/${info.channelId}`, info.thumbnail);
  // Subscribe the active profile (and unmark external if it was an orphan).
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1`
  ).run(uid, info.channelId);
  await database.prepare("UPDATE channels SET external = 0 WHERE channel_id = ?").run(info.channelId);
  const customTitle = typeof custom_name === "string" ? custom_name.trim() : "";
  if (customTitle) await database.prepare("UPDATE channels SET custom_title = ? WHERE channel_id = ?").run(customTitle, info.channelId);
  log.info("channel.added", { channelId: info.channelId, title: info.title, inserted: inserted.changes > 0, userId: uid });
  refreshChannel(info.channelId)
    .then(() => refreshLiveStatus(info.channelId))
    .catch((e) => log.error("channel.initial_refresh_failed", { channelId: info.channelId, error: e instanceof Error ? e.message : String(e) }));
  return c.json({ ok: true, channel_id: info.channelId, title: info.title });
});

// Admin: claim every existing channel for a profile. Intended for setups that
// had channels configured before auth, so ownership can be assigned explicitly
// instead of relying on "first user wins". Existing subscriptions are preserved.
api.post("/channels/assign-all", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const { user_id } = await c.req.json().catch(() => ({}));
  const uid = Number(user_id);
  if (!Number.isInteger(uid) || !await database.prepare("SELECT 1 FROM users WHERE id = ?").get(uid)) {
    return c.json({ error: "profile not found" }, 404);
  }
  const res = await database.prepare(
    `INSERT OR IGNORE INTO user_channels (user_id, channel_id, followed)
     SELECT ?, channel_id, 1 FROM channels WHERE external = 0`
  ).run(uid);
  log.info("channels.assigned_all", { user_id: uid, added: res.changes });
  return c.json({ ok: true, added: res.changes });
});

// Unsubscribe the active profile. The channel/videos stay (other profiles may
// follow it; the refresher stops touching it once nobody does).
api.delete("/channels/:id", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM user_channels WHERE user_id = ? AND channel_id = ?").run(uid, c.req.param("id"));
  return c.json({ ok: true });
});

// Set or clear the channel's custom display name. Empty / null reverts to the
// original YouTube title (kept untouched in `title`).
api.put("/channels/:id/name", async (c) => {
  const channelId = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId)) {
    return c.json({ error: "not found" }, 404);
  }
  const { custom_title } = await c.req.json().catch(() => ({}));
  const value = typeof custom_title === "string" && custom_title.trim() ? custom_title.trim() : null;
  await database.prepare("UPDATE channels SET custom_title = ? WHERE channel_id = ?").run(value, channelId);
  log.info("channel.renamed", { channelId, custom_title: value });
  const ch = await database.prepare("SELECT * FROM channels WHERE channel_id = ?").get(channelId) as any;
  return c.json({ ok: true, channel: serializeChannel(ch) });
});

api.put("/channels/:id/status", async (c) => {
  const channelId = c.req.param("id");
  const { status } = await c.req.json().catch(() => ({}));
  if (!isChannelManualStatus(status)) return c.json({ error: "invalid channel status" }, 400);
  const result = await database.prepare("UPDATE channels SET manual_status=?, manual_status_updated_at=datetime('now') WHERE channel_id=?").run(status, channelId);
  if (result.changes === 0) return c.json({ error: "not found" }, 404);
  log.info("channel.manual_status_changed", { channelId, status });
  return c.json({ ok: true, status });
});

api.post("/channels/:id/tags", async (c) => {
  const uid = currentUserId(c);
  const { tag_id } = await c.req.json();
  const channelId = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) {
    return c.json({ error: "tag not found" }, 404);
  }
  await database.prepare("INSERT OR IGNORE INTO channel_tags (channel_id, tag_id) VALUES (?, ?)").run(channelId, tag_id);
  // Propagate to all existing videos of this channel
  await database.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT video_id, ?, 'channel' FROM videos WHERE channel_id = ?"
  ).run(tag_id, channelId);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/channels/:id/tags/:tagId", async (c) => {
  const uid = currentUserId(c);
  const channelId = c.req.param("id");
  const tagId = c.req.param("tagId");
  await database.prepare("DELETE FROM channel_tags WHERE channel_id = ? AND tag_id = ?").run(channelId, tagId);
  // Remove channel-propagated tags from videos (keep manually added ones)
  await database.prepare(
    "DELETE FROM video_tags WHERE tag_id = ? AND source = 'channel' AND video_id IN (SELECT video_id FROM videos WHERE channel_id = ?)"
  ).run(tagId, channelId);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

/** Milliseconds since a SQLite datetime('now') timestamp (stored as UTC). */
function ageMs(ts: string | null): number {
  if (!ts) return Infinity;
  const t = Date.parse(ts.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

const ABOUT_DB_TTL = 7 * 24 * 60 * 60_000;
const PLAYLISTS_DB_TTL = 7 * 24 * 60 * 60_000;
const CHAPTERS_DB_TTL = 7 * 24 * 60 * 60_000;
const CREATORS_DB_TTL = 7 * 24 * 60 * 60_000;

const ensureExternalChannelRow = database.prepare(`
  INSERT OR IGNORE INTO channels (channel_id, title, url, followed, external)
  VALUES (?, ?, ?, 0, 1)
`);

async function persistChannelAbout(channelId: string, about: ChannelAbout) {
  await ensureExternalChannelRow.run(channelId, about.title || channelId, `https://www.youtube.com/channel/${channelId}`);
  await database.prepare(
    `UPDATE channels SET about_json = ?, about_fetched_at = datetime('now'),
       thumbnail = COALESCE(?, thumbnail), title = COALESCE(?, title), subscriber_count = COALESCE(?, subscriber_count)
     WHERE channel_id = ?`
  ).run(JSON.stringify(about), about.avatar || null, about.title || null, about.subscriberCount || null, channelId);
}

function normalizeCachedChannelAbout(about: ChannelAbout): ChannelAbout {
  return {
    ...about,
    subscriberCount: about.subscriberCount ?? "",
  };
}

/** Fetch about from YouTube, persist it, and backfill video durations. */
async function refreshChannelAbout(channelId: string): Promise<ChannelAbout> {
  const about = await fetchChannelAbout(channelId);
  const watchSubscriber = about.subscriberCount ? null : await fetchChannelSubscriberCountFromWatch(channelId).catch(() => null);
  const aboutWithSubscriber = watchSubscriber?.subscriberCount
    ? { ...about, subscriberCount: watchSubscriber.subscriberCount }
    : about;
  const aboutForStorage = await preserveChannelMedia(channelId, aboutWithSubscriber);
  await persistChannelAbout(channelId, aboutForStorage);
  fetchChannelVideosDurations(channelId).then(async (durations) => {
    const upd = database.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL");
    for (const d of durations) await upd.run(d.duration, d.videoId);
  }).catch((error) => {
    log.warn("channel.about_duration_backfill_failed", { channelId, error: error instanceof Error ? error.message : String(error) });
  });
  return aboutForStorage;
}

api.get("/channels/:id/about", async (c) => {
  const channelId = c.req.param("id");
  const syncDisabled = await channelSyncIsDisabled(channelId);
  // Real counts from our own data — stable regardless of how many pages the
  // UI has loaded (NULL is_short counts as a regular video, matching the UI).
  const row = await database.prepare(`
    SELECT
      COALESCE(SUM(published_at IS NOT NULL AND published_at != '' AND COALESCE(is_short, 0) = 0), 0) AS videos,
      COALESCE(SUM(published_at IS NOT NULL AND published_at != '' AND is_short = 1), 0) AS shorts,
      COALESCE(SUM(published_at IS NULL OR published_at = ''), 0) AS processing
    FROM videos WHERE channel_id = ?
  `).get(channelId) as { videos: number; shorts: number; processing: number };
  const counts = row;
  // The channel page header shows the custom name too; the scraped about
  // payload keeps the original underneath.
  const customTitle = (await database.prepare("SELECT custom_title FROM channels WHERE channel_id = ?").get(channelId) as { custom_title: string | null } | null)?.custom_title ?? null;
  const withCustomTitle = <T extends { title: string }>(about: T): T =>
    customTitle ? { ...about, title: customTitle } : about;

  // Serve the cached about from the DB; only touch YouTube when it's missing
  // or stale (and then in the background, so the page never waits on it).
  const cachedRow = await database.prepare("SELECT about_json, about_fetched_at, subscriber_count FROM channels WHERE channel_id = ?")
    .get(channelId) as { about_json: string | null; about_fetched_at: string | null; subscriber_count: string | null } | null;

  if (cachedRow?.about_json) {
    if (!syncDisabled && ageMs(cachedRow.about_fetched_at) > ABOUT_DB_TTL) {
      refreshChannelAbout(channelId).catch((e) =>
        log.warn("channel.about.refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) }));
    }
    try {
      const cachedAbout = JSON.parse(cachedRow.about_json) as Partial<ChannelAbout>;
      if (!("subscriberCount" in cachedAbout) && !syncDisabled) {
        return c.json({ ...withCustomTitle(await refreshChannelAbout(channelId)), counts });
      }
      return c.json({ ...withCustomTitle(normalizeCachedChannelAbout(cachedAbout as ChannelAbout)), counts });
    } catch {
      // corrupted cache — fall through to a fresh fetch
    }
  }

  if (syncDisabled) {
    const ch = await database.prepare("SELECT title, thumbnail, subscriber_count FROM channels WHERE channel_id = ?")
      .get(channelId) as { title: string; thumbnail: string | null; subscriber_count: string | null } | null;
    if (!ch) return c.json({ error: "not found" }, 404);
    return c.json({ channelId, title: customTitle || ch.title || "", description: "", avatar: ch.thumbnail ?? "", banner: "", subscriberCount: ch.subscriber_count ?? "", stats: [], links: [], joinedDate: "", viewCount: "", handle: "", counts });
  }

  // No usable cache: fetch synchronously this once, then it's served from DB.
  try {
    return c.json({ ...withCustomTitle(await refreshChannelAbout(channelId)), counts });
  } catch (e) {
    // YouTube can rate-limit (429) or change layout — fall back to the basic
    // columns so the page still shows avatar/title/subs instead of breaking.
    const ch = await database.prepare("SELECT title, thumbnail, subscriber_count FROM channels WHERE channel_id = ?")
      .get(channelId) as { title: string; thumbnail: string | null; subscriber_count: string | null } | null;
    if (!ch) return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    log.warn("channel.about.fallback", { channelId, error: e instanceof Error ? e.message : String(e) });
    return c.json({
      channelId,
      title: customTitle || ch.title || "",
      description: "",
      avatar: ch.thumbnail ?? "",
      banner: "",
      subscriberCount: ch.subscriber_count ?? "",
      stats: [],
      links: [],
      joinedDate: "",
      viewCount: "",
      handle: "",
      counts,
    });
  }
});

async function attachPlaylistFollowState(userId: number, playlists: any[]) {
  const followed = await database.prepare("SELECT playlist_id FROM user_followed_playlists WHERE user_id = ?").all(userId) as { playlist_id: string }[];
  const ids = new Set(followed.map((row) => row.playlist_id));
  return playlists.map((playlist) => ({ ...playlist, followed: ids.has(playlist.playlistId) }));
}

async function refreshChannelPlaylists(channelId: string, force = false) {
  const playlists = await preservePlaylistMedia(channelId, await fetchChannelPlaylists(channelId, force));
  // Channel pages are available for unsubscribed/external creators too. Their
  // parent row may not exist yet, but channel_playlists has a strict FK.
  await ensureExternalChannelRow.run(channelId, channelId, `https://www.youtube.com/channel/${channelId}`);
  await saveChannelPlaylists(channelId, playlists);
  await database.prepare("UPDATE channels SET playlists_json = ?, playlists_fetched_at = datetime('now'), playlists_cache_version = ? WHERE channel_id = ?")
    .run(JSON.stringify(playlists), CHANNEL_PLAYLIST_CACHE_VERSION, channelId);
  return playlists;
}

api.get("/channels/:id/playlists", async (c) => {
  const uid = currentUserId(c);
  const channelId = c.req.param("id");
  const syncDisabled = await channelSyncIsDisabled(channelId);
  const cached = await database.prepare("SELECT playlists_json, playlists_fetched_at, playlists_cache_version FROM channels WHERE channel_id = ?")
    .get(channelId) as { playlists_json: string | null; playlists_fetched_at: string | null; playlists_cache_version: number } | null;

  if (cached?.playlists_json) {
    try {
      const playlists = JSON.parse(cached.playlists_json);
      if (!syncDisabled && cached.playlists_cache_version < CHANNEL_PLAYLIST_CACHE_VERSION) {
        return c.json({ playlists: await attachPlaylistFollowState(uid, await refreshChannelPlaylists(channelId, true)) });
      }
      // Pre-pagination cache entries commonly contain exactly YouTube's first
      // page of 30 cards. Upgrade them synchronously so this request already
      // shows the missing playlists instead of waiting for the weekly refresh.
      if (!syncDisabled && Array.isArray(playlists) && playlists.length === 30) {
        return c.json({ playlists: await attachPlaylistFollowState(uid, await refreshChannelPlaylists(channelId)) });
      }
      if (Array.isArray(playlists)) await saveChannelPlaylists(channelId, playlists);
    } catch { /* corrupted cache — fall through to a fresh fetch */ }
    if (!syncDisabled && ageMs(cached.playlists_fetched_at) > PLAYLISTS_DB_TTL) {
      refreshChannelPlaylists(channelId).catch((e) =>
        log.warn("channel.playlists.refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) }));
    }
    try {
      return c.json({ playlists: await attachPlaylistFollowState(uid, JSON.parse(cached.playlists_json)) });
    } catch { /* corrupted cache — fall through */ }
  }

  if (syncDisabled) return c.json({ playlists: [] });

  try {
    return c.json({ playlists: await attachPlaylistFollowState(uid, await refreshChannelPlaylists(channelId)) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.post("/channels/:id/playlists/sync", async (c) => {
  const channelId = c.req.param("id");
  if (await channelSyncIsDisabled(channelId)) return c.json({ error: "channel sync disabled" }, 409);
  try {
    const result = await syncChannelPlaylists(channelId);
    log.info("channel.playlists.sync_requested", { channelId, count: result.playlists.length, synced: result.synced, added: result.added, errors: result.errors });
    return c.json({
      ok: true,
      count: result.playlists.length,
      synced: result.synced,
      added: result.added,
      errors: result.errors,
      playlists: await attachPlaylistFollowState(currentUserId(c), result.playlists),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.post("/channels/:id/metadata/sync", async (c) => {
  const channelId = c.req.param("id");
  if (await channelSyncIsDisabled(channelId)) return c.json({ error: "channel sync disabled" }, 409);
  try {
    return c.json({ ok: true, ...(await syncChannelMissingMetadata(channelId)) });
  } catch (e) {
    log.error("channel.metadata_sync_failed", { channelId, error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.put("/channels/:id/follow", async (c) => {
  const uid = currentUserId(c);
  const { followed } = await c.req.json<{ followed: boolean }>();
  const channelId = c.req.param("id");
  const existing = await database.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId);

  // A channel reached through YouTube search may not have any local videos yet,
  // so it has no `channels` row. Create that parent row before writing the
  // profile subscription relation; otherwise SQLite correctly rejects the FK.
  if (followed && !existing) {
    try {
      const info = await resolveChannelId(channelId);
      if (info.channelId !== channelId) return c.json({ error: "channel id mismatch" }, 400);
      await database.prepare(
        "INSERT OR IGNORE INTO channels (channel_id, title, url, thumbnail) VALUES (?, ?, ?, ?)"
      ).run(channelId, info.title, `https://www.youtube.com/channel/${channelId}`, info.thumbnail);
      refreshChannel(channelId)
        .then(() => refreshLiveStatus(channelId))
        .catch((error) => log.error("channel.initial_refresh_failed", { channelId, error: error instanceof Error ? error.message : String(error) }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  }

  // Unfollowing a channel that has since disappeared locally is already the
  // desired state, and avoids inserting a relation with no parent channel.
  if (!followed && !existing) return c.json({ ok: true });
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = excluded.followed`
  ).run(uid, channelId, followed ? 1 : 0);
  if (followed) await database.prepare("UPDATE channels SET external = 0 WHERE channel_id = ?").run(channelId);
  return c.json({ ok: true });
});

// Per-channel playback speed override for the active profile. Empty/"default"
// clears it (stored as NULL) so the video falls back to the global player_speed.
api.put("/channels/:id/speed", async (c) => {
  const uid = currentUserId(c);
  const { speed } = await c.req.json<{ speed: string | null }>();
  const value = !speed || speed === "default" ? null : speed;
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, playback_speed) VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET playback_speed = excluded.playback_speed`
  ).run(uid, c.req.param("id"), value);
  return c.json({ ok: true });
});

// Per-profile caption override. A channel can inherit the profile default,
// explicitly disable captions, or force one YouTube caption language.
api.put("/channels/:id/captions", async (c) => {
  const { mode, language } = await c.req.json<{ mode: unknown; language?: unknown }>();
  if (mode !== null && mode !== "off" && mode !== "language") {
    return c.json({ error: "mode must be null, off, or language" }, 400);
  }
  const captionLanguage = mode === "language" && typeof language === "string" && SUBTITLE_LANGUAGE_CODES.has(language)
    ? language
    : null;
  if (mode === "language" && !captionLanguage) return c.json({ error: "valid caption language required" }, 400);
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, caption_mode, caption_language) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET caption_mode = excluded.caption_mode, caption_language = excluded.caption_language`
  ).run(currentUserId(c), c.req.param("id"), mode, captionLanguage);
  return c.json({ ok: true, mode, language: captionLanguage });
});

// Per-profile visibility of a channel's members-only uploads. The default
// inherits the profile-wide main-feed preference and keeps the channel page
// visible; every explicit mode owns both surfaces.
api.put("/channels/:id/members-only-feed", async (c) => {
  const { visibility } = await c.req.json<{ visibility: unknown }>();
  if (visibility !== "default" && visibility !== "everywhere" && visibility !== "channel" && visibility !== "hidden") {
    return c.json({ error: "visibility must be default, everywhere, channel, or hidden" }, 400);
  }
  const values = {
    default: [null, 0],
    everywhere: [0, 0],
    channel: [1, 0],
    hidden: [1, 1],
  } as const;
  const [hideFromFeed, hideOnChannel] = values[visibility];
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, hide_members_only_from_feed, hide_members_only_on_channel, members_only_visibility) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET hide_members_only_from_feed = excluded.hide_members_only_from_feed, hide_members_only_on_channel = excluded.hide_members_only_on_channel, members_only_visibility = excluded.members_only_visibility`
  ).run(currentUserId(c), c.req.param("id"), hideFromFeed, hideOnChannel, visibility);
  return c.json({ ok: true, visibility });
});

// Downloads are shared between profiles, therefore this is intentionally a
// channel-level setting rather than a user_channels preference. Zero disables
// the threshold.
api.put("/channels/:id/download-min-duration", async (c) => {
  const { seconds } = await c.req.json<{ seconds: unknown }>();
  if (seconds !== null && (!Number.isInteger(seconds) || (seconds as number) < 0 || (seconds as number) > 24 * 60 * 60)) {
    return c.json({ error: "seconds must be null or an integer between 0 and 86400" }, 400);
  }
  const value = seconds === null ? null : seconds as number;
  const result = await database.prepare("UPDATE channels SET auto_download_min_duration_override = ? WHERE channel_id = ?")
    .run(value, c.req.param("id"));
  if (result.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true, seconds: value });
});

// Literal paths before parameterised /channels/:id to avoid shadowing
api.get("/channels/unfollowed", async (c) => {
  const uid = currentUserId(c);
  const channels = await database.prepare(
    `SELECT ch.* FROM channels ch
     JOIN user_channels uc ON uc.channel_id = ch.channel_id AND uc.user_id = ? AND uc.followed = 0
     WHERE ch.external = 0 ORDER BY COALESCE(ch.custom_title, ch.title) COLLATE NOCASE`
  ).all(uid) as any[];
  const tags = await database.prepare(
    `SELECT ct.channel_id, t.id, t.name, t.color
     FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ?`
  ).all(uid) as any[];
  return c.json({
    channels: channels.map((channel) => ({
      ...serializeChannel(channel),
      followed: 0,
      tags: tags.filter((tag) => tag.channel_id === channel.channel_id)
        .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    })),
  });
});

api.get("/channels/top", async (c) => {
  const uid = currentUserId(c);
  const rows = await database.prepare(`
    SELECT c.channel_id, COALESCE(c.custom_title, c.title) AS title, c.thumbnail, c.subscriber_count,
           COUNT(h.id) AS watch_count,
           CAST(EXISTS(
             SELECT 1 FROM videos v WHERE v.channel_id = c.channel_id AND v.live_status = 'live'
           ) AS INTEGER) AS is_live
    FROM channels c
    JOIN user_channels uc ON uc.channel_id = c.channel_id AND uc.user_id = ${uid} AND uc.followed = 1
    JOIN videos vv ON vv.channel_id = c.channel_id
    JOIN history h ON h.video_id = vv.video_id AND h.user_id = ${uid}
    WHERE c.external = 0
    GROUP BY c.channel_id
    ORDER BY is_live DESC, watch_count DESC
    LIMIT 30
  `).all() as any[];
  return c.json({ channels: rows });
});

api.get("/channels/recent", async (c) => {
  const uid = currentUserId(c);
  const shortsFilter = getUserSetting(uid, "show_shorts") === "1"
    ? ""
    : "AND COALESCE(is_short, 0) = 0";
  const rows = await database.prepare(`
    SELECT c.channel_id, COALESCE(c.custom_title, c.title) AS title, c.thumbnail,
           (SELECT thumbnail FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1) AS latest_thumbnail,
           (SELECT video_id FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1) AS latest_video_id
    FROM channels c
    JOIN user_channels uc ON uc.channel_id = c.channel_id AND uc.user_id = ? AND uc.followed = 1
    ORDER BY COALESCE(
      (SELECT published_at FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1),
      '1970-01-01'
    ) DESC
    LIMIT 20
  `).all(uid) as any[];
  return c.json({ channels: await attachWatchedState(uid, rows, (row) => row.latest_video_id) });
});

api.get("/channels/:id", async (c) => {
  const uid = currentUserId(c);
  const ch = await database.prepare("SELECT * FROM channels WHERE channel_id = ?").get(c.req.param("id")) as any;
  if (!ch) return c.json({ error: "not found" }, 404);
  const tags = await database
    .prepare(
      `SELECT t.id, t.name, t.color FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ? WHERE ct.channel_id = ?`
    )
    .all(uid, c.req.param("id")) as any[];
  // followed reflects the active profile (null row = not subscribed).
  const sub = await database.prepare("SELECT followed, playback_speed, caption_mode, caption_language, hide_members_only_from_feed, hide_members_only_on_channel, members_only_visibility FROM user_channels WHERE user_id = ? AND channel_id = ?").get(uid, c.req.param("id")) as { followed: number; playback_speed: string | null; caption_mode: string | null; caption_language: string | null; hide_members_only_from_feed: number | null; hide_members_only_on_channel: number | null; members_only_visibility: string | null } | null;
  return c.json({ channel: { ...serializeChannel(ch), followed: sub ? sub.followed : 0, playback_speed: sub?.playback_speed ?? null, caption_mode: sub?.caption_mode ?? null, caption_language: sub?.caption_language ?? null, hide_members_only_from_feed: sub?.hide_members_only_from_feed ?? null, hide_members_only_on_channel: sub?.hide_members_only_on_channel ?? null, members_only_visibility: sub?.members_only_visibility === "feed" ? "everywhere" : sub?.members_only_visibility ?? "default", tags } });
});

api.get("/channels/:id/refresh-schedule", async (c) => {
  const details = await channelRefreshDiagnostics(c.req.param("id"));
  return details ? c.json(details) : c.json({ error: "not found" }, 404);
});

api.put("/channels/:id/refresh-schedule", async (c) => {
  const body = await c.req.json<{ mode?: unknown; days?: unknown; times?: unknown; time?: unknown }>();
  if (body.mode !== "adaptive" && body.mode !== "manual") return c.json({ error: "mode must be adaptive or manual" }, 400);
  if (body.mode === "adaptive") {
    const result = await database.prepare("UPDATE channels SET refresh_schedule_days = NULL, refresh_schedule_time = NULL WHERE channel_id = ?").run(c.req.param("id"));
    if (result.changes === 0) return c.json({ error: "not found" }, 404);
  } else {
    const days = Array.isArray(body.days) ? [...new Set(body.days)] : [];
    const validDays = days.length > 0 && days.every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6);
    const requestedTimes = Array.isArray(body.times) ? body.times : typeof body.time === "string" ? [body.time] : [];
    const times = [...new Set(requestedTimes)].filter((time): time is string => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)).sort();
    const validTimes = requestedTimes.length > 0 && requestedTimes.every((time) => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
    if (!validDays || !validTimes) return c.json({ error: "manual schedule requires weekdays and one or more HH:mm times" }, 400);
    const result = await database.prepare("UPDATE channels SET refresh_schedule_days = ?, refresh_schedule_time = ? WHERE channel_id = ?")
      .run(JSON.stringify(days.map(Number).sort()), JSON.stringify(times), c.req.param("id"));
    if (result.changes === 0) return c.json({ error: "not found" }, 404);
  }
  log.info("channel.refresh_schedule_updated", { channelId: c.req.param("id"), mode: body.mode });
  return c.json(await channelRefreshDiagnostics(c.req.param("id"))!);
});

api.post("/channels/:id/sync", async (c) => {
  const channelId = c.req.param("id");
  if (await channelSyncIsDisabled(channelId)) return c.json({ error: "channel sync disabled" }, 409);
  try {
    const result = await syncChannel(channelId);
    log.info("channel.sync_requested", { channelId, added: result.added });
    return c.json({ ok: true, added: result.added });
  } catch (e) {
    log.error("channel.sync_failed", { channelId, error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ---------- followed YouTube playlists ----------

api.get("/channel-playlists/:id", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  let playlist = await database.prepare(`
    SELECT cp.playlist_id, cp.title, cp.thumbnail, cp.video_count, cp.last_synced_at,
           cp.channel_id, COALESCE(NULLIF(ch.custom_title, ''), ch.title) AS channel_title,
           ch.thumbnail AS channel_thumbnail,
           EXISTS(SELECT 1 FROM user_followed_playlists ufp WHERE ufp.user_id = ? AND ufp.playlist_id = cp.playlist_id) AS followed
    FROM channel_playlists cp JOIN channels ch ON ch.channel_id = cp.channel_id
    WHERE cp.playlist_id = ?
  `).get(uid, id) as any;
  if (!playlist) {
    try {
      await syncPlaylist(id);
      playlist = await database.prepare(`
        SELECT cp.playlist_id, cp.title, cp.thumbnail, cp.video_count, cp.last_synced_at,
               cp.channel_id, COALESCE(NULLIF(ch.custom_title, ''), ch.title) AS channel_title,
               ch.thumbnail AS channel_thumbnail, 0 AS followed
        FROM channel_playlists cp JOIN channels ch ON ch.channel_id = cp.channel_id
        WHERE cp.playlist_id = ?
      `).get(id) as any;
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }
  if (!playlist) return c.json({ error: "not found" }, 404);
  return c.json({ playlist });
});

api.get("/channel-playlists/:id/videos", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const exists = await database.prepare("SELECT 1 FROM channel_playlists WHERE playlist_id = ?").get(id);
  if (!exists) {
    try { await syncPlaylist(id); } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }
  const rows = await database.prepare(`${videoSelect(uid)}
    JOIN channel_playlist_videos cpv ON cpv.video_id = v.video_id
    WHERE cpv.playlist_id = ?
    ORDER BY cpv.position ASC`).all(id) as VideoRow[];
  const attached = await attachTags(uid, rows);
  return c.json({
    videos: attached.filter((video) => video.published_at != null && video.published_at !== ""),
    processing: attached.filter((video) => video.published_at == null || video.published_at === ""),
  });
});

api.post("/channel-playlists/:id/download", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  if (!await profileDownloadsEnabled(uid)) return c.json({ error: "plugin disabled" }, 409);
  const playlist = await database.prepare("SELECT title FROM channel_playlists WHERE playlist_id = ?").get(c.req.param("id")) as { title: string } | null;
  if (!playlist) return c.json({ error: "not found" }, 404);
  const videoIds = (await database.prepare(`
    SELECT v.video_id FROM channel_playlist_videos cpv
    JOIN videos v ON v.video_id = cpv.video_id
    WHERE cpv.playlist_id = ? AND v.is_private = 0
      AND v.live_status NOT IN ('live', 'upcoming')
    ORDER BY cpv.position ASC
  `).all(c.req.param("id")) as { video_id: string }[]).map((row) => row.video_id);
  const result = await enqueuePlaylistDownloads(uid, videoIds, playlist.title);
  log.info("downloads.playlist_queued", { playlistId: c.req.param("id"), playlistTitle: playlist.title, ...result });
  return c.json(result);
});

api.put("/channel-playlists/:id/follow", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { followed } = await c.req.json<{ followed: boolean }>();
  if (!followed) {
    await database.prepare("DELETE FROM user_followed_playlists WHERE user_id = ? AND playlist_id = ?").run(uid, id);
    return c.json({ ok: true, followed: false });
  }
  try {
    // Establish the complete current snapshot before setting the feed baseline.
    // Only videos discovered by a later sync are allowed into the main feed.
    await syncPlaylist(id);
    await database.prepare(`INSERT INTO user_followed_playlists (user_id, playlist_id, followed_at, feed_from)
      VALUES (?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(user_id, playlist_id) DO UPDATE SET include_in_feed = 1`).run(uid, id);
    return c.json({ ok: true, followed: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.post("/channel-playlists/:id/sync", async (c) => {
  if (await playlistChannelSyncIsDisabled(c.req.param("id"))) return c.json({ error: "channel sync disabled" }, 409);
  try {
    const result = await syncPlaylist(c.req.param("id"));
    return c.json({ ok: true, added: result.added });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.get("/followed-playlists", async (c) => {
  const uid = currentUserId(c);
  const playlists = await database.prepare(`
    SELECT cp.playlist_id, cp.title, cp.thumbnail, cp.video_count, cp.last_synced_at,
           cp.channel_id, COALESCE(NULLIF(ch.custom_title, ''), ch.title) AS channel_title,
           ch.thumbnail AS channel_thumbnail, ufp.followed_at, ufp.include_in_feed
    FROM user_followed_playlists ufp
    JOIN channel_playlists cp ON cp.playlist_id = ufp.playlist_id
    JOIN channels ch ON ch.channel_id = cp.channel_id
    WHERE ufp.user_id = ?
    ORDER BY channel_title COLLATE NOCASE, cp.title COLLATE NOCASE
  `).all(uid);
  return c.json({ playlists });
});

api.get("/followed-playlists/updates", async (c) => {
  const uid = currentUserId(c);
  const playlists = await database.prepare(`
    SELECT cp.playlist_id, cp.title, cp.thumbnail, cp.video_count, cp.last_synced_at,
           cp.channel_id, COALESCE(NULLIF(ch.custom_title, ''), ch.title) AS channel_title,
           ch.thumbnail AS channel_thumbnail, ufp.followed_at, ufp.feed_from, ufp.include_in_feed
    FROM user_followed_playlists ufp
    JOIN channel_playlists cp ON cp.playlist_id = ufp.playlist_id
    JOIN channels ch ON ch.channel_id = cp.channel_id
    WHERE ufp.user_id = ?
    ORDER BY cp.title COLLATE NOCASE
  `).all(uid) as any[];

  const updates = await Promise.all(playlists.map(async (playlist) => {
    const rows = await database.prepare(`${videoSelect(uid)}
      JOIN channel_playlist_videos cpv ON cpv.video_id = v.video_id
      WHERE cpv.playlist_id = ?
        AND v.published_at IS NOT NULL AND v.published_at != ''
        AND cpv.discovered_at > ?
        AND COALESCE(uv.watched, 0) = 0
        AND NOT EXISTS (
          SELECT 1 FROM history h
          WHERE h.user_id = ? AND h.video_id = v.video_id
        )
      ORDER BY COALESCE(v.published_at, cpv.discovered_at) DESC, cpv.position ASC
    `).all(playlist.playlist_id, playlist.feed_from, uid) as VideoRow[];
    const newVideos = await attachTags(uid, rows);
    const { feed_from: _feedFrom, ...publicPlaylist } = playlist;
    return { ...publicPlaylist, new_video_count: newVideos.length, new_videos: newVideos };
  }));

  return c.json({ playlists: updates });
});

// ---------- user playlists ----------

// True when the playlist belongs to the active profile.
async function ownsPlaylist(uid: number, id: number | string) {
  return Boolean(await database.prepare("SELECT 1 FROM user_playlists WHERE id = ? AND user_id = ?").get(id, uid));
}

api.get("/playlists", async (c) => {
  const uid = currentUserId(c);
  const videoId = c.req.query("video_id");
  const rows = await database
    .prepare(
      `SELECT p.id, p.name, p.icon, p.sort_order, p.created_at,
              COUNT(pv.video_id) AS video_count
              ${videoId ? ", EXISTS(SELECT 1 FROM user_playlist_videos cpv WHERE cpv.playlist_id = p.id AND cpv.video_id = ?) AS has_video" : ""}
       FROM user_playlists p
       LEFT JOIN user_playlist_videos pv ON pv.playlist_id = p.id
       WHERE p.user_id = ?
       GROUP BY p.id
       ORDER BY p.sort_order ASC, p.name COLLATE NOCASE`
    )
    .all(...(videoId ? [videoId] : []), uid);
  return c.json({ playlists: rows });
});

api.post("/playlists", async (c) => {
  const uid = currentUserId(c);
  const { name, icon = "ListMusic" } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "name required" }, 400);
  const nextOrder = await database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM user_playlists WHERE user_id = ?").get(uid) as { sort_order: number };
  const row = await database
    .prepare("INSERT INTO user_playlists (name, icon, sort_order, user_id, portable_uuid) VALUES (?, ?, ?, ?, ?) RETURNING id, name, icon, sort_order, created_at")
    .get(name.trim(), String(icon || "ListMusic").trim() || "ListMusic", nextOrder.sort_order, uid, crypto.randomUUID());
  return c.json({ playlist: row });
});

api.put("/playlists/:id", async (c) => {
  const uid = currentUserId(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const current = await database.prepare("SELECT * FROM user_playlists WHERE id = ? AND user_id = ?").get(id, uid) as any;
  if (!current) return c.json({ error: "not found" }, 404);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
  const icon = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : current.icon;
  const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : current.sort_order;
  const row = await database
    .prepare("UPDATE user_playlists SET name = ?, icon = ?, sort_order = ? WHERE id = ? RETURNING id, name, icon, sort_order, created_at")
    .get(name, icon, sortOrder, id);
  return c.json({ playlist: row });
});

api.delete("/playlists/:id", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM user_playlists WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

api.get("/playlists/:id", async (c) => {
  const uid = currentUserId(c);
  const id = Number(c.req.param("id"));
  const playlist = await database
    .prepare(
      `SELECT p.id, p.name, p.icon, p.sort_order, p.created_at, COUNT(pv.video_id) AS video_count
       FROM user_playlists p
       LEFT JOIN user_playlist_videos pv ON pv.playlist_id = p.id
       WHERE p.id = ? AND p.user_id = ?
       GROUP BY p.id`
    )
    .get(id, uid) as any;
  if (!playlist) return c.json({ error: "not found" }, 404);
  const rows = await database
    .prepare(
      `${videoSelect(uid)}
       JOIN user_playlist_videos upv ON upv.video_id = v.video_id
       WHERE upv.playlist_id = ?
       ORDER BY upv.added_at DESC`
    )
    .all(id) as VideoRow[];
  return c.json({ playlist, videos: await attachTags(uid, rows) });
});

api.post("/playlists/:id/download", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  if (!await profileDownloadsEnabled(uid)) return c.json({ error: "plugin disabled" }, 409);
  const playlist = await database.prepare("SELECT name FROM user_playlists WHERE id = ? AND user_id = ?").get(c.req.param("id"), uid) as { name: string } | null;
  if (!playlist) return c.json({ error: "not found" }, 404);
  const videoIds = (await database.prepare(`
    SELECT v.video_id FROM user_playlist_videos upv
    JOIN videos v ON v.video_id = upv.video_id
    WHERE upv.playlist_id = ? AND v.is_private = 0
      AND v.live_status NOT IN ('live', 'upcoming')
    ORDER BY upv.added_at ASC
  `).all(c.req.param("id")) as { video_id: string }[]).map((row) => row.video_id);
  const result = await enqueuePlaylistDownloads(uid, videoIds, playlist.name);
  log.info("downloads.playlist_queued", { playlistId: c.req.param("id"), playlistTitle: playlist.name, ...result });
  return c.json(result);
});

api.post("/playlists/:id/videos", async (c) => {
  const uid = currentUserId(c);
  const { video_id } = await c.req.json();
  if (!video_id) return c.json({ error: "video_id required" }, 400);
  if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  await database.prepare("INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id) VALUES (?, ?)").run(c.req.param("id"), video_id);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/playlists/:id/videos/:videoId", async (c) => {
  const uid = currentUserId(c);
  if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  await database.prepare("DELETE FROM user_playlist_videos WHERE playlist_id = ? AND video_id = ?").run(
    c.req.param("id"),
    c.req.param("videoId")
  );
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.get("/playlists/:id/rules", async (c) => {
  const uid = currentUserId(c);
  if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  const rules = await database.prepare("SELECT * FROM user_playlist_rules WHERE playlist_id = ? ORDER BY id").all(c.req.param("id"));
  return c.json({ rules });
});

api.post("/playlists/:id/rules", async (c) => {
  const uid = currentUserId(c);
  const { pattern, match_type = "contains", field = "title" } = await c.req.json();
  if (!pattern?.trim()) return c.json({ error: "pattern required" }, 400);
  if (!["contains", "regex"].includes(match_type)) return c.json({ error: "invalid match_type" }, 400);
  if (!["title", "description", "both"].includes(field)) return c.json({ error: "invalid field" }, 400);
  if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  const row = await database
    .prepare("INSERT INTO user_playlist_rules (playlist_id, pattern, match_type, field) VALUES (?, ?, ?, ?) RETURNING *")
    .get(c.req.param("id"), pattern.trim(), match_type, field) as any;
  const matched = await applyPlaylistRuleToAllVideos(row.id);
  return c.json({ rule: row, matched });
});

api.delete("/playlists/:id/rules/:ruleId", async (c) => {
  const uid = currentUserId(c);
  if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  await database.prepare("DELETE FROM user_playlist_rules WHERE playlist_id = ? AND id = ?").run(c.req.param("id"), c.req.param("ruleId"));
  return c.json({ ok: true });
});

api.post("/playlists/:id/rules/apply", async (c) => {
  const uid = currentUserId(c);
  if (!await ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  const matched = await applyPlaylistRulesForPlaylist(Number(c.req.param("id")));
  return c.json({ ok: true, matched });
});

api.get("/playlists/:id/videos", async (c) => {
  try {
    const id = c.req.param("id");
    // Import all playlist videos into the owning channel (deduped) on load,
    // then return them for the player. Both calls share a cached feed fetch.
    const videos = await fetchPlaylistVideos(id);
    importPlaylistVideos(id).catch((e) => log.error("playlist.import.failed", { playlistId: id, error: e instanceof Error ? e.message : String(e) }));
    return c.json({ videos: await attachWatchedState(currentUserId(c), videos, (video) => video.videoId) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.get("/videos/:id/playlists", async (c) => {
  return c.json({ playlists: await videoPlaylistsForUser(currentUserId(c), c.req.param("id")) });
});

api.post("/channels/import", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
  const content = await file.text();
  const entries = content.trimStart().startsWith("<")
    ? parseOpml(content)
    : parseTakeoutCsv(content);
  const insert = database.prepare(
    "INSERT OR IGNORE INTO channels (channel_id, title, url) VALUES (?, ?, ?)"
  );
  const subscribe = database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1`
  );
  let added = 0;
  for (const e of entries) {
    const r = await insert.run(e.channelId, e.title, `https://www.youtube.com/channel/${e.channelId}`);
    await subscribe.run(uid, e.channelId);
    if (r.changes > 0) added++;
  }
  log.info("channels.imported", { fileName: file.name, found: entries.length, added });
  refreshAll().catch((e) => log.error("channels.import_refresh_failed", { error: e instanceof Error ? e.message : String(e) }));
  return c.json({ ok: true, found: entries.length, added });
});

// ---------- Google Takeout import wizard ----------
// Two phases: /import/analyze parses the upload (zip or loose files) and holds
// it in an in-memory session; /import/commit applies only what the user picked.

const MAX_ZIP_BYTES = 300 * 1024 * 1024;

const ensureImportedChannel = database.prepare(
  `INSERT INTO channels (channel_id, title, url, followed, external) VALUES (?, ?, ?, 0, 1)
   ON CONFLICT(channel_id) DO NOTHING`
);
// Placeholder rows for videos we only know from the export. When the video is
// already in the library, fill only what's missing (title, real channel).
const ensureImportedVideo = database.prepare(
  `INSERT INTO videos (video_id, channel_id, title, thumbnail, status, external)
   VALUES (?, ?, ?, ?, 'inbox', 1)
   ON CONFLICT(video_id) DO UPDATE SET
     title = CASE WHEN TRIM(videos.title) = '' THEN excluded.title ELSE videos.title END,
     channel_id = CASE WHEN videos.channel_id = '${IMPORTED_CHANNEL_ID}' AND excluded.channel_id != '${IMPORTED_CHANNEL_ID}'
                       THEN excluded.channel_id ELSE videos.channel_id END`
);

async function importTakeoutPlaylists(uid: number, playlists: TakeoutPlaylist[]): Promise<{ playlistsCreated: number; videosAdded: number }> {
  const findPlaylist = database.prepare("SELECT id FROM user_playlists WHERE user_id = ? AND name = ? COLLATE NOCASE");
  const createPlaylist = database.prepare("INSERT INTO user_playlists (name, sort_order, user_id, portable_uuid) VALUES (?, ?, ?, ?) RETURNING id");
  const nextOrder = database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM user_playlists WHERE user_id = ?");
  const addMembership = database.prepare("INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id) VALUES (?, ?)");

  let playlistsCreated = 0;
  let videosAdded = 0;
  await database.transaction(async () => {
    await ensureImportedChannel.run(IMPORTED_CHANNEL_ID, "Imported", "");
    for (const pl of playlists) {
      let row = await findPlaylist.get(uid, pl.name) as { id: number } | undefined;
      if (!row) {
        const order = (await nextOrder.get(uid) as { n: number }).n;
        row = await createPlaylist.get(pl.name, order, uid, crypto.randomUUID()) as { id: number };
        playlistsCreated++;
      }
      for (const videoId of pl.videoIds) {
        await ensureImportedVideo.run(videoId, IMPORTED_CHANNEL_ID, "", `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
        if ((await addMembership.run(row.id, videoId)).changes > 0) videosAdded++;
      }
    }
  })();
  return { playlistsCreated, videosAdded };
}

// History rows carry the original watch date; undated entries (localized HTML
// exports) only mark the video as watched instead of faking a timestamp.
export async function importTakeoutHistory(uid: number, entries: TakeoutHistoryEntry[], from: string | null): Promise<{ historyAdded: number; watchedMarked: number }> {
  const existing = new Set(
    (await database.prepare("SELECT video_id, watched_at FROM history WHERE user_id = ?").all(uid) as { video_id: string; watched_at: string }[])
      .map((r) => `${r.video_id}@${r.watched_at}`)
  );
  const addHistory = database.prepare("INSERT INTO history (video_id, user_id, watched_at) VALUES (?, ?, ?)");
  const markWatched = database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status, watched) VALUES (?, ?, 'archived', 1)
     ON CONFLICT(user_id, video_id) DO UPDATE SET
       status = 'archived', watched = 1, bucket = NULL, queued_at = NULL, show_from = NULL`
  );

  let historyAdded = 0;
  let watchedMarked = 0;
  await database.transaction(async () => {
    await ensureImportedChannel.run(IMPORTED_CHANNEL_ID, "Imported", "");
    for (const entry of entries) {
      if (entry.watchedAt ? (from !== null && entry.watchedAt < from) : from !== null) continue;
      const channelId = entry.channelId || IMPORTED_CHANNEL_ID;
      if (entry.channelId) {
        await ensureImportedChannel.run(entry.channelId, entry.channelTitle, `https://www.youtube.com/channel/${entry.channelId}`);
      }
      await ensureImportedVideo.run(entry.videoId, channelId, entry.title, `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`);
      await markWatched.run(uid, entry.videoId);
      watchedMarked++;
      if (entry.watchedAt && !existing.has(`${entry.videoId}@${entry.watchedAt}`)) {
        existing.add(`${entry.videoId}@${entry.watchedAt}`);
        await addHistory.run(entry.videoId, uid, entry.watchedAt);
        historyAdded++;
      }
    }
  })();
  return { historyAdded, watchedMarked };
}

api.post("/import/analyze", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.parseBody({ all: true });
  const raw = body["file"] ?? body["file[]"];
  const uploads = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return c.json({ error: "file required" }, 400);

  const files: { name: string; content: string }[] = [];
  for (const file of uploads) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isZip(bytes)) {
      if (bytes.byteLength > MAX_ZIP_BYTES) return c.json({ error: "zip too large" }, 413);
      try {
        for (const entry of unzipEntries(bytes, isRelevantEntryName)) {
          files.push({ name: entry.name, content: new TextDecoder().decode(entry.bytes) });
        }
      } catch (e) {
        return c.json({ error: `could not read zip: ${e instanceof Error ? e.message : String(e)}` }, 400);
      }
    } else if (isRelevantEntryName(file.name)) {
      files.push({ name: file.name, content: new TextDecoder().decode(bytes) });
    }
  }

  const bundle = parseTakeoutFiles(files);
  if (bundle.channels.length === 0 && bundle.playlists.length === 0 && bundle.history.length === 0) {
    return c.json({ error: "nothing recognized in the upload" }, 400);
  }

  // Monthly histogram lets the UI show live counts for any date cutoff without
  // shipping the (potentially huge) entry list to the client.
  const months = new Map<string, number>();
  let undated = 0;
  for (const entry of bundle.history) {
    if (!entry.watchedAt) { undated++; continue; }
    const month = entry.watchedAt.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  const dated = bundle.history.filter((e) => e.watchedAt);

  const sessionId = createImportSession(uid, bundle);
  log.info("import.analyzed", { files: files.length, channels: bundle.channels.length, playlists: bundle.playlists.length, history: bundle.history.length });
  return c.json({
    sessionId,
    channels: bundle.channels,
    playlists: bundle.playlists.map((p) => ({ name: p.name, videoCount: p.videoIds.length })),
    history: {
      total: bundle.history.length,
      undated,
      from: dated.at(-1)?.watchedAt ?? null,
      to: dated[0]?.watchedAt ?? null,
      months: [...months.entries()].sort().map(([month, count]) => ({ month, count })),
    },
  });
});

api.post("/import/commit", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.json();
  const bundle: TakeoutBundle | null = typeof body.sessionId === "string" ? getImportSession(body.sessionId, uid) : null;
  if (!bundle) return c.json({ error: "session expired, upload the file again" }, 410);

  const result = { channelsAdded: 0, playlistsCreated: 0, playlistVideosAdded: 0, historyAdded: 0, watchedMarked: 0 };

  if (body.channels?.enabled) {
    const excluded = new Set<string>(Array.isArray(body.channels.excludedIds) ? body.channels.excludedIds : []);
    const insert = database.prepare("INSERT OR IGNORE INTO channels (channel_id, title, url) VALUES (?, ?, ?)");
    const subscribe = database.prepare(
      `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
       ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1`
    );
    for (const ch of bundle.channels) {
      if (excluded.has(ch.channelId)) continue;
      await insert.run(ch.channelId, ch.title, `https://www.youtube.com/channel/${ch.channelId}`);
      await subscribe.run(uid, ch.channelId);
      result.channelsAdded++;
    }
    if (result.channelsAdded > 0) await database.prepare("UPDATE channels SET external = 0 WHERE channel_id IN (SELECT channel_id FROM user_channels WHERE user_id = ? AND followed = 1)").run(uid);
  }

  if (body.playlists?.enabled) {
    const excluded = new Set<string>(Array.isArray(body.playlists.excludedNames) ? body.playlists.excludedNames : []);
    const picked = bundle.playlists.filter((p) => !excluded.has(p.name));
    const r = await importTakeoutPlaylists(uid, picked);
    result.playlistsCreated = r.playlistsCreated;
    result.playlistVideosAdded = r.videosAdded;
  }

  if (body.history?.enabled) {
    // "from" arrives as YYYY-MM-DD; entries are YYYY-MM-DD HH:MM:SS so plain
    // string comparison works.
    const from = typeof body.history.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.history.from) ? body.history.from : null;
    const r = await importTakeoutHistory(uid, bundle.history, from);
    result.historyAdded = r.historyAdded;
    result.watchedMarked = r.watchedMarked;
  }

  deleteImportSession(body.sessionId);
  log.info("import.committed", { ...result });
  if (result.channelsAdded > 0) {
    refreshAll().catch((e) => log.error("import.refresh_failed", { error: e instanceof Error ? e.message : String(e) }));
  }
  if (result.playlistVideosAdded > 0 || result.watchedMarked > 0) {
    backfillImportedVideos().catch((e) => log.error("import.enrich_failed", { error: e instanceof Error ? e.message : String(e) }));
  }

  // Background-work forecast for the result screen. Enrichment and channel
  // refresh run in parallel on their own schedulers (see startScheduler), so
  // the UI can show how long until everything is filled in.
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const enrichPending = (await database.prepare("SELECT COUNT(*) AS n FROM videos WHERE channel_id = ? AND is_private = 0").get(IMPORTED_CHANNEL_ID) as { n: number }).n;
  const enrichBatch = num(process.env.IMPORT_ENRICH_BATCH_SIZE, 15);
  const enrichIntervalMin = num(process.env.IMPORT_ENRICH_INTERVAL_MINUTES, 2);
  const refreshIntervalMin = num(process.env.REFRESH_INTERVAL_MINUTES, 5);
  const background = {
    enrichPending,
    enrichEstimateMin: Math.ceil(enrichPending / enrichBatch) * enrichIntervalMin,
    channelRefreshEstimateMin: Math.ceil(result.channelsAdded / 10) * refreshIntervalMin,
  };

  return c.json({ ok: true, ...result, background });
});

// ---------- tags ----------

api.get("/tags", async (c) => {
  const uid = currentUserId(c);
  const tags = await database
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM video_tags vt WHERE vt.tag_id = t.id) AS video_count,
        (SELECT COUNT(*) FROM channel_tags ct WHERE ct.tag_id = t.id) AS channel_count
       FROM tags t WHERE t.user_id = ? ORDER BY t.name COLLATE NOCASE`
    )
    .all(uid);
  return c.json({ tags });
});

api.post("/tags", async (c) => {
  const uid = currentUserId(c);
  const { name, color } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "name required" }, 400);
  const r = await database
    .prepare("INSERT INTO tags (name, color, user_id, portable_uuid) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET color = excluded.color RETURNING *")
    .get(name.trim(), color ?? "#7c5cff", uid, crypto.randomUUID());
  return c.json({ tag: r });
});

api.patch("/tags/:id", async (c) => {
  const uid = currentUserId(c);
  const { name, color, filter_only } = await c.req.json();
  const id = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(id, uid)) return c.json({ error: "not found" }, 404);
  if (name !== undefined) await database.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name.trim(), id);
  if (color !== undefined) await database.prepare("UPDATE tags SET color = ? WHERE id = ?").run(color, id);
  if (filter_only !== undefined) await database.prepare("UPDATE tags SET filter_only = ? WHERE id = ?").run(filter_only ? 1 : 0, id);
  const tag = await database.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  return c.json({ tag });
});

api.delete("/tags/:id", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

// ---------- auto-tag rules ----------

api.get("/rules", async (c) => {
  const uid = currentUserId(c);
  const rules = await database
    .prepare(
      `SELECT r.*, t.name AS tag_name, t.color AS tag_color FROM auto_tag_rules r JOIN tags t ON t.id = r.tag_id WHERE r.user_id = ? ORDER BY r.id`
    )
    .all(uid);
  return c.json({ rules });
});

api.post("/rules", async (c) => {
  const uid = currentUserId(c);
  const { tag_id, pattern, match_type = "contains", field = "title" } = await c.req.json();
  if (!tag_id || !pattern?.trim()) return c.json({ error: "tag_id and pattern required" }, 400);
  // The tag must belong to the active profile.
  if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) return c.json({ error: "tag not found" }, 404);
  const r = await database
    .prepare("INSERT INTO auto_tag_rules (tag_id, pattern, match_type, field, user_id) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(tag_id, pattern.trim(), match_type, field, uid) as any;
  const matched = await applyRuleToAllVideos(r.id);
  return c.json({ rule: r, matched });
});

api.patch("/rules/:id", async (c) => {
  const uid = currentUserId(c);
  const { tag_id, pattern, match_type, field } = await c.req.json();
  const id = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM auto_tag_rules WHERE id = ? AND user_id = ?").get(id, uid)) return c.json({ error: "not found" }, 404);
  if (tag_id !== undefined) {
    if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) return c.json({ error: "tag not found" }, 404);
    await database.prepare("UPDATE auto_tag_rules SET tag_id = ? WHERE id = ?").run(tag_id, id);
  }
  if (pattern !== undefined) await database.prepare("UPDATE auto_tag_rules SET pattern = ? WHERE id = ?").run(pattern.trim(), id);
  if (match_type !== undefined) await database.prepare("UPDATE auto_tag_rules SET match_type = ? WHERE id = ?").run(match_type, id);
  if (field !== undefined) await database.prepare("UPDATE auto_tag_rules SET field = ? WHERE id = ?").run(field, id);
  const rule = await database.prepare("SELECT r.*, t.name AS tag_name, t.color AS tag_color FROM auto_tag_rules r JOIN tags t ON t.id = r.tag_id WHERE r.id = ?").get(id);
  return c.json({ rule });
});

api.delete("/rules/:id", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM auto_tag_rules WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

// ---------- filter rules ----------

api.get("/filter-rules", async (c) => {
  const uid = currentUserId(c);
  const rules = await database.prepare(
    `SELECT fr.*, COALESCE(c.custom_title, c.title) AS channel_title FROM filter_rules fr
     LEFT JOIN channels c ON c.channel_id = fr.channel_id WHERE fr.user_id = ? ORDER BY fr.id`
  ).all(uid);
  return c.json({ rules });
});

api.post("/filter-rules", async (c) => {
  const uid = currentUserId(c);
  const { pattern, match_type = "contains", field = "title", action = "reject", channel_id = null } = await c.req.json();
  if (!pattern?.trim()) return c.json({ error: "pattern required" }, 400);
  const row = await database
    .prepare("INSERT INTO filter_rules (pattern, match_type, field, action, channel_id, user_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .get(pattern.trim(), match_type, field, action, channel_id || null, uid) as any;
  const archived = await applyFilterRuleToAll(row.id);
  return c.json({ rule: row, archived });
});

api.patch("/filter-rules/:id", async (c) => {
  const uid = currentUserId(c);
  const { pattern, match_type, field, action, channel_id } = await c.req.json();
  const id = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM filter_rules WHERE id = ? AND user_id = ?").get(id, uid)) return c.json({ error: "not found" }, 404);
  if (pattern !== undefined) await database.prepare("UPDATE filter_rules SET pattern = ? WHERE id = ?").run(pattern.trim(), id);
  if (match_type !== undefined) await database.prepare("UPDATE filter_rules SET match_type = ? WHERE id = ?").run(match_type, id);
  if (field !== undefined) await database.prepare("UPDATE filter_rules SET field = ? WHERE id = ?").run(field, id);
  if (action !== undefined) await database.prepare("UPDATE filter_rules SET action = ? WHERE id = ?").run(action, id);
  if (channel_id !== undefined) await database.prepare("UPDATE filter_rules SET channel_id = ? WHERE id = ?").run(channel_id || null, id);
  const rule = await database.prepare("SELECT fr.*, COALESCE(c.custom_title, c.title) AS channel_title FROM filter_rules fr LEFT JOIN channels c ON c.channel_id = fr.channel_id WHERE fr.id = ?").get(id);
  return c.json({ rule });
});

api.delete("/filter-rules/:id", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM filter_rules WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

// ---------- image cache / proxy ----------

api.get("/img", async (c) => {
  const url = c.req.query("u");
  if (!url) return c.json({ error: "u required" }, 400);
  if (!isAllowedRemoteImageUrl(url)) return c.json({ error: "unsupported image origin" }, 400);
  const img = await getCachedImage(url);
  // Nothing cached and origin failed: redirect so the browser can try directly.
  if (!img) return c.redirect(url, 302);
  return new Response(Bun.file(img.path), {
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "public, max-age=604800, stale-while-revalidate=604800, stale-if-error=2592000",
    },
  });
});

// ---------- settings ----------

api.get("/child-lock", (c) => {
  return c.json({ child_lock: childLockStatus(c) });
});

api.get("/profile-permissions", (c) => {
  return c.json({ permissions: { admin_only_areas: adminOnlyAreas() } });
});

api.put("/profile-permissions", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage profile permissions" }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.admin_only_areas) || body.admin_only_areas.some((area: unknown) => !isProfilePermissionArea(area))) {
    return c.json({ error: "invalid admin-only areas" }, 400);
  }
  const areas = [...new Set(body.admin_only_areas as ProfilePermissionArea[])];
  await setSetting("profile_admin_only_areas", serializeAdminOnlyAreas(areas));
  return c.json({ permissions: { admin_only_areas: adminOnlyAreas() } });
});

api.post("/child-lock/enable", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (isChildLockEnabled()) return c.json({ error: "child lock already enabled" }, 409);
  const body = await c.req.json().catch(() => ({}));
  if (!isSixDigitPin(body.pin)) return c.json({ error: "PIN must have 6 digits" }, 400);
  await setSetting("child_lock_pin_hash", await hashChildLockPin(body.pin));
  await setSetting("child_lock_enabled", "1");
  publishAppEvent("child-requests");
  // Admin access no longer depends on the shared unlock cookie. Clear any stale
  // cookie so other profiles in this browser are protected immediately.
  clearChildLockSession(c);
  return c.json({ child_lock: childLockStatus(c) });
});

api.post("/child-lock/unlock", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!isChildLockEnabled()) return c.json({ child_lock: childLockStatus(c) });
  if (!isSixDigitPin(body.pin) || !(await verifyChildLockPin(body.pin))) {
    return c.json({ error: "invalid PIN" }, 401);
  }
  setChildLockSession(c);
  return c.json({ child_lock: childLockStatus(c) });
});

api.post("/child-lock/lock", (c) => {
  clearChildLockSession(c);
  return c.json({ child_lock: childLockStatus(c) });
});

api.post("/child-lock/change-pin", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (!isChildLockEnabled()) return c.json({ error: "child lock is disabled" }, 400);
  const body = await c.req.json().catch(() => ({}));
  if (!isSixDigitPin(body.new_pin)) return c.json({ error: "PIN must have 6 digits" }, 400);
  await setSetting("child_lock_pin_hash", await hashChildLockPin(body.new_pin));
  publishAppEvent("child-requests");
  clearChildLockSession(c);
  return c.json({ child_lock: childLockStatus(c) });
});

api.post("/child-lock/disable", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (!isChildLockEnabled()) return c.json({ child_lock: childLockStatus(c) });
  await setSetting("child_lock_enabled", "0");
  await setSetting("child_lock_pin_hash", "");
  publishAppEvent("child-requests");
  clearChildLockSession(c);
  return c.json({ child_lock: childLockStatus(c) });
});

api.get("/settings", (c) => {
  const uid = currentUserId(c);
  const settings: Record<string, string> = {};
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (key === "child_lock_pin_hash") continue;
    // Global keys come from the shared table, the rest from the active profile.
    settings[key] = GLOBAL_SETTING_KEYS.has(key)
      ? (getSetting(key) ?? SETTING_DEFAULTS[key])
      : (getUserSetting(uid, key) ?? SETTING_DEFAULTS[key]);
  }
  return c.json({ settings });
});

api.put("/settings", async (c) => {
  const uid = currentUserId(c);
  const primary = isAdmin(c);
  const body = await c.req.json();
  if ("timezone" in body && !isValidTimeZone(body.timezone)) {
    return c.json({ error: "invalid timezone" }, 400);
  }
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (key === "child_lock_pin_hash" || key === "child_lock_enabled") continue;
    if (!(key in body)) continue;
    if (GLOBAL_SETTING_KEYS.has(key)) {
      // Only an administrator owns app-wide settings (name, icon, timezone).
      if (primary) await setSetting(key, String(body[key]));
    } else {
      await setUserSetting(uid, key, String(body[key]));
    }
  }
  if (primary && "timezone" in body) {
    const now = new Date();
    for (const bucket of SCHEDULE_BUCKETS) {
      await database.prepare("UPDATE user_videos SET show_from = ? WHERE status = 'queued' AND bucket = ?")
        .run(computeShowFrom(bucket, now, String(body.timezone)), bucket);
    }
  }
  return c.json({ ok: true });
});

// ---------- profiles (multi-user) ----------

const AVATAR_DIR = PROFILE_AVATAR_DIR;
mkdirSync(AVATAR_DIR, { recursive: true });

interface UserRow {
  id: number;
  name: string;
  avatar: string;
  avatar_color: string;
  pin_hash: string | null;
  sort_order: number;
  username: string | null;
  password_hash: string | null;
  oidc_subject: string | null;
  proxy_match: string | null;
  is_admin: number;
  is_child: number;
}

function oidcProfileMapping() {
  const mapped = authMethod() === "oidc" && (getSetting("auth_oidc_mode") || "mapped") === "mapped";
  return { mapped, claim: getSetting("auth_oidc_claim") || "preferred_username" };
}

function normalizeOidcIdentity(value: unknown, claim: string): string {
  const identity = String(value ?? "").trim();
  return claim.toLowerCase() === "email" ? identity.toLowerCase() : identity;
}

function validOidcIdentity(identity: string, claim: string): boolean {
  return claim.toLowerCase() !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity);
}

async function oidcIdentityExists(identity: string, claim: string, exceptId?: number): Promise<boolean> {
  const comparison = claim.toLowerCase() === "email" ? "lower(oidc_subject) = lower(?)" : "oidc_subject = ?";
  const row = await database.prepare(`SELECT id FROM users WHERE ${comparison}${exceptId ? " AND id != ?" : ""}`)
    .get(...(exceptId ? [identity, exceptId] : [identity]));
  return Boolean(row);
}

async function serializeProfile(u: UserRow, activeId: number, includeOidcIdentity = false) {
  const method = authMethod();
  const status = u.is_child === 1 ? await childStatus(u.id) : null;
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar ? `/api/profiles/${u.id}/avatar?v=${encodeURIComponent(u.avatar)}` : "",
    avatar_color: u.avatar_color,
    // PINs only apply to the 'none' method; any other auth method replaces them.
    has_pin: method === "none" ? Boolean(u.pin_hash) : false,
    active: u.id === activeId,
    is_primary: u.id === primaryUserId(),
    is_admin: u.id === primaryUserId() || u.is_admin === 1,
    is_child: u.is_child === 1,
    pin_locked: u.is_child === 1 && (isPinLocked(u.id) || isParentLocked(u.id)),
    child_config: u.is_child === 1 ? {
      limit_minutes: parseInt(getUserSetting(u.id, "child_limit_minutes") ?? "0", 10) || 0,
      local_only: getUserSetting(u.id, "child_local_only") === "1",
      hide_shorts: getUserSetting(u.id, "child_hide_shorts") === "1",
      hide_live: getUserSetting(u.id, "child_hide_live") === "1",
      downloads_only: getUserSetting(u.id, "child_downloads_only") === "1",
    } : null,
    child_status: status ? {
      remaining_seconds: status.remaining_seconds,
      unlimited_today: status.unlimited_today,
    } : null,
    can_switch: canSwitchProfiles(),
    ...(includeOidcIdentity ? { oidc_identity: u.oidc_subject ?? "" } : {}),
  };
}

api.get("/profiles", async (c) => {
  const activeId = currentUserId(c);
  const rows = await database.prepare("SELECT * FROM users ORDER BY sort_order ASC, id ASC").all() as UserRow[];
  const mapping = oidcProfileMapping();
  const admin = isAdmin(c);
  return c.json({
    profiles: await Promise.all(rows.map((u) => serializeProfile(u, activeId, admin && mapping.mapped))),
    active_id: activeId,
    oidc_mapping: mapping.mapped ? { claim: mapping.claim, required: true } : null,
    can_create: !mapping.mapped || admin,
    hide_other_profiles: getSetting("auth_hide_other_profiles") === "1",
  });
});

api.put("/profiles/visibility", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  if (authMethod() === "none" || authMethod() === "shared") return c.json({ error: "profile visibility requires authenticated profiles" }, 409);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.hide_other_profiles !== "boolean") return c.json({ error: "hide_other_profiles must be a boolean" }, 400);
  await setSetting("auth_hide_other_profiles", body.hide_other_profiles ? "1" : "0");
  return c.json({ ok: true });
});

api.put("/profiles/:id/admin", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  if (!canDelegateProfileAdmins()) return c.json({ error: "profile administrator delegation requires identity-bound login" }, 409);
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "invalid profile id" }, 400);
  if (id === primaryUserId()) return c.json({ error: "the primary profile owner cannot be changed" }, 400);
  const profile = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!profile) return c.json({ error: "not found" }, 404);
  if (profile.is_child === 1) return c.json({ error: "a child profile cannot be an administrator" }, 400);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.is_admin !== "boolean") return c.json({ error: "is_admin must be a boolean" }, 400);
  await database.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(body.is_admin ? 1 : 0, id);
  profile.is_admin = body.is_admin ? 1 : 0;
  log.info("profile.admin_changed", { id, is_admin: body.is_admin });
  return c.json({ profile: await serializeProfile(profile, currentUserId(c), false) });
});

api.post("/profiles", async (c) => {
  const { name, avatar_color, pin, oidc_identity, is_child } = await c.req.json().catch(() => ({}));
  if (!name?.trim()) return c.json({ error: "name required" }, 400);
  if (pin !== undefined && pin !== null && pin !== "" && !isSixDigitPin(pin)) {
    return c.json({ error: "PIN must have 6 digits" }, 400);
  }
  const mapping = oidcProfileMapping();
  if (mapping.mapped && !isAdmin(c)) return c.json({ error: "only an admin can create OIDC profiles" }, 403);
  const identity = normalizeOidcIdentity(oidc_identity, mapping.claim);
  if (mapping.mapped && !identity) return c.json({ error: `${mapping.claim} identity required` }, 400);
  if (identity && !isAdmin(c)) return c.json({ error: "only an admin can map an OIDC identity" }, 403);
  if (identity && !validOidcIdentity(identity, mapping.claim)) return c.json({ error: `invalid ${mapping.claim} identity` }, 400);
  if (identity && await oidcIdentityExists(identity, mapping.claim)) return c.json({ error: "OIDC identity is already assigned" }, 409);
  if (is_child && !isAdmin(c)) return c.json({ error: "only an admin can create a child profile" }, 403);
  const nextOrder = (await database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM users").get() as { n: number }).n;
  const pinHash = isSixDigitPin(pin) ? await hashPin(pin) : null;
  const row = await database
    .prepare("INSERT INTO users (name, avatar_color, pin_hash, oidc_subject, is_child, sort_order, portable_uuid) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *")
    .get(name.trim(), avatar_color || "#7c5cff", pinHash, identity || null, is_child ? 1 : 0, nextOrder, crypto.randomUUID()) as UserRow;
  let temporaryCredentials: { username: string; password: string } | null = null;
  if (authMethod() === "per_profile") {
    const existing = await database.prepare("SELECT username FROM users WHERE id != ? AND username IS NOT NULL").all(row.id) as Array<{ username: string }>;
    const username = uniqueProfileUsername(row.name, new Set(existing.map((entry) => entry.username.toLowerCase())), row.id);
    const password = generateTemporaryPassword();
    await database.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?").run(username, await hashPassword(password), row.id);
    temporaryCredentials = { username, password };
  }
  if (is_child) await setUserSetting(row.id, "child_local_only", "1");
  if (is_child) {
    publishAppEvent("child-status");
    publishAppEvent("child-watching");
  }
  log.info("profile.created", { id: row.id, name: row.name });
  return c.json({ profile: await serializeProfile(row, currentUserId(c), isAdmin(c) && mapping.mapped), temporary_credentials: temporaryCredentials });
});

api.patch("/profiles/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const current = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!current) return c.json({ error: "not found" }, 404);
  // Only the owner or an administrator may edit a profile at all.
  if (!canManageProfile(c, id)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return c.json({ error: "name required" }, 400);
    const nextName = String(body.name).trim();
    if (authMethod() === "per_profile") {
      const existing = await database.prepare("SELECT username FROM users WHERE id != ? AND username IS NOT NULL").all(id) as Array<{ username: string }>;
      const username = uniqueProfileUsername(nextName, new Set(existing.map((entry) => entry.username.toLowerCase())), id);
      await database.prepare("UPDATE users SET name = ?, username = ? WHERE id = ?").run(nextName, username, id);
    } else {
      await database.prepare("UPDATE users SET name = ? WHERE id = ?").run(nextName, id);
    }
  }
  if (body.avatar_color !== undefined) {
    await database.prepare("UPDATE users SET avatar_color = ? WHERE id = ?").run(String(body.avatar_color), id);
  }
  if (body.oidc_identity !== undefined) {
    if (!isAdmin(c)) return c.json({ error: "only an admin can map an OIDC identity" }, 403);
    const mapping = oidcProfileMapping();
    if (!mapping.mapped) return c.json({ error: "OIDC mapped mode is not active" }, 400);
    const identity = normalizeOidcIdentity(body.oidc_identity, mapping.claim);
    if (!identity) return c.json({ error: `${mapping.claim} identity required` }, 400);
    if (!validOidcIdentity(identity, mapping.claim)) return c.json({ error: `invalid ${mapping.claim} identity` }, 400);
    if (await oidcIdentityExists(identity, mapping.claim, id)) return c.json({ error: "OIDC identity is already assigned" }, 409);
    await database.prepare("UPDATE users SET oidc_subject = ? WHERE id = ?").run(identity, id);
  }
  // is_child: admin-only, so a child profile can never unmark itself. The
  // primary profile is the household admin and cannot be a child profile.
  if (body.is_child !== undefined) {
    if (!isAdmin(c)) return c.json({ error: "only an administrator can change this" }, 403);
    if (id === primaryUserId()) return c.json({ error: "the primary profile cannot be a child profile" }, 400);
    if (current.is_admin === 1 && !isPrimaryUser(c)) return c.json({ error: "only the primary profile can change an administrator role" }, 403);
    await database.prepare("UPDATE users SET is_child = ?, is_admin = CASE WHEN ? = 1 THEN 0 ELSE is_admin END WHERE id = ?").run(body.is_child ? 1 : 0, body.is_child ? 1 : 0, id);
    // Restricted content is the safe default for a fresh child profile.
    if (body.is_child && getUserSetting(id, "child_local_only") == null) {
      await setUserSetting(id, "child_local_only", "1");
    }
    log.info("profile.child_flag", { id, is_child: Boolean(body.is_child) });
  }
  // Child time limit & restrictions: admin-only, stored in the child's settings.
  if (body.child_config !== undefined) {
    if (!isAdmin(c)) return c.json({ error: "only an administrator can change this" }, 403);
    const cc = body.child_config ?? {};
    if (cc.limit_minutes !== undefined) {
      const minutes = Math.max(0, Math.min(24 * 60, parseInt(cc.limit_minutes, 10) || 0));
      await setUserSetting(id, "child_limit_minutes", String(minutes));
    }
    if (cc.local_only !== undefined) await setUserSetting(id, "child_local_only", cc.local_only ? "1" : "0");
    if (cc.hide_shorts !== undefined) await setUserSetting(id, "child_hide_shorts", cc.hide_shorts ? "1" : "0");
    if (cc.hide_live !== undefined) await setUserSetting(id, "child_hide_live", cc.hide_live ? "1" : "0");
    if (cc.downloads_only !== undefined) await setUserSetting(id, "child_downloads_only", cc.downloads_only ? "1" : "0");
  }
  // pin: "" / null clears it, a 6-digit string sets it. PIN is owner-only — not
  // even the primary profile can change or remove someone else's PIN. (Child
  // boundaries are gated by the app-wide child lock PIN, not this one.)
  if (body.pin !== undefined) {
    if (currentUserId(c) !== id) return c.json({ error: "only the profile owner can change its PIN" }, 403);
    if (body.pin === "" || body.pin === null) {
      await database.prepare("UPDATE users SET pin_hash = NULL WHERE id = ?").run(id);
    } else if (isSixDigitPin(body.pin)) {
      await database.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(await hashPin(body.pin), id);
    } else {
      return c.json({ error: "PIN must have 6 digits" }, 400);
    }
  }
  const row = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  if (body.is_child !== undefined || body.child_config !== undefined || body.pin !== undefined) {
    publishAppEvent("child-status");
    publishAppEvent("child-watching");
  }
  return c.json({ profile: await serializeProfile(row, currentUserId(c), isAdmin(c) && oidcProfileMapping().mapped) });
});

api.delete("/profiles/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (id === primaryUserId()) return c.json({ error: "cannot delete the primary profile" }, 400);
  const count = (await database.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count <= 1) return c.json({ error: "cannot delete the last profile" }, 400);
  const user = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!user) return c.json({ error: "not found" }, 404);
  if (user.is_admin === 1 && !isPrimaryUser(c)) return c.json({ error: "only the primary profile can remove an administrator" }, 403);
  // The owner may delete their own profile; an admin may remove any non-primary
  // profile without requiring that person to sign in first.
  const deletingOwnProfile = currentUserId(c) === id;
  if (!deletingOwnProfile && !isAdmin(c)) return c.json({ error: "not allowed" }, 403);
  // A PIN confirms self-deletion. Admin deletion is already authorized by the
  // admin session (and by the settings lock when one is enabled).
  if (user.pin_hash && deletingOwnProfile) {
    const { pin } = await c.req.json().catch(() => ({}));
    if (!isSixDigitPin(pin) || !(await Bun.password.verify(pin, user.pin_hash))) {
      return c.json({ error: "invalid PIN" }, 401);
    }
  }
  const ownedDownloads = await database.prepare("SELECT video_id FROM download_owners WHERE user_id=?").all(id) as { video_id: string }[];
  for (const download of ownedDownloads) await removeDownload(id, download.video_id);
  removeDownloadCookies(id);
  await database.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades to all remaining per-user state
  removeStoredProfileAvatar(user.avatar);
  if (user.is_child) {
    publishAppEvent("child-status");
    publishAppEvent("child-watching");
  }
  log.info("profile.deleted", { id });
  if (deletingOwnProfile) {
    // The active profile just deleted itself → fall back to the first remaining one.
    const next = await firstUserId.get() as { id: number };
    c.header("Set-Cookie", profileCookie(next.id));
    return c.json({ ok: true, active_id: next.id });
  }
  return c.json({ ok: true, active_id: currentUserId(c) });
});

api.post("/profiles/:id/avatar", async (c) => {
  const id = Number(c.req.param("id"));
  if (!await database.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) return c.json({ error: "not found" }, 404);
  if (!canManageProfile(c, id)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
  if (file.size > 5 * 1024 * 1024) return c.json({ error: "file too large" }, 400);
  const previous = await database.prepare("SELECT avatar FROM users WHERE id = ?").get(id) as { avatar: string };
  let optimized: Uint8Array;
  try {
    optimized = await optimizeProfileAvatar(await file.arrayBuffer());
  } catch {
    return c.json({ error: "invalid image" }, 400);
  }
  const staged = await stageProfileAvatarBytes(id, optimized);
  try {
    commitStagedProfileAvatar(staged.stage, staged.target);
    await database.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(staged.token, id);
    removeStoredProfileAvatar(previous.avatar, staged.fileName);
  } catch (error) {
    rmSync(staged.stage, { force: true });
    throw error;
  }
  const row = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  return c.json({ profile: await serializeProfile(row, currentUserId(c)) });
});

// Primary-only: clear another profile's PIN (e.g. it was forgotten). The owner
// then sets a new one themselves — the primary never sets or learns the PIN.
api.post("/profiles/:id/reset-pin", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can reset PINs" }, 403);
  const id = Number(c.req.param("id"));
  if (id === primaryUserId() && !isPrimaryUser(c)) return c.json({ error: "the primary profile can only be changed by its owner" }, 403);
  const row = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!row) return c.json({ error: "not found" }, 404);
  await database.prepare("UPDATE users SET pin_hash = NULL WHERE id = ?").run(id);
  log.info("profile.pin_reset", { id, by: currentUserId(c) });
  const updated = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  return c.json({ profile: await serializeProfile(updated, currentUserId(c)) });
});

api.delete("/profiles/:id/avatar", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!row) return c.json({ error: "not found" }, 404);
  if (!canManageProfile(c, id)) return c.json({ error: "not allowed" }, 403);
  await database.prepare("UPDATE users SET avatar = '' WHERE id = ?").run(id);
  removeStoredProfileAvatar(row.avatar);
  const updated = await database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  return c.json({ profile: await serializeProfile(updated, currentUserId(c)) });
});

api.get("/profiles/:id/avatar", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await database.prepare("SELECT avatar FROM users WHERE id = ?").get(id) as { avatar: string } | null;
  if (!row?.avatar) return c.json({ error: "not found" }, 404);
  const fileName = profileAvatarFileName(row.avatar);
  if (!fileName) return c.json({ error: "not found" }, 404);
  const file = Bun.file(resolve(AVATAR_DIR, fileName));
  if (!await file.exists()) return c.json({ error: "not found" }, 404);
  return c.body(file.stream(), 200, {
    "Content-Type": file.type || "image/webp",
    "Content-Length": String(file.size),
    "Cache-Control": "private, max-age=31536000, immutable",
  });
});

api.post("/profiles/switch", async (c) => {
  // Methods that pin a session to one profile can't switch internally — the UI
  // must log out (and possibly redirect to the IdP/proxy logout).
  if (!canSwitchProfiles()) {
    return c.json({ requires_relogin: true, logout_url: methodLogoutUrl() });
  }
  const { id, pin, child_lock_pin } = await c.req.json().catch(() => ({}));
  const user = await database.prepare("SELECT * FROM users WHERE id = ?").get(Number(id)) as UserRow | null;
  if (!user) return c.json({ error: "not found" }, 404);
  // Leaving a child profile always requires the app-wide child lock PIN (the
  // profile's own PIN only gates entering it, like on any other profile).
  // Three wrong attempts lock the child profile.
  const current = await database.prepare("SELECT * FROM users WHERE id = ?").get(currentUserId(c)) as UserRow | null;
  if (current && current.id !== user.id && current.is_child === 1 && isChildLockEnabled()) {
    if (!isSixDigitPin(child_lock_pin) || !(await verifyChildLockPin(child_lock_pin))) {
      await registerChildLockFailure(current.id);
      publishAppEvent("child-status");
      publishAppEvent("child-watching");
      return c.json({ error: "invalid PIN", pin_locked: isPinLocked(current.id) }, 401);
    }
    clearChildLockFailures(current.id);
  }
  // PINs only gate switching under the 'none' method; other methods replace them.
  if (authMethod() === "none" && user.pin_hash) {
    if (!isSixDigitPin(pin) || !(await Bun.password.verify(pin, user.pin_hash))) {
      return c.json({ error: "invalid PIN" }, 401);
    }
  }
  c.header("Set-Cookie", profileCookie(user.id));
  log.info("profile.switched", { id: user.id });
  return c.json({ ok: true, active_id: user.id });
});

// ---------- authentication ----------

const OIDC_FLOW_COOKIE = "ytzero_oidc_flow";

// What the SPA needs to decide between rendering the app or the login screen.
api.get("/auth/status", async (c) => {
  const method = authMethod();
  const ownerCapabilities = {
    can_manage_administrators: isPrimaryUser(c),
    admin_delegation_available: canDelegateProfileAdmins(),
  };
  if (method === "none") return c.json({ method, authenticated: true, can_switch: true, hide_other_profiles: false, is_admin: isAdmin(c), ...ownerCapabilities });

  if (method === "proxy_header") {
    const uid = await resolveProxyUser(c);
    return c.json({
      method,
      authenticated: Boolean(uid),
      can_switch: false,
      hide_other_profiles: hideOtherProfilesInPicker(),
      is_admin: isAdmin(c),
      ...ownerCapabilities,
      proxy_header_seen: Boolean(proxyHeaderValue(c)),
    });
  }

  const session = await validateSession(parseCookies(c.req.header("cookie"))[AUTH_SESSION_COOKIE]);
  const perProfilePasskeys =
    (await database.prepare("SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id IS NOT NULL").get() as { n: number }).n > 0;
  return c.json({
    method,
    authenticated: Boolean(session),
    scope: session?.scope ?? null,
    can_switch: canSwitchProfiles(),
    hide_other_profiles: hideOtherProfilesInPicker(),
    is_admin: isAdmin(c),
    ...ownerCapabilities,
    oidc_mode: method === "oidc" ? getSetting("auth_oidc_mode") || "mapped" : undefined,
    // per_profile always needs a username; shared only when one was configured.
    username_field: method === "per_profile" || (method === "shared" && Boolean(getSetting("auth_shared_username"))),
    login: {
      password:
        method === "shared" ? Boolean(getSetting("auth_shared_password_hash")) : method === "per_profile",
      passkey: method === "shared" ? await hasPasskeys(null) : method === "per_profile" ? perProfilePasskeys : false,
      oidc: method === "oidc",
    },
  });
});

api.post("/auth/password/login", async (c) => {
  const method = authMethod();
  const { username, password } = await c.req.json().catch(() => ({}));
  if (method === "shared") {
    const expectedUser = getSetting("auth_shared_username") || "";
    if (expectedUser && String(username ?? "") !== expectedUser) return c.json({ error: "invalid credentials" }, 401);
    if (!(await verifyPassword(String(password ?? ""), getSetting("auth_shared_password_hash") || ""))) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    c.header("Set-Cookie", authSessionCookie(await createSession(null, "account")));
    log.info("auth.login", { method, scope: "account" });
    return c.json({ ok: true });
  }
  if (method === "per_profile") {
    const row = await database.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username ?? "")) as UserRow | null;
    if (!row?.password_hash || !(await verifyPassword(String(password ?? ""), row.password_hash))) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    c.header("Set-Cookie", authSessionCookie(await createSession(row.id, "profile")));
    c.header("Set-Cookie", profileCookie(row.id), { append: true });
    log.info("auth.login", { method, scope: "profile", id: row.id });
    return c.json({ ok: true, active_id: row.id });
  }
  return c.json({ error: "password login not enabled" }, 400);
});

api.post("/auth/passkey/login/options", async (c) => {
  const method = authMethod();
  if (method !== "shared" && method !== "per_profile") return c.json({ error: "not enabled" }, 400);
  const { options, flowId } = await passkeyLoginOptions(c, null);
  return c.json({ options, flowId });
});

api.post("/auth/passkey/login/verify", async (c) => {
  const { flowId, response } = await c.req.json().catch(() => ({}));
  const { user_id } = await passkeyLoginVerify(c, flowId, response);
  const scope = user_id === null ? "account" : "profile";
  c.header("Set-Cookie", authSessionCookie(await createSession(user_id, scope)));
  if (user_id !== null) c.header("Set-Cookie", profileCookie(user_id), { append: true });
  log.info("auth.login", { method: authMethod(), scope, id: user_id });
  return c.json({ ok: true, active_id: user_id ?? undefined });
});

// Register a passkey. target='shared' (primary only) or 'self' (current profile).
api.post("/auth/passkey/register/options", async (c) => {
  const { target } = await c.req.json().catch(() => ({}));
  if (target === "shared") {
    if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
    const { options, flowId } = await passkeyRegisterOptions(c, null, getSetting("auth_shared_username") || "shared");
    return c.json({ options, flowId });
  }
  const uid = currentUserId(c);
  if (!uid) return c.json({ error: "unauthenticated" }, 401);
  const user = await database.prepare("SELECT name FROM users WHERE id = ?").get(uid) as { name: string };
  const { options, flowId } = await passkeyRegisterOptions(c, uid, user.name);
  return c.json({ options, flowId });
});

api.post("/auth/passkey/register/verify", async (c) => {
  const { flowId, response, label } = await c.req.json().catch(() => ({}));
  await passkeyRegisterVerify(c, flowId, response, label);
  return c.json({ ok: true });
});

api.delete("/auth/passkey/:id", async (c) => {
  const id = Number(c.req.param("id"));
  // Shared credentials (user_id NULL) are primary-managed; others belong to the owner.
  const cred = await database.prepare("SELECT user_id FROM webauthn_credentials WHERE id = ?").get(id) as { user_id: number | null } | null;
  if (!cred) return c.json({ error: "not found" }, 404);
  if (cred.user_id === null) {
    if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  } else if (cred.user_id !== currentUserId(c)) {
    return c.json({ error: "not allowed" }, 403);
  }
  await deletePasskey(id, cred.user_id);
  return c.json({ ok: true });
});

// openid-client wraps low-level failures (e.g. "unsupported operation"); dig into
// the cause chain so the log names the real problem, like the unsupported id_token
// signing alg (Authentik signs with HS256 when no asymmetric signing key is set).
function oidcErrorDetail(e: any): Record<string, unknown> {
  const detail: Record<string, unknown> = { error: e?.message };
  if (e?.code) detail.code = e.code;
  const cause = e?.cause;
  if (cause) {
    detail.cause = cause?.message ?? (typeof cause === "object" ? JSON.stringify(cause) : String(cause));
    if (cause?.cause) detail.detail = typeof cause.cause === "object" ? JSON.stringify(cause.cause) : String(cause.cause);
  }
  return detail;
}

api.get("/auth/oidc/login", async (c) => {
  try {
    const { url, flowId } = await oidcAuthUrl(c);
    c.header(
      "Set-Cookie",
      `${OIDC_FLOW_COOKIE}=${encodeURIComponent(flowId)}; Path=/; Max-Age=600; SameSite=Lax; HttpOnly`
    );
    return c.redirect(url);
  } catch (e: any) {
    log.error("auth.oidc.login_failed", oidcErrorDetail(e));
    return c.redirect("/?auth_error=oidc");
  }
});

api.get("/auth/oidc/callback", async (c) => {
  try {
    const flowId = parseCookies(c.req.header("cookie"))[OIDC_FLOW_COOKIE];
    const { user_id, mode, is_admin } = await oidcCallback(c, flowId, c.req.url);
    const scope = mode === "gateway" ? "account" : "profile";
    c.header("Set-Cookie", authSessionCookie(await createSession(scope === "account" ? null : user_id, scope, is_admin)));
    if (user_id !== null) c.header("Set-Cookie", profileCookie(user_id), { append: true });
    c.header("Set-Cookie", `${OIDC_FLOW_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`, { append: true });
    log.info("auth.login", { method: "oidc", scope, id: user_id, admin: is_admin });
    return c.redirect("/");
  } catch (e: any) {
    log.error("auth.oidc.callback_failed", oidcErrorDetail(e));
    return c.redirect("/?auth_error=oidc");
  }
});

api.post("/auth/logout", async (c) => {
  await destroySession(parseCookies(c.req.header("cookie"))[AUTH_SESSION_COOKIE]);
  c.header("Set-Cookie", clearAuthSessionCookie());
  return c.json({ ok: true, logout_url: methodLogoutUrl() });
});

// ---------- auth configuration (primary profile only) ----------

api.get("/auth/config", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const profileRows = await database.prepare("SELECT * FROM users ORDER BY sort_order ASC, id ASC").all() as UserRow[];
  const profiles = await Promise.all(profileRows.map(async (u) => ({
    id: u.id,
    name: u.name,
    username: u.username ?? "",
    has_password: Boolean(u.password_hash),
    has_passkey: await hasPasskeys(u.id),
    oidc_subject: u.oidc_subject ?? "",
    proxy_match: u.proxy_match ?? "",
  })));
  return c.json({
    method: getSetting("auth_method") || "none",
    hide_other_profiles: getSetting("auth_hide_other_profiles") === "1",
    shared: {
      username: getSetting("auth_shared_username") || "",
      password_set: Boolean(getSetting("auth_shared_password_hash")),
      passkeys: await listPasskeys(null),
    },
    oidc: {
      issuer: getSetting("auth_oidc_issuer") || "",
      client_id: getSetting("auth_oidc_client_id") || "",
      client_secret_set: Boolean(getSetting("auth_oidc_client_secret")),
      scopes: getSetting("auth_oidc_scopes") || "openid profile email",
      mode: getSetting("auth_oidc_mode") || "mapped",
      claim: getSetting("auth_oidc_claim") || "preferred_username",
      autocreate: getSetting("auth_oidc_autocreate") === "1",
      logout_url: getSetting("auth_oidc_logout_url") || "",
      groups_claim: getSetting("auth_oidc_groups_claim") || "groups",
      admin_group: getSetting("auth_oidc_admin_group") || "",
      redirect_uri: `${requestOrigin(c)}/api/auth/oidc/callback`,
    },
    proxy: {
      header: getSetting("auth_proxy_header") || "Remote-User",
      logout_url: getSetting("auth_proxy_logout_url") || "",
      current_header_value: proxyHeaderValue(c) ?? "",
    },
    profiles,
  });
});

api.put("/auth/config", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const body = await c.req.json().catch(() => ({}));

  if (body.hide_other_profiles !== undefined) {
    if (typeof body.hide_other_profiles !== "boolean") return c.json({ error: "invalid profile visibility setting" }, 400);
    await setSetting("auth_hide_other_profiles", body.hide_other_profiles ? "1" : "0");
  }

  if (body.shared) {
    if (body.shared.username !== undefined) await setSetting("auth_shared_username", String(body.shared.username));
    if (body.shared.password) await setSetting("auth_shared_password_hash", await hashPassword(String(body.shared.password)));
    else if (body.shared.password === "") await setSetting("auth_shared_password_hash", "");
  }

  if (body.oidc) {
    const o = body.oidc;
    if (o.issuer !== undefined) await setSetting("auth_oidc_issuer", String(o.issuer).trim());
    if (o.client_id !== undefined) await setSetting("auth_oidc_client_id", String(o.client_id).trim());
    if (o.client_secret) await setSetting("auth_oidc_client_secret", String(o.client_secret)); // keep existing if not provided
    if (o.scopes !== undefined) await setSetting("auth_oidc_scopes", String(o.scopes));
    if (o.mode !== undefined) await setSetting("auth_oidc_mode", o.mode === "gateway" ? "gateway" : "mapped");
    if (o.claim !== undefined) await setSetting("auth_oidc_claim", String(o.claim));
    if (o.autocreate !== undefined) await setSetting("auth_oidc_autocreate", o.autocreate ? "1" : "0");
    if (o.logout_url !== undefined) await setSetting("auth_oidc_logout_url", String(o.logout_url).trim());
    if (o.groups_claim !== undefined) await setSetting("auth_oidc_groups_claim", String(o.groups_claim).trim() || "groups");
    if (o.admin_group !== undefined) await setSetting("auth_oidc_admin_group", String(o.admin_group).trim());
    invalidateOidcConfig();
  }

  if (body.proxy) {
    if (body.proxy.header !== undefined) await setSetting("auth_proxy_header", String(body.proxy.header).trim() || "Remote-User");
    if (body.proxy.logout_url !== undefined) await setSetting("auth_proxy_logout_url", String(body.proxy.logout_url).trim());
  }

  if (Array.isArray(body.profiles)) {
    for (const p of body.profiles) {
      const id = Number(p.id);
      if (!await database.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) continue;
      if (p.oidc_subject !== undefined) await database.prepare("UPDATE users SET oidc_subject = ? WHERE id = ?").run(String(p.oidc_subject).trim() || null, id);
      if (p.proxy_match !== undefined) await database.prepare("UPDATE users SET proxy_match = ? WHERE id = ?").run(String(p.proxy_match).trim() || null, id);
    }
  }

  return c.json({ ok: true });
});

api.post("/auth/per-profile/credentials/:id", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const targetId = Number(c.req.param("id"));
  if (!Number.isSafeInteger(targetId) || targetId < 1) return c.json({ error: "invalid profile id" }, 400);
  const rows = await database.prepare("SELECT * FROM users ORDER BY sort_order ASC, id ASC").all() as UserRow[];
  const target = rows.find((row) => row.id === targetId);
  if (!target) return c.json({ error: "profile not found" }, 404);
  const used = new Set<string>();
  const prepared = rows.map((row) => {
    const username = uniqueProfileUsername(row.name, used, row.id);
    return { row, username };
  });
  const password = generateTemporaryPassword();
  const passwordHash = await hashPassword(password);
  await database.transaction(async () => {
    for (const entry of prepared) {
      if (entry.row.id === targetId) await database.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?").run(entry.username, passwordHash, entry.row.id);
      else await database.prepare("UPDATE users SET username = ? WHERE id = ?").run(entry.username, entry.row.id);
    }
  })();
  const targetEntry = prepared.find((entry) => entry.row.id === targetId)!;
  log.info("auth.per_profile_credentials_generated", { id: targetId });
  return c.json({
    credential: { id: target.id, name: target.name, username: targetEntry.username, password },
  });
});

api.put("/auth/profile/password", async (c) => {
  if (authMethod() !== "per_profile") return c.json({ error: "per-profile login is not active" }, 400);
  const id = currentUserId(c);
  const row = await database.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string | null } | null;
  const { current_password, new_password } = await c.req.json().catch(() => ({}));
  if (!row?.password_hash || !(await verifyPassword(String(current_password ?? ""), row.password_hash))) return c.json({ error: "current password is incorrect" }, 401);
  const next = String(new_password ?? "");
  if (next.length < 8 || next.length > 200) return c.json({ error: "new password must contain 8 to 200 characters" }, 400);
  await database.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(next), id);
  log.info("auth.profile_password_changed", { id });
  return c.json({ ok: true });
});

api.post("/auth/test-oidc", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  return c.json(await testOidc());
});

// The per-profile identifier a method maps logins against (null = no mapping).
function mappingField(method: string): "username" | "oidc_subject" | "proxy_match" | null {
  if (method === "per_profile") return "username";
  if (method === "oidc") return (getSetting("auth_oidc_mode") || "mapped") === "mapped" ? "oidc_subject" : null;
  if (method === "proxy_header") return "proxy_match";
  return null;
}

// Every profile must carry the method's identifier (and it must be unique), so an
// admin can't half-configure the mapping and accidentally lock people out.
async function validateMapping(method: string): Promise<{ missing: string[]; duplicates: string[]; credMissing: string[] } | null> {
  const field = mappingField(method);
  if (!field) return null;
  const rows = await database.prepare("SELECT * FROM users ORDER BY sort_order ASC, id ASC").all() as UserRow[];
  const valueOf = (u: UserRow) => String((u as any)[field] ?? "").trim();
  const missing = rows.filter((u) => !valueOf(u)).map((u) => u.name);
  const seen = new Map<string, true>();
  const dups = new Set<string>();
  for (const u of rows) {
    const v = valueOf(u);
    if (!v) continue;
    if (seen.has(v)) dups.add(v);
    else seen.set(v, true);
  }
  // per_profile additionally needs a way to authenticate each profile.
  const credMissing =
    method === "per_profile"
      ? (await Promise.all(rows.map(async (u) => ({ user: u, hasPasskey: await hasPasskeys(u.id) }))))
          .filter(({ user, hasPasskey }) => !user.password_hash && !hasPasskey)
          .map(({ user }) => user.name)
      : [];
  if (missing.length === 0 && dups.size === 0 && credMissing.length === 0) return null;
  return { missing, duplicates: [...dups], credMissing };
}

// Activate an auth method after validating its prerequisites (anti-lockout).
api.post("/auth/method", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const { method } = await c.req.json().catch(() => ({}));
  const valid = ["none", "shared", "per_profile", "oidc", "proxy_header"];
  if (!valid.includes(method)) return c.json({ error: "invalid method" }, 400);

  if (method === "shared" && !getSetting("auth_shared_password_hash") && !await hasPasskeys(null)) {
    return c.json({ error: "set a shared password or passkey first" }, 400);
  }
  if (method === "oidc") {
    const probe = await testOidc();
    if (!probe.ok) return c.json({ error: `OIDC not reachable: ${probe.error}` }, 400);
  }
  if (method === "per_profile") {
    const rows = await database.prepare("SELECT id, name FROM users ORDER BY sort_order ASC, id ASC").all() as Array<{ id: number; name: string }>;
    const used = new Set<string>();
    const usernames = rows.map((row) => ({ id: row.id, username: uniqueProfileUsername(row.name, used, row.id) }));
    const sync = database.transaction(async () => {
      for (const entry of usernames) await database.prepare("UPDATE users SET username = ? WHERE id = ?").run(entry.username, entry.id);
    });
    await sync();
  }
  // per_profile / oidc-mapped / proxy_header: require a complete, unique mapping.
  const m = await validateMapping(method);
  if (m) {
    const parts: string[] = [];
    if (m.missing.length) parts.push(`missing for: ${m.missing.join(", ")}`);
    if (m.credMissing.length) parts.push(`no password for: ${m.credMissing.join(", ")}`);
    if (m.duplicates.length) parts.push(`duplicate values: ${m.duplicates.join(", ")}`);
    return c.json({ error: `incomplete profile mapping — ${parts.join("; ")}`, mapping: m }, 400);
  }

  await setSetting("auth_method", method);
  log.info("auth.method_changed", { method });
  return c.json({ ok: true });
});

// ---------- config ----------

api.get("/config", (c) => {
  return c.json({ app_url: process.env.APP_URL ?? "" });
});

// One authenticated stream replaces the small periodic API polls in the UI.
// Events are invalidation signals; each view reloads only its own compact data.
api.get("/events", (c) => {
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-transform");
  return streamSSE(c, async (stream) => {
    let stopped = false;
    let id = 1;
    let writes = Promise.resolve();
    const enqueue = (event: string, data: unknown) => {
      if (stopped) return;
      writes = writes.then(() => stream.writeSSE({ event, data: JSON.stringify(data), id: String(id++) }));
    };
    const unsubscribe = subscribeToAppEvents((event) => enqueue("app", event));
    enqueue("ready", {});
    await new Promise<void>((resolveStream) => {
      const heartbeat = setInterval(() => enqueue("ping", { at: Date.now() }), 15_000);
      stream.onAbort(() => {
        stopped = true;
        clearInterval(heartbeat);
        unsubscribe();
        resolveStream();
      });
    });
  });
});

// ---------- refresh ----------

api.post("/refresh", async (c) => {
  const result = await refreshAll({ force: true });
  log.info("refresh.manual_requested", { channels: result.channels, added: result.added, errors: result.errors.length });
  return c.json(result);
});

api.get("/logs", (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 300)));
  return c.json({ ...readRecentLogs(limit), version: VERSION, commit: COMMIT });
});

api.get("/logs/stream", (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 300)));
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-transform");

  return streamSSE(c, async (stream) => {
    let stopped = false;
    let nextEventId = 1;
    let writes = Promise.resolve();
    const enqueue = (event: string, data: unknown) => {
      if (stopped) return;
      writes = writes.then(() => stream.writeSSE({
        event,
        data: JSON.stringify(data),
        id: String(nextEventId++),
      }));
    };

    // Subscribe before the synchronous snapshot read. This closes the gap in
    // which a new log line could otherwise be missed between history and SSE.
    const unsubscribe = subscribeToLogs((entry) => enqueue("log", entry));
    enqueue("snapshot", { ...readRecentLogs(limit), version: VERSION, commit: COMMIT });

    await new Promise<void>((resolveStream) => {
      const heartbeat = setInterval(() => enqueue("ping", { at: Date.now() }), 15_000);
      stream.onAbort(() => {
        stopped = true;
        clearInterval(heartbeat);
        unsubscribe();
        resolveStream();
      });
    });
  });
});

api.get("/version", (c) => isAdmin(c)
  ? c.json({ version: VERSION, commit: COMMIT })
  : c.json({ error: "admin only" }, 403));

api.post("/updates/check", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  try {
    const result = await checkLatestRelease();
    log.info("updates.manual_check", { currentVersion: VERSION, latestVersion: result.latestVersion });
    return c.json(result);
  } catch (error) {
    log.warn("updates.manual_check_failed", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: "GitHub update check failed" }, 502);
  }
});

api.get("/notifications", async (c) => {
  const uid = currentUserId(c);
  const rows = await database.prepare(`
    SELECT id, kind, payload, target, read_at, created_at
    FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30
  `).all(uid) as { id: number; kind: string; payload: string; target: string; read_at: string | null; created_at: string }[];
  const unread = (await database.prepare("SELECT count(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL").get(uid) as { count: number }).count;
  return c.json({ notifications: rows.map((row) => ({ ...row, payload: JSON.parse(row.payload || "{}") })), unread });
});

api.post("/notifications/:id/read", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ? AND user_id = ?").run(Number(c.req.param("id")), uid);
  publishAppEvent("notifications");
  return c.json({ ok: true });
});

api.post("/notifications/read-all", async (c) => {
  await database.prepare("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE user_id = ?").run(currentUserId(c));
  publishAppEvent("notifications");
  return c.json({ ok: true });
});
