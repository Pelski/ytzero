import type { Context, Hono } from "hono";
import { ChannelSyncJobConflictError } from "../channelSyncJobs";
import { channelSyncJobIsRunning, getChannelSyncJob, startChannelSyncJob } from "../channelSyncRuntime";
import { database } from "../database";
import { channelFullSyncIsRunning, feedRefreshIsRunning, liveStatusRefreshIsRunning, syncChannel } from "../refresher";
import { log } from "../logger";
import { scheduledSyncIsRunning } from "../scheduledSync";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

async function channelSyncIsDisabled(channelId: string): Promise<boolean> {
  const row = await database.prepare("SELECT manual_status FROM channels WHERE channel_id=?").get(channelId) as { manual_status: string } | null;
  return Boolean(row && row.manual_status !== "active");
}

export function registerChannelSyncRoutes(api: Api, currentUserId: (context: ApiContext) => number): void {
  // Full channel scans are intentionally asynchronous: even one channel can
  // visit dozens of playlist/video pages and exceed the HTTP idle timeout.
  api.get("/channels/sync", (c) => c.json({ job: getChannelSyncJob(currentUserId(c)), busy: channelSyncJobIsRunning() }));

  api.post("/channels/sync", async (c) => {
    const uid = currentUserId(c);
    const body = await c.req.json<{ channel_ids?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.channel_ids)) return c.json({ error: "channel_ids must be an array" }, 400);
    if (body.channel_ids.some((channelId) => typeof channelId !== "string" || !channelId.trim())) {
      return c.json({ error: "channel_ids must contain non-empty strings" }, 400);
    }
    const channelIds = [...new Set(body.channel_ids.map((channelId) => (channelId as string).trim()))];
    if (channelIds.length === 0) return c.json({ error: "at least one channel is required" }, 400);

    // Revalidate the selection for the active profile. Channel data is shared
    // globally, but a profile may only bulk-sync its own current subscriptions.
    const followed = await database.prepare(`
      SELECT c.channel_id, COALESCE(c.custom_title, c.title, c.channel_id) AS title,
             c.manual_status, c.external
      FROM channels c
      JOIN user_channels uc ON uc.channel_id = c.channel_id
      WHERE uc.user_id = ? AND uc.followed = 1
    `).all(uid) as { channel_id: string; title: string; manual_status: string; external: number }[];
    const followedById = new Map(followed.map((channel) => [channel.channel_id, channel]));
    if (channelIds.some((channelId) => !followedById.has(channelId) || followedById.get(channelId)!.external !== 0)) {
      return c.json({ error: "all channels must be followed by the active profile" }, 400);
    }
    if (channelIds.some((channelId) => followedById.get(channelId)!.manual_status !== "active")) {
      return c.json({ error: "channel sync disabled" }, 409);
    }

    try {
      if (feedRefreshIsRunning() || scheduledSyncIsRunning() || channelFullSyncIsRunning() || liveStatusRefreshIsRunning()) throw new ChannelSyncJobConflictError();
      const job = startChannelSyncJob(uid, channelIds.map((channelId) => ({
        channelId,
        title: followedById.get(channelId)!.title || channelId,
      })), syncChannel);
      log.info("channel.sync_job_started", { jobId: job.id, userId: uid, channels: job.total });
      return c.json({ job }, 202);
    } catch (error) {
      if (error instanceof ChannelSyncJobConflictError) {
        return c.json({ error: error.message, job: getChannelSyncJob(uid) }, 409);
      }
      log.error("channel.sync_job_start_failed", { userId: uid, error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "could not start channel sync" }, 500);
    }
  });

}

export function registerSingleChannelSyncRoute(api: Api, currentUserId: (context: ApiContext) => number): void {
  api.post("/channels/:id/sync", async (c) => {
    const channelId = c.req.param("id");
    if (await channelSyncIsDisabled(channelId)) return c.json({ error: "channel sync disabled" }, 409);
    try {
      if (channelSyncJobIsRunning() || feedRefreshIsRunning() || scheduledSyncIsRunning() || channelFullSyncIsRunning() || liveStatusRefreshIsRunning()) {
        throw new ChannelSyncJobConflictError();
      }
      const channel = await database.prepare("SELECT COALESCE(custom_title, title, channel_id) AS title FROM channels WHERE channel_id = ?").get(channelId) as { title: string } | null;
      const job = startChannelSyncJob(currentUserId(c), [{ channelId, title: channel?.title || channelId }], syncChannel);
      log.info("channel.sync_job_started", { jobId: job.id, userId: currentUserId(c), channels: 1 });
      return c.json({ job }, 202);
    } catch (error) {
      if (error instanceof ChannelSyncJobConflictError) return c.json({ error: error.message }, 409);
      log.error("channel.sync_job_start_failed", { channelId, error: error instanceof Error ? error.message : String(error) });
      return c.json({ error: "could not start channel sync" }, 500);
    }
  });
}
