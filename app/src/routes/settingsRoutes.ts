import type { Context, Hono } from "hono";
import { publishAppEvent } from "../appEvents";
import { database } from "../database";
import { getSetting, getUserSetting, GLOBAL_SETTING_KEYS, SETTING_DEFAULTS, setSetting, setUserSetting } from "../db";
import { normalizeVideoCardSetting, validateVideoCardSettings } from "../videoCardActions";
import { PROFILE_PERMISSION_AREAS, isProfilePermissionArea, type ProfilePermissionArea } from "../profilePermissions";
import { accessControlSnapshot, effectivePermissions, groupMemberCount, updateGroupPermissions, updateProfileAccess } from "../accessControl";
import { computeShowFrom, SCHEDULE_BUCKETS } from "../scheduleTime";
import { configuredTimeZone, isValidTimeZone, timeZoneIsEnvironmentLocked } from "../timeZone";
import { normalizeKeyboardShortcutSetting } from "../keyboardShortcutSettings";
import { isLanguage } from "../../../shared/uiLanguages";
import { removeRoleFromExternalMappings } from "../externalRoleMappings";
import { normalizeYouTubeTitleLanguage } from "../youtubeRequestLanguage";
import { normalizePlaybackSpeed, normalizePlaybackSpeedOptionsSetting } from "../../../shared/playbackSpeeds";
import { isWatchCommentsSetting, normalizeWatchCommentsMode } from "../../../shared/watchComments";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>; type ApiContext = Context<ApiEnvironment>;

interface SettingsRouteAccess {
  childLockStatus: (context: ApiContext) => Promise<unknown>;
  clearChildLockSession: (context: ApiContext) => Promise<void>;
  currentUserId: (context: ApiContext) => number;
  externalPermissionGroupUuid: (context: ApiContext) => string | undefined;
  hashChildLockPin: (pin: string) => Promise<string>;
  isAdmin: (context: ApiContext) => boolean;
  isPrimaryUser: (context: ApiContext) => boolean;
  isChildLockEnabled: () => boolean;
  isSixDigitPin: (pin: unknown) => pin is string;
  setChildLockSession: (context: ApiContext) => Promise<void>;
  verifyChildLockPin: (pin: string) => Promise<boolean>;
}

export function registerSettingsRoutes(api: Api, access: SettingsRouteAccess): void {
  const {
    childLockStatus,
    clearChildLockSession,
    currentUserId,
    externalPermissionGroupUuid,
    hashChildLockPin,
    isAdmin,
    isPrimaryUser,
    isChildLockEnabled,
    isSixDigitPin,
    setChildLockSession,
    verifyChildLockPin,
  } = access;

// ---------- settings ----------

api.get("/child-lock", async (c) => {
  return c.json({ child_lock: await childLockStatus(c) });
});

api.get("/profile-permissions", async (c) => {
  return c.json({ permissions: await effectivePermissions(currentUserId(c), isAdmin(c), externalPermissionGroupUuid(c)) });
});

api.get("/access-control", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const snapshot = await accessControlSnapshot();
  const profiles = await database.prepare("SELECT id,name,avatar_color,is_child,is_admin FROM users ORDER BY sort_order,id").all() as Array<{ id: number; name: string; avatar_color: string; is_child: number; is_admin: number }>;
  return c.json({
    ...snapshot,
    permissions: PROFILE_PERMISSION_AREAS,
    profiles: await Promise.all(profiles.map(async (profile) => {
      const isPrimary = profile.id === currentUserId(c);
      const isAdministrator = isPrimary || profile.is_admin === 1;
      return {
        ...profile,
        is_primary: isPrimary,
        is_child: profile.is_child === 1,
        is_admin: isAdministrator,
        access: await effectivePermissions(profile.id, isAdministrator),
      };
    })),
  });
});

api.put("/access-control/groups/:id", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const groupId = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  if (!Number.isSafeInteger(groupId) || !Array.isArray(body.permissions) || body.permissions.some((permission: unknown) => !isProfilePermissionArea(permission))) return c.json({ error: "invalid permission group" }, 400);
  const exists = await database.prepare("SELECT id FROM permission_groups WHERE id=?").get(groupId);
  if (!exists) return c.json({ error: "not found" }, 404);
  await updateGroupPermissions(groupId, [...new Set(body.permissions as ProfilePermissionArea[])]);
  await database.prepare("UPDATE permission_policy SET revision=revision+1 WHERE singleton=1").run();
  return c.json(await accessControlSnapshot());
});

api.post("/access-control/groups", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || !Array.isArray(body.permissions) || body.permissions.some((permission: unknown) => !isProfilePermissionArea(permission))) return c.json({ error: "invalid permission group" }, 400);
  const nextOrder = Number((await database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM permission_groups").get() as { value: number }).value);
  const group = await database.prepare("INSERT INTO permission_groups(portable_uuid,name,is_system,sort_order) VALUES(?,?,0,?) RETURNING id").get(crypto.randomUUID(), name, nextOrder) as { id: number };
  await updateGroupPermissions(group.id, [...new Set(body.permissions as ProfilePermissionArea[])]);
  await database.prepare("UPDATE permission_policy SET revision=revision+1 WHERE singleton=1").run();
  return c.json(await accessControlSnapshot(), 201);
});

api.put("/access-control/group-order", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const groupIds: number[] = Array.isArray(body.group_ids) ? body.group_ids.map((id: unknown) => Number(id)) : [];
  const existing = await database.prepare("SELECT id FROM permission_groups").all() as Array<{ id: number }>;
  const expected = new Set(existing.map((group) => group.id));
  if (groupIds.length !== expected.size || new Set(groupIds).size !== groupIds.length || groupIds.some((id) => !Number.isSafeInteger(id) || !expected.has(id))) {
    return c.json({ error: "invalid permission group order" }, 400);
  }
  for (const [sortOrder, groupId] of groupIds.entries()) {
    await database.prepare("UPDATE permission_groups SET sort_order=? WHERE id=?").run(sortOrder, groupId);
  }
  await database.prepare("UPDATE permission_policy SET revision=revision+1 WHERE singleton=1").run();
  return c.json(await accessControlSnapshot());
});

api.put("/access-control/default-group", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const groupId = Number(body.group_id);
  if (!Number.isSafeInteger(groupId) || !await database.prepare("SELECT id FROM permission_groups WHERE id=?").get(groupId)) return c.json({ error: "invalid group" }, 400);
  await database.prepare("UPDATE permission_policy SET default_group_id=?,revision=revision+1 WHERE singleton=1").run(groupId);
  return c.json(await accessControlSnapshot());
});

api.put("/access-control/profiles/:id", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const userId = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const groupId = Number(body.group_id);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(groupId) || !await database.prepare("SELECT id FROM users WHERE id=?").get(userId) || !await database.prepare("SELECT id FROM permission_groups WHERE id=?").get(groupId)) return c.json({ error: "invalid profile access" }, 400);
  const overrides = body.overrides && typeof body.overrides === "object" && !Array.isArray(body.overrides) ? body.overrides as Record<string, unknown> : {};
  if (Object.entries(overrides).some(([permission, value]) => !isProfilePermissionArea(permission) || (value !== "allow" && value !== "deny"))) return c.json({ error: "invalid override" }, 400);
  await updateProfileAccess(userId, groupId, overrides as Partial<Record<ProfilePermissionArea, "allow" | "deny">>);
  await database.prepare("UPDATE permission_policy SET revision=revision+1 WHERE singleton=1").run();
  return c.json({ access: await effectivePermissions(userId) });
});

api.delete("/access-control/groups/:id", async (c) => {
  if (!isPrimaryUser(c)) return c.json({ error: "primary only" }, 403);
  const groupId = Number(c.req.param("id"));
  const replacementId = Number(c.req.query("replacement_group_id"));
  const snapshot = await accessControlSnapshot();
  const group = snapshot.groups.find((item) => item.id === groupId);
  if (!Number.isSafeInteger(groupId) || !group) return c.json({ error: "not found" }, 404);
  if (group.is_system) return c.json({ error: "system group cannot be deleted" }, 409);
  const memberCount = await groupMemberCount(groupId);
  const requiresReplacement = memberCount > 0 || groupId === snapshot.default_group_id;
  if (requiresReplacement && (!Number.isSafeInteger(replacementId) || replacementId === groupId || !await database.prepare("SELECT id FROM permission_groups WHERE id=?").get(replacementId))) {
    return c.json({ error: "replacement group required" }, 409);
  }
  await database.transaction(async () => {
    if (groupId === snapshot.default_group_id) {
      await database.prepare("UPDATE permission_policy SET default_group_id=? WHERE singleton=1").run(replacementId);
    }
    if (memberCount > 0) {
      await database.prepare("UPDATE profile_permission_groups SET group_id=? WHERE group_id=?").run(replacementId, groupId);
    }
    await database.prepare("DELETE FROM permission_groups WHERE id=?").run(groupId);
    await database.prepare("UPDATE permission_policy SET revision=revision+1 WHERE singleton=1").run();
  })();
  await removeRoleFromExternalMappings(group.portable_uuid);
  return c.json(await accessControlSnapshot());
});

api.post("/child-lock/enable", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (isChildLockEnabled()) return c.json({ error: "child lock already enabled" }, 409);
  const body = await c.req.json().catch(() => ({}));
  if (!isSixDigitPin(body.pin)) return c.json({ error: "PIN must have 6 digits" }, 400);
  await setSetting("child_lock_pin_hash", await hashChildLockPin(body.pin));
  await setSetting("child_lock_enabled", "1");
  await database.prepare("DELETE FROM child_lock_sessions").run();
  publishAppEvent("child-requests");
  // Admin access no longer depends on the shared unlock cookie. Clear any stale
  // cookie so other profiles in this browser are protected immediately.
  await clearChildLockSession(c);
  return c.json({ child_lock: await childLockStatus(c) });
});

api.post("/child-lock/unlock", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!isChildLockEnabled()) return c.json({ child_lock: await childLockStatus(c) });
  if (!isSixDigitPin(body.pin) || !(await verifyChildLockPin(body.pin))) {
    return c.json({ error: "invalid PIN" }, 401);
  }
  await setChildLockSession(c);
  return c.json({ child_lock: await childLockStatus(c) });
});

api.post("/child-lock/lock", async (c) => {
  await clearChildLockSession(c);
  return c.json({ child_lock: await childLockStatus(c) });
});

api.post("/child-lock/change-pin", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (!isChildLockEnabled()) return c.json({ error: "child lock is disabled" }, 400);
  const body = await c.req.json().catch(() => ({}));
  if (!isSixDigitPin(body.new_pin)) return c.json({ error: "PIN must have 6 digits" }, 400);
  await setSetting("child_lock_pin_hash", await hashChildLockPin(body.new_pin));
  await database.prepare("DELETE FROM child_lock_sessions").run();
  publishAppEvent("child-requests");
  await clearChildLockSession(c);
  return c.json({ child_lock: await childLockStatus(c) });
});

api.post("/child-lock/disable", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "only an admin can manage child lock" }, 403);
  if (!isChildLockEnabled()) return c.json({ child_lock: await childLockStatus(c) });
  await setSetting("child_lock_enabled", "0");
  await setSetting("child_lock_pin_hash", "");
  await database.prepare("DELETE FROM child_lock_sessions").run();
  publishAppEvent("child-requests");
  await clearChildLockSession(c);
  return c.json({ child_lock: await childLockStatus(c) });
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "settings must be an object" }, 400);
  if (Object.keys(body).some((key) => !(key in SETTING_DEFAULTS))) return c.json({ error: "unknown setting" }, 400);
  if ("language" in body && !isLanguage(body.language)) return c.json({ error: "unsupported interface language" }, 400);
  if ("youtube_title_language" in body && normalizeYouTubeTitleLanguage(body.youtube_title_language) !== body.youtube_title_language) {
    return c.json({ error: "unsupported video title language" }, 400);
  }
  if ("timezone" in body && timeZoneIsEnvironmentLocked()) return c.json({ error: "timezone is controlled by the TZ environment variable" }, 409);
  if ("timezone" in body && !isValidTimeZone(body.timezone)) return c.json({ error: "invalid timezone" }, 400);
  const videoCardSettingsError = validateVideoCardSettings(body); if (videoCardSettingsError) return c.json({ error: videoCardSettingsError }, 400);
  if ("keyboard_shortcuts" in body && normalizeKeyboardShortcutSetting(body.keyboard_shortcuts) === null) return c.json({ error: "invalid keyboard shortcut settings" }, 400);
  if ("player_speed" in body && normalizePlaybackSpeed(body.player_speed) === null) return c.json({ error: "invalid playback speed" }, 400);
  if ("player_speed_options" in body && normalizePlaybackSpeedOptionsSetting(body.player_speed_options) === null) return c.json({ error: "invalid playback speed options" }, 400);
  if ("show_shorts" in body && body.show_shorts !== "disabled" && body.show_shorts !== "0" && body.show_shorts !== "selected" && body.show_shorts !== "1") {
    return c.json({ error: "invalid Shorts feed mode" }, 400);
  }
  if ("watch_show_comments" in body && !isWatchCommentsSetting(body.watch_show_comments)) {
    return c.json({ error: "invalid watch comments mode" }, 400);
  }
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (key === "child_lock_pin_hash" || key === "child_lock_enabled") continue;
    if (!(key in body)) continue;
    if (GLOBAL_SETTING_KEYS.has(key)) {
      // Only an administrator owns app-wide settings (name, icon, timezone).
      if (primary) await setSetting(key, String(body[key]));
    } else {
      const value = key === "keyboard_shortcuts"
        ? normalizeKeyboardShortcutSetting(body[key])!
        : key === "player_speed"
          ? normalizePlaybackSpeed(body[key])!
          : key === "player_speed_options"
            ? normalizePlaybackSpeedOptionsSetting(body[key])!
            : key === "watch_show_comments"
              ? normalizeWatchCommentsMode(body[key])
              : normalizeVideoCardSetting(key, body[key]);
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
