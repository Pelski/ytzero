import type { SocialWatchPartyMessage, SocialWatchPartyPlayback } from "./api";

export interface WatchPartyPlaybackDraft {
  position: number;
  paused: boolean;
  playback_rate: number;
}

/** YouTube advances the shared timeline only in PLAYING (1), not BUFFERING (3). */
export function watchPartyPlayerStatePaused(state: unknown, fallback: boolean): boolean {
  const numericState = Number(state);
  return Number.isFinite(numericState) ? numericState !== 1 : fallback;
}

/**
 * Project from the local receipt time, not from the server epoch. Device clocks
 * can differ by minutes even though their local monotonic elapsed time is sound.
 */
export function projectWatchPartyPosition(
  playback: SocialWatchPartyPlayback,
  receivedAt: number,
  now = performance.now(),
): number {
  const position = Number.isFinite(playback.position) ? Math.max(0, playback.position) : 0;
  if (playback.paused) return position;
  const elapsed = Math.max(0, now - receivedAt) / 1_000;
  return position + elapsed * playback.playback_rate;
}

export function watchPartyPlaybackNeedsCorrection(input: {
  current: WatchPartyPlaybackDraft;
  incoming: SocialWatchPartyPlayback;
  lastAppliedRevision: number;
  receivedAt: number;
  now?: number;
  driftThreshold?: number;
  /** Re-check an already applied revision after a local transport attempt. */
  enforceCurrentRevision?: boolean;
}): boolean {
  if (!input.enforceCurrentRevision && input.incoming.revision <= input.lastAppliedRevision) return false;
  if (input.current.paused !== input.incoming.paused) return true;
  if (Math.abs(input.current.playback_rate - input.incoming.playback_rate) > 0.01) return true;
  const target = projectWatchPartyPosition(input.incoming, input.receivedAt, input.now);
  return Math.abs(input.current.position - target) > (input.driftThreshold ?? 1.25);
}

export function shouldPublishWatchPartyPlayback(input: {
  current: WatchPartyPlaybackDraft;
  previous: WatchPartyPlaybackDraft | null;
  previousSentAt: number;
  now?: number;
  checkpointMs?: number;
  seekThreshold?: number;
}): boolean {
  if (!input.previous) return true;
  const now = input.now ?? Date.now();
  if (input.current.paused !== input.previous.paused) return true;
  if (Math.abs(input.current.playback_rate - input.previous.playback_rate) > 0.01) return true;
  const expected = input.previous.paused
    ? input.previous.position
    : input.previous.position + Math.max(0, now - input.previousSentAt) / 1_000 * input.previous.playback_rate;
  if (Math.abs(input.current.position - expected) > (input.seekThreshold ?? 1.25)) return true;
  return now - input.previousSentAt >= (input.checkpointMs ?? 4_000);
}

export function mergeWatchPartyMessages(
  current: readonly SocialWatchPartyMessage[],
  incoming: readonly SocialWatchPartyMessage[],
  limit = 200,
): SocialWatchPartyMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()]
    .sort((left, right) => left.sequence - right.sequence || left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))
    .slice(-Math.max(1, limit));
}
