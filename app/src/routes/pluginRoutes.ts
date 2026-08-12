import type { Context, Hono } from "hono";
import { getUserSetting } from "../db";
import {
  getPluginSettings,
  listPlugins,
  pluginAdminSettingKeys,
  resetPluginState,
  setPluginEnabled,
  setPluginSettings,
} from "../plugins";
import { registerTubeArchivistRoutes } from "./tubeArchivistRoutes";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerPluginRoutes(
  api: Api,
  access: {
    isAdmin: (context: ApiContext) => boolean;
    currentUserId: (context: ApiContext) => number;
  },
): void {
  const { isAdmin, currentUserId } = access;

// ---------- built-in plugins ----------

api.get("/plugins", async (c) => {
  const uid = currentUserId(c);
  return c.json({ plugins: await listPlugins(getUserSetting(uid, "language")) });
});

api.put("/plugins/:id", async (c) => {
  const { enabled } = await c.req.json() as { enabled?: boolean };
  try {
    const pluginId = c.req.param("id");
    await setPluginEnabled(pluginId, !!enabled);
    return c.json({ plugins: await listPlugins(getUserSetting(currentUserId(c), "language")) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.get("/plugins/:id/settings", async (c) => {
  try {
    const uid = currentUserId(c);
    return c.json(await getPluginSettings(uid, c.req.param("id"), getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.put("/plugins/:id/settings", async (c) => {
  try {
    const uid = currentUserId(c);
    const body = await c.req.json();
    if (!isAdmin(c) && body && typeof body === "object" && Object.keys(body).some((key) => pluginAdminSettingKeys(c.req.param("id")).has(key))) {
      return c.json({ error: "administrator setting" }, 403);
    }
    return c.json(await setPluginSettings(uid, c.req.param("id"), body, getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

api.post("/plugins/:id/reset", async (c) => {
  try {
    const uid = currentUserId(c);
    if (c.req.param("id") === "social" && !isAdmin(c)) return c.json({ error: "admin only" }, 403);
    return c.json(await resetPluginState(uid, c.req.param("id"), getUserSetting(uid, "language")));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

registerTubeArchivistRoutes(api, isAdmin);
}
