import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { VideoChapter } from "../../api";
import type { EnhancePlayerState } from "../../enhanceBridge";
import type { WatchPlayerHandle } from "../../playerHandle";
import WatchPlayerFeedback from "../../pages/WatchPlayerFeedback";
import { useYouTubeKeyboardShortcuts, type WatchShortcutKind } from "../../pages/useYouTubeKeyboardShortcuts";
import { loadYouTubeApi } from "../../pages/watchRuntime";

const KEYBOARD_SEEK_SECONDS = 5;
const publicPlayerCommand = async () => { throw new Error("public player bridge disabled"); };

const PublicYouTubePlayer = forwardRef<WatchPlayerHandle, {
  chapters: VideoChapter[];
  onEnded?: () => void;
  startSeconds?: number;
  title: string;
  videoId: string;
}>(function PublicYouTubePlayer({ chapters, onEnded, startSeconds = 0, title, videoId }, forwardedRef) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<WatchPlayerHandle | null>(null);
  const enhancePlayerStateRef = useRef<{ state: EnhancePlayerState; updatedAt: number } | null>(null);
  const speedRef = useRef("1");
  const onEndedRef = useRef(onEnded);
  const feedbackTimerRef = useRef<number | null>(null);
  const [feedback, setFeedback] = useState<{ kind: WatchShortcutKind; id: number; seconds?: number; category?: string } | null>(null);
  onEndedRef.current = onEnded;

  useImperativeHandle(forwardedRef, () => ({
    destroy: () => playerRef.current?.destroy(),
    getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
    getDuration: () => playerRef.current?.getDuration() ?? 0,
    getPlaybackRate: () => playerRef.current?.getPlaybackRate() ?? 1,
    getPlayerState: () => playerRef.current?.getPlayerState() ?? -1,
    pauseVideo: () => playerRef.current?.pauseVideo(),
    playVideo: () => playerRef.current?.playVideo(),
    seekTo: (seconds, allowSeekAhead) => playerRef.current?.seekTo(seconds, allowSeekAhead),
    setPlaybackRate: (rate) => playerRef.current?.setPlaybackRate(rate),
  }), []);

  const showFeedback = useCallback((kind: WatchShortcutKind, seconds?: number, category?: string) => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback({ kind, id: Date.now(), seconds, category });
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 1_560);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let destroyed = false;
    let player: WatchPlayerHandle | null = null;
    const iframe = document.createElement("iframe");
    const query = new URLSearchParams({
      enablejsapi: "1",
      origin: window.location.origin,
      playsinline: "1",
      rel: "0",
      start: String(Math.max(0, Math.floor(startSeconds))),
    });
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${query}`;
    iframe.title = title;
    iframe.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "origin";
    mount.replaceChildren(iframe);

    void loadYouTubeApi().then(() => {
      if (destroyed) return;
      const target = window as typeof window & { YT?: { Player: new (element: HTMLIFrameElement, options: Record<string, unknown>) => WatchPlayerHandle } };
      if (!target.YT?.Player) return;
      player = new target.YT.Player(iframe, {
        events: {
          onReady: (event: { target: WatchPlayerHandle }) => { playerRef.current = event.target; },
          onStateChange: (event: { data: number }) => { if (event.data === 0) onEndedRef.current?.(); },
        },
      });
      playerRef.current = player;
    });

    return () => {
      destroyed = true;
      try { player?.destroy(); } catch {}
      playerRef.current = null;
      mount.replaceChildren();
    };
  }, [startSeconds, title, videoId]);

  useYouTubeKeyboardShortcuts({
    audioActive: false,
    chapters,
    enhancePlayerStateRef,
    frameRate: 30,
    id: videoId,
    keyboardSeekSeconds: KEYBOARD_SEEK_SECONDS,
    playerKind: "youtube",
    playerRef,
    sendCommand: publicPlayerCommand,
    showFeedback,
    speedRef,
    takeScreenshot: () => showFeedback("screenshotUnsupported"),
    transportLocked: false,
  });

  return <div ref={rootRef} className="watch-player watch-player--youtube-public">
    <div ref={mountRef} className="watch-player-yt" />
    {feedback && <WatchPlayerFeedback key={feedback.id} feedback={feedback} keyboardSeekSeconds={KEYBOARD_SEEK_SECONDS} />}
  </div>;
});

export default PublicYouTubePlayer;
