import { useEffect, useRef } from "react";
import { api } from "../api";
import type { PlaybackQueueContext } from "../playbackQueue";

export function playlistPrefetchVideoId(playlistId: string | undefined, routeNextVideoId: string | undefined, queue: PlaybackQueueContext | null, queueNextVideoId: string | undefined) {
  if (playlistId) return routeNextVideoId ?? null;
  return queue?.kind === "user-playlist" || queue?.kind === "channel-playlist" ? queueNextVideoId ?? null : null;
}

export function playlistDownloadContext(playlistId: string | undefined, queue: PlaybackQueueContext | null) {
  if (playlistId) return { kind: "channel-playlist" as const, playlistId };
  if (queue?.kind === "user-playlist") return { kind: "user-playlist" as const, playlistUuid: queue.playlistUuid };
  if (queue?.kind === "channel-playlist") return { kind: "channel-playlist" as const, playlistId: queue.playlistId };
  return undefined;
}

export function usePlaylistDownloadPrefetch({ enabled, playlistId, routeNextVideoId, queue, queueNextVideoId }: {
  enabled: boolean;
  playlistId?: string;
  routeNextVideoId?: string;
  queue: PlaybackQueueContext | null;
  queueNextVideoId?: string;
}) {
  const requestedRef = useRef<string | null>(null);
  useEffect(() => {
    const nextVideoId = playlistPrefetchVideoId(playlistId, routeNextVideoId, queue, queueNextVideoId);
    const context = playlistDownloadContext(playlistId, queue);
    const requestKey = nextVideoId && context ? `${context.kind}:${"playlistId" in context ? context.playlistId : context.playlistUuid}:${nextVideoId}` : nextVideoId;
    if (!enabled || !nextVideoId || !requestKey || requestKey === requestedRef.current) return;
    requestedRef.current = requestKey;
    api.requestDownload(nextVideoId, false, false, context).catch(() => {});
  }, [enabled, playlistId, queue, queueNextVideoId, routeNextVideoId]);
}
