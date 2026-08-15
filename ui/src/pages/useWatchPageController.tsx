import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { emit, emitToast, subscribe } from "../events";
import { scheduleSettingWrite } from "../settingsWriteQueue";
import { flushProgressWrite, queueProgressWrite } from "../progressWriteQueue";
import { isIncognitoMode } from "../incognitoMode";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type AppSettings, type Bucket, type PlaylistVideo, type SponsorSegment, type UserPlaylist, type Video, type VideoChapter, type VideoChannelPlaylist, type VideoCreator, type VideoInfo } from "../api";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { parseVideoDurationSeconds } from "../components/VideoCard";
import { img } from "../img";
import { resolvePlayerKind, shouldLatchCompletedDownload, type WatchSourceMode } from "./watchPlayerMode";
import { normalizeSponsorSegments } from "../sponsorblock";
import { markYouTubeUrl } from "../youtubeUrl";
import { DEFAULT_SCREENSHOT_FILENAME_TEMPLATE, parsePlayerScreenshotFormat } from "../playerScreenshot";
import { dispatchEnhanceEvent, ENHANCE_BRIDGE_EVENTS, ENHANCE_BRIDGE_VERSION, parseEnhanceEventDetail, parseEnhancePlayerEvent, resolveEnhanceContentType, sendPlayerCommand, type EnhancePlayerState } from "../enhanceBridge";
import { subscribeServerEvent } from "../serverEvents";
import { isPlaybackQueueContext, type PlaybackQueueContext } from "../playbackQueue";
import { isContinuousPlaylistQueue, playbackEndAction } from "../playlistPlayback";
import { restoreSidebarVisibility } from "../app-shell/sidebarVisibility";
import { canAutoArchiveVideo, isMissingVideoError, loadYouTubeApi, resolveShareTimestamp, resolveWatchPlayerTarget } from "./watchRuntime";
import { useWatchTogetherPlayback } from "./useWatchTogetherPlayback";
import { useYouTubeKeyboardShortcuts, type WatchShortcutKind } from "./useYouTubeKeyboardShortcuts";
import { useUpNextQueue } from "./useUpNextQueue";
import { usePlaylistDownloadPrefetch } from "./usePlaylistDownloadPrefetch";
import { normalizePlaylistSort, playlistSortSearch } from "../playlistSort";
import type { WatchPlayerHandle } from "../playerHandle";
import { canUseWatchAudioMode } from "./watchAudioMode";
import { useWatchPlaybackPosition } from "./useWatchPlaybackPosition";
import { useYouTubeMediaSession } from "./useYouTubeMediaSession";
import { resolveShortcutBindings, SHORTCUT_CLOSE_EVENT, shortcutActionMatches } from "../keyboardShortcuts";

const CINEMA_MODE_KEY = "watchCinemaMode";
const DESCRIPTION_COLLAPSED_HEIGHT = 148;
export function useWatchPageController(audioModeRequested: boolean = false) {
  const { t, language, locale, timeZone } = useI18n();
  const { id, playlistId } = useParams<{ id: string; playlistId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const feedContext = searchParams.get("feedContext") === "1";
  const feedTags = searchParams.get("tags") ?? "";
  const feedShowAll = searchParams.get("show_all") === "1";
  const feedSort = searchParams.get("sort") === "arrival" ? "arrival" : "published";
  const playlistSort = normalizePlaylistSort(searchParams.get("sort"));
  const watchTogetherRoomId = searchParams.get("room")?.trim() || null;
  const routePlaybackQueue = useMemo<PlaybackQueueContext | null>(() => {
    const stateQueue = (location.state as { playbackQueue?: unknown } | null)?.playbackQueue;
    if (isPlaybackQueueContext(stateQueue)) return stateQueue;
    if (playlistId) return { version: 1, kind: "channel-playlist", playlistId, sort: playlistSort };
    if (!feedContext) return null;
    return {
      version: 1,
      kind: "feed",
      tags: feedTags ? feedTags.split(",").map(Number).filter(Boolean) : [],
      showAll: feedShowAll,
      sort: feedSort,
    };
  }, [location.state, playlistId, playlistSort, feedContext, feedTags, feedShowAll, feedSort]);
  const [video, setVideo] = useState<Video | null>(null);
  const playbackQueue = routePlaybackQueue ?? video?.playback_context ?? null;
  const [missingVideoId, setMissingVideoId] = useState<string | null>(null);
  const videoMissing = missingVideoId === id;
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [related, setRelated] = useState<Video[]>([]);
  const [copyKey, setCopyKey] = useState(0);
  const [scheduleToast, setScheduleToast] = useState<{ id: number; message: string; variant: "default" | "danger"; anchor: "desktop" | "overflow" } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [socialShareOpen, setSocialShareOpen] = useState(false);
  const [shareWithTimestamp, setShareWithTimestamp] = useState(false);
  const [socialEnabled, setSocialEnabled] = useState(false);
  const [watchTogetherEnabled, setWatchTogetherEnabled] = useState(false);
  const [socialConfigReady, setSocialConfigReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Withheld until settings load: for a profile that turned suggestions off,
  // rendering them first and pulling them away is worse than a brief gap.
  const showRelated = settings ? settings.watch_show_related !== "0" : false;
  const showComments = settings?.watch_show_comments === "1";
  const [downloadSubtitleLanguages, setDownloadSubtitleLanguages] = useState<string[]>([]);
  const [prefetchNextPlaylistVideo, setPrefetchNextPlaylistVideo] = useState(false);

  useEffect(() => {
    const loadSocial = async () => {
      setSocialConfigReady(false);
      try {
        const { plugins } = await api.plugins();
        const enabled = Boolean(plugins.find((plugin) => plugin.id === "social")?.enabled);
        setSocialEnabled(enabled);
        if (!enabled) {
          setWatchTogetherEnabled(false);
          return;
        }
        const config = await api.pluginSettings("social");
        setWatchTogetherEnabled(Number(config.settings.watch_together_enabled ?? 0) === 1);
      } catch {
        setSocialEnabled(false);
        setWatchTogetherEnabled(false);
      } finally {
        setSocialConfigReady(true);
      }
    };
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
  // The viewer left the experimental stream for their configured player.
  const [skipStreaming, setSkipStreaming] = useState(false);
  const [waitProgress, setWaitProgress] = useState<{ percent: number; speed: string | null } | null>(null);
  const [waitError, setWaitError] = useState<string | null>(null);
  const [backgroundDownload, setBackgroundDownload] = useState<{ percent: number | null; speed: string | null; error: string | null }>({ percent: null, speed: null, error: null });
  const [downloadRequestError, setDownloadRequestError] = useState(false);
  const [downloadReadyToReload, setDownloadReadyToReload] = useState(false);
  const [youtubeAutoplayBlocked, setYoutubeAutoplayBlocked] = useState(false);
  const [youtubeError, setYoutubeError] = useState<number | null>(null);
  const downloadPollGenerationRef = useRef(0);
  // Path to the next playlist video, read by the player's onStateChange when a
  // video ends. A ref keeps the player effect free of playlist dependencies.
  const nextInPlaylistRef = useRef<string | null>(null);
  const playlistItemsRef = useRef<HTMLDivElement>(null);
  const activePlaylistItemRef = useRef<HTMLAnchorElement>(null);
  // Prefetch the next durable queue item. End-of-video policy decides whether
  // a feed merely offers it or an explicitly ordered playlist advances to it.
  const {
    dismiss: dismissUpNextVideo,
    hasPrefetched: hasNextQueueVideo,
    loadingNext: upNextLoadingNext,
    play: goToUpNextVideo,
    playPrefetched: playNextQueueVideo,
    prefetched: prefetchedQueueVideo,
    show: showUpNextVideo,
    skip: skipUpNextVideo,
    video: upNextVideo,
  } = useUpNextQueue({
    currentVideoId: id,
    direction: isContinuousPlaylistQueue(playbackQueue) || settings?.feed_autoplay_direction === "newest" ? "newest" : "oldest",
    navigate,
    queue: playlistId ? null : playbackQueue,
  });
  const queueEndAction = playbackEndAction(
    playbackQueue,
    hasNextQueueVideo,
    settings?.feed_autoplay_enabled === "1",
  );
  // Desired playback rate, read by the player's onReady/onStateChange so the
  // player effect doesn't need speed in its dependency list.
  const speedRef = useRef("1");
  const shortcutFeedbackTimerRef = useRef<number | null>(null);
  const likeButtonRef = useRef<HTMLButtonElement>(null);
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  // Container the YT iframe is injected into; separate from playerWrapRef so
  // the manual DOM cleanup never touches the React-rendered LocalPlayer.
  const ytWrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<WatchPlayerHandle | null>(null);
  const enhancePlayerStateRef = useRef<{ state: EnhancePlayerState; updatedAt: number } | null>(null);
  const archivedRef = useRef(false);
  const canAutoArchiveRef = useRef(false);
  const sbSegmentsRef = useRef<SponsorSegment[]>([]);
  const sbPausedRef = useRef(false);
  const disabledSegsRef = useRef<Set<string>>(new Set());
  const recordedSbSegsRef = useRef<Set<string>>(new Set());
  const endedHandledRef = useRef<string | null>(null);
  const watchedVisitRef = useRef<string | null>(null);

  const showShortcutFeedback = useCallback((kind: WatchShortcutKind, seconds?: number, category?: string) => {
    if (kind === "speed" && seconds != null) {
      const value = String(seconds);
      setSpeed(value);
      speedRef.current = value;
    }
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
      setPrefetchNextPlaylistVideo(downloadsEnabled && Number(downloadConfig?.settings.prefetch_next_playlist_video) === 1);
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

  const matchingVideo = video?.video_id === id ? video : null;
  const downloadStatus = matchingVideo?.download_status ?? null;
  // Which surface fills the player area. Children never get a choice: with
  // downloads_only they are locked to local files, otherwise plain YouTube.
  const watchMode = downloadsEnabled && !isChildProfile ? downloadWatchMode : "youtube";
  const streamingEnabled = experimentalStreaming && !isChildProfile && !skipStreaming;
  const playerKind = resolvePlayerKind({
    hasVideo: !!matchingVideo,
    isLive: matchingVideo?.live_status === "live" || matchingVideo?.live_status === "upcoming",
    downloadStatus,
    localMediaSource: matchingVideo?.local_media_source,
    playerSource,
    playbackPolicyReady,
    childDownloadsOnly,
    sourceChoice,
    watchMode,
    streamingEnabled,
    keepStreamingAfterDownload: downloadReadyToReload,
  });
  const downloadFeedbackKind = downloadReadyToReload ? "ready" : downloadRequestError || downloadStatus === "error" ? "error" : downloadStatus === "downloading" ? "downloading" : "queued";
  const downloadFeedbackVisible = downloadReadyToReload || downloadRequestError || downloadStatus === "queued" || downloadStatus === "downloading" || downloadStatus === "error";
  const privateVideoNotice = matchingVideo?.is_private === 1;
  const membersOnlyNotice = matchingVideo?.members_only === 1 && !isChildProfile && !privateVideoNotice;
  const playerTargetId = resolveWatchPlayerTarget(id, video?.video_id, missingVideoId);
  canAutoArchiveRef.current = canAutoArchiveVideo(video, id);
  const audioModeAvailable = canUseWatchAudioMode({
    childProfile: isChildProfile,
    hasVideo: Boolean(matchingVideo),
    liveStatus: matchingVideo?.live_status ?? "none",
    membersOnly: Boolean(membersOnlyNotice),
    playerKind,
    privateVideo: Boolean(privateVideoNotice),
    watchTogetherRoomId,
  });
  const audioActive = audioModeRequested && audioModeAvailable;
  // Both "local" and "stream" render the LocalPlayer component (same layout).
  const usingLocal = !audioActive && (playerKind === "local" || playerKind === "stream") && !membersOnlyNotice && !privateVideoNotice;
  const sharedTimestamp = Number(new URLSearchParams(location.search).get("t"));
  const sharedStartSeconds = Number.isFinite(sharedTimestamp) ? Math.max(0, Math.floor(sharedTimestamp)) : 0;
  const {
    capturePlaybackPosition, playbackPositionVideoIdRef, playbackStartSeconds,
    progressRef, streamPositionRef,
  } = useWatchPlaybackPosition({
    audioActive, id, membersOnlyNotice, playerKind, playerRef,
    privateVideoNotice, sharedStartSeconds, video,
  });
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
      // Keep the native call inside the user gesture so browser autoplay
      // policy can approve it. Enhance remains an additional control path.
      p?.playVideo?.();
      if (id) void sendPlayerCommand(id, "play").catch(() => {});
    } catch {}
  }, [id]);

  const setWatchTogetherRoomId = useCallback((nextRoomId: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextRoomId) next.set("room", nextRoomId);
      else next.delete("room");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const {
    room: watchTogether,
    transportLocked: watchTogetherTransportLocked,
    transportLockedRef: watchTogetherTransportLockedRef,
  } = useWatchTogetherPlayback({
    configReady: socialConfigReady,
    enabled: socialEnabled && watchTogetherEnabled,
    enhancePlayerStateRef,
    id,
    joinErrorLabel: t("watchTogetherJoinError"),
    playerKind,
    playerRef,
    requestPlayback: requestYouTubePlayback,
    roomId: watchTogetherRoomId,
    setMoreView,
    setRoomId: setWatchTogetherRoomId,
    setSpeed,
    setSpeedOpen,
    speedRef,
    videoId: video?.video_id,
  });

  // Publish the authenticated, effective per-video snapshot after room state is
  // known, so the extension receives the same transport lock as the parent.
  useEffect(() => {
    if (playerKind !== "youtube" || !video) return;
    const publishContext = () => dispatchEnhanceEvent(ENHANCE_BRIDGE_EVENTS.context, {
      version: ENHANCE_BRIDGE_VERSION, active: true,
      video: { id: video.video_id, title: video.title, channelId: video.channel_id, channelTitle: video.channel_title, duration: parseVideoDurationSeconds(video.duration) ?? 0, contentType: resolveEnhanceContentType(video) },
      playback: {
        rate: Number(video.channel_playback_speed ?? settings?.player_speed ?? 1) || 1, keyboardSeekSeconds,
        keyboardShortcuts: resolveShortcutBindings(settings?.keyboard_shortcuts), frameStepFps: Math.max(1, Number(settings?.enhance_frame_fps ?? 30) || 30), transportLocked: watchTogetherTransportLocked,
        captions: { enabledByDefault: captionsDefaultOn, language: captionsDefaultLang, style: { fontSizePx: subtitleSize, color: settings?.player_sub_color || "#ffffff", backgroundOpacityPercent: Number(settings?.player_sub_bg ?? 75) } },
        chapters, sponsorBlockSegments: watchTogetherRoomId ? [] : sbSegments,
      },
      screenshot: { format: screenshotFormat, quality: screenshotQuality, filenameTemplate: screenshotFilenameTemplate },
    });
    publishContext(); document.addEventListener(ENHANCE_BRIDGE_EVENTS.ready, publishContext);
    return () => document.removeEventListener(ENHANCE_BRIDGE_EVENTS.ready, publishContext);
  }, [captionsDefaultLang, captionsDefaultOn, chapters, keyboardSeekSeconds, playerKind, screenshotFilenameTemplate, screenshotFormat, screenshotQuality, sbSegments, settings?.enhance_frame_fps, settings?.keyboard_shortcuts, settings?.player_speed, settings?.player_sub_bg, settings?.player_sub_color, subtitleSize, video, watchTogetherRoomId, watchTogetherTransportLocked]);

  const chooseYouTube = useCallback(() => {
    setYoutubeAutoplayBlocked(false);
    setSourceChoice("youtube");
  }, []);

  useEffect(() => { setSkipStreaming(false); }, [id]);

  // Leave the experimental stream: fall back to whatever the viewer's configured
  // player would be (download-wait / ask / YouTube — or the local file if the
  // background download already finished).
  const exitStreaming = useCallback(() => {
    capturePlaybackPosition();
    setSkipStreaming(true);
  }, [capturePlaybackPosition]);

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
    // Wait for the matching video snapshot. Otherwise this runs once with an
    // unknown privacy state and again as soon as the video request resolves.
    if (!id || video?.video_id !== id) return;
    let cancelled = false;
    Promise.allSettled([video?.is_private === 1 ? Promise.resolve({ chapters: [] }) : api.chapters(id), api.videoPlaylists(id)]).then(([chapterResult, playlistResult]) => {
      if (cancelled) return;
      setChapters(chapterResult.status === "fulfilled" ? chapterResult.value.chapters : []);
      setVideoPlaylists(playlistResult.status === "fulfilled" ? playlistResult.value.playlists : []);
    });
    return () => { cancelled = true; };
  }, [id, video?.video_id, video?.is_private]);

  useEffect(() => {
    if (!playlistId) { setPlaylistVideos([]); return; }
    let cancelled = false;
    api.playlistVideos(playlistId, playlistSort)
      .then((r) => { if (!cancelled) setPlaylistVideos(r.videos); })
      .catch(() => { if (!cancelled) setPlaylistVideos([]); });
    return () => { cancelled = true; };
  }, [playlistId, playlistSort]);

  const playlistIndex = playlistId ? playlistVideos.findIndex((v) => v.videoId === id) : -1;
  const nextPlaylistVideo = playlistIndex >= 0 ? playlistVideos[playlistIndex + 1] : undefined;
  const previousPlaylistVideo = playlistIndex > 0 ? playlistVideos[playlistIndex - 1] : undefined;
  const nextPlaylistPath = nextPlaylistVideo ? `/watch/${nextPlaylistVideo.videoId}/playlist/${playlistId}${playlistSortSearch(playlistSort)}` : null;
  const previousPlaylistPath = previousPlaylistVideo ? `/watch/${previousPlaylistVideo.videoId}/playlist/${playlistId}${playlistSortSearch(playlistSort)}` : null;
  usePlaylistDownloadPrefetch({ enabled: prefetchNextPlaylistVideo, playlistId, routeNextVideoId: nextPlaylistVideo?.videoId, queue: playbackQueue, queueNextVideoId: prefetchedQueueVideo?.video_id });

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
    nextInPlaylistRef.current = nextPlaylistPath;
  }, [nextPlaylistPath]);

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
    let cancelled = false;
    setDescOpen(false);
    setVideo(null);
    setMissingVideoId(null);
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
        if (cancelled) return;
        setVideo(r.video);
        setRelated(r.related);
        // External video already in DB but its RSS siblings were cleared:
        // refresh them in the background so the "related" panel refills.
        if (r.video.external && r.related.length === 0) {
          api.videoInfo(id)
            .then(() => api.video(id))
            .then((r2) => { if (!cancelled) setRelated(r2.related); })
            .catch(() => {});
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        if (isMissingVideoError(e)) {
          setMissingVideoId(id);
          api.videoInfo(id)
            .then((r) => {
              if (cancelled) return;
              setVideoInfo(r.info);
              // Video was just inserted as external — fetch the full Video object
              return api.video(id).then((full) => {
                if (cancelled) return;
                setVideo(full.video);
                setRelated(full.related);
                setMissingVideoId(null);
                setVideoInfo(null);
              });
            })
            .catch(() => {});
        } else {
          console.error(e);
        }
      });
    // React StrictMode re-runs effects in development. Record one visit per
    // actual route transition instead of inserting duplicate history rows.
    if (!isIncognitoMode() && watchedVisitRef.current !== id) {
      watchedVisitRef.current = id;
      api.watch(id, routePlaybackQueue ?? undefined).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [id]);

  // When a video finishes: record completion, advance the playlist if any.
  const handleEnded = useCallback(() => {
    if (!id) return;
    if (endedHandledRef.current === id) return;
    endedHandledRef.current = id;
    if (!isIncognitoMode()) api.complete(id).catch(() => {});
    // A watch room is tied to one video. Keep the ended player and chat in
    // place instead of silently navigating the host away from every guest.
    if (watchTogetherRoomId) return;
    if (nextInPlaylistRef.current) navigate(nextInPlaylistRef.current);
    else if (queueEndAction === "advance") playNextQueueVideo();
    else if (queueEndAction === "offer") showUpNextVideo();
  }, [id, navigate, playNextQueueVideo, queueEndAction, showUpNextVideo, watchTogetherRoomId]);

  const playNextVideo = useCallback(() => {
    if (watchTogetherRoomId) return;
    if (nextPlaylistPath) navigate(nextPlaylistPath);
    else playNextQueueVideo();
  }, [navigate, nextPlaylistPath, playNextQueueVideo, watchTogetherRoomId]);
  const canPlayNextVideo = !watchTogetherRoomId && Boolean(
    nextPlaylistPath || queueEndAction !== "stop",
  );
  const closeWatchMode = useCallback(() => {
    if (document.querySelector(".ui-dialog")) document.dispatchEvent(new Event(SHORTCUT_CLOSE_EVENT));
    else if (document.fullscreenElement) void document.exitFullscreen?.();
    else if ((document as any).pictureInPictureElement) void (document as any).exitPictureInPicture?.();
    else setCinemaMode(false);
  }, []);

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
    if (playerKind !== "youtube" || audioActive || !id) return;
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
        if (action === "toggleTheater" || action === "cinema-mode") setCinemaMode((current) => !current);
        else if (action === "previousVideo" && !watchTogetherRoomId && previousPlaylistPath) navigate(previousPlaylistPath);
        else if (action === "nextVideo" && canPlayNextVideo) playNextVideo();
        else if (action === "close") closeWatchMode();
        else if (action === "seekBack" || action === "seek-back") showShortcutFeedback("back", keyboardSeekSeconds);
        else if (action === "seekForward" || action === "seek-forward") showShortcutFeedback("forward", keyboardSeekSeconds);
        else if (action === "seekBack10" || action === "seek-back-10") showShortcutFeedback("back", 10);
        else if (action === "seekForward10" || action === "seek-forward-10") showShortcutFeedback("forward", 10);
        else if (action === "volumeUp" || action === "volume-up") showShortcutFeedback("volumeUp");
        else if (action === "volumeDown" || action === "volume-down") showShortcutFeedback("volumeDown");
        else if (action === "toggleMute" || action === "toggle-muted") showShortcutFeedback(enhancePlayerStateRef.current?.state.muted ? "unmute" : "mute");
        else if ((action === "speedDown" || action === "speedUp") && message.payload.value) showShortcutFeedback("speed", message.payload.value);
        return;
      }

      if (message.type === "captions-toggle-request") {
        toggleEnhancedCaptions();
        return;
      }

      if (message.type === "ended" && !watchTogetherTransportLockedRef.current) handleEndedRef.current();
    };
    document.addEventListener(ENHANCE_BRIDGE_EVENTS.playerEvent, onPlayerEvent);
    return () => document.removeEventListener(ENHANCE_BRIDGE_EVENTS.playerEvent, onPlayerEvent);
  }, [audioActive, canPlayNextVideo, closeWatchMode, id, keyboardSeekSeconds, navigate, playerKind, playNextVideo, previousPlaylistPath, showShortcutFeedback, watchTogetherRoomId]);

  // Create the player (YT iframe or the ref populated by LocalPlayer) and poll
  // progress every second. The poll runs against the shared YT-shaped player
  // API, so progress saving, auto-archive and SponsorBlock work for both.
  useEffect(() => {
    if (!playerTargetId) return;
    const activeVideoId = playerTargetId;

    // In "stream" mode the reported duration is the downloaded length so far,
    // not the full video — persisting progress or auto-archiving off that ratio
    // would be wrong. The saved download handles resume on the next visit.
    const isStream = playerKind === "stream" && !audioActive;
    let wasPlaying = false;
    let lastLifecycleFlushAt = 0;

    const startSeconds = playbackStartSeconds;

    const poll = () => {
      const p = playerRef.current;
      const enhancedSnapshot = playerKind === "youtube" && !audioActive ? enhancePlayerStateRef.current : null;
      const enhancedState = enhancedSnapshot && Date.now() - enhancedSnapshot.updatedAt < 2_500 ? enhancedSnapshot.state : null;
      if (!p && !enhancedState) return;
      try {
        const position = enhancedState?.currentTime ?? p?.getCurrentTime();
        const playerDuration = enhancedState?.duration ?? p?.getDuration();
        if (!position || !playerDuration) return;
        playbackPositionVideoIdRef.current = activeVideoId;
        if (isStream) streamPositionRef.current = position;
        if (!isStream) progressRef.current = { position, duration: playerDuration };
        if (playerKind === "youtube" && !audioActive && "mediaSession" in navigator) {
          try {
            navigator.mediaSession.setPositionState({
              duration: playerDuration,
              playbackRate: Number(speedRef.current) || 1,
              position: Math.min(position, playerDuration),
            });
          } catch {}
        }
        const isPlaying = enhancedState ? !enhancedState.paused && !enhancedState.ended : p?.getPlayerState?.() === 1;
        if (!isPlaying) {
          if (wasPlaying && !isStream) {
            queueProgressWrite(activeVideoId, position, playerDuration);
            flushProgressWrite(activeVideoId);
          }
          wasPlaying = false;
          return;
        }
        wasPlaying = true;
        if (!isStream) {
          queueProgressWrite(activeVideoId, position, playerDuration);
          if (!isIncognitoMode() && canAutoArchiveRef.current && playerDuration > 30 && position / playerDuration >= 0.9 && !archivedRef.current) {
            archivedRef.current = true;
            queueProgressWrite(activeVideoId, playerDuration, playerDuration);
            flushProgressWrite(activeVideoId);
            api.complete(activeVideoId).catch(() => {});
            api.archiveVideo(activeVideoId).catch(() => {});
          }
        }
        if (!watchTogetherTransportLockedRef.current && !sbPausedRef.current) {
          for (const seg of sbSegmentsRef.current) {
            if (disabledSegsRef.current.has(seg.UUID)) continue;
            if (position >= seg.segment[0] && position < seg.segment[1] - 0.3) {
              const skippedSeconds = seg.segment[1] - position;
              p?.seekTo?.(seg.segment[1], true);
              showShortcutFeedback("sponsorblock", skippedSeconds, seg.category);
              if (!isIncognitoMode() && !recordedSbSegsRef.current.has(seg.UUID)) {
                recordedSbSegsRef.current.add(seg.UUID);
                api.recordSponsorBlockSkip(activeVideoId, seg, skippedSeconds).catch((error) => {
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

    const saveCurrentProgress = (keepalive: boolean) => {
      if (progressRef.current && !archivedRef.current) {
        const { position, duration } = progressRef.current;
        queueProgressWrite(activeVideoId, position, duration);
        flushProgressWrite(activeVideoId, keepalive);
      }
    };

    const flushForPageLifecycle = () => {
      const now = Date.now();
      if (now - lastLifecycleFlushAt < 1_000) return;
      lastLifecycleFlushAt = now;
      saveCurrentProgress(true);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushForPageLifecycle();
    };

    const attachPageLifecycle = () => {
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("pagehide", flushForPageLifecycle);
    };

    const saveOnExit = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushForPageLifecycle);
      if (Date.now() - lastLifecycleFlushAt >= 1_000) saveCurrentProgress(true);
    };

    if (membersOnlyNotice) return;

    if (playerKind === "local" || playerKind === "stream" || audioActive) {
      // LocalPlayer renders the <video> itself and fills playerRef via its ref.
      // In "stream" mode the duration is unknown, so poll() self-skips progress
      // saving and auto-archive — SponsorBlock/resume just wait for the download.
      const pollInterval = setInterval(poll, 1_000);
      attachPageLifecycle();
      return () => {
        clearInterval(pollInterval);
        saveOnExit();
      };
    }

    // Decision/waiting/blocked panels have no player to drive. Audio mode swaps
    // the iframe for the standalone <audio> proxy, so skip creating it entirely.
    if (playerKind !== "youtube") return;

    const wrap = ytWrapRef.current;
    if (!wrap) return;
    attachPageLifecycle();

    const playerVars: Record<string, any> = {
      autoplay: watchTogetherRoomId ? 0 : 1,
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
    let youtubePlayer: WatchPlayerHandle | null = null;
    // YT resets the rate to 1× on load, so apply the desired speed once the
    // player is ready and again on the first PLAYING event to make it stick.
    let speedApplied = false;
    const applySpeed = (p: any) => {
      try { p?.setPlaybackRate(Number(speedRef.current)); } catch {}
    };

    const inner = document.createElement("div");
    inner.id = `yt-inner-${activeVideoId}`;
    wrap.appendChild(inner);

    loadYouTubeApi().then(() => {
      if (destroyed) return;
      const w = window as any;
      youtubePlayer = new w.YT.Player(`yt-inner-${activeVideoId}`, {
        host: "https://www.youtube-nocookie.com",
        videoId: activeVideoId,
        width: "100%",
        height: "100%",
        playerVars,
        events: {
          onReady: (e: any) => {
            if (destroyed) return;
            applySpeed(e.target);
            if (watchTogetherTransportLockedRef.current) {
              const iframe = e.target?.getIframe?.() as HTMLIFrameElement | undefined;
              if (iframe) iframe.tabIndex = -1;
            }
            if (channelCaptionsOff) {
              try { e.target.unloadModule?.("captions"); } catch {}
            }
            if (!watchTogetherRoomId) requestYouTubePlayback();
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
              if (!watchTogetherTransportLockedRef.current) handleEndedRef.current();
            }
          },
          onError: (e: any) => {
            if (!destroyed) setYoutubeError(Number(e?.data) || null);
          },
        },
      });
      playerRef.current = youtubePlayer;

      pollInterval = setInterval(poll, 1_000);
    });

    return () => {
      destroyed = true;
      clearInterval(pollInterval);
      saveOnExit();
      if (youtubePlayer) {
        try { youtubePlayer.destroy(); } catch {}
        if (playerRef.current === youtubePlayer) playerRef.current = null;
      }
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    };
  }, [playerTargetId, membersOnlyNotice, playerKind, audioActive, requestYouTubePlayback, captionsDefaultOn, captionsDefaultLang, channelCaptionsOff, sharedStartSeconds]);

  useYouTubeMediaSession({ audioActive, playerKind, playerRef, video, watchTogetherTransportLocked });

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
    if (watchTogetherTransportLocked) {
      setMoreOpen(false);
      setSpeedOpen(false);
      return;
    }
    const eff = v ?? settings?.player_speed ?? "1";
    setSpeed(eff);
    speedRef.current = eff;
    const applyFallback = () => { try { playerRef.current?.setPlaybackRate?.(Number(eff)); } catch {} };
    if (audioActive) applyFallback();
    else if (id) void sendPlayerCommand(id, "set-playback-rate", { rate: Number(eff) }).catch(applyFallback);
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

  // Page-level shortcuts own navigation and presentation modes. Player-local
  // transport remains in the active player so one key produces one action.
  useEffect(() => {
    const bindings = resolveShortcutBindings(settings?.keyboard_shortcuts);
    const matches = (action: Parameters<typeof shortcutActionMatches>[0], event: KeyboardEvent) => shortcutActionMatches(action, event, bindings);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      if (matches("toggleTheater", e)) { e.preventDefault(); if (!e.repeat) setCinemaMode((v) => !v); }
      else if (matches("previousVideo", e)) { e.preventDefault(); if (!e.repeat && !watchTogetherRoomId && previousPlaylistPath) navigate(previousPlaylistPath); }
      else if (matches("nextVideo", e)) { e.preventDefault(); if (!e.repeat && canPlayNextVideo) playNextVideo(); }
      else if (matches("close", e)) { e.preventDefault(); closeWatchMode(); }
      else if (matches("toggleFullscreen", e) && playerKind !== "local" && playerKind !== "stream") {
        e.preventDefault();
        const el = playerWrapRef.current ?? document.documentElement;
        if (!document.fullscreenElement) el.requestFullscreen?.();
        else document.exitFullscreen?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [canPlayNextVideo, closeWatchMode, navigate, playNextVideo, playerKind, previousPlaylistPath, settings?.keyboard_shortcuts, watchTogetherRoomId]);

  useYouTubeKeyboardShortcuts({
    audioActive,
    chapters,
    frameRate: Math.max(1, Number(settings?.enhance_frame_fps ?? 30) || 30),
    enhancePlayerStateRef,
    id,
    keyboardSeekSeconds,
    keyboardShortcuts: settings?.keyboard_shortcuts,
    playerKind,
    playerRef,
    showFeedback: showShortcutFeedback,
    speedRef,
    takeScreenshot: takeEmbeddedScreenshot,
    transportLocked: watchTogetherTransportLocked,
  });

  // While this video is being fetched — or is playing via the experimental
  // Track background downloads. A normal remote player remains mounted when
  // the file becomes ready; the viewer explicitly chooses when to reload it.
  useEffect(() => {
    const generation = ++downloadPollGenerationRef.current;
    let cancelled = false;
    let inFlight = false;
    let reloadQueued = false;
    const active = downloadStatus === "queued" || downloadStatus === "downloading" || downloadStatus === "error" || playerKind === "stream";
    if (!id || !active || playerKind === "waiting") {
      setBackgroundDownload({ percent: null, speed: null, error: null });
      return;
    }
    const isCurrent = () => !cancelled && downloadPollGenerationRef.current === generation;
    const load = () => {
      if (!isCurrent()) return;
      if (inFlight) { reloadQueued = true; return; }
      inFlight = true;
      api.videoDownload(id).then((result) => {
        if (!isCurrent()) return;
        const status = result.download?.status ?? null;
        if (shouldLatchCompletedDownload(playerKind, downloadStatus, status)) {
          if (playerKind === "youtube") setPlayerSource("youtube");
          setDownloadReadyToReload(true);
        }
        setBackgroundDownload({ percent: result.progress?.percent ?? null, speed: result.progress?.speed ?? null, error: result.download?.error ?? null });
        setVideo((prev) => prev?.video_id === id ? { ...prev, download_status: status } : prev);
      }).catch(() => {}).finally(() => {
        inFlight = false;
        if (isCurrent() && reloadQueued) { reloadQueued = false; load(); }
      });
    };
    load();
    const unsubscribe = subscribeServerEvent("downloads", (data) => {
      if (!data?.videoId || data.videoId === id) load();
    });
    return () => { cancelled = true; unsubscribe(); };
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
    capturePlaybackPosition();
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
    audioActive,
    audioModeAvailable,
    appUrl,
    backgroundDownload,
    cancelOrRemoveDownload,
    canPlayNextVideo,
    captionsDefaultLang,
    captionsDefaultOn,
    capturePlaybackPosition,
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
    dismissUpNextVideo,
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
    playNextVideo,
    playlistId,
    playlistIndex,
    playlistItemsRef,
    playlistOpen,
    playbackStartSeconds,
    playlistSort,
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
    settings,
    shareLink,
    shareOpen,
    shareWithTimestamp,
    sharedStartSeconds,
    shortcutFeedback,
    showComments,
    showRelated,
    showShortcutFeedback,
    skipUpNextVideo,
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
    upNextLoadingNext,
    usingLocal,
    video,
    videoCreators,
    videoInfo,
    videoMissing,
    videoPlaylists,
    waitError,
    waitProgress,
    watchTogether,
    watchTogetherEnabled,
    watchTogetherRoomId,
    watchTogetherTransportLocked,
    youtubeAutoplayBlocked,
    youtubeError,
    ytWrapRef,
  };
}
