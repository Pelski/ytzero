import type { Video } from "./api";

export type PlaybackQueueContext =
  | { kind: "feed"; tags: number[]; showAll: boolean; sort: "published" | "arrival" }
  | { kind: "snapshot"; videoIds: string[]; label: string };

export type PlayVideo = (video: Video, queue?: PlaybackQueueContext) => void;

export function snapshotPlaybackQueue(videos: readonly Video[], label: string): PlaybackQueueContext {
  return { kind: "snapshot", videoIds: videos.map((video) => video.video_id), label };
}

export function nextSnapshotVideoId(
  queue: Extract<PlaybackQueueContext, { kind: "snapshot" }>,
  currentVideoId: string,
  direction: "oldest" | "newest",
): string | null {
  const index = queue.videoIds.indexOf(currentVideoId);
  if (index < 0) return null;
  return queue.videoIds[index + (direction === "newest" ? 1 : -1)] ?? null;
}

export function isPlaybackQueueContext(value: unknown): value is PlaybackQueueContext {
  if (!value || typeof value !== "object") return false;
  const queue = value as Partial<PlaybackQueueContext>;
  if (queue.kind === "feed") return Array.isArray(queue.tags) && (queue.sort === "published" || queue.sort === "arrival");
  return queue.kind === "snapshot" && Array.isArray(queue.videoIds) && queue.videoIds.every((id) => typeof id === "string");
}
