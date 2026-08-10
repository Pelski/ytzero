import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { api } from "../api";
import { enforceLocalPlayerVolume } from "../localPlayerVolume";
import { loadYouTubeApi } from "../pages/watchRuntime";
import { IconButton, Slider } from "./ui";
import "./VideoCardHoverPreview.css";

export function youtubeCardPreviewPlayerVars(videoId: string, startSeconds: number, origin: string) {
  return {
    autoplay: 1,
    cc_load_policy: 0,
    controls: 0,
    disablekb: 1,
    fs: 0,
    iv_load_policy: 3,
    loop: 1,
    modestbranding: 1,
    mute: 1,
    origin,
    playlist: videoId,
    playsinline: 1,
    rel: 0,
    start: Math.max(0, Math.floor(startSeconds)),
    ytzero_preview: 1,
  };
}

export function VideoCardHoverPreview({
  downloaded,
  durationSeconds,
  muteLabel,
  onUnavailable,
  progressLabel,
  startSeconds,
  unmuteLabel,
  videoId,
}: {
  downloaded: boolean;
  durationSeconds: number;
  muteLabel: string;
  onUnavailable: () => void;
  progressLabel: string;
  startSeconds: number;
  unmuteLabel: string;
  videoId: string;
}) {
  const [duration, setDuration] = useState(Math.max(durationSeconds, startSeconds, 1));
  const [muted, setMuted] = useState(true);
  const [volume] = useState(() => {
    const stored = Number(localStorage.getItem("localPlayerVolume"));
    return Number.isFinite(stored) && stored > 0 && stored <= 1 ? stored : 1;
  });
  const [position, setPosition] = useState(startSeconds);
  const [ready, setReady] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const youtubeWrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (downloaded) return;
    const wrap = youtubeWrapRef.current;
    if (!wrap) return;

    let destroyed = false;
    let player: any = null;
    const inner = document.createElement("div");
    wrap.appendChild(inner);

    void loadYouTubeApi().then(() => {
      if (destroyed) return;
      const target = window as typeof window & { YT?: { Player?: new (element: HTMLElement, options: Record<string, unknown>) => any } };
      if (!target.YT?.Player) {
        onUnavailable();
        return;
      }
      player = new target.YT.Player(inner, {
        host: "https://www.youtube-nocookie.com",
        videoId,
        width: "100%",
        height: "100%",
        playerVars: youtubeCardPreviewPlayerVars(videoId, startSeconds, window.location.origin),
        events: {
          onReady: (event: any) => {
            if (destroyed) return;
            try {
              event.target?.mute?.();
              event.target?.playVideo?.();
            } catch {}
            setReady(true);
          },
          onError: () => {
            if (!destroyed) onUnavailable();
          },
        },
      });
    }).catch(() => {
      if (!destroyed) onUnavailable();
    });

    return () => {
      destroyed = true;
      try { player?.destroy?.(); } catch {}
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    };
  }, [downloaded, onUnavailable, startSeconds, videoId]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    enforceLocalPlayerVolume(video, volume);
    video.muted = muted;
    video.defaultMuted = muted;
    if (muted) video.setAttribute("muted", "");
    else video.removeAttribute("muted");
  }, [muted, volume]);

  const preventCardAction = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const seek = (next: number) => {
    const clamped = Math.max(0, Math.min(duration, next));
    setPosition(clamped);
    if (localVideoRef.current) localVideoRef.current.currentTime = clamped;
  };
  const toggleMuted = () => {
    const video = localVideoRef.current;
    if (!video) return;
    const next = !muted;
    enforceLocalPlayerVolume(video, volume);
    video.muted = next;
    video.defaultMuted = next;
    if (next) video.setAttribute("muted", "");
    else video.removeAttribute("muted");
    setMuted(next);
    if (!next) void video.play().catch(onUnavailable);
  };

  return <span className={`video-card-hover-preview${ready ? " is-ready" : ""}`}>
    {downloaded ? <video
      ref={localVideoRef}
      autoPlay
      loop
      muted={muted}
      playsInline
      preload="auto"
      src={api.streamUrl(videoId)}
      onCanPlay={() => setReady(true)}
      onError={onUnavailable}
      onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
      onVolumeChange={(event) => {
        enforceLocalPlayerVolume(event.currentTarget, volume);
        if (event.currentTarget.muted !== muted) event.currentTarget.muted = muted;
      }}
      onLoadedMetadata={(event) => {
        setDuration(Math.max(1, event.currentTarget.duration || durationSeconds));
        if (startSeconds > 0 && startSeconds < event.currentTarget.duration - 1) event.currentTarget.currentTime = startSeconds;
        void event.currentTarget.play().catch(onUnavailable);
      }}
    /> : <span ref={youtubeWrapRef} className="video-card-hover-preview__youtube" />}
    {downloaded && <span className="video-card-hover-preview__controls" onClick={preventCardAction} onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()}>
      <span className="video-card-hover-preview__progress-track" style={{ "--preview-progress": `${Math.min(100, position / duration * 100)}%` } as CSSProperties}>
        <Slider className="video-card-hover-preview__progress" aria-label={progressLabel} min={0} max={duration} step={0.1} value={Math.min(position, duration)} onChange={seek} />
      </span>
      <IconButton
        className="video-card-hover-preview__mute"
        variant="ghost"
        size="sm"
        label={muted ? unmuteLabel : muteLabel}
        icon={muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleMuted();
        }}
      />
    </span>}
  </span>;
}
