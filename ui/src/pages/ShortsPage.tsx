import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Play, Shuffle, Zap } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { subscribe } from "../events";
import { api, type Tag, type Video } from "../api";
import { useI18n } from "../i18n";
import TagFilterBar from "../components/TagFilterBar";
import ShortCard from "../components/ShortCard";
import ShortsPlayer from "../components/ShortsPlayer";
import { ShortsGridSkeleton } from "../components/LoadingState";

export default function ShortsPage() {
  const { t } = useI18n();
  const { videoId } = useParams<{ videoId?: string }>();
  const navigate = useNavigate();
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
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const deepLinkRequestRef = useRef<string | null>(null);

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
      ([entry]) => {
        if (entry.isIntersecting && !loadingMoreRef.current) setPage((p) => p + 1);
      },
      { rootMargin: "300px" }
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

  const loadMore = useCallback(() => {
    if (!hasMoreRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setPage((p) => p + 1);
  }, []);

  const playerPath = useCallback((id: string) => `/shorts/${encodeURIComponent(id)}`, []);

  const openPlayer = useCallback((v: Video) => {
    const idx = videos.findIndex((x) => x.video_id === v.video_id);
    setPlayerIdx(idx >= 0 ? idx : 0);
    navigate(playerPath(v.video_id));
  }, [navigate, playerPath, videos]);

  // Resolve direct links after the feed loads. If the target isn't in the
  // current page (or is filtered out), fetch that exact video and prepend it.
  useEffect(() => {
    if (!videoId) {
      deepLinkRequestRef.current = null;
      setPlayerIdx(null);
      return;
    }
    const idx = videos.findIndex((v) => v.video_id === videoId);
    if (idx >= 0) {
      setPlayerIdx(idx);
      return;
    }
    if (loading || deepLinkRequestRef.current === videoId) return;
    deepLinkRequestRef.current = videoId;
    api.video(videoId)
      .then(({ video }) => {
        if (video.is_short !== 1) throw new Error("not a Short");
        setVideos((current) => current.some((v) => v.video_id === video.video_id) ? current : [video, ...current]);
        setPlayerIdx(0);
      })
      .catch(() => navigate("/shorts", { replace: true }));
  }, [loading, navigate, videoId, videos]);

  const isWatched = useCallback(
    (v: Video) => v.watched === 1 || watchedIds.has(v.video_id),
    [watchedIds]
  );

  const playFromStart = () => {
    if (videos.length === 0) return;
    const firstUnwatched = videos.findIndex((v) => !isWatched(v));
    const idx = firstUnwatched >= 0 ? firstUnwatched : 0;
    setPlayerIdx(idx);
    navigate(playerPath(videos[idx].video_id));
  };

  const playRandom = () => {
    if (videos.length === 0) return;
    const pool = videos
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => !isWatched(v));
    const candidates = pool.length > 0 ? pool : videos.map((v, i) => ({ v, i }));
    const idx = candidates[Math.floor(Math.random() * candidates.length)].i;
    setPlayerIdx(idx);
    navigate(playerPath(videos[idx].video_id));
  };

  const handlePlayerVideoChange = useCallback((nextVideoId: string) => {
    const idx = videos.findIndex((v) => v.video_id === nextVideoId);
    if (idx >= 0) setPlayerIdx(idx);
    navigate(playerPath(nextVideoId), { replace: true });
  }, [navigate, playerPath, videos]);

  const closePlayer = useCallback(() => {
    setPlayerIdx(null);
    navigate("/shorts", { replace: true });
  }, [navigate]);

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

  const handleRemoved = useCallback((videoId: string) => {
    setVideos((prev) => prev.filter((v) => v.video_id !== videoId));
  }, []);

  return (
    <>
      {playerIdx !== null && (
        <ShortsPlayer
          videos={videos}
          initialIndex={playerIdx}
          onClose={closePlayer}
          onVideoChange={handlePlayerVideoChange}
          onLoadMore={loadMore}
          onWatched={handleWatched}
          onLiked={handleLiked}
        />
      )}

      <div className="shorts-hero">
        <button className="btn primary" onClick={playFromStart} disabled={videos.length === 0}>
          <Play size={15} /> {t("shortsPlayAll")}
        </button>
        <button className="btn" onClick={playRandom} disabled={videos.length === 0}>
          <Shuffle size={15} /> {t("shortsShuffle")}
        </button>
      </div>

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
        <ShortsGridSkeleton />
      ) : videos.length === 0 ? (
        <div className="empty-state">
          <Zap />
          <div>{t("shortsEmpty")}</div>
        </div>
      ) : (
        <>
          <div className="shorts-grid">
            {videos.map((v) => {
              const liked = likedIds.has(v.video_id) ? likedIds.get(v.video_id)! : v.liked === 1;
              return (
                <ShortCard
                  key={v.video_id}
                  video={v}
                  onPlay={openPlayer}
                  onRemoved={handleRemoved}
                  onLiked={handleLiked}
                  isWatched={isWatched(v)}
                  isLiked={liked}
                />
              );
            })}
          </div>
          {loadingMore && <ShortsGridSkeleton count={6} />}
          {hasMore && !loadingMore && (
            <div className="load-more" ref={loadMoreRef}>
              <button className="btn" onClick={() => setPage((p) => p + 1)}>
                {t("loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
