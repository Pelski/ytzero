import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { api } from "../api";
import { enforceLocalPlayerVolume } from "../localPlayerVolume";
import { IconButton, Slider } from "./ui";
import "./VideoCardHoverPreview.css";

export function youtubeCardPreviewPlayerVars(videoId: string, startSeconds: number) {
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
    playlist: videoId,
    playsinline: 1,
    rel: 0,
    start: Math.max(0, Math.floor(startSeconds)),
    ytzero_preview: 1,
  };
}

export function youtubeCardPreviewUrl(videoId: string, startSeconds: number): string {
  const params = new URLSearchParams(Object.fromEntries(
    Object.entries(youtubeCardPreviewPlayerVars(videoId, startSeconds)).map(([key, value]) => [key, String(value)]),
  ));
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params}`;
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
    /> : <iframe
      allow="autoplay; encrypted-media"
      src={youtubeCardPreviewUrl(videoId, startSeconds)}
      tabIndex={-1}
      title={videoId}
      onLoad={() => setReady(true)}
    />}
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
