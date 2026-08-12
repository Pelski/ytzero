import type { Context, Hono } from "hono";
import {
  saveTubeArchivistConfig,
  scheduleTubeArchivistSync,
  syncTubeArchivist,
  testTubeArchivistConnection,
  tubeArchivistResource,
  tubeArchivistStatus,
} from "../tubeArchivist";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerTubeArchivistRoutes(api: Api, isAdmin: (context: ApiContext) => boolean): void {
  api.get("/plugins/tubearchivist/config", async (c) => c.json(await tubeArchivistStatus()));

  api.put("/plugins/tubearchivist/config", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
    try {
      const body = await c.req.json().catch(() => ({}));
      saveTubeArchivistConfig({ baseUrl: body.baseUrl, token: body.token, clearToken: body.clearToken === true });
      scheduleTubeArchivistSync(true);
      return c.json(await tubeArchivistStatus());
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error), code: "tubearchivist_invalid_config" }, 400);
    }
  });

  api.post("/plugins/tubearchivist/test", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
    try {
      return c.json({ ok: true, ...(await testTubeArchivistConnection()) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error), code: "tubearchivist_connection_failed" }, 424);
    }
  });

  api.post("/plugins/tubearchivist/sync", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
    try {
      return c.json({ ok: true, ...(await syncTubeArchivist()) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error), code: "tubearchivist_sync_failed" }, 424);
    }
  });

  api.get("/plugins/tubearchivist/thumbnail/:id", async (c) => {
    const response = await tubeArchivistResource(c.req.param("id"), "thumbnail", undefined, c.req.raw.signal);
    return response ?? c.body(null, 404);
  });
}
