import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { LoaderCircle, Pause, Play, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { enforceLocalPlayerVolume } from "../localPlayerVolume";
import type { WatchPlayerHandle } from "../playerHandle";
import { Button } from "./ui";
import { useAudioMediaSource } from "./useAudioMediaSource";
import "./LocalPlayer.css";
import "./PlayerVolume.css";
import "./AudioModePlayer.css";

const VOLUME_KEY = "localPlayerVolume";
const MUTED_KEY = "localPlayerMuted";
const MAX_RETRY_ATTEMPTS = 3;

function fmtTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = Math.floor(safe % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function storedMuted(): boolean {
  try { return localStorage.getItem(MUTED_KEY) === "1"; } catch { return false; }
}

function storedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const parsed = Number(raw);
    return raw !== null && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
  } catch {
    return 1;
  }
}

/**
 * Audio-only playback surface for background listening. The real <audio>
 * element remains the media owner for iOS lock-screen playback, while the
 * visible transport reuses the LocalPlayer control language.
 */
const AudioModePlayer = forwardRef<WatchPlayerHandle, {
  src: string;
  videoId: string;
  live?: boolean;
  title?: string;
  channelTitle?: string;
  artworkUrl?: string;
  startSeconds?: number;
  playbackRate?: number;
  keyboardSeekSeconds?: number;
  onEnded?: () => void;
}>(function AudioModePlayer({
  src,
  videoId,
  live = false,
  title,
  channelTitle,
  artworkUrl,
  startSeconds = 0,
  playbackRate = 1,
  keyboardSeekSeconds = 5,
  onEnded,
}, ref) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const ignoreNextVolumeBlurRef = useRef(false);
  const startedAtRef = useRef(startSeconds);
  const endedRef = useRef(false);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(storedMuted);
  const [volume, setVolume] = useState(storedVolume);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const retrySrc = sourceRevision > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${sourceRevision}` : src;
  const onFatalSourceError = useCallback(() => {
    setStatus("error");
    setBuffering(false);
    setPlaying(false);
  }, []);
  useAudioMediaSource({ audioRef, live, onFatalError: onFatalSourceError, src: retrySrc });

  const setAudioPosition = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    const mediaDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const next = Math.min(Math.max(0, seconds), mediaDuration > 0 ? mediaDuration : Infinity);
    try { audio.currentTime = next; } catch { return; }
    setCurrentTime(next);
    endedRef.current = false;
  }, [duration]);

  useImperativeHandle(ref, () => ({
    seekTo: setAudioPosition,
    getCurrentTime: () => live ? 0 : audioRef.current?.currentTime ?? 0,
    getDuration: () => {
      const mediaDuration = audioRef.current?.duration;
      return !live && Number.isFinite(mediaDuration) ? mediaDuration as number : 0;
    },
    getPlayerState: () => {
      const audio = audioRef.current;
      if (!audio) return 2;
      if (audio.ended) return 0;
      if (audio.paused) return 2;
      if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return 3;
      return 1;
    },
    getPlaybackRate: () => audioRef.current?.playbackRate ?? 1,
    setPlaybackRate: (rate: number) => {
      const audio = audioRef.current;
      if (audio && Number.isFinite(rate) && rate > 0) audio.playbackRate = rate;
    },
    getVolume: () => (audioRef.current?.volume ?? volume) * 100,
    setVolume: (nextVolume: number) => {
      if (!Number.isFinite(nextVolume)) return;
      const next = Math.min(1, Math.max(0, nextVolume / 100));
      if (audioRef.current) audioRef.current.volume = next;
      setVolume(next);
    },
    isMuted: () => audioRef.current?.muted ?? muted,
    mute: () => {
      if (audioRef.current) audioRef.current.muted = true;
      setMuted(true);
    },
    unMute: () => {
      if (audioRef.current) audioRef.current.muted = false;
      setMuted(false);
    },
    pauseVideo: () => audioRef.current?.pause(),
    playVideo: () => { void audioRef.current?.play().catch(() => {}); },
    destroy: () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  }), [live, muted, setAudioPosition, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      enforceLocalPlayerVolume(audio, volume);
      audio.muted = muted;
    }
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
      localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
    } catch {}
  }, [muted, volume]);

  useEffect(() => {
    if (!volumeOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!volumeControlRef.current?.contains(event.target as Node)) setVolumeOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVolumeOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [volumeOpen]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(playbackRate) && playbackRate > 0) audio.playbackRate = live ? 1 : playbackRate;
  }, [live, playbackRate]);

  // The proxy deliberately has no codec fallback. Fail cleanly instead of
  // leaving an infinite loading state when a video has no AAC track.
  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setStatus((current) => current === "loading" ? "error" : current), 20_000);
    return () => window.clearTimeout(timer);
  }, [src, status]);

  const updateBuffered = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.buffered.length) { setBuffered(0); return; }
    setBuffered(audio.buffered.end(audio.buffered.length - 1));
  }, []);

  const onLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const mediaDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
    setDuration(mediaDuration);
    if (startedAtRef.current > 0 && mediaDuration > 0) {
      setAudioPosition(Math.min(startedAtRef.current, Math.max(0, mediaDuration - 0.5)));
      startedAtRef.current = 0;
    } else {
      setCurrentTime(audio.currentTime);
    }
    if (Number.isFinite(playbackRate) && playbackRate > 0) audio.playbackRate = live ? 1 : playbackRate;
    enforceLocalPlayerVolume(audio, volume);
    audio.muted = muted;
  };

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || status === "error") return;
    if (audio.paused || audio.ended) {
      if (audio.ended) setAudioPosition(0);
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [setAudioPosition, status]);

  const toggleMuted = () => {
    const next = !muted;
    if (audioRef.current) audioRef.current.muted = next;
    setMuted(next);
  };

  const handleVolumeButton = () => {
    if (!volumeOpen) {
      setVolumeOpen(true);
      return;
    }
    toggleMuted();
  };

  const retryAudio = async () => {
    if (retryAttempts >= MAX_RETRY_ATTEMPTS) return;
    const attempt = retryAttempts + 1;
    setStatus("loading");
    setBuffering(true);
    setPlaying(false);
    endedRef.current = false;
    setRetryAttempts(attempt);
    try {
      await api.retryAudio(videoId);
      setSourceRevision((revision) => revision + 1);
    } catch {
      setStatus("error");
      setBuffering(false);
    }
  };

  // System-level controls keep the same <audio> element alive on the lock
  // screen; the custom controls below only replace its on-page chrome.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const audio = audioRef.current;
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    };
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title ?? "",
        artist: channelTitle ?? "",
        artwork: artworkUrl ? [{ src: artworkUrl, sizes: "480x360", type: "image/jpeg" }] : [],
      });
    } catch {}
    setHandler("play", () => audio?.play().catch(() => {}));
    setHandler("pause", () => audio?.pause());
    if (!live) {
      setHandler("seekbackward", () => { if (audio) setAudioPosition(audio.currentTime - 10); });
      setHandler("seekforward", () => { if (audio) setAudioPosition(audio.currentTime + 10); });
      setHandler("seekto", (event) => {
        if (typeof event.seekTime === "number") setAudioPosition(event.seekTime);
      });
    }
    setHandler("stop", () => {
      if (!audio) return;
      audio.pause();
      setAudioPosition(0);
      try { navigator.mediaSession.playbackState = "none"; } catch {}
    });
    return () => {
      try { navigator.mediaSession.metadata = null; } catch {}
      try { navigator.mediaSession.playbackState = "none"; } catch {}
      for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto", "stop"] as MediaSessionAction[]) {
        setHandler(action, null);
      }
    };
  }, [artworkUrl, channelTitle, live, setAudioPosition, title]);

  const mediaDuration = duration > 0 ? duration : 0;
  const progress = mediaDuration > 0 ? Math.min(1, currentTime / mediaDuration) : 0;
  const bufferedFraction = mediaDuration > 0 ? Math.min(1, buffered / mediaDuration) : 0;
  const hoverTime = hoverX !== null && mediaDuration > 0 ? hoverX * mediaDuration : null;

  const barFraction = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect?.width) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const seekFromPointer = (clientX: number) => setAudioPosition(barFraction(clientX) * mediaDuration);
  const onBarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mediaDuration <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    setHoverX(barFraction(event.clientX));
    seekFromPointer(event.clientX);
  };
  const onBarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mediaDuration <= 0) return;
    setHoverX(barFraction(event.clientX));
    if (scrubbing) seekFromPointer(event.clientX);
  };
  const onBarPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing) seekFromPointer(event.clientX);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setScrubbing(false);
  };
  const onBarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (mediaDuration <= 0) return;
    let target: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") target = currentTime - keyboardSeekSeconds;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") target = currentTime + keyboardSeekSeconds;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = mediaDuration;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    setAudioPosition(target);
  };

  return (
    <div className="audio-mode lp-root">
      <div
        className="audio-mode-art"
        style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
        aria-hidden="true"
      />
      <div className="audio-mode-scrim" aria-hidden="true" />
      <audio
        ref={audioRef}
        className="audio-mode-media"
        src={live ? undefined : retrySrc}
        autoPlay
        preload="auto"
        playsInline
        aria-label={title ?? t("playerAudioMode")}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onCanPlay={() => { setStatus("ready"); setBuffering(false); setRetryAttempts(0); }}
        onPlaying={() => { setStatus("ready"); setPlaying(true); setBuffering(false); setRetryAttempts(0); endedRef.current = false; }}
        onPlay={() => {
          setPlaying(true);
          try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; } catch {}
        }}
        onPause={(event) => {
          setPlaying(false);
          try {
            if ("mediaSession" in navigator) navigator.mediaSession.playbackState = event.currentTarget.ended ? "none" : "paused";
          } catch {}
        }}
        onWaiting={() => setBuffering(true)}
        onSeeking={() => setBuffering(true)}
        onSeeked={() => setBuffering(false)}
        onProgress={updateBuffered}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          setVolume(event.currentTarget.volume);
        }}
        onError={() => { setStatus("error"); setBuffering(false); setPlaying(false); }}
        onEnded={() => {
          if (endedRef.current) return;
          endedRef.current = true;
          setPlaying(false);
          try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none"; } catch {}
          onEnded?.();
        }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          enforceLocalPlayerVolume(audio, volume);
          setCurrentTime(audio.currentTime);
          updateBuffered();
          if (live || !("mediaSession" in navigator) || !Number.isFinite(audio.currentTime) || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
          try {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              playbackRate: audio.playbackRate || 1,
              position: Math.min(audio.currentTime, audio.duration),
            });
          } catch {}
        }}
      />

      <div className="audio-mode-hero">
        <div className="audio-mode-card">
          <div className="audio-mode-cover-wrap">
            {artworkUrl && <img className="audio-mode-cover" src={artworkUrl} alt="" draggable={false} />}
            {buffering && status !== "error" && (
              <div className="audio-mode-cover-state" role="status" aria-label={t("loading")}>
                <LoaderCircle className="spin" size={34} />
              </div>
            )}
            {status === "error" && (
              <div className="audio-mode-cover-state audio-mode-cover-state--error" role="alert">
                {t("playerAudioModeError")}
              </div>
            )}
          </div>
          <div className="audio-mode-meta">
            <div className="audio-mode-title">{title}</div>
            {channelTitle && <div className="audio-mode-channel">{channelTitle}</div>}
          </div>
          {status !== "error" && (
            <div className="audio-mode-player" aria-label={title}>
              <button className="lp-btn audio-mode-play" onClick={togglePlay} aria-label={playing ? t("playerPause") : t("playerPlay")} disabled={status !== "ready"}>
                {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>
              {live ? (
                <div className="audio-mode-timeline audio-mode-timeline--live">
                  <div className="audio-mode-live-track" aria-hidden="true" />
                  <div className="audio-mode-times audio-mode-live-times">
                    <span className="audio-mode-live-label">
                      <span className="audio-mode-live-dot" aria-hidden="true" />
                      {t("liveBadge")}
                    </span>
                  </div>
                </div>
              ) : (
              <div className="audio-mode-timeline">
                <div
                  ref={barRef}
                  className="lp-bar audio-mode-bar"
                  role="slider"
                  tabIndex={mediaDuration > 0 ? 0 : -1}
                  aria-label={title ?? t("playerAudioMode")}
                  aria-valuemin={0}
                  aria-valuemax={Math.floor(mediaDuration)}
                  aria-valuenow={Math.floor(currentTime)}
                  aria-valuetext={`${fmtTime(currentTime)} / ${fmtTime(mediaDuration)}`}
                  aria-disabled={mediaDuration <= 0 || undefined}
                  onKeyDown={onBarKeyDown}
                  onPointerDown={onBarPointerDown}
                  onPointerMove={onBarPointerMove}
                  onPointerUp={onBarPointerUp}
                  onPointerCancel={() => setScrubbing(false)}
                  onPointerLeave={() => { if (!scrubbing) setHoverX(null); }}
                >
                  <div className="lp-bar-track">
                    <div className="lp-bar-buffered" style={{ width: `${bufferedFraction * 100}%` }} />
                    <div className="lp-bar-played" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <div className="lp-bar-knob" style={{ left: `${progress * 100}%` }} />
                  {hoverTime !== null && <div className="lp-bar-tooltip" style={{ left: `${(hoverX ?? 0) * 100}%` }}>{fmtTime(hoverTime)}</div>}
                </div>
                <div className="audio-mode-times">
                  <span>{fmtTime(currentTime)}</span>
                  <span>{fmtTime(mediaDuration)}</span>
                </div>
              </div>
              )}
              <div
                ref={volumeControlRef}
                className={`lp-volume audio-mode-volume${volumeOpen ? " is-open" : ""}`}
                onBlur={(event) => {
                  if (ignoreNextVolumeBlurRef.current) {
                    ignoreNextVolumeBlurRef.current = false;
                    return;
                  }
                  if (!event.currentTarget.contains(event.relatedTarget)) setVolumeOpen(false);
                }}
              >
                <div className="audio-mode-volume-popover" aria-hidden={!volumeOpen}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    style={{ "--player-volume": `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
                    aria-label={t("playerVolume")}
                    tabIndex={volumeOpen ? 0 : -1}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setVolume(next);
                      setMuted(next === 0);
                    }}
                  />
                </div>
                <button
                  className="lp-btn"
                  onClick={(event) => {
                    handleVolumeButton();
                    if (event.detail > 0 && document.activeElement === event.currentTarget) {
                      ignoreNextVolumeBlurRef.current = true;
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label={volumeOpen ? (muted ? t("playerUnmute") : t("playerMute")) : t("playerVolume")}
                  aria-expanded={volumeOpen}
                >
                  {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
              </div>
              {playbackRate !== 1 && <span className="audio-mode-rate">{playbackRate}×</span>}
            </div>
          )}
          {status === "error" && (
            <div className="audio-mode-retry">
              <Button variant="ghost" className="audio-mode-retry-button" leadingIcon={<RefreshCw />} onClick={retryAudio} disabled={retryAttempts >= MAX_RETRY_ATTEMPTS}>
                {t("playerAudioModeRetry")}
              </Button>
              {retryAttempts >= MAX_RETRY_ATTEMPTS && <small>{t("playerAudioModeRetryExhausted")}</small>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default AudioModePlayer;
