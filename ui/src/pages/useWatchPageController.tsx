import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import "./WatchPage.css";
import { emit, emitToast, subscribe } from "../events";
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
  ChevronRight,
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
  UsersRound,
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
import { BUCKET_ICONS, formatVideoDuration, parseVideoDurationSeconds } from "../components/VideoCard";
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
import { dispatchEnhanceEvent, ENHANCE_BRIDGE_EVENTS, ENHANCE_BRIDGE_VERSION, parseEnhanceEventDetail, parseEnhancePlayerEvent, resolveEnhanceContentType, sendPlayerCommand, type EnhancePlayerState } from "../enhanceBridge";
import { subscribeServerEvent } from "../serverEvents";
import VideoComments from "../components/VideoComments";
import SocialShareDialog from "../components/social/SocialShareDialog";
import { isPlaybackQueueContext, nextSnapshotVideoId, type PlaybackQueueContext } from "../playbackQueue";
import WatchDescription from "../components/watch/WatchDescription";
import { colonDurationToSeconds, formatWatchTime, loadYouTubeApi, resolveShareTimestamp, restoreSidebarVisibility } from "./watchRuntime";

type WatchShortcutKind = LocalPlayerShortcut | "sponsorblock" | "screenshotUnsupported";

const CINEMA_MODE_KEY = "watchCinemaMode";
const DESCRIPTION_COLLAPSED_HEIGHT = 148;



export function useWatchPageController() {
  const { t, bucketLabel, language, locale, timeZone } = useI18n();
  const { id, playlistId } = useParams<{ id: string; playlistId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const feedContext = searchParams.get("feedContext") === "1";
  const feedTags = searchParams.get("tags") ?? "";
  const feedShowAll = searchParams.get("show_all") === "1";
  const feedSort = searchParams.get("sort") === "arrival" ? "arrival" : "published";
  const playbackQueue = useMemo<PlaybackQueueContext | null>(() => {
    const stateQueue = (location.state as { playbackQueue?: unknown } | null)?.playbackQueue;
    if (isPlaybackQueueContext(stateQueue)) return stateQueue;
    if (!feedContext) return null;
    return {
      kind: "feed",
      tags: feedTags ? feedTags.split(",").map(Number).filter(Boolean) : [],
      showAll: feedShowAll,
      sort: feedSort,
    };
  }, [location.state, feedContext, feedTags, feedShowAll, feedSort]);
  const [video, setVideo] = useState<Video | null>(null);
  const [videoMissing, setVideoMissing] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [related, setRelated] = useState<Video[]>([]);
  const [copyKey, setCopyKey] = useState(0);
  const [scheduleToast, setScheduleToast] = useState<{ id: number; message: string; variant: "default" | "danger"; anchor: "desktop" | "overflow" } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [socialShareOpen, setSocialShareOpen] = useState(false);
  const [shareWithTimestamp, setShareWithTimestamp] = useState(false);
  const [socialEnabled, setSocialEnabled] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Withheld until settings load: for a profile that turned suggestions off,
  // rendering them first and pulling them away is worse than a brief gap.
  const showRelated = settings ? settings.watch_show_related !== "0" : false;
  const showComments = settings?.watch_show_comments === "1";
  const [downloadSubtitleLanguages, setDownloadSubtitleLanguages] = useState<string[]>([]);

  useEffect(() => {
    const loadSocial = () => api.plugins().then(({ plugins }) => setSocialEnabled(Boolean(plugins.find((plugin) => plugin.id === "social")?.enabled))).catch(() => setSocialEnabled(false));
    void loadSocial();
    return subscribe("plugins-changed", loadSocial);
  }, []);
  const [playbackPolicy, setPlaybackPolicy] = useState<{
    ready: boolean;
    downloadsEnabled: boolean;
    isChildProfile: boolean;
    childDownloadsOnly: boolean;
    downloadWatchMode: WatchSourceMode;
    experimentalStreaming: boolean;
  }>({
    ready: false,
    downloadsEnabled: false,
    isChildProfile: false,
    childDownloadsOnly: false,
    downloadWatchMode: "youtube",
    experimentalStreaming: false,
  });
  const {
    ready: playbackPolicyReady,
    downloadsEnabled,
    isChildProfile,
    childDownloadsOnly,
    downloadWatchMode,
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
  const nextInQueueRef = useRef<Video | null>(null);
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
      let downloadWatchMode: WatchSourceMode = "youtube";
      if (downloadsEnabled) {
        const configuredMode = downloadConfig?.settings.watch_source_mode;
        if (configuredMode === "ask" || configuredMode === "download") downloadWatchMode = configuredMode;
      }
      const experimentalStreaming = downloadsEnabled && Number(downloadConfig?.settings.experimental_streaming) === 1;
      if (cancelled) return;
      setDownloadSubtitleLanguages(subtitleLanguages);
      setPlaybackPolicy({
        ready: true,
        downloadsEnabled,
        isChildProfile: childStatus?.is_child ?? false,
        childDownloadsOnly: !!(childStatus?.is_child && childStatus.downloads_only),
        downloadWatchMode,
        experimentalStreaming,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  const downloadStatus = video?.download_status ?? null;
  // Which surface fills the player area. Children never get a choice: with
  // downloads_only they are locked to local files, otherwise plain YouTube.
  const watchMode = downloadsEnabled && !isChildProfile ? downloadWatchMode : "youtube";
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
        duration: parseVideoDurationSeconds(video.duration) ?? 0,
        contentType: resolveEnhanceContentType(video),
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

  // Resolve the next entry from the list that opened this watch page. Feed is
  // server-backed so it spans unloaded pages; finite shelves carry a snapshot
  // of their exact visible order in router state.
  useEffect(() => {
    nextInQueueRef.current = null;
    setUpNextVideo(null);
    if (!id || !playbackQueue) return;
    let cancelled = false;
    const direction = settings?.feed_autoplay_direction === "newest" ? "newest" : "oldest";
    const request = playbackQueue.kind === "feed"
      ? api.feedAdjacent(id, direction, { tags: playbackQueue.tags, showAll: playbackQueue.showAll, sort: playbackQueue.sort })
      : (() => {
          const nextId = nextSnapshotVideoId(playbackQueue, id, direction);
          return nextId ? api.video(nextId).then((result) => ({ video: result.video })) : Promise.resolve({ video: null });
        })();
    request
      .then((r) => { if (!cancelled) nextInQueueRef.current = r.video; })
      .catch(() => { if (!cancelled) nextInQueueRef.current = null; });
    return () => { cancelled = true; };
  }, [id, playbackQueue, settings?.feed_autoplay_direction]);

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
    else if (settings?.feed_autoplay_enabled === "1" && nextInQueueRef.current) setUpNextVideo(nextInQueueRef.current);
  }, [id, navigate, settings?.feed_autoplay_enabled]);

  const goToUpNextVideo = useCallback(() => {
    if (!upNextVideo) return;
    navigate(`/watch/${upNextVideo.video_id}`, playbackQueue ? { state: { playbackQueue } } : undefined);
  }, [upNextVideo, playbackQueue, navigate]);

  const toggleFeedAutoplay = useCallback((next: boolean) => {
    const behavior = next ? "autoplay" : "prompt";
    setSettings((s) => s ? { ...s, feed_autoplay_behavior: behavior } : s);
    api.updateSettings({ feed_autoplay_behavior: behavior }).catch(() => {});
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
      seconds = resolveShareTimestamp(enhancePlayerStateRef.current?.state.currentTime, () => playerRef.current?.getCurrentTime?.(), streamPositionRef.current, progressRef.current?.position);
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


  return {
    activePlaylistItemRef,
    appUrl,
    backgroundDownload,
    cancelOrRemoveDownload,
    captionsDefaultLang,
    captionsDefaultOn,
    changeSpeed,
    changeSubtitleSize,
    chapters,
    childDownloadsOnly,
    chooseYouTube,
    cinemaMode,
    cinemaVisible,
    copyKey,
    copyShareLink,
    createPlaylist,
    creatorHandles,
    descExpandable,
    descOpen,
    descriptionRef,
    disabledSegs,
    downloadFeedbackKind,
    downloadFeedbackVisible,
    downloadRequestError,
    downloadStatus,
    downloadSubtitleLanguages,
    downloadsEnabled,
    exitStreaming,
    goToUpNextVideo,
    handleEnded,
    id,
    isChildProfile,
    keyboardSeekSeconds,
    language,
    likeButtonRef,
    locale,
    membersOnlyNotice,
    moreOpen,
    moreView,
    newPlaylistIcon,
    newPlaylistName,
    openPlaylistMenu,
    playerKind,
    playerRef,
    playerWrapRef,
    playlistId,
    playlistIndex,
    playlistItemsRef,
    playlistOpen,
    playlistVideos,
    playlists,
    playlistsLoading,
    privateVideoNotice,
    progressRef,
    queue,
    related,
    reload,
    reloadDownloadedPlayer,
    requestDownload,
    requestYouTubePlayback,
    sbPaused,
    sbSegments,
    scheduleOpen,
    scheduleToast,
    screenshotFilenameTemplate,
    screenshotFormat,
    screenshotQuality,
    setCinemaMode,
    setDescOpen,
    setDesktopPlaylistOpen,
    setDisabledSegs,
    setMoreOpen,
    setMoreView,
    setNewPlaylistIcon,
    setNewPlaylistName,
    setSbPaused,
    setScheduleOpen,
    setShareOpen,
    setShareWithTimestamp,
    setSocialShareOpen,
    setSourceChoice,
    setSpeedOpen,
    setUpNextVideo,
    settings,
    shareLink,
    shareOpen,
    shareWithTimestamp,
    sharedStartSeconds,
    shortcutFeedback,
    showComments,
    showRelated,
    showShortcutFeedback,
    socialEnabled,
    socialShareOpen,
    speed,
    speedOpen,
    streamPositionRef,
    subtitleSize,
    t,
    timeZone,
    toggleFeedAutoplay,
    toggleLiked,
    togglePlaylist,
    toggleRelatedSchedule,
    upNextVideo,
    usingLocal,
    video,
    videoCreators,
    videoInfo,
    videoMissing,
    videoPlaylists,
    waitError,
    waitProgress,
    youtubeAutoplayBlocked,
    youtubeError,
    ytWrapRef,
  };
}
