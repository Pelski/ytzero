import { syncNextChannelPosts } from "./channelPostsStore";
import { log } from "./logger";

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function startChannelPostsScheduler(): void {
  const intervalMin = positiveNumber(process.env.POSTS_SYNC_INTERVAL_MINUTES, 10);
  const maxAgeMin = positiveNumber(process.env.POSTS_SYNC_MAX_AGE_MINUTES, 6 * 60);
  const run = () => {
    syncNextChannelPosts(maxAgeMin)
      .catch((error) => log.error("channel.posts_sync.cron_failed", { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => setTimeout(run, intervalMin * 60_000));
  };
  setTimeout(run, 150_000);
  log.info("scheduler.channel_posts_sync", { intervalMin, maxAgeMin, batchSize: 1 });
}
