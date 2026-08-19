import type { Context, Hono } from "hono";
import { publishAppEvent } from "../appEvents";
import { ytdlpStatus } from "../downloadConfig";
import { setYtdlpUpdateConfig, ytdlpSelfUpdate } from "../ytdlpUpdater";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type ApiContext = Context<ApiEnvironment>;

export function registerYtdlpUpdateRoutes(api: Hono<ApiEnvironment>, isAdmin: (context: ApiContext) => boolean): void {
  api.put("/downloads/ytdlp/config", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "administrator setting" }, 403);
    try {
      const body = await c.req.json<{ update_channel?: unknown; update_interval_days?: unknown }>();
      const config = await setYtdlpUpdateConfig(body.update_channel, body.update_interval_days);
      return c.json({ version: await ytdlpStatus(), update_channel: config.channel, update_interval_days: config.interval_days });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  api.post("/downloads/ytdlp/update", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "administrator setting" }, 403);
    try {
      const result = await ytdlpSelfUpdate({ force: true });
      publishAppEvent("downloads", { ytdlp: true });
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  });
}
