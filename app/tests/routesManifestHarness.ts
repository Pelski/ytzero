import { createHash } from "node:crypto";

const { api } = await import("../src/routes");
const { db } = await import("../src/db");

const routes = api.routes
  .filter((route) => route.method !== "ALL")
  .map((route) => `${route.method} ${route.path}`);

console.log("RESULT " + JSON.stringify({
  routes,
  sha256: createHash("sha256").update(routes.join("\n")).digest("hex"),
}));
db.close();
