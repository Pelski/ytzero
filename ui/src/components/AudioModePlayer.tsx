import { useEffect, useRef } from "react";
import { Video } from "lucide-react";
import { useI18n } from "../i18n";
import "./AudioModePlayer.css";

/**
 * Audio-only playback surface for background listening. It plays the proxied
 * m4a track through a real <audio> element (not <video>), which is the only way
 * iOS keeps playback alive once Safari is backgrounded or the screen is locked.
 * Native controls are used deliberately: they are lock-screen friendly and need
 * no custom transport logic. Kept fully self-contained so the video player is
 * untouched.
 */
export default function AudioModePlayer({
  src,
  title,
  channelTitle,
  artworkUrl,
  startSeconds = 0,
  onPositionChange,
  onExit,
}: {
  src: string;
  title?: string;
  channelTitle?: string;
  artworkUrl?: string;
  startSeconds?: number;
  onPositionChange?: (seconds: number, duration: number) => void;
  onExit?: () => void;
}) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const startedAt = useRef(startSeconds);

  // Resume where the video player left off, once the element knows its metadata.
  const seekToStart = () => {
    const a = audioRef.current;
    if (!a || startedAt.current <= 0) return;
    if (Number.isFinite(a.duration) && a.duration > 0) {
      a.currentTime = Math.min(startedAt.current, a.duration - 0.5);
      startedAt.current = 0;
    }
  };

  // System-level controls (lock screen, media keys) for the audio element.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const a = audioRef.current;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title ?? "",
        artist: channelTitle ?? "",
        artwork: artworkUrl ? [{ src: artworkUrl, sizes: "480x360", type: "image/jpeg" }] : [],
      });
      navigator.mediaSession.setActionHandler("play", () => a?.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", () => a?.pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => { if (a) a.currentTime = Math.max(0, a.currentTime - 10); });
      navigator.mediaSession.setActionHandler("seekforward", () => { if (a) a.currentTime = a.currentTime + 10; });
      navigator.mediaSession.setActionHandler("seekto", (e) => { if (a && typeof e.seekTime === "number") a.currentTime = e.seekTime; });
    } catch {}
    return () => {
      try {
        for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto"] as const) {
          navigator.mediaSession.setActionHandler(action, null);
        }
      } catch {}
    };
  }, [title, channelTitle, artworkUrl]);

  return (
    <div className="audio-mode">
      <div
        className="audio-mode-art"
        style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
        aria-hidden="true"
      />
      <div className="audio-mode-body">
        {onExit && (
          <button type="button" className="audio-mode-exit" onClick={onExit}>
            <Video size={16} />
            {t("playerAudioModeExit")}
          </button>
        )}
        <div className="audio-mode-meta">
          <div className="audio-mode-title">{title}</div>
          {channelTitle && <div className="audio-mode-channel">{channelTitle}</div>}
        </div>
        <audio
          ref={audioRef}
          className="audio-mode-audio"
          src={src}
          autoPlay
          controls
          playsInline
          onLoadedMetadata={seekToStart}
          onPlay={() => { try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; } catch {} }}
          onPause={() => { try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; } catch {} }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (Number.isFinite(el.currentTime)) onPositionChange?.(el.currentTime, Number.isFinite(el.duration) ? el.duration : 0);
          }}
        />
      </div>
    </div>
  );
}
