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

console.log("RESULT " + JSON.stringify({
  method: statusBody.method,
  passwordConfigured: statusBody.login.password,
  usernameField: statusBody.username_field,
  storedLoginStatus: storedLogin.status,
  environmentLoginStatus: environmentLogin.status,
  methodChangeStatus: methodChange.status,
}));
