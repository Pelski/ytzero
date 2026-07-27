const { api } = await import("../src/routes");
const { db, getUserSetting, setSetting } = await import("../src/db");
const { AUTH_SESSION_COOKIE, createSession } = await import("../src/auth");

setSetting("auth_method", "oidc");
setSetting("auth_oidc_mode", "mapped");
setSetting("auth_oidc_claim", "email");
const cookie = `${AUTH_SESSION_COOKIE}=${await createSession(1, "profile")}`;

async function request(path: string, method: string, body?: unknown) {
  return api.request(`http://localhost${path}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const missing = await request("/profiles", "POST", { name: "Missing identity" });
const invalid = await request("/profiles", "POST", { name: "Invalid email", oidc_identity: "not-an-email" });
const createdResponse = await request("/profiles", "POST", {
  name: "Child",
  oidc_identity: " Child@Example.com ",
  is_child: true,
});
const created = await createdResponse.json() as any;
const childId = created.profile.id as number;
const createdRow = db.prepare("SELECT oidc_subject, is_child FROM users WHERE id = ?").get(childId);
const childLocalOnly = getUserSetting(childId, "child_local_only");
const deleted = await request(`/profiles/${childId}`, "DELETE", {});
const existsAfterDelete = Boolean(db.prepare("SELECT id FROM users WHERE id = ?").get(childId));

setSetting("auth_oidc_claim", "employee_id");
const customResponse = await request("/profiles", "POST", {
  name: "Custom claim",
  oidc_identity: " Team-Member-42 ",
});
const custom = await customResponse.json() as any;
const customIdentity = (db.prepare("SELECT oidc_subject FROM users WHERE id = ?").get(custom.profile.id) as any).oidc_subject;

console.log("RESULT " + JSON.stringify({
  missingStatus: missing.status,
  invalidStatus: invalid.status,
  createdStatus: createdResponse.status,
  createdRow,
  childLocalOnly,
  deletedStatus: deleted.status,
  existsAfterDelete,
  customStatus: customResponse.status,
  customIdentity,
}));
db.close();
