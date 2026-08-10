import { useCallback, useEffect, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { api, type Video } from "../api";
import type { PlaybackQueueContext } from "../playbackQueue";

type Direction = "oldest" | "newest";

async function resolveNextVideo(queue: PlaybackQueueContext, videoId: string, direction: Direction) {
  const result = await api.playbackAdjacent(videoId, direction, queue);
  return result.video_id ? api.video(result.video_id).then((videoResult) => ({ video: videoResult.video })) : { video: null };
}

export function useUpNextQueue({ currentVideoId, direction, navigate, queue }: {
  currentVideoId: string | undefined;
  direction: Direction;
  navigate: NavigateFunction;
  queue: PlaybackQueueContext | null;
}) {
  const requestRef = useRef(0);
  const [prefetched, setPrefetched] = useState<Video | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [loadingNext, setLoadingNext] = useState(false);

  useEffect(() => {
    requestRef.current++;
    setLoadingNext(false);
    setPrefetched(null);
    setVideo(null);
    if (!currentVideoId || !queue) return;
    let cancelled = false;
    resolveNextVideo(queue, currentVideoId, direction)
      .then((result) => { if (!cancelled) setPrefetched(result.video); })
      .catch(() => { if (!cancelled) setPrefetched(null); });
    return () => { cancelled = true; };
  }, [currentVideoId, direction, queue]);

  const show = useCallback(() => {
    if (prefetched) setVideo(prefetched);
  }, [prefetched]);

  const playPrefetched = useCallback(() => {
    if (!prefetched) return;
    navigate(`/watch/${prefetched.video_id}`, queue ? { state: { playbackQueue: queue } } : undefined);
  }, [navigate, prefetched, queue]);

  const play = useCallback(() => {
    if (!video) return;
    navigate(`/watch/${video.video_id}`, queue ? { state: { playbackQueue: queue } } : undefined);
  }, [navigate, queue, video]);

  const skip = useCallback(async () => {
    if (!video || !queue || loadingNext) return;
    const requestId = ++requestRef.current;
    setLoadingNext(true);
    try {
      const [result] = await Promise.all([
        resolveNextVideo(queue, video.video_id, direction),
        new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
      ]);
      if (requestId === requestRef.current) setVideo(result.video);
    } catch {
      // Keep the current suggestion when resolving the following item fails.
    } finally {
      if (requestId === requestRef.current) setLoadingNext(false);
    }
  }, [direction, loadingNext, queue, video]);

  const dismiss = useCallback(() => {
    requestRef.current++;
    setLoadingNext(false);
    setVideo(null);
  }, []);

  return { dismiss, hasPrefetched: Boolean(prefetched), loadingNext, play, playPrefetched, prefetched, show, skip, video };
}
