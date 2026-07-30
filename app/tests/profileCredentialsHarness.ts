const { api } = await import("../src/routes");
const { db, setSetting } = await import("../src/db");
const { AUTH_SESSION_COOKIE, createSession } = await import("../src/auth");

db.prepare("UPDATE users SET name = ?, username = NULL, password_hash = NULL WHERE id = 1").run("Dom! Rodzinny");
const inserted = db.prepare("INSERT INTO users (name, avatar_color, sort_order, portable_uuid) VALUES (?, ?, ?, ?) RETURNING id").get("Dom Rodzinny", "#7c5cff", 1, crypto.randomUUID()) as { id: number };

const firstResponse = await api.request("http://localhost/auth/per-profile/credentials/1", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const firstCredential = (await firstResponse.json() as any).credential;
const rowsAfterFirst = db.prepare("SELECT id, username, password_hash FROM users ORDER BY id").all() as Array<{ id: number; username: string; password_hash: string | null }>;

const secondResponse = await api.request(`http://localhost/auth/per-profile/credentials/${inserted.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const secondCredential = (await secondResponse.json() as any).credential;
const rowsAfterSecond = db.prepare("SELECT id, username, password_hash FROM users ORDER BY id").all() as Array<{ id: number; username: string; password_hash: string }>;

const regenerateResponse = await api.request("http://localhost/auth/per-profile/credentials/1", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const regeneratedCredential = (await regenerateResponse.json() as any).credential;
const regeneratedHash = (db.prepare("SELECT password_hash FROM users WHERE id = 1").get() as { password_hash: string }).password_hash;

const visibilityUpdate = await api.request("http://localhost/auth/config", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hide_other_profiles: true }),
});
const visibilityConfig = await api.request("http://localhost/auth/config");
const visibilityConfigured = (await visibilityConfig.json() as any).hide_other_profiles;

await setSetting("auth_method", "shared");
const sharedAuthStatus = await api.request("http://localhost/auth/status");
const sharedPickerProfilesHidden = (await sharedAuthStatus.json() as any).hide_other_profiles;
const sharedCookie = `${AUTH_SESSION_COOKIE}=${await createSession(null, "account")}`;
const sharedAdminGrant = await api.request(`http://localhost/profiles/${inserted.id}/admin`, {
  method: "PUT", headers: { Cookie: sharedCookie, "Content-Type": "application/json" }, body: JSON.stringify({ is_admin: true }),
});
await setSetting("auth_method", "per_profile");
const cookie = `${AUTH_SESSION_COOKIE}=${await createSession(1, "profile")}`;
const authStatus = await api.request("http://localhost/auth/status", { headers: { Cookie: cookie } });
const pickerProfilesHidden = (await authStatus.json() as any).hide_other_profiles;
const nonAdminCookie = `${AUTH_SESSION_COOKIE}=${await createSession(inserted.id, "profile")}`;
const nonAdminVisibilityUpdate = await api.request("http://localhost/auth/config", {
  method: "PUT", headers: { Cookie: nonAdminCookie, "Content-Type": "application/json" }, body: JSON.stringify({ hide_other_profiles: false }),
});
const adminChildUpdate = await api.request(`http://localhost/profiles/${inserted.id}`, {
  method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ is_child: true, child_config: { limit_minutes: 45, hide_shorts: true } }),
});
const nonAdminChildUpdate = await api.request(`http://localhost/profiles/${inserted.id}`, {
  method: "PATCH", headers: { Cookie: nonAdminCookie, "Content-Type": "application/json" },
  body: JSON.stringify({ child_config: { limit_minutes: 90 } }),
});
const childRow = db.prepare("SELECT is_child FROM users WHERE id = ?").get(inserted.id) as { is_child: number };
const childLimit = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'child_limit_minutes'").get(inserted.id) as { value: string };
const delegate = db.prepare("INSERT INTO users (name, avatar_color, sort_order, portable_uuid) VALUES (?, ?, ?, ?) RETURNING id").get("Pomocnik", "#3ea6ff", 2, crypto.randomUUID()) as { id: number };
const grantAdmin = await api.request(`http://localhost/profiles/${delegate.id}/admin`, {
  method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ is_admin: true }),
});
const delegateCookie = `${AUTH_SESSION_COOKIE}=${await createSession(delegate.id, "profile")}`;
const delegatedStatusBody = await (await api.request("http://localhost/auth/status", { headers: { Cookie: delegateCookie } })).json() as any;
const delegatedPrimaryEdit = await api.request("http://localhost/profiles/1", {
  method: "PATCH", headers: { Cookie: delegateCookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Nie wolno" }),
});
const delegatedRoleChange = await api.request(`http://localhost/profiles/${inserted.id}/admin`, {
  method: "PUT", headers: { Cookie: delegateCookie, "Content-Type": "application/json" }, body: JSON.stringify({ is_admin: true }),
});
const delegatedChildUpdate = await api.request(`http://localhost/profiles/${inserted.id}`, {
  method: "PATCH", headers: { Cookie: delegateCookie, "Content-Type": "application/json" }, body: JSON.stringify({ child_config: { limit_minutes: 60 } }),
});
const delegatedVisibilityUpdate = await api.request("http://localhost/profiles/visibility", {
  method: "PUT", headers: { Cookie: delegateCookie, "Content-Type": "application/json" }, body: JSON.stringify({ hide_other_profiles: false }),
});
const revokeAdmin = await api.request(`http://localhost/profiles/${delegate.id}/admin`, {
  method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ is_admin: false }),
});
const revokedStatusBody = await (await api.request("http://localhost/auth/status", { headers: { Cookie: delegateCookie } })).json() as any;
const wrongChange = await api.request("http://localhost/auth/profile/password", {
  method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ current_password: "wrong", new_password: "new-password-123" }),
});
const changed = await api.request("http://localhost/auth/profile/password", {
  method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ current_password: regeneratedCredential.password, new_password: "new-password-123" }),
});
const changedHash = (db.prepare("SELECT password_hash FROM users WHERE id = 1").get() as { password_hash: string }).password_hash;

// Keep temporary passwords entirely inside the harness. Even derived values
// from credentials must not cross the subprocess boundary through stdout.
if (!rowsAfterFirst[0]?.password_hash || rowsAfterFirst[1]?.password_hash !== null) throw new Error("Credential generation updated an unexpected profile");
if (!(await Bun.password.verify(firstCredential.password, rowsAfterSecond[0]!.password_hash))) throw new Error("First generated credential did not verify");
if (!(await Bun.password.verify(secondCredential.password, rowsAfterSecond[1]!.password_hash))) throw new Error("Second generated credential did not verify");
if (regeneratedCredential.password === firstCredential.password) throw new Error("Credential regeneration reused the previous password");
if (await Bun.password.verify(firstCredential.password, regeneratedHash)) throw new Error("Credential regeneration did not invalidate the previous password");
if (!(await Bun.password.verify(regeneratedCredential.password, regeneratedHash))) throw new Error("Regenerated credential did not verify");
if (!(await Bun.password.verify("new-password-123", changedHash))) throw new Error("Changed credential did not verify");

console.log("RESULT " + JSON.stringify({
  firstStatus: firstResponse.status,
  secondStatus: secondResponse.status,
  regenerateStatus: regenerateResponse.status,
  usernames: rowsAfterSecond.map((row) => row.username),
  firstOnlyTargetHasPassword: true,
  generatedCredentialsVerified: true,
  regenerationVerified: true,
  passwordChangeVerified: true,
  visibilityUpdateStatus: visibilityUpdate.status,
  visibilityConfigured,
  sharedPickerProfilesHidden,
  sharedAdminGrantStatus: sharedAdminGrant.status,
  pickerProfilesHidden,
  nonAdminVisibilityUpdateStatus: nonAdminVisibilityUpdate.status,
  adminChildUpdateStatus: adminChildUpdate.status,
  nonAdminChildUpdateStatus: nonAdminChildUpdate.status,
  childFlag: childRow.is_child,
  childLimit: childLimit.value,
  grantAdminStatus: grantAdmin.status,
  delegatedIsAdmin: delegatedStatusBody.is_admin,
  delegatedCanManageAdministrators: delegatedStatusBody.can_manage_administrators,
  delegatedPrimaryEditStatus: delegatedPrimaryEdit.status,
  delegatedRoleChangeStatus: delegatedRoleChange.status,
  delegatedChildUpdateStatus: delegatedChildUpdate.status,
  delegatedVisibilityUpdateStatus: delegatedVisibilityUpdate.status,
  revokeAdminStatus: revokeAdmin.status,
  revokedIsAdmin: revokedStatusBody.is_admin,
  wrongChangeStatus: wrongChange.status,
  changedStatus: changed.status,
}));
db.close();
