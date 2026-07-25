export const CHANNEL_MANUAL_STATUSES = ["active", "paused", "broken", "banned", "deleted"] as const;
export type ChannelManualStatus = typeof CHANNEL_MANUAL_STATUSES[number];

export function isChannelManualStatus(value: unknown): value is ChannelManualStatus {
  return typeof value === "string" && (CHANNEL_MANUAL_STATUSES as readonly string[]).includes(value);
}

export function channelSyncEnabled(status: unknown): boolean {
  return status === undefined || status === null || status === "active";
}
