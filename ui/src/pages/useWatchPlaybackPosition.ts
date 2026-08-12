import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Video } from "../api";
import type { WatchPlayerHandle } from "../playerHandle";
import type { PlayerKind } from "./watchPlayerMode";
import { ownedWatchPosition, resolveWatchPlaybackStart, resolveWatchStartSeconds } from "./watchAudioMode";

export function useWatchPlaybackPosition({
  audioActive,
  id,
  membersOnlyNotice,
  playerKind,
  playerRef,
  privateVideoNotice,
  sharedStartSeconds,
  video,
}: {
  audioActive: boolean;
  id: string | undefined;
  membersOnlyNotice: boolean;
  playerKind: PlayerKind;
  playerRef: RefObject<WatchPlayerHandle | null>;
  privateVideoNotice: boolean;
  sharedStartSeconds: number;
  video: Video | null;
}) {
  const streamPositionRef = useRef(0);
  const progressRef = useRef<{ position: number; duration: number } | null>(null);
  const playbackPositionVideoIdRef = useRef<string | null>(null);
  const appliedSharedTargetRef = useRef<{ videoId: string | null; seconds: number }>({ videoId: null, seconds: 0 });
  const sharedTargetChanged = sharedStartSeconds > 0 && (
    appliedSharedTargetRef.current.videoId !== (id ?? null)
    || appliedSharedTargetRef.current.seconds !== sharedStartSeconds
  );
  const matchingVideo = video?.video_id === id ? video : null;
  const livePlayback = matchingVideo?.live_status === "live" || matchingVideo?.live_status === "upcoming";
  const savedStartSeconds = !livePlayback && matchingVideo?.watch_position && matchingVideo.watch_duration && matchingVideo.watch_duration > 0
    && matchingVideo.watch_position / matchingVideo.watch_duration < 0.9
    ? Math.floor(matchingVideo.watch_position) : 0;
  const capturedStartSeconds = livePlayback ? 0 : resolveWatchStartSeconds(
    ownedWatchPosition(id, playbackPositionVideoIdRef.current, streamPositionRef.current),
    ownedWatchPosition(id, playbackPositionVideoIdRef.current, progressRef.current?.position),
  );
  const playbackStartSeconds = livePlayback ? 0 : resolveWatchPlaybackStart({
    capturedPosition: capturedStartSeconds,
    savedPosition: savedStartSeconds,
    sharedTargetChanged,
    sharedTargetSeconds: sharedStartSeconds,
  });
  const capturePlaybackPosition = useCallback(() => {
    if (!id || livePlayback) return;
    const player = playerRef.current;
    const position = Number(player?.getCurrentTime?.());
    const duration = Number(player?.getDuration?.());
    if (!Number.isFinite(position) || position < 0) return;
    playbackPositionVideoIdRef.current = id;
    streamPositionRef.current = position;
    if (Number.isFinite(duration) && duration > 0) progressRef.current = { position, duration };
  }, [id, livePlayback, playerRef]);

  useEffect(() => {
    playbackPositionVideoIdRef.current = id ?? null;
    streamPositionRef.current = 0;
    progressRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!id || video?.video_id !== id || membersOnlyNotice || privateVideoNotice) return;
    if (!audioActive && playerKind !== "local" && playerKind !== "stream" && playerKind !== "youtube") return;
    appliedSharedTargetRef.current = { videoId: id, seconds: sharedStartSeconds };
  }, [audioActive, id, membersOnlyNotice, playerKind, privateVideoNotice, sharedStartSeconds, video?.video_id]);

  return {
    capturePlaybackPosition,
    playbackPositionVideoIdRef,
    playbackStartSeconds,
    progressRef,
    streamPositionRef,
  };
}
