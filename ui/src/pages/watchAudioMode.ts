import type { PlayerKind } from "./watchPlayerMode";

const AUDIO_PLAYER_KINDS = new Set<PlayerKind>(["stream", "local", "waiting", "choice", "youtube"]);

export function canUseWatchAudioMode({
  childProfile,
  hasVideo,
  liveStatus,
  membersOnly,
  playerKind,
  privateVideo,
  watchTogetherRoomId,
}: {
  childProfile: boolean;
  hasVideo: boolean;
  liveStatus: string;
  membersOnly: boolean;
  playerKind: PlayerKind;
  privateVideo: boolean;
  watchTogetherRoomId: string | null;
}): boolean {
  return hasVideo
    && !childProfile
    && liveStatus !== "upcoming"
    && !membersOnly
    && !privateVideo
    && !watchTogetherRoomId
    && AUDIO_PLAYER_KINDS.has(playerKind);
}

export function resolveWatchStartSeconds(...candidates: Array<number | null | undefined>): number {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return Math.floor(candidate);
  }
  return 0;
}

export function resolveWatchPlaybackStart({
  capturedPosition,
  savedPosition,
  sharedTargetChanged,
  sharedTargetSeconds,
}: {
  capturedPosition: number;
  savedPosition: number;
  sharedTargetChanged: boolean;
  sharedTargetSeconds: number;
}): number {
  return sharedTargetChanged
    ? resolveWatchStartSeconds(sharedTargetSeconds, capturedPosition, savedPosition)
    : resolveWatchStartSeconds(capturedPosition, sharedTargetSeconds, savedPosition);
}

export function ownedWatchPosition(
  currentVideoId: string | undefined,
  positionVideoId: string | null,
  position: number | null | undefined,
): number {
  return currentVideoId && currentVideoId === positionVideoId && typeof position === "number" ? position : 0;
}
