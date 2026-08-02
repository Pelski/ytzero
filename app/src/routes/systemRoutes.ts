import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { publishAppEvent, subscribeToAppEvents } from "../appEvents";
import { database } from "../database";
import { log, readRecentLogs, subscribeToLogs } from "../logger";
import { checkLatestRelease } from "../updates";
import { COMMIT, VERSION } from "../version";
import { refreshAll } from "../refresher";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerSystemRoutes(
  api: Api,
  access: {
    isAdmin: (context: ApiContext) => boolean;
    currentUserId: (context: ApiContext) => number;
  },
): void {
  const { isAdmin, currentUserId } = access;
api.get("/config", (c) => {
  return c.json({ app_url: process.env.APP_URL ?? "" });
});

api.get("/events", (c) => {
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-transform");
  return streamSSE(c, async (stream) => {
    let stopped = false;
    let id = 1;
    let writes = Promise.resolve();
    const enqueue = (event: string, data: unknown) => {
      if (stopped) return;
      writes = writes.then(() => stream.writeSSE({ event, data: JSON.stringify(data), id: String(id++) }));
    };
    const unsubscribe = subscribeToAppEvents((event) => enqueue("app", event));
    enqueue("ready", {});
    await new Promise<void>((resolveStream) => {
      const heartbeat = setInterval(() => enqueue("ping", { at: Date.now() }), 15_000);
      stream.onAbort(() => {
        stopped = true;
        clearInterval(heartbeat);
        unsubscribe();
        resolveStream();
      });
    });
  });
});

api.post("/refresh", async (c) => {
  const result = await refreshAll({ force: true });
  log.info("refresh.manual_requested", { channels: result.channels, added: result.added, errors: result.errors.length });
  return c.json(result);
});

api.get("/logs", (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 300)));
  return c.json({ ...readRecentLogs(limit), version: VERSION, commit: COMMIT });
});

api.get("/logs/stream", (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 300)));
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-transform");

  return streamSSE(c, async (stream) => {
    let stopped = false;
    let nextEventId = 1;
    let writes = Promise.resolve();
    const enqueue = (event: string, data: unknown) => {
      if (stopped) return;
      writes = writes.then(() => stream.writeSSE({
        event,
        data: JSON.stringify(data),
        id: String(nextEventId++),
      }));
    };

    // Subscribe before the synchronous snapshot read. This closes the gap in
    // which a new log line could otherwise be missed between history and SSE.
    const unsubscribe = subscribeToLogs((entry) => enqueue("log", entry));
    enqueue("snapshot", { ...readRecentLogs(limit), version: VERSION, commit: COMMIT });

    await new Promise<void>((resolveStream) => {
      const heartbeat = setInterval(() => enqueue("ping", { at: Date.now() }), 15_000);
      stream.onAbort(() => {
        stopped = true;
        clearInterval(heartbeat);
        unsubscribe();
        resolveStream();
      });
    });
  });
});

api.get("/version", (c) => isAdmin(c)
  ? c.json({ version: VERSION, commit: COMMIT })
  : c.json({ error: "admin only" }, 403));

api.post("/updates/check", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  try {
    const result = await checkLatestRelease();
    log.info("updates.manual_check", { currentVersion: VERSION, latestVersion: result.latestVersion });
    return c.json(result);
  } catch (error) {
    log.warn("updates.manual_check_failed", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: "GitHub update check failed" }, 502);
  }
});

api.get("/notifications", async (c) => {
  const uid = currentUserId(c);
  const rows = await database.prepare(`
    SELECT id, kind, payload, target, read_at, created_at
    FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30
  `).all(uid) as { id: number; kind: string; payload: string; target: string; read_at: string | null; created_at: string }[];
  const unread = (await database.prepare("SELECT count(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL").get(uid) as { count: number }).count;
  return c.json({ notifications: rows.map((row) => ({ ...row, payload: JSON.parse(row.payload || "{}") })), unread });
});

api.post("/notifications/:id/read", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ? AND user_id = ?").run(Number(c.req.param("id")), uid);
  publishAppEvent("notifications");
  return c.json({ ok: true });
});

api.post("/notifications/read-all", async (c) => {
  await database.prepare("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE user_id = ?").run(currentUserId(c));
  publishAppEvent("notifications");
  return c.json({ ok: true });
});
}
