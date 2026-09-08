import { useEffect, useRef, useState } from "react";
import "./ChannelPage.css";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bell, CalendarClock, Captions, ExternalLink, FileClock, Gauge, ListRestart, ListVideo, MessageSquareText, Plus, Radio, RefreshCw, Search, Star, UserMinus, UserPlus, Video as VideoIcon, X, Zap } from "lucide-react";
import { api, type ChannelAbout, type ChannelManualStatus, type ChannelShortsFeedVisibility, type MembersOnlyVisibility, type PlaylistInfo, type Tag, type Video } from "../api";
import { resolvePlaybackSpeeds } from "../../../shared/playbackSpeeds";
import TagChip from "../components/TagChip";
import TagCreateForm from "../components/TagCreateForm";
import TagPickerMenu from "../components/TagPickerMenu";
import Tooltip from "../components/Tooltip";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { img } from "../img";
import { emit } from "../events";
import { formatAddedVideos, formatPlaylistVideoCount, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { SUBTITLE_LANGUAGES, subtitleLanguageLabel } from "../subtitleLanguages";
import { Badge, Button, ButtonAnchor, EmptyState, Input, MenuItem, Popover, SectionHeader, SplitButton, Tabs } from "../components/ui";
import { formatAppDate, parseAppTimestamp } from "../dateTime";
import ChannelRefreshScheduleDialog from "../components/ChannelRefreshScheduleDialog";
import { markYouTubeUrl } from "../youtubeUrl";
import { isChannelSyncRateLimitMessage } from "../channelSync";
import { useChannelSyncActivity } from "../useChannelSyncActivity";
import ChannelPosts from "../components/ChannelPosts";
import NotificationSourceMenu from "../components/NotificationSourceMenu";
import type { NotificationSourceMode } from "../components/NotificationSourceSelect";
import { HeaderSettingsHeader, HeaderSettingsItem, HeaderSettingsOption, HeaderSettingsPopover, HeaderSettingsScroll, HeaderSettingsSectionLabel, HeaderSettingsSeparator } from "../components/HeaderSettingsMenu";

type Tab = "videos" | "shorts" | "playlists" | "posts" | "processing";
// Matches the server's default /feed page size.
const CHANNEL_PAGE_SIZE = 40;

export default function ChannelPage({ onPlay, shortsEnabled }: { onPlay: (v: Video) => void; shortsEnabled: boolean }) {
  const { t, language, locale, timeZone } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = (searchParams.get("tab") as Tab) ?? "videos"; const tab = !shortsEnabled && requestedTab === "shorts" ? "videos" : requestedTab;
  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });
  const [about, setAbout] = useState<ChannelAbout | null>(null);
  const [loadedBanner, setLoadedBanner] = useState<string | null>(null);
  useDocumentTitle(about?.title);
  const [videos, setVideos] = useState<Video[]>([]);
  const [processingVideos, setProcessingVideos] = useState<Video[]>([]);
  const [liveStreams, setLiveStreams] = useState<Video[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [processingLoading, setProcessingLoading] = useState(true);
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [postsEnabled, setPostsEnabled] = useState(false);
  const [unfollowPending, setUnfollowPending] = useState(false);
  const [channelSpeed, setChannelSpeed] = useState("");
  const [playerSpeedOptions, setPlayerSpeedOptions] = useState("[]");
  const [captionMode, setCaptionMode] = useState<"off" | "language" | null>(null);
  const [captionLanguage, setCaptionLanguage] = useState<string | null>(null);
  const [membersOnlyVisibility, setMembersOnlyVisibility] = useState<MembersOnlyVisibility>("default");
  const [shortsFeedVisibility, setShortsFeedVisibility] = useState<ChannelShortsFeedVisibility>("default");
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [refreshScheduleOpen, setRefreshScheduleOpen] = useState(false);
  const [startedSyncJobId, setStartedSyncJobId] = useState<string | null>(null);
  const [technicalView, setTechnicalView] = useState<"root" | "speed" | "captions" | "members" | "shorts" | "notifications">("root");
  const [notificationMode, setNotificationMode] = useState<NotificationSourceMode>("default");
  const [notificationPending, setNotificationPending] = useState(false);
  useEffect(() => { if (!shortsEnabled && technicalView === "shorts") setTechnicalView("root"); }, [shortsEnabled, technicalView]);
  const [channelTags, setChannelTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [postsRefreshing, setPostsRefreshing] = useState(false);
  const [postsRefreshRevision, setPostsRefreshRevision] = useState(0);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [manualStatus, setManualStatus] = useState<ChannelManualStatus>("active");
  const [channelSearch, setChannelSearch] = useState("");
  const [searchVideos, setSearchVideos] = useState<Video[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3ea6ff");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [processingPage, setProcessingPage] = useState(0);
  const [processingHasMore, setProcessingHasMore] = useState(true);
  const [processingLoadingMore, setProcessingLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const prevIdRef = useRef<string | undefined>(undefined);
  const completedSyncJobsRef = useRef(new Set<string>());
  const { job: backgroundSyncJob } = useChannelSyncActivity();
  const backgroundChannelSyncActive = backgroundSyncJob?.status === "running"
    && backgroundSyncJob.channels.some((channel) => channel.channelId === id && (channel.status === "pending" || channel.status === "running"));
  const startedChannelSyncActive = Boolean(startedSyncJobId && !completedSyncJobsRef.current.has(startedSyncJobId));
  const channelSyncActive = syncing || startedChannelSyncActive || backgroundChannelSyncActive;

  useEffect(() => {
    if (!id) return;
    setAbout(null);
    setLoadedBanner(null);
    setVideos([]);
    setProcessingVideos([]);
    setLiveStreams([]);
    setVideosLoading(true);
    setPage(0);
    setHasMore(true);
    setProcessingPage(0);
    setProcessingHasMore(true);
    setProcessingLoading(true);
    setPlaylists(null);
    setChannelSearch("");
    setSearchVideos([]);
    setChannelTags([]);
    setManualStatus("active");
    // Reset to the default tab only when switching channels — preserve an
    // incoming ?tab= (e.g. tab=playlists) on first load / deep links.
    if (prevIdRef.current && prevIdRef.current !== id) {
      setSearchParams({ tab: "videos" }, { replace: true });
    }
    prevIdRef.current = id;
    setFollowed(false);
    setPostsEnabled(false);
    setChannelSpeed("");
    setCaptionMode(null);
    setCaptionLanguage(null);
    setMembersOnlyVisibility("default");
    setShortsFeedVisibility("default");
    setNotificationMode("default");
    setStartedSyncJobId(null);
    window.scrollTo(0, 0);
    api.channelAbout(id).then((about) => { setAbout(about); emit("channels-changed"); }).catch(console.error);
    api.channel(id).then((r) => {
      setChannelTags(r.channel.tags);
      setManualStatus(r.channel.manual_status ?? "active");
      setFollowed(r.channel.followed !== 0);
      const enabled = r.channel.posts_enabled === true;
      setPostsEnabled(enabled);
      if (!enabled && tab === "posts") setTab("videos");
      setChannelSpeed(r.channel.playback_speed ?? "");
      setCaptionMode(r.channel.caption_mode ?? null);
      setCaptionLanguage(r.channel.caption_language ?? null);
      setMembersOnlyVisibility(r.channel.members_only_visibility ?? "default");
      setShortsFeedVisibility(r.channel.shorts_feed_visibility ?? "default");
    }).catch(console.error);
    api.settings().then((result) => setPlayerSpeedOptions(result.settings.player_speed_options)).catch(() => setPlayerSpeedOptions("[]"));
    api
      .feed({ channel: id, status: "all", shorts: true, page: 0 })
      .then((r) => { setVideos(r.videos); setHasMore(r.videos.length === CHANNEL_PAGE_SIZE); })
      .catch(console.error)
      .finally(() => setVideosLoading(false));
    api
      .feed({ channel: id, status: "all", shorts: true, processing: true, page: 0 })
      .then((r) => { setProcessingVideos(r.videos); setProcessingHasMore(r.videos.length === CHANNEL_PAGE_SIZE); })
      .catch(console.error)
      .finally(() => setProcessingLoading(false));
    api.channelLive(id).then((r) => setLiveStreams(r.videos)).catch(console.error);
    api.channelPlaylists(id).then((r) => setPlaylists(r.playlists)).catch(() => setPlaylists([]));
    api.notificationPreferences().then((preferences) => {
      const value = preferences.channels.find((source) => source.channel_id === id)?.notification_enabled;
      setNotificationMode(value == null ? "default" : value === 1 ? "on" : "off");
    }).catch(console.error);
    setTagsLoading(true);
    api.tags().then((r) => setAllTags(r.tags)).catch(console.error).finally(() => setTagsLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id || !channelSearch.trim()) {
      setSearchVideos([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      api.feed({ channel: id, status: "all", shorts: true, q: channelSearch.trim(), limit: 100 })
        .then((result) => { if (!cancelled) setSearchVideos(result.videos); })
        .catch((error) => { if (!cancelled) { setSearchVideos([]); console.error(error); } })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [id, channelSearch]);

  // Append subsequent pages as the user scrolls. Page 0 is handled by the
  // [id] effect above; channel id is read from the closure (always current
  // because page resets to 0 on channel change).
  useEffect(() => {
    if (!id || page === 0) return;
    setLoadingMore(true);
    api
      .feed({ channel: id, status: "all", shorts: true, page })
      .then((r) => {
        setVideos((prev) => [...prev, ...r.videos]);
        setHasMore(r.videos.length === CHANNEL_PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  }, [page]);

  useEffect(() => {
    if (!id || processingPage === 0) return;
    setProcessingLoadingMore(true);
    api
      .feed({ channel: id, status: "all", shorts: true, processing: true, page: processingPage })
      .then((r) => {
        setProcessingVideos((prev) => [...prev, ...r.videos]);
        setProcessingHasMore(r.videos.length === CHANNEL_PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => setProcessingLoadingMore(false));
  }, [processingPage]);

  // Infinite scroll: bump the page when the sentinel enters the viewport.
  useEffect(() => {
    const el = loadMoreRef.current;
    const isProcessing = tab === "processing";
    const canLoad = isProcessing
      ? processingHasMore && !processingLoading && !processingLoadingMore
      : hasMore && !videosLoading && !loadingMore;
    if (!el || !canLoad) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        if (isProcessing) setProcessingPage((p) => p + 1);
        else setPage((p) => p + 1);
      },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [tab, hasMore, videosLoading, loadingMore, videos.length, processingHasMore, processingLoading, processingLoadingMore, processingVideos.length]);

  useEffect(() => {
    if (!technicalOpen) setTechnicalView("root");
  }, [technicalOpen]);

  // Set (or clear, with null) this channel's playback-speed override.
  const changeSpeed = (v: string | null) => {
    setChannelSpeed(v ?? "");
    if (id) api.setChannelSpeed(id, v).catch(console.error);
  };

  const captionsLabel = captionMode === "off"
    ? t("captionsOff")
    : captionMode === "language" && captionLanguage
      ? subtitleLanguageLabel(captionLanguage)
      : t("channelSettingDefault");
  const playbackSpeeds = resolvePlaybackSpeeds(playerSpeedOptions, channelSpeed);

  const membersOnlyFeedLabel = {
    default: t("channelSettingDefault"),
    everywhere: t("channelMembersOnlyEverywhere"),
    channel: t("channelMembersOnlyChannelOnly"),
    hidden: t("channelMembersOnlyNowhere"),
  }[membersOnlyVisibility];

  const changeMembersOnlyVisibility = (visibility: MembersOnlyVisibility) => {
    if (!id) return;
    const previous = membersOnlyVisibility;
    setMembersOnlyVisibility(visibility);
    api.setChannelMembersOnlyVisibility(id, visibility)
      .then(reload)
      .catch((error) => {
        setMembersOnlyVisibility(previous);
        console.error(error);
      });
  };

  const changeNotificationMode = async (next: NotificationSourceMode) => {
    if (!id || !followed || notificationPending) return;
    const previous = notificationMode;
    setNotificationMode(next);
    setNotificationPending(true);
    try {
      await api.updateNotificationSource("channel", id, next === "default" ? null : next === "on");
    } catch (error) {
      setNotificationMode(previous);
      console.error(error);
    } finally { setNotificationPending(false); }
  };

  const shortsFeedLabel = shortsFeedVisibility === "show"
    ? t("channelShortsFeedShow")
    : t("channelSettingDefault");

  const changeShortsFeedVisibility = (visibility: ChannelShortsFeedVisibility) => {
    if (!id) return;
    const previous = shortsFeedVisibility;
    setShortsFeedVisibility(visibility);
    api.setChannelShortsFeedVisibility(id, visibility)
      .catch((error) => {
        setShortsFeedVisibility(previous);
        console.error(error);
      });
  };

  const changeCaptions = (mode: "off" | "language" | null, language?: string) => {
    if (!id) return;
    const previousMode = captionMode;
    const previousLanguage = captionLanguage;
    setCaptionMode(mode);
    setCaptionLanguage(mode === "language" ? language ?? null : null);
    api.setChannelCaptions(id, mode, language).catch((error) => {
      setCaptionMode(previousMode);
      setCaptionLanguage(previousLanguage);
      console.error(error);
    });
  };

  const reload = () => {
    if (!id) return;
    setHasMore(true);
    setPage(0);
    setProcessingHasMore(true);
    setProcessingPage(0);
    api
      .feed({ channel: id, status: "all", shorts: true, page: 0 })
      .then((r) => { setVideos(r.videos); setHasMore(r.videos.length === CHANNEL_PAGE_SIZE); })
      .catch(console.error);
    api
      .feed({ channel: id, status: "all", shorts: true, processing: true, page: 0 })
      .then((r) => { setProcessingVideos(r.videos); setProcessingHasMore(r.videos.length === CHANNEL_PAGE_SIZE); })
      .catch(console.error);
  };

  // Refresh the about payload (and with it the real video/short counts).
  const loadAbout = () => {
    if (!id) return;
    api.channelAbout(id).then((about) => { setAbout(about); emit("channels-changed"); }).catch(console.error);
  };

  useEffect(() => {
    if (!id || !backgroundSyncJob || backgroundSyncJob.id !== startedSyncJobId || backgroundSyncJob.status === "running" || completedSyncJobsRef.current.has(backgroundSyncJob.id)) return;
    const item = backgroundSyncJob.channels.find((channel) => channel.channelId === id);
    if (!item) return;
    completedSyncJobsRef.current.add(backgroundSyncJob.id);
    setSyncMsg(item.status === "completed"
      ? item.added > 0 ? formatAddedVideos(item.added, language) : t("noNewVideos")
      : isChannelSyncRateLimitMessage(item.error) ? t("channelSyncRateLimitError") : t("syncError"));
    loadAbout();
    api.channelLive(id).then((live) => setLiveStreams(live.videos)).catch(console.error);
    if (item.added > 0) reload();
    const timer = window.setTimeout(() => setSyncMsg(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [backgroundSyncJob?.id, backgroundSyncJob?.status, id, startedSyncJobId]);

  const openPlaylist = (playlistId: string) => navigate(`/playlist/${playlistId}`);

  const toggleTag = async (tag: Tag) => {
    if (!id) return;
    const exists = channelTags.some((t) => t.id === tag.id);
    if (exists) {
      await api.untagChannel(id, tag.id);
      setChannelTags((prev) => prev.filter((t) => t.id !== tag.id));
      return;
    }
    await api.tagChannel(id, tag.id);
    setChannelTags((prev) => [...prev, tag]);
  };

  const createAndAddTag = async () => {
    if (!id || !newTagName.trim()) return;
    const r = await api.addTag(newTagName.trim(), newTagColor);
    setAllTags((prev) => [...prev, r.tag]);
    await api.tagChannel(id, r.tag.id);
    setChannelTags((prev) => [...prev, r.tag]);
    emit("tags-changed");
    setNewTagName("");
    setTagMenuOpen(false);
  };

  const removeTag = async (tag: Tag) => {
    if (!id) return;
    await api.untagChannel(id, tag.id);
    setChannelTags((prev) => prev.filter((t) => t.id !== tag.id));
  };

  const handleSync = async () => {
    if (!id || syncing || manualStatus !== "active") return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await api.syncChannel(id);
      setStartedSyncJobId(result.job.id);
      setSyncMsg(t("channelSyncStarted"));
    } catch (error) {
      setSyncMsg(t("syncError"));
      console.error(error);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  };

  const handlePlaylistCatalogSync = async () => {
    if (!id || syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await api.syncChannelPlaylists(id);
      setPlaylists(result.playlists);
      setSyncMsg(result.added > 0 ? formatAddedVideos(result.added, language) : t("playlistsSynced", { count: result.synced }));
    } catch { setSyncMsg(t("syncError")); }
    finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  };

  const handleMetadataSync = async () => {
    if (!id || syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await api.syncChannelMetadata(id);
      setSyncMsg(result.updated > 0 ? t("metadataSynced", { count: result.updated }) : t("metadataComplete"));
      reload();
      loadAbout();
    } catch { setSyncMsg(t("syncError")); }
    finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  };

  const handlePostsRefresh = async () => {
    if (!id || postsRefreshing || !postsEnabled) return;
    setPostsRefreshing(true);
    setSyncMsg(null);
    try {
      await api.channelPosts(id, true);
      setPostsRefreshRevision((revision) => revision + 1);
      setSyncMsg(t("channelPostsRefreshed"));
    } catch { setSyncMsg(t("syncError")); }
    finally {
      setPostsRefreshing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  };

  const toggleFollow = async () => {
    if (!id) return;
    setUnfollowPending(true);
    try {
      const next = !followed;
      await api.followChannel(id, next);
      setFollowed(next);
      emit("channels-changed");
    } finally {
      setUnfollowPending(false);
    }
  };

  const regularVideos = videos.filter((v) => v.is_short !== 1);
  const shorts = videos.filter((v) => v.is_short === 1);
  // Prefer the server's real counts; fall back to what's loaded until they arrive.
  const videoCount = about?.counts?.videos ?? regularVideos.length;
  const shortCount = about?.counts?.shorts ?? shorts.length;
  const processingCount = about?.counts?.processing ?? processingVideos.length;
  const searchActive = channelSearch.trim().length > 0;
  const normalizedSearch = channelSearch.trim().toLocaleLowerCase(locale);
  const matchingPlaylists = (playlists ?? []).filter((playlist) =>
    playlist.title.toLocaleLowerCase(locale).includes(normalizedSearch)
  );
  const manualStatusLabel = manualStatus === "paused" ? t("channelStatusPaused")
    : manualStatus === "broken" ? t("channelStatusBroken")
    : manualStatus === "banned" ? t("channelStatusBanned")
    : manualStatus === "deleted" ? t("channelStatusDeleted")
    : t("channelStatusActive");

  return (
    <>
      <div className="channel-banner" aria-hidden="true">
        {about?.banner && (
          <img
            className={loadedBanner === about.banner ? "channel-banner__image is-loaded" : "channel-banner__image"}
            src={img(about.banner)}
            alt=""
            onLoad={() => setLoadedBanner(about.banner)}
          />
        )}
      </div>
      <div className="channel-header">
        {about?.avatar && <img className="channel-avatar" src={img(about.avatar)} alt="" />}
        <div className="channel-info">
          <div className="channel-title-line"><h1 className="channel-title">{about?.title ?? "…"}</h1>{manualStatus !== "active" && <Badge variant="warning">{manualStatusLabel}</Badge>}</div>
          {manualStatus !== "active" && <div className="channel-status-note">{t("channelStatusSyncDisabled")}</div>}
          {about && (about.subscriberCount || about.stats.length > 0) && (
            <div className="channel-stats">
              {about.subscriberCount && <span>{about.subscriberCount} {t("subscribers")}</span>}
              {about.stats.map((s, i) =>
                s.startsWith("@")
                  ? <span key={i}>{s}</span>
                  : <span key={i}>{s} {t("videosSuffix")}</span>
              )}
            </div>
          )}
          {about?.description && (
            <div
              className={`channel-desc${descOpen ? "" : " clamped"}`}
              onClick={() => setDescOpen((o) => !o)}
              title={descOpen ? t("collapse") : t("expand")}
            >
              {about.description}
            </div>
          )}
          {about && (about.links.length > 0 || about.joinedDate || about.viewCount) && (
            <div className="channel-about-extra">
              {about.links.length > 0 && (
                <div className="channel-links">
                  {about.links.map((l) => (
                    <Tooltip key={l.url} text={l.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} pos="bottom">
                      <a href={markYouTubeUrl(l.url)} target="_blank" rel="noreferrer" className="channel-link-item">
                        <span className="channel-link-title">{l.title}</span>
                      </a>
                    </Tooltip>
                  ))}
                </div>
              )}
              <div className="channel-meta-row">
                {about.joinedDate && (() => {
                  const d = parseAppTimestamp(about.joinedDate);
                  const formatted = isNaN(d.getTime())
                    ? about.joinedDate
                    : formatAppDate(d, locale, timeZone, { year: "numeric", month: "long", day: "numeric" });
                  return <span>{t("joined")} {formatted}</span>;
                })()}
                {about.viewCount && <span>{about.viewCount} {t("views")}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="channel-header-actions">
          <SplitButton
            onClick={() => void handleSync()}
            disabled={syncing || manualStatus !== "active"}
            title={manualStatus !== "active" ? t("channelStatusSyncDisabled") : t("syncTitle")}
            menuLabel={t("moreActions")}
            menu={<>
              <MenuItem icon={<ListRestart />} onClick={handlePlaylistCatalogSync} title={t("syncPlaylistCatalogHint")}>{t("syncPlaylistCatalog")}</MenuItem>
              <MenuItem icon={<FileClock />} onClick={handleMetadataSync} title={t("syncMetadataHint")}>{t("syncMetadata")}</MenuItem>
              {postsEnabled && <MenuItem icon={<RefreshCw className={postsRefreshing ? "channel-spin" : ""} />} onClick={() => void handlePostsRefresh()} disabled={postsRefreshing}>{t("refreshChannelPosts")}</MenuItem>}
            </>}
          >
            <RefreshCw size={15} className={channelSyncActive ? "channel-spin" : ""} />
            {channelSyncActive ? t("syncing") : syncMsg ?? t("syncChannel")}
          </SplitButton>
          <Button
            variant={followed ? "danger" : "primary"}
            onClick={toggleFollow}
            disabled={unfollowPending}
            title={followed ? t("unfollow") : t("followAgain")}
          >
            {followed ? <UserMinus size={15} /> : <UserPlus size={15} />}
            {followed ? t("unfollow") : t("follow")}
          </Button>
          <HeaderSettingsPopover
            open={technicalOpen}
            onOpenChange={setTechnicalOpen}
            label={t("channelTechnicalSettings")}
          >
                {technicalView === "root" && (
                  <>
                    <HeaderSettingsSectionLabel>{t("channelPlayback")}</HeaderSettingsSectionLabel>
                    <HeaderSettingsItem icon={<Gauge />} label={t("channelSpeed")} status={channelSpeed ? `${channelSpeed}×` : t("channelSettingDefault")} onClick={() => setTechnicalView("speed")} />
                    <HeaderSettingsItem icon={<Captions />} label={t("subtitles")} status={captionsLabel} onClick={() => setTechnicalView("captions")} />
                    <HeaderSettingsSeparator />
                    <HeaderSettingsSectionLabel>{t("channelFeed")}</HeaderSettingsSectionLabel>
                    <HeaderSettingsItem icon={<CalendarClock />} label={t("channelRefreshSchedule")} disabled={!followed} disabledReason={!followed ? t("channelFeedFollowRequiredHint") : undefined} onClick={() => { setTechnicalOpen(false); setRefreshScheduleOpen(true); }} />
                    <HeaderSettingsItem icon={<Star />} label={t("channelMembersOnlyFeed")} status={membersOnlyFeedLabel} disabled={!followed} disabledReason={!followed ? t("channelFeedFollowRequiredHint") : undefined} onClick={() => setTechnicalView("members")} />
                    {shortsEnabled && <HeaderSettingsItem icon={<Zap />} label={t("channelShortsFeed")} status={shortsFeedLabel} disabled={!followed} disabledReason={!followed ? t("channelFeedFollowRequiredHint") : undefined} onClick={() => setTechnicalView("shorts")} />}
                    <HeaderSettingsItem icon={<Bell />} label={t("notificationChannelUploads")} status={notificationMode === "default" ? t("notificationSourceDefaultOff") : notificationMode === "on" ? t("notificationSourceAlwaysOn") : t("notificationSourceAlwaysOff")} disabled={!followed} disabledReason={!followed ? t("channelFeedFollowRequiredHint") : undefined} onClick={() => setTechnicalView("notifications")} />
                  </>
                )}
                {technicalView === "speed" && (
                  <>
                    <HeaderSettingsHeader onBack={() => setTechnicalView("root")} backLabel={t("back")}>{t("channelSpeed")}</HeaderSettingsHeader>
                    <HeaderSettingsOption selected={!channelSpeed} onClick={() => changeSpeed(null)}>{t("channelSettingDefault")}</HeaderSettingsOption>
                    <HeaderSettingsSeparator spacer />
                    {playbackSpeeds.map((speed) => (
                      <HeaderSettingsOption key={speed} selected={channelSpeed === speed} onClick={() => changeSpeed(speed)}>{speed === "1" ? "1×" : `${speed}×`}</HeaderSettingsOption>
                    ))}
                  </>
                )}
                {technicalView === "captions" && (
                  <>
                    <HeaderSettingsHeader onBack={() => setTechnicalView("root")} backLabel={t("back")}>{t("subtitles")}</HeaderSettingsHeader>
                    <HeaderSettingsScroll>
                      <HeaderSettingsOption selected={captionMode == null} onClick={() => changeCaptions(null)}>{t("channelSettingDefault")}</HeaderSettingsOption>
                      <HeaderSettingsOption selected={captionMode === "off"} onClick={() => changeCaptions("off")}>{t("captionsOff")}</HeaderSettingsOption>
                      <HeaderSettingsSeparator />
                      {SUBTITLE_LANGUAGES.map((language) => (
                        <HeaderSettingsOption key={language.code} selected={captionMode === "language" && captionLanguage === language.code} onClick={() => changeCaptions("language", language.code)}>{language.label}</HeaderSettingsOption>
                      ))}
                    </HeaderSettingsScroll>
                  </>
                )}
                {technicalView === "members" && (
                  <>
                    <HeaderSettingsHeader onBack={() => setTechnicalView("root")} backLabel={t("back")}>{t("channelMembersOnlyFeed")}</HeaderSettingsHeader>
                    <HeaderSettingsOption selected={membersOnlyVisibility === "default"} onClick={() => changeMembersOnlyVisibility("default")}>{t("channelSettingDefault")}</HeaderSettingsOption>
                    <HeaderSettingsSeparator spacer />
                    <HeaderSettingsOption selected={membersOnlyVisibility === "everywhere"} onClick={() => changeMembersOnlyVisibility("everywhere")}>{t("channelMembersOnlyEverywhere")}</HeaderSettingsOption>
                    <HeaderSettingsOption selected={membersOnlyVisibility === "channel"} onClick={() => changeMembersOnlyVisibility("channel")}>{t("channelMembersOnlyChannelOnly")}</HeaderSettingsOption>
                    <HeaderSettingsOption selected={membersOnlyVisibility === "hidden"} onClick={() => changeMembersOnlyVisibility("hidden")}>{t("channelMembersOnlyNowhere")}</HeaderSettingsOption>
                  </>
                )}
                {shortsEnabled && technicalView === "shorts" && (
                  <>
                    <HeaderSettingsHeader onBack={() => setTechnicalView("root")} backLabel={t("back")}>{t("channelShortsFeed")}</HeaderSettingsHeader>
                    <HeaderSettingsOption selected={shortsFeedVisibility === "default"} onClick={() => changeShortsFeedVisibility("default")}>{t("channelSettingDefault")}</HeaderSettingsOption>
                    <HeaderSettingsOption selected={shortsFeedVisibility === "show"} onClick={() => changeShortsFeedVisibility("show")}>{t("channelShortsFeedShow")}</HeaderSettingsOption>
                  </>
                )}
                {technicalView === "notifications" && <NotificationSourceMenu
                  mode={notificationMode}
                  defaultEnabled={false}
                  title={t("notificationChannelUploads")}
                  disabled={notificationPending}
                  onBack={() => setTechnicalView("root")}
                  onChange={(mode) => void changeNotificationMode(mode)}
                />}
          </HeaderSettingsPopover>
          {id && <ChannelRefreshScheduleDialog channelId={id} open={refreshScheduleOpen} onOpenChange={setRefreshScheduleOpen} />}
          <ButtonAnchor href={markYouTubeUrl(`https://www.youtube.com/channel/${id}`)} target="_blank" rel="noreferrer" leadingIcon={<ExternalLink />}>YouTube</ButtonAnchor>
        </div>
      </div>

      {/* Channel tag management */}
      <div className="channel-tags-row">
        <Popover
          align="start"
          surface="menu"
          open={tagMenuOpen}
          onOpenChange={setTagMenuOpen}
          trigger={<Button variant="ghost" size="sm" title={t("addTag")}>
            <Plus size={13} /> {t("Tag")}
          </Button>}
          className="tag-picker-popover"
        >
          <TagPickerMenu tags={allTags} loading={tagsLoading} selectedTagIds={channelTags.map((tag) => tag.id)} onToggle={toggleTag}>
            <TagCreateForm title={t("newTag")} name={newTagName} color={newTagColor} placeholder={t("tagNamePlaceholder")} submitLabel={t("addTag")} onNameChange={setNewTagName} onColorChange={setNewTagColor} onSubmit={createAndAddTag} />
          </TagPickerMenu>
        </Popover>
        {channelTags.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => removeTag(t)} />
        ))}
      </div>

      {liveStreams.length > 0 && (
        <section className="channel-live-section">
          <SectionHeader title={t("liveBadge")} icon={<Radio />} variant="uppercase" className="channel-live-title" />
          <div className="video-grid">
            {liveStreams.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={reload} showChannelAvatar={false} />
            ))}
          </div>
        </section>
      )}

      <div className="channel-tabs-row">
        <Tabs
          className="channel-tabs"
          label={about?.title ?? t("videos")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "videos", label: t("videos"), icon: <VideoIcon />, count: videoCount },
            ...(shortsEnabled && shortCount > 0 ? [{ value: "shorts" as const, label: "Shorts", icon: <Zap />, count: shortCount }] : []),
            { value: "playlists", label: t("playlists"), icon: <ListVideo />, count: playlists?.length },
            ...(postsEnabled ? [{ value: "posts" as const, label: t("channelPosts"), icon: <MessageSquareText /> }] : []),
            ...(processingCount > 0 ? [{ value: "processing" as const, label: t("processing"), icon: <FileClock />, count: processingCount }] : []),
          ]}
        />
        {tab !== "posts" && <div className="channel-content-search">
          <Search className="channel-content-search__icon" aria-hidden="true" />
          <Input
            className="channel-content-search__input"
            value={channelSearch}
            onChange={(event) => setChannelSearch(event.target.value)}
            placeholder={t("searchChannelContent")}
            aria-label={t("searchChannelContent")}
          />
          {channelSearch && <button className="channel-content-search__clear" type="button" onClick={() => setChannelSearch("")} aria-label={t("clearSearch")}><X /></button>}
        </div>}
      </div>

      {searchActive && (
        searchLoading ? <VideoGridSkeleton /> : matchingPlaylists.length === 0 && searchVideos.length === 0 ?
          <EmptyState title={t("channelSearchEmpty")} /> :
          <div className="channel-content-search-results">
            {matchingPlaylists.length > 0 && <section>
              <SectionHeader title={t("playlists")} icon={<ListVideo />} />
              <div className="video-grid video-grid--sm">{matchingPlaylists.map((playlist) => <button key={playlist.playlistId} type="button" className="video-card playlist-card" onClick={() => openPlaylist(playlist.playlistId)}>
                <div className="thumb-wrap">{playlist.thumbnail ? <img className="thumb" src={img(playlist.thumbnail)} alt="" loading="lazy" /> : <div className="thumb" />}{playlist.videoCount && <span className="playlist-count">{formatPlaylistVideoCount(playlist.videoCount, language)}</span>}</div>
                <div className="card-body" style={{ flexDirection: "column", gap: 3 }}><div className="v-title">{playlist.title}</div></div>
              </button>)}</div>
            </section>}
            {searchVideos.length > 0 && <section>
              <SectionHeader title={t("videos")} icon={<VideoIcon />} />
              <div className="video-grid">{searchVideos.map((video) => <VideoCard key={video.video_id} video={video} onPlay={onPlay} onChanged={reload} showChannelAvatar={false} />)}</div>
            </section>}
          </div>
      )}

      {!searchActive && tab === "videos" &&
        (videosLoading ? (
          <VideoGridSkeleton />
        ) : regularVideos.length === 0 ? (
          <EmptyState title={t("channelVideosEmpty")} description={manualStatus !== "active" ? t("channelStatusSyncDisabled") : t("channelVideosEmptyHint")} action={manualStatus === "active" && <Button variant="primary" onClick={() => void handleSync()} disabled={syncing}>
              <RefreshCw size={15} className={channelSyncActive ? "channel-spin" : undefined} />
              {channelSyncActive ? t("syncing") : t("syncChannelVideos")}
            </Button>} />
        ) : (
          <div className="video-grid">
            {regularVideos.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={reload} showChannelAvatar={false} />
            ))}
          </div>
        ))}

      {shortsEnabled && !searchActive && tab === "shorts" && (
        videosLoading ? (
          <VideoGridSkeleton />
        ) : (
          <div className="video-grid">
            {shorts.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={reload} showChannelAvatar={false} />
            ))}
          </div>
        )
      )}

      {!searchActive && tab === "processing" && (
        processingLoading ? (
          <VideoGridSkeleton />
        ) : processingVideos.length === 0 ? (
          <EmptyState title={t("processingEmpty")} description={t("processingEmptyHint")} />
        ) : (
          <div className="video-grid">
            {processingVideos.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={reload} showChannelAvatar={false} />
            ))}
          </div>
        )
      )}

      {!searchActive && tab === "playlists" &&
        (playlists === null ? (
          <VideoGridSkeleton />
        ) : playlists.length === 0 ? (
          <EmptyState title={t("publicPlaylistsEmpty")} />
        ) : (
          <div className="video-grid">
            {playlists.map((p) => (
              <button
                key={p.playlistId}
                type="button"
                className="video-card playlist-card"
                onClick={() => openPlaylist(p.playlistId)}
              >
                <div className="thumb-wrap">
                  {p.thumbnail ? (
                    <img className="thumb" src={img(p.thumbnail)} alt="" loading="lazy" />
                  ) : (
                    <div className="thumb" />
                  )}
                  {p.videoCount && (
                    <span className="playlist-count">{formatPlaylistVideoCount(p.videoCount, language)}</span>
                  )}
                </div>
                <div className="card-body" style={{ flexDirection: "column", gap: 3 }}>
                  <div className="v-title">{p.title}</div>
                </div>
              </button>
            ))}
          </div>
        ))}

      {!searchActive && tab === "posts" && postsEnabled && id && <ChannelPosts channelId={id} channelName={about?.title ?? ""} channelAvatar={about?.avatar ?? ""} onPlay={onPlay} refreshRevision={postsRefreshRevision} />}

      {!searchActive && (tab === "videos" || tab === "shorts" || tab === "processing") && (tab === "processing" ? !processingLoading : !videosLoading) && (
        <>
          {(tab === "processing" ? processingLoadingMore : loadingMore) && <VideoGridSkeleton count={4} />}
          {(tab === "processing" ? processingHasMore : hasMore) && <div ref={loadMoreRef} style={{ height: 1 }} />}
        </>
      )}
    </>
  );
}
