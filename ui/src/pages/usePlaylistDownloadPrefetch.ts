import { useEffect, useRef } from "react";
import { api } from "../api";
import type { PlaybackQueueContext } from "../playbackQueue";

export function playlistPrefetchVideoId(playlistId: string | undefined, routeNextVideoId: string | undefined, queue: PlaybackQueueContext | null, queueNextVideoId: string | undefined) {
  if (playlistId) return routeNextVideoId ?? null;
  return queue?.kind === "user-playlist" || queue?.kind === "channel-playlist" ? queueNextVideoId ?? null : null;
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
    if (!enabled || !nextVideoId || nextVideoId === requestedRef.current) return;
    requestedRef.current = nextVideoId;
    api.requestDownload(nextVideoId).catch(() => {});
  }, [enabled, playlistId, queue?.kind, queueNextVideoId, routeNextVideoId]);
}
