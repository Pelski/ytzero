import { Hono } from "hono";
import { db, getSetting, setSetting, getUserSetting, setUserSetting, SETTING_DEFAULTS, GLOBAL_SETTING_KEYS, USER_SETTING_KEYS } from "./db";
import {
  type ChannelAbout,
  fetchChannelAbout,
  fetchChannelFeed,
  fetchChannelPlaylists,
  fetchChannelSubscriberCountFromWatch,
  fetchChannelVideosDurations,
  fetchPlaylistVideos,
  fetchVideoChapters,
  fetchVideoInfo,
  parseOpml,
  parseTakeoutCsv,
  resolveChannelId,
  searchYouTube,
} from "./youtube";
import { getCachedImage } from "./imgcache";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { importPlaylistVideos, refreshAll, refreshChannel, refreshLiveStatus, syncChannel } from "./refresher";
import { applyRuleToAllVideos } from "./autotags";
import { applyPlaylistRuleToAllVideos, applyPlaylistRulesForPlaylist } from "./userPlaylists";
import { applyFilterRuleToAll } from "./filterRules";
import { log, readRecentLogs } from "./logger";
import { COMMIT, VERSION } from "./version";
import { discoveryRecommendations, dismissDiscoveryRecommendation, getPluginSettings, listPlugins, pluginEnabled, refreshDiscoveryInBackground, refreshDiscoveryNow, resetPluginState, setPluginEnabled, setPluginSettings } from "./plugins";
import { activeDownloadProgress, cancelAutoDownloadIfUnwanted, downloadCookiesConfigured, downloadStats, enqueueDownload, fetchSubtitles, getDownload, listDownloads, listSubtitleFiles, prioritizeDownload, removeDownload, removeDownloadCookies, saveDownloadCookies, setDownloadPinned, srtToVtt, ytdlpStatus } from "./downloader";
import { SUBTITLE_LANGUAGE_CODES } from "./subtitleLanguages";
import { activeChildPlayback, applyGrant, CHILD_GRANTS, type ChildGrant, childHidesLive, childLocalOnly, childStatus, clearChildLockFailures, isChildUser, isParentLocked, isPinLocked, lastWatchedVideo, lockChildByParent, recordWatchTick, registerChildLockFailure, unlockChildProfile } from "./childTime";
import { buildHouseholdInsights, INSIGHT_RANGES } from "./insights";
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

export const api = new Hono<{ Variables: { userId: number; sessionAdmin?: boolean } }>();

api.onError((err, c) => {
  log.error("api.unhandled_error", { path: c.req.path, method: c.req.method, error: err.message });
  return c.json({ error: err.message }, 500);
});

// ---------- helpers ----------

const CHILD_LOCK_SESSION_COOKIE = "ytzero_child_lock";
const CHILD_LOCK_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
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
  return { enabled, locked: enabled && !hasChildLockSession(c) };
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

const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?");
const firstUserId = db.prepare("SELECT id FROM users ORDER BY sort_order ASC, id ASC LIMIT 1");
// The primary profile (lowest id = the original "Default"). It is the only one
// that owns app-wide settings (app name, icon color, child lock) and can't be
// deleted.
const primaryUserIdStmt = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1");
function primaryUserId(): number {
  return (primaryUserIdStmt.get() as { id: number }).id;
}
function isPrimaryUser(c: any): boolean {
  return currentUserId(c) === primaryUserId();
}
// Admin = the primary profile (always, for local recovery) OR an OIDC session
// whose groups claim matched the configured admin group. Admins get
// primary-equivalent powers (auth config, global settings, profile/channel mgmt).
function isAdmin(c: any): boolean {
  return isPrimaryUser(c) || Boolean(c.get("sessionAdmin"));
}
// Who may edit a profile's general settings (name/color/avatar): the owner, or
// an admin. PIN changes and deletion are owner-only (see handlers).
function canManageProfile(c: any, id: number): boolean {
  return currentUserId(c) === id || isAdmin(c);
}

/** Active profile id for the request (validated; falls back to the first profile). */
function currentUserId(c: any): number {
  return c.get("userId");
}

// Falls back to the cookie-selected profile (or the first profile). Used by the
// 'none' method and by any session whose scope allows free profile switching.
function profileFromCookie(c: any): number {
  const raw = Number(parseCookies(c.req.header("cookie"))[PROFILE_COOKIE]);
  const valid = Number.isInteger(raw) && raw > 0 && userExists.get(raw);
  return valid ? raw : (firstUserId.get() as { id: number } | null)?.id ?? 0;
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
    c.set("userId", profileFromCookie(c));
    return next();
  }

  if (method === "proxy_header") {
    const uid = resolveProxyUser(c);
    if (uid) {
      c.set("userId", uid);
      return next();
    }
    c.set("userId", 0);
    if (isAuthFreePath(path)) return next();
    return c.json({ error: "unauthenticated", method }, 401);
  }

  // shared | per_profile | oidc → server-side session
  const session = validateSession(parseCookies(c.req.header("cookie"))[AUTH_SESSION_COOKIE]);
  if (session) {
    c.set("userId", session.scope === "account" ? profileFromCookie(c) : session.user_id ?? 0);
    c.set("sessionAdmin", session.is_admin);
    return next();
  }
  c.set("userId", 0);
  if (isAuthFreePath(path)) return next();
  return c.json({ error: "unauthenticated", method }, 401);
});

/** True when the active auth method permits internal profile switching. */
function canSwitchProfiles(): boolean {
  const method = authMethod();
  if (method === "none" || method === "shared") return true;
  if (method === "oidc") return (getSetting("auth_oidc_mode") || "mapped") === "gateway";
  return false;
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

const SETTINGS_MUTATION_PREFIXES = [
  "/settings",
  "/channels",
  "/tags",
  "/rules",
  "/filter-rules",
  "/playlists",
  "/plugins",
];

// Tags and personal playlists belong to the active profile and remain editable
// even while the shared settings lock is closed.
function isPersonalMutation(path: string) {
  return path === "/tags" || path.startsWith("/tags/")
    || path === "/rules" || path.startsWith("/rules/")
    || path === "/playlists" || path.startsWith("/playlists/")
    || path.startsWith("/videos/") && path.includes("/tags")
    || path.startsWith("/channels/") && path.includes("/tags");
}

api.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/^\/api/, "");
  const method = c.req.method.toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const isProtected = SETTINGS_MUTATION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (isMutation && isProtected && !isPersonalMutation(path) && !path.startsWith("/child-lock") && !hasChildLockSession(c)) {
    return c.json({ error: "settings locked" }, 423);
  }
  await next();
});

interface VideoRow {
  video_id: string;
  channel_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: string | null;
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

function attachWatchedState<T>(uid: number, items: T[], videoId: (item: T) => string | null | undefined) {
  const ids = [...new Set(items.map(videoId).filter((id): id is string => !!id))];
  if (ids.length === 0) return items.map((item) => ({ ...item, watched: 0 }));
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT video_id FROM user_videos WHERE user_id = ? AND watched = 1 AND video_id IN (${placeholders})`
  ).all(uid, ...ids) as { video_id: string }[];
  const watched = new Set(rows.map((row) => row.video_id));
  return items.map((item) => ({ ...item, watched: watched.has(videoId(item) ?? "") ? 1 : 0 }));
}

function attachTags(uid: number, videos: VideoRow[]) {
  if (videos.length === 0) return [];
  // downloads_allowed: the profile may use downloads at all (not a child);
  // downloads_enabled additionally requires the plugin to be turned on. The UI
  // shows the download action for allowed-but-disabled and links to settings.
  const downloadsAllowed = !isChildUser(uid);
  const downloadsEnabled = pluginEnabled("downloads") && downloadsAllowed;
  // Live percentage for the one video the downloader is fetching right now,
  // so lists can paint a download progress bar without a dedicated request.
  const dlProgress = activeDownloadProgress();
  const ids = videos.map((v) => v.video_id);
  const ph = ids.map(() => "?").join(",");
  // Tags are per profile: only surface tags owned by the active user.
  const videoTags = db
    .prepare(
      `SELECT vt.video_id, t.id, t.name, t.color, t.filter_only, vt.source FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id AND t.user_id = ? WHERE vt.video_id IN (${ph})`
    )
    .all(uid, ...ids) as any[];
  const channelIds = [...new Set(videos.map((v) => v.channel_id))];
  const chPh = channelIds.map(() => "?").join(",");
  const channelTags = db
    .prepare(
      `SELECT ct.channel_id, t.id, t.name, t.color, t.filter_only FROM channel_tags ct
       JOIN tags t ON t.id = ct.tag_id AND t.user_id = ? WHERE ct.channel_id IN (${chPh})`
    )
    .all(uid, ...channelIds) as any[];

  return videos.map((v) => {
    const own = videoTags
      .filter((t) => t.video_id === v.video_id)
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: t.source }));
    const inherited = channelTags
      .filter((t) => t.channel_id === v.channel_id && !own.some((o) => o.id === t.id))
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: "channel" }));
    const download_progress = (v as any).download_status === "downloading" && dlProgress?.video_id === v.video_id
      ? dlProgress.percent
      : null;
    return { ...v, downloads_enabled: downloadsEnabled, downloads_allowed: downloadsAllowed, download_progress, tags: [...own, ...inherited] };
  });
}

/** WHERE fragment excluding videos that have a filter_only tag unless one of those tags is selected.
 *  For channels: hidden only when ALL channel tags are filter_only (not just any one). */
function filterOnlySql(uid: number, tagIds: number[]) {
  // Video-level: exclude if video itself has any filter_only tag (owned by the user).
  const noVideoFO = `NOT EXISTS (SELECT 1 FROM video_tags vt2 JOIN tags t2 ON t2.id = vt2.tag_id AND t2.user_id = ${uid} WHERE vt2.video_id = v.video_id AND t2.filter_only = 1)`;
  // Channel-level: exclude only when channel has (user's) tags and every one of them is filter_only.
  const noChannelFO = `(NOT EXISTS (SELECT 1 FROM channel_tags ct2 JOIN tags t2 ON t2.id = ct2.tag_id AND t2.user_id = ${uid} WHERE ct2.channel_id = v.channel_id)
     OR EXISTS (SELECT 1 FROM channel_tags ct2 JOIN tags t2 ON t2.id = ct2.tag_id AND t2.user_id = ${uid} WHERE ct2.channel_id = v.channel_id AND t2.filter_only = 0))`;
  const noFO = `(${noVideoFO} AND ${noChannelFO})`;
  if (tagIds.length === 0) return { sql: noFO, params: [] };
  const ph = tagIds.map(() => "?").join(",");
  return {
    sql: `(${noFO} OR EXISTS (SELECT 1 FROM video_tags vt3 JOIN tags t3 ON t3.id = vt3.tag_id AND t3.user_id = ${uid} WHERE vt3.video_id = v.video_id AND t3.filter_only = 1 AND t3.id IN (${ph})) OR EXISTS (SELECT 1 FROM channel_tags ct3 JOIN tags t3 ON t3.id = ct3.tag_id AND t3.user_id = ${uid} WHERE ct3.channel_id = v.channel_id AND t3.filter_only = 1 AND t3.id IN (${ph})))`,
    params: [...tagIds, ...tagIds],
  };
}

/** WHERE fragment matching videos that have ANY of the given tags (own or via channel). */
function tagFilterSql(uid: number, tagIds: number[]) {
  const ph = tagIds.map(() => "?").join(",");
  return {
    sql: `(EXISTS (SELECT 1 FROM video_tags vt JOIN tags t ON t.id = vt.tag_id AND t.user_id = ${uid} WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
       OR EXISTS (SELECT 1 FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ${uid} WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))`,
    params: [...tagIds, ...tagIds],
  };
}

// Per-profile video projection: status/bucket/liked/progress come from the
// active user's user_videos row (absent = default inbox); history is per user.
// uid is a validated integer, safe to inline.
function videoSelect(uid: number) {
  return `
  SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail,
         v.published_at, v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
         v.is_short, v.views, v.likes, uv.liked, uv.watched,
         v.duration, uv.watch_position, uv.watch_duration, v.external,
         EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ${uid}) AS in_history,
         (SELECT d.status FROM downloads d WHERE d.video_id = v.video_id AND d.status != 'deleted') AS download_status,
         COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count
  FROM videos v JOIN channels c ON c.channel_id = v.channel_id
  LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${uid}`;
}

/** EXISTS fragment: the active user follows this video's channel. */
function followedExists(uid: number) {
  return `EXISTS (SELECT 1 FROM user_channels uc WHERE uc.channel_id = v.channel_id AND uc.user_id = ${uid} AND uc.followed = 1)`;
}

function localSQLite(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

function computeShowFrom(bucket: string): string {
  const now = new Date();
  const d = new Date(now);
  const h = now.getHours();

  if (bucket === "today") {
    return localSQLite(now);
  } else if (bucket === "tonight") {
    // Today at 19:00 if before, otherwise immediately.
    if (h < 19) d.setHours(19, 0, 0, 0);
    else return localSQLite(now);
  } else if (bucket === "tomorrow") {
    // Always tomorrow 06:00
    d.setDate(d.getDate() + 1);
    d.setHours(6, 0, 0, 0);
  } else if (bucket === "tomorrow_evening") {
    // Always tomorrow 19:00
    d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
  } else if (bucket === "weekend") {
    const day = d.getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) {
      return localSQLite(now); // already weekend → now
    }
    const daysUntilSat = (6 - day + 7) % 7;
    d.setDate(d.getDate() + daysUntilSat);
    d.setHours(0, 0, 0, 0);
  }
  return localSQLite(d);
}

// ---------- feed ----------

api.get("/feed", (c) => {
  const uid = currentUserId(c);
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const limit = Math.min(100, Number(c.req.query("limit") ?? 40));
  const q = c.req.query("q")?.trim();
  const channel = c.req.query("channel");
  const tagsParam = c.req.query("tags"); // comma-separated tag ids
  const status = c.req.query("status") ?? "inbox"; // inbox | all
  const allSources = c.req.query("all_sources") === "1";

  const where: string[] = [];
  const params: any[] = [];
  if (status !== "all") {
    where.push("COALESCE(uv.status, 'inbox') = ?");
    params.push(status);
  }
  if (channel) {
    where.push("v.channel_id = ?");
    params.push(channel);
  } else if (!allSources) {
    where.push(followedExists(uid));
    where.push("v.external = 0");
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
  if (c.req.query("liked") === "1") {
    where.push("uv.liked = 1");
  }
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
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`${videoSelect(uid)} ${whereSql} ORDER BY v.published_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, page * limit) as VideoRow[];
  return c.json({ videos: attachTags(uid, rows), page, limit });
});

api.get("/in-progress", (c) => {
  const uid = currentUserId(c);
  const rows = db.prepare(`
    ${videoSelect(uid)}
    JOIN (SELECT video_id, MAX(watched_at) AS last_watched FROM history WHERE user_id = ${uid} GROUP BY video_id) lw ON lw.video_id = v.video_id
    WHERE uv.watch_position IS NOT NULL AND uv.watch_duration IS NOT NULL
      AND uv.watch_duration > 30
      AND uv.watch_position >= 3
      AND CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92
      AND COALESCE(uv.status, 'inbox') = 'inbox'
      AND ${followedExists(uid)}
    ORDER BY lw.last_watched DESC
    LIMIT 20
  `).all() as VideoRow[];
  return c.json({ videos: attachTags(uid, rows) });
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
      results: attachWatchedState(uid, search.results, (result) => result.videoId),
      channels: search.channels,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ---------- child profiles (time limits & requests) ----------

api.get("/child/status", (c) => c.json(childStatus(currentUserId(c))));

api.get("/child/now-watching", (c) => {
  if (isChildUser(currentUserId(c))) return c.json({ watching: [] });
  const active = activeChildPlayback();
  if (active.length === 0) return c.json({ watching: [] });
  const rows = active.flatMap(({ userId, videoId }) => {
    const row = db.prepare(
      `SELECT u.id AS user_id, u.name, u.avatar, u.avatar_color,
              v.video_id, v.title, v.thumbnail, v.channel_id,
              COALESCE(ch.custom_title, ch.title) AS channel_title, ch.thumbnail AS channel_thumbnail
       FROM users u JOIN videos v ON v.video_id = ?
       JOIN channels ch ON ch.channel_id = v.channel_id
       WHERE u.id = ? AND u.is_child = 1`
    ).get(videoId, userId) as any;
    if (!row) return [];
    const status = childStatus(userId);
    return [{
      ...row,
      avatar: row.avatar ? `/api/profiles/${row.user_id}/avatar?v=${encodeURIComponent(row.avatar)}` : "",
      remaining_seconds: status.remaining_seconds,
      unlimited_today: status.unlimited_today,
    }];
  });
  return c.json({ watching: rows });
});

api.post("/child/now-watching/:id/stop", (c) => {
  if (isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const childId = Number(c.req.param("id"));
  if (!Number.isInteger(childId) || !isChildUser(childId)) return c.json({ error: "not found" }, 404);
  lockChildByParent(childId);
  log.info("child.playback_stopped", { user_id: childId, by_user_id: currentUserId(c) });
  return c.json({ ok: true });
});

// Child asks for more watch time; parents see it on their home feed for 1 h.
api.post("/child/time-request", async (c) => {
  const uid = currentUserId(c);
  if (!isChildUser(uid)) return c.json({ error: "not a child profile" }, 403);
  const { video_id } = await c.req.json().catch(() => ({}));
  const existing = db.prepare(
    "SELECT id FROM child_time_requests WHERE user_id = ? AND status = 'pending' AND created_at > datetime('now', '-1 hour')"
  ).get(uid) as { id: number } | null;
  if (existing) return c.json({ ok: true, id: existing.id });
  const videoId = typeof video_id === "string" && video_id ? video_id : lastWatchedVideo(uid);
  const row = db.prepare(
    "INSERT INTO child_time_requests (user_id, video_id) VALUES (?, ?) RETURNING id"
  ).get(uid, videoId) as { id: number };
  log.info("child.time_requested", { user_id: uid, video_id: videoId });
  return c.json({ ok: true, id: row.id });
});

// Pending requests, for parent (non-child) profiles.
api.get("/child/time-requests", (c) => {
  if (isChildUser(currentUserId(c))) return c.json({ requests: [] });
  const rows = db.prepare(
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
  if (isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const reqId = Number(c.req.param("id"));
  const request = db.prepare(
    "SELECT * FROM child_time_requests WHERE id = ? AND status = 'pending'"
  ).get(reqId) as { id: number; user_id: number; video_id: string | null } | null;
  if (!request) return c.json({ error: "not found" }, 404);
  const { action, grant, pin } = await c.req.json().catch(() => ({}));

  if (action === "dismiss") {
    db.prepare("UPDATE child_time_requests SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?").run(reqId);
    return c.json({ ok: true });
  }
  if (action !== "approve" || !CHILD_GRANTS.includes(grant)) return c.json({ error: "invalid action" }, 400);

  // Approvals are confirmed with the app-wide child lock PIN, so the child
  // can't approve their own request from an unattended parent screen. Wrong
  // attempts count against the child profile's lockout.
  if (isChildLockEnabled()) {
    if (!isSixDigitPin(pin) || !(await verifyChildLockPin(pin))) {
      registerChildLockFailure(request.user_id);
      return c.json({ error: "invalid PIN", pin_locked: isPinLocked(request.user_id) }, 401);
    }
    clearChildLockFailures(request.user_id);
  }
  applyGrant(request.user_id, grant as ChildGrant, request.video_id);
  db.prepare(
    "UPDATE child_time_requests SET status = 'approved', grant_type = ?, resolved_at = datetime('now') WHERE id = ?"
  ).run(grant, reqId);
  log.info("child.time_granted", { user_id: request.user_id, grant });
  return c.json({ ok: true });
});

// Clear a child profile's failed-PIN lockout (primary only).
api.post("/profiles/:id/unlock-child", (c) => {
  if (!isAdmin(c)) return c.json({ error: "primary only" }, 403);
  const id = Number(c.req.param("id"));
  if (!isChildUser(id)) return c.json({ error: "not a child profile" }, 400);
  unlockChildProfile(id);
  log.info("child.pin_unlocked", { id });
  return c.json({ ok: true });
});

// ---------- household viewing insights ----------

api.get("/insights", (c) => {
  const uid = currentUserId(c);
  // The page compares every household profile, so keep it on the parent side
  // of the product just like child controls and the activity panel.
  if (isChildUser(uid)) return c.json({ error: "parent profile required" }, 403);

  const requestedDays = Number(c.req.query("days") ?? 30);
  const days = INSIGHT_RANGES.includes(requestedDays as (typeof INSIGHT_RANGES)[number]) ? requestedDays : 30;
  const requestedProfile = c.req.query("profile");
  const profileId = requestedProfile && requestedProfile !== "all" ? Number(requestedProfile) : null;
  if (profileId != null && (!Number.isInteger(profileId) || profileId <= 0)) {
    return c.json({ error: "invalid profile" }, 400);
  }
  try {
    return c.json(buildHouseholdInsights(days, profileId));
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
  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const segmentUuid = typeof body.segment_uuid === "string" ? body.segment_uuid : "";
  const category = typeof body.category === "string" ? body.category : "";
  const seconds = Number(body.skipped_seconds);
  if (!eventId || eventId.length > 100 || !segmentUuid || segmentUuid.length > 100 ||
      !category || category.length > 50 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 21_600) {
    return c.json({ error: "invalid SponsorBlock skip" }, 400);
  }
  db.prepare(`
    INSERT OR IGNORE INTO sponsorblock_skip_log
      (event_id, user_id, video_id, segment_uuid, category, skipped_seconds)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventId, currentUserId(c), videoId, segmentUuid, category, seconds);
  return c.json({ ok: true });
});

// ---------- built-in plugins ----------

api.get("/plugins", (c) => {
  const uid = currentUserId(c);
  return c.json({ plugins: listPlugins(getUserSetting(uid, "language")) });
});

api.put("/plugins/:id", async (c) => {
  const { enabled } = await c.req.json() as { enabled?: boolean };
  try {
    setPluginEnabled(c.req.param("id"), !!enabled);
    return c.json({ plugins: listPlugins(getUserSetting(currentUserId(c), "language")) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.get("/plugins/:id/settings", (c) => {
  try {
    const uid = currentUserId(c);
    return c.json(getPluginSettings(uid, c.req.param("id"), getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.put("/plugins/:id/settings", async (c) => {
  try {
    const uid = currentUserId(c);
    const body = await c.req.json();
    return c.json(setPluginSettings(uid, c.req.param("id"), body, getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.post("/plugins/:id/reset", async (c) => {
  try {
    const uid = currentUserId(c);
    return c.json(await resetPluginState(uid, c.req.param("id"), getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

// yt-dlp accepts a Netscape-format cookie jar. Keep the secret in a private
// server-side file rather than the settings table, which is returned to UI.
api.get("/plugins/downloads/cookies", (c) => c.json({ configured: downloadCookiesConfigured() }));

api.post("/plugins/downloads/cookies", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "cookies.txt file required" }, 400);
    saveDownloadCookies(await file.text());
    return c.json({ configured: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

api.delete("/plugins/downloads/cookies", (c) => {
  removeDownloadCookies();
  return c.json({ configured: false });
});

// ---------- downloads plugin ----------

api.get("/downloads", async (c) => {
  return c.json({
    enabled: pluginEnabled("downloads"),
    ytdlp_version: await ytdlpStatus(),
    stats: downloadStats(),
    active: activeDownloadProgress(),
    downloads: listDownloads(),
  });
});

api.post("/videos/:id/download", async (c) => {
  if (isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  if (!pluginEnabled("downloads")) return c.json({ error: "plugin disabled" }, 409);
  const id = c.req.param("id");
  const video = db.prepare("SELECT live_status FROM videos WHERE video_id = ?").get(id) as { live_status: string } | null;
  if (!video) return c.json({ error: "not found" }, 404);
  if (video.live_status === "live" || video.live_status === "upcoming") {
    return c.json({ error: "live streams cannot be downloaded while they are active" }, 409);
  }
  const body = await c.req.json().catch(() => ({} as { priority?: boolean }));
  if (body.priority) prioritizeDownload(id);
  else enqueueDownload(id, "manual");
  return c.json({ ok: true, download: getDownload(id) });
});

// Download state for one video, with live progress while it's the active job.
api.get("/videos/:id/download", (c) => {
  const id = c.req.param("id");
  const download = getDownload(id);
  const progress = activeDownloadProgress();
  return c.json({
    download,
    progress: download?.status === "downloading" && progress?.video_id === id ? progress : null,
  });
});

api.delete("/videos/:id/download", (c) => {
  if (isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  removeDownload(c.req.param("id"));
  return c.json({ ok: true });
});

api.put("/videos/:id/download/pin", async (c) => {
  if (isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const { pinned } = await c.req.json() as { pinned?: boolean };
  setDownloadPinned(c.req.param("id"), !!pinned);
  return c.json({ ok: true, download: getDownload(c.req.param("id")) });
});

// Serves the downloaded file to the <video> element. Range support is what
// makes seeking work, so it's handled explicitly.
api.get("/videos/:id/stream", (c) => {
  const row = getDownload(c.req.param("id"));
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

// ---------- subtitles for the local player ----------

function subtitleList(videoId: string) {
  return listSubtitleFiles(videoId).map((s) => ({
    lang: s.lang,
    url: `/api/videos/${videoId}/subtitles/${encodeURIComponent(s.lang)}`,
  }));
}

api.get("/videos/:id/subtitles", (c) => {
  return c.json({ subtitles: subtitleList(c.req.param("id")) });
});

api.get("/videos/:id/subtitles/:lang", async (c) => {
  const file = listSubtitleFiles(c.req.param("id")).find((s) => s.lang === c.req.param("lang"));
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
  if (!pluginEnabled("downloads")) return c.json({ error: "plugin disabled" }, 409);
  const id = c.req.param("id");
  const { lang } = await c.req.json().catch(() => ({}));
  if (typeof lang !== "string" || !SUBTITLE_LANGUAGE_CODES.has(lang)) {
    return c.json({ error: "invalid language" }, 400);
  }
  if (!videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  const ok = await fetchSubtitles(id, lang);
  const subtitles = subtitleList(id);
  return c.json({ ok, downloaded: subtitles.some((s) => s.lang === lang), subtitles });
});

// Download a locally saved video as a file rather than streaming it in the
// player. Kept separate from /stream so local playback retains range support.
api.get("/videos/:id/file", (c) => {
  const row = getDownload(c.req.param("id"));
  if (!row || row.status !== "done" || !row.path || !existsSync(row.path)) {
    return c.json({ error: "not downloaded" }, 404);
  }
  const title = (db.prepare("SELECT title FROM videos WHERE video_id = ?").get(c.req.param("id")) as { title: string } | null)?.title
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
  const tagged = attachTags(uid, localVideos);
  let localIndex = 0;
  return c.json({
    enabled: data.enabled,
    recommendations: data.recommendations.map((r) => {
      if (r.kind !== "local") return r;
      return { ...r, video: tagged[localIndex++] };
    }),
  });
});

api.post("/discovery/recommendations/:id/dismiss", (c) => {
  dismissDiscoveryRecommendation(currentUserId(c), c.req.param("id"));
  return c.json({ ok: true });
});

api.get("/live", (c) => {
  const uid = currentUserId(c);
  if (childHidesLive(uid)) return c.json({ videos: [] });
  const rows = db
    .prepare(`${videoSelect(uid)} WHERE v.live_status IN ('live','upcoming') AND ${followedExists(uid)} ORDER BY v.live_status = 'live' DESC, v.published_at DESC`)
    .all() as VideoRow[];
  return c.json({ videos: attachTags(uid, rows) });
});

// Unlike the global Live page, a channel page can be opened before the channel
// is followed, so this intentionally does not require a subscription.
api.get("/channels/:id/live", (c) => {
  const uid = currentUserId(c);
  if (childHidesLive(uid)) return c.json({ videos: [] });
  const rows = db
    .prepare(`${videoSelect(uid)} WHERE v.channel_id = ? AND v.live_status = 'live' ORDER BY v.published_at DESC`)
    .all(c.req.param("id")) as VideoRow[];
  return c.json({ videos: attachTags(uid, rows) });
});

api.get("/watchlist", (c) => {
  const uid = currentUserId(c);
  const rows = db
    .prepare(`${videoSelect(uid)} WHERE uv.status = 'queued' ORDER BY uv.queued_at DESC`)
    .all() as VideoRow[];
  return c.json({ videos: attachTags(uid, rows) });
});

api.get("/archive", (c) => {
  const uid = currentUserId(c);
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const rows = db
    .prepare(`${videoSelect(uid)} WHERE uv.status = 'archived' ORDER BY v.published_at DESC LIMIT 60 OFFSET ?`)
    .all(page * 60) as VideoRow[];
  return c.json({ videos: attachTags(uid, rows), page });
});

// External ("orphan") videos pulled in for one-off watching: anything that
// belongs to an external channel (not followed, brought in just to watch).
// Watched ones (with a saved position) float to the top.
api.get("/external", (c) => {
  const uid = currentUserId(c);
  const rows = db
    .prepare(`${videoSelect(uid)} WHERE c.external = 1
      ORDER BY (uv.watch_position IS NOT NULL) DESC, v.created_at DESC LIMIT 200`)
    .all() as VideoRow[];
  return c.json({ videos: attachTags(uid, rows) });
});

// Clear orphan externals. Protects anything the user actively saved
// (queued, liked or added to a playlist), then drops now-empty external channels.
api.delete("/external", (c) => {
  // Protect anything ANY profile actively saved (queued, liked, or in a playlist).
  const res = db.prepare(`
    DELETE FROM videos
    WHERE channel_id IN (SELECT channel_id FROM channels WHERE external = 1)
      AND video_id NOT IN (SELECT video_id FROM user_videos WHERE status = 'queued' OR liked = 1)
      AND video_id NOT IN (SELECT video_id FROM user_playlist_videos)
  `).run();
  db.prepare(`
    DELETE FROM channels
    WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)
  `).run();
  return c.json({ deleted: res.changes });
});

// Remove a single external video, then drop its channel if now empty + external.
api.delete("/external/:id", (c) => {
  const id = c.req.param("id");
  const res = db.prepare(`
    DELETE FROM videos
    WHERE video_id = ?
      AND channel_id IN (SELECT channel_id FROM channels WHERE external = 1)
  `).run(id);
  db.prepare(`
    DELETE FROM channels
    WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)
  `).run();
  return c.json({ deleted: res.changes });
});

api.get("/videos/:id/info", async (c) => {
  const uid = currentUserId(c);
  // Restricted child profiles may only open videos already in the library.
  if (childLocalOnly(uid) && !videoExistsStmt.get(c.req.param("id"))) {
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
    db.prepare(`
      INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
      VALUES (?, ?, ?, ?, 0, 1)
      ON CONFLICT(channel_id) DO UPDATE SET
        thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL
                         THEN excluded.thumbnail ELSE channels.thumbnail END
    `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, avatar);

    const insertVideo = db.prepare(`
      INSERT OR IGNORE INTO videos
        (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, external)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'inbox', ?, ?, 1)
    `);

    // Insert the watched video (no-op if already in DB as a real video)
    const inserted = insertVideo.run(
      info.videoId, info.channelId, info.title, info.description,
      info.thumbnail, info.publishedAt, info.liveStatus, info.viewCount, info.duration
    );
    if (info.duration) {
      db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL")
        .run(info.duration, info.videoId);
    }

    // Insert the channel's recent uploads as external so the related panel fills.
    if (feed) {
      const insertMany = db.transaction((videos: typeof feed.videos) => {
        for (const v of videos) {
          insertVideo.run(
            v.videoId, info.channelId, v.title, v.description,
            v.thumbnail, v.publishedAt, "none", v.views, null
          );
        }
      });
      insertMany(feed.videos);
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

async function refreshVideoChapters(videoId: string) {
  const chapters = await fetchVideoChapters(videoId);
  // Persist only when the video is in our DB (UPDATE no-ops otherwise).
  db.prepare("UPDATE videos SET chapters_json = ?, chapters_fetched_at = datetime('now') WHERE video_id = ?")
    .run(JSON.stringify(chapters), videoId);
  return chapters;
}

api.get("/videos/:id/chapters", async (c) => {
  const videoId = c.req.param("id");
  const cached = db.prepare("SELECT chapters_json, chapters_fetched_at FROM videos WHERE video_id = ?")
    .get(videoId) as { chapters_json: string | null; chapters_fetched_at: string | null } | null;

  if (cached?.chapters_json) {
    if (ageMs(cached.chapters_fetched_at) > CHAPTERS_DB_TTL) {
      refreshVideoChapters(videoId).catch(() => {});
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

api.get("/videos/:id", (c) => {
  const uid = currentUserId(c);
  const row = db
    .prepare(`${videoSelect(uid)} WHERE v.video_id = ?`)
    .get(c.req.param("id")) as VideoRow | null;
  if (!row) return c.json({ error: "not found" }, 404);
  if (childHidesLive(uid) && (row.live_status === "live" || row.live_status === "upcoming")) {
    return c.json({ error: "live streams are disabled for this profile" }, 403);
  }
  const [video] = attachTags(uid, [row]);

  // Collect all tag IDs for this video (direct + via channel)
  const tagRows = db.prepare(`
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
      if (seen.has(r.video_id) || r.is_short === 1) continue;
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
    fill(db.prepare(
      `${videoSelect(uid)} WHERE v.video_id != ? AND COALESCE(uv.status, 'inbox') != 'archived' AND v.is_short IS NOT 1
       AND (EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
         OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))
       ORDER BY v.published_at DESC LIMIT ?`
    ).all(row.video_id, ...tagIds, ...tagIds, RELATED_TARGET) as VideoRow[]);
  }

  // Step 2 — same channel, fill what's missing
  if (need() > 0) {
    fill(db.prepare(
      `${videoSelect(uid)} WHERE v.channel_id = ? AND v.video_id != ? AND COALESCE(uv.status, 'inbox') != 'archived' AND v.is_short IS NOT 1
       ORDER BY v.published_at DESC LIMIT ?`
    ).all(row.channel_id, row.video_id, need() * 2) as VideoRow[]);
  }

  // Step 3 — other channels with any shared tag, fill what's missing
  if (need() > 0 && tagRows.length > 0) {
    const tagIds = tagRows.map((t) => t.tag_id);
    const ph = tagIds.map(() => "?").join(",");
    const seenPh = [...seen].map(() => "?").join(",");
    fill(db.prepare(
      `${videoSelect(uid)} WHERE v.video_id NOT IN (${seenPh}) AND COALESCE(uv.status, 'inbox') != 'archived' AND v.is_short IS NOT 1
       AND (EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
         OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))
       ORDER BY v.published_at DESC LIMIT ?`
    ).all(...seen, ...tagIds, ...tagIds, need() * 2) as VideoRow[]);
  }

  // Step 4 — any recent non-archived non-short inbox/queued videos
  if (need() > 0) {
    const seenPh = [...seen].map(() => "?").join(",");
    fill(db.prepare(
      `${videoSelect(uid)} WHERE v.video_id NOT IN (${seenPh}) AND COALESCE(uv.status, 'inbox') != 'archived' AND v.is_short IS NOT 1
       ORDER BY v.published_at DESC LIMIT ?`
    ).all(...seen, need() * 2) as VideoRow[]);
  }

  // Active profile's per-channel playback speed override (NULL = use global).
  const speedRow = db.prepare("SELECT playback_speed FROM user_channels WHERE user_id = ? AND channel_id = ?").get(uid, row.channel_id) as { playback_speed: string | null } | null;
  (video as any).channel_playback_speed = speedRow?.playback_speed ?? null;

  return c.json({ video, related: attachTags(uid, related) });
});

// ---------- video actions ----------

const BUCKETS = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];

// Upsert helpers for the active profile's per-video state. A row is created on
// first action; subsequent actions update it. (videoExists guards FK errors.)
const videoExistsStmt = db.prepare("SELECT 1 FROM videos WHERE video_id = ?");

api.post("/videos/:id/queue", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { bucket } = await c.req.json();
  if (!BUCKETS.includes(bucket)) return c.json({ error: "invalid bucket" }, 400);
  if (!videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  const showFrom = computeShowFrom(bucket);
  db.prepare(
    `INSERT INTO user_videos (user_id, video_id, status, bucket, queued_at, show_from)
     VALUES (?, ?, 'queued', ?, datetime('now'), ?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'queued', bucket = excluded.bucket, queued_at = excluded.queued_at, show_from = excluded.show_from`
  ).run(uid, id, bucket, showFrom);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/archive", (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (!videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  db.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'archived')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'archived', bucket = NULL, show_from = NULL`
  ).run(uid, id);
  // Rejecting a video also stops a pending auto download nobody else waits for.
  cancelAutoDownloadIfUnwanted(id);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/restore", (c) => {
  const uid = currentUserId(c);
  db.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'inbox')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'inbox', bucket = NULL, show_from = NULL`
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/dequeue", (c) => {
  const uid = currentUserId(c);
  db.prepare(
    `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'inbox')
     ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'inbox', bucket = NULL, queued_at = NULL, show_from = NULL`
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/watch", (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (videoExistsStmt.get(id)) {
    db.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(id, uid);
    refreshDiscoveryInBackground(uid);
  }
  return c.json({ ok: true });
});

api.post("/videos/:id/complete", (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  if (!videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  db.prepare(
    `INSERT INTO user_videos (user_id, video_id, watched) VALUES (?, ?, 1)
     ON CONFLICT(user_id, video_id) DO UPDATE SET watched = 1`
  ).run(uid, id);
  db.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(id, uid);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.put("/videos/:id/like", async (c) => {
  const uid = currentUserId(c);
  const id = c.req.param("id");
  const { liked } = await c.req.json() as { liked: boolean };
  if (!videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  db.prepare(
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
  if (!videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  db.prepare(
    `INSERT INTO user_videos (user_id, video_id, watch_position, watch_duration) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET watch_position = excluded.watch_position, watch_duration = excluded.watch_duration`
  ).run(uid, id, position, duration);
  recordWatchTick(uid, id);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/videos/:id/progress", (c) => {
  const uid = currentUserId(c);
  db.prepare(
    "UPDATE user_videos SET watch_position = NULL, watch_duration = NULL WHERE user_id = ? AND video_id = ?"
  ).run(uid, c.req.param("id"));
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.post("/videos/:id/tags", async (c) => {
  const uid = currentUserId(c);
  const { tag_id } = await c.req.json();
  // Only allow tagging with a tag the active profile owns.
  if (!db.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) {
    return c.json({ error: "tag not found" }, 404);
  }
  db.prepare("INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) VALUES (?, ?, 'manual')").run(
    c.req.param("id"),
    tag_id
  );
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/videos/:id/tags/:tagId", (c) => {
  const uid = currentUserId(c);
  db.prepare("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?").run(
    c.req.param("id"),
    c.req.param("tagId")
  );
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

// ---------- history ----------

api.get("/history", (c) => {
  const uid = currentUserId(c);
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const rows = db
    .prepare(
      `SELECT MAX(h.id) AS history_id, MAX(h.watched_at) AS watched_at,
              v.video_id, v.channel_id, v.title, v.description, v.duration,
              v.thumbnail, v.published_at, v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket,
              uv.watch_position, uv.watch_duration, uv.watched,
              COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail
       FROM history h JOIN videos v ON v.video_id = h.video_id
       JOIN channels c ON c.channel_id = v.channel_id
       LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
       WHERE h.user_id = ?
       GROUP BY v.video_id
       ORDER BY MAX(h.watched_at) DESC LIMIT 60 OFFSET ?`
    )
    .all(uid, uid, page * 60) as (VideoRow & { history_id: number; watched_at: string })[];
  return c.json({ videos: attachTags(uid, rows as VideoRow[]), page });
});

api.delete("/history/:id", (c) => {
  const uid = currentUserId(c);
  db.prepare("DELETE FROM history WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
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

api.get("/channels", (c) => {
  const uid = currentUserId(c);
  const channels = db.prepare(
    `SELECT ch.* FROM channels ch
     JOIN user_channels uc ON uc.channel_id = ch.channel_id AND uc.user_id = ? AND uc.followed = 1
     WHERE ch.external = 0 ORDER BY COALESCE(ch.custom_title, ch.title) COLLATE NOCASE`
  ).all(uid) as any[];
  const tags = db
    .prepare(
      `SELECT ct.channel_id, t.id, t.name, t.color FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ?`
    )
    .all(uid) as any[];
  return c.json({
    channels: channels.map((ch) => ({
      ...serializeChannel(ch),
      tags: tags.filter((t) => t.channel_id === ch.channel_id).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    })),
  });
});

api.post("/channels", async (c) => {
  // A child may subscribe only after a parent unlocked settings for this browser.
  if (isChildUser(currentUserId(c)) && !hasChildLockSession(c)) return c.json({ error: "settings locked" }, 423);
  const uid = currentUserId(c);
  const { url, custom_name } = await c.req.json();
  if (!url) return c.json({ error: "url required" }, 400);
  const info = await resolveChannelId(url);
  const inserted = db.prepare(
    "INSERT OR IGNORE INTO channels (channel_id, title, url, thumbnail) VALUES (?, ?, ?, ?)"
  ).run(info.channelId, info.title, `https://www.youtube.com/channel/${info.channelId}`, info.thumbnail);
  // Subscribe the active profile (and unmark external if it was an orphan).
  db.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1`
  ).run(uid, info.channelId);
  db.prepare("UPDATE channels SET external = 0 WHERE channel_id = ?").run(info.channelId);
  const customTitle = typeof custom_name === "string" ? custom_name.trim() : "";
  if (customTitle) db.prepare("UPDATE channels SET custom_title = ? WHERE channel_id = ?").run(customTitle, info.channelId);
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
  if (!Number.isInteger(uid) || !db.prepare("SELECT 1 FROM users WHERE id = ?").get(uid)) {
    return c.json({ error: "profile not found" }, 404);
  }
  const res = db.prepare(
    `INSERT OR IGNORE INTO user_channels (user_id, channel_id, followed)
     SELECT ?, channel_id, 1 FROM channels WHERE external = 0`
  ).run(uid);
  log.info("channels.assigned_all", { user_id: uid, added: res.changes });
  return c.json({ ok: true, added: res.changes });
});

// Unsubscribe the active profile. The channel/videos stay (other profiles may
// follow it; the refresher stops touching it once nobody does).
api.delete("/channels/:id", (c) => {
  const uid = currentUserId(c);
  db.prepare("DELETE FROM user_channels WHERE user_id = ? AND channel_id = ?").run(uid, c.req.param("id"));
  return c.json({ ok: true });
});

// Set or clear the channel's custom display name. Empty / null reverts to the
// original YouTube title (kept untouched in `title`).
api.put("/channels/:id/name", async (c) => {
  const channelId = c.req.param("id");
  if (!db.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId)) {
    return c.json({ error: "not found" }, 404);
  }
  const { custom_title } = await c.req.json().catch(() => ({}));
  const value = typeof custom_title === "string" && custom_title.trim() ? custom_title.trim() : null;
  db.prepare("UPDATE channels SET custom_title = ? WHERE channel_id = ?").run(value, channelId);
  log.info("channel.renamed", { channelId, custom_title: value });
  const ch = db.prepare("SELECT * FROM channels WHERE channel_id = ?").get(channelId) as any;
  return c.json({ ok: true, channel: serializeChannel(ch) });
});

api.post("/channels/:id/tags", async (c) => {
  const uid = currentUserId(c);
  const { tag_id } = await c.req.json();
  const channelId = c.req.param("id");
  if (!db.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) {
    return c.json({ error: "tag not found" }, 404);
  }
  db.prepare("INSERT OR IGNORE INTO channel_tags (channel_id, tag_id) VALUES (?, ?)").run(channelId, tag_id);
  // Propagate to all existing videos of this channel
  db.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT video_id, ?, 'channel' FROM videos WHERE channel_id = ?"
  ).run(tag_id, channelId);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/channels/:id/tags/:tagId", (c) => {
  const uid = currentUserId(c);
  const channelId = c.req.param("id");
  const tagId = c.req.param("tagId");
  db.prepare("DELETE FROM channel_tags WHERE channel_id = ? AND tag_id = ?").run(channelId, tagId);
  // Remove channel-propagated tags from videos (keep manually added ones)
  db.prepare(
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

const ABOUT_DB_TTL = 3 * 24 * 60 * 60_000;
const PLAYLISTS_DB_TTL = 3 * 24 * 60 * 60_000;
const CHAPTERS_DB_TTL = 7 * 24 * 60 * 60_000;

function persistChannelAbout(channelId: string, about: ChannelAbout) {
  db.prepare(
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
  const aboutForStorage = watchSubscriber?.subscriberCount
    ? { ...about, subscriberCount: watchSubscriber.subscriberCount }
    : about;
  persistChannelAbout(channelId, aboutForStorage);
  fetchChannelVideosDurations(channelId).then((durations) => {
    const upd = db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL");
    for (const d of durations) upd.run(d.duration, d.videoId);
  }).catch(() => {});
  return aboutForStorage;
}

api.get("/channels/:id/about", async (c) => {
  const channelId = c.req.param("id");
  // Real counts from our own data — stable regardless of how many pages the
  // UI has loaded (NULL is_short counts as a regular video, matching the UI).
  const row = db.prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(is_short = 1), 0) AS shorts FROM videos WHERE channel_id = ?"
  ).get(channelId) as { total: number; shorts: number };
  const counts = { videos: row.total - row.shorts, shorts: row.shorts };
  // The channel page header shows the custom name too; the scraped about
  // payload keeps the original underneath.
  const customTitle = (db.prepare("SELECT custom_title FROM channels WHERE channel_id = ?").get(channelId) as { custom_title: string | null } | null)?.custom_title ?? null;
  const withCustomTitle = <T extends { title: string }>(about: T): T =>
    customTitle ? { ...about, title: customTitle } : about;

  // Serve the cached about from the DB; only touch YouTube when it's missing
  // or stale (and then in the background, so the page never waits on it).
  const cachedRow = db.prepare("SELECT about_json, about_fetched_at, subscriber_count FROM channels WHERE channel_id = ?")
    .get(channelId) as { about_json: string | null; about_fetched_at: string | null; subscriber_count: string | null } | null;

  if (cachedRow?.about_json) {
    if (ageMs(cachedRow.about_fetched_at) > ABOUT_DB_TTL) {
      refreshChannelAbout(channelId).catch((e) =>
        log.warn("channel.about.refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) }));
    }
    try {
      const cachedAbout = JSON.parse(cachedRow.about_json) as Partial<ChannelAbout>;
      if (!("subscriberCount" in cachedAbout)) {
        return c.json({ ...withCustomTitle(await refreshChannelAbout(channelId)), counts });
      }
      return c.json({ ...withCustomTitle(normalizeCachedChannelAbout(cachedAbout as ChannelAbout)), counts });
    } catch {
      // corrupted cache — fall through to a fresh fetch
    }
  }

  // No usable cache: fetch synchronously this once, then it's served from DB.
  try {
    return c.json({ ...withCustomTitle(await refreshChannelAbout(channelId)), counts });
  } catch (e) {
    // YouTube can rate-limit (429) or change layout — fall back to the basic
    // columns so the page still shows avatar/title/subs instead of breaking.
    const ch = db.prepare("SELECT title, thumbnail, subscriber_count FROM channels WHERE channel_id = ?")
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

async function refreshChannelPlaylists(channelId: string) {
  const playlists = await fetchChannelPlaylists(channelId);
  db.prepare("UPDATE channels SET playlists_json = ?, playlists_fetched_at = datetime('now') WHERE channel_id = ?")
    .run(JSON.stringify(playlists), channelId);
  return playlists;
}

api.get("/channels/:id/playlists", async (c) => {
  const channelId = c.req.param("id");
  const cached = db.prepare("SELECT playlists_json, playlists_fetched_at FROM channels WHERE channel_id = ?")
    .get(channelId) as { playlists_json: string | null; playlists_fetched_at: string | null } | null;

  if (cached?.playlists_json) {
    try {
      const playlists = JSON.parse(cached.playlists_json);
      // Pre-pagination cache entries commonly contain exactly YouTube's first
      // page of 30 cards. Upgrade them synchronously so this request already
      // shows the missing playlists instead of waiting up to three days.
      if (Array.isArray(playlists) && playlists.length === 30) {
        return c.json({ playlists: await refreshChannelPlaylists(channelId) });
      }
    } catch { /* corrupted cache — fall through to a fresh fetch */ }
    if (ageMs(cached.playlists_fetched_at) > PLAYLISTS_DB_TTL) {
      refreshChannelPlaylists(channelId).catch((e) =>
        log.warn("channel.playlists.refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) }));
    }
    try {
      return c.json({ playlists: JSON.parse(cached.playlists_json) });
    } catch { /* corrupted cache — fall through */ }
  }

  try {
    return c.json({ playlists: await refreshChannelPlaylists(channelId) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.put("/channels/:id/follow", async (c) => {
  const uid = currentUserId(c);
  const { followed } = await c.req.json<{ followed: boolean }>();
  const channelId = c.req.param("id");
  const existing = db.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId);

  // A channel reached through YouTube search may not have any local videos yet,
  // so it has no `channels` row. Create that parent row before writing the
  // profile subscription relation; otherwise SQLite correctly rejects the FK.
  if (followed && !existing) {
    try {
      const info = await resolveChannelId(channelId);
      if (info.channelId !== channelId) return c.json({ error: "channel id mismatch" }, 400);
      db.prepare(
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
  db.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = excluded.followed`
  ).run(uid, channelId, followed ? 1 : 0);
  if (followed) db.prepare("UPDATE channels SET external = 0 WHERE channel_id = ?").run(channelId);
  return c.json({ ok: true });
});

// Per-channel playback speed override for the active profile. Empty/"default"
// clears it (stored as NULL) so the video falls back to the global player_speed.
api.put("/channels/:id/speed", async (c) => {
  const uid = currentUserId(c);
  const { speed } = await c.req.json<{ speed: string | null }>();
  const value = !speed || speed === "default" ? null : speed;
  db.prepare(
    `INSERT INTO user_channels (user_id, channel_id, playback_speed) VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET playback_speed = excluded.playback_speed`
  ).run(uid, c.req.param("id"), value);
  return c.json({ ok: true });
});

// Literal paths before parameterised /channels/:id to avoid shadowing
api.get("/channels/unfollowed", (c) => {
  const uid = currentUserId(c);
  const channels = db.prepare(
    `SELECT ch.* FROM channels ch
     JOIN user_channels uc ON uc.channel_id = ch.channel_id AND uc.user_id = ? AND uc.followed = 0
     WHERE ch.external = 0 ORDER BY COALESCE(ch.custom_title, ch.title) COLLATE NOCASE`
  ).all(uid) as any[];
  return c.json({ channels: channels.map(serializeChannel) });
});

api.get("/channels/top", (c) => {
  const uid = currentUserId(c);
  const rows = db.prepare(`
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

api.get("/channels/recent", (c) => {
  const uid = currentUserId(c);
  const shortsFilter = getUserSetting(uid, "show_shorts") === "1"
    ? ""
    : "AND COALESCE(is_short, 0) = 0";
  const rows = db.prepare(`
    SELECT c.channel_id, COALESCE(c.custom_title, c.title) AS title, c.thumbnail,
           (SELECT thumbnail FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY published_at DESC LIMIT 1) AS latest_thumbnail,
           (SELECT video_id FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY published_at DESC LIMIT 1) AS latest_video_id
    FROM channels c
    JOIN user_channels uc ON uc.channel_id = c.channel_id AND uc.user_id = ? AND uc.followed = 1
    ORDER BY COALESCE(
      (SELECT published_at FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY published_at DESC LIMIT 1),
      '1970-01-01'
    ) DESC
    LIMIT 20
  `).all(uid) as any[];
  return c.json({ channels: attachWatchedState(uid, rows, (row) => row.latest_video_id) });
});

api.get("/channels/:id", (c) => {
  const uid = currentUserId(c);
  const ch = db.prepare("SELECT * FROM channels WHERE channel_id = ?").get(c.req.param("id")) as any;
  if (!ch) return c.json({ error: "not found" }, 404);
  const tags = db
    .prepare(
      `SELECT t.id, t.name, t.color FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ? WHERE ct.channel_id = ?`
    )
    .all(uid, c.req.param("id")) as any[];
  // followed reflects the active profile (null row = not subscribed).
  const sub = db.prepare("SELECT followed, playback_speed FROM user_channels WHERE user_id = ? AND channel_id = ?").get(uid, c.req.param("id")) as { followed: number; playback_speed: string | null } | null;
  return c.json({ channel: { ...serializeChannel(ch), followed: sub ? sub.followed : 0, playback_speed: sub?.playback_speed ?? null, tags } });
});

api.post("/channels/:id/sync", async (c) => {
  const channelId = c.req.param("id");
  try {
    const result = await syncChannel(channelId);
    log.info("channel.sync_requested", { channelId, added: result.added });
    return c.json({ ok: true, added: result.added });
  } catch (e) {
    log.error("channel.sync_failed", { channelId, error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ---------- user playlists ----------

// True when the playlist belongs to the active profile.
function ownsPlaylist(uid: number, id: number | string) {
  return Boolean(db.prepare("SELECT 1 FROM user_playlists WHERE id = ? AND user_id = ?").get(id, uid));
}

api.get("/playlists", (c) => {
  const uid = currentUserId(c);
  const videoId = c.req.query("video_id");
  const rows = db
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
  const nextOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM user_playlists WHERE user_id = ?").get(uid) as { sort_order: number };
  const row = db
    .prepare("INSERT INTO user_playlists (name, icon, sort_order, user_id) VALUES (?, ?, ?, ?) RETURNING id, name, icon, sort_order, created_at")
    .get(name.trim(), String(icon || "ListMusic").trim() || "ListMusic", nextOrder.sort_order, uid);
  return c.json({ playlist: row });
});

api.put("/playlists/:id", async (c) => {
  const uid = currentUserId(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const current = db.prepare("SELECT * FROM user_playlists WHERE id = ? AND user_id = ?").get(id, uid) as any;
  if (!current) return c.json({ error: "not found" }, 404);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
  const icon = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : current.icon;
  const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : current.sort_order;
  const row = db
    .prepare("UPDATE user_playlists SET name = ?, icon = ?, sort_order = ? WHERE id = ? RETURNING id, name, icon, sort_order, created_at")
    .get(name, icon, sortOrder, id);
  return c.json({ playlist: row });
});

api.delete("/playlists/:id", (c) => {
  const uid = currentUserId(c);
  db.prepare("DELETE FROM user_playlists WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

api.get("/playlists/:id", (c) => {
  const uid = currentUserId(c);
  const id = Number(c.req.param("id"));
  const playlist = db
    .prepare(
      `SELECT p.id, p.name, p.icon, p.sort_order, p.created_at, COUNT(pv.video_id) AS video_count
       FROM user_playlists p
       LEFT JOIN user_playlist_videos pv ON pv.playlist_id = p.id
       WHERE p.id = ? AND p.user_id = ?
       GROUP BY p.id`
    )
    .get(id, uid) as any;
  if (!playlist) return c.json({ error: "not found" }, 404);
  const rows = db
    .prepare(
      `${videoSelect(uid)}
       JOIN user_playlist_videos upv ON upv.video_id = v.video_id
       WHERE upv.playlist_id = ?
       ORDER BY upv.added_at DESC`
    )
    .all(id) as VideoRow[];
  return c.json({ playlist, videos: attachTags(uid, rows) });
});

api.post("/playlists/:id/videos", async (c) => {
  const uid = currentUserId(c);
  const { video_id } = await c.req.json();
  if (!video_id) return c.json({ error: "video_id required" }, 400);
  if (!ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  db.prepare("INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id) VALUES (?, ?)").run(c.req.param("id"), video_id);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/playlists/:id/videos/:videoId", (c) => {
  const uid = currentUserId(c);
  if (!ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  db.prepare("DELETE FROM user_playlist_videos WHERE playlist_id = ? AND video_id = ?").run(
    c.req.param("id"),
    c.req.param("videoId")
  );
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.get("/playlists/:id/rules", (c) => {
  const uid = currentUserId(c);
  if (!ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  const rules = db.prepare("SELECT * FROM user_playlist_rules WHERE playlist_id = ? ORDER BY id").all(c.req.param("id"));
  return c.json({ rules });
});

api.post("/playlists/:id/rules", async (c) => {
  const uid = currentUserId(c);
  const { pattern, match_type = "contains", field = "title" } = await c.req.json();
  if (!pattern?.trim()) return c.json({ error: "pattern required" }, 400);
  if (!["contains", "regex"].includes(match_type)) return c.json({ error: "invalid match_type" }, 400);
  if (!["title", "description", "both"].includes(field)) return c.json({ error: "invalid field" }, 400);
  if (!ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  const row = db
    .prepare("INSERT INTO user_playlist_rules (playlist_id, pattern, match_type, field) VALUES (?, ?, ?, ?) RETURNING *")
    .get(c.req.param("id"), pattern.trim(), match_type, field) as any;
  const matched = applyPlaylistRuleToAllVideos(row.id);
  return c.json({ rule: row, matched });
});

api.delete("/playlists/:id/rules/:ruleId", (c) => {
  const uid = currentUserId(c);
  if (!ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  db.prepare("DELETE FROM user_playlist_rules WHERE playlist_id = ? AND id = ?").run(c.req.param("id"), c.req.param("ruleId"));
  return c.json({ ok: true });
});

api.post("/playlists/:id/rules/apply", (c) => {
  const uid = currentUserId(c);
  if (!ownsPlaylist(uid, c.req.param("id"))) return c.json({ error: "not found" }, 404);
  const matched = applyPlaylistRulesForPlaylist(Number(c.req.param("id")));
  return c.json({ ok: true, matched });
});

api.get("/playlists/:id/videos", async (c) => {
  try {
    const id = c.req.param("id");
    // Import all playlist videos into the owning channel (deduped) on load,
    // then return them for the player. Both calls share a cached feed fetch.
    const videos = await fetchPlaylistVideos(id);
    importPlaylistVideos(id).catch((e) => log.error("playlist.import.failed", { playlistId: id, error: e instanceof Error ? e.message : String(e) }));
    return c.json({ videos: attachWatchedState(currentUserId(c), videos, (video) => video.videoId) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.post("/channels/import", async (c) => {
  const uid = currentUserId(c);
  if (isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
  const content = await file.text();
  const entries = content.trimStart().startsWith("<")
    ? parseOpml(content)
    : parseTakeoutCsv(content);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO channels (channel_id, title, url) VALUES (?, ?, ?)"
  );
  const subscribe = db.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1`
  );
  let added = 0;
  for (const e of entries) {
    const r = insert.run(e.channelId, e.title, `https://www.youtube.com/channel/${e.channelId}`);
    subscribe.run(uid, e.channelId);
    if (r.changes > 0) added++;
  }
  log.info("channels.imported", { fileName: file.name, found: entries.length, added });
  refreshAll().catch((e) => log.error("channels.import_refresh_failed", { error: e instanceof Error ? e.message : String(e) }));
  return c.json({ ok: true, found: entries.length, added });
});

// ---------- tags ----------

api.get("/tags", (c) => {
  const uid = currentUserId(c);
  const tags = db
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
  const r = db
    .prepare("INSERT INTO tags (name, color, user_id) VALUES (?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET color = excluded.color RETURNING *")
    .get(name.trim(), color ?? "#7c5cff", uid);
  return c.json({ tag: r });
});

api.patch("/tags/:id", async (c) => {
  const uid = currentUserId(c);
  const { name, color, filter_only } = await c.req.json();
  const id = c.req.param("id");
  if (!db.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(id, uid)) return c.json({ error: "not found" }, 404);
  if (name !== undefined) db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name.trim(), id);
  if (color !== undefined) db.prepare("UPDATE tags SET color = ? WHERE id = ?").run(color, id);
  if (filter_only !== undefined) db.prepare("UPDATE tags SET filter_only = ? WHERE id = ?").run(filter_only ? 1 : 0, id);
  const tag = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  return c.json({ tag });
});

api.delete("/tags/:id", (c) => {
  const uid = currentUserId(c);
  db.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

// ---------- auto-tag rules ----------

api.get("/rules", (c) => {
  const uid = currentUserId(c);
  const rules = db
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
  if (!db.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) return c.json({ error: "tag not found" }, 404);
  const r = db
    .prepare("INSERT INTO auto_tag_rules (tag_id, pattern, match_type, field, user_id) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(tag_id, pattern.trim(), match_type, field, uid) as any;
  const matched = applyRuleToAllVideos(r.id);
  return c.json({ rule: r, matched });
});

api.patch("/rules/:id", async (c) => {
  const uid = currentUserId(c);
  const { tag_id, pattern, match_type, field } = await c.req.json();
  const id = c.req.param("id");
  if (!db.prepare("SELECT 1 FROM auto_tag_rules WHERE id = ? AND user_id = ?").get(id, uid)) return c.json({ error: "not found" }, 404);
  if (tag_id !== undefined) {
    if (!db.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) return c.json({ error: "tag not found" }, 404);
    db.prepare("UPDATE auto_tag_rules SET tag_id = ? WHERE id = ?").run(tag_id, id);
  }
  if (pattern !== undefined) db.prepare("UPDATE auto_tag_rules SET pattern = ? WHERE id = ?").run(pattern.trim(), id);
  if (match_type !== undefined) db.prepare("UPDATE auto_tag_rules SET match_type = ? WHERE id = ?").run(match_type, id);
  if (field !== undefined) db.prepare("UPDATE auto_tag_rules SET field = ? WHERE id = ?").run(field, id);
  const rule = db.prepare("SELECT r.*, t.name AS tag_name, t.color AS tag_color FROM auto_tag_rules r JOIN tags t ON t.id = r.tag_id WHERE r.id = ?").get(id);
  return c.json({ rule });
});

api.delete("/rules/:id", (c) => {
  const uid = currentUserId(c);
  db.prepare("DELETE FROM auto_tag_rules WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

// ---------- filter rules ----------

api.get("/filter-rules", (c) => {
  const uid = currentUserId(c);
  const rules = db.prepare(
    `SELECT fr.*, COALESCE(c.custom_title, c.title) AS channel_title FROM filter_rules fr
     LEFT JOIN channels c ON c.channel_id = fr.channel_id WHERE fr.user_id = ? ORDER BY fr.id`
  ).all(uid);
  return c.json({ rules });
});

api.post("/filter-rules", async (c) => {
  const uid = currentUserId(c);
  const { pattern, match_type = "contains", field = "title", action = "reject", channel_id = null } = await c.req.json();
  if (!pattern?.trim()) return c.json({ error: "pattern required" }, 400);
  const row = db
    .prepare("INSERT INTO filter_rules (pattern, match_type, field, action, channel_id, user_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .get(pattern.trim(), match_type, field, action, channel_id || null, uid) as any;
  const archived = applyFilterRuleToAll(row.id);
  return c.json({ rule: row, archived });
});

api.patch("/filter-rules/:id", async (c) => {
  const uid = currentUserId(c);
  const { pattern, match_type, field, action, channel_id } = await c.req.json();
  const id = c.req.param("id");
  if (!db.prepare("SELECT 1 FROM filter_rules WHERE id = ? AND user_id = ?").get(id, uid)) return c.json({ error: "not found" }, 404);
  if (pattern !== undefined) db.prepare("UPDATE filter_rules SET pattern = ? WHERE id = ?").run(pattern.trim(), id);
  if (match_type !== undefined) db.prepare("UPDATE filter_rules SET match_type = ? WHERE id = ?").run(match_type, id);
  if (field !== undefined) db.prepare("UPDATE filter_rules SET field = ? WHERE id = ?").run(field, id);
  if (action !== undefined) db.prepare("UPDATE filter_rules SET action = ? WHERE id = ?").run(action, id);
  if (channel_id !== undefined) db.prepare("UPDATE filter_rules SET channel_id = ? WHERE id = ?").run(channel_id || null, id);
  const rule = db.prepare("SELECT fr.*, COALESCE(c.custom_title, c.title) AS channel_title FROM filter_rules fr LEFT JOIN channels c ON c.channel_id = fr.channel_id WHERE fr.id = ?").get(id);
  return c.json({ rule });
});

api.delete("/filter-rules/:id", (c) => {
  const uid = currentUserId(c);
  db.prepare("DELETE FROM filter_rules WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

// ---------- image cache / proxy ----------

api.get("/img", async (c) => {
  const url = c.req.query("u");
  if (!url) return c.json({ error: "u required" }, 400);
  const img = await getCachedImage(url);
  // Nothing cached and origin failed: redirect so the browser can try directly.
  if (!img) return c.redirect(url, 302);
  return new Response(Bun.file(img.path), {
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// ---------- settings ----------

api.get("/child-lock", (c) => {
  return c.json({ child_lock: childLockStatus(c) });
});

api.post("/child-lock/enable", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (isChildLockEnabled()) return c.json({ error: "child lock already enabled" }, 409);
  const body = await c.req.json().catch(() => ({}));
  if (!isSixDigitPin(body.pin)) return c.json({ error: "PIN must have 6 digits" }, 400);
  setSetting("child_lock_pin_hash", await hashChildLockPin(body.pin));
  setSetting("child_lock_enabled", "1");
  setChildLockSession(c);
  return c.json({ child_lock: { enabled: true, locked: false } });
});

api.post("/child-lock/unlock", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!isChildLockEnabled()) return c.json({ child_lock: childLockStatus(c) });
  if (!isSixDigitPin(body.pin) || !(await verifyChildLockPin(body.pin))) {
    return c.json({ error: "invalid PIN" }, 401);
  }
  setChildLockSession(c);
  return c.json({ child_lock: { enabled: true, locked: false } });
});

api.post("/child-lock/lock", (c) => {
  clearChildLockSession(c);
  return c.json({ child_lock: childLockStatus(c) });
});

api.post("/child-lock/change-pin", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (!isChildLockEnabled()) return c.json({ error: "child lock is disabled" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const canChange = hasChildLockSession(c) || (isSixDigitPin(body.current_pin) && (await verifyChildLockPin(body.current_pin)));
  if (!canChange) return c.json({ error: "invalid PIN" }, 401);
  if (!isSixDigitPin(body.new_pin)) return c.json({ error: "PIN must have 6 digits" }, 400);
  setSetting("child_lock_pin_hash", await hashChildLockPin(body.new_pin));
  setChildLockSession(c);
  return c.json({ child_lock: { enabled: true, locked: false } });
});

api.post("/child-lock/disable", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (!isChildLockEnabled()) return c.json({ child_lock: childLockStatus(c) });
  const body = await c.req.json().catch(() => ({}));
  const canDisable = hasChildLockSession(c) || (isSixDigitPin(body.pin) && (await verifyChildLockPin(body.pin)));
  if (!canDisable) return c.json({ error: "invalid PIN" }, 401);
  setSetting("child_lock_enabled", "0");
  setSetting("child_lock_pin_hash", "");
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
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (key === "child_lock_pin_hash" || key === "child_lock_enabled") continue;
    if (!(key in body)) continue;
    if (GLOBAL_SETTING_KEYS.has(key)) {
      // Only the primary profile owns app-wide settings (app name, icon color).
      if (primary) setSetting(key, String(body[key]));
    } else {
      setUserSetting(uid, key, String(body[key]));
    }
  }
  return c.json({ ok: true });
});

// ---------- profiles (multi-user) ----------

const AVATAR_DIR = process.env.AVATAR_DIR ?? resolve(import.meta.dir, "../../data/avatars");
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
  is_child: number;
}

function serializeProfile(u: UserRow, activeId: number) {
  const method = authMethod();
  const status = u.is_child === 1 ? childStatus(u.id) : null;
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar ? `/api/profiles/${u.id}/avatar?v=${encodeURIComponent(u.avatar)}` : "",
    avatar_color: u.avatar_color,
    // PINs only apply to the 'none' method; any other auth method replaces them.
    has_pin: method === "none" ? Boolean(u.pin_hash) : false,
    active: u.id === activeId,
    is_primary: u.id === primaryUserId(),
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
  };
}

api.get("/profiles", (c) => {
  const activeId = currentUserId(c);
  const rows = db.prepare("SELECT * FROM users ORDER BY sort_order ASC, id ASC").all() as UserRow[];
  return c.json({ profiles: rows.map((u) => serializeProfile(u, activeId)), active_id: activeId });
});

api.post("/profiles", async (c) => {
  const { name, avatar_color, pin } = await c.req.json().catch(() => ({}));
  if (!name?.trim()) return c.json({ error: "name required" }, 400);
  if (pin !== undefined && pin !== null && pin !== "" && !isSixDigitPin(pin)) {
    return c.json({ error: "PIN must have 6 digits" }, 400);
  }
  const nextOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM users").get() as { n: number }).n;
  const pinHash = isSixDigitPin(pin) ? await hashPin(pin) : null;
  const row = db
    .prepare("INSERT INTO users (name, avatar_color, pin_hash, sort_order) VALUES (?, ?, ?, ?) RETURNING *")
    .get(name.trim(), avatar_color || "#7c5cff", pinHash, nextOrder) as UserRow;
  log.info("profile.created", { id: row.id, name: row.name });
  return c.json({ profile: serializeProfile(row, currentUserId(c)) });
});

api.patch("/profiles/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!current) return c.json({ error: "not found" }, 404);
  // Only the owner or the primary profile may edit a profile at all.
  if (!canManageProfile(c, id)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return c.json({ error: "name required" }, 400);
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(String(body.name).trim(), id);
  }
  if (body.avatar_color !== undefined) {
    db.prepare("UPDATE users SET avatar_color = ? WHERE id = ?").run(String(body.avatar_color), id);
  }
  // is_child: admin-only, so a child profile can never unmark itself. The
  // primary profile is the household admin and cannot be a child profile.
  if (body.is_child !== undefined) {
    if (!isAdmin(c)) return c.json({ error: "only the primary profile can change this" }, 403);
    if (id === primaryUserId()) return c.json({ error: "the primary profile cannot be a child profile" }, 400);
    db.prepare("UPDATE users SET is_child = ? WHERE id = ?").run(body.is_child ? 1 : 0, id);
    // Restricted content is the safe default for a fresh child profile.
    if (body.is_child && getUserSetting(id, "child_local_only") == null) {
      setUserSetting(id, "child_local_only", "1");
    }
    log.info("profile.child_flag", { id, is_child: Boolean(body.is_child) });
  }
  // Child time limit & restrictions: admin-only, stored in the child's settings.
  if (body.child_config !== undefined) {
    if (!isAdmin(c)) return c.json({ error: "only the primary profile can change this" }, 403);
    const cc = body.child_config ?? {};
    if (cc.limit_minutes !== undefined) {
      const minutes = Math.max(0, Math.min(24 * 60, parseInt(cc.limit_minutes, 10) || 0));
      setUserSetting(id, "child_limit_minutes", String(minutes));
    }
    if (cc.local_only !== undefined) setUserSetting(id, "child_local_only", cc.local_only ? "1" : "0");
    if (cc.hide_shorts !== undefined) setUserSetting(id, "child_hide_shorts", cc.hide_shorts ? "1" : "0");
    if (cc.hide_live !== undefined) setUserSetting(id, "child_hide_live", cc.hide_live ? "1" : "0");
    if (cc.downloads_only !== undefined) setUserSetting(id, "child_downloads_only", cc.downloads_only ? "1" : "0");
  }
  // pin: "" / null clears it, a 6-digit string sets it. PIN is owner-only — not
  // even the primary profile can change or remove someone else's PIN. (Child
  // boundaries are gated by the app-wide child lock PIN, not this one.)
  if (body.pin !== undefined) {
    if (currentUserId(c) !== id) return c.json({ error: "only the profile owner can change its PIN" }, 403);
    if (body.pin === "" || body.pin === null) {
      db.prepare("UPDATE users SET pin_hash = NULL WHERE id = ?").run(id);
    } else if (isSixDigitPin(body.pin)) {
      db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(await hashPin(body.pin), id);
    } else {
      return c.json({ error: "PIN must have 6 digits" }, 400);
    }
  }
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  return c.json({ profile: serializeProfile(row, currentUserId(c)) });
});

api.delete("/profiles/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (id === primaryUserId()) return c.json({ error: "cannot delete the primary profile" }, 400);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count <= 1) return c.json({ error: "cannot delete the last profile" }, 400);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!user) return c.json({ error: "not found" }, 404);
  // A profile is deleted only by its owner (while logged into it) — not even the
  // primary profile can delete someone else's.
  if (currentUserId(c) !== id) return c.json({ error: "switch to this profile first" }, 403);
  // If it has a PIN, the owner must re-enter it to confirm deletion.
  if (user.pin_hash) {
    const { pin } = await c.req.json().catch(() => ({}));
    if (!isSixDigitPin(pin) || !(await Bun.password.verify(pin, user.pin_hash))) {
      return c.json({ error: "invalid PIN" }, 401);
    }
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades to all per-user state
  log.info("profile.deleted", { id });
  // The active profile just deleted itself → fall back to the first remaining one.
  const next = firstUserId.get() as { id: number };
  c.header("Set-Cookie", profileCookie(next.id));
  return c.json({ ok: true, active_id: next.id });
});

api.post("/profiles/:id/avatar", async (c) => {
  const id = Number(c.req.param("id"));
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) return c.json({ error: "not found" }, 404);
  if (!canManageProfile(c, id)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
  if (file.size > 5 * 1024 * 1024) return c.json({ error: "file too large" }, 400);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const fileName = `${id}.${ext}`;
  await Bun.write(resolve(AVATAR_DIR, fileName), file);
  // Store filename+mtime token so the client URL busts cache on change.
  db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(`${fileName}:${Date.now()}`, id);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  return c.json({ profile: serializeProfile(row, currentUserId(c)) });
});

// Primary-only: clear another profile's PIN (e.g. it was forgotten). The owner
// then sets a new one themselves — the primary never sets or learns the PIN.
api.post("/profiles/:id/reset-pin", (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can reset PINs" }, 403);
  const id = Number(c.req.param("id"));
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!row) return c.json({ error: "not found" }, 404);
  db.prepare("UPDATE users SET pin_hash = NULL WHERE id = ?").run(id);
  log.info("profile.pin_reset", { id, by: currentUserId(c) });
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  return c.json({ profile: serializeProfile(updated, currentUserId(c)) });
});

api.delete("/profiles/:id/avatar", (c) => {
  const id = Number(c.req.param("id"));
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  if (!row) return c.json({ error: "not found" }, 404);
  if (!canManageProfile(c, id)) return c.json({ error: "not allowed" }, 403);
  db.prepare("UPDATE users SET avatar = '' WHERE id = ?").run(id);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  return c.json({ profile: serializeProfile(updated, currentUserId(c)) });
});

api.get("/profiles/:id/avatar", (c) => {
  const id = Number(c.req.param("id"));
  const row = db.prepare("SELECT avatar FROM users WHERE id = ?").get(id) as { avatar: string } | null;
  if (!row?.avatar) return c.json({ error: "not found" }, 404);
  const fileName = row.avatar.split(":")[0];
  const file = Bun.file(resolve(AVATAR_DIR, fileName));
  return c.body(file.stream(), 200, { "Content-Type": file.type || "image/jpeg", "Cache-Control": "max-age=31536000" });
});

api.post("/profiles/switch", async (c) => {
  // Methods that pin a session to one profile can't switch internally — the UI
  // must log out (and possibly redirect to the IdP/proxy logout).
  if (!canSwitchProfiles()) {
    return c.json({ requires_relogin: true, logout_url: methodLogoutUrl() });
  }
  const { id, pin, child_lock_pin } = await c.req.json().catch(() => ({}));
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(id)) as UserRow | null;
  if (!user) return c.json({ error: "not found" }, 404);
  // Leaving a child profile always requires the app-wide child lock PIN (the
  // profile's own PIN only gates entering it, like on any other profile).
  // Three wrong attempts lock the child profile.
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(currentUserId(c)) as UserRow | null;
  if (current && current.id !== user.id && current.is_child === 1 && isChildLockEnabled()) {
    if (!isSixDigitPin(child_lock_pin) || !(await verifyChildLockPin(child_lock_pin))) {
      registerChildLockFailure(current.id);
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
api.get("/auth/status", (c) => {
  const method = authMethod();
  if (method === "none") return c.json({ method, authenticated: true, can_switch: true, is_admin: isAdmin(c) });

  if (method === "proxy_header") {
    const uid = resolveProxyUser(c);
    return c.json({
      method,
      authenticated: Boolean(uid),
      can_switch: false,
      is_admin: isAdmin(c),
      proxy_header_seen: Boolean(proxyHeaderValue(c)),
    });
  }

  const session = validateSession(parseCookies(c.req.header("cookie"))[AUTH_SESSION_COOKIE]);
  const perProfilePasskeys =
    (db.prepare("SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id IS NOT NULL").get() as { n: number }).n > 0;
  return c.json({
    method,
    authenticated: Boolean(session),
    scope: session?.scope ?? null,
    can_switch: canSwitchProfiles(),
    is_admin: isAdmin(c),
    oidc_mode: method === "oidc" ? getSetting("auth_oidc_mode") || "mapped" : undefined,
    // per_profile always needs a username; shared only when one was configured.
    username_field: method === "per_profile" || (method === "shared" && Boolean(getSetting("auth_shared_username"))),
    login: {
      password:
        method === "shared" ? Boolean(getSetting("auth_shared_password_hash")) : method === "per_profile",
      passkey: method === "shared" ? hasPasskeys(null) : method === "per_profile" ? perProfilePasskeys : false,
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
    c.header("Set-Cookie", authSessionCookie(createSession(null, "account")));
    log.info("auth.login", { method, scope: "account" });
    return c.json({ ok: true });
  }
  if (method === "per_profile") {
    const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username ?? "")) as UserRow | null;
    if (!row?.password_hash || !(await verifyPassword(String(password ?? ""), row.password_hash))) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    c.header("Set-Cookie", authSessionCookie(createSession(row.id, "profile")));
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
  c.header("Set-Cookie", authSessionCookie(createSession(user_id, scope)));
  if (user_id !== null) c.header("Set-Cookie", profileCookie(user_id), { append: true });
  log.info("auth.login", { method: authMethod(), scope, id: user_id });
  return c.json({ ok: true, active_id: user_id ?? undefined });
});

// Register a passkey. target='shared' (primary only) or 'self' (current profile).
api.post("/auth/passkey/register/options", async (c) => {
  const { target } = await c.req.json().catch(() => ({}));
  if (target === "shared") {
    if (!isAdmin(c)) return c.json({ error: "primary only" }, 403);
    const { options, flowId } = await passkeyRegisterOptions(c, null, getSetting("auth_shared_username") || "shared");
    return c.json({ options, flowId });
  }
  const uid = currentUserId(c);
  if (!uid) return c.json({ error: "unauthenticated" }, 401);
  const user = db.prepare("SELECT name FROM users WHERE id = ?").get(uid) as { name: string };
  const { options, flowId } = await passkeyRegisterOptions(c, uid, user.name);
  return c.json({ options, flowId });
});

api.post("/auth/passkey/register/verify", async (c) => {
  const { flowId, response, label } = await c.req.json().catch(() => ({}));
  await passkeyRegisterVerify(c, flowId, response, label);
  return c.json({ ok: true });
});

api.delete("/auth/passkey/:id", (c) => {
  const id = Number(c.req.param("id"));
  // Shared credentials (user_id NULL) are primary-managed; others belong to the owner.
  const cred = db.prepare("SELECT user_id FROM webauthn_credentials WHERE id = ?").get(id) as { user_id: number | null } | null;
  if (!cred) return c.json({ error: "not found" }, 404);
  if (cred.user_id === null) {
    if (!isAdmin(c)) return c.json({ error: "primary only" }, 403);
  } else if (cred.user_id !== currentUserId(c)) {
    return c.json({ error: "not allowed" }, 403);
  }
  deletePasskey(id, cred.user_id);
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
    c.header("Set-Cookie", authSessionCookie(createSession(scope === "account" ? null : user_id, scope, is_admin)));
    if (user_id !== null) c.header("Set-Cookie", profileCookie(user_id), { append: true });
    c.header("Set-Cookie", `${OIDC_FLOW_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`, { append: true });
    log.info("auth.login", { method: "oidc", scope, id: user_id, admin: is_admin });
    return c.redirect("/");
  } catch (e: any) {
    log.error("auth.oidc.callback_failed", oidcErrorDetail(e));
    return c.redirect("/?auth_error=oidc");
  }
});

api.post("/auth/logout", (c) => {
  destroySession(parseCookies(c.req.header("cookie"))[AUTH_SESSION_COOKIE]);
  c.header("Set-Cookie", clearAuthSessionCookie());
  return c.json({ ok: true, logout_url: methodLogoutUrl() });
});

// ---------- auth configuration (primary profile only) ----------

api.get("/auth/config", (c) => {
  if (!isAdmin(c)) return c.json({ error: "primary only" }, 403);
  const profiles = (db.prepare("SELECT * FROM users ORDER BY sort_order ASC, id ASC").all() as UserRow[]).map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username ?? "",
    has_password: Boolean(u.password_hash),
    has_passkey: hasPasskeys(u.id),
    oidc_subject: u.oidc_subject ?? "",
    proxy_match: u.proxy_match ?? "",
  }));
  return c.json({
    method: getSetting("auth_method") || "none",
    shared: {
      username: getSetting("auth_shared_username") || "",
      password_set: Boolean(getSetting("auth_shared_password_hash")),
      passkeys: listPasskeys(null),
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
  if (!isAdmin(c)) return c.json({ error: "primary only" }, 403);
  const body = await c.req.json().catch(() => ({}));

  if (body.shared) {
    if (body.shared.username !== undefined) setSetting("auth_shared_username", String(body.shared.username));
    if (body.shared.password) setSetting("auth_shared_password_hash", await hashPassword(String(body.shared.password)));
    else if (body.shared.password === "") setSetting("auth_shared_password_hash", "");
  }

  if (body.oidc) {
    const o = body.oidc;
    if (o.issuer !== undefined) setSetting("auth_oidc_issuer", String(o.issuer).trim());
    if (o.client_id !== undefined) setSetting("auth_oidc_client_id", String(o.client_id).trim());
    if (o.client_secret) setSetting("auth_oidc_client_secret", String(o.client_secret)); // keep existing if not provided
    if (o.scopes !== undefined) setSetting("auth_oidc_scopes", String(o.scopes));
    if (o.mode !== undefined) setSetting("auth_oidc_mode", o.mode === "gateway" ? "gateway" : "mapped");
    if (o.claim !== undefined) setSetting("auth_oidc_claim", String(o.claim));
    if (o.autocreate !== undefined) setSetting("auth_oidc_autocreate", o.autocreate ? "1" : "0");
    if (o.logout_url !== undefined) setSetting("auth_oidc_logout_url", String(o.logout_url).trim());
    if (o.groups_claim !== undefined) setSetting("auth_oidc_groups_claim", String(o.groups_claim).trim() || "groups");
    if (o.admin_group !== undefined) setSetting("auth_oidc_admin_group", String(o.admin_group).trim());
    invalidateOidcConfig();
  }

  if (body.proxy) {
    if (body.proxy.header !== undefined) setSetting("auth_proxy_header", String(body.proxy.header).trim() || "Remote-User");
    if (body.proxy.logout_url !== undefined) setSetting("auth_proxy_logout_url", String(body.proxy.logout_url).trim());
  }

  if (Array.isArray(body.profiles)) {
    for (const p of body.profiles) {
      const id = Number(p.id);
      if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) continue;
      if (p.username !== undefined) db.prepare("UPDATE users SET username = ? WHERE id = ?").run(String(p.username).trim() || null, id);
      if (p.password) db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(String(p.password)), id);
      else if (p.password === "") db.prepare("UPDATE users SET password_hash = NULL WHERE id = ?").run(id);
      if (p.oidc_subject !== undefined) db.prepare("UPDATE users SET oidc_subject = ? WHERE id = ?").run(String(p.oidc_subject).trim() || null, id);
      if (p.proxy_match !== undefined) db.prepare("UPDATE users SET proxy_match = ? WHERE id = ?").run(String(p.proxy_match).trim() || null, id);
    }
  }

  return c.json({ ok: true });
});

api.post("/auth/test-oidc", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "primary only" }, 403);
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
function validateMapping(method: string): { missing: string[]; duplicates: string[]; credMissing: string[] } | null {
  const field = mappingField(method);
  if (!field) return null;
  const rows = db.prepare("SELECT * FROM users ORDER BY sort_order ASC, id ASC").all() as UserRow[];
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
      ? rows.filter((u) => !u.password_hash && !hasPasskeys(u.id)).map((u) => u.name)
      : [];
  if (missing.length === 0 && dups.size === 0 && credMissing.length === 0) return null;
  return { missing, duplicates: [...dups], credMissing };
}

// Activate an auth method after validating its prerequisites (anti-lockout).
api.post("/auth/method", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const { method } = await c.req.json().catch(() => ({}));
  const valid = ["none", "shared", "per_profile", "oidc", "proxy_header"];
  if (!valid.includes(method)) return c.json({ error: "invalid method" }, 400);

  if (method === "shared" && !getSetting("auth_shared_password_hash") && !hasPasskeys(null)) {
    return c.json({ error: "set a shared password or passkey first" }, 400);
  }
  if (method === "oidc") {
    const probe = await testOidc();
    if (!probe.ok) return c.json({ error: `OIDC not reachable: ${probe.error}` }, 400);
  }
  // per_profile / oidc-mapped / proxy_header: require a complete, unique mapping.
  const m = validateMapping(method);
  if (m) {
    const parts: string[] = [];
    if (m.missing.length) parts.push(`missing for: ${m.missing.join(", ")}`);
    if (m.credMissing.length) parts.push(`no password for: ${m.credMissing.join(", ")}`);
    if (m.duplicates.length) parts.push(`duplicate values: ${m.duplicates.join(", ")}`);
    return c.json({ error: `incomplete profile mapping — ${parts.join("; ")}`, mapping: m }, 400);
  }

  setSetting("auth_method", method);
  log.info("auth.method_changed", { method });
  return c.json({ ok: true });
});

// ---------- config ----------

api.get("/config", (c) => {
  return c.json({ app_url: process.env.APP_URL ?? "" });
});

// ---------- refresh ----------

api.post("/refresh", async (c) => {
  const result = await refreshAll();
  log.info("refresh.manual_requested", { channels: result.channels, added: result.added, errors: result.errors.length });
  return c.json(result);
});

api.get("/logs", (c) => {
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 300)));
  return c.json({ ...readRecentLogs(limit), version: VERSION, commit: COMMIT });
});
