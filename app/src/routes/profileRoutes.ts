import type { Context, Hono } from "hono";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { publishAppEvent } from "../appEvents";
import { authMethod, hashPassword } from "../auth";
import {
  childStatus,
  clearChildLockFailures,
  isParentLocked,
  isPinLocked,
  registerChildLockFailure,
} from "../childTime";
import { database } from "../database";
import { getSetting, getUserSetting, setSetting, setUserSetting } from "../db";
import { removeDownload, removeDownloadCookies } from "../downloader";
import { log } from "../logger";
import { generateTemporaryPassword, uniqueProfileUsername } from "../profileCredentials";
import {
  commitStagedProfileAvatar,
  optimizeProfileAvatar,
  PROFILE_AVATAR_DIR,
  profileAvatarFileName,
  removeStoredProfileAvatar,
  stageProfileAvatarBytes,
} from "../profileAvatars";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

interface ProfileRouteAccess {
  canDelegateProfileAdmins: () => boolean;
  canManageProfile: (context: ApiContext, profileId: number) => boolean;
  canSwitchProfiles: () => boolean;
  currentUserId: (context: ApiContext) => number;
  hashPin: (pin: string) => Promise<string>;
  isAdmin: (context: ApiContext) => boolean;
  isChildLockEnabled: () => boolean;
  isPrimaryUser: (context: ApiContext) => boolean;
  isSixDigitPin: (pin: unknown) => pin is string;
  methodLogoutUrl: () => string;
  primaryUserId: () => number;
  profileCookie: (userId: number) => string;
  verifyChildLockPin: (pin: string) => Promise<boolean>;
}

export function registerProfileRoutes(api: Api, access: ProfileRouteAccess): void {
  const {
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
  } = access;

// ---------- profiles (multi-user) ----------

const AVATAR_DIR = PROFILE_AVATAR_DIR;
const firstUserId = database.prepare("SELECT id FROM users ORDER BY sort_order ASC, id ASC LIMIT 1");
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
}
