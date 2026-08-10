import type { Context, Hono } from "hono";
import { publishAppEvent } from "../appEvents";
import { database } from "../database";
import { getSetting, getUserSetting, GLOBAL_SETTING_KEYS, SETTING_DEFAULTS, setSetting, setUserSetting } from "../db";
import { normalizeVideoCardSetting, validateVideoCardSettings } from "../videoCardActions";
import { isProfilePermissionArea, serializeAdminOnlyAreas, type ProfilePermissionArea } from "../profilePermissions";
import { computeShowFrom, SCHEDULE_BUCKETS } from "../scheduleTime";
import { configuredTimeZone, isValidTimeZone, timeZoneIsEnvironmentLocked } from "../timeZone";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

interface SettingsRouteAccess {
  adminOnlyAreas: () => ProfilePermissionArea[];
  childLockStatus: (context: ApiContext) => unknown;
  clearChildLockSession: (context: ApiContext) => void;
  currentUserId: (context: ApiContext) => number;
  hashChildLockPin: (pin: string) => Promise<string>;
  isAdmin: (context: ApiContext) => boolean;
  isChildLockEnabled: () => boolean;
  isSixDigitPin: (pin: unknown) => pin is string;
  setChildLockSession: (context: ApiContext) => void;
  verifyChildLockPin: (pin: string) => Promise<boolean>;
}

export function registerSettingsRoutes(api: Api, access: SettingsRouteAccess): void {
  const {
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
  } = access;

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
  settings.timezone = configuredTimeZone();
  return c.json({ settings, settings_meta: { timezone_locked: timeZoneIsEnvironmentLocked() } });
});

api.put("/settings", async (c) => {
  const uid = currentUserId(c);
  const primary = isAdmin(c);
  const body = await c.req.json();
  if ("timezone" in body && timeZoneIsEnvironmentLocked()) return c.json({ error: "timezone is controlled by the TZ environment variable" }, 409);
  if ("timezone" in body && !isValidTimeZone(body.timezone)) return c.json({ error: "invalid timezone" }, 400);
  const videoCardSettingsError = validateVideoCardSettings(body);
  if (videoCardSettingsError) return c.json({ error: videoCardSettingsError }, 400);
  if ("show_shorts" in body && body.show_shorts !== "0" && body.show_shorts !== "selected" && body.show_shorts !== "1") {
    return c.json({ error: "invalid Shorts feed mode" }, 400);
  }
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (key === "child_lock_pin_hash" || key === "child_lock_enabled") continue;
    if (!(key in body)) continue;
    if (GLOBAL_SETTING_KEYS.has(key)) {
      // Only an administrator owns app-wide settings (name, icon, timezone).
      if (primary) await setSetting(key, String(body[key]));
    } else {
      const value = normalizeVideoCardSetting(key, body[key]);
      await setUserSetting(uid, key, value);
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
}
