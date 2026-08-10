import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { Button, EmptyState, PageHeader, SectionHeader } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import { appDayKey, calendarDayDifference, formatCalendarDay } from "../dateTime";
import type { PlayVideo, PlaybackQueueContext } from "../playbackQueue";
import "./HistoryPage.css";

export default function HistoryPage({ onPlay, allowHistoryDeletion }: { onPlay: PlayVideo; allowHistoryDeletion: boolean }) {
  const { t, locale, timeZone } = useI18n();
  useDocumentTitle(t("historyTitle"));
  const [videos, setVideos] = useState<Video[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const loadingMoreRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const load = useCallback((requestedPage: number) => {
    if (requestedPage > 0 && loadingMoreRef.current) return;
    const generation = requestedPage === 0 ? ++loadGenerationRef.current : loadGenerationRef.current;
    if (requestedPage === 0) setLoading(true);
    else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    api
      .history(requestedPage)
      .then((r) => {
        if (generation !== loadGenerationRef.current) return;
        setVideos((prev) => (requestedPage === 0 ? r.videos : [...prev, ...r.videos]));
        setHasMore(r.has_more);
        setLoading(false);
      })
      .catch(console.error)
      .finally(() => {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      });
  }, []);

  useEffect(() => { load(0); }, [load]);

  useEffect(() => {
    if (page === 0) return;
    load(page);
  }, [page, load]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingMoreRef.current) setPage((current) => current + 1);
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, videos]);

  const refresh = useCallback(() => {
    setPage(0);
    load(0);
  }, [load]);

  const groups = videos.reduce<{ key: string; videos: Video[] }[]>((result, video) => {
    const key = video.watched_at ? appDayKey(video.watched_at, timeZone) : "";
    const last = result[result.length - 1];
    if (last?.key === key) last.videos.push(video);
    else result.push({ key, videos: [video] });
    return result;
  }, []);
  const playbackQueue: PlaybackQueueContext = { version: 1, kind: "history" };

  const groupLabel = (day: string) => {
    const today = appDayKey(new Date(), timeZone);
    const daysAgo = calendarDayDifference(today, day);
    if (daysAgo === 0) return t("historyToday");
    if (daysAgo === 1) return t("historyYesterday");
    if (daysAgo === 2) return t("historyDayBeforeYesterday");
    const date = formatCalendarDay(day, locale, { day: "numeric", month: "long", year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" });
    return `${t("historyDaysAgo", { days: daysAgo })} · ${date}`;
  };

  return (
    <>
      <PageHeader title={t("historyTitle")} />
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        <EmptyState art={<EmptyArt scene="noHistory" />} title={t("historyEmpty")} description={t("historyEmptyHint")} />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.key} className="history-day-section">
              <SectionHeader title={groupLabel(group.key)} />
              <div className="video-grid">
                {group.videos.map((v) => (
                  <VideoCard
                    key={`${v.history_id ?? v.video_id}`}
                    video={v}
                    onPlay={(video) => onPlay(video, playbackQueue)}
                    onChanged={refresh}
                    onRemoveFromHistory={allowHistoryDeletion ? api.removeFromHistory : undefined}
                    showWatchProgress
                  />
                ))}
              </div>
            </section>
          ))}
          {loadingMore && <VideoGridSkeleton count={4} />}
          {hasMore && !loadingMore && (
            <div className="load-more">
              <Button ref={loadMoreRef} onClick={() => setPage((p) => p + 1)}>{t("loadMore")}</Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
