import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Captions, Check, ChevronLeft, ChevronRight, Download, ExternalLink, Gauge, ListVideo, Plus, Radio, RefreshCw, SlidersHorizontal, Star, UserMinus, UserPlus, Video as VideoIcon, Zap } from "lucide-react";
import { api, type ChannelAbout, type PlaylistInfo, type Tag, type Video, PLAYBACK_SPEEDS } from "../api";
import TagChip from "../components/TagChip";
import TagCreateForm from "../components/TagCreateForm";
import Tooltip from "../components/Tooltip";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { img } from "../img";
import { emit } from "../events";
import { formatAddedVideos, formatPlaylistVideoCount, useI18n } from "../i18n";
import { SUBTITLE_LANGUAGES, subtitleLanguageLabel } from "../subtitleLanguages";
import { Button, EmptyState, MenuSeparator, SectionHeader, Tabs } from "../components/ui";

type Tab = "videos" | "shorts" | "playlists";

// Matches the server's default /feed page size.
const CHANNEL_PAGE_SIZE = 40;
const AUTO_DOWNLOAD_MIN_DURATIONS = [0, 60, 5 * 60, 10 * 60, 20 * 60, 30 * 60, 45 * 60, 60 * 60];

export default function ChannelPage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t, language, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [openingPlaylist, setOpeningPlaylist] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) ?? "videos";
  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });
  const [about, setAbout] = useState<ChannelAbout | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [liveStreams, setLiveStreams] = useState<Video[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [unfollowPending, setUnfollowPending] = useState(false);
  const [channelSpeed, setChannelSpeed] = useState("");
  const [autoDownloadMinDuration, setAutoDownloadMinDuration] = useState<number | null>(null);
  const [downloadsEnabled, setDownloadsEnabled] = useState(false);
  const [captionMode, setCaptionMode] = useState<"off" | "language" | null>(null);
  const [captionLanguage, setCaptionLanguage] = useState<string | null>(null);
  const [hideMembersOnlyFromFeed, setHideMembersOnlyFromFeed] = useState<boolean | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [technicalView, setTechnicalView] = useState<"root" | "speed" | "captions" | "downloads" | "members">("root");
  const [channelTags, setChannelTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3ea6ff");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const technicalMenuRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const prevIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    setAbout(null);
    setVideos([]);
    setLiveStreams([]);
    setVideosLoading(true);
    setPage(0);
    setHasMore(true);
    setPlaylists(null);
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
    setHideMembersOnlyFromFeed(null);
    window.scrollTo(0, 0);
    api.channelAbout(id).then((about) => { setAbout(about); emit("channels-changed"); }).catch(console.error);
    api.channel(id).then((r) => {
      setChannelTags(r.channel.tags);
      setFollowed(r.channel.followed !== 0);
      setChannelSpeed(r.channel.playback_speed ?? "");
      setAutoDownloadMinDuration(r.channel.auto_download_min_duration_override ?? null);
      setCaptionMode(r.channel.caption_mode ?? null);
      setCaptionLanguage(r.channel.caption_language ?? null);
      setHideMembersOnlyFromFeed(r.channel.hide_members_only_from_feed == null ? null : r.channel.hide_members_only_from_feed === 1);
    }).catch(console.error);
    api
      .feed({ channel: id, status: "all", shorts: true, page: 0 })
      .then((r) => { setVideos(r.videos); setHasMore(r.videos.length === CHANNEL_PAGE_SIZE); })
      .catch(console.error)
      .finally(() => setVideosLoading(false));
    api.channelLive(id).then((r) => setLiveStreams(r.videos)).catch(console.error);
    api.channelPlaylists(id).then((r) => setPlaylists(r.playlists)).catch(() => setPlaylists([]));
    api.tags().then((r) => setAllTags(r.tags)).catch(console.error);
    api.plugins().then((r) => setDownloadsEnabled(r.plugins.some((plugin) => plugin.id === "downloads" && plugin.enabled))).catch(console.error);
  }, [id]);

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

  // Infinite scroll: bump the page when the sentinel enters the viewport.
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore || videosLoading || loadingMore) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setPage((p) => p + 1); },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, videosLoading, loadingMore, videos.length]);

  useEffect(() => {
    if (!tagMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (!tagMenuRef.current?.contains(e.target as Node)) setTagMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [tagMenuOpen]);

  useEffect(() => {
    if (!technicalOpen) return;
    const close = (e: MouseEvent) => {
      if (!technicalMenuRef.current?.contains(e.target as Node)) setTechnicalOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [technicalOpen]);

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

  const membersOnlyFeedLabel = hideMembersOnlyFromFeed == null
    ? t("channelSettingDefault")
    : hideMembersOnlyFromFeed
      ? t("channelMembersOnlyHidden")
      : t("channelMembersOnlyVisible");

  const changeMembersOnlyFeed = (hide: boolean | null) => {
    if (!id) return;
    const previous = hideMembersOnlyFromFeed;
    setHideMembersOnlyFromFeed(hide);
    api.setChannelMembersOnlyFeed(id, hide).catch((error) => {
      setHideMembersOnlyFromFeed(previous);
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
    api
      .feed({ channel: id, status: "all", shorts: true, page: 0 })
      .then((r) => { setVideos(r.videos); setHasMore(r.videos.length === CHANNEL_PAGE_SIZE); })
      .catch(console.error);
  };

  // Refresh the about payload (and with it the real video/short counts).
  const loadAbout = () => {
    if (!id) return;
    api.channelAbout(id).then((about) => { setAbout(about); emit("channels-changed"); }).catch(console.error);
  };

  // Playlists open inside the watch view (first video + playlist context),
  // so we resolve the first video id before navigating.
  const openPlaylist = async (playlistId: string) => {
    if (openingPlaylist) return;
    setOpeningPlaylist(playlistId);
    try {
      const r = await api.playlistVideos(playlistId);
      const first = r.videos[0];
      if (first) navigate(`/watch/${first.videoId}/playlist/${playlistId}`);
    } catch (e) {
      console.error(e);
    } finally {
      setOpeningPlaylist(null);
    }
  };

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
          <button
            className="btn"
            onClick={handleSync}
            disabled={syncing}
            title={t("syncTitle")}
          >
            <RefreshCw size={15} className={syncing ? "spin" : ""} />
            {syncing ? t("syncing") : syncMsg ?? t("syncChannel")}
          </button>
          <button
            className={`btn${followed ? " danger" : " primary"}`}
            onClick={toggleFollow}
            disabled={unfollowPending}
            title={followed ? t("unfollow") : t("followAgain")}
          >
            {followed ? <UserMinus size={15} /> : <UserPlus size={15} />}
            {followed ? t("unfollow") : t("follow")}
          </button>
          <div className="dropdown" ref={technicalMenuRef}>
            <button
              className={`btn icon-only${technicalOpen ? " active" : ""}`}
              onClick={() => setTechnicalOpen((open) => !open)}
              title={t("channelTechnicalSettings")}
              aria-label={t("channelTechnicalSettings")}
              aria-expanded={technicalOpen}
            >
              <SlidersHorizontal size={16} />
            </button>
            {technicalOpen && (
              <div className="dropdown-menu more-menu channel-technical-menu">
                {technicalView === "root" && (
                  <>
                    <div className="more-menu-section-label">{t("channelPlayback")}</div>
                    <button className="channel-technical-item" onClick={() => setTechnicalView("speed")}>
                      <Gauge /> <span>{t("channelSpeed")}</span><span className="dropdown-menu-status">{channelSpeed ? `${channelSpeed}×` : t("channelSettingDefault")}</span><ChevronRight />
                    </button>
                    <button className="channel-technical-item" onClick={() => setTechnicalView("captions")}>
                      <Captions /> <span>{t("subtitles")}</span><span className="dropdown-menu-status">{captionsLabel}</span><ChevronRight />
                    </button>
                    <MenuSeparator />
                    <div className="more-menu-section-label">{t("channelFeed")}</div>
                    <button className="channel-technical-item" onClick={() => setTechnicalView("members")}>
                      <Star /> <span>{t("channelMembersOnlyFeed")}</span><span className="dropdown-menu-status">{membersOnlyFeedLabel}</span><ChevronRight />
                    </button>
                    {downloadsEnabled && <>
                      <MenuSeparator />
                      <div className="more-menu-section-label">{t("channelDownloads")}</div>
                      <button className="channel-technical-item" onClick={() => setTechnicalView("downloads")}>
                        <Download /> <span>{t("autoDownloadMinimum")}</span><span className="dropdown-menu-status">{autoDownloadLabel}</span><ChevronRight />
                      </button>
                    </>}
                  </>
                )}
                {technicalView === "speed" && (
                  <>
                    <div className="more-menu-header"><button className="more-menu-back" onClick={() => setTechnicalView("root")}><ChevronLeft /></button>{t("channelSpeed")}</div>
                    {PLAYBACK_SPEEDS.map((speed) => (
                      <button key={speed} className={channelSpeed === speed ? "is-selected" : undefined} onClick={() => changeSpeed(speed)}>
                        {speed === "1" ? "1×" : `${speed}×`}
                        {channelSpeed === speed && <span className="dropdown-menu-status"><Check size={14} /></span>}
                      </button>
                    ))}
                    <button className={!channelSpeed ? "is-selected" : undefined} onClick={() => changeSpeed(null)}>
                      {t("channelSettingDefault")}
                      {!channelSpeed && <span className="dropdown-menu-status"><Check size={14} /></span>}
                    </button>
                  </>
                )}
                {technicalView === "captions" && (
                  <>
                    <div className="more-menu-header"><button className="more-menu-back" onClick={() => setTechnicalView("root")}><ChevronLeft /></button>{t("subtitles")}</div>
                    <div className="channel-technical-scroll">
                      <button className={captionMode == null ? "is-selected" : undefined} onClick={() => changeCaptions(null)}>
                        {t("channelSettingDefault")}
                        {captionMode == null && <span className="dropdown-menu-status"><Check size={14} /></span>}
                      </button>
                      <button className={captionMode === "off" ? "is-selected" : undefined} onClick={() => changeCaptions("off")}>
                        {t("captionsOff")}
                        {captionMode === "off" && <span className="dropdown-menu-status"><Check size={14} /></span>}
                      </button>
                      <MenuSeparator />
                      {SUBTITLE_LANGUAGES.map((language) => (
                        <button key={language.code} className={captionMode === "language" && captionLanguage === language.code ? "is-selected" : undefined} onClick={() => changeCaptions("language", language.code)}>
                          {language.label}
                          {captionMode === "language" && captionLanguage === language.code && <span className="dropdown-menu-status"><Check size={14} /></span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {technicalView === "members" && (
                  <>
                    <div className="more-menu-header"><button className="more-menu-back" onClick={() => setTechnicalView("root")}><ChevronLeft /></button>{t("channelMembersOnlyFeed")}</div>
                    <button className={hideMembersOnlyFromFeed == null ? "is-selected" : undefined} onClick={() => changeMembersOnlyFeed(null)}>
                      {t("channelSettingDefault")}
                      {hideMembersOnlyFromFeed == null && <span className="dropdown-menu-status"><Check size={14} /></span>}
                    </button>
                    <button className={hideMembersOnlyFromFeed === false ? "is-selected" : undefined} onClick={() => changeMembersOnlyFeed(false)}>
                      {t("channelMembersOnlyShow")}
                      {hideMembersOnlyFromFeed === false && <span className="dropdown-menu-status"><Check size={14} /></span>}
                    </button>
                    <button className={hideMembersOnlyFromFeed === true ? "is-selected" : undefined} onClick={() => changeMembersOnlyFeed(true)}>
                      {t("channelMembersOnlyHide")}
                      {hideMembersOnlyFromFeed === true && <span className="dropdown-menu-status"><Check size={14} /></span>}
                    </button>
                  </>
                )}
                {technicalView === "downloads" && (
                  <>
                    <div className="more-menu-header"><button className="more-menu-back" onClick={() => setTechnicalView("root")}><ChevronLeft /></button>{t("autoDownloadMinimum")}</div>
                    <button className={autoDownloadMinDuration == null ? "is-selected" : undefined} onClick={() => changeAutoDownloadMinDuration(null)}>
                      {t("channelSettingDefault")}
                      {autoDownloadMinDuration == null && <span className="dropdown-menu-status"><Check size={14} /></span>}
                    </button>
                    {AUTO_DOWNLOAD_MIN_DURATIONS.map((seconds) => (
                      <button key={seconds} className={autoDownloadMinDuration === seconds ? "is-selected" : undefined} onClick={() => changeAutoDownloadMinDuration(seconds)}>
                        {seconds === 0 ? t("autoDownloadOff") : `≥ ${seconds / 60} min`}
                        {autoDownloadMinDuration === seconds && <span className="dropdown-menu-status"><Check size={14} /></span>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <a className="btn" href={`https://www.youtube.com/channel/${id}`} target="_blank" rel="noreferrer">
            <ExternalLink /> YouTube
          </a>
        </div>
      </div>

      {/* Channel tag management */}
      <div className="channel-tags-row">
        <div className="dropdown" ref={tagMenuRef}>
          <button className="btn-ghost" onClick={() => setTagMenuOpen((o) => !o)} title={t("addTag")}>
            <Plus size={13} /> Tag
          </button>
          {tagMenuOpen && (
            <div className="dropdown-menu" style={{ minWidth: 220 }}>
              {allTags
                .map((tag) => {
                  const isSelected = channelTags.some((ct) => ct.id === tag.id);
                  return (
                    <button
                      key={tag.id}
                      className={isSelected ? "is-selected" : undefined}
                      onClick={() => toggleTag(tag)}
                      title={isSelected ? t("removeTagFromChannel") : t("tagToChannel")}
                    >
                      <span className="dot" style={{ background: tag.color, width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0 }} />
                      {tag.name}
                      {isSelected && (
                        <span className="dropdown-menu-status" aria-label={t("selectedTag")}>
                          <Check size={14} />
                        </span>
                      )}
                    </button>
                  );
                })}
              <TagCreateForm title={t("newTag")} name={newTagName} color={newTagColor} placeholder={t("tagNamePlaceholder")} submitLabel={t("addTag")} onNameChange={setNewTagName} onColorChange={setNewTagColor} onSubmit={createAndAddTag} />
            </div>
          )}
        </div>
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

      <Tabs
        className="channel-tabs"
        label={about?.title ?? t("videos")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "videos", label: t("videos"), icon: <VideoIcon />, count: videoCount },
          ...(shortCount > 0 ? [{ value: "shorts" as const, label: "Shorts", icon: <Zap />, count: shortCount }] : []),
          { value: "playlists", label: t("playlists"), icon: <ListVideo />, count: playlists?.length },
        ]}
      />

      {tab === "videos" &&
        (videosLoading ? (
          <VideoGridSkeleton />
        ) : regularVideos.length === 0 ? (
          <EmptyState title={t("channelVideosEmpty")} description={t("channelVideosEmptyHint")} action={<Button variant="primary" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? "spin" : undefined} />
              {syncing ? t("syncing") : t("syncChannelVideos")}
            </Button>} />
        ) : (
          <div className="video-grid">
            {regularVideos.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={reload} showChannelAvatar={false} />
            ))}
          </div>
        ))}

      {tab === "shorts" && (
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

      {tab === "playlists" &&
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
                disabled={openingPlaylist !== null}
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

      {(tab === "videos" || tab === "shorts") && !videosLoading && (
        <>
          {loadingMore && <VideoGridSkeleton count={4} />}
          {hasMore && <div ref={loadMoreRef} style={{ height: 1 }} />}
        </>
      )}
    </>
  );
}
