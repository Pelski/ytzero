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
const wrongChange = await api.request("http://localhost/auth/profile/password", {
  method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ current_password: "wrong", new_password: "new-password-123" }),
});
const changed = await api.request("http://localhost/auth/profile/password", {
  method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ current_password: regeneratedCredential.password, new_password: "new-password-123" }),
});
const changedHash = (db.prepare("SELECT password_hash FROM users WHERE id = 1").get() as { password_hash: string }).password_hash;

console.log("RESULT " + JSON.stringify({
  firstStatus: firstResponse.status,
  secondStatus: secondResponse.status,
  regenerateStatus: regenerateResponse.status,
  usernames: rowsAfterSecond.map((row) => row.username),
  firstOnlyTargetHasPassword: Boolean(rowsAfterFirst[0]?.password_hash) && rowsAfterFirst[1]?.password_hash === null,
  firstPasswordVerifies: await Bun.password.verify(firstCredential.password, rowsAfterSecond[0]!.password_hash),
  secondPasswordVerifies: await Bun.password.verify(secondCredential.password, rowsAfterSecond[1]!.password_hash),
  regeneratedPasswordChanged: regeneratedCredential.password !== firstCredential.password,
  oldPasswordInvalidated: !(await Bun.password.verify(firstCredential.password, regeneratedHash)),
  regeneratedPasswordVerifies: await Bun.password.verify(regeneratedCredential.password, regeneratedHash),
  visibilityUpdateStatus: visibilityUpdate.status,
  visibilityConfigured,
  sharedPickerProfilesHidden,
  pickerProfilesHidden,
  nonAdminVisibilityUpdateStatus: nonAdminVisibilityUpdate.status,
  adminChildUpdateStatus: adminChildUpdate.status,
  nonAdminChildUpdateStatus: nonAdminChildUpdate.status,
  childFlag: childRow.is_child,
  childLimit: childLimit.value,
  wrongChangeStatus: wrongChange.status,
  changedStatus: changed.status,
  newPasswordVerifies: await Bun.password.verify("new-password-123", changedHash),
}));
db.close();
