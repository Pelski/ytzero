import { useCallback, useEffect, useState } from "react";
import "./WatchlistPage.css";
import { Clock, Coffee, Sun, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type Bucket, type Video } from "../api";
import { emit } from "../events";
import { useI18n, type I18nKey } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { SchedulePicker } from "../components/VideoScheduleActions";
import { formatVideoDuration, parseVideoDurationSeconds } from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { EmptyState, IconButton, LocalToast, PageHeader, SectionHeader, SelectMenu } from "../components/ui";
import { img } from "../img";

const BUCKET_ORDER: Bucket[] = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];
const BUCKET_SECTIONS: { id: string; labelKey: I18nKey; Icon: typeof Sun; buckets: Bucket[] }[] = [
  { id: "today", labelKey: "groupToday", Icon: Sun, buckets: ["today", "tonight"] },
  { id: "tomorrow", labelKey: "groupTomorrow", Icon: Sun, buckets: ["tomorrow", "tomorrow_evening"] },
  { id: "weekend", labelKey: "groupWeekend", Icon: Coffee, buckets: ["weekend"] },
];

type TranslateFn = ReturnType<typeof useI18n>["t"];

const WATCHLIST_SORTS = ["schedule", "duration-asc", "duration-desc", "title-asc", "channel-asc"] as const;
type WatchlistSort = (typeof WATCHLIST_SORTS)[number];

function formatShowFrom(showFrom: string, t: TranslateFn, locale: string): string {
  const d = new Date(showFrom);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  if (targetStart.getTime() === todayStart.getTime()) return t("todayAtTime", { time });
  if (targetStart.getTime() === tomorrowStart.getTime()) return t("tomorrowAtTime", { time });

  const weekday = d.toLocaleDateString(locale, { weekday: "long" });
  const date = d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return t("scheduledAt", { weekday, date, time });
}

export default function WatchlistPage() {
  const { t, bucketLabel, locale } = useI18n();
  useDocumentTitle(t("navWatchlist"));
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleToast, setScheduleToast] = useState<{ videoId: string; id: number } | null>(null);
  const [sort, setSort] = useState<WatchlistSort>(() => {
    const stored = sessionStorage.getItem("watchlistSort") as WatchlistSort | null;
    return stored && WATCHLIST_SORTS.includes(stored) ? stored : "schedule";
  });

  const load = useCallback(() => {
    api
      .watchlist()
      .then((r) => setVideos(r.videos))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const bySchedule = (a: Video, b: Video) => {
    const bucketDiff = BUCKET_ORDER.indexOf(a.bucket!) - BUCKET_ORDER.indexOf(b.bucket!);
    if (bucketDiff !== 0) return bucketDiff;
    return new Date(a.show_from ?? 0).getTime() - new Date(b.show_from ?? 0).getTime();
  };
  // Videos without a known duration sort to the end in both directions.
  const byDuration = (direction: 1 | -1) => (a: Video, b: Video) => {
    const da = parseVideoDurationSeconds(a.duration);
    const db = parseVideoDurationSeconds(b.duration);
    if (da == null && db == null) return bySchedule(a, b);
    if (da == null) return 1;
    if (db == null) return -1;
    return (da - db) * direction;
  };
  const COMPARATORS: Record<WatchlistSort, (a: Video, b: Video) => number> = {
    schedule: bySchedule,
    "duration-asc": byDuration(1),
    "duration-desc": byDuration(-1),
    "title-asc": (a, b) => a.title.localeCompare(b.title, locale),
    "channel-asc": (a, b) => (a.channel_title ?? "").localeCompare(b.channel_title ?? "", locale),
  };
  const sortScheduled = (items: Video[]) => [...items].sort(COMPARATORS[sort]);

  const sections = BUCKET_SECTIONS.map((section) => ({
    ...section,
    items: sortScheduled(videos.filter((v) => v.bucket && section.buckets.includes(v.bucket))),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      <PageHeader
        title={t("navWatchlist")}
        actions={videos.length > 0 && (
          <SelectMenu
            value={sort}
            label={t("watchlistSort")}
            options={[
              { value: "schedule", label: t("watchlistSortSchedule") },
              { value: "duration-asc", label: t("watchlistSortShortest") },
              { value: "duration-desc", label: t("watchlistSortLongest") },
              { value: "title-asc", label: t("watchlistSortTitle") },
              { value: "channel-asc", label: t("watchlistSortChannel") },
            ] as const}
            onChange={(next: WatchlistSort) => {
              setSort(next);
              sessionStorage.setItem("watchlistSort", next);
            }}
          />
        )}
      />
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        <EmptyState icon={<Clock />} title={t("watchlistEmpty")} />
      ) : (
        <>
          {sections.map(({ id, labelKey, Icon, items }) => {
            return (
              <section key={id} className="bucket-section">
                <SectionHeader icon={<Icon />} title={t(labelKey)} />
                <div className="scheduled-list">
                  {items.map((v) => (
                    <article key={v.video_id} className="scheduled-item">
                      <Link to={`/watch/${v.video_id}`} className="scheduled-thumb-link" aria-label={v.title} title={v.title}>
                        <VideoThumbnail src={img(v.thumbnail)} watched={v.watched === 1} progress={watchProgress(v.watch_position, v.watch_duration)} variant="scheduled">
                          {v.duration && v.is_short !== 1 && <span className="duration-badge">{formatVideoDuration(v.duration)}</span>}
                        </VideoThumbnail>
                      </Link>
                      <div className="scheduled-info">
                        <Link to={`/watch/${v.video_id}`} className="scheduled-title" title={v.title}>{v.title}</Link>
                        <div className="muted scheduled-channel">{v.channel_title}</div>
                      </div>
                      <div className="muted scheduled-date">
                        {v.show_from ? formatShowFrom(v.show_from, t, locale) : ""}
                      </div>
                      <div className="scheduled-actions">
                        <SchedulePicker
                          layout="inline"
                          activeBucket={v.bucket}
                          onSelect={(bucket) => api.queue(v.video_id, bucket)
                            .then(() => { emit("queue-changed"); setScheduleToast({ videoId: v.video_id, id: Date.now() }); load(); })
                            .catch(console.error)}
                        />
                        <IconButton label={t("removeFromQueue")} onClick={() => api.dequeue(v.video_id).then(() => { emit("queue-changed"); load(); }).catch(console.error)}><X size={15} /></IconButton>
                        {scheduleToast?.videoId === v.video_id && <LocalToast key={scheduleToast.id}>{t("scheduledFeedback")}</LocalToast>}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
