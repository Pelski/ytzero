import { Hono } from "hono";
import { database } from "./database";
import { getSetting } from "./db";
import {
  parseOpml,
  parseTakeoutCsv,
} from "./youtube";
import { getCachedImage } from "./imgcache";
import { isAllowedRemoteImageUrl } from "./imageCachePolicy";
import { refreshAll } from "./refresher";
import { log } from "./logger";
import { isChildUser } from "./childTime";
import { beginMutation, maintenanceStatus } from "./maintenance";
import { isProfilePermissionArea, parseAdminOnlyAreas, permissionAreaForMutation, permissionAreasForSettings, serializeAdminOnlyAreas, settingsMutationRequiresAdmin, type ProfilePermissionArea } from "./profilePermissions";
import {
  authMethod,
  AUTH_SESSION_COOKIE,
  validateSession,
  resolveProxyUser,
} from "./auth";
import { registerSystemRoutes } from "./routes/systemRoutes";
import { registerSocialRoutes } from "./routes/socialRoutes";
import { registerTagRoutes } from "./routes/tagRoutes";
import { registerPluginRoutes } from "./routes/pluginRoutes";
import { registerAuthRoutes } from "./routes/authRoutes";
import { registerProfileRoutes } from "./routes/profileRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
import { registerImportRoutes } from "./routes/importRoutes";
import { registerHistoryRoutes } from "./routes/historyRoutes";
import { registerUserPlaylistRoutes } from "./routes/userPlaylistRoutes";
import { registerBackupRoutes } from "./routes/backupRoutes";
import { registerFeedRoutes } from "./routes/feedRoutes";
import { registerLibraryRoutes } from "./routes/libraryRoutes";
import { registerChildRoutes } from "./routes/childRoutes";
import { registerInsightRoutes } from "./routes/insightRoutes";
import { profileDownloadsEnabled, registerDownloadRoutes } from "./routes/downloadRoutes";
import { registerChannelPlaylistRoutes } from "./routes/channelPlaylistRoutes";
import { playlistChannelSyncIsDisabled, registerChannelRoutes } from "./routes/channelRoutes";
import { registerVideoActionRoutes } from "./routes/videoActionRoutes";
import { registerVideoRoutes } from "./routes/videoRoutes";
import {
  attachTags as attachVideoTags,
  attachWatchedState,
  videoSelect,
  type VideoRow,
} from "./videoRoutesSupport";
export { importTakeoutHistory } from "./routes/importRoutes";

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

const attachTags = (userId: number, videos: VideoRow[]) => attachVideoTags(userId, videos, profileDownloadsEnabled);

registerBackupRoutes(api, { isAdmin, currentUserId });

registerFeedRoutes(api, { currentUserId, attachTags });

registerLibraryRoutes(api, { currentUserId, attachTags, attachWatchedState });

registerChildRoutes(api, { currentUserId, isAdmin, isChildLockEnabled, isSixDigitPin, verifyChildLockPin });

registerInsightRoutes(api, currentUserId);

registerPluginRoutes(api, { isAdmin, currentUserId });

registerSocialRoutes(api, { isAdmin, currentUserId });
registerDownloadRoutes(api, { currentUserId, isAdmin });

registerVideoRoutes(api, { currentUserId, isAdmin, attachTags });

registerVideoActionRoutes(api, currentUserId);

registerHistoryRoutes(api, { currentUserId, attachTags });

registerChannelRoutes(api, { currentUserId, isAdmin, hasChildLockSession, attachTags, attachWatchedState });

registerChannelPlaylistRoutes(api, { currentUserId, attachTags, playlistChannelSyncIsDisabled });

registerUserPlaylistRoutes(api, {
  currentUserId,
  videoSelect,
  attachTags,
  attachWatchedState,
  profileDownloadsEnabled,
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

registerImportRoutes(api, currentUserId);
registerTagRoutes(api, currentUserId);
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

registerSettingsRoutes(api, {
  adminOnlyAreas,
  childLockStatus,
  clearChildLockSession,
  currentUserId,
  hashChildLockPin,
  isAdmin,
  isChildLockEnabled,
  isSixDigitPin,
  setChildLockSession,
  verifyChildLockPin,
});

registerProfileRoutes(api, {
  canDelegateProfileAdmins,
  canManageProfile,
  canSwitchProfiles,
  currentUserId,
  hashPin,
  isAdmin,
  isChildLockEnabled,
  isPrimaryUser,
  isSixDigitPin,
  methodLogoutUrl,
  primaryUserId,
  profileCookie,
  verifyChildLockPin,
});

registerAuthRoutes(api, {
  canDelegateProfileAdmins,
  canSwitchProfiles,
  currentUserId,
  hideOtherProfilesInPicker,
  isAdmin,
  isPrimaryUser,
  methodLogoutUrl,
  parseCookies,
  profileCookie,
});

registerSystemRoutes(api, { isAdmin, currentUserId });
