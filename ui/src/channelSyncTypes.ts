export type ChannelSyncChannelStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface ChannelSyncJobChannel {
  channelId: string;
  title: string;
  status: ChannelSyncChannelStatus;
  added: number;
  error?: string;
}

export interface ChannelSyncJob {
  id: string;
  sequence: number;
  userId: number;
  revision: number;
  status: "running" | "completed" | "halted";
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
  channels: ChannelSyncJobChannel[];
}
