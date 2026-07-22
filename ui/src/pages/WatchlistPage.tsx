import { useCallback, useEffect, useState } from "react";
import "./WatchlistPage.css";
import { Clock, Coffee, Sun, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type Bucket, type Video } from "../api";
import { emit } from "../events";
import { useI18n, type I18nKey } from "../i18n";
import { SchedulePicker } from "../components/VideoScheduleActions";
import { VideoGridSkeleton } from "../components/LoadingState";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { Badge, EmptyState, IconButton, LocalToast, PageHeader, SectionHeader } from "../components/ui";
import { img } from "../img";

const BUCKET_ORDER: Bucket[] = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];
const BUCKET_SECTIONS: { id: string; labelKey: I18nKey; Icon: typeof Sun; buckets: Bucket[] }[] = [
  { id: "today", labelKey: "groupToday", Icon: Sun, buckets: ["today", "tonight"] },
  { id: "tomorrow", labelKey: "groupTomorrow", Icon: Sun, buckets: ["tomorrow", "tomorrow_evening"] },
  { id: "weekend", labelKey: "groupWeekend", Icon: Coffee, buckets: ["weekend"] },
];

type TranslateFn = ReturnType<typeof useI18n>["t"];

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
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleToast, setScheduleToast] = useState<{ videoId: string; id: number } | null>(null);

  const load = useCallback(() => {
    api
      .watchlist()
      .then((r) => setVideos(r.videos))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const sortScheduled = (items: Video[]) =>
    [...items].sort((a, b) => {
      const bucketDiff = BUCKET_ORDER.indexOf(a.bucket!) - BUCKET_ORDER.indexOf(b.bucket!);
      if (bucketDiff !== 0) return bucketDiff;
      return new Date(a.show_from ?? 0).getTime() - new Date(b.show_from ?? 0).getTime();
    });

  const sections = BUCKET_SECTIONS.map((section) => ({
    ...section,
    items: sortScheduled(videos.filter((v) => v.bucket && section.buckets.includes(v.bucket))),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      <PageHeader title={t("navWatchlist")} />
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        <EmptyState icon={<Clock />} title={t("watchlistEmpty")} />
      ) : (
        <>
          {sections.map(({ id, labelKey, Icon, items }) => {
            return (
              <section key={id} className="bucket-section">
                <SectionHeader icon={<Icon />} title={t(labelKey)} actions={<Badge>{items.length}</Badge>} />
                <div className="scheduled-list">
                  {items.map((v) => (
                    <article key={v.video_id} className="scheduled-item">
                      <Link to={`/watch/${v.video_id}`} className="scheduled-thumb-link" aria-label={v.title} title={v.title}>
                        <VideoThumbnail src={img(v.thumbnail)} watched={v.watched === 1} progress={watchProgress(v.watch_position, v.watch_duration)} variant="scheduled" />
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
