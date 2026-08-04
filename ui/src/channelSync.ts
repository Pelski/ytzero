import type { Channel, ChannelSyncJob } from "./api";

export function channelCanSync(channel: Pick<Channel, "manual_status">): boolean {
  return (channel.manual_status ?? "active") === "active";
}

export function isChannelSyncRateLimitMessage(message: string | undefined): boolean {
  return Boolean(message && /(?:\b429\b|rate.?limit|too many requests|not a bot)/i.test(message));
}

export function initialChannelSyncSelection(channels: readonly Channel[], requested?: readonly string[]): string[] {
  const eligible = channels.filter(channelCanSync).map((channel) => channel.channel_id);
  if (requested === undefined) return eligible;
  const eligibleSet = new Set(eligible);
  return [...new Set(requested.filter((channelId) => eligibleSet.has(channelId)))];
}

export function filterChannelSyncChoices(channels: readonly Channel[], query: string, locale?: string): Channel[] {
  const normalized = query.trim().toLocaleLowerCase(locale);
  if (!normalized) return [...channels];
  return channels.filter((channel) => [channel.title, channel.handle, channel.channel_id]
    .some((value) => value?.toLocaleLowerCase(locale).includes(normalized)));
}

/** Keep SSE-triggered GET responses from moving a visible job backwards. */
export function newestChannelSyncJob(current: ChannelSyncJob | null, incoming: ChannelSyncJob | null): ChannelSyncJob | null {
  if (!incoming) return null;
  if (!current) return incoming;
  if (current.id === incoming.id) return incoming.revision >= current.revision ? incoming : current;
  if (incoming.sequence !== current.sequence) return incoming.sequence > current.sequence ? incoming : current;

  const currentStarted = Date.parse(current.startedAt);
  const incomingStarted = Date.parse(incoming.startedAt);
  if (Number.isFinite(currentStarted) && Number.isFinite(incomingStarted) && incomingStarted < currentStarted) return current;
  return incoming;
}

export function mergeChannelSyncResponse(current: ChannelSyncJob | null, incoming: ChannelSyncJob | null, request: number, minimumNullRequest: number): ChannelSyncJob | null {
  return incoming === null && request < minimumNullRequest ? current : newestChannelSyncJob(current, incoming);
}
