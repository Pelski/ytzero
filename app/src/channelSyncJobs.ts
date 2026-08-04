import { isYouTubeRateLimitError } from "./youtubeRateLimit";

export type ChannelSyncJobStatus = "running" | "completed" | "halted";
export type ChannelSyncItemStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface ChannelSyncJobItem {
  channelId: string;
  title: string;
  status: ChannelSyncItemStatus;
  added: number;
  error?: string;
}

export interface ChannelSyncJob {
  id: string;
  sequence: number;
  userId: number;
  revision: number;
  status: ChannelSyncJobStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  added: number;
  currentChannelId: string | null;
  currentChannelTitle: string | null;
  startedAt: string;
  finishedAt: string | null;
  channels: ChannelSyncJobItem[];
}

export interface ChannelSyncJobTarget {
  channelId: string;
  title: string;
}

interface ChannelSyncJobDependencies {
  syncChannel: (channelId: string) => Promise<{ added: number; rateLimited?: boolean }>;
  beginMutation: () => (() => void) | null;
  publish: (userId: number) => void;
  publishBusy?: () => void;
  sleep: (milliseconds: number) => Promise<void>;
  delayMs: number;
  now?: () => Date;
  createId?: () => string;
}

export class ChannelSyncJobConflictError extends Error {
  constructor() {
    super("channel sync already in progress");
    this.name = "ChannelSyncJobConflictError";
  }
}

function snapshot(job: ChannelSyncJob): ChannelSyncJob {
  return {
    ...job,
    channels: job.channels.map((channel) => ({ ...channel })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Transient, process-local coordinator for expensive full channel syncs.
 * The snapshot deliberately is not persisted: a server restart stops the
 * active work, while completed video/channel data remains safely in the DB.
 */
export function createChannelSyncJobManager(dependencies: ChannelSyncJobDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const latestByUser = new Map<number, ChannelSyncJob>();
  let active: ChannelSyncJob | null = null;
  let activeRun: Promise<void> = Promise.resolve();
  let sequence = 0;

  const changed = (job: ChannelSyncJob) => {
    job.revision++;
    dependencies.publish(job.userId);
  };

  const skipPending = (job: ChannelSyncJob, reason: string) => {
    for (const item of job.channels) {
      if (item.status !== "pending") continue;
      item.status = "skipped";
      item.error = reason;
      job.skipped++;
    }
  };

  const finish = (job: ChannelSyncJob, status: Exclude<ChannelSyncJobStatus, "running">) => {
    job.status = status;
    job.currentChannelId = null;
    job.currentChannelTitle = null;
    job.finishedAt = now().toISOString();
    changed(job);
    dependencies.publishBusy?.();
  };

  const run = async (job: ChannelSyncJob) => {
    try {
      for (let index = 0; index < job.channels.length; index++) {
        const item = job.channels[index];
        // A full batch may run for hours. Hold the maintenance lease only for
        // one channel so restore/migration can stop the batch between items
        // instead of waiting for every selected channel to finish.
        const releaseMutation = dependencies.beginMutation();
        if (!releaseMutation) {
          skipPending(job, "maintenance in progress");
          finish(job, "halted");
          return;
        }
        item.status = "running";
        job.currentChannelId = item.channelId;
        job.currentChannelTitle = item.title;
        changed(job);

        let halt = false;
        try {
          const result = await dependencies.syncChannel(item.channelId);
          item.added = Math.max(0, Number(result.added) || 0);
          job.added += item.added;
          if (result.rateLimited) {
            item.status = "failed";
            item.error = "YouTube rate limit (429)";
            job.failed++;
            halt = true;
          } else {
            item.status = "completed";
            job.succeeded++;
          }
        } catch (error) {
          item.status = "failed";
          item.error = errorMessage(error);
          job.failed++;
          halt = isYouTubeRateLimitError(error);
        } finally {
          releaseMutation();
        }
        job.processed++;

        if (halt) {
          skipPending(job, "Skipped after YouTube rate limit");
          finish(job, "halted");
          return;
        }

        job.currentChannelId = null;
        job.currentChannelTitle = null;
        changed(job);
        if (index < job.channels.length - 1 && dependencies.delayMs > 0) {
          await dependencies.sleep(dependencies.delayMs);
        }
      }
      finish(job, "completed");
    } catch (error) {
      skipPending(job, errorMessage(error));
      finish(job, "halted");
    }
  };

  return {
    start(userId: number, targets: readonly ChannelSyncJobTarget[]): ChannelSyncJob {
      if (active?.status === "running") throw new ChannelSyncJobConflictError();
      if (targets.length === 0) throw new Error("at least one channel is required");

      const seen = new Set<string>();
      const channels = targets
        .filter((target) => target.channelId && !seen.has(target.channelId) && seen.add(target.channelId))
        .map((target) => ({ ...target, status: "pending" as const, added: 0 }));
      if (channels.length === 0) throw new Error("at least one channel is required");

      const job: ChannelSyncJob = {
        id: createId(),
        sequence: ++sequence,
        userId,
        revision: 1,
        status: "running",
        total: channels.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        added: 0,
        currentChannelId: null,
        currentChannelTitle: null,
        startedAt: now().toISOString(),
        finishedAt: null,
        channels,
      };
      active = job;
      latestByUser.set(userId, job);
      dependencies.publish(userId);
      dependencies.publishBusy?.();
      activeRun = Promise.resolve()
        .then(() => run(job))
        .finally(() => {
          if (active?.id === job.id) active = null;
        });
      return snapshot(job);
    },

    current(userId: number): ChannelSyncJob | null {
      const job = latestByUser.get(userId);
      return job ? snapshot(job) : null;
    },

    isRunning(): boolean {
      return active?.status === "running";
    },

    async waitForIdle(): Promise<void> {
      await activeRun;
    },
  };
}
