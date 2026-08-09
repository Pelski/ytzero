export interface VolumeControlledMedia {
  volume: number;
}

/**
 * Keep the media element aligned with the volume owned by the custom player.
 * Some browsers or media pipelines can change HTMLMediaElement.volume while
 * seeking or switching buffered media without moving a custom range input.
 */
export function enforceLocalPlayerVolume(media: VolumeControlledMedia, desiredVolume: number): boolean {
  const volume = Math.min(1, Math.max(0, desiredVolume));
  if (Math.abs(media.volume - volume) < 0.001) return false;
  media.volume = volume;
  return true;
}
