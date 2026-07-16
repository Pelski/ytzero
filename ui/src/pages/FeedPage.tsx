import { useCallback, useEffect, useRef, useState } from "react";
import { subscribe } from "../events";
import { Link, useSearchParams } from "react-router-dom";
import { Clock, Eye, Inbox, RefreshCw } from "lucide-react";
import { api, type Bucket, type Channel, type SearchResult, type Tag, type Video } from "../api";
import { formatPublishedAgo, useI18n } from "../i18n";
import { img } from "../img";
import ChildTimeRequestBanner from "../components/ChildTimeRequestBanner";
import TagFilterBar from "../components/TagFilterBar";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { GRID_SIZES, persistGridSize, readGridSize, type GridSize } from "../gridSize";
import { VideoThumbnail } from "../components/VideoThumbnail";

type TopChannel = Channel & { watch_count: number; is_live: number };

function ChannelAvatarRow() {
  const [channels, setChannels] = useState<TopChannel[]>([]);
  const scroll = useHScroll();

  useEffect(() => {
    api.topChannels().then((r) => setChannels(r.channels)).catch(() => {});
  }, []);

  useEffect(() => subscribe("channels-changed", () => {
    api.topChannels().then((r) => setChannels(r.channels)).catch(() => {});
  }), []);

  if (channels.length === 0) return null;

  return (
    <div className={`h-scroll-wrap channel-avatar-section${scroll.shadowLeft ? " shadow-left" : ""}${scroll.shadowRight ? " shadow-right" : ""}`}>
      <div className="channel-avatar-row" ref={scroll.ref}>
        {channels.map((ch) => (
          <Link key={ch.channel_id} to={`/channel/${ch.channel_id}`} className="channel-avatar-item">
            <div className="channel-avatar-wrap">
              {ch.thumbnail ? (
                <img className="channel-avatar-img" src={img(ch.thumbnail)} alt="" />
              ) : (
                <div className="channel-avatar-img channel-avatar-placeholder" />
              )}
              {ch.is_live === 1 && <span className="channel-avatar-live">LIVE</span>}
            </div>
            <span className="channel-avatar-name">{ch.title}</span>
            {ch.subscriber_count && (
              <span className="channel-avatar-subs">{ch.subscriber_count}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

const BUCKET_ORDER: Bucket[] = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];

function useHScroll() {
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((el: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;
    const update = () => {
      setShadowLeft(el.scrollLeft > 4);
      setShadowRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: false });
    cleanupRef.current = () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return { ref, shadowLeft, shadowRight };
}

export default function FeedPage({
  onPlay,
  showToast,
  hideExternalSearch = false,
}: {
  onPlay: (v: Video) => void;
  showToast: (m: string) => void;
  hideExternalSearch?: boolean;
}) {
  const { t, locale, language } = useI18n();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [videos, setVideos] = useState<Video[]>([]);
  const [queued, setQueued] = useState<Video[]>([]);
  const [inProgress, setInProgress] = useState<Video[]>([]);
  const [ytResults, setYtResults] = useState<SearchResult[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("feedTags") ?? "[]"); } catch { return []; }
  });
  const [showAll, setShowAll] = useState(() => sessionStorage.getItem("feedShowAll") === "1");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [gridSize, setGridSize] = useState<GridSize>(readGridSize);
  const [showTopChannels, setShowTopChannels] = useState(true);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const inProgressScroll = useHScroll();
  const queuedScroll = useHScroll();
  const hScrollWrapRef = useRef<HTMLDivElement>(null);
  const [hCardWidth, setHCardWidth] = useState(220);

  const GRID_MIN: Record<GridSize, number> = { sm: 220, md: 320, lg: 360 };

  useEffect(() => {
    const el = hScrollWrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const min = GRID_MIN[gridSize];
      const cols = Math.max(1, Math.floor(w / min));
      setHCardWidth(Math.floor((w - (cols - 1) * 12) / cols));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridSize]);

  useEffect(() => { setPage(0); setSearchExpanded(false); }, [q]);

  const load = useCallback(async (requestedPage = page) => {
    if (requestedPage === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const feed = await api.feed({ tags: selectedTags, q, page: requestedPage, show_all: showAll });
      setVideos((prev) => (requestedPage === 0 ? feed.videos : [...prev, ...feed.videos]));
      setHasMore(feed.videos.length === 40);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedTags, q, page, showAll]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const loadTags = useCallback(() => {
    api.tags().then((r) => setTags(r.tags)).catch(console.error);
  }, []);

  const loadQueued = useCallback(() => {
    api.watchlist().then((r) => setQueued(r.videos)).catch(console.error);
  }, []);

  const loadInProgress = useCallback(() => {
    api.inProgress().then((r) => setInProgress(r.videos)).catch(console.error);
  }, []);

  useEffect(() => {
    loadTags();
    loadQueued();
    loadInProgress();
  }, [loadTags, loadQueued, loadInProgress]);

  const loadTopChannelsSetting = useCallback(() => {
    api.settings().then((r) => setShowTopChannels(r.settings.show_top_channels !== "0")).catch(() => {});
  }, []);

  useEffect(() => { loadTopChannelsSetting(); }, [loadTopChannelsSetting]);

  useEffect(() => subscribe("tags-changed", loadTags), [loadTags]);
  useEffect(() => subscribe("queue-changed", loadQueued), [loadQueued]);
  useEffect(() => subscribe("top-channels-changed", loadTopChannelsSetting), [loadTopChannelsSetting]);

  useEffect(() => {
    if (!q || hideExternalSearch) { setYtResults([]); return; }
    setYtLoading(true);
    api.youtubeSearch(q)
      .then((r) => setYtResults(r.results))
      .catch(() => setYtResults([]))
      .finally(() => setYtLoading(false));
  }, [q, hideExternalSearch]);

  // Infinite scroll
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setPage((p) => p + 1); },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, videos]);

  const changeGridSize = (size: GridSize) => {
    setGridSize(size);
    persistGridSize(size);
  };

  const toggleTag = (id: number) => {
    setLoading(true);
    setPage(0);
    setSelectedTags((s) => {
      const next = s.includes(id) ? s.filter((t) => t !== id) : [...s, id];
      sessionStorage.setItem("feedTags", JSON.stringify(next));
      return next;
    });
  };

  const toggleShowAll = () => {
    setLoading(true);
    setPage(0);
    setShowAll((s) => {
      const next = !s;
      if (next) sessionStorage.setItem("feedShowAll", "1");
      else sessionStorage.removeItem("feedShowAll");
      return next;
    });
  };

  const clearTags = () => {
    setLoading(true);
    setPage(0);
    setSelectedTags([]);
    sessionStorage.removeItem("feedTags");
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.refresh();
      showToast(t("refreshed", { channels: r.channels, added: r.added }));
      setLoading(true);
      setPage(0);
      await load(0);
    } catch (e) {
      showToast(`${t("refreshError")} ${e instanceof Error ? e.message : e}`);
    } finally {
      setRefreshing(false);
    }
  };

  const reload = () => {
    setLoading(true);
    setPage(0);
    load(0).catch(console.error);
    loadQueued();
    loadInProgress();
  };

  const removeFromFeed = (videoId?: string) => {
    if (videoId) setVideos((current) => current.filter((v) => v.video_id !== videoId));
    loadQueued();
    loadInProgress();
  };

  // Time-based queued sections — only show videos that have unlocked.
  const now = new Date();
  const dueQueuedVideos = queued
    .filter((v) => v.bucket && (!v.show_from || new Date(v.show_from) <= now))
    .sort((a, b) => {
      const bucketDiff = BUCKET_ORDER.indexOf(a.bucket!) - BUCKET_ORDER.indexOf(b.bucket!);
      if (bucketDiff !== 0) return bucketDiff;
      return new Date(a.show_from ?? 0).getTime() - new Date(b.show_from ?? 0).getTime();
    });

  return (
    <>
      <ChildTimeRequestBanner />
      <div className="toolbar" ref={hScrollWrapRef}>
        <TagFilterBar
          tags={tags}
          selected={selectedTags}
          onToggle={toggleTag}
          onClearAll={clearTags}
          suffix={
            <button
              className={`chip${showAll ? " active" : ""}`}
              onClick={toggleShowAll}
              title={t("showAll")}
            >
              <Eye size={13} />
              {t("showAll")}
            </button>
          }
        />
        <div className="toolbar-right" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <div className="grid-size-toggle">
            {GRID_SIZES.map((g) => (
              <button
                key={g.id}
                className={`grid-size-btn${gridSize === g.id ? " active" : ""}`}
                title={t(g.labelKey)}
                onClick={() => changeGridSize(g.id)}
              >
                {g.icon}
              </button>
            ))}
          </div>
          <button className="btn icon-only" title={t("refresh")} onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? "spin" : undefined} />
          </button>
        </div>
      </div>

      {q && (
        <p className="search-info">
          {t("searchResultsFor")} <b>{q}</b>
        </p>
      )}

      {!q && showTopChannels && <ChannelAvatarRow />}

      {inProgress.length > 0 && !q && (
        <div className="continue-watching-section">
          <div className="time-section-header">
            <Clock size={16} />
            <span>{t("continueWatching")}</span>
          </div>
          <div className={`h-scroll-wrap${inProgressScroll.shadowLeft ? " shadow-left" : ""}${inProgressScroll.shadowRight ? " shadow-right" : ""}`}>
            <div className={`h-scroll-row h-scroll-row--${gridSize}`} ref={inProgressScroll.ref}>
              {inProgress.map((v) => (
                <div key={v.video_id} className="h-scroll-card" style={{ width: hCardWidth }}>
                  <VideoCard video={v} onPlay={onPlay} onChanged={loadInProgress} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {dueQueuedVideos.length > 0 && !q && selectedTags.length === 0 && (
        <div className="time-section">
          <div className="time-section-header">
            <Clock size={16} />
            <span>{t("navWatchlist")}</span>
          </div>
          <div className={`h-scroll-wrap${queuedScroll.shadowLeft ? " shadow-left" : ""}${queuedScroll.shadowRight ? " shadow-right" : ""}`}>
            <div className={`h-scroll-row h-scroll-row--${gridSize}`} ref={queuedScroll.ref}>
              {dueQueuedVideos.map((v) => (
                <div key={v.video_id} className="h-scroll-card" style={{ width: hCardWidth }}>
                  <VideoCard video={v} onPlay={onPlay} onChanged={reload} />
                </div>
              ))}
            </div>
          </div>
          <div className="time-section-divider" />
        </div>
      )}

      {loading && videos.length === 0 ? (
        <VideoGridSkeleton gridSize={q ? "sm" : gridSize} />
      ) : videos.length === 0 ? (
        <div className="empty-state">
          <Inbox />
          <div>
            {q
              ? t("noSearchResults")
              : t("noVideos")}
          </div>
        </div>
      ) : q ? (
        <>
          <div className="video-grid video-grid--sm">
            {(searchExpanded ? videos : videos.slice(0, 8)).map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={removeFromFeed} />
            ))}
          </div>
          {loadingMore && <VideoGridSkeleton count={4} gridSize="sm" />}
          {videos.length > 8 && (
            <div className="load-more">
              <button className="btn" onClick={() => setSearchExpanded((e) => !e)}>
                {searchExpanded ? t("showLess") : `${t("showMore")} (${videos.length - 8})`}
              </button>
              {hasMore && !loadingMore && searchExpanded && (
                <button ref={loadMoreRef} className="btn secondary" onClick={() => setPage((p) => p + 1)}>
                  {t("loadMore")}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={`video-grid video-grid--${gridSize}`}>
            {videos.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={removeFromFeed} />
            ))}
          </div>
          {loadingMore && <VideoGridSkeleton count={4} gridSize={gridSize} />}
          {hasMore && !loadingMore && (
            <div className="load-more">
              <button ref={loadMoreRef} className="btn" onClick={() => setPage((p) => p + 1)}>
                {t("loadMore")}
              </button>
            </div>
          )}
        </>
      )}

      {q && !hideExternalSearch && (
        <div className="yt-results-section">
          <div className="time-section-header">
            <span>{t("youtubeResults")}</span>
          </div>
          {ytLoading ? (
            <VideoGridSkeleton count={4} gridSize="sm" />
          ) : ytResults.length === 0 ? null : (
            <div className="yt-results-list">
              {ytResults.map((r) => (
                <Link
                  key={r.videoId}
                  className="yt-result-row"
                  to={`/watch/${r.videoId}`}
                >
                  <VideoThumbnail src={r.thumbnail} watched={r.watched === 1} variant="search" loading="lazy">
                    {r.duration && <span className="yt-result-dur">{r.duration}</span>}
                  </VideoThumbnail>
                  <div className="yt-result-info">
                    <div className="yt-result-title">{r.title}</div>
                    {(r.viewCount != null || r.published) && (
                      <div className="yt-result-meta">
                        {r.viewCount != null && `${r.viewCount.toLocaleString(locale)} ${t("views")}`}
                        {r.viewCount != null && r.published && " · "}
                        {r.published && formatPublishedAgo(r.published, language)}
                      </div>
                    )}
                    <div className="yt-result-channel">
                      {r.channelAvatar && (
                        <img className="yt-result-avatar" src={img(r.channelAvatar)} alt="" loading="lazy" draggable={false} />
                      )}
                      <span>{r.channelTitle}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
