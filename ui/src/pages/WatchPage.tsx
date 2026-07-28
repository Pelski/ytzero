import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import "./WatchPage.css";
import { emit, emitToast } from "../events";
import { scheduleSettingWrite } from "../settingsWriteQueue";
import { queueProgressWrite } from "../progressWriteQueue";
import { isIncognitoMode } from "../incognitoMode";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Archive,
  AlertTriangle,
  ArrowDownToLine,
  BookmarkPlus,
  CalendarDays,
  Camera,
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
  HardDrive,
  LoaderCircle,
  Lock,
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
  VolumeX,
} from "lucide-react";
import { api, type AppSettings, type Bucket, type PlaylistVideo, type SponsorSegment, type UserPlaylist, type Video, type VideoChapter, type VideoChannelPlaylist, type VideoCreator, type VideoInfo, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
import { compactNumber, formatPlaylistVideoCount, formatTimeAgo, formatViewsCount, useI18n } from "../i18n";
import { formatAppDate } from "../dateTime";
import { useDocumentTitle } from "../useDocumentTitle";
import TagChip from "../components/TagChip";
import LocalPlayer, { type LocalPlayerShortcut } from "../components/LocalPlayer";
import Popconfirm from "../components/Popconfirm";
import PlaylistPicker from "../components/PlaylistPicker";
import { BUCKET_ICONS, formatVideoDuration } from "../components/VideoCard";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { SchedulePicker, VideoScheduleActions } from "../components/VideoScheduleActions";
import UpNextOverlay from "../components/UpNextOverlay";
import { img } from "../img";
import { resolvePlayerKind, type WatchSourceMode } from "./watchPlayerMode";
import { Alert, Button, ButtonAnchor, Checkbox, IconButton, LocalToast, Menu, MenuItem, MenuSeparator, MenuStatus, Popover, ScrollArea, Switch } from "../components/ui";
import { WatchPanel } from "../components/WatchPanel";
import VideoCreators from "../components/VideoCreators";
import Tooltip from "../components/Tooltip";
import { normalizeSponsorSegments } from "../sponsorblock";
import { markYouTubeUrl } from "../youtubeUrl";
import { DEFAULT_SCREENSHOT_FILENAME_TEMPLATE, parsePlayerScreenshotFormat } from "../playerScreenshot";
import { dispatchEnhanceEvent, ENHANCE_BRIDGE_EVENTS, ENHANCE_BRIDGE_VERSION, parseEnhanceEventDetail, parseEnhancePlayerEvent, sendPlayerCommand, type EnhancePlayerState } from "../enhanceBridge";
import { subscribeServerEvent } from "../serverEvents";
import VideoComments from "../components/VideoComments";

type WatchShortcutKind = LocalPlayerShortcut | "sponsorblock" | "screenshotUnsupported";

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

// "15:04" / "1:02:03" -> seconds. Used to give the streaming player the full
// video length (hls.js only knows the downloaded-so-far portion).
function colonDurationToSeconds(duration: string | null | undefined): number | undefined {
  if (!duration) return undefined;
  const parts = duration.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return undefined;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

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
              <a href={markYouTubeUrl(url)} target="_blank" rel="noreferrer" className="desc-link" onClick={(e) => e.stopPropagation()}>
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
  const { t, bucketLabel, language, locale, timeZone } = useI18n();
  const { id, playlistId } = useParams<{ id: string; playlistId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const feedContext = searchParams.get("feedContext") === "1";
  const feedTags = searchParams.get("tags") ?? "";
  const feedShowAll = searchParams.get("show_all") === "1";
  const feedSort = searchParams.get("sort") === "arrival" ? "arrival" : "published";
  const [video, setVideo] = useState<Video | null>(null);
  const [videoMissing, setVideoMissing] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [related, setRelated] = useState<Video[]>([]);
  const [copyKey, setCopyKey] = useState(0);
  const [scheduleToast, setScheduleToast] = useState<{ id: number; message: string; variant: "default" | "danger"; anchor: "desktop" | "overflow" } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareWithTimestamp, setShareWithTimestamp] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Withheld until settings load: for a profile that turned suggestions off,
  // rendering them first and pulling them away is worse than a brief gap.
  const showRelated = settings ? settings.watch_show_related !== "0" : false;
  const showComments = settings?.watch_show_comments === "1";
  const [downloadSubtitleLanguages, setDownloadSubtitleLanguages] = useState<string[]>([]);
  const [playbackPolicy, setPlaybackPolicy] = useState<{
    ready: boolean;
    downloadsEnabled: boolean;
    isChildProfile: boolean;
    childDownloadsOnly: boolean;
    pluginWatchMode: WatchSourceMode;
    experimentalStreaming: boolean;
  }>({
    ready: false,
    downloadsEnabled: false,
    isChildProfile: false,
    childDownloadsOnly: false,
    pluginWatchMode: "youtube",
    experimentalStreaming: false,
  });
  const {
    ready: playbackPolicyReady,
    downloadsEnabled,
    isChildProfile,
    childDownloadsOnly,
    pluginWatchMode,
    experimentalStreaming,
  } = playbackPolicy;
  const [descOpen, setDescOpen] = useState(false);
  const [descExpandable, setDescExpandable] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreView, setMoreView] = useState<"root" | "speed" | "watchlater" | "playlist">("root");
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
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
  const [shortcutFeedback, setShortcutFeedback] = useState<{ kind: WatchShortcutKind; id: number; seconds?: number; category?: string } | null>(null);
  // "auto" plays the local file when one exists; "youtube" forces the iframe.
  const [playerSource, setPlayerSource] = useState<"auto" | "youtube">("auto");
  // watch_source_mode = "ask"/"download": what the viewer decided for THIS video.
  const [sourceChoice, setSourceChoice] = useState<"undecided" | "youtube" | "wait">("undecided");
  // Current position of the experimental stream, so the handoff to the local
  // file (once the background download finishes) resumes at the same spot.
  const streamPositionRef = useRef(0);
  // The viewer left the experimental stream for their configured player.
  const [skipStreaming, setSkipStreaming] = useState(false);
  const [waitProgress, setWaitProgress] = useState<{ percent: number; speed: string | null } | null>(null);
  const [waitError, setWaitError] = useState<string | null>(null);
  const [backgroundDownload, setBackgroundDownload] = useState<{ percent: number | null; speed: string | null; error: string | null }>({ percent: null, speed: null, error: null });
  const [downloadRequestError, setDownloadRequestError] = useState(false);
  const [downloadReadyToReload, setDownloadReadyToReload] = useState(false);
  const [youtubeAutoplayBlocked, setYoutubeAutoplayBlocked] = useState(false);
  const [youtubeError, setYoutubeError] = useState<number | null>(null);
  // Path to the next playlist video, read by the player's onStateChange when a
  // video ends. A ref keeps the player effect free of playlist dependencies.
  const nextInPlaylistRef = useRef<string | null>(null);
  const playlistItemsRef = useRef<HTMLDivElement>(null);
  const activePlaylistItemRef = useRef<HTMLAnchorElement>(null);
  // "Autoplay my feed" (#55): the next video in the main feed, prefetched so
  // it's ready the instant the current one ends. Only populated when we got
  // here from the Feed (feedContext) and the setting is on.
  const nextInFeedRef = useRef<Video | null>(null);
  const [upNextVideo, setUpNextVideo] = useState<Video | null>(null);
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
  const enhancePlayerStateRef = useRef<{ state: EnhancePlayerState; updatedAt: number } | null>(null);
  const archivedRef = useRef(false);
  const progressRef = useRef<{ position: number; duration: number } | null>(null);
  const sbSegmentsRef = useRef<SponsorSegment[]>([]);
  const sbPausedRef = useRef(false);
  const disabledSegsRef = useRef<Set<string>>(new Set());
  const recordedSbSegsRef = useRef<Set<string>>(new Set());
  const endedHandledRef = useRef<string | null>(null);

  const showShortcutFeedback = useCallback((kind: WatchShortcutKind, seconds?: number, category?: string) => {
    if (shortcutFeedbackTimerRef.current) window.clearTimeout(shortcutFeedbackTimerRef.current);
    setShortcutFeedback({ kind, id: Date.now(), seconds, category });
    shortcutFeedbackTimerRef.current = window.setTimeout(() => setShortcutFeedback(null), kind === "sponsorblock" ? 4_200 : 1_560);
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
    api.settings().then((r) => setSettings(r.settings)).catch(() => setSettings(null));
    api.config().then((r) => setAppUrl(r.app_url)).catch(() => {});
    let cancelled = false;
    void (async () => {
      const [childStatus, downloadConfig] = await Promise.all([
        api.childStatus().catch(() => null),
        api.downloadConfig().catch(() => null),
      ]);
      const downloadsEnabled = downloadConfig?.enabled ?? false;
      const subtitleLanguages = String(downloadConfig?.settings.sub_langs ?? "")
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean);
      let pluginWatchMode: WatchSourceMode = "youtube";
      if (downloadsEnabled) {
        const configuredMode = downloadConfig?.settings.watch_source_mode;
        if (configuredMode === "ask" || configuredMode === "download") pluginWatchMode = configuredMode;
      }
      const experimentalStreaming = downloadsEnabled && Number(downloadConfig?.settings.experimental_streaming) === 1;
      if (cancelled) return;
      setDownloadSubtitleLanguages(subtitleLanguages);
      setPlaybackPolicy({
        ready: true,
        downloadsEnabled,
        isChildProfile: childStatus?.is_child ?? false,
        childDownloadsOnly: !!(childStatus?.is_child && childStatus.downloads_only),
        pluginWatchMode,
        experimentalStreaming,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  const downloadStatus = video?.download_status ?? null;
  // Which surface fills the player area. Children never get a choice: with
  // downloads_only they are locked to local files, otherwise plain YouTube.
  const watchMode = downloadsEnabled && !isChildProfile ? pluginWatchMode : "youtube";
  const streamingEnabled = experimentalStreaming && !isChildProfile && !skipStreaming;
  const playerKind = resolvePlayerKind({
    hasVideo: !!video,
    isLive: video?.live_status === "live" || video?.live_status === "upcoming",
    downloadStatus,
    playerSource,
    playbackPolicyReady,
    childDownloadsOnly,
    sourceChoice,
    watchMode,
    streamingEnabled,
  });
  const downloadFeedbackKind = downloadReadyToReload ? "ready" : downloadRequestError || downloadStatus === "error" ? "error" : downloadStatus === "downloading" ? "downloading" : "queued";
  const downloadFeedbackVisible = downloadReadyToReload || downloadRequestError || downloadStatus === "queued" || downloadStatus === "downloading" || downloadStatus === "error";
  const privateVideoNotice = video?.is_private === 1;
  const membersOnlyNotice = video?.members_only === 1 && !isChildProfile && !privateVideoNotice;
  // Both "local" and "stream" render the LocalPlayer component (same layout).
  const usingLocal = (playerKind === "local" || playerKind === "stream") && !membersOnlyNotice && !privateVideoNotice;
  const sharedTimestamp = Number(new URLSearchParams(location.search).get("t"));
  const sharedStartSeconds = Number.isFinite(sharedTimestamp) ? Math.max(0, Math.floor(sharedTimestamp)) : 0;
  const keyboardSeekSeconds = Math.max(1, Number(settings?.keyboard_seek_seconds ?? "5") || 5);
  const screenshotFormat = parsePlayerScreenshotFormat(settings?.player_screenshot_format);
  const screenshotQuality = Math.min(1, Math.max(0.1, Number(settings?.player_screenshot_quality) || 0.92));
  const screenshotFilenameTemplate = settings?.player_screenshot_filename || DEFAULT_SCREENSHOT_FILENAME_TEMPLATE;
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

  const takeEmbeddedScreenshot = useCallback(() => {
    if (!video) {
      showShortcutFeedback("screenshotError");
      return;
    }
    const seconds = Math.max(0, Number(playerRef.current?.getCurrentTime?.()) || 0);
    const requestWasNotClaimed = dispatchEnhanceEvent(ENHANCE_BRIDGE_EVENTS.screenshotRequest, {
      version: ENHANCE_BRIDGE_VERSION,
      video: {
        id: video.video_id,
        title: video.title,
        channelTitle: video.channel_title,
        seconds,
      },
      screenshot: {
        format: screenshotFormat,
        quality: screenshotQuality,
        filenameTemplate: screenshotFilenameTemplate,
      },
    }, { cancelable: true });
    // Capturing a cross-origin embedded frame is only possible when the
    // extension claims the request synchronously with preventDefault().
    if (requestWasNotClaimed) showShortcutFeedback("screenshotUnsupported");
  }, [screenshotFilenameTemplate, screenshotFormat, screenshotQuality, showShortcutFeedback, video]);

  // Publish per-video data that cannot live in the static configuration file.
  // The ready handshake lets a content script request the latest snapshot even
  // when it loads after React emitted the initial context event.
  useEffect(() => {
    if (playerKind !== "youtube" || !video) return;
    const publishContext = () => dispatchEnhanceEvent(ENHANCE_BRIDGE_EVENTS.context, {
      version: ENHANCE_BRIDGE_VERSION,
      active: true,
      video: {
        id: video.video_id,
        title: video.title,
        channelId: video.channel_id,
        channelTitle: video.channel_title,
        duration: video.duration,
      },
      playback: {
        rate: Number(video.channel_playback_speed ?? settings?.player_speed ?? 1) || 1,
        keyboardSeekSeconds,
        frameStepFps: 30,
        captions: {
          enabledByDefault: captionsDefaultOn,
          language: captionsDefaultLang,
          style: {
            fontSizePx: subtitleSize,
            color: settings?.player_sub_color || "#ffffff",
            backgroundOpacityPercent: Number(settings?.player_sub_bg ?? 75),
          },
        },
        chapters,
        sponsorBlockSegments: sbSegments,
      },
      screenshot: {
        format: screenshotFormat,
        quality: screenshotQuality,
        filenameTemplate: screenshotFilenameTemplate,
      },
    });
    publishContext();
    document.addEventListener(ENHANCE_BRIDGE_EVENTS.ready, publishContext);
    return () => document.removeEventListener(ENHANCE_BRIDGE_EVENTS.ready, publishContext);
  }, [captionsDefaultLang, captionsDefaultOn, chapters, keyboardSeekSeconds, playerKind, screenshotFilenameTemplate, screenshotFormat, screenshotQuality, sbSegments, settings?.player_speed, settings?.player_sub_bg, settings?.player_sub_color, subtitleSize, video]);

  useEffect(() => {
    const onScreenshotResult = (event: Event) => {
      const detail = parseEnhanceEventDetail<{ status?: string }>(event);
      if (detail?.status === "saved") showShortcutFeedback("screenshot");
      else if (detail?.status === "error") showShortcutFeedback("screenshotError");
    };
    document.addEventListener(ENHANCE_BRIDGE_EVENTS.screenshotResult, onScreenshotResult);
    return () => document.removeEventListener(ENHANCE_BRIDGE_EVENTS.screenshotResult, onScreenshotResult);
  }, [showShortcutFeedback]);

  const changeSubtitleSize = useCallback((size: number) => {
    const value = String(size);
    setSettings((current) => current ? { ...current, player_sub_size: value } : current);
    scheduleSettingWrite("player_sub_size", { player_sub_size: value }, {
      onSaved: () => emit("player-settings-changed"),
      onError: console.error,
    });
  }, []);

  const requestYouTubePlayback = useCallback(() => {
    setYoutubeAutoplayBlocked(false);
    const p = playerRef.current;
    try {
      const iframe = p?.getIframe?.() as HTMLIFrameElement | undefined;
      if (iframe) {
        const permissions = new Set((iframe.getAttribute("allow") ?? "").split(";").map((v) => v.trim()).filter(Boolean));
        permissions.add("autoplay");
        permissions.add("encrypted-media");
        permissions.add("picture-in-picture");
        permissions.add("fullscreen");
        iframe.setAttribute("allow", [...permissions].join("; "));
        iframe.setAttribute("allowfullscreen", "");
      }
      if (id) void sendPlayerCommand(id, "play").catch(() => p?.playVideo?.());
      else p?.playVideo?.();
    } catch {}
  }, [id]);

  const chooseYouTube = useCallback(() => {
    setYoutubeAutoplayBlocked(false);
    setSourceChoice("youtube");
  }, []);

  useEffect(() => { streamPositionRef.current = 0; setSkipStreaming(false); }, [id]);

  // Leave the experimental stream: fall back to whatever the viewer's configured
  // player would be (download-wait / ask / YouTube — or the local file if the
  // background download already finished).
  const exitStreaming = useCallback(() => setSkipStreaming(true), []);

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
    if (!video?.video_id || video.is_private === 1) return;
    let cancelled = false;
    api.videoCreators(video.video_id)
      .then((result) => { if (!cancelled) setVideoCreators(result.creators); })
      .catch(() => { if (!cancelled) setVideoCreators([]); });
    return () => { cancelled = true; };
  }, [video?.video_id, video?.is_private]);

  useEffect(() => {
    setChapters([]);
    setVideoPlaylists([]);
    if (!id) return;
    let cancelled = false;
    Promise.allSettled([video?.is_private === 1 ? Promise.resolve({ chapters: [] }) : api.chapters(id), api.videoPlaylists(id)]).then(([chapterResult, playlistResult]) => {
      if (cancelled) return;
      setChapters(chapterResult.status === "fulfilled" ? chapterResult.value.chapters : []);
      setVideoPlaylists(playlistResult.status === "fulfilled" ? playlistResult.value.playlists : []);
    });
    return () => { cancelled = true; };
  }, [id, video?.is_private]);

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

  // "Autoplay my feed" (#55): prefetch the next feed video so the up-next
  // overlay can appear instantly on end. It shows for every video reached
  // from the Feed regardless of the setting — only whether it auto-advances
  // depends on feed_autoplay_enabled (toggleable right on the overlay too).
  useEffect(() => {
    nextInFeedRef.current = null;
    setUpNextVideo(null);
    if (!id || !feedContext) return;
    let cancelled = false;
    const direction = settings?.feed_autoplay_direction === "newest" ? "newest" : "oldest";
    const tagIds = feedTags ? feedTags.split(",").map(Number).filter(Boolean) : [];
    api.feedAdjacent(id, direction, { tags: tagIds, showAll: feedShowAll, sort: feedSort })
      .then((r) => { if (!cancelled) nextInFeedRef.current = r.video; })
      .catch(() => { if (!cancelled) nextInFeedRef.current = null; });
    return () => { cancelled = true; };
  }, [id, feedContext, feedTags, feedShowAll, feedSort, settings?.feed_autoplay_direction]);

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
    if (!isIncognitoMode()) api.watch(id).catch(() => {});
  }, [id]);

  // When a video finishes: record completion, advance the playlist if any.
  const handleEnded = useCallback(() => {
    if (!id) return;
    if (endedHandledRef.current === id) return;
    endedHandledRef.current = id;
    if (!isIncognitoMode()) api.complete(id).catch(() => {});
    if (nextInPlaylistRef.current) navigate(nextInPlaylistRef.current);
    else if (nextInFeedRef.current) setUpNextVideo(nextInFeedRef.current);
  }, [id, navigate]);

  const goToUpNextVideo = useCallback(() => {
    if (!upNextVideo) return;
    const params = new URLSearchParams({ feedContext: "1" });
    if (feedTags) params.set("tags", feedTags);
    if (feedShowAll) params.set("show_all", "1");
    if (feedSort === "arrival") params.set("sort", "arrival");
    navigate(`/watch/${upNextVideo.video_id}?${params.toString()}`);
  }, [upNextVideo, feedTags, feedShowAll, feedSort, navigate]);

  const toggleFeedAutoplay = useCallback((next: boolean) => {
    setSettings((s) => s ? { ...s, feed_autoplay_enabled: next ? "1" : "0" } : s);
    api.updateSettings({ feed_autoplay_enabled: next ? "1" : "0" }).catch(() => {});
  }, []);
  const handleEndedRef = useRef(handleEnded);
  useEffect(() => { handleEndedRef.current = handleEnded; }, [handleEnded]);
  useEffect(() => {
    endedHandledRef.current = null;
    enhancePlayerStateRef.current = null;
  }, [id]);

  useEffect(() => {
    if (playerKind !== "youtube" || !id) return;
    const toggleEnhancedCaptions = () => {
      void sendPlayerCommand(id, "toggle-captions").catch((error) => console.warn("Unable to toggle enhanced-player captions", error));
    };
    const onPlayerEvent = (event: Event) => {
      const message = parseEnhancePlayerEvent(event);
      if (!message || message.videoId !== id) return;

      if (message.type === "ready" || message.type === "state") {
        enhancePlayerStateRef.current = { state: message.payload.state, updatedAt: Date.now() };
        try {
          if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = message.payload.state.ended
              ? "none"
              : message.payload.state.paused ? "paused" : "playing";
          }
        } catch {}
        return;
      }

      if (message.type === "shortcut") {
        const { action, repeat } = message.payload;
        if (repeat) return;
        if (action === "cinema-mode") setCinemaMode((current) => !current);
        else if (action === "seek-back") showShortcutFeedback("back", keyboardSeekSeconds);
        else if (action === "seek-forward") showShortcutFeedback("forward", keyboardSeekSeconds);
        else if (action === "seek-back-10") showShortcutFeedback("back", 10);
        else if (action === "seek-forward-10") showShortcutFeedback("forward", 10);
        else if (action === "volume-up") showShortcutFeedback("volumeUp");
        else if (action === "volume-down") showShortcutFeedback("volumeDown");
        else if (action === "toggle-muted") showShortcutFeedback(enhancePlayerStateRef.current?.state.muted ? "unmute" : "mute");
        return;
      }

      if (message.type === "captions-toggle-request") {
        toggleEnhancedCaptions();
        return;
      }

      if (message.type === "ended") handleEndedRef.current();
    };
    document.addEventListener(ENHANCE_BRIDGE_EVENTS.playerEvent, onPlayerEvent);
    return () => document.removeEventListener(ENHANCE_BRIDGE_EVENTS.playerEvent, onPlayerEvent);
  }, [id, keyboardSeekSeconds, playerKind, showShortcutFeedback]);

  // Create the player (YT iframe or the ref populated by LocalPlayer) and poll
  // progress every second. The poll runs against the shared YT-shaped player
  // API, so progress saving, auto-archive and SponsorBlock work for both.
  useEffect(() => {
    if (!id || (!video && !videoMissing)) return;

    const canAutoArchive = video ? (video.live_status !== "live" && video.live_status !== "upcoming") : false;
    // In "stream" mode the reported duration is the downloaded length so far,
    // not the full video — persisting progress or auto-archiving off that ratio
    // would be wrong. The saved download handles resume on the next visit.
    const isStream = playerKind === "stream";

    const startSeconds = sharedStartSeconds || (
      video?.watch_position && video?.watch_duration && video.watch_duration > 0 &&
      video.watch_position / video.watch_duration < 0.9
        ? Math.floor(video.watch_position) : 0
    );

    const poll = () => {
      const p = playerRef.current;
      const enhancedSnapshot = playerKind === "youtube" ? enhancePlayerStateRef.current : null;
      const enhancedState = enhancedSnapshot && Date.now() - enhancedSnapshot.updatedAt < 2_500 ? enhancedSnapshot.state : null;
      if (!p?.getCurrentTime && !enhancedState) return;
      try {
        const position = enhancedState?.currentTime ?? p.getCurrentTime() as number;
        const playerDuration = enhancedState?.duration ?? p.getDuration() as number;
        if (!position || !playerDuration) return;
        if (isStream) streamPositionRef.current = position;
        if (!isStream) progressRef.current = { position, duration: playerDuration };
        if (playerKind === "youtube" && "mediaSession" in navigator) {
          try {
            navigator.mediaSession.setPositionState({
              duration: playerDuration,
              playbackRate: Number(speedRef.current) || 1,
              position: Math.min(position, playerDuration),
            });
          } catch {}
        }
        const isPlaying = enhancedState ? !enhancedState.paused && !enhancedState.ended : p.getPlayerState?.() === 1;
        if (!isPlaying) return;
        if (!isStream) {
          queueProgressWrite(id, position, playerDuration);
          if (!isIncognitoMode() && canAutoArchive && playerDuration > 30 && position / playerDuration >= 0.9 && !archivedRef.current) {
            archivedRef.current = true;
            queueProgressWrite(id, playerDuration, playerDuration);
            api.complete(id).catch(() => {});
            api.archiveVideo(id).catch(() => {});
          }
        }
        if (!sbPausedRef.current) {
          for (const seg of sbSegmentsRef.current) {
            if (disabledSegsRef.current.has(seg.UUID)) continue;
            if (position >= seg.segment[0] && position < seg.segment[1] - 0.3) {
              const skippedSeconds = seg.segment[1] - position;
              p.seekTo(seg.segment[1], true);
              showShortcutFeedback("sponsorblock", skippedSeconds, seg.category);
              if (!isIncognitoMode() && !recordedSbSegsRef.current.has(seg.UUID)) {
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
        queueProgressWrite(id, position, duration);
        progressRef.current = null;
      }
    };

    if (membersOnlyNotice) return;

    if (playerKind === "local" || playerKind === "stream") {
      // LocalPlayer renders the <video> itself and fills playerRef via its ref.
      // In "stream" mode the duration is unknown, so poll() self-skips progress
      // saving and auto-archive — SponsorBlock/resume just wait for the download.
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
            if (e?.data === 1) {
              try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; } catch {}
              if (!speedApplied) {
                speedApplied = true;
                applySpeed(e.target);
              }
            }
            if (e?.data === 2) {
              try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; } catch {}
            }
            // 0 === ended
            if (e?.data === 0) {
              try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none"; } catch {}
              handleEndedRef.current();
            }
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

  // Give the cross-origin YouTube iframe the same lock-screen/media-key surface
  // as LocalPlayer. The action handlers deliberately dereference playerRef at
  // invocation time because the iframe is created asynchronously.
  useEffect(() => {
    if (playerKind !== "youtube" || !video || !("mediaSession" in navigator)) return;
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

    return () => {
      try {
        mediaSession.metadata = null;
        mediaSession.playbackState = "none";
      } catch {}
      for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto"] as MediaSessionAction[]) {
        setHandler(action, null);
      }
    };
  }, [playerKind, video?.video_id, video?.title, video?.channel_title, video?.thumbnail]);

  // Waiting panel: make sure the download is queued with top priority, then
  // track its progress until the file is ready (the local player takes over)
  // or the download fails.
  useEffect(() => {
    if (membersOnlyNotice || playerKind !== "waiting" || !id) return;
    let cancelled = false;
    setWaitError(null);
    api.requestDownload(id, true).catch(() => {});
    const load = () => {
      api.videoDownload(id).then((r) => {
        if (cancelled) return;
        setWaitProgress(r.progress ? { percent: r.progress.percent, speed: r.progress.speed } : null);
        const status = r.download?.status ?? null;
        if (status === "error") setWaitError(r.download?.error ?? "error");
        setVideo((prev) => prev && prev.download_status !== status ? { ...prev, download_status: status } : prev);
      }).catch(() => {});
    };
    load();
    const unsubscribe = subscribeServerEvent("downloads", (data) => {
      if (!data?.videoId || data.videoId === id) load();
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [playerKind, id, membersOnlyNotice]);

  useEffect(() => {
    if (!moreOpen) setMoreView("root");
  }, [moreOpen]);

  // Apply a speed: change playback now and persist it as this channel's override
  // (null clears the override, falling back to the global default).
  const changeSpeed = (v: string | null) => {
    const eff = v ?? settings?.player_speed ?? "1";
    setSpeed(eff);
    speedRef.current = eff;
    const applyFallback = () => { try { playerRef.current?.setPlaybackRate(Number(eff)); } catch {} };
    if (id) void sendPlayerCommand(id, "set-playback-rate", { rate: Number(eff) }).catch(applyFallback);
    else applyFallback();
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
    return () => {
      document.removeEventListener("keydown", onKey);
    };
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

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        if (!e.repeat) void takeEmbeddedScreenshot();
        return;
      }

      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        if (e.repeat) return;
        const enhancedState = enhancePlayerStateRef.current?.state;
        const muted = enhancedState?.muted ?? Boolean(player.isMuted?.());
        showShortcutFeedback(muted ? "unmute" : "mute");
        if (id) {
          void sendPlayerCommand(id, "toggle-muted").catch(() => {
            if (muted) player.unMute?.();
            else player.mute?.();
          });
        } else if (muted) player.unMute?.();
        else player.mute?.();
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
  }, [id, playerKind, showShortcutFeedback, keyboardSeekSeconds, takeEmbeddedScreenshot]);

  // While this video is being fetched — or is playing via the experimental
  // Track background downloads. A normal remote player remains mounted when
  // the file becomes ready; the viewer explicitly chooses when to reload it.
  useEffect(() => {
    const active = downloadStatus === "queued" || downloadStatus === "downloading" || downloadStatus === "error" || playerKind === "stream";
    if (!id || !active || playerKind === "waiting") {
      setBackgroundDownload({ percent: null, speed: null, error: null });
      return;
    }
    const load = () => {
      api.videoDownload(id).then((result) => {
        const status = result.download?.status ?? null;
        if (status === "done" && playerKind === "youtube" && (downloadStatus === "queued" || downloadStatus === "downloading")) {
          setPlayerSource("youtube");
          setDownloadReadyToReload(true);
        }
        setBackgroundDownload({ percent: result.progress?.percent ?? null, speed: result.progress?.speed ?? null, error: result.download?.error ?? null });
        setVideo((prev) => prev ? { ...prev, download_status: status } : prev);
      }).catch(() => {});
    };
    load();
    return subscribeServerEvent("downloads", (data) => {
      if (!data?.videoId || data.videoId === id) load();
    });
  }, [id, downloadStatus, playerKind]);

  useEffect(() => {
    setDownloadRequestError(false);
    setDownloadReadyToReload(false);
    setBackgroundDownload({ percent: null, speed: null, error: null });
  }, [id]);

  const requestDownload = () => {
    if (!video) return;
    setDownloadRequestError(false);
    setDownloadReadyToReload(false);
    if (playerKind === "youtube") setPlayerSource("youtube");
    setVideo((prev) => prev ? { ...prev, download_status: "queued" } : prev);
    api.requestDownload(video.video_id).catch(() => {
      setVideo((prev) => prev ? { ...prev, download_status: null } : prev);
      setDownloadRequestError(true);
    });
  };

  const cancelOrRemoveDownload = () => {
    if (!video) return;
    setPlayerSource("auto");
    setDownloadRequestError(false);
    setDownloadReadyToReload(false);
    setBackgroundDownload({ percent: null, speed: null, error: null });
    setVideo((prev) => prev ? { ...prev, download_status: null } : prev);
    api.removeDownload(video.video_id).catch(() => {});
  };

  const reloadDownloadedPlayer = () => {
    setDownloadReadyToReload(false);
    setPlayerSource("auto");
  };

  useDocumentTitle((video?.title ?? videoInfo?.title ?? "").trim() || (id ? `Video ${id}` : "Video"));

  if (!video && !videoMissing) return null;

  const reload = () => video && api.video(video.video_id).then((r) => setVideo(r.video));

  const toggleRelatedSchedule = async (relatedVideo: Video, bucket: Bucket, active: boolean) => {
    const nextStatus = active ? "inbox" : "queued";
    const nextBucket = active ? null : bucket;
    setRelated((current) => current.map((item) => item.video_id === relatedVideo.video_id
      ? { ...item, status: nextStatus, bucket: nextBucket }
      : item));
    try {
      if (active) await api.dequeue(relatedVideo.video_id);
      else await api.queue(relatedVideo.video_id, bucket);
      emit("queue-changed");
      emitToast(t(active ? "scheduleRemovedFeedback" : "scheduledFeedback"), active ? "default" : "scheduled");
    } catch {
      setRelated((current) => current.map((item) => item.video_id === relatedVideo.video_id && item.bucket === nextBucket
        ? { ...item, status: relatedVideo.status, bucket: relatedVideo.bucket }
        : item));
      emitToast(t("scheduleSaveFailed"), "danger");
    }
  };

  const shareLink = (destination: "webpage" | "youtube") => {
    if (!video) return;
    let seconds = 0;
    if (shareWithTimestamp) {
      try { seconds = Math.max(0, Math.floor(Number(playerRef.current?.getCurrentTime?.()) || 0)); } catch {}
    }
    return destination === "webpage"
      ? `${window.location.origin}/watch/${video.video_id}${seconds ? `?t=${seconds}` : ""}`
      : markYouTubeUrl(`https://www.youtube.com/watch?v=${video.video_id}${seconds ? `&t=${seconds}s` : ""}`);
  };

  const copyShareLink = (destination: "webpage" | "youtube") => {
    const link = shareLink(destination);
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopyKey((key) => key + 1);
    });
  };

  const queue = async (bucket: Bucket, anchor: "desktop" | "overflow") => {
    if (!video) return;
    const videoId = video.video_id;
    const previousStatus = video.status;
    const previousBucket = video.bucket;
    setMoreOpen(false);
    setScheduleOpen(false);
    setVideo((current) => current?.video_id === videoId ? { ...current, status: "queued", bucket } : current);
    try {
      await api.queue(videoId, bucket);
      emit("queue-changed");
      setScheduleToast({ id: Date.now(), message: t("scheduledFeedback"), variant: "default", anchor });
    } catch {
      setVideo((current) => current?.video_id === videoId && current.bucket === bucket
        ? { ...current, status: previousStatus, bucket: previousBucket }
        : current);
      setScheduleToast({ id: Date.now(), message: t("scheduleSaveFailed"), variant: "danger", anchor });
    }
  };

  const openPlaylistMenu = async () => {
    if (!video) return;
    setMoreView("playlist");
    setPlaylistsLoading(true);
    try {
      const r = await api.userPlaylists(video.video_id);
      setPlaylists(r.playlists);
    } catch (error) {
      console.error(error);
    } finally {
      setPlaylistsLoading(false);
    }
  };

  const setDesktopPlaylistOpen = async (open: boolean) => {
    if (!video) return;
    setPlaylistOpen(open);
    if (open) {
      setPlaylistsLoading(true);
      try {
        const r = await api.userPlaylists(video.video_id);
        setPlaylists(r.playlists);
      } catch (error) {
        console.error(error);
      } finally {
        setPlaylistsLoading(false);
      }
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
              {privateVideoNotice && video ? (
                <div className="wp-panel wp-panel--members" style={{ backgroundImage: `url(${img(video.thumbnail)})` }}>
                  <div className="wp-panel-scrim" />
                  <div className="wp-panel-content">
                    <span className="wp-members-icon" aria-hidden="true"><Lock /></span>
                    <h3>{t("privateVideoWatchTitle")}</h3>
                    <p className="wp-panel-sub">{t("privateVideoWatchDescription")}</p>
                  </div>
                </div>
              ) : membersOnlyNotice && video ? (
                <div className="wp-panel wp-panel--members" style={{ backgroundImage: `url(${img(video.thumbnail)})` }}>
                  <div className="wp-panel-scrim" />
                  <div className="wp-panel-content">
                    <span className="wp-members-icon" aria-hidden="true"><Star fill="currentColor" /></span>
                    <h3>{t("membersOnlyWatchTitle")}</h3>
                    <p className="wp-panel-sub">{t("membersOnlyWatchDescription")}</p>
                    <ButtonAnchor
                      variant="primary"
                      href={markYouTubeUrl(`https://www.youtube.com/watch?v=${video.video_id}`)}
                      target="_blank"
                      rel="noreferrer"
                      leadingIcon={<ExternalLink />}
                    >
                      {t("membersOnlyWatchAction")}
                    </ButtonAnchor>
                  </div>
                </div>
              ) : playerKind === "stream" && video ? (
                <LocalPlayer
                  key={`${video.video_id}-stream`}
                  ref={playerRef}
                  live
                  liveLabel={t("watchStreamingBadge")}
                  durationSeconds={colonDurationToSeconds(video.duration)}
                  onExitStreaming={exitStreaming}
                  exitStreamingLabel={t("watchExitStreaming")}
                  src={api.hlsUrl(video.video_id)}
                  poster={img(video.thumbnail)}
                  playbackRate={Number(speed)}
                  title={video.title}
                  channelTitle={video.channel_title}
                  artworkUrl={img(video.thumbnail)}
                  cinemaMode={cinemaMode}
                  onToggleCinema={() => setCinemaMode((mode) => !mode)}
                  onEnded={handleEnded}
                  keyboardSeekSeconds={keyboardSeekSeconds}
                  onShortcut={showShortcutFeedback}
                  screenshotFormat={screenshotFormat}
                  screenshotQuality={screenshotQuality}
                  screenshotFilenameTemplate={screenshotFilenameTemplate}
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
              ) : playerKind === "local" && video ? (
                <LocalPlayer
                  key={`${video.video_id}-local-${sharedStartSeconds}`}
                  ref={playerRef}
                  src={api.streamUrl(video.video_id)}
                  poster={img(video.thumbnail)}
                  startSeconds={
                    sharedStartSeconds
                      || Math.floor(streamPositionRef.current)
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
                  screenshotFormat={screenshotFormat}
                  screenshotQuality={screenshotQuality}
                  screenshotFilenameTemplate={screenshotFilenameTemplate}
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
                        <Button variant="primary" onClick={() => setSourceChoice("wait")}>
                          <ArrowDownToLine size={15} /> {t("watchChoiceWait")}
                        </Button>
                        <Button onClick={chooseYouTube}>
                          <MonitorPlay size={15} /> {t("watchChoiceYouTube")}
                        </Button>
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
                      <Button onClick={chooseYouTube}>
                        <MonitorPlay size={15} /> {t("watchChoiceYouTube")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {shortcutFeedback && (() => {
                const Icon = shortcutFeedback.kind === "back" ? Rewind
                  : shortcutFeedback.kind === "forward" ? FastForward
                    : shortcutFeedback.kind === "volumeUp" ? Volume2
                      : shortcutFeedback.kind === "volumeDown" ? Volume1
                        : shortcutFeedback.kind === "mute" ? VolumeX
                          : shortcutFeedback.kind === "unmute" ? Volume2
                        : shortcutFeedback.kind === "sponsorblock" ? FastForward
                          : shortcutFeedback.kind === "screenshot" ? Camera
                            : shortcutFeedback.kind === "screenshotError" ? AlertTriangle
                              : shortcutFeedback.kind === "screenshotUnsupported" ? AlertTriangle
                          : shortcutFeedback.kind === "captionsOn" || shortcutFeedback.kind === "captionsOff" ? Clapperboard : Gauge;
                const sponsorCategory = shortcutFeedback.category ? SB_CATEGORIES.find((category) => category.id === shortcutFeedback.category) : undefined;
                const label = shortcutFeedback.kind === "back" ? `−${shortcutFeedback.seconds ?? keyboardSeekSeconds} s`
                  : shortcutFeedback.kind === "forward" ? `+${shortcutFeedback.seconds ?? keyboardSeekSeconds} s`
                    : shortcutFeedback.kind === "speed" ? "2×"
                      : shortcutFeedback.kind === "mute" ? t("playerMute")
                        : shortcutFeedback.kind === "unmute" ? t("playerUnmute")
                      : shortcutFeedback.kind === "captionsOn" ? t("captionsOn")
                        : shortcutFeedback.kind === "captionsOff" ? t("captionsOff")
                          : shortcutFeedback.kind === "screenshot" ? t("playerScreenshotSaved")
                            : shortcutFeedback.kind === "screenshotError" ? t("playerScreenshotError")
                              : shortcutFeedback.kind === "screenshotUnsupported" ? t("playerScreenshotUnsupported")
                          : shortcutFeedback.kind === "sponsorblock" ? t("sponsorblockSkipped", { category: sponsorCategory ? t(sponsorCategory.labelKey) : shortcutFeedback.category ?? "SponsorBlock" }) : "";
                return <div key={shortcutFeedback.id} className={`shortcut-feedback${shortcutFeedback.kind === "sponsorblock" ? " shortcut-feedback--sponsorblock" : ""}`}><Icon size={19} />{label && <span>{label}</span>}</div>;
              })()}
              {playerKind === "youtube" && youtubeAutoplayBlocked && (
                <div className="wp-autoplay-blocked">
                  <Button variant="primary" onClick={requestYouTubePlayback}>
                    <Play size={16} /> {t("playerPlay")}
                  </Button>
                </div>
              )}
              {upNextVideo && (
                <UpNextOverlay
                  video={upNextVideo}
                  autoplayEnabled={settings?.feed_autoplay_enabled === "1"}
                  onToggleAutoplay={toggleFeedAutoplay}
                  onPlayNow={goToUpNextVideo}
                  onDismiss={() => setUpNextVideo(null)}
                />
              )}
            </div>
          </div>
        </div>
        {playerKind === "youtube" && youtubeError === 153 && (
          <Alert className="youtube-referrer-alert-layout" variant="warning" icon={<AlertTriangle />} title={t("youtubeReferrerErrorTitle")}>{t("youtubeReferrerErrorHint")}</Alert>
        )}
        {(video ?? videoInfo) && (
          <div className="watch-title-row">
            <h1 className="watch-title">{video?.title ?? videoInfo?.title}</h1>
            {playerKind === "local" && (
              <Tooltip text={t("watchLocalPlaybackTooltip")} pos="top" className="watch-local-source-tooltip">
                <span className="watch-local-source-icon" aria-label={t("watchLocalPlaybackTooltip")} tabIndex={0}>
                  <HardDrive size={15} aria-hidden="true" />
                </span>
              </Tooltip>
            )}
          </div>
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
              <ButtonAnchor
                href={markYouTubeUrl(`https://www.youtube.com/watch?v=${videoInfo.videoId}`)}
                target="_blank"
                rel="noreferrer"
                leadingIcon={<ExternalLink size={15} />}
              >YouTube</ButtonAnchor>
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
                <span className="stat"><CalendarDays /> {formatAppDate(videoInfo.publishedAt, locale, timeZone)}</span>
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
            <Button
              ref={likeButtonRef}
              className={`like-btn${video.liked === 1 ? " like-active" : ""}`}
              title={video.liked === 1 ? t("unlike") : t("like")}
              aria-pressed={video.liked === 1}
              onClick={toggleLiked}
            >
              <ThumbsUp fill={video.liked === 1 ? "currentColor" : "none"} />
              <span className="btn-label">{t("like")}</span>
            </Button>
            <div className="watch-action-group watch-action-group--playback">
            <IconButton
              className="watch-action-desktop watch-action-medium"
              variant={cinemaMode ? "secondary" : "default"}
              label={t("cinemaMode")}
              onClick={() => setCinemaMode((m) => !m)}
              aria-pressed={cinemaMode}
            >
              <Clapperboard size={15} />
            </IconButton>
            <Popover
              rootClassName="watch-action-desktop watch-action-medium"
              align="end"
              surface="menu"
              open={speedOpen}
              onOpenChange={setSpeedOpen}
              className="watch-speed-popover"
              trigger={<Button variant={speed !== "1" ? "secondary" : "default"} title={t("playbackSpeed")}>
                <Gauge size={15} /> {speed}×
              </Button>}
            >
                <Menu className="watch-speed-menu">
                  {PLAYBACK_SPEEDS.map((s) => (
                    <MenuItem key={s} selected={speed === s} onClick={() => changeSpeed(s)}>
                      {s === "1" ? "1×" : `${s}×`}
                    </MenuItem>
                  ))}
                  {video.channel_playback_speed != null && (
                    <MenuItem onClick={() => changeSpeed(null)}>{t("speedDefault")}</MenuItem>
                  )}
                </Menu>
            </Popover>
            </div>
            <div className="watch-action-group watch-action-group--organize watch-action-desktop">
            <div className="watch-action-desktop watch-action-medium watch-schedule-anchor">
              <Popover
                align="start"
                surface="menu"
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                className="watch-schedule-popover"
                trigger={<Button>
                <Clock /> {t("watchLater")}
                </Button>}
              >
                  <SchedulePicker onSelect={(bucket) => void queue(bucket, "desktop")} activeBucket={video.bucket} />
              </Popover>
              {scheduleToast?.anchor === "desktop" && <LocalToast key={scheduleToast.id} variant={scheduleToast.variant}>{scheduleToast.message}</LocalToast>}
            </div>
            <Popover
              rootClassName="watch-action-desktop watch-action-wide"
              align="end"
              surface="menu"
              open={playlistOpen}
              onOpenChange={(open) => void setDesktopPlaylistOpen(open)}
              trigger={<Button title={t("addToPlaylist")}>
                <BookmarkPlus /> {t("addToPlaylist")}
              </Button>}
            >
              <PlaylistPicker playlists={playlists} loading={playlistsLoading} name={newPlaylistName} icon={newPlaylistIcon} onNameChange={setNewPlaylistName} onIconChange={setNewPlaylistIcon} onToggle={togglePlaylist} onCreate={createPlaylist} />
            </Popover>
            </div>
            <div className="watch-action-group watch-action-group--utility">
            <div className="share-btn-wrap">
              <Popover
                align="end"
                surface="menu"
                open={shareOpen}
                onOpenChange={setShareOpen}
                className="watch-share-popover"
                trigger={<IconButton variant={shareOpen ? "secondary" : "default"} label={t("share")}>
                <Share2 />
                </IconButton>}
              >
                <div className="share-menu">
                  <div className="share-menu-title">{t("share")}</div>
                  <label className="share-link-label">{settings?.app_name || "YT Zero"}</label>
                  <div className="share-link-field">
                    <input readOnly value={shareLink("webpage") ?? ""} aria-label={settings?.app_name || "YT Zero"} />
                    <IconButton variant="ghost" label={t("copyLink")} onClick={() => copyShareLink("webpage")}><Copy /></IconButton>
                  </div>
                  <label className="share-link-label">YouTube</label>
                  <div className="share-link-field">
                    <input readOnly value={shareLink("youtube") ?? ""} aria-label="YouTube" />
                    <IconButton variant="ghost" label={t("copyLink")} onClick={() => copyShareLink("youtube")}><Copy /></IconButton>
                  </div>
                  <Checkbox className="share-timestamp-option" label={t("includeCurrentTime")} checked={shareWithTimestamp} onChange={(event) => setShareWithTimestamp(event.target.checked)} />
                </div>
              </Popover>
              {copyKey > 0 && <LocalToast key={copyKey}>{t("copied")}</LocalToast>}
            </div>
            <Popover
              rootClassName="watch-action-overflow"
              align="end"
              surface="menu"
              open={moreOpen}
              onOpenChange={setMoreOpen}
              className="watch-more-popover"
              trigger={<IconButton variant={moreOpen ? "secondary" : "default"} label={t("moreActions")}>
                <EllipsisVertical />
              </IconButton>}
            >
              <ScrollArea viewportClassName="watch-more-scroll">
                <div className={`watch-more-menu more-menu--${moreView}`}>
                  {moreView === "root" && (
                    <>
                      <button className="more-item-medium" onClick={() => { setCinemaMode((m) => !m); setMoreOpen(false); }}>
                        <Clapperboard /> {t("cinemaMode")}
                        {cinemaMode && <MenuStatus><Check size={14} /></MenuStatus>}
                      </button>
                      <button className="more-item-medium" onClick={() => setMoreView("speed")}>
                        <Gauge /> {t("channelSpeed")}
                        <MenuStatus>{speed}×</MenuStatus>
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
                      {downloadsEnabled && !isChildProfile && video.is_private !== 1 && video.live_status !== "live" && video.live_status !== "upcoming" && downloadStatus !== "done" && downloadStatus !== "queued" && downloadStatus !== "downloading" && (
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
                          {speed === s && <MenuStatus><Check size={14} /></MenuStatus>}
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
                      <SchedulePicker onSelect={(bucket) => void queue(bucket, "overflow")} activeBucket={video?.bucket} />
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
                      <PlaylistPicker playlists={playlists} loading={playlistsLoading} name={newPlaylistName} icon={newPlaylistIcon} onNameChange={setNewPlaylistName} onIconChange={setNewPlaylistIcon} onToggle={togglePlaylist} onCreate={createPlaylist} />
                    </>
                  )}
                </div>
              </ScrollArea>
            </Popover>
              {scheduleToast?.anchor === "overflow" && <LocalToast key={scheduleToast.id} variant={scheduleToast.variant}>{scheduleToast.message}</LocalToast>}
            </div>
            </div>
          </div>
        }
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
        {video && <div className={`watch-download-feedback-region${downloadFeedbackVisible ? " is-open" : ""}`} aria-hidden={!downloadFeedbackVisible}>
          <div className="watch-download-feedback-region-inner">
            <div className={`watch-download-feedback watch-download-feedback--${downloadFeedbackKind}`} role={downloadFeedbackVisible ? "status" : undefined} aria-live={downloadFeedbackVisible ? "polite" : undefined}>
              <div className="watch-download-feedback-icon">
                {downloadFeedbackKind === "ready" ? <Check /> : downloadFeedbackKind === "downloading" ? <LoaderCircle className="spin" /> : downloadFeedbackKind === "queued" ? <ArrowDownToLine /> : <AlertTriangle />}
              </div>
              <div className="watch-download-feedback-copy">
                <strong>{downloadFeedbackKind === "ready" ? t("watchDownloadReady") : downloadFeedbackKind === "error" ? t("downloadError") : downloadFeedbackKind === "downloading" ? t("downloading") : t("downloadQueued")}</strong>
                {downloadFeedbackKind !== "downloading" && <span>{downloadFeedbackKind === "ready" ? t("watchDownloadReadyHint") : downloadRequestError ? t("watchDownloadRequestFailed") : downloadFeedbackKind === "error" ? (backgroundDownload.error || t("downloadFailedNotificationDescription")) : t("watchDownloadQueuedHint")}</span>}
                {downloadFeedbackKind === "downloading" && <div className="watch-download-feedback-progress"><div style={{ width: `${backgroundDownload.percent ?? 0}%` }} /></div>}
              </div>
              <div className="watch-download-feedback-meta">
                {downloadFeedbackKind === "downloading" && backgroundDownload.percent != null && <span>{Math.floor(backgroundDownload.percent)}%{backgroundDownload.speed ? ` · ${backgroundDownload.speed}` : ""}</span>}
                {downloadFeedbackVisible && (downloadFeedbackKind === "ready"
                  ? <Button size="sm" onClick={reloadDownloadedPlayer}>{t("watchReloadPlayer")}</Button>
                  : downloadFeedbackKind === "error"
                    ? <Button size="sm" onClick={requestDownload}>{t("downloadRetry")}</Button>
                    : <Button size="sm" onClick={cancelOrRemoveDownload}>{t("cancelDownload")}</Button>)}
              </div>
            </div>
          </div>
        </div>}
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
                <span className="stat"><CalendarDays /> {formatAppDate(video.published_at, locale, timeZone)}</span>
              )}
              {!isChildProfile && (
                <a
                  className="watch-youtube-link"
                  href={markYouTubeUrl(`https://www.youtube.com/watch?v=${video.video_id}`)}
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
        {showComments && video && !(isChildProfile && childDownloadsOnly) && (
          <VideoComments
            key={video.video_id}
            videoId={video.video_id}
            creatorAvatar={video.channel_thumbnail}
            cinemaMode={cinemaMode}
            onSeek={(seconds) => {
              playerRef.current?.seekTo(seconds, true);
              playerRef.current?.playVideo?.();
            }}
          />
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
        {showRelated && <>
        <h2 className="related-title">{t("moreLikeThis")}</h2>
        {related.filter((v) => v.is_short === 0 && v.watched !== 1).map((v) => (
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
        </>}
      </aside>
    </div>
  );
}
