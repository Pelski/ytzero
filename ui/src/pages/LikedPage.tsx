import { useCallback, useEffect, useState } from "react";
import { Clapperboard, ThumbsUp } from "lucide-react";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { Button, Chip, EmptyState, PageHeader } from "../components/ui";

export default function LikedPage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t } = useI18n();
  const [videos, setVideos] = useState<Video[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showShorts, setShowShorts] = useState<boolean | null>(null);

  const load = useCallback((requestedPage = page) => {
    if (showShorts === null) return;
    if (requestedPage === 0) setLoading(true);
    else setLoadingMore(true);
    api
      .feed({ liked: true, status: "all", shorts: showShorts, all_sources: true, page: requestedPage })
      .then((r) => {
        setVideos((prev) => (requestedPage === 0 ? r.videos : [...prev, ...r.videos]));
        setHasMore(r.videos.length === 40);
      })
      .catch(console.error)
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  }, [page, showShorts]);

  useEffect(() => {
    api
      .settings()
      .then((r) => setShowShorts(r.settings.show_shorts === "1"))
      .catch(() => setShowShorts(false));
  }, []);
  useEffect(load, [load]);

  const toggleShorts = () => {
    setPage(0);
    setVideos([]);
    setShowShorts((prev) => !(prev ?? false));
  };

  return (
    <>
      <PageHeader title={t("navLiked")} />
      <div className="chip-bar liked-filter-bar">
        <Chip
          active={showShorts === true}
          onClick={toggleShorts}
          disabled={showShorts === null}
        >
          <Clapperboard size={13} />
          {t("navShorts")}
        </Chip>
      </div>
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        <EmptyState icon={<ThumbsUp />} title={t("likedEmpty")} />
      ) : (
        <>
          <div className="video-grid">
            {videos.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={() => { setPage(0); load(0); }} />
            ))}
          </div>
          {loadingMore && <VideoGridSkeleton count={4} />}
          {hasMore && !loadingMore && (
            <div className="load-more">
              <Button onClick={() => setPage((p) => p + 1)}>{t("loadMore")}</Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
