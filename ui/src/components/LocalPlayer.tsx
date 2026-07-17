import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Clapperboard, LoaderCircle, Maximize, Minimize, Pause, PictureInPicture2, Play, Volume2, VolumeX } from "lucide-react";
import type { SponsorSegment, VideoChapter } from "../api";
import { SB_CATEGORIES } from "../api";
import { useI18n } from "../i18n";

const VOLUME_KEY = "localPlayerVolume";
const MUTED_KEY = "localPlayerMuted";
const CONTROLS_HIDE_MS = 2600;

/**
 * Imperative surface mirroring the parts of YT.Player that WatchPage uses, so
 * the same progress/SponsorBlock/chapter code drives both players.
 * States: 0 = ended, 1 = playing, 2 = paused, 3 = buffering.
 */
export interface LocalPlayerHandle {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  destroy: () => void;
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const LocalPlayer = forwardRef<LocalPlayerHandle, {
  src: string;
  poster?: string;
  startSeconds?: number;
  playbackRate?: number;
  autoplay?: boolean;
  title?: string;
  channelTitle?: string;
  artworkUrl?: string;
  chapters?: VideoChapter[];
  sbSegments?: SponsorSegment[];
  cinemaMode?: boolean;
  onToggleCinema?: () => void;
  onEnded?: () => void;
  keyboardSeekSeconds?: number;
  onShortcut?: (kind: "back" | "forward" | "volumeUp" | "volumeDown" | "speed", seconds?: number) => void;
}>(function LocalPlayer({
  src,
  poster,
  startSeconds = 0,
  playbackRate = 1,
  autoplay = true,
  title,
  channelTitle,
  artworkUrl,
  chapters = [],
  sbSegments = [],
  cinemaMode = false,
  onToggleCinema,
  onEnded,
  keyboardSeekSeconds = 5,
  onShortcut,
}, ref) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const spaceHoldTimerRef = useRef<number | null>(null);
  const spaceHoldActiveRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTED_KEY) === "1");
  const [volume, setVolume] = useState(() => {
    const raw = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 && localStorage.getItem(VOLUME_KEY) !== null ? raw : 1;
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    seekTo: (seconds: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, seconds);
      endedRef.current = false;
    },
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getDuration: () => {
      const d = videoRef.current?.duration;
      return Number.isFinite(d) ? (d as number) : 0;
    },
    getPlayerState: () => {
      const v = videoRef.current;
      if (!v) return 2;
      if (v.ended) return 0;
      if (v.paused) return 2;
      if (v.readyState < 3) return 3;
      return 1;
    },
    setPlaybackRate: (rate: number) => {
      const v = videoRef.current;
      if (v && Number.isFinite(rate) && rate > 0) v.playbackRate = rate;
    },
    pauseVideo: () => videoRef.current?.pause(),
    playVideo: () => { videoRef.current?.play().catch(() => {}); },
    destroy: () => videoRef.current?.pause(),
  }), []);

  // Initial position, rate and volume once metadata is in.
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    if (startSeconds > 10 && startSeconds < v.duration - 5) v.currentTime = startSeconds;
    v.playbackRate = playbackRate;
    v.volume = volume;
    v.muted = muted;
    setBuffering(false);
  };

  useEffect(() => {
    const v = videoRef.current;
    if (v && Number.isFinite(playbackRate) && playbackRate > 0) v.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.volume = volume; v.muted = muted; }
    localStorage.setItem(VOLUME_KEY, String(volume));
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  }, [volume, muted]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) v.play().catch(() => {});
    else v.pause();
    showControls();
  }, [showControls]);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration || Infinity);
    showControls();
  }, [showControls]);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }, []);

  const togglePip = useCallback(() => {
    const v = videoRef.current as any;
    if (!v) return;
    if ((document as any).pictureInPictureElement) (document as any).exitPictureInPicture?.();
    else v.requestPictureInPicture?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Keyboard: playback-local keys only. F/T stay in WatchPage so cinema and
  // fullscreen shortcuts behave identically for both player types.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat || spaceHoldTimerRef.current != null || spaceHoldActiveRef.current) return;
        spaceHoldTimerRef.current = window.setTimeout(() => {
          spaceHoldTimerRef.current = null;
          const v = videoRef.current;
          if (!v) return;
          spaceHoldActiveRef.current = true;
          v.playbackRate = 2;
          onShortcut?.("speed");
        }, 220);
        return;
      }
      switch (e.key) {
        case "k":
        case "K":
          e.preventDefault();
          togglePlay();
          break;
        case "j": case "J": seekBy(-10); break;
        case "l": case "L": seekBy(10); break;
        case "ArrowLeft": e.preventDefault(); seekBy(-keyboardSeekSeconds); onShortcut?.("back", keyboardSeekSeconds); break;
        case "ArrowRight": e.preventDefault(); seekBy(keyboardSeekSeconds); onShortcut?.("forward", keyboardSeekSeconds); break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((current) => {
            const next = Math.min(1, current + 0.05);
            if (next > 0) setMuted(false);
            return next;
          });
          onShortcut?.("volumeUp");
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((current) => Math.max(0, current - 0.05));
          onShortcut?.("volumeDown");
          break;
        case "m": case "M": setMuted((m) => !m); break;
        default: {
          if (/^[0-9]$/.test(e.key)) {
            const v = videoRef.current;
            if (v && Number.isFinite(v.duration)) v.currentTime = (Number(e.key) / 10) * v.duration;
          }
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      e.preventDefault();
      if (spaceHoldTimerRef.current != null) {
        window.clearTimeout(spaceHoldTimerRef.current);
        spaceHoldTimerRef.current = null;
        togglePlay();
      } else if (spaceHoldActiveRef.current) {
        spaceHoldActiveRef.current = false;
        const v = videoRef.current;
        if (v) v.playbackRate = playbackRate;
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      if (spaceHoldTimerRef.current != null) window.clearTimeout(spaceHoldTimerRef.current);
      spaceHoldTimerRef.current = null;
      spaceHoldActiveRef.current = false;
    };
  }, [togglePlay, seekBy, playbackRate, keyboardSeekSeconds]);

  // Media Session: system-level controls (keyboard media keys, lock screen).
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title ?? "",
        artist: channelTitle ?? "",
        artwork: artworkUrl ? [{ src: artworkUrl, sizes: "480x360", type: "image/jpeg" }] : [],
      });
      navigator.mediaSession.setActionHandler("play", () => videoRef.current?.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", () => videoRef.current?.pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => seekBy(-10));
      navigator.mediaSession.setActionHandler("seekforward", () => seekBy(10));
    } catch {}
    return () => {
      try {
        navigator.mediaSession.metadata = null;
        for (const action of ["play", "pause", "seekbackward", "seekforward"] as const) {
          navigator.mediaSession.setActionHandler(action, null);
        }
      } catch {}
    };
  }, [title, channelTitle, artworkUrl, seekBy]);

  const updateBuffered = () => {
    const v = videoRef.current;
    if (!v || v.buffered.length === 0) return;
    for (let i = v.buffered.length - 1; i >= 0; i--) {
      if (v.buffered.start(i) <= v.currentTime) {
        setBuffered(v.buffered.end(i));
        return;
      }
    }
  };

  const barFraction = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const scrubTo = (clientX: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const time = barFraction(clientX) * v.duration;
    v.currentTime = time;
    setCurrentTime(time);
  };

  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setScrubbing(true);
    scrubTo(e.clientX);
  };
  const onBarPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    setHoverX(barFraction(e.clientX));
    if (scrubbing) scrubTo(e.clientX);
  };
  const onBarPointerUp = () => setScrubbing(false);

  const progress = duration > 0 ? currentTime / duration : 0;
  const bufferedFrac = duration > 0 ? buffered / duration : 0;

  const segments = useMemo(() => {
    if (duration <= 0) return [];
    return sbSegments.map((seg) => ({
      key: seg.UUID,
      left: (seg.segment[0] / duration) * 100,
      width: Math.max(0.3, ((seg.segment[1] - seg.segment[0]) / duration) * 100),
      color: SB_CATEGORIES.find((c) => c.id === seg.category)?.color ?? "#888",
    }));
  }, [sbSegments, duration]);

  const chapterTicks = useMemo(() => {
    if (duration <= 0) return [];
    return chapters.filter((ch) => ch.start > 0 && ch.start < duration).map((ch) => ({
      key: ch.start,
      left: (ch.start / duration) * 100,
    }));
  }, [chapters, duration]);

  const hoverTime = hoverX != null && duration > 0 ? hoverX * duration : null;
  const activeChapter = hoverTime != null
    ? [...chapters].reverse().find((ch) => ch.start <= hoverTime)
    : null;

  return (
    <div
      ref={rootRef}
      className={`lp-root${controlsVisible || !playing ? "" : " lp-hide-cursor"}`}
      onMouseMove={showControls}
      onMouseLeave={() => { if (playing) setControlsVisible(false); }}
    >
      <video
        ref={videoRef}
        className="lp-video"
        src={src}
        poster={poster}
        autoPlay={autoplay}
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={() => { setPlaying(true); endedRef.current = false; showControls(); }}
        onPause={() => { setPlaying(false); setControlsVisible(true); }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={(e) => { setCurrentTime(e.currentTarget.currentTime); updateBuffered(); }}
        onProgress={updateBuffered}
        onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onEnded={() => {
          if (endedRef.current) return;
          endedRef.current = true;
          setPlaying(false);
          setControlsVisible(true);
          onEnded?.();
        }}
      />

      {buffering && (
        <div className="lp-spinner" aria-hidden="true"><LoaderCircle className="spin" size={42} /></div>
      )}

      {!playing && !buffering && (
        <button className="lp-big-play" onClick={togglePlay} aria-label={t("playerPlay")}>
          <Play size={30} fill="currentColor" />
        </button>
      )}

      <div className={`lp-controls${controlsVisible || !playing ? " visible" : ""}`}>
        <div
          ref={barRef}
          className="lp-bar"
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerLeave={() => setHoverX(null)}
        >
          <div className="lp-bar-track">
            <div className="lp-bar-buffered" style={{ width: `${bufferedFrac * 100}%` }} />
            {segments.map((seg) => (
              <div key={seg.key} className="lp-bar-segment" style={{ left: `${seg.left}%`, width: `${seg.width}%`, background: seg.color }} />
            ))}
            <div className="lp-bar-played" style={{ width: `${progress * 100}%` }} />
            {chapterTicks.map((tick) => (
              <div key={tick.key} className="lp-bar-chapter" style={{ left: `${tick.left}%` }} />
            ))}
          </div>
          <div className="lp-bar-knob" style={{ left: `${progress * 100}%` }} />
          {hoverTime != null && (
            <div className="lp-bar-tooltip" style={{ left: `${(hoverX ?? 0) * 100}%` }}>
              {activeChapter && <span className="lp-tooltip-chapter">{activeChapter.title}</span>}
              {fmtTime(hoverTime)}
            </div>
          )}
        </div>

        <div className="lp-buttons">
          <button className="lp-btn" onClick={togglePlay} aria-label={playing ? t("playerPause") : t("playerPlay")}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <div className="lp-volume">
            <button className="lp-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? t("playerUnmute") : t("playerMute")}>
              {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label={t("playerVolume")}
              onChange={(e) => { setVolume(Number(e.target.value)); setMuted(Number(e.target.value) === 0); }}
            />
          </div>
          <span className="lp-time">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
          <span className="lp-spacer" />
          {onToggleCinema && (
            <button
              className={`lp-btn${cinemaMode ? " active" : ""}`}
              onClick={onToggleCinema}
              aria-label={t("cinemaMode")}
              aria-pressed={cinemaMode}
              title={t("cinemaMode")}
            >
              <Clapperboard size={19} />
            </button>
          )}
          <button className="lp-btn" onClick={togglePip} aria-label={t("playerPip")}>
            <PictureInPicture2 size={19} />
          </button>
          <button className="lp-btn" onClick={toggleFullscreen} aria-label={t("playerFullscreen")}>
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
});

export default LocalPlayer;
