export interface AudioVideoState {
  live_status: string;
  is_private: number;
  members_only: number;
}

export function audioVideoIsEligible(video: AudioVideoState): boolean {
  return video.is_private !== 1
    && video.members_only !== 1
    && video.live_status !== "live"
    && video.live_status !== "upcoming";
}

export function liveAudioVideoIsEligible(video: AudioVideoState): boolean {
  return video.is_private !== 1
    && video.members_only !== 1
    && video.live_status === "live";
}
