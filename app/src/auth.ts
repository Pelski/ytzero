// Authentication layer for ytzero.
//
// The app supports five auth methods (settings key `auth_method`):
//   none         — no auth; the `ytzero_profile` cookie selects a profile (legacy).
//   shared       — one household login (password and/or passkey); free profile switching.
//   per_profile  — each profile has its own login; switching profile = re-login.
//   oidc         — external IdP; mapped (identity->one profile) or gateway (SSO->picker).
//   proxy_header — a trusted reverse proxy sets a username header matched to a profile.
//
// Profile id stays the unit of isolation everywhere else; this module just turns
// "an authenticated request" into "an active profile id" for the route middleware.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import * as oidc from "openid-client";
import { db, getSetting } from "./db";

export type AuthMethod = "none" | "shared" | "per_profile" | "oidc" | "proxy_header";

export function authMethod(): AuthMethod {
  if (process.env.YTZERO_AUTH_DISABLE === "1") return "none"; // emergency unlock
  const m = getSetting("auth_method") ?? "none";
  return (["none", "shared", "per_profile", "oidc", "proxy_header"].includes(m) ? m : "none") as AuthMethod;
}

export async function hashPassword(password: string) {
  return Bun.password.hash(password);
}
export async function verifyPassword(password: string, hash: string) {
  if (!hash) return false;
  return Bun.password.verify(password, hash);
}

// ---------- request origin / RP id (for WebAuthn and OIDC redirect URIs) ----------

export function requestOrigin(c: any): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  return `${proto}://${host}`;
}

// The browser's actual web origin, taken from the request's Origin header (sent
// on fetch/XHR). In dev the UI runs on a different port than the API and proxies
// /api through, so WebAuthn must validate against the browser origin — not the
// API's own host. Falls back to the derived origin for non-CORS requests.
export function webauthnOrigin(c: any): string {
  return c.req.header("origin") || requestOrigin(c);
}

export function rpId(c: any): string {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  try {
    return new URL(webauthnOrigin(c)).hostname;
  } catch {
    return "localhost";
  }
}

// ---------- sessions (DB-backed, survive restart) ----------

export const AUTH_SESSION_COOKIE = "ytzero_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionScope = "account" | "profile";

export function createSession(userId: number | null, scope: SessionScope, isAdmin = false): string {
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO auth_sessions (token, user_id, scope, is_admin, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).run(token, userId, scope, isAdmin ? 1 : 0, expires);
  return token;
}

export function validateSession(
  token: string | undefined
): { user_id: number | null; scope: SessionScope; is_admin: boolean } | null {
  if (!token) return null;
  const row = db
    .prepare("SELECT user_id, scope, is_admin, expires_at FROM auth_sessions WHERE token = ?")
    .get(token) as { user_id: number | null; scope: SessionScope; is_admin: number; expires_at: string } | null;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
    return null;
  }
  db.prepare("UPDATE auth_sessions SET last_seen = datetime('now') WHERE token = ?").run(token);
  return { user_id: row.user_id, scope: row.scope, is_admin: row.is_admin === 1 };
}

export function destroySession(token: string | undefined) {
  if (token) db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
}

export function cleanupSessions() {
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= datetime('now')").run();
}

export function authSessionCookie(token: string) {
  return `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}; SameSite=Lax; HttpOnly`;
}
export function clearAuthSessionCookie() {
  return `${AUTH_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
}

// ---------- short-lived challenge / state store (WebAuthn + OIDC) ----------

type Flow = { value: string; userId: number | null; nonce?: string; expires: number };
const flows = new Map<string, Flow>();
const FLOW_TTL_MS = 5 * 60 * 1000;

function cleanupFlows() {
  const now = Date.now();
  for (const [k, f] of flows) if (f.expires <= now) flows.delete(k);
}

function putFlow(value: string, userId: number | null, nonce?: string): string {
  cleanupFlows();
  const id = crypto.randomUUID();
  flows.set(id, { value, userId, nonce, expires: Date.now() + FLOW_TTL_MS });
  return id;
}
function takeFlow(id: string | undefined): Flow | null {
  if (!id) return null;
  const f = flows.get(id);
  if (!f) return null;
  flows.delete(id);
  if (f.expires <= Date.now()) return null;
  return f;
}

// ---------- WebAuthn / passkeys ----------

type CredRow = {
  id: number;
  user_id: number | null;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  label: string | null;
  created_at: string;
};

function credsFor(userId: number | null): CredRow[] {
  const rows =
    userId === null
      ? db.prepare("SELECT * FROM webauthn_credentials WHERE user_id IS NULL").all()
      : db.prepare("SELECT * FROM webauthn_credentials WHERE user_id = ?").all(userId);
  return rows as CredRow[];
}

export function hasPasskeys(userId: number | null): boolean {
  return credsFor(userId).length > 0;
}

export function listPasskeys(userId: number | null) {
  return credsFor(userId).map((r) => ({ id: r.id, label: r.label ?? null, created_at: r.created_at }));
}

export function deletePasskey(id: number, userId: number | null) {
  if (userId === null) db.prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id IS NULL").run(id);
  else db.prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?").run(id, userId);
}

// Registration: create options for the given account/profile (userId NULL = shared).
export async function passkeyRegisterOptions(c: any, userId: number | null, userName: string) {
  const existing = credsFor(userId);
  const options = await generateRegistrationOptions({
    rpName: getSetting("app_name") || "YT Zero",
    rpID: rpId(c),
    userName,
    userID: new TextEncoder().encode(String(userId ?? "shared")),
    attestationType: "none",
    excludeCredentials: existing.map((cr) => ({ id: cr.credential_id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  const flowId = putFlow(options.challenge, userId);
  return { options, flowId };
}

export async function passkeyRegisterVerify(
  c: any,
  flowId: string | undefined,
  response: RegistrationResponseJSON,
  label?: string
) {
  const flow = takeFlow(flowId);
  if (!flow) throw new Error("challenge expired");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: flow.value,
    expectedOrigin: webauthnOrigin(c),
    expectedRPID: rpId(c),
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error("verification failed");
  const cred = verification.registrationInfo.credential;
  db.prepare(
    "INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    flow.userId,
    cred.id,
    Buffer.from(cred.publicKey),
    cred.counter ?? 0,
    cred.transports ? JSON.stringify(cred.transports) : null,
    label ?? null
  );
  return { user_id: flow.userId };
}

// Login: options can target a specific profile (per_profile) or any (shared = NULL,
// or "all profiles" for discovery). We allow credentials across the relevant scope.
export async function passkeyLoginOptions(c: any, userId: number | null) {
  const creds = userId === null ? allLoginCreds() : credsFor(userId);
  const options = await generateAuthenticationOptions({
    rpID: rpId(c),
    userVerification: "preferred",
    allowCredentials: creds.map((cr) => ({
      id: cr.credential_id,
      transports: cr.transports ? JSON.parse(cr.transports) : undefined,
    })),
  });
  const flowId = putFlow(options.challenge, userId);
  return { options, flowId };
}

// For shared login the credential has user_id NULL; for per_profile/oidc-mapped
// login the resolved profile is whatever owns the credential.
function allLoginCreds(): CredRow[] {
  const method = authMethod();
  if (method === "shared") return credsFor(null);
  return db.prepare("SELECT * FROM webauthn_credentials WHERE user_id IS NOT NULL").all() as CredRow[];
}

export async function passkeyLoginVerify(
  c: any,
  flowId: string | undefined,
  response: AuthenticationResponseJSON
): Promise<{ user_id: number | null }> {
  const flow = takeFlow(flowId);
  if (!flow) throw new Error("challenge expired");
  const cred = db
    .prepare("SELECT * FROM webauthn_credentials WHERE credential_id = ?")
    .get(response.id) as CredRow | null;
  if (!cred) throw new Error("unknown credential");
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: flow.value,
    expectedOrigin: webauthnOrigin(c),
    expectedRPID: rpId(c),
    credential: {
      id: cred.credential_id,
      publicKey: new Uint8Array(cred.public_key),
      counter: cred.counter,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    },
  });
  if (!verification.verified) throw new Error("verification failed");
  db.prepare("UPDATE webauthn_credentials SET counter = ? WHERE id = ?").run(
    verification.authenticationInfo.newCounter,
    cred.id
  );
  return { user_id: cred.user_id };
}

// ---------- OIDC ----------

let oidcConfigCache: { key: string; config: oidc.Configuration } | null = null;

async function getOidcConfig(): Promise<oidc.Configuration> {
  const issuer = getSetting("auth_oidc_issuer") || "";
  const clientId = getSetting("auth_oidc_client_id") || "";
  const clientSecret = getSetting("auth_oidc_client_secret") || "";
  if (!issuer || !clientId) throw new Error("OIDC not configured");
  const key = `${issuer}|${clientId}|${clientSecret}`;
  if (oidcConfigCache?.key === key) return oidcConfigCache.config;
  const config = await oidc.discovery(new URL(issuer), clientId, clientSecret || undefined);
  oidcConfigCache = { key, config };
  return config;
}

export function invalidateOidcConfig() {
  oidcConfigCache = null;
}

function oidcRedirectUri(c: any) {
  return `${requestOrigin(c)}/api/auth/oidc/callback`;
}

// Probe the issuer's discovery document; used by the setup wizard's "test" button.
export async function testOidc(): Promise<{ ok: boolean; authorization_endpoint?: string; token_endpoint?: string; error?: string }> {
  try {
    const config = await getOidcConfig();
    const meta = config.serverMetadata();
    return { ok: true, authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "discovery failed" };
  }
}

export async function oidcAuthUrl(c: any): Promise<{ url: string; flowId: string }> {
  const config = await getOidcConfig();
  const scope = getSetting("auth_oidc_scopes") || "openid profile email";
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: oidcRedirectUri(c),
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  // Store the verifier keyed by a flow id we put in a cookie; correlate on callback.
  const flowId = putFlow(codeVerifier, null, nonce);
  // We also need the state echoed back; pack it into the flow value map via a second entry.
  flows.get(flowId)!.value = JSON.stringify({ codeVerifier, state });
  return { url: url.href, flowId };
}

// Admin if the configured groups claim (from the id_token, or userinfo as a
// fallback) contains the configured admin group. Empty admin_group disables it.
async function resolveOidcAdmin(config: oidc.Configuration, tokens: any, claims: any): Promise<boolean> {
  const adminGroup = (getSetting("auth_oidc_admin_group") || "").trim();
  if (!adminGroup) return false;
  const groupsClaim = getSetting("auth_oidc_groups_claim") || "groups";
  let groups = claims?.[groupsClaim];
  if (groups === undefined && tokens?.access_token && claims?.sub) {
    try {
      const info = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
      groups = (info as any)?.[groupsClaim];
    } catch {
      // userinfo unavailable — fall through with no groups
    }
  }
  const list = Array.isArray(groups) ? groups.map(String) : typeof groups === "string" ? [groups] : [];
  return list.includes(adminGroup);
}

// Returns the mapped/auto-created profile id (null for gateway mode) plus whether
// the identity's groups grant admin.
export async function oidcCallback(
  c: any,
  flowId: string | undefined,
  currentUrl: string
): Promise<{ user_id: number | null; mode: "mapped" | "gateway"; is_admin: boolean }> {
  const flow = takeFlow(flowId);
  if (!flow) throw new Error("login flow expired");
  const { codeVerifier, state } = JSON.parse(flow.value) as { codeVerifier: string; state: string };
  const config = await getOidcConfig();
  const tokens = await oidc.authorizationCodeGrant(config, new URL(currentUrl), {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: flow.nonce,
  });
  const claims = tokens.claims() ?? {};
  const mode = (getSetting("auth_oidc_mode") || "mapped") as "mapped" | "gateway";
  const is_admin = await resolveOidcAdmin(config, tokens, claims);

  if (mode === "gateway") return { user_id: null, mode, is_admin };

  // mapped: resolve the configured claim to a profile.
  const claimName = getSetting("auth_oidc_claim") || "preferred_username";
  const claimValue = String((claims as any)[claimName] ?? (claims as any).sub ?? "");
  if (!claimValue) throw new Error("identity claim missing");

  let row = db.prepare("SELECT id FROM users WHERE oidc_subject = ?").get(claimValue) as { id: number } | null;
  if (!row) {
    if (getSetting("auth_oidc_autocreate") === "1") {
      const nextOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM users").get() as { n: number }).n;
      const name = String((claims as any).name ?? (claims as any).preferred_username ?? claimValue);
      const created = db
        .prepare("INSERT INTO users (name, avatar_color, oidc_subject, sort_order) VALUES (?, ?, ?, ?) RETURNING id")
        .get(name, "#7c5cff", claimValue, nextOrder) as { id: number };
      row = created;
    } else {
      throw new Error("no profile mapped to this identity");
    }
  }
  return { user_id: row.id, mode, is_admin };
}

// ---------- proxy header ----------

export function resolveProxyUser(c: any): number | null {
  const headerName = (getSetting("auth_proxy_header") || "Remote-User").toLowerCase();
  const value = c.req.header(headerName);
  if (!value) return null;
  const row = db.prepare("SELECT id FROM users WHERE proxy_match = ?").get(value) as { id: number } | null;
  return row?.id ?? null;
}

export function proxyHeaderValue(c: any): string | null {
  const headerName = (getSetting("auth_proxy_header") || "Remote-User").toLowerCase();
  return c.req.header(headerName) ?? null;
}
