import type { Context, Hono } from "hono";
import { database } from "../database";
import { childLocalOnly } from "../childTime";
import { cancelAutoDownloadIfUnwanted } from "../downloader";
import { refreshDiscoveryInBackground } from "../plugins";
import { searchYouTube } from "../youtube";
import { feedSortSql } from "../feedQuery";
import { buildCleanupWhere, countCleanupMatches, listCleanupVideoIds, snapshotUserVideoState, applyCleanupAction, restoreUserVideoState, saveBulkUndo, loadBulkUndo, clearBulkUndo, type CleanupFilter } from "../cleanup";
import { videoSelect, type VideoRow } from "../videoRoutesSupport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;
type AttachWatchedState = typeof import("../videoRoutesSupport").attachWatchedState;

export function registerLibraryRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    attachTags: (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;
    attachWatchedState: AttachWatchedState;
  },
): void {
  const { currentUserId, attachTags, attachWatchedState } = access;

// ---------- feed cleanup ----------
// "clean" previews/counts what the filter would affect; "remain" previews what
// the feed would still look like afterwards. Both share buildCleanupWhere with
// GET /feed's own visibility rules, so what's shown here can never drift from
// what /cleanup/apply actually touches.
const CLEANUP_PAGE_SIZE = 24;

api.post("/cleanup/preview", async (c) => {
  const uid = currentUserId(c);
  const body = await c.req.json() as { filter?: CleanupFilter; exclude_video_ids?: string[]; side?: "clean" | "remain"; page?: number };
  const filter = body.filter ?? {};
  const excludeIds = body.exclude_video_ids ?? [];
  const side = body.side === "remain" ? "remain" : "clean";
  const page = Math.max(0, Number(body.page ?? 0));

  const { where, params } = buildCleanupWhere(filter, uid, side, excludeIds);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await database
    .prepare(`${videoSelect(uid)} ${whereSql} ORDER BY ${feedSortSql()} DESC LIMIT ? OFFSET ?`)
    .all(...params, CLEANUP_PAGE_SIZE, page * CLEANUP_PAGE_SIZE) as VideoRow[];
  const total = await countCleanupMatches(filter, uid, side, excludeIds);
  return c.json({ videos: await attachTags(uid, rows), total, page, limit: CLEANUP_PAGE_SIZE });
});

api.post("/cleanup/apply", async (c) => {
  const uid = currentUserId(c);
  const body = await c.req.json() as { filter?: CleanupFilter; exclude_video_ids?: string[]; action?: "archive" | "watched" };
  const filter = body.filter ?? {};
  const excludeIds = body.exclude_video_ids ?? [];
  if (body.action !== "archive" && body.action !== "watched") return c.json({ error: "invalid action" }, 400);

  const videoIds = await listCleanupVideoIds(filter, uid, excludeIds);
  if (videoIds.length === 0) return c.json({ affected: 0 });

  const snapshot = await snapshotUserVideoState(uid, videoIds);
  await applyCleanupAction(uid, videoIds, body.action);
  // Both outcomes end in status=archived, so a pending auto download nobody
  // will see anymore should stop the same way a single reject/watch does.
  for (const id of videoIds) await cancelAutoDownloadIfUnwanted(uid, id);
  await saveBulkUndo(uid, body.action, snapshot);
  refreshDiscoveryInBackground(uid);
  return c.json({ affected: videoIds.length });
});

api.post("/cleanup/undo", async (c) => {
  const uid = currentUserId(c);
  const entry = await loadBulkUndo(uid);
  if (!entry) return c.json({ error: "nothing to undo" }, 404);
  await restoreUserVideoState(uid, entry.snapshot);
  await clearBulkUndo(uid);
  refreshDiscoveryInBackground(uid);
  return c.json({ restored: entry.count });
});

api.get("/in-progress", async (c) => {
  const uid = currentUserId(c);
  const rows = await database.prepare(`
    ${videoSelect(uid)}
    JOIN (SELECT video_id, MAX(watched_at) AS last_watched FROM history WHERE user_id = ${uid} GROUP BY video_id) lw ON lw.video_id = v.video_id
    WHERE v.published_at IS NOT NULL AND v.published_at != ''
      AND uv.watch_position IS NOT NULL AND uv.watch_duration IS NOT NULL
      AND uv.watch_duration > 30
      AND uv.watch_position >= 3
      AND CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92
      AND COALESCE(uv.status, 'inbox') = 'inbox'
    ORDER BY lw.last_watched DESC
    LIMIT 20
  `).all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

api.get("/search/youtube", async (c) => {
  const uid = currentUserId(c);
  // Restricted child profiles search only the local library.
  if (childLocalOnly(uid)) return c.json({ results: [] });
  const q = c.req.query("q");
  if (!q?.trim()) return c.json({ results: [] });
  try {
    const search = await searchYouTube(q.trim());
    return c.json({
      results: await attachWatchedState(uid, search.results, (result) => result.videoId),
      channels: search.channels,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

}
