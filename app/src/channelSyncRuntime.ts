import { publishAppEvent, publishAppEventForUser } from "./appEvents";
import { createChannelSyncJobManager, type ChannelSyncJobTarget } from "./channelSyncJobs";
import { beginMutation } from "./maintenance";

type SyncChannel = (channelId: string) => Promise<{ added: number; rateLimited?: boolean }>;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

let syncChannelImplementation: SyncChannel | null = null;
const channelSyncJobs = createChannelSyncJobManager({
  syncChannel: (channelId) => {
    if (!syncChannelImplementation) throw new Error("channel sync implementation unavailable");
    return syncChannelImplementation(channelId);
  },
  beginMutation,
  publish: (userId) => publishAppEventForUser("channel-sync", userId),
  publishBusy: () => publishAppEvent("channel-sync"),
  sleep: (milliseconds) => Bun.sleep(milliseconds),
  delayMs: positiveNumber(process.env.CHANNEL_SYNC_BATCH_DELAY_MS, 5_000),
});

export function startChannelSyncJob(userId: number, targets: readonly ChannelSyncJobTarget[], syncChannel: SyncChannel) {
  const previousImplementation = syncChannelImplementation;
  syncChannelImplementation = syncChannel;
  try {
    return channelSyncJobs.start(userId, targets);
  } catch (error) {
    syncChannelImplementation = previousImplementation;
    throw error;
  }
}

export function getChannelSyncJob(userId: number) {
  return channelSyncJobs.current(userId);
}

export function channelSyncJobIsRunning(): boolean {
  return channelSyncJobs.isRunning();
}
