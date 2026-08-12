import { useEffect, type RefObject } from "react";
import type { Video } from "../api";
import { sendPlayerCommand } from "../enhanceBridge";
import { img } from "../img";
import type { WatchPlayerHandle } from "../playerHandle";
import type { PlayerKind } from "./watchPlayerMode";

export function useYouTubeMediaSession({
  audioActive,
  playerKind,
  playerRef,
  video,
  watchTogetherTransportLocked,
}: {
  audioActive: boolean;
  playerKind: PlayerKind;
  playerRef: RefObject<WatchPlayerHandle | null>;
  video: Video | null;
  watchTogetherTransportLocked: boolean;
}) {
  useEffect(() => {
    if (playerKind !== "youtube" || audioActive || !video || !("mediaSession" in navigator)) return;
    const mediaSession = navigator.mediaSession;
    const seekByFallback = (seconds: number) => {
      const player = playerRef.current;
      const current = Number(player?.getCurrentTime?.());
      const duration = Number(player?.getDuration?.());
      if (!Number.isFinite(current)) return;
      player?.seekTo?.(Math.min(Math.max(0, current + seconds), Number.isFinite(duration) ? duration : Infinity), true);
    };
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { mediaSession.setActionHandler(action, handler); } catch {}
    };

    try {
      mediaSession.metadata = new MediaMetadata({
        title: video.title,
        artist: video.channel_title,
        artwork: video.thumbnail ? [{ src: img(video.thumbnail), sizes: "480x360", type: "image/jpeg" }] : [],
      });
    } catch {}
    if (!watchTogetherTransportLocked) {
      setHandler("play", () => {
        void sendPlayerCommand(video.video_id, "play").catch(() => playerRef.current?.playVideo?.());
      });
      setHandler("pause", () => {
        void sendPlayerCommand(video.video_id, "pause").catch(() => playerRef.current?.pauseVideo?.());
      });
      setHandler("seekbackward", (details) => {
        const seconds = -(details.seekOffset ?? 10);
        void sendPlayerCommand(video.video_id, "seek-by", { seconds }).catch(() => seekByFallback(seconds));
      });
      setHandler("seekforward", (details) => {
        const seconds = details.seekOffset ?? 10;
        void sendPlayerCommand(video.video_id, "seek-by", { seconds }).catch(() => seekByFallback(seconds));
      });
      setHandler("seekto", (details) => {
        if (details.seekTime != null) {
          void sendPlayerCommand(video.video_id, "seek-to", { seconds: details.seekTime })
            .catch(() => playerRef.current?.seekTo?.(details.seekTime!, true));
        }
      });
    } else {
      for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto", "stop"] as MediaSessionAction[]) {
        setHandler(action, () => {});
      }
    }

    return () => {
      try {
        mediaSession.metadata = null;
        mediaSession.playbackState = "none";
      } catch {}
      for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto", "stop"] as MediaSessionAction[]) {
        setHandler(action, null);
      }
    };
  }, [audioActive, playerKind, playerRef, video?.video_id, video?.title, video?.channel_title, video?.thumbnail, watchTogetherTransportLocked]);
}
