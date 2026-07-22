import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { emit, emitToast } from "../events";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  AlertTriangle,
  ArrowDownToLine,
  BookmarkPlus,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  Clapperboard,
  Copy,
  EllipsisVertical,
  ExternalLink,
  FastForward,
  Eye,
  Gauge,
  LoaderCircle,
  MonitorPlay,
  Pause,
  Play,
  Rewind,
  Share2,
  Star,
  ThumbsUp,
  Trash2,
  Undo2,
  Volume1,
  Volume2,
} from "lucide-react";
import { api, type AppSettings, type Bucket, type PlaylistVideo, type SponsorSegment, type UserPlaylist, type Video, type VideoChapter, type VideoChannelPlaylist, type VideoCreator, type VideoInfo, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
import { compactNumber, formatPlaylistVideoCount, formatTimeAgo, formatViewsCount, useI18n } from "../i18n";
import TagChip from "../components/TagChip";
import LocalPlayer from "../components/LocalPlayer";
import Popconfirm from "../components/Popconfirm";
import PlaylistPicker from "../components/PlaylistPicker";
import { BUCKET_ICONS, formatVideoDuration } from "../components/VideoCard";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { SchedulePicker, VideoScheduleActions } from "../components/VideoScheduleActions";
import { img } from "../img";
import { resolvePlayerKind, type WatchSourceMode } from "./watchPlayerMode";
import { Alert, Button, ButtonAnchor, Checkbox, MenuSeparator, Switch } from "../components/ui";
import { WatchPanel } from "../components/WatchPanel";
import VideoCreators from "../components/VideoCreators";
import { normalizeSponsorSegments } from "../sponsorblock";

let ytApiReady: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (!ytApiReady) {
    ytApiReady = new Promise<void>((resolve) => {
      const w = window as any;
      if (w.YT?.Player) { resolve(); return; }
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      if (!document.querySelector('script[src*="iframe_api"]')) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }
    });
  }
  return ytApiReady;
}

const CINEMA_MODE_KEY = "watchCinemaMode";
const SIDEBAR_KEY = "sidebar_open";
const DESCRIPTION_COLLAPSED_HEIGHT = 148;

function restoreSidebarVisibility() {
  document.body.classList.remove("cinema");
  document.body.classList.toggle("sidebar-hidden", localStorage.getItem(SIDEBAR_KEY) === "0");
}
function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Render plain text with URLs turned into clickable links. */
function rewriteYouTubeUrl(url: string, base: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      if (id) return `${base}/watch/${id}`;
    }
    if (h === "youtube.com") {
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `${base}/watch/${id}`;
      }
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        if (id) return `${base}/watch/${id}`;
      }
      if (u.pathname.startsWith("/channel/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `${base}/channel/${id}`;
      }
    }
  } catch {}
  return null;
}

// YouTube glues a truncation marker straight onto long links in descriptions
// (e.g. "https://makerworld.com...​" with a trailing ellipsis + zero-width
// space). Peel that — plus stray trailing punctuation — off the URL so the href
// isn't broken and the leftover renders as plain text, the way YouTube shows it.
function splitTrailingJunk(url: string): [string, string] {
  let u = url;
  let trailing = "";
  const junk = /(\.\.\.|[​‌‍﻿…)\].,;:!?'"»」]+)$/;
  let m: RegExpMatchArray | null;
  while ((m = u.match(junk)) && m[0].length && u.length - m[0].length > "https://".length) {
    trailing = m[0] + trailing;
    u = u.slice(0, u.length - m[0].length);
  }
  return [u, trailing];
}

function MentionText({ text, channelHandles }: { text: string; channelHandles: Map<string, string> }) {
  const parts = text.split(/(@[\p{L}\p{N}._-]+)/gu);
  return parts.map((part, index) => {
    const channelId = part.startsWith("@") ? channelHandles.get(part.toLocaleLowerCase()) : undefined;
    return channelId ? (
      <Link key={index} to={`/channel/${channelId}`} className="desc-link" onClick={(event) => event.stopPropagation()}>
        {part}
      </Link>
    ) : part;
  });
}

function Linkify({ text, baseUrl, channelHandles = new Map() }: { text: string; baseUrl: string; channelHandles?: Map<string, string> }) {
  const base = baseUrl || window.location.origin;
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!/^https?:\/\//.test(p)) return <MentionText key={i} text={p} channelHandles={channelHandles} />;
        const [url, trailing] = splitTrailingJunk(p);
        const local = rewriteYouTubeUrl(url, base);
        return (
          <span key={i}>
            {local ? (
              <a href={local} className="desc-link" onClick={(e) => e.stopPropagation()}>
                {url}
              </a>
            ) : (
              <a href={url} target="_blank" rel="noreferrer" className="desc-link" onClick={(e) => e.stopPropagation()}>
                {url}
              </a>
            )}
            {trailing}
          </span>
        );
      })}
    </>
  );
}

export default function WatchPage() {
  const { t, bucketLabel, language, locale } = useI18n();
  const { id, playlistId } = useParams<{ id: string; playlistId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [video, setVideo] = useState<Video | null>(null);
  const [videoMissing, setVideoMissing] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [related, setRelated] = useState<Video[]>([]);
  const [copyKey, setCopyKey] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareWithTimestamp, setShareWithTimestamp] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [downloadSubtitleLanguages, setDownloadSubtitleLanguages] = useState<string[]>([]);
  const [playbackPolicy, setPlaybackPolicy] = useState<{
    ready: boolean;
    downloadsEnabled: boolean;
    isChildProfile: boolean;
    childDownloadsOnly: boolean;
    pluginWatchMode: WatchSourceMode;
  }>({
    ready: false,
    downloadsEnabled: false,
    isChildProfile: false,
    childDownloadsOnly: false,
    pluginWatchMode: "youtube",
  });
  const {
    ready: playbackPolicyReady,
    downloadsEnabled,
    isChildProfile,
    childDownloadsOnly,
    pluginWatchMode,
  } = playbackPolicy;
  const [descOpen, setDescOpen] = useState(false);
  const [descExpandable, setDescExpandable] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreView, setMoreView] = useState<"root" | "speed" | "watchlater" | "playlist">("root");
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistIcon, setNewPlaylistIcon] = useState("ListMusic");
  const [cinemaMode, setCinemaMode] = useState(() => localStorage.getItem(CINEMA_MODE_KEY) === "1");
  const [cinemaVisible, setCinemaVisible] = useState(() => localStorage.getItem(CINEMA_MODE_KEY) === "1");
  const [sbSegments, setSbSegments] = useState<SponsorSegment[]>([]);
  const [appUrl, setAppUrl] = useState("");
  const [sbPaused, setSbPaused] = useState(false);
  const [disabledSegs, setDisabledSegs] = useState<Set<string>>(new Set());
  const [chapters, setChapters] = useState<VideoChapter[]>([]);
  const [videoPlaylists, setVideoPlaylists] = useState<VideoChannelPlaylist[]>([]);
  const [videoCreators, setVideoCreators] = useState<VideoCreator[]>([]);
  const creatorHandles = new Map(
    videoCreators
      .filter((creator) => creator.handle)
      .map((creator) => [creator.handle.toLocaleLowerCase(), creator.channelId]),
  );
  const [playlistVideos, setPlaylistVideos] = useState<PlaylistVideo[]>([]);
  const [speed, setSpeed] = useState("1");
  const [shortcutFeedback, setShortcutFeedback] = useState<{ kind: "back" | "forward" | "volumeUp" | "volumeDown" | "speed" | "sponsorblock"; id: number; seconds?: number; category?: string } | null>(null);
  // "auto" plays the local file when one exists; "youtube" forces the iframe.
  const [playerSource, setPlayerSource] = useState<"auto" | "youtube">("auto");
  // watch_source_mode = "ask"/"download": what the viewer decided for THIS video.
  const [sourceChoice, setSourceChoice] = useState<"undecided" | "youtube" | "wait">("undecided");
  const [waitProgress, setWaitProgress] = useState<{ percent: number; speed: string | null } | null>(null);
  const [waitError, setWaitError] = useState<string | null>(null);
  const [youtubeAutoplayBlocked, setYoutubeAutoplayBlocked] = useState(false);
  const [youtubeError, setYoutubeError] = useState<number | null>(null);
  // Path to the next playlist video, read by the player's onStateChange when a
  // video ends. A ref keeps the player effect free of playlist dependencies.
  const nextInPlaylistRef = useRef<string | null>(null);
  const scheduleMenuRef = useRef<HTMLDivElement>(null);
  const playlistMenuRef = useRef<HTMLDivElement>(null);
  const playlistItemsRef = useRef<HTMLDivElement>(null);
  const activePlaylistItemRef = useRef<HTMLAnchorElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  // Desired playback rate, read by the player's onReady/onStateChange so the
  // player effect doesn't need speed in its dependency list.
  const speedRef = useRef("1");
  const spaceHoldTimerRef = useRef<number | null>(null);
  const spaceHoldActiveRef = useRef(false);
  const shortcutFeedbackTimerRef = useRef<number | null>(null);
  const likeButtonRef = useRef<HTMLButtonElement>(null);
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  // Container the YT iframe is injected into; separate from playerWrapRef so
  // the manual DOM cleanup never touches the React-rendered LocalPlayer.
  const ytWrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const archivedRef = useRef(false);
  const progressRef = useRef<{ position: number; duration: number } | null>(null);
  const sbSegmentsRef = useRef<SponsorSegment[]>([]);
  const sbPausedRef = useRef(false);
  const disabledSegsRef = useRef<Set<string>>(new Set());
  const recordedSbSegsRef = useRef<Set<string>>(new Set());

  const showShortcutFeedback = useCallback((kind: "back" | "forward" | "volumeUp" | "volumeDown" | "speed" | "sponsorblock", seconds?: number, category?: string) => {
    if (shortcutFeedbackTimerRef.current) window.clearTimeout(shortcutFeedbackTimerRef.current);
    setShortcutFeedback({ kind, id: Date.now(), seconds, category });
    shortcutFeedbackTimerRef.current = window.setTimeout(() => setShortcutFeedback(null), kind === "sponsorblock" ? 1_400 : 520);
  }, []);

  useLayoutEffect(() => {
    const element = descriptionRef.current;
    if (!element) {
      setDescExpandable(false);
      return;
    }
    const measure = () => setDescExpandable(element.scrollHeight > DESCRIPTION_COLLAPSED_HEIGHT + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [video?.description, video?.views, video?.likes, video?.published_at, videoInfo?.description, videoInfo?.viewCount, videoInfo?.publishedAt, videoMissing, isChildProfile]);

  useEffect(() => {
    if (!scheduleOpen && !playlistOpen && !speedOpen && !shareOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Element;
      if (scheduleMenuRef.current?.contains(target)) return;
      if (playlistMenuRef.current?.contains(target)) return;
      if (speedMenuRef.current?.contains(target)) return;
      if (shareMenuRef.current?.contains(target)) return;
      if (target.closest?.(".playlist-icon-popover")) return;
      setScheduleOpen(false);
      setPlaylistOpen(false);
      setSpeedOpen(false);
      setShareOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [scheduleOpen, playlistOpen, speedOpen, shareOpen]);

  useEffect(() => {
    api.settings().then((r) => setSettings(r.settings)).catch(() => setSettings(null));
    api.config().then((r) => setAppUrl(r.app_url)).catch(() => {});
    let cancelled = false;
    void (async () => {
      const [childStatus, plugins] = await Promise.all([
        api.childStatus().catch(() => null),
        api.plugins().catch(() => ({ plugins: [] })),
      ]);
      const downloadsEnabled = plugins.plugins.some((p) => p.id === "downloads" && p.enabled);
      const pluginSettings = await api.pluginSettings("downloads").catch(() => null);
      const subtitleLanguages = String(pluginSettings?.settings.sub_langs ?? "")
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean);
      let pluginWatchMode: WatchSourceMode = "youtube";
      if (downloadsEnabled) {
        const configuredMode = pluginSettings?.settings.watch_source_mode;
        if (configuredMode === "ask" || configuredMode === "download") pluginWatchMode = configuredMode;
      }
      if (cancelled) return;
      setDownloadSubtitleLanguages(subtitleLanguages);
      setPlaybackPolicy({
        ready: true,
        downloadsEnabled,
        isChildProfile: childStatus?.is_child ?? false,
        childDownloadsOnly: !!(childStatus?.is_child && childStatus.downloads_only),
        pluginWatchMode,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  const downloadStatus = video?.download_status ?? null;
  // Which surface fills the player area. Children never get a choice: with
  // downloads_only they are locked to local files, otherwise plain YouTube.
  const watchMode = downloadsEnabled && !isChildProfile ? pluginWatchMode : "youtube";
  const playerKind = resolvePlayerKind({
    hasVideo: !!video,
    isLive: video?.live_status === "live" || video?.live_status === "upcoming",
    downloadStatus,
    playerSource,
    playbackPolicyReady,
    childDownloadsOnly,
    sourceChoice,
    watchMode,
  });
  const membersOnlyNotice = video?.members_only === 1 && !isChildProfile;
  const usingLocal = playerKind === "local" && !membersOnlyNotice;
  const sharedTimestamp = Number(new URLSearchParams(location.search).get("t"));
  const sharedStartSeconds = Number.isFinite(sharedTimestamp) ? Math.max(0, Math.floor(sharedTimestamp)) : 0;
  const keyboardSeekSeconds = Math.max(1, Number(settings?.keyboard_seek_seconds ?? "5") || 5);
  const rawSubtitleSize = settings?.player_sub_size;
  const subtitleSize = rawSubtitleSize === "small" ? 14
    : rawSubtitleSize === "large" ? 26
      : rawSubtitleSize === "medium" ? 19
        : Math.min(48, Math.max(12, Number(rawSubtitleSize) || 19));
  // A channel can either inherit the profile preference, explicitly turn
  // captions off, or force one language. These values apply to both players.
  const channelCaptionsOff = video?.channel_caption_mode === "off";
  const channelCaptionLanguage = video?.channel_caption_mode === "language"
    ? video.channel_caption_language
    : null;
  const captionsDefaultOn = !channelCaptionsOff && (Boolean(channelCaptionLanguage) || settings?.player_cc === "1");
  const captionsDefaultLang = channelCaptionLanguage || settings?.player_cc_lang || settings?.player_hl || "en";

  const changeSubtitleSize = useCallback((size: number) => {
    const value = String(size);
    setSettings((current) => current ? { ...current, player_sub_size: value } : current);
    api.updateSettings({ player_sub_size: value }).catch(console.error);
  }, []);

  const requestYouTubePlayback = useCallback(() => {
    setYoutubeAutoplayBlocked(false);
    const p = playerRef.current;
    try {
      const iframe = p?.getIframe?.() as HTMLIFrameElement | undefined;
      if (iframe) {
        const permissions = new Set((iframe.getAttribute("allow") ?? "").split(";").map((v) => v.trim()).filter(Boolean));
        permissions.add("autoplay");
        permissions.add("picture-in-picture");
        iframe.setAttribute("allow", [...permissions].join("; "));
      }
      p?.playVideo?.();
    } catch {}
  }, []);

  const chooseYouTube = useCallback(() => {
    setYoutubeAutoplayBlocked(false);
    setSourceChoice("youtube");
  }, []);

  useEffect(() => {
    setYoutubeError(null);
  }, [id, playerKind]);

  // Effective playback rate: per-channel override, else the global default.
  // Kept in a ref so the player effect can read it without re-creating the player.
  useEffect(() => {
    const eff = video?.channel_playback_speed ?? settings?.player_speed ?? "1";
    setSpeed(eff);
    speedRef.current = eff;
  }, [video?.channel_playback_speed, settings?.player_speed]);

  useEffect(() => {
    sbSegmentsRef.current = sbSegments;
  }, [sbSegments]);
  useEffect(() => { sbPausedRef.current = sbPaused; }, [sbPaused]);
  useEffect(() => { disabledSegsRef.current = disabledSegs; }, [disabledSegs]);

  // Reset skip overrides when navigating to another video.
  useEffect(() => {
    setSbPaused(false);
    setDisabledSegs(new Set());
    recordedSbSegsRef.current.clear();
  }, [id]);

  useEffect(() => {
    setVideoCreators([]);
    if (!video?.video_id) return;
    let cancelled = false;
    api.videoCreators(video.video_id)
      .then((result) => { if (!cancelled) setVideoCreators(result.creators); })
      .catch(() => { if (!cancelled) setVideoCreators([]); });
    return () => { cancelled = true; };
  }, [video?.video_id]);

  useEffect(() => {
    setChapters([]);
    setVideoPlaylists([]);
    if (!id) return;
    let cancelled = false;
    Promise.allSettled([api.chapters(id), api.videoPlaylists(id)]).then(([chapterResult, playlistResult]) => {
      if (cancelled) return;
      setChapters(chapterResult.status === "fulfilled" ? chapterResult.value.chapters : []);
      setVideoPlaylists(playlistResult.status === "fulfilled" ? playlistResult.value.playlists : []);
    });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!playlistId) { setPlaylistVideos([]); return; }
    let cancelled = false;
    api.playlistVideos(playlistId)
      .then((r) => { if (!cancelled) setPlaylistVideos(r.videos); })
      .catch(() => { if (!cancelled) setPlaylistVideos([]); });
    return () => { cancelled = true; };
  }, [playlistId]);

  const playlistIndex = playlistId ? playlistVideos.findIndex((v) => v.videoId === id) : -1;

  useEffect(() => {
    const container = playlistItemsRef.current;
    const activeItem = activePlaylistItemRef.current;
    if (!playlistId || playlistIndex < 0 || !container || !activeItem) return;

    let animationFrame = 0;
    const startFrame = requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      const start = container.scrollTop;
      const unclampedTarget = start + itemRect.top - containerRect.top - (container.clientHeight - itemRect.height) / 2;
      const target = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, unclampedTarget));
      const distance = target - start;

      if (Math.abs(distance) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        container.scrollTop = target;
        return;
      }

      const duration = 420;
      const startedAt = performance.now();
      const animate = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        container.scrollTop = start + distance * eased;
        if (progress < 1) animationFrame = requestAnimationFrame(animate);
      };
      animationFrame = requestAnimationFrame(animate);
    });

    return () => {
      cancelAnimationFrame(startFrame);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [id, playlistId, playlistIndex, playlistVideos.length]);

  // Keep the "next video" target in sync for the player's end-of-video handler.
  useEffect(() => {
    const next = playlistIndex >= 0 ? playlistVideos[playlistIndex + 1] : undefined;
    nextInPlaylistRef.current = next ? `/watch/${next.videoId}/playlist/${playlistId}` : null;
  }, [playlistIndex, playlistVideos, playlistId]);

  useEffect(() => {
    if (!video || settings?.sponsorblock_enabled !== "1") {
      setSbSegments([]);
      return;
    }
    let cancelled = false;
    const cats = (() => {
      try { return JSON.parse(settings.sponsorblock_categories || '["sponsor"]') as string[]; }
      catch { return ["sponsor"]; }
    })();
    if (cats.length === 0) { setSbSegments([]); return; }
    api.sponsorblock(video.video_id, cats)
      .then((segs) => {
        if (cancelled) return;
        setSbSegments(normalizeSponsorSegments(video.video_id, segs));
      })
      .catch(() => { if (!cancelled) setSbSegments([]); });
    return () => { cancelled = true; };
  }, [video?.video_id, settings?.sponsorblock_enabled, settings?.sponsorblock_categories]);

  useEffect(() => {
    if (!id) return;
    setDescOpen(false);
    setVideo(null);
    setVideoMissing(false);
    setVideoInfo(null);
    setPlayerSource("auto");
    setSourceChoice("undecided");
    setYoutubeAutoplayBlocked(false);
    setWaitProgress(null);
    setWaitError(null);
    archivedRef.current = false;
    window.scrollTo(0, 0);
    api
      .video(id)
      .then((r) => {
        setVideo(r.video);
        setRelated(r.related);
        // External video already in DB but its RSS siblings were cleared:
        // refresh them in the background so the "related" panel refills.
        if (r.video.external && r.related.length === 0) {
          api.videoInfo(id)
            .then(() => api.video(id))
            .then((r2) => setRelated(r2.related))
            .catch(() => {});
        }
      })
      .catch((e: Error) => {
        if (e.message === "not found" || e.message === "HTTP 404") {
          setVideoMissing(true);
          api.videoInfo(id)
            .then((r) => {
              setVideoInfo(r.info);
              // Video was just inserted as external — fetch the full Video object
              return api.video(id).then((full) => {
                setVideo(full.video);
                setRelated(full.related);
                setVideoMissing(false);
                setVideoInfo(null);
              });
            })
            .catch(() => {});
        } else {
          console.error(e);
        }
      });
    api.watch(id).catch(() => {});
  }, [id]);

  // When a video finishes: record completion, advance the playlist if any.
  const handleEnded = useCallback(() => {
    if (!id) return;
    api.complete(id).catch(() => {});
    if (nextInPlaylistRef.current) navigate(nextInPlaylistRef.current);
  }, [id, navigate]);
  const handleEndedRef = useRef(handleEnded);
  useEffect(() => { handleEndedRef.current = handleEnded; }, [handleEnded]);

  // Create the player (YT iframe or the ref populated by LocalPlayer) and poll
  // progress every second. The poll runs against the shared YT-shaped player
  // API, so progress saving, auto-archive and SponsorBlock work for both.
  useEffect(() => {
    if (!id || (!video && !videoMissing)) return;

    const canAutoArchive = video ? (video.live_status !== "live" && video.live_status !== "upcoming") : false;

    const startSeconds = sharedStartSeconds || (
      video?.watch_position && video?.watch_duration && video.watch_duration > 0 &&
      video.watch_position / video.watch_duration < 0.9
        ? Math.floor(video.watch_position) : 0
    );

    const poll = () => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      try {
        const position = p.getCurrentTime() as number;
        const playerDuration = p.getDuration() as number;
        if (!position || !playerDuration) return;
        progressRef.current = { position, duration: playerDuration };
        if (p.getPlayerState?.() !== 1) return;
        api.saveProgress(id, position, playerDuration).catch(() => {});
        if (canAutoArchive && playerDuration > 30 && position / playerDuration >= 0.9 && !archivedRef.current) {
          archivedRef.current = true;
          api.saveProgress(id, playerDuration, playerDuration).catch(() => {});
          api.complete(id).catch(() => {});
          api.archiveVideo(id).catch(() => {});
        }
        if (!sbPausedRef.current) {
          for (const seg of sbSegmentsRef.current) {
            if (disabledSegsRef.current.has(seg.UUID)) continue;
            if (position >= seg.segment[0] && position < seg.segment[1] - 0.3) {
              const skippedSeconds = seg.segment[1] - position;
              p.seekTo(seg.segment[1], true);
              showShortcutFeedback("sponsorblock", skippedSeconds, seg.category);
              if (!recordedSbSegsRef.current.has(seg.UUID)) {
                recordedSbSegsRef.current.add(seg.UUID);
                api.recordSponsorBlockSkip(id, seg, skippedSeconds).catch((error) => {
                  console.warn("SponsorBlock skip could not be recorded", error);
                  recordedSbSegsRef.current.delete(seg.UUID);
                });
              }
              break;
            }
          }
        }
      } catch {}
    };

    const saveOnExit = () => {
      if (progressRef.current && !archivedRef.current) {
        const { position, duration } = progressRef.current;
        api.saveProgress(id, position, duration).catch(() => {});
        progressRef.current = null;
      }
    };

    if (membersOnlyNotice) return;

    if (playerKind === "local") {
      // LocalPlayer renders the <video> itself and fills playerRef via its ref.
      const pollInterval = setInterval(poll, 1_000);
      return () => {
        clearInterval(pollInterval);
        saveOnExit();
      };
    }

    // Decision/waiting/blocked panels have no player to drive.
    if (playerKind !== "youtube") return;

    const wrap = ytWrapRef.current;
    if (!wrap) return;

    const playerVars: Record<string, any> = {
      autoplay: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
      origin: window.location.origin,
    };
    if (startSeconds > 10) playerVars.start = startSeconds;
    if (settings?.player_hl) playerVars.hl = settings.player_hl;
    if (captionsDefaultOn) {
      playerVars.cc_load_policy = 1;
      playerVars.cc_lang_pref = captionsDefaultLang;
    } else if (channelCaptionsOff) {
      // Do not merely omit cc_load_policy: the embedded player can otherwise
      // restore a caption track from the browser's YouTube preference.
      playerVars.cc_load_policy = 0;
    }
    if (settings?.player_quality && settings.player_quality !== "auto") playerVars.vq = settings.player_quality;

    let pollInterval: ReturnType<typeof setInterval>;
    let destroyed = false;
    // YT resets the rate to 1× on load, so apply the desired speed once the
    // player is ready and again on the first PLAYING event to make it stick.
    let speedApplied = false;
    const applySpeed = (p: any) => {
      try { p?.setPlaybackRate(Number(speedRef.current)); } catch {}
    };

    const inner = document.createElement("div");
    inner.id = `yt-inner-${id}`;
    wrap.appendChild(inner);

    loadYouTubeApi().then(() => {
      if (destroyed) return;
      const w = window as any;
      playerRef.current = new w.YT.Player(`yt-inner-${id}`, {
        host: "https://www.youtube-nocookie.com",
        videoId: id,
        width: "100%",
        height: "100%",
        playerVars,
        events: {
          onReady: (e: any) => {
            if (destroyed) return;
            applySpeed(e.target);
            if (channelCaptionsOff) {
              try { e.target.unloadModule?.("captions"); } catch {}
            }
            requestYouTubePlayback();
          },
          onAutoplayBlocked: () => {
            if (!destroyed) setYoutubeAutoplayBlocked(true);
          },
          onStateChange: (e: any) => {
            // 1 === playing: apply the desired speed once (YT resets on load).
            if (e?.data === 1 && !speedApplied) {
              speedApplied = true;
              applySpeed(e.target);
            }
            // 0 === ended
            if (e?.data === 0) handleEndedRef.current();
          },
          onError: (e: any) => {
            if (!destroyed) setYoutubeError(Number(e?.data) || null);
          },
        },
      });

      pollInterval = setInterval(poll, 1_000);
    });

    return () => {
      destroyed = true;
      clearInterval(pollInterval);
      saveOnExit();
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    };
  }, [id, video?.video_id, videoMissing, membersOnlyNotice, playerKind, requestYouTubePlayback, captionsDefaultOn, captionsDefaultLang, channelCaptionsOff, sharedStartSeconds]);

  // Waiting panel: make sure the download is queued with top priority, then
  // track its progress until the file is ready (the local player takes over)
  // or the download fails.
  useEffect(() => {
    if (membersOnlyNotice || playerKind !== "waiting" || !id) return;
    let cancelled = false;
    setWaitError(null);
    api.requestDownload(id, true).catch(() => {});
    const timer = setInterval(() => {
      api.videoDownload(id).then((r) => {
        if (cancelled) return;
        setWaitProgress(r.progress ? { percent: r.progress.percent, speed: r.progress.speed } : null);
        const status = r.download?.status ?? null;
        if (status === "error") setWaitError(r.download?.error ?? "error");
        setVideo((prev) => prev && prev.download_status !== status ? { ...prev, download_status: status } : prev);
      }).catch(() => {});
    }, 1_500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [playerKind, id, membersOnlyNotice]);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Element;
      if (moreMenuRef.current?.contains(target)) return;
      if (target.closest?.(".playlist-icon-popover")) return;
      if (target.closest?.(".popconfirm-popover")) return;
      setMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) setMoreView("root");
  }, [moreOpen]);

  // Apply a speed: change playback now and persist it as this channel's override
  // (null clears the override, falling back to the global default).
  const changeSpeed = (v: string | null) => {
    const eff = v ?? settings?.player_speed ?? "1";
    setSpeed(eff);
    speedRef.current = eff;
    try { playerRef.current?.setPlaybackRate(Number(eff)); } catch {}
    setMoreOpen(false);
    setSpeedOpen(false);
    if (video) {
      api.setChannelSpeed(video.channel_id, v).catch(() => {});
      setVideo((prev) => (prev ? { ...prev, channel_playback_speed: v } : prev));
    }
  };

  // Cinema class lifecycle — separated from key listener so cleanup doesn't
  // prematurely remove the class when transitioning out.
  useEffect(() => {
    localStorage.setItem(CINEMA_MODE_KEY, cinemaMode ? "1" : "0");
    if (cinemaMode) {
      document.body.classList.add("cinema", "sidebar-hidden");
      requestAnimationFrame(() => requestAnimationFrame(() => setCinemaVisible(true)));
    } else {
      setCinemaVisible(false);
      const t = setTimeout(() => {
        restoreSidebarVisibility();
      }, 400);
      return () => {
        clearTimeout(t);
        restoreSidebarVisibility();
      };
    }
  }, [cinemaMode]);

  // Escape key — only active in cinema mode
  useEffect(() => {
    if (!cinemaMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCinemaMode(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cinemaMode]);

  // Unmount: clean cinema mode without overriding the user's saved sidebar state.
  useEffect(() => restoreSidebarVisibility, []);

  // Mobile: rotating to landscape enters player fullscreen (opt-in setting).
  // Chrome for Android permits requestFullscreen() inside a user-generated
  // orientation-change handler — the call must stay synchronous or that
  // exemption is lost. iPhones lack element fullscreen entirely, so fall back
  // to the <video> element's webkitEnterFullscreen (local player only).
  useEffect(() => {
    if (settings?.auto_fullscreen_landscape !== "1") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    // screen.orientation.type updates before its change event fires; the
    // matchMedia fallback can still report the OLD orientation at that point.
    const isLandscape = () => {
      const type = (screen as any).orientation?.type as string | undefined;
      if (type) return type.startsWith("landscape");
      return window.matchMedia("(orientation: landscape)").matches;
    };
    const enterFullscreen = () => {
      const el = playerWrapRef.current;
      if (!el || document.fullscreenElement) return;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else {
        const vid = el.querySelector("video") as any;
        try { vid?.webkitEnterFullscreen?.(); } catch {}
      }
    };
    const onOrientation = () => {
      if (isLandscape()) enterFullscreen();
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    const orientation: any = (screen as any).orientation;
    orientation?.addEventListener?.("change", onOrientation);
    window.addEventListener("orientationchange", onOrientation);
    // Opened already in landscape: no rotation event will come. Try once —
    // the tap that navigated here usually still counts as user activation.
    let initialTimer: number | undefined;
    if (isLandscape()) initialTimer = window.setTimeout(enterFullscreen, 400);
    return () => {
      if (initialTimer) window.clearTimeout(initialTimer);
      orientation?.removeEventListener?.("change", onOrientation);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, [settings?.auto_fullscreen_landscape, id]);

  // Keyboard shortcuts: T = cinema, F = fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input,textarea,select")) return;
      if (e.key === "t" || e.key === "T") setCinemaMode((v) => !v);
      if (e.key === "f" || e.key === "F") {
        const el = playerWrapRef.current ?? document.documentElement;
        if (!document.fullscreenElement) el.requestFullscreen?.();
        else document.exitFullscreen?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The YouTube iframe only receives its built-in shortcuts after it has been
  // focused. Mirror the essential playback keys at the page level so they
  // work immediately after playback starts; LocalPlayer owns these itself.
  useEffect(() => {
    if (playerKind !== "youtube") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      const player = playerRef.current;
      if (!player) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat || spaceHoldTimerRef.current != null || spaceHoldActiveRef.current) return;
        spaceHoldTimerRef.current = window.setTimeout(() => {
          spaceHoldTimerRef.current = null;
          const activePlayer = playerRef.current;
          if (!activePlayer) return;
          spaceHoldActiveRef.current = true;
          activePlayer.setPlaybackRate?.(2);
          showShortcutFeedback("speed");
        }, 220);
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const current = player.getCurrentTime?.();
        const duration = player.getDuration?.();
        if (!Number.isFinite(current) || !Number.isFinite(duration)) return;
        e.preventDefault();
        const delta = e.key === "ArrowLeft" ? -keyboardSeekSeconds : keyboardSeekSeconds;
        const next = Math.min(Math.max(0, current + delta), duration);
        player.seekTo?.(next, true);
        showShortcutFeedback(e.key === "ArrowLeft" ? "back" : "forward", keyboardSeekSeconds);
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const volume = player.getVolume?.();
        if (!Number.isFinite(volume)) return;
        e.preventDefault();
        const next = Math.min(100, Math.max(0, volume + (e.key === "ArrowUp" ? 5 : -5)));
        player.setVolume?.(next);
        if (next > 0) player.unMute?.();
        showShortcutFeedback(e.key === "ArrowUp" ? "volumeUp" : "volumeDown");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      e.preventDefault();
      if (spaceHoldTimerRef.current != null) {
        window.clearTimeout(spaceHoldTimerRef.current);
        spaceHoldTimerRef.current = null;
        const player = playerRef.current;
        if (player?.getPlayerState?.() === 1) player.pauseVideo?.();
        else player?.playVideo?.();
      } else if (spaceHoldActiveRef.current) {
        spaceHoldActiveRef.current = false;
        playerRef.current?.setPlaybackRate?.(Number(speedRef.current));
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
  }, [playerKind, showShortcutFeedback, keyboardSeekSeconds]);

  // Refresh views + likes in the background every 30 s while watching
  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => {
      api.video(id).then((r) => {
        setVideo((prev) => prev ? { ...prev, views: r.video.views, likes: r.video.likes, download_status: r.video.download_status } : prev);
      }).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [id]);

  // While this video is being fetched by the downloader, poll faster so the
  // download button reflects reality without a reload.
  useEffect(() => {
    if (!id || (downloadStatus !== "queued" && downloadStatus !== "downloading")) return;
    const t = setInterval(() => {
      api.video(id).then((r) => {
        setVideo((prev) => prev ? { ...prev, download_status: r.video.download_status } : prev);
      }).catch(() => {});
    }, 5_000);
    return () => clearInterval(t);
  }, [id, downloadStatus]);

  const requestDownload = () => {
    if (!video) return;
    setVideo((prev) => prev ? { ...prev, download_status: "queued" } : prev);
    api.requestDownload(video.video_id).catch(() => {
      setVideo((prev) => prev ? { ...prev, download_status: null } : prev);
    });
  };

  const cancelOrRemoveDownload = () => {
    if (!video) return;
    setPlayerSource("auto");
    setVideo((prev) => prev ? { ...prev, download_status: null } : prev);
    api.removeDownload(video.video_id).catch(() => {});
  };

  useEffect(() => {
    const title = (video?.title ?? videoInfo?.title ?? "").trim();
    document.title = title || (id ? `YouTube video ${id}` : "YouTube video");
  }, [id, video?.title, videoInfo?.title]);

  if (!video && !videoMissing) return null;

  const reload = () => video && api.video(video.video_id).then((r) => setVideo(r.video));

  const toggleRelatedSchedule = async (relatedVideo: Video, bucket: Bucket, active: boolean) => {
    if (active) await api.dequeue(relatedVideo.video_id);
    else await api.queue(relatedVideo.video_id, bucket);
    setRelated((current) => current.map((item) => item.video_id === relatedVideo.video_id
      ? { ...item, status: active ? "inbox" : "queued", bucket: active ? null : bucket }
      : item));
    emit("queue-changed");
    emitToast(t(active ? "scheduleRemovedFeedback" : "scheduledFeedback"), active ? "default" : "scheduled");
  };

  const shareLink = (destination: "webpage" | "youtube") => {
    if (!video) return;
    let seconds = 0;
    if (shareWithTimestamp) {
      try { seconds = Math.max(0, Math.floor(Number(playerRef.current?.getCurrentTime?.()) || 0)); } catch {}
    }
    return destination === "webpage"
      ? `${window.location.origin}/watch/${video.video_id}${seconds ? `?t=${seconds}` : ""}`
      : `https://www.youtube.com/watch?v=${video.video_id}${seconds ? `&t=${seconds}s` : ""}`;
  };

  const copyShareLink = (destination: "webpage" | "youtube") => {
    const link = shareLink(destination);
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopyKey((k) => k + 1);
    });
  };

  const queue = async (bucket: Bucket) => {
    if (!video) return;
    setMoreOpen(false);
    setScheduleOpen(false);
    await api.queue(video.video_id, bucket);
    emit("queue-changed");
    emitToast(t("scheduledFeedback"), "scheduled");
    reload();
  };

  const openPlaylistMenu = async () => {
    if (!video) return;
    setMoreView("playlist");
    const r = await api.userPlaylists(video.video_id);
    setPlaylists(r.playlists);
  };

  const toggleDesktopPlaylist = async () => {
    if (!video) return;
    const next = !playlistOpen;
    setPlaylistOpen(next);
    if (next) {
      const r = await api.userPlaylists(video.video_id);
      setPlaylists(r.playlists);
    }
  };

  const togglePlaylist = async (playlist: UserPlaylist) => {
    if (!video) return;
    const hasVideo = playlist.has_video === 1;
    if (hasVideo) await api.removeVideoFromUserPlaylist(playlist.id, video.video_id);
    else await api.addVideoToUserPlaylist(playlist.id, video.video_id);
    setPlaylists((items) =>
      items.map((p) =>
        p.id === playlist.id
          ? { ...p, has_video: hasVideo ? 0 : 1, video_count: Math.max(0, p.video_count + (hasVideo ? -1 : 1)) }
          : p
      )
    );
    emit("playlists-changed");
  };

  const createPlaylist = async () => {
    if (!video || !newPlaylistName.trim()) return;
    const r = await api.createUserPlaylist({ name: newPlaylistName.trim(), icon: newPlaylistIcon });
    await api.addVideoToUserPlaylist(r.playlist.id, video.video_id);
    setPlaylists((items) => [...items, { ...r.playlist, has_video: 1, video_count: 1 }]);
    setNewPlaylistName("");
    setNewPlaylistIcon("ListMusic");
    emit("playlists-changed");
  };

  const toggleLiked = async () => {
    if (!video) return;
    const next = video.liked !== 1;
    if (next && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const rect = likeButtonRef.current?.getBoundingClientRect();
      confetti({
        particleCount: 90,
        spread: 65,
        startVelocity: 36,
        scalar: 0.85,
        origin: rect
          ? {
              x: (rect.left + rect.width / 2) / window.innerWidth,
              y: (rect.top + rect.height / 2) / window.innerHeight,
            }
          : { x: 0.5, y: 0.65 },
      });
    }
    setVideo((prev) => prev ? { ...prev, liked: next ? 1 : null } : prev);
    try {
      await api.likeVideo(video.video_id, next);
    } catch (e) {
      setVideo((prev) => prev ? { ...prev, liked: next ? null : 1 } : prev);
      console.error(e);
    }
  };

  return (
    <div className={`watch-layout${cinemaMode ? " theater" : ""}`}>
      <div>
        <div className="cinema-player-wrap">
          {video && (
            <div
              className="player-glow"
              style={{ backgroundImage: `url(${img(video.thumbnail)})`, opacity: cinemaVisible ? 0.6 : 0 }}
            />
          )}
          <div className="watch-player-shell">
            <div ref={playerWrapRef} className={`watch-player${usingLocal ? " watch-player--local" : ""}`}>
              {membersOnlyNotice && video ? (
                <div className="wp-panel wp-panel--members" style={{ backgroundImage: `url(${img(video.thumbnail)})` }}>
                  <div className="wp-panel-scrim" />
                  <div className="wp-panel-content">
                    <span className="wp-members-icon" aria-hidden="true"><Star fill="currentColor" /></span>
                    <h3>{t("membersOnlyWatchTitle")}</h3>
                    <p className="wp-panel-sub">{t("membersOnlyWatchDescription")}</p>
                    <ButtonAnchor
                      variant="primary"
                      href={`https://www.youtube.com/watch?v=${video.video_id}`}
                      target="_blank"
                      rel="noreferrer"
                      leadingIcon={<ExternalLink />}
                    >
                      {t("membersOnlyWatchAction")}
                    </ButtonAnchor>
                  </div>
                </div>
              ) : playerKind === "local" && video ? (
                <LocalPlayer
                  key={`${video.video_id}-local-${sharedStartSeconds}`}
                  ref={playerRef}
                  src={api.streamUrl(video.video_id)}
                  poster={img(video.thumbnail)}
                  startSeconds={
                    sharedStartSeconds
                      || progressRef.current?.position
                      || (video.watch_position && video.watch_duration && video.watch_duration > 0 &&
                          video.watch_position / video.watch_duration < 0.9
                        ? Math.floor(video.watch_position) : 0)
                  }
                  playbackRate={Number(speed)}
                  title={video.title}
                  channelTitle={video.channel_title}
                  artworkUrl={img(video.thumbnail)}
                  chapters={chapters}
                  sbSegments={sbSegments}
                  cinemaMode={cinemaMode}
                  onToggleCinema={() => setCinemaMode((mode) => !mode)}
                  onEnded={handleEnded}
                  keyboardSeekSeconds={keyboardSeekSeconds}
                  onShortcut={showShortcutFeedback}
                  videoId={video.video_id}
                  ccDefaultOn={captionsDefaultOn}
                  ccDefaultLang={captionsDefaultLang}
                  preferredSubtitleLanguages={[captionsDefaultLang, ...downloadSubtitleLanguages]}
                  subtitleStyle={{
                    size: subtitleSize,
                    color: settings?.player_sub_color || "#ffffff",
                    bg: Number(settings?.player_sub_bg ?? 75),
                  }}
                  onSubtitleSizeChange={changeSubtitleSize}
                />
              ) : playerKind === "youtube" ? (
                <div ref={ytWrapRef} className="watch-player-yt" />
              ) : video && (
                <div className="wp-panel" style={{ backgroundImage: `url(${img(video.thumbnail)})` }}>
                  <div className="wp-panel-scrim" />
                  {playerKind === "blocked" && (
                    <div className="wp-panel-content">
                      <ArrowDownToLine size={34} />
                      <h3>{t("watchChildDownloadsOnly")}</h3>
                      {(downloadStatus === "queued" || downloadStatus === "downloading") && (
                        <p className="wp-panel-sub">
                          <LoaderCircle className="spin" size={14} />{" "}
                          {downloadStatus === "queued" ? t("downloadQueued") : t("downloading")}
                        </p>
                      )}
                    </div>
                  )}
                  {playerKind === "loading" && (
                    <div className="wp-panel-content" aria-busy="true">
                      <LoaderCircle className="spin" size={30} />
                    </div>
                  )}
                  {playerKind === "choice" && (
                    <div className="wp-panel-content">
                      <h3>{t("watchChoiceTitle")}</h3>
                      <div className="wp-choice-buttons">
                        <button className="btn primary" onClick={() => setSourceChoice("wait")}>
                          <ArrowDownToLine size={15} /> {t("watchChoiceWait")}
                        </button>
                        <button className="btn" onClick={chooseYouTube}>
                          <MonitorPlay size={15} /> {t("watchChoiceYouTube")}
                        </button>
                      </div>
                    </div>
                  )}
                  {playerKind === "waiting" && (
                    <div className="wp-panel-content">
                      {waitError ? (
                        <>
                          <h3>{t("downloadError")}</h3>
                          <p className="wp-panel-sub wp-panel-error">{waitError}</p>
                        </>
                      ) : (
                        <>
                          <LoaderCircle className="spin" size={30} />
                          <h3>{t("watchWaitingTitle")}</h3>
                          <div className="wp-wait-bar">
                            <div className="wp-wait-fill" style={{ width: `${waitProgress?.percent ?? 0}%` }} />
                          </div>
                          <p className="wp-panel-sub">
                            {waitProgress
                              ? `${Math.floor(waitProgress.percent)}%${waitProgress.speed ? ` · ${waitProgress.speed}` : ""}`
                              : t("downloadQueued")}
                          </p>
                          <p className="wp-panel-hint">{t("watchWaitingHint")}</p>
                        </>
                      )}
                      <button className="btn" onClick={chooseYouTube}>
                        <MonitorPlay size={15} /> {t("watchChoiceYouTube")}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {shortcutFeedback && (() => {
                const Icon = shortcutFeedback.kind === "back" ? Rewind
                  : shortcutFeedback.kind === "forward" ? FastForward
                    : shortcutFeedback.kind === "volumeUp" ? Volume2
                      : shortcutFeedback.kind === "volumeDown" ? Volume1
                        : shortcutFeedback.kind === "sponsorblock" ? FastForward : Gauge;
                const sponsorCategory = shortcutFeedback.category ? SB_CATEGORIES.find((category) => category.id === shortcutFeedback.category) : undefined;
                const label = shortcutFeedback.kind === "back" ? `−${shortcutFeedback.seconds ?? keyboardSeekSeconds} s`
                  : shortcutFeedback.kind === "forward" ? `+${shortcutFeedback.seconds ?? keyboardSeekSeconds} s`
                    : shortcutFeedback.kind === "speed" ? "2×"
                      : shortcutFeedback.kind === "sponsorblock" ? t("sponsorblockSkipped", { category: sponsorCategory ? t(sponsorCategory.labelKey) : shortcutFeedback.category ?? "SponsorBlock" }) : "";
                return <div key={shortcutFeedback.id} className={`shortcut-feedback${shortcutFeedback.kind === "sponsorblock" ? " shortcut-feedback--sponsorblock" : ""}`}><Icon size={19} />{label && <span>{label}</span>}</div>;
              })()}
              {playerKind === "youtube" && youtubeAutoplayBlocked && (
                <div className="wp-autoplay-blocked">
                  <button className="btn primary" onClick={requestYouTubePlayback}>
                    <Play size={16} /> {t("playerPlay")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {playerKind === "youtube" && youtubeError === 153 && (
          <Alert className="youtube-referrer-alert-layout" variant="warning" icon={<AlertTriangle />} title={t("youtubeReferrerErrorTitle")}>{t("youtubeReferrerErrorHint")}</Alert>
        )}
        {(video ?? videoInfo) && (
          <h1 className="watch-title">{video?.title ?? videoInfo?.title}</h1>
        )}
        {videoMissing && videoInfo && (
          <div className="watch-row">
            <div className="watch-channel">
              <div className="watch-channel-top">
                <div>
                  <Link to={`/channel/${videoInfo.channelId}`} className="name channel-link">
                    {videoInfo.channelTitle}
                  </Link>
                </div>
              </div>
            </div>
            {!isChildProfile && (
              <a
                className="btn"
                href={`https://www.youtube.com/watch?v=${videoInfo.videoId}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
                YouTube
              </a>
            )}
          </div>
        )}
        {videoMissing && videoInfo && (
          <div
            ref={descriptionRef}
            className={`watch-desc${descExpandable && !descOpen ? " clamped" : ""}`}
            onClick={() => descExpandable && !descOpen && setDescOpen(true)}
          >
            <div className="watch-desc-stats">
              {videoInfo.viewCount != null && (
                <span className="stat"><Eye /> {formatViewsCount(videoInfo.viewCount, language)}</span>
              )}
              {videoInfo.publishedAt && (
                <span className="stat"><CalendarDays /> {new Date(videoInfo.publishedAt).toLocaleDateString(locale)}</span>
              )}
            </div>
            {videoInfo.description && (
              <>
                <div className="watch-desc-sep" />
                <Linkify text={videoInfo.description} baseUrl={appUrl} channelHandles={creatorHandles} />
              </>
            )}
          </div>
        )}
        {videoMissing && videoInfo?.description && descExpandable && (
          <button className="watch-desc-toggle" onClick={() => setDescOpen((o) => !o)}>
            {descOpen ? t("showLess") : t("showMore")}
          </button>
        )}
        {video && <div className="watch-row">
          <div className="watch-channel">
            <VideoCreators creators={videoCreators.length > 0 ? videoCreators : [{
              channelId: video.channel_id,
              title: video.channel_title,
              avatar: video.channel_thumbnail ?? "",
              subscriberCount: video.channel_subscriber_count ?? "",
              handle: "",
              isOwner: true,
            }]} />
          </div>
          <div className="watch-actions">
            <button
              ref={likeButtonRef}
              className={`btn like-btn${video.liked === 1 ? " active like-active" : ""}`}
              title={video.liked === 1 ? t("unlike") : t("like")}
              aria-pressed={video.liked === 1}
              onClick={toggleLiked}
            >
              <ThumbsUp fill={video.liked === 1 ? "currentColor" : "none"} />
              <span className="btn-label">{t("like")}</span>
            </button>
            <div className="watch-action-group watch-action-group--playback">
            <button
              className={`btn icon-only watch-action-desktop watch-action-medium${cinemaMode ? " active" : ""}`}
              onClick={() => setCinemaMode((m) => !m)}
              title={t("cinemaMode")}
              aria-pressed={cinemaMode}
            >
              <Clapperboard size={15} />
            </button>
            <div className="dropdown watch-action-desktop watch-action-medium" ref={speedMenuRef}>
              <button
                className={`btn${speed !== "1" ? " active" : ""}`}
                onClick={() => setSpeedOpen((open) => !open)}
                title={t("playbackSpeed")}
                aria-expanded={speedOpen}
              >
                <Gauge size={15} /> {speed}×
              </button>
              {speedOpen && (
                <div className="dropdown-menu speed-menu">
                  {PLAYBACK_SPEEDS.map((s) => (
                    <button
                      key={s}
                      className={speed === s ? "is-selected" : undefined}
                      onClick={() => changeSpeed(s)}
                    >
                      {s === "1" ? "1×" : `${s}×`}
                      {speed === s && <span className="dropdown-menu-status"><Check size={14} /></span>}
                    </button>
                  ))}
                  {video.channel_playback_speed != null && (
                    <button onClick={() => changeSpeed(null)}>{t("speedDefault")}</button>
                  )}
                </div>
              )}
            </div>
            </div>
            <div className="watch-action-group watch-action-group--organize watch-action-desktop">
            <div className="dropdown watch-action-desktop watch-action-medium" ref={scheduleMenuRef}>
              <button
                className="btn"
                onClick={() => setScheduleOpen((open) => !open)}
                aria-expanded={scheduleOpen}
              >
                <Clock /> {t("watchLater")}
              </button>
              {scheduleOpen && (
                <div className="dropdown-menu schedule-menu">
                  <SchedulePicker onSelect={queue} />
                </div>
              )}
            </div>
            <div className="dropdown watch-action-desktop watch-action-wide" ref={playlistMenuRef}>
              <button className="btn" title={t("addToPlaylist")} onClick={toggleDesktopPlaylist} aria-expanded={playlistOpen}>
                <BookmarkPlus /> {t("addToPlaylist")}
              </button>
              {playlistOpen && (
                <div className="dropdown-menu playlist-picker-menu">
                  <PlaylistPicker playlists={playlists} name={newPlaylistName} icon={newPlaylistIcon} onNameChange={setNewPlaylistName} onIconChange={setNewPlaylistIcon} onToggle={togglePlaylist} onCreate={createPlaylist} />
                </div>
              )}
            </div>
            </div>
            <div className="watch-action-group watch-action-group--utility">
            <div className="dropdown share-btn-wrap" ref={shareMenuRef}>
              <button
                className={`btn icon-only${shareOpen ? " active" : ""}`}
                title={t("share")}
                aria-expanded={shareOpen}
                onClick={() => setShareOpen((open) => !open)}
              >
                <Share2 />
              </button>
              {shareOpen && (
                <div className="dropdown-menu share-menu">
                  <div className="share-menu-title">{t("share")}</div>
                  <label className="share-link-label">{settings?.app_name || "YT Zero"}</label>
                  <div className="share-link-field">
                    <input readOnly value={shareLink("webpage") ?? ""} aria-label={settings?.app_name || "YT Zero"} />
                    <button className="icon-only" title={t("copyLink")} onClick={() => copyShareLink("webpage")}><Copy /></button>
                  </div>
                  <label className="share-link-label">YouTube</label>
                  <div className="share-link-field">
                    <input readOnly value={shareLink("youtube") ?? ""} aria-label="YouTube" />
                    <button className="icon-only" title={t("copyLink")} onClick={() => copyShareLink("youtube")}><Copy /></button>
                  </div>
                  <Checkbox className="share-timestamp-option" label={t("includeCurrentTime")} checked={shareWithTimestamp} onChange={(event) => setShareWithTimestamp(event.target.checked)} />
                </div>
              )}
              {copyKey > 0 && (
                <span key={copyKey} className="copy-toast">{t("copied")}</span>
              )}
            </div>
            <div className="dropdown watch-action-overflow" ref={moreMenuRef}>
              <button
                className={`btn icon-only${moreOpen ? " active" : ""}`}
                title={t("moreActions")}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <EllipsisVertical />
              </button>
              {moreOpen && (
                <div className="dropdown-menu more-menu">
                  {moreView === "root" && (
                    <>
                      <button className="more-item-medium" onClick={() => { setCinemaMode((m) => !m); setMoreOpen(false); }}>
                        <Clapperboard /> {t("cinemaMode")}
                        {cinemaMode && <span className="dropdown-menu-status"><Check size={14} /></span>}
                      </button>
                      <button className="more-item-medium" onClick={() => setMoreView("speed")}>
                        <Gauge /> {t("channelSpeed")}
                        <span className="dropdown-menu-status">{speed}×</span>
                      </button>
                      <button className="more-item-medium" onClick={() => setMoreView("watchlater")}>
                        <Clock /> {t("watchLater")}
                      </button>
                      <button className="more-item-wide" onClick={openPlaylistMenu}>
                        <BookmarkPlus /> {t("addToPlaylist")}
                      </button>
                      {video.status !== "archived" ? (
                        <button className="more-item-always" onClick={() => { api.archiveVideo(video.video_id).then(reload); setMoreOpen(false); }}>
                          <Archive /> {t("rejectVideo")}
                        </button>
                      ) : (
                        <button className="more-item-always" onClick={() => { api.restore(video.video_id).then(reload); setMoreOpen(false); }}>
                          <Undo2 /> {t("restoreRejectedVideo")}
                        </button>
                      )}
                      {downloadsEnabled && !isChildProfile && video.live_status !== "live" && video.live_status !== "upcoming" && downloadStatus !== "done" && downloadStatus !== "queued" && downloadStatus !== "downloading" && (
                        <div className="more-menu-section">
                          <MenuSeparator />
                          <div className="more-menu-section-label">{t("localDownload")}</div>
                          <button className="more-item-always" onClick={() => { requestDownload(); setMoreOpen(false); }}>
                            <ArrowDownToLine /> {t("downloadLocally")}
                          </button>
                        </div>
                      )}
                      {downloadsEnabled && !isChildProfile && downloadStatus === "done" && (
                        <div className="more-menu-section">
                          <MenuSeparator />
                          <div className="more-menu-section-label">{t("downloadedVideo")}</div>
                          <a className="more-item-always" href={api.downloadFileUrl(video.video_id)} onClick={() => setMoreOpen(false)}>
                            <ArrowDownToLine /> {t("downloadFileToDevice")}
                          </a>
                          <Popconfirm message={t("removeLocalCopyConfirm")} onConfirm={cancelOrRemoveDownload}>
                            <button className="more-item-always">
                              <Trash2 /> {t("removeLocalCopy")}
                            </button>
                          </Popconfirm>
                        </div>
                      )}
                    </>
                  )}
                  {moreView === "speed" && (
                    <>
                      <div className="more-menu-header">
                        <button className="more-menu-back" title={t("back")} onClick={() => setMoreView("root")}>
                          <ChevronLeft />
                        </button>
                        {t("channelSpeed")}
                      </div>
                      {PLAYBACK_SPEEDS.map((s) => (
                        <button
                          key={s}
                          className={speed === s ? "is-selected" : undefined}
                          onClick={() => changeSpeed(s)}
                        >
                          {s === "1" ? "1×" : `${s}×`}
                          {speed === s && <span className="dropdown-menu-status"><Check size={14} /></span>}
                        </button>
                      ))}
                      {video?.channel_playback_speed != null && (
                        <button onClick={() => changeSpeed(null)}>{t("speedDefault")}</button>
                      )}
                    </>
                  )}
                  {moreView === "watchlater" && (
                    <>
                      <div className="more-menu-header">
                        <button className="more-menu-back" title={t("back")} onClick={() => setMoreView("root")}>
                          <ChevronLeft />
                        </button>
                        {t("watchLater")}
                      </div>
                      <SchedulePicker onSelect={queue} />
                    </>
                  )}
                  {moreView === "playlist" && (
                    <>
                      <div className="more-menu-header">
                        <button className="more-menu-back" title={t("back")} onClick={() => setMoreView("root")}>
                          <ChevronLeft />
                        </button>
                        {t("addToPlaylist")}
                      </div>
                      <PlaylistPicker playlists={playlists} name={newPlaylistName} icon={newPlaylistIcon} onNameChange={setNewPlaylistName} onIconChange={setNewPlaylistIcon} onToggle={togglePlaylist} onCreate={createPlaylist} />
                    </>
                  )}
                </div>
              )}
            </div>
            </div>
          </div>
        </div>}
        {video && (video.live_status === "live" || video.tags.length > 0) && (
          <div className="watch-tags">
            {video.live_status === "live" && (
              <span className="watch-queue-tag live">{t("liveStream")}</span>
            )}
            {video.tags.map((t) => (
              <TagChip key={`${t.id}-${t.source}`} tag={t} />
            ))}
          </div>
        )}
        {video && (
          <div
            ref={descriptionRef}
            className={`watch-desc${descExpandable && !descOpen ? " clamped" : ""}`}
            onClick={() => descExpandable && !descOpen && setDescOpen(true)}
          >
            <div className="watch-desc-stats">
              {video.views != null && (
                <span className="stat"><Eye /> {formatViewsCount(video.views, language)}</span>
              )}
              {video.likes != null && (
                <span className="stat"><ThumbsUp /> {compactNumber(video.likes, language)}</span>
              )}
              {video.published_at && (
                <span className="stat"><CalendarDays /> {new Date(video.published_at).toLocaleDateString(locale)}</span>
              )}
              {!isChildProfile && (
                <a
                  className="watch-youtube-link"
                  href={`https://www.youtube.com/watch?v=${video.video_id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink /> YouTube
                </a>
              )}
            </div>
            {video.description && (
              <>
                <div className="watch-desc-sep" />
                <Linkify text={video.description} baseUrl={appUrl} channelHandles={creatorHandles} />
              </>
            )}
          </div>
        )}
        {video?.description && descExpandable && (
          <button className="watch-desc-toggle" onClick={() => setDescOpen((o) => !o)}>
            {descOpen ? t("showLess") : t("showMore")}
          </button>
        )}
        {(chapters.length > 0 || sbSegments.length > 0 || videoPlaylists.length > 0) && (
          <div className="watch-panels">
            {chapters.length > 0 && (
              <WatchPanel title={t("chaptersTitle")} className="sb-segments--chapters" ariaLabel={t("chaptersTitle")}>
                {chapters.map((ch) => (
                  <button
                    type="button"
                    key={ch.start}
                    className="sb-segment-row sb-chapter-row"
                    onClick={() => playerRef.current?.seekTo(ch.start, true)}
                  >
                    <span className="sb-segment-name">{ch.title}</span>
                    <span className="sb-time">{fmtTime(ch.start)}</span>
                  </button>
                ))}
              </WatchPanel>
            )}
            {sbSegments.length > 0 && (
              <WatchPanel
                title={t("sbSegmentsTitle").replace(/:$/, "")}
                className={`sb-segments--sponsor${sbPaused ? " sb-paused" : ""}`}
                ariaLabel={t("sbSegmentsTitle")}
                action={
                  <Button
                    size="sm"
                    variant={sbPaused ? "secondary" : "ghost"}
                    className="sb-pause-btn"
                    leadingIcon={sbPaused ? <Play /> : <Pause />}
                    onClick={() => setSbPaused((p) => !p)}
                    title={sbPaused ? t("sbResume") : t("sbPause")}
                  >
                    {sbPaused ? t("sbResume") : t("sbPause")}
                  </Button>
                }
              >
                {[...sbSegments].sort((a, b) => a.segment[0] - b.segment[0]).map((seg) => {
                  const cat = SB_CATEGORIES.find((c) => c.id === seg.category);
                  const off = disabledSegs.has(seg.UUID);
                  return (
                    <div
                      key={seg.UUID}
                      className={`sb-segment-row${off ? " disabled" : ""}`}
                      style={{ "--sb-color": cat?.color ?? "#888" } as React.CSSProperties}
                    >
                      <button type="button" className="sb-segment-seek" onClick={() => playerRef.current?.seekTo(seg.segment[0], true)}>
                        <span className="sb-dot" aria-hidden="true" />
                        <span className="sb-segment-name">{cat ? t(cat.labelKey) : seg.category}</span>
                        <span className="sb-time">{fmtTime(seg.segment[0])} → {fmtTime(seg.segment[1])}</span>
                      </button>
                      <span className="sb-seg-toggle">
                        <Switch
                          checked={!sbPaused && !off}
                          disabled={sbPaused}
                          ariaLabel={off ? t("sbSegEnable") : t("sbSegDisable")}
                          onCheckedChange={() => {
                            setDisabledSegs((prev) => {
                              const next = new Set(prev);
                              if (next.has(seg.UUID)) next.delete(seg.UUID);
                              else next.add(seg.UUID);
                              return next;
                            });
                          }}
                        />
                      </span>
                    </div>
                  );
                })}
              </WatchPanel>
            )}
            {videoPlaylists.length > 0 && (
              <WatchPanel title={t("videoPlaylistsTitle")} className="sb-segments--playlists" ariaLabel={t("videoPlaylistsTitle")}>
                {videoPlaylists.map((playlist) => (
                  <Link
                    key={playlist.playlistId}
                    className="watch-playlist-membership-row"
                    to={`/watch/${id}/playlist/${playlist.playlistId}`}
                  >
                    <VideoThumbnail
                      src={img(playlist.thumbnail)}
                      watched={video?.watched === 1}
                      progress={watchProgress(video?.watch_position, video?.watch_duration)}
                      variant="playlist"
                      loading="lazy"
                    />
                    <span className="watch-playlist-membership-copy">
                      <span className="sb-segment-name">{playlist.title}</span>
                      <span className="watch-playlist-membership-channel">{playlist.channelTitle}</span>
                    </span>
                    {playlist.videoCount && (
                      <span className="sb-time">{formatPlaylistVideoCount(playlist.videoCount, language)}</span>
                    )}
                  </Link>
                ))}
              </WatchPanel>
            )}
          </div>
        )}
      </div>

      <aside>
        {playlistId && playlistVideos.length > 0 && (
          <div className="watch-playlist-panel">
            <div className="watch-playlist-head">
              <span className="watch-playlist-title">{t("playlist")}</span>
              <span className="watch-playlist-count">
                {playlistIndex >= 0 ? playlistIndex + 1 : 1} / {playlistVideos.length}
              </span>
            </div>
            <div className="playlist-items" ref={playlistItemsRef}>
              {playlistVideos.map((v, i) => (
                <Link
                  ref={v.videoId === id ? activePlaylistItemRef : undefined}
                  key={v.videoId}
                  to={`/watch/${v.videoId}/playlist/${playlistId}`}
                  className={`playlist-item${v.videoId === id ? " active" : ""}`}
                  title={v.title}
                >
                  <span className="playlist-item-num">{i + 1}</span>
                  <VideoThumbnail src={img(v.thumbnail)} watched={v.watched === 1} progress={watchProgress(v.watch_position, v.watch_duration)} variant="playlist" loading="lazy">
                    {v.duration && <span className="playlist-item-dur">{v.duration}</span>}
                    {v.videoId === id && (
                      <span className="playlist-item-playing">
                        <Play size={12} fill="currentColor" />
                      </span>
                    )}
                  </VideoThumbnail>
                  <div className="playlist-item-info">
                    <div className="playlist-item-title">{v.title}</div>
                    {v.channelTitle && <div className="playlist-item-ch">{v.channelTitle}</div>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
        <h2 className="related-title">{t("moreLikeThis")}</h2>
        {related.filter((v) => v.is_short === 0).map((v) => (
          <div key={v.video_id} className="related-item">
            <div className="related-thumb-shell">
              <Link className="related-thumb-link" to={`/watch/${v.video_id}`} aria-label={v.title} title={v.title}>
                <VideoThumbnail src={img(v.thumbnail)} watched={v.watched === 1} progress={watchProgress(v.watch_position, v.watch_duration)} variant="related" loading="lazy">
                  {v.live_status === "live" && (
                    <span className="live-badge">
                      <span className="pulse" /> {t("liveBadge")}
                    </span>
                  )}
                  {v.duration && v.is_short !== 1 && (
                    <span className="duration-badge">{formatVideoDuration(v.duration)}</span>
                  )}
                </VideoThumbnail>
              </Link>
              <VideoScheduleActions
                video={v}
                variant="compact"
                onToggle={(event, bucket, active) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleRelatedSchedule(v, bucket, active).catch(console.error);
                }}
              />
            </div>
            <div className="related-item-info">
              <Link className="r-title" to={`/watch/${v.video_id}`} title={v.title}>{v.title}</Link>
              <div className="r-meta">
                {v.channel_title}
                <br />
                {v.views != null && `${formatViewsCount(v.views, language)} · `}
                {formatTimeAgo(v.published_at, language)}
              </div>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
