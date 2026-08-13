const { api } = await import("../src/routes");
const { setSetting } = await import("../src/db");

await setSetting("auth_method", "none");
await setSetting("auth_shared_username", "stored-user");
await setSetting("auth_shared_password_hash", await Bun.password.hash("stored-password"));

const status = await api.request("http://localhost/auth/status");
const statusBody = await status.json() as any;
const storedLogin = await api.request("http://localhost/auth/password/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "stored-user", password: "stored-password" }),
});
const environmentLogin = await api.request("http://localhost/auth/password/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: process.env.YTZERO_AUTH_PASSWORD }),
});
const cookie = environmentLogin.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
const methodChange = await api.request("http://localhost/auth/method", {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ method: "none" }),
});

if (
  statusBody.method !== "shared"
  || statusBody.login?.password !== true
  || statusBody.username_field !== false
  || storedLogin.status !== 401
  || environmentLogin.status !== 200
  || methodChange.status !== 409
) throw new Error("environment authentication policy assertion failed");

// The parent test needs only a completion marker. Keep response fields local to
// this process so security scanners and captured CI output never treat an auth
// capability field as logged credential material.
console.log("RESULT ok");
