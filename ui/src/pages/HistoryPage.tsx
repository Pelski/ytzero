import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { Button, EmptyState, PageHeader, SectionHeader } from "../components/ui";

function historyDayKey(value: string) {
  const date = new Date(value.replace(" ", "T"));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export default function HistoryPage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t, locale } = useI18n();
  const [videos, setVideos] = useState<Video[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback((requestedPage = page) => {
    if (requestedPage === 0) setLoading(true);
    else setLoadingMore(true);
    api
      .history(requestedPage)
      .then((r) => {
        setVideos((prev) => (requestedPage === 0 ? r.videos : [...prev, ...r.videos]));
        setHasMore(r.videos.length === 40);
      })
      .catch(console.error)
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  }, [page]);

  useEffect(load, [load]);

  const groups = videos.reduce<{ key: number; videos: Video[] }[]>((result, video) => {
    const key = video.watched_at ? historyDayKey(video.watched_at) : 0;
    const last = result[result.length - 1];
    if (last?.key === key) last.videos.push(video);
    else result.push({ key, videos: [video] });
    return result;
  }, []);

  const groupLabel = (day: number) => {
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const daysAgo = Math.round((startToday - day) / 86_400_000);
    if (daysAgo === 0) return t("historyToday");
    if (daysAgo === 1) return t("historyYesterday");
    if (daysAgo === 2) return t("historyDayBeforeYesterday");
    const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: new Date(day).getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(new Date(day));
    return `${t("historyDaysAgo", { days: daysAgo })} · ${date}`;
  };

  return (
    <>
      <PageHeader title={t("historyTitle")} />
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        <EmptyState icon={<History />} title={t("historyEmpty")} />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.key} className="history-day-section">
              <SectionHeader title={groupLabel(group.key)} />
              <div className="video-grid">
                {group.videos.map((v) => (
                  <VideoCard key={`${v.history_id ?? v.video_id}`} video={v} onPlay={onPlay} onChanged={() => { setPage(0); load(0); }} showWatchProgress />
                ))}
              </div>
            </section>
          ))}
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
