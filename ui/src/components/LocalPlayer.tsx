import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Camera, Clapperboard, LoaderCircle, Maximize, Minimize, MonitorPlay, Pause, PictureInPicture2, Play, Volume2, VolumeX } from "lucide-react";
import type { SponsorSegment, VideoChapter, VideoSubtitle } from "../api";
import { api, SB_CATEGORIES } from "../api";
import { subtitleLanguageLabel } from "../subtitleLanguages";
import { useI18n } from "../i18n";
import SubtitlePicker from "./SubtitlePicker";
import { downloadScreenshotCanvas, type PlayerScreenshotFormat } from "../playerScreenshot";
import { enforceLocalPlayerVolume } from "../localPlayerVolume";
import { stepPlaybackRate } from "../playbackSpeedStep";
import { resolveShortcutBindings, shortcutActionMatches } from "../keyboardShortcuts";
import { useVideoHlsSource } from "./useVideoHlsSource";
import "./LocalPlayer.css";
import "./PlayerVolume.css";
import "./LocalPlayerTransportLock.css";

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
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  destroy: () => void;
}

export interface SubtitleStyle {
  size: number;
  color: string; // css color
  bg: number; // background opacity 0-100
}

export type LocalPlayerShortcut = "back" | "forward" | "volumeUp" | "volumeDown" | "mute" | "unmute" | "speed" | "captionsOn" | "captionsOff" | "screenshot" | "screenshotError";

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
  /** Locks viewer-initiated play, pause, seek, and speed changes while still
   * allowing imperative room-sync commands through `LocalPlayerHandle`. */
  transportLocked?: boolean;
  title?: string;
  channelTitle?: string;
  artworkUrl?: string;
  chapters?: VideoChapter[];
  sbSegments?: SponsorSegment[];
  cinemaMode?: boolean;
  onToggleCinema?: () => void;
  onEnded?: () => void;
  keyboardSeekSeconds?: number;
  keyboardShortcuts?: string;
  frameRate?: number;
  onShortcut?: (kind: LocalPlayerShortcut, seconds?: number) => void;
  screenshotFormat?: PlayerScreenshotFormat;
  screenshotQuality?: number;
  screenshotFilenameTemplate?: string;
  videoId?: string;
  ccDefaultOn?: boolean;
  ccDefaultLang?: string;
  preferredSubtitleLanguages?: string[];
  subtitleStyle?: SubtitleStyle;
  onSubtitleSizeChange?: (size: number) => void;
  // Experimental play-while-downloading source. The known total length keeps
  // controls stable while the HLS master and its renditions are attaching.
  live?: boolean;
  liveLabel?: string;
  durationSeconds?: number;
  onError?: () => void;
  // Streaming mode only: leave the experimental stream for the viewer's own
  // configured player (rendered as a centred button in the control bar).
  onExitStreaming?: () => void;
  exitStreamingLabel?: string;
}>(function LocalPlayer({
  src,
  poster,
  startSeconds = 0,
  playbackRate = 1,
  autoplay = true,
  transportLocked = false,
  title,
  channelTitle,
  artworkUrl,
  chapters = [],
  sbSegments = [],
  cinemaMode = false,
  onToggleCinema,
  onEnded,
  keyboardSeekSeconds = 5,
  keyboardShortcuts,
  frameRate = 30,
  onShortcut,
  screenshotFormat = "jpeg",
  screenshotQuality = 0.92,
  screenshotFilenameTemplate,
  videoId,
  ccDefaultOn = false,
  ccDefaultLang,
  preferredSubtitleLanguages = [],
  subtitleStyle,
  onSubtitleSizeChange,
  live = false,
  liveLabel,
  durationSeconds,
  onError,
  onExitStreaming,
  exitStreamingLabel,
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

  // ---------- subtitles ----------
  const trackRef = useRef<HTMLTrackElement>(null);
  const [subs, setSubs] = useState<VideoSubtitle[]>([]);
  const [subLang, setSubLang] = useState<string | null>(null);
  const [subLoading, setSubLoading] = useState<string | null>(null);
  const [subError, setSubError] = useState<string | null>(null);
  const [cueLines, setCueLines] = useState<string[]>([]);

  // Available subtitle files; honour the global "always captions" preference,
  // quietly fetching the preferred language when it isn't on disk yet.
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    api.videoSubtitles(videoId).then((r) => {
      if (cancelled) return;
      setSubs(r.subtitles);
      if (!ccDefaultOn || !ccDefaultLang) return;
      if (r.subtitles.some((s) => s.lang === ccDefaultLang)) {
        setSubLang(ccDefaultLang);
      } else {
        api.downloadSubtitle(videoId, ccDefaultLang).then((res) => {
          if (cancelled) return;
          setSubs(res.subtitles);
          if (res.downloaded) setSubLang(ccDefaultLang);
        }).catch(() => {});
      }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Picking a language that isn't downloaded: pause, fetch just the subtitles,
  // then resume right where the viewer was.
  const pickSubLang = useCallback(async (lang: string | null) => {
    setSubError(null);
    if (!lang) { setSubLang(null); return; }
    if (subs.some((s) => s.lang === lang)) { setSubLang(lang); return; }
    if (!videoId) return;
    const v = videoRef.current;
    const wasPlaying = Boolean(!transportLocked && v && !v.paused && !v.ended);
    if (!transportLocked) v?.pause();
    setSubLoading(lang);
    try {
      const r = await api.downloadSubtitle(videoId, lang);
      setSubs(r.subtitles);
      if (r.downloaded) setSubLang(lang);
      else setSubError(lang);
    } catch {
      setSubError(lang);
    } finally {
      setSubLoading(null);
      if (wasPlaying) v?.play().catch(() => {});
    }
  }, [subs, transportLocked, videoId]);

  // The browser parses the WebVTT track (mode "hidden"); we render active cues
  // ourselves so the user's subtitle style applies reliably everywhere.
  useEffect(() => {
    const trackEl = trackRef.current;
    if (!trackEl || !subLang) { setCueLines([]); return; }
    const track = trackEl.track;
    track.mode = "hidden";
    const onCue = () => {
      const lines: string[] = [];
      for (const cue of Array.from(track.activeCues ?? []) as VTTCue[]) {
        const text = cue.getCueAsHTML?.().textContent ?? cue.text ?? "";
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) lines.push(trimmed);
        }
      }
      // Auto-generated captions repeat the previous line in the next cue.
      setCueLines([...new Set(lines)]);
    };
    track.addEventListener("cuechange", onCue);
    onCue();
    return () => {
      track.removeEventListener("cuechange", onCue);
      track.mode = "disabled";
      setCueLines([]);
    };
  }, [subLang, subs]);

  const activeSub = subLang ? subs.find((s) => s.lang === subLang) ?? null : null;
  const subStyle: SubtitleStyle = subtitleStyle ?? { size: 19, color: "#ffffff", bg: 75 };
  const subBg = `rgba(0, 0, 0, ${Math.min(100, Math.max(0, subStyle.bg)) / 100})`;
  const toggleSubtitles = useCallback(() => {
    if (subLang) {
      void pickSubLang(null);
      return;
    }
    const preferred = subs.find((sub) => sub.lang === ccDefaultLang)?.lang ?? subs[0]?.lang ?? ccDefaultLang ?? null;
    if (preferred) void pickSubLang(preferred);
  }, [ccDefaultLang, pickSubLang, subLang, subs]);
  const changeSubtitleSize = (direction: -1 | 1) => {
    const next = Math.min(48, Math.max(12, subStyle.size + direction * 2));
    if (next !== subStyle.size) onSubtitleSizeChange?.(next);
  };

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
    getPlaybackRate: () => videoRef.current?.playbackRate ?? 1,
    setPlaybackRate: (rate: number) => {
      const v = videoRef.current;
      if (v && Number.isFinite(rate) && rate > 0) v.playbackRate = rate;
    },
    pauseVideo: () => videoRef.current?.pause(),
    playVideo: () => {
      const video = videoRef.current;
      if (!video) return;
      video.play().catch(() => {
        video.muted = true;
        setMuted(true);
        video.play().catch(() => {});
      });
    },
    destroy: () => videoRef.current?.pause(),
  }), []);

  // Initial position, rate and volume once metadata is in.
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    if (!live && startSeconds > 0 && startSeconds < v.duration - 5) v.currentTime = startSeconds;
    v.playbackRate = playbackRate;
    enforceLocalPlayerVolume(v, volume);
    v.muted = muted;
    setBuffering(false);
  };

  // Kick off playback for a streaming source. hls.js swaps the media source
  // via MSE after the element's autoplay attribute is evaluated, so playback
  // must be started explicitly once the manifest is parsed. If the browser
  // blocks autoplay-with-sound, retry muted (always allowed) so the stream
  // actually plays — the viewer can unmute from the volume control.
  const tryStreamAutoplay = useCallback(() => {
    if (!autoplay) return;
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
  }, [autoplay]);

  useVideoHlsSource({
    active: live,
    durationSeconds,
    mediaRef: videoRef,
    onFatalError: onError,
    onReady: tryStreamAutoplay,
    src,
    startSeconds,
  });

  useEffect(() => {
    const v = videoRef.current;
    if (v && Number.isFinite(playbackRate) && playbackRate > 0) v.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) { enforceLocalPlayerVolume(v, volume); v.muted = muted; }
    localStorage.setItem(VOLUME_KEY, String(volume));
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  }, [volume, muted]);

  const togglePlay = useCallback(() => {
    if (transportLocked) {
      showControls();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) v.play().catch(() => {});
    else v.pause();
    showControls();
  }, [showControls, transportLocked]);

  const seekBy = useCallback((delta: number) => {
    if (transportLocked) {
      showControls();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration || Infinity);
    showControls();
  }, [showControls, transportLocked]);

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

  const takeScreenshot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
      onShortcut?.("screenshotError");
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas unavailable");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      await downloadScreenshotCanvas(canvas, {
        template: screenshotFilenameTemplate,
        channel: channelTitle,
        title,
        videoId,
        seconds: video.currentTime,
        format: screenshotFormat,
        quality: screenshotQuality,
      });
      onShortcut?.("screenshot");
      showControls();
    } catch (error) {
      console.error("Unable to capture video frame", error);
      onShortcut?.("screenshotError");
    }
  }, [channelTitle, onShortcut, screenshotFilenameTemplate, screenshotFormat, screenshotQuality, showControls, title, videoId]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Keyboard: playback-local keys. Page navigation, theater and the app-level
  // page-owned modes stay in WatchPage so they behave identically for every source.
  useEffect(() => {
    const bindings = resolveShortcutBindings(keyboardShortcuts);
    const matches = (action: Parameters<typeof shortcutActionMatches>[0], event: KeyboardEvent) => shortcutActionMatches(action, event, bindings);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      const isTransportShortcut = (["temporaryBoost", "togglePlay", "seekBack10", "seekForward10", "previousFrame", "nextFrame", "speedDown", "speedUp", "seekPercent", "previousChapter", "nextChapter", "seekBack", "seekForward"] as const).some((action) => matches(action, e));
      if (transportLocked && isTransportShortcut) {
        e.preventDefault();
        showControls();
        return;
      }
      if (matches("temporaryBoost", e)) {
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
      const speedDirection = matches("speedDown", e) ? -1 : matches("speedUp", e) ? 1 : null;
      if (speedDirection !== null) {
        e.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        const nextRate = stepPlaybackRate(video.playbackRate, speedDirection);
        video.playbackRate = nextRate;
        onShortcut?.("speed", nextRate);
        showControls();
        return;
      }
      if (matches("subtitleLarger", e)) { e.preventDefault(); changeSubtitleSize(1); }
      else if (matches("subtitleSmaller", e)) { e.preventDefault(); changeSubtitleSize(-1); }
      else if (matches("toggleCaptions", e)) {
        e.preventDefault(); if (!e.repeat) { const captionsWereOn = Boolean(subLang); const preferred = subs.find((sub) => sub.lang === ccDefaultLang)?.lang ?? subs[0]?.lang ?? ccDefaultLang; toggleSubtitles(); if (captionsWereOn || preferred) onShortcut?.(captionsWereOn ? "captionsOff" : "captionsOn"); }
      } else if (matches("togglePlay", e)) { e.preventDefault(); togglePlay(); }
      else if (matches("seekBack10", e)) { e.preventDefault(); seekBy(-10); onShortcut?.("back", 10); }
      else if (matches("seekForward10", e)) { e.preventDefault(); seekBy(10); onShortcut?.("forward", 10); }
      else if (matches("seekBack", e)) { e.preventDefault(); seekBy(-keyboardSeekSeconds); onShortcut?.("back", keyboardSeekSeconds); }
      else if (matches("seekForward", e)) { e.preventDefault(); seekBy(keyboardSeekSeconds); onShortcut?.("forward", keyboardSeekSeconds); }
      else if (matches("previousFrame", e) || matches("nextFrame", e)) { const v = videoRef.current; if (v?.paused) { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime + (matches("previousFrame", e) ? -1 : 1) / frameRate); showControls(); } }
      else if (matches("previousChapter", e) || matches("nextChapter", e)) { const v = videoRef.current; if (v && chapters.length) { e.preventDefault(); const starts = chapters.map((chapter) => chapter.start); const target = matches("previousChapter", e) ? [...starts].reverse().find((start) => start < v.currentTime - 1) ?? 0 : starts.find((start) => start > v.currentTime + 1); if (target != null) v.currentTime = target; showControls(); } }
      else if (matches("volumeUp", e) || matches("volumeDown", e)) { e.preventDefault(); const up = matches("volumeUp", e); setVolume((current) => { const next = Math.min(1, Math.max(0, current + (up ? .05 : -.05))); if (next > 0) setMuted(false); return next; }); onShortcut?.(up ? "volumeUp" : "volumeDown"); showControls(); }
      else if (matches("toggleMute", e)) { e.preventDefault(); if (!e.repeat) { const nextMuted = !muted; setMuted(nextMuted); onShortcut?.(nextMuted ? "mute" : "unmute"); showControls(); } }
      else if (matches("screenshot", e)) { e.preventDefault(); if (!e.repeat) void takeScreenshot(); }
      else if (matches("toggleFullscreen", e)) { e.preventDefault(); if (!e.repeat) toggleFullscreen(); }
      else if (matches("togglePictureInPicture", e)) { e.preventDefault(); if (!e.repeat) togglePip(); }
      else if (matches("seekPercent", e) && /^Digit[0-9]$/.test(e.code)) { e.preventDefault(); const v = videoRef.current; const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (live && durationSeconds ? durationSeconds : 0); if (v && dur) v.currentTime = (Number(e.code.slice(-1)) / 10) * dur; showControls(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!matches("temporaryBoost", e)) return;
      if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      e.preventDefault();
      if (transportLocked) return;
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
      if (spaceHoldActiveRef.current) {
        const v = videoRef.current;
        if (v) v.playbackRate = playbackRate;
      }
      spaceHoldActiveRef.current = false;
    };
  }, [togglePlay, seekBy, showControls, playbackRate, keyboardSeekSeconds, keyboardShortcuts, frameRate, subStyle.size, onSubtitleSizeChange, subLang, subs, ccDefaultLang, videoId, takeScreenshot, muted, onShortcut, transportLocked, chapters, live, durationSeconds, toggleFullscreen, togglePip]);

  // Media Session: system-level controls (keyboard media keys, lock screen).
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title ?? "",
        artist: channelTitle ?? "",
        artwork: artworkUrl ? [{ src: artworkUrl, sizes: "480x360", type: "image/jpeg" }] : [],
      });
      navigator.mediaSession.setActionHandler("play", transportLocked ? () => {} : () => videoRef.current?.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", transportLocked ? () => {} : () => videoRef.current?.pause());
      navigator.mediaSession.setActionHandler("seekbackward", transportLocked ? () => {} : () => seekBy(-10));
      navigator.mediaSession.setActionHandler("seekforward", transportLocked ? () => {} : () => seekBy(10));
      navigator.mediaSession.setActionHandler("seekto", transportLocked ? () => {} : null);
      navigator.mediaSession.setActionHandler("stop", transportLocked ? () => {} : null);
    } catch {}
    return () => {
      try {
        navigator.mediaSession.metadata = null;
        for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto", "stop"] as const) {
          navigator.mediaSession.setActionHandler(action, null);
        }
      } catch {}
    };
  }, [title, channelTitle, artworkUrl, seekBy, transportLocked]);

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
    if (transportLocked) return;
    const v = videoRef.current;
    if (!v) return;
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (live && durationSeconds ? durationSeconds : 0);
    if (!Number.isFinite(dur) || dur <= 0) return;
    const time = barFraction(clientX) * dur;
    v.currentTime = time;
    setCurrentTime(time);
  };

  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (transportLocked) {
      showControls();
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setScrubbing(true);
    scrubTo(e.clientX);
  };
  const onBarPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (transportLocked) return;
    setHoverX(barFraction(e.clientX));
    if (scrubbing) scrubTo(e.clientX);
  };
  const onBarPointerUp = () => setScrubbing(false);

  useEffect(() => {
    if (!transportLocked) return;
    setScrubbing(false);
    setHoverX(null);
  }, [transportLocked]);

  // The static VOD playlist gives hls.js the real duration; fall back to the
  // known length only until metadata arrives.
  const barDuration = duration > 0 ? duration : (live && durationSeconds ? durationSeconds : 0);
  const progress = barDuration > 0 ? currentTime / barDuration : 0;
  const bufferedFrac = barDuration > 0 ? buffered / barDuration : 0;

  const segments = useMemo(() => {
    if (barDuration <= 0) return [];
    return sbSegments.map((seg) => ({
      key: seg.UUID,
      left: (seg.segment[0] / barDuration) * 100,
      width: Math.max(0.3, ((seg.segment[1] - seg.segment[0]) / barDuration) * 100),
      color: SB_CATEGORIES.find((c) => c.id === seg.category)?.color ?? "#888",
    }));
  }, [sbSegments, barDuration]);

  const chapterTicks = useMemo(() => {
    if (barDuration <= 0) return [];
    return chapters.filter((ch) => ch.start > 0 && ch.start < barDuration).map((ch) => ({
      key: ch.start,
      left: (ch.start / barDuration) * 100,
    }));
  }, [chapters, barDuration]);

  const hoverTime = hoverX != null && barDuration > 0 ? hoverX * barDuration : null;
  const activeChapter = hoverTime != null
    ? [...chapters].reverse().find((ch) => ch.start <= hoverTime)
    : null;

  return (
    <div
      ref={rootRef}
      className={`lp-root${controlsVisible || !playing ? "" : " lp-hide-cursor"}${transportLocked ? " lp-transport-locked" : ""}`}
      onMouseMove={showControls}
      onMouseLeave={() => { if (playing) setControlsVisible(false); }}
    >
      <video
        ref={videoRef}
        className="lp-video"
        src={live ? undefined : src}
        poster={poster}
        autoPlay={autoplay}
        playsInline
        aria-disabled={transportLocked || undefined}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={() => { setPlaying(true); endedRef.current = false; showControls(); }}
        onPause={() => { setPlaying(false); setControlsVisible(true); }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={(e) => {
          // The custom slider is the source of truth. In particular, preserve
          // it across Firefox seeks/media transitions near the end of a file.
          enforceLocalPlayerVolume(e.currentTarget, volume);
          setCurrentTime(e.currentTarget.currentTime);
          updateBuffered();
        }}
        onVolumeChange={(e) => enforceLocalPlayerVolume(e.currentTarget, volume)}
        onProgress={updateBuffered}
        onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onEnded={() => {
          if (endedRef.current) return;
          endedRef.current = true;
          setPlaying(false);
          setControlsVisible(true);
          onEnded?.();
        }}
        onError={() => { if (!live) onError?.(); }}
      >
        {activeSub && (
          <track
            key={activeSub.lang}
            ref={trackRef}
            kind="subtitles"
            src={activeSub.url}
            srcLang={activeSub.lang}
            label={subtitleLanguageLabel(activeSub.lang)}
            default
          />
        )}
      </video>

      {subLang && cueLines.length > 0 && (
        <div
          className={`lp-subtitles${controlsVisible || !playing ? " raised" : ""}`}
          style={{ color: subStyle.color, fontSize: `${subStyle.size * (isFullscreen ? 1.5 : 1)}px`, "--lp-sub-bg": subBg } as CSSProperties}
          aria-live="off"
        >
          {cueLines.map((line, i) => <span key={i}>{line}</span>)}
        </div>
      )}

      {buffering && poster && (
        <div className="lp-loading-bg" style={{ backgroundImage: `url(${poster})` }} aria-hidden="true" />
      )}

      {buffering && (
        <div className="lp-spinner" aria-hidden="true"><LoaderCircle className="spin" size={42} /></div>
      )}

      {live && (
        <div className={`lp-live-corner${controlsVisible || !playing ? " visible" : ""}`}>
          <span className="lp-live-dot" /> {liveLabel ?? "STREAMING"}
        </div>
      )}
      {!transportLocked && !playing && !buffering && (
        <button className="lp-big-play" onClick={togglePlay} aria-label={t("playerPlay")}>
          <Play size={30} fill="currentColor" />
        </button>
      )}

      <div className={`lp-controls${controlsVisible || !playing ? " visible" : ""}`}>
        <div
          ref={barRef}
          className={`lp-bar${transportLocked ? " lp-bar--locked" : ""}`}
          aria-disabled={transportLocked || undefined}
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
          <button className="lp-btn" onClick={togglePlay} aria-label={playing ? t("playerPause") : t("playerPlay")} disabled={transportLocked}>
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
              style={{ "--player-volume": `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
              aria-label={t("playerVolume")}
              onChange={(e) => { setVolume(Number(e.target.value)); setMuted(Number(e.target.value) === 0); }}
            />
          </div>
          <span className="lp-time">{fmtTime(currentTime)} / {fmtTime(barDuration)}</span>
          <span className="lp-spacer" />
          {live && onExitStreaming && (
            <>
              <button className="lp-exit-stream" onClick={onExitStreaming} title={exitStreamingLabel} disabled={transportLocked}>
                <MonitorPlay size={17} />
                {exitStreamingLabel && <span>{exitStreamingLabel}</span>}
              </button>
              <span className="lp-spacer" />
            </>
          )}
          <SubtitlePicker
            videoId={videoId}
            subtitles={subs}
            selectedLanguage={subLang}
            preferredLanguages={preferredSubtitleLanguages}
            loadingLanguage={subLoading}
            errorLanguage={subError}
            onSelect={pickSubLang}
            onToggle={toggleSubtitles}
          />
          <button className="lp-btn" onClick={() => void takeScreenshot()} aria-label={t("playerScreenshot")} title={`${t("playerScreenshot")} (S)`} disabled={buffering}>
            <Camera size={19} />
          </button>
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
