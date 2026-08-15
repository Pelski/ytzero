import type { Video } from "./apiTypes";
import type { PlaybackQueueContext } from "./playbackQueue";

export type PlaybackEndAction = "stop" | "offer" | "advance";

export function isContinuousPlaylistQueue(
  queue: PlaybackQueueContext | null,
): queue is Extract<PlaybackQueueContext, { kind: "user-playlist" | "channel-playlist" }> {
  return queue?.kind === "user-playlist" || queue?.kind === "channel-playlist";
}

export function playbackEndAction(
  queue: PlaybackQueueContext | null,
  hasNext: boolean,
  feedAutoplayEnabled: boolean,
): PlaybackEndAction {
  if (!hasNext) return "stop";
  if (isContinuousPlaylistQueue(queue)) return "advance";
  return feedAutoplayEnabled ? "offer" : "stop";
}

/**
 * Continue after the furthest completed or explicitly skipped item in the
 * currently displayed order. Unhandled gaps before that frontier were
 * deliberately passed over and should not pull a long playlist backwards when
 * the listener returns.
 */
export function playlistContinueTarget<T extends Pick<Video, "status" | "watched">>(videos: readonly T[]): T | null {
  for (let index = videos.length - 1; index >= 0; index--) {
    if (videos[index].watched === 1 || videos[index].status === "archived") return videos[index + 1] ?? null;
  }
  return null;
}

export function videosInPlaylistOrder<T extends Pick<Video, "video_id">>(videos: readonly T[], order: readonly string[]): T[] {
  const byId = new Map(videos.map((video) => [video.video_id, video]));
  const seen = new Set<string>();
  const ordered = order.flatMap((videoId) => {
    const video = byId.get(videoId);
    if (!video || seen.has(videoId)) return [];
    seen.add(videoId);
    return [video];
  });
  return [...ordered, ...videos.filter((video) => !seen.has(video.video_id))];
}
