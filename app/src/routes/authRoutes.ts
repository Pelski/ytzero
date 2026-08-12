import type { Context, Hono } from "hono";
import { database } from "../database";
import { getSetting, setSetting } from "../db";
import { log } from "../logger";
import { generateTemporaryPassword, uniqueProfileUsername } from "../profileCredentials";
import {
  AUTH_SESSION_COOKIE,
  authMethod,
  authSessionCookie,
  clearAuthSessionCookie,
  createSession,
  deletePasskey,
  destroySession,
  hasPasskeys,
  invalidateOidcConfig,
  listPasskeys,
  oidcAuthUrl,
  oidcCallback,
  passkeyLoginOptions,
  passkeyLoginVerify,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  proxyHeaderValue,
  requestOrigin,
  resolveProxyUser,
  sharedAuth,
  testOidc,
  validateSession,
} from "../auth";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

interface UserRow {
  id: number;
  name: string;
  username: string | null;
  password_hash: string | null;
  oidc_subject: string | null;
  proxy_match: string | null;
}

interface AuthRouteAccess {
  canDelegateProfileAdmins: () => boolean;
  canSwitchProfiles: () => boolean;
  currentUserId: (context: ApiContext) => number;
  hideOtherProfilesInPicker: () => boolean;
  isAdmin: (context: ApiContext) => boolean;
  isPrimaryUser: (context: ApiContext) => boolean;
  methodLogoutUrl: () => string;
  parseCookies: (header: string | undefined) => Record<string, string>;
  profileCookie: (userId: number) => string;
}

export function registerAuthRoutes(api: Api, access: AuthRouteAccess): void {
  const {
    canDelegateProfileAdmins,
    canSwitchProfiles,
    currentUserId,
    hideOtherProfilesInPicker,
    isAdmin,
    isPrimaryUser,
    methodLogoutUrl,
    parseCookies,
    profileCookie,
  } = access;

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
    username_field: method === "per_profile" || (method === "shared" && Boolean(sharedAuth.username())),
    login: {
      password:
        method === "shared" ? sharedAuth.passwordConfigured() : method === "per_profile",
      passkey: method === "shared" ? await hasPasskeys(null) : method === "per_profile" ? perProfilePasskeys : false,
      oidc: method === "oidc",
    },
  });
});

api.post("/auth/password/login", async (c) => {
  const method = authMethod();
  const { username, password } = await c.req.json().catch(() => ({}));
  if (method === "shared") {
    const expectedUser = sharedAuth.username();
    if (expectedUser && String(username ?? "") !== expectedUser) return c.json({ error: "invalid credentials" }, 401);
    if (!(await sharedAuth.verifyPassword(String(password ?? "")))) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    c.header("Set-Cookie", authSessionCookie(await createSession(null, "account")));
    log.info("auth.login", { method, scope: "account" });
    return c.json({ ok: true });
  }
  if (method === "per_profile") {
    const row = await database.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username ?? "")) as UserRow | null;
    if (!row?.password_hash || !(await sharedAuth.verifyHash(String(password ?? ""), row.password_hash))) {
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
    method: authMethod(),
    hide_other_profiles: getSetting("auth_hide_other_profiles") === "1",
    shared: {
      username: sharedAuth.username(),
      password_set: sharedAuth.passwordConfigured(),
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
    if (body.shared.password) await setSetting("auth_shared_password_hash", await sharedAuth.hashPassword(String(body.shared.password)));
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
  const passwordHash = await sharedAuth.hashPassword(password);
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
  if (!row?.password_hash || !(await sharedAuth.verifyHash(String(current_password ?? ""), row.password_hash))) return c.json({ error: "current password is incorrect" }, 401);
  const next = String(new_password ?? "");
  if (next.length < 8 || next.length > 200) return c.json({ error: "new password must contain 8 to 200 characters" }, 400);
  await database.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await sharedAuth.hashPassword(next), id);
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
  if (sharedAuth.environmentControlled()) return c.json({ error: "authentication method is controlled by YTZERO_AUTH_METHOD" }, 409);
  const { method } = await c.req.json().catch(() => ({}));
  const valid = ["none", "shared", "per_profile", "oidc", "proxy_header"];
  if (!valid.includes(method)) return c.json({ error: "invalid method" }, 400);

  if (method === "shared" && !sharedAuth.passwordConfigured() && !await hasPasskeys(null)) {
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
}
