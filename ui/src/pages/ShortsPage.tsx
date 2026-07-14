import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Inbox } from "lucide-react";
import { subscribe } from "../events";
import { api, type Tag, type Video } from "../api";
import { useI18n } from "../i18n";
import TagFilterBar from "../components/TagFilterBar";
import VideoCard from "../components/VideoCard";
import ShortsPlayer from "../components/ShortsPlayer";
import { VideoGridSkeleton } from "../components/LoadingState";

export default function ShortsPage() {
  const { t } = useI18n();
  const [videos, setVideos] = useState<Video[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("shortsTags") ?? "[]"); } catch { return []; }
  });
  const [likedOnly, setLikedOnly] = useState(() =>
    sessionStorage.getItem("shortsLikedOnly") === "1"
  );
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [playerIdx, setPlayerIdx] = useState<number | null>(null);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [likedIds, setLikedIds] = useState<Map<string, boolean>>(new Map());
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async (requestedPage: number) => {
    if (requestedPage === 0) setLoading(true);
    else { setLoadingMore(true); loadingMoreRef.current = true; }
    try {
      const feed = await api.feed({
        shorts: true,
        only_shorts: true,
        tags: selectedTags,
        liked: likedOnly || undefined,
        page: requestedPage,
      });
      setVideos((prev) => (requestedPage === 0 ? feed.videos : [...prev, ...feed.videos]));
      const more = feed.videos.length === 40;
      setHasMore(more);
      hasMoreRef.current = more;
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [selectedTags, likedOnly]);

  useEffect(() => { load(0).catch(console.error); }, [load]);

  const loadTags = useCallback(() => {
    api.tags().then((r) => setTags(r.tags)).catch(console.error);
  }, []);

  useEffect(loadTags, [loadTags]);
  useEffect(() => subscribe("tags-changed", loadTags), [loadTags]);

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

  useEffect(() => {
    if (page === 0) return;
    load(page).catch(console.error);
  }, [page, load]);

  const toggleTag = (id: number) => {
    setLoading(true);
    setPage(0);
    setSelectedTags((s) => {
      const next = s.includes(id) ? s.filter((t) => t !== id) : [...s, id];
      sessionStorage.setItem("shortsTags", JSON.stringify(next));
      return next;
    });
  };

  const clearTags = () => {
    setLoading(true);
    setPage(0);
    setSelectedTags([]);
    sessionStorage.removeItem("shortsTags");
  };

  const toggleLikedOnly = () => {
    setLikedOnly((prev) => {
      const next = !prev;
      sessionStorage.setItem("shortsLikedOnly", next ? "1" : "0");
      return next;
    });
    setPage(0);
  };

  const reload = useCallback(() => {
    setPage(0);
    load(0).catch(console.error);
  }, [load]);

  const loadMore = useCallback(() => {
    if (!hasMoreRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setPage((p) => p + 1);
  }, []);

  const openPlayer = useCallback((v: Video) => {
    const idx = videos.findIndex((x) => x.video_id === v.video_id);
    setPlayerIdx(idx >= 0 ? idx : 0);
  }, [videos]);

  const handleWatched = useCallback((videoId: string) => {
    setWatchedIds((prev) => {
      if (prev.has(videoId)) return prev;
      const next = new Set(prev);
      next.add(videoId);
      return next;
    });
  }, []);

  const handleLiked = useCallback((videoId: string, liked: boolean) => {
    setLikedIds((prev) => {
      const next = new Map(prev);
      next.set(videoId, liked);
      return next;
    });
    if (likedOnly && !liked) {
      setVideos((prev) => prev.filter((v) => v.video_id !== videoId));
    }
  }, [likedOnly]);

  return (
    <>
      {playerIdx !== null && (
        <ShortsPlayer
          videos={videos}
          initialIndex={playerIdx}
          onClose={() => setPlayerIdx(null)}
          onLoadMore={loadMore}
          onWatched={handleWatched}
          onLiked={handleLiked}
        />
      )}

      <h1 className="page-title">{t("navShorts")}</h1>

      <TagFilterBar
        tags={tags}
        selected={selectedTags}
        onToggle={toggleTag}
        onClearAll={clearTags}
        suffix={
          <button
            className={`chip${likedOnly ? " active" : ""}`}
            onClick={toggleLikedOnly}
            aria-pressed={likedOnly}
          >
            <Heart size={12} fill={likedOnly ? "currentColor" : "none"} />
            {t("likedOnly")}
          </button>
        }
      />

      {loading && videos.length === 0 ? (
        <VideoGridSkeleton gridSize="sm" />
      ) : videos.length === 0 ? (
        <div className="empty-state">
          <Inbox />
          <div>{t("noVideos")}</div>
        </div>
      ) : (
        <>
          <div className="video-grid video-grid--sm">
            {videos.map((v) => {
              const liked = likedIds.has(v.video_id) ? likedIds.get(v.video_id)! : v.liked === 1;
              return (
                <VideoCard
                  key={v.video_id}
                  video={v}
                  onPlay={openPlayer}
                  onChanged={reload}
                  isWatched={v.watched === 1 || watchedIds.has(v.video_id)}
                  isLiked={liked}
                />
              );
            })}
          </div>
          {loadingMore && <VideoGridSkeleton count={4} gridSize="sm" />}
          {hasMore && !loadingMore && (
            <div className="load-more">
              <button ref={loadMoreRef} className="btn" onClick={() => setPage((p) => p + 1)}>
                {t("loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
