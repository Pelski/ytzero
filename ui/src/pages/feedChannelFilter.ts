import type { Channel } from "../api";

/** Match the feed's ANY-tag semantics for the channel row. */
export function filterChannelsByTags(channels: Channel[], selectedTags: number[]): Channel[] {
  if (selectedTags.length === 0) return channels;
  const selected = new Set(selectedTags);
  return channels.filter((channel) => channel.tags.some((tag) => selected.has(tag.id)));
}
