import type { Video } from "../api";

export type RecommendationContent = Pick<Video, "video_id" | "is_short" | "live_status" | "watched" | "status">;

/**
 * The API excludes these formats too, but the page keeps a defensive boundary:
 * a recommendation surface must never flash a Short or any kind of live upload.
 */
export function isEligibleRecommendation(video: RecommendationContent): boolean {
  return video.is_short === 0 && video.live_status === "none" && video.watched !== 1 && video.status === "inbox";
}

/** Preserve the ranking supplied by the backend while removing unsafe formats
 * and duplicates that can occur at a page boundary. */
export function prepareRecommendationVideos<T extends RecommendationContent>(videos: readonly T[]): T[] {
  const seen = new Set<string>();
  return videos.filter((video) => {
    if (!isEligibleRecommendation(video) || seen.has(video.video_id)) return false;
    seen.add(video.video_id);
    return true;
  });
}

export function mergeRecommendationVideos<T extends RecommendationContent>(current: readonly T[], incoming: readonly T[]): T[] {
  return prepareRecommendationVideos([...current, ...incoming]);
}
