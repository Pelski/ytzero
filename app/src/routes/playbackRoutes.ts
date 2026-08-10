import type { Context, Hono } from "hono";
import { database } from "../database";
import { parsePlaybackContext, playbackContextBelongsToUser } from "../playbackContext";
import { resolveAdjacentPlaybackVideoId } from "../playbackAdjacent";
import { videoExistsStmt } from "../videoRoutesSupport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

const contextOwnedBy = (context: Parameters<typeof playbackContextBelongsToUser>[0], userId: number) =>
  playbackContextBelongsToUser(context, userId, (sql, ...params) => database.prepare(sql).get(...params));

export async function savePlaybackContext(userId: number, videoId: string, value: unknown): Promise<void> {
  const context = parsePlaybackContext(value);
  if (context && await contextOwnedBy(context, userId)) {
    await database.prepare(
      `INSERT INTO user_videos (user_id, video_id, playback_context_json) VALUES (?, ?, ?)
       ON CONFLICT(user_id, video_id) DO UPDATE SET playback_context_json=excluded.playback_context_json`
    ).run(userId, videoId, JSON.stringify(context));
    return;
  }
  await database.prepare("UPDATE user_videos SET playback_context_json=NULL WHERE user_id=? AND video_id=?").run(userId, videoId);
}

export function registerPlaybackRoutes(api: Api, currentUserId: (context: ApiContext) => number): void {
  api.post("/playback/adjacent", async (c) => {
    const uid = currentUserId(c);
    const body = await c.req.json().catch(() => ({})) as { video_id?: unknown; direction?: unknown; context?: unknown };
    if (typeof body.video_id !== "string" || !await videoExistsStmt.get(body.video_id)) return c.json({ video_id: null });
    const context = parsePlaybackContext(body.context);
    if (!context || !await contextOwnedBy(context, uid)) return c.json({ video_id: null });
    const direction = body.direction === "oldest" ? "oldest" : "newest";
    return c.json({ video_id: await resolveAdjacentPlaybackVideoId(uid, body.video_id, context, direction) });
  });
}
