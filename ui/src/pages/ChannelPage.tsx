import { useEffect, useRef, useState } from "react";
import "./ChannelPage.css";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Captions, Check, ChevronLeft, ChevronRight, Download, ExternalLink, FileClock, Gauge, ListRestart, ListVideo, Plus, Radio, RefreshCw, Search, SlidersHorizontal, Star, UserMinus, UserPlus, Video as VideoIcon, X, Zap } from "lucide-react";
import { api, type ChannelAbout, type MembersOnlyVisibility, type PlaylistInfo, type Tag, type Video, PLAYBACK_SPEEDS } from "../api";
import TagChip from "../components/TagChip";
import TagCreateForm from "../components/TagCreateForm";
import TagPickerMenu from "../components/TagPickerMenu";
import Tooltip from "../components/Tooltip";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { img } from "../img";
import { emit } from "../events";
import { formatAddedVideos, formatPlaylistVideoCount, useI18n } from "../i18n";
import { SUBTITLE_LANGUAGES, subtitleLanguageLabel } from "../subtitleLanguages";
import { Button, ButtonAnchor, EmptyState, IconButton, Input, Menu, MenuHeader, MenuItem, MenuLabel, MenuSeparator, MenuStatus, Popover, ScrollArea, SectionHeader, SplitButton, Tabs } from "../components/ui";

type Tab = "videos" | "shorts" | "playlists" | "processing";

// Matches the server's default /feed page size.
const CHANNEL_PAGE_SIZE = 40;
const AUTO_DOWNLOAD_MIN_DURATIONS = [0, 60, 5 * 60, 10 * 60, 20 * 60, 30 * 60, 45 * 60, 60 * 60];

export default function ChannelPage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t, language, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) ?? "videos";
  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });
  const [about, setAbout] = useState<ChannelAbout | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [processingVideos, setProcessingVideos] = useState<Video[]>([]);
  const [liveStreams, setLiveStreams] = useState<Video[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [processingLoading, setProcessingLoading] = useState(true);
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [unfollowPending, setUnfollowPending] = useState(false);
  const [channelSpeed, setChannelSpeed] = useState("");
  const [autoDownloadMinDuration, setAutoDownloadMinDuration] = useState<number | null>(null);
  const [downloadsEnabled, setDownloadsEnabled] = useState(false);
  const [captionMode, setCaptionMode] = useState<"off" | "language" | null>(null);
  const [captionLanguage, setCaptionLanguage] = useState<string | null>(null);
  const [membersOnlyVisibility, setMembersOnlyVisibility] = useState<MembersOnlyVisibility>("default");
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [technicalView, setTechnicalView] = useState<"root" | "speed" | "captions" | "downloads" | "members">("root");
  const [channelTags, setChannelTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
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

  useEffect(() => {
    if (!id) return;
    setAbout(null);
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
    // Reset to the default tab only when switching channels — preserve an
    // incoming ?tab= (e.g. tab=playlists) on first load / deep links.
    if (prevIdRef.current && prevIdRef.current !== id) {
      setSearchParams({ tab: "videos" }, { replace: true });
    }
    prevIdRef.current = id;
    setFollowed(false);
    setChannelSpeed("");
    setAutoDownloadMinDuration(null);
    setCaptionMode(null);
    setCaptionLanguage(null);
    setMembersOnlyVisibility("default");
    window.scrollTo(0, 0);
    api.channelAbout(id).then((about) => { setAbout(about); emit("channels-changed"); }).catch(console.error);
    api.channel(id).then((r) => {
      setChannelTags(r.channel.tags);
      setFollowed(r.channel.followed !== 0);
      setChannelSpeed(r.channel.playback_speed ?? "");
      setAutoDownloadMinDuration(r.channel.auto_download_min_duration_override ?? null);
      setCaptionMode(r.channel.caption_mode ?? null);
      setCaptionLanguage(r.channel.caption_language ?? null);
      setMembersOnlyVisibility(r.channel.members_only_visibility ?? "default");
    }).catch(console.error);
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
    setTagsLoading(true);
    api.tags().then((r) => setAllTags(r.tags)).catch(console.error).finally(() => setTagsLoading(false));
    api.plugins().then((r) => setDownloadsEnabled(r.plugins.some((plugin) => plugin.id === "downloads" && plugin.enabled))).catch(console.error);
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

  const changeAutoDownloadMinDuration = (seconds: number | null) => {
    if (!id) return;
    const previous = autoDownloadMinDuration;
    setAutoDownloadMinDuration(seconds);
    api.setChannelDownloadMinDuration(id, seconds).catch((error) => {
      setAutoDownloadMinDuration(previous);
      console.error(error);
    });
  };

  const autoDownloadLabel = autoDownloadMinDuration == null
    ? t("channelSettingDefault")
    : autoDownloadMinDuration > 0
    ? `≥ ${autoDownloadMinDuration / 60} min`
    : t("autoDownloadOff");

  const captionsLabel = captionMode === "off"
    ? t("captionsOff")
    : captionMode === "language" && captionLanguage
      ? subtitleLanguageLabel(captionLanguage)
      : t("channelSettingDefault");

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
    if (!id || syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.syncChannel(id);
      setSyncMsg(r.added > 0 ? formatAddedVideos(r.added, language) : t("noNewVideos"));
      loadAbout();
      api.channelLive(id).then((live) => setLiveStreams(live.videos)).catch(console.error);
      if (r.added > 0) {
        reload();
      }
    } catch {
      setSyncMsg(t("syncError"));
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

  return (
    <>
      {about?.banner && <img className="channel-banner" src={img(about.banner)} alt="" />}
      <div className="channel-header">
        {about?.avatar && <img className="channel-avatar" src={img(about.avatar)} alt="" />}
        <div className="channel-info">
          <h1 className="channel-title">{about?.title ?? "…"}</h1>
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
                      <a href={l.url} target="_blank" rel="noreferrer" className="channel-link-item">
                        <span className="channel-link-title">{l.title}</span>
                      </a>
                    </Tooltip>
                  ))}
                </div>
              )}
              <div className="channel-meta-row">
                {about.joinedDate && (() => {
                  const d = new Date(about.joinedDate);
                  const formatted = isNaN(d.getTime())
                    ? about.joinedDate
                    : d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
                  return <span>{t("joined")} {formatted}</span>;
                })()}
                {about.viewCount && <span>{about.viewCount} {t("views")}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="channel-header-actions">
          <SplitButton
            onClick={handleSync}
            disabled={syncing}
            title={t("syncTitle")}
            menuLabel={t("moreActions")}
            menu={<>
              <MenuItem icon={<ListRestart />} onClick={handlePlaylistCatalogSync} title={t("syncPlaylistCatalogHint")}>{t("syncPlaylistCatalog")}</MenuItem>
              <MenuItem icon={<FileClock />} onClick={handleMetadataSync} title={t("syncMetadataHint")}>{t("syncMetadata")}</MenuItem>
            </>}
          >
            <RefreshCw size={15} className={syncing ? "channel-spin" : ""} />
            {syncing ? t("syncing") : syncMsg ?? t("syncChannel")}
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
          <Popover
            align="end"
            surface="menu"
            open={technicalOpen}
            onOpenChange={setTechnicalOpen}
            className="channel-technical-popover"
            trigger={<IconButton variant={technicalOpen ? "secondary" : "default"} label={t("channelTechnicalSettings")}><SlidersHorizontal size={16} /></IconButton>}
          >
              <Menu className="channel-technical-menu">
                {technicalView === "root" && (
                  <>
                    <div className="more-menu-section-label">{t("channelPlayback")}</div>
                    <button className="channel-technical-item" onClick={() => setTechnicalView("speed")}>
                      <Gauge /> <span>{t("channelSpeed")}</span><MenuStatus>{channelSpeed ? `${channelSpeed}×` : t("channelSettingDefault")}</MenuStatus><ChevronRight />
                    </button>
                    <button className="channel-technical-item" onClick={() => setTechnicalView("captions")}>
                      <Captions /> <span>{t("subtitles")}</span><MenuStatus>{captionsLabel}</MenuStatus><ChevronRight />
                    </button>
                    <MenuSeparator />
                    <div className="more-menu-section-label">{t("channelFeed")}</div>
                    <button className="channel-technical-item" onClick={() => setTechnicalView("members")}>
                      <Star /> <span>{t("channelMembersOnlyFeed")}</span><MenuStatus>{membersOnlyFeedLabel}</MenuStatus><ChevronRight />
                    </button>
                    {downloadsEnabled && <>
                      <MenuSeparator />
                      <div className="more-menu-section-label">{t("channelDownloads")}</div>
                      <button className="channel-technical-item" onClick={() => setTechnicalView("downloads")}>
                        <Download /> <span>{t("autoDownloadMinimum")}</span><MenuStatus>{autoDownloadLabel}</MenuStatus><ChevronRight />
                      </button>
                    </>}
                  </>
                )}
                {technicalView === "speed" && (
                  <>
                    <div className="more-menu-header"><button className="more-menu-back" onClick={() => setTechnicalView("root")}><ChevronLeft /></button>{t("channelSpeed")}</div>
                    <button className={!channelSpeed ? "is-selected" : undefined} onClick={() => changeSpeed(null)}>
                      {t("channelSettingDefault")}
                      {!channelSpeed && <MenuStatus><Check size={14} /></MenuStatus>}
                    </button>
                    <MenuSeparator className="channel-technical-spacer" />
                    {PLAYBACK_SPEEDS.map((speed) => (
                      <button key={speed} className={channelSpeed === speed ? "is-selected" : undefined} onClick={() => changeSpeed(speed)}>
                        {speed === "1" ? "1×" : `${speed}×`}
                        {channelSpeed === speed && <MenuStatus><Check size={14} /></MenuStatus>}
                      </button>
                    ))}
                  </>
                )}
                {technicalView === "captions" && (
                  <>
                    <div className="more-menu-header"><button className="more-menu-back" onClick={() => setTechnicalView("root")}><ChevronLeft /></button>{t("subtitles")}</div>
                    <ScrollArea viewportClassName="channel-technical-scroll">
                      <button className={captionMode == null ? "is-selected" : undefined} onClick={() => changeCaptions(null)}>
                        {t("channelSettingDefault")}
                        {captionMode == null && <MenuStatus><Check size={14} /></MenuStatus>}
                      </button>
                      <button className={captionMode === "off" ? "is-selected" : undefined} onClick={() => changeCaptions("off")}>
                        {t("captionsOff")}
                        {captionMode === "off" && <MenuStatus><Check size={14} /></MenuStatus>}
                      </button>
                      <MenuSeparator />
                      {SUBTITLE_LANGUAGES.map((language) => (
                        <button key={language.code} className={captionMode === "language" && captionLanguage === language.code ? "is-selected" : undefined} onClick={() => changeCaptions("language", language.code)}>
                          {language.label}
                          {captionMode === "language" && captionLanguage === language.code && <MenuStatus><Check size={14} /></MenuStatus>}
                        </button>
                      ))}
                    </ScrollArea>
                  </>
                )}
                {technicalView === "members" && (
                  <>
                    <div className="more-menu-header"><button className="more-menu-back" onClick={() => setTechnicalView("root")}><ChevronLeft /></button>{t("channelMembersOnlyFeed")}</div>
                    <button className={membersOnlyVisibility === "default" ? "is-selected" : undefined} onClick={() => changeMembersOnlyVisibility("default")}>
                      {t("channelSettingDefault")}
                      {membersOnlyVisibility === "default" && <MenuStatus><Check size={14} /></MenuStatus>}
                    </button>
                    <MenuSeparator className="channel-technical-spacer" />
                    <button className={membersOnlyVisibility === "everywhere" ? "is-selected" : undefined} onClick={() => changeMembersOnlyVisibility("everywhere")}>
                      {t("channelMembersOnlyEverywhere")}
                      {membersOnlyVisibility === "everywhere" && <MenuStatus><Check size={14} /></MenuStatus>}
                    </button>
                    <button className={membersOnlyVisibility === "channel" ? "is-selected" : undefined} onClick={() => changeMembersOnlyVisibility("channel")}>
                      {t("channelMembersOnlyChannelOnly")}
                      {membersOnlyVisibility === "channel" && <MenuStatus><Check size={14} /></MenuStatus>}
                    </button>
                    <button className={membersOnlyVisibility === "hidden" ? "is-selected" : undefined} onClick={() => changeMembersOnlyVisibility("hidden")}>
                      {t("channelMembersOnlyNowhere")}
                      {membersOnlyVisibility === "hidden" && <MenuStatus><Check size={14} /></MenuStatus>}
                    </button>
                  </>
                )}
                {technicalView === "downloads" && (
                  <>
                    <div className="more-menu-header"><button className="more-menu-back" onClick={() => setTechnicalView("root")}><ChevronLeft /></button>{t("autoDownloadMinimum")}</div>
                    <button className={autoDownloadMinDuration == null ? "is-selected" : undefined} onClick={() => changeAutoDownloadMinDuration(null)}>
                      {t("channelSettingDefault")}
                      {autoDownloadMinDuration == null && <MenuStatus><Check size={14} /></MenuStatus>}
                    </button>
                    {AUTO_DOWNLOAD_MIN_DURATIONS.map((seconds) => (
                      <button key={seconds} className={autoDownloadMinDuration === seconds ? "is-selected" : undefined} onClick={() => changeAutoDownloadMinDuration(seconds)}>
                        {seconds === 0 ? t("autoDownloadOff") : `≥ ${seconds / 60} min`}
                        {autoDownloadMinDuration === seconds && <MenuStatus><Check size={14} /></MenuStatus>}
                      </button>
                    ))}
                  </>
                )}
              </Menu>
          </Popover>
          <ButtonAnchor href={`https://www.youtube.com/channel/${id}`} target="_blank" rel="noreferrer" leadingIcon={<ExternalLink />}>YouTube</ButtonAnchor>
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
            <Plus size={13} /> Tag
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
          <SectionHeader title="LIVE" icon={<Radio />} variant="uppercase" className="channel-live-title" />
          <div className="video-grid channel-live-row">
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
            ...(shortCount > 0 ? [{ value: "shorts" as const, label: "Shorts", icon: <Zap />, count: shortCount }] : []),
            { value: "playlists", label: t("playlists"), icon: <ListVideo />, count: playlists?.length },
            ...(processingCount > 0 ? [{ value: "processing" as const, label: t("processing"), icon: <FileClock />, count: processingCount }] : []),
          ]}
        />
        <div className="channel-content-search">
          <Search className="channel-content-search__icon" aria-hidden="true" />
          <Input
            className="channel-content-search__input"
            value={channelSearch}
            onChange={(event) => setChannelSearch(event.target.value)}
            placeholder={t("searchChannelContent")}
            aria-label={t("searchChannelContent")}
          />
          {channelSearch && <button className="channel-content-search__clear" type="button" onClick={() => setChannelSearch("")} aria-label={t("clearSearch")}><X /></button>}
        </div>
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
          <EmptyState title={t("channelVideosEmpty")} description={t("channelVideosEmptyHint")} action={<Button variant="primary" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? "channel-spin" : undefined} />
              {syncing ? t("syncing") : t("syncChannelVideos")}
            </Button>} />
        ) : (
          <div className="video-grid">
            {regularVideos.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={reload} showChannelAvatar={false} />
            ))}
          </div>
        ))}

      {!searchActive && tab === "shorts" && (
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

      {!searchActive && (tab === "videos" || tab === "shorts" || tab === "processing") && (tab === "processing" ? !processingLoading : !videosLoading) && (
        <>
          {(tab === "processing" ? processingLoadingMore : loadingMore) && <VideoGridSkeleton count={4} />}
          {(tab === "processing" ? processingHasMore : hasMore) && <div ref={loadMoreRef} style={{ height: 1 }} />}
        </>
      )}
    </>
  );
}
