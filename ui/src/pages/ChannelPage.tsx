import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, ExternalLink, Gauge, ListVideo, Plus, RefreshCw, UserMinus, UserPlus, Video as VideoIcon, Zap } from "lucide-react";
import { api, type ChannelAbout, type PlaylistInfo, type Tag, type Video, PLAYBACK_SPEEDS } from "../api";
import TagChip from "../components/TagChip";
import Tooltip from "../components/Tooltip";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { img } from "../img";
import { emit } from "../events";
import { formatAddedVideos, formatVideoCount as formatI18nVideoCount, useI18n, type Language } from "../i18n";

type Tab = "videos" | "shorts" | "playlists";

// Matches the server's default /feed page size.
const CHANNEL_PAGE_SIZE = 40;

function formatVideoCount(n: string | number, language: Language): string {
  const num = Number(String(n).replace(/\D/g, ""));
  if (!num) return String(n);
  return formatI18nVideoCount(num, language);
}

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
  const [videosLoading, setVideosLoading] = useState(true);
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [unfollowPending, setUnfollowPending] = useState(false);
  const [channelSpeed, setChannelSpeed] = useState("");
  const [speedOpen, setSpeedOpen] = useState(false);
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
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const prevIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    setAbout(null);
    setVideos([]);
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
    window.scrollTo(0, 0);
    api.channelAbout(id).then((about) => { setAbout(about); emit("channels-changed"); }).catch(console.error);
    api.channel(id).then((r) => {
      setChannelTags(r.channel.tags);
      setFollowed(r.channel.followed !== 0);
      setChannelSpeed(r.channel.playback_speed ?? "");
    }).catch(console.error);
    api
      .feed({ channel: id, status: "all", shorts: true, page: 0 })
      .then((r) => { setVideos(r.videos); setHasMore(r.videos.length === CHANNEL_PAGE_SIZE); })
      .catch(console.error)
      .finally(() => setVideosLoading(false));
    api.channelPlaylists(id).then((r) => setPlaylists(r.playlists)).catch(() => setPlaylists([]));
    api.tags().then((r) => setAllTags(r.tags)).catch(console.error);
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
    if (!speedOpen) return;
    const close = (e: MouseEvent) => {
      if (!speedMenuRef.current?.contains(e.target as Node)) setSpeedOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [speedOpen]);

  // Set (or clear, with null) this channel's playback-speed override.
  const changeSpeed = (v: string | null) => {
    setChannelSpeed(v ?? "");
    setSpeedOpen(false);
    if (id) api.setChannelSpeed(id, v).catch(console.error);
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
          <div className="dropdown" ref={speedMenuRef}>
            <button
              className={`btn${channelSpeed ? " active" : ""}`}
              onClick={() => setSpeedOpen((o) => !o)}
              title={t("playbackSpeed")}
            >
              <Gauge size={15} /> {channelSpeed ? `${channelSpeed}×` : t("speedDefault")}
            </button>
            {speedOpen && (
              <div className="dropdown-menu speed-menu">
                {PLAYBACK_SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={channelSpeed === s ? "is-selected" : undefined}
                    onClick={() => changeSpeed(s)}
                  >
                    {s === "1" ? "1×" : `${s}×`}
                    {channelSpeed === s && <span className="dropdown-menu-status"><Check size={14} /></span>}
                  </button>
                ))}
                <button
                  className={!channelSpeed ? "is-selected" : undefined}
                  onClick={() => changeSpeed(null)}
                >
                  {t("speedDefault")}
                  {!channelSpeed && <span className="dropdown-menu-status"><Check size={14} /></span>}
                </button>
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
              <div style={{ borderTop: "1px solid var(--surface-3)", margin: "6px 0" }} />
              <div style={{ padding: "6px 12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>{t("newTag")}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    style={{ width: 32, height: 32, border: "1px solid var(--surface-3)", borderRadius: 6, background: "var(--bg)", padding: 2, cursor: "pointer", flexShrink: 0 }}
                  />
                  <input
                    type="text"
                    placeholder={t("tagNamePlaceholder")}
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createAndAddTag()}
                    style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--surface-3)", borderRadius: 6, padding: "6px 10px", color: "var(--text)", fontSize: 13, outline: "none", minWidth: 0 }}
                  />
                </div>
                <button
                  className="btn primary"
                  onClick={createAndAddTag}
                  disabled={!newTagName.trim()}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {t("addTag")}
                </button>
              </div>
            </div>
          )}
        </div>
        {channelTags.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => removeTag(t)} />
        ))}
      </div>

      <div className="chip-bar" style={{ marginBottom: 22 }}>
        <button className={`chip${tab === "videos" ? " active" : ""}`} onClick={() => setTab("videos")}>
          <VideoIcon style={{ width: 15, height: 15 }} /> {t("videos")}
          {videoCount > 0 && <span className="chip-count">{videoCount}</span>}
        </button>
        {shortCount > 0 && (
          <button className={`chip${tab === "shorts" ? " active" : ""}`} onClick={() => setTab("shorts")}>
            <Zap style={{ width: 15, height: 15 }} /> Shorts
            <span className="chip-count">{shortCount}</span>
          </button>
        )}
        <button className={`chip${tab === "playlists" ? " active" : ""}`} onClick={() => setTab("playlists")}>
          <ListVideo style={{ width: 15, height: 15 }} /> {t("playlists")}
          {playlists && playlists.length > 0 && <span className="chip-count">{playlists.length}</span>}
        </button>
      </div>

      {tab === "videos" &&
        (videosLoading ? (
          <VideoGridSkeleton />
        ) : regularVideos.length === 0 ? (
          <div className="empty-state">{t("channelVideosEmpty")}</div>
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
          <div className="empty-state">{t("publicPlaylistsEmpty")}</div>
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
                    <span className="playlist-count">{formatVideoCount(p.videoCount, language)}</span>
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
