const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2;
const PLAYBACK_RATE_STEP = 0.25;

export function playbackSpeedDirection(key: string): -1 | 1 | null {
  if (key === "<") return -1;
  if (key === ">") return 1;
  return null;
}

export function stepPlaybackRate(current: number, direction: -1 | 1): number {
  const safeCurrent = Number.isFinite(current) ? current : 1;
  const stepped = Math.round((safeCurrent + direction * PLAYBACK_RATE_STEP) / PLAYBACK_RATE_STEP) * PLAYBACK_RATE_STEP;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, stepped));
}
