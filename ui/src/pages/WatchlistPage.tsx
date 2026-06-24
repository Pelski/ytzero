import { useCallback, useEffect, useState } from "react";
import { Clock, Coffee, Sun, X } from "lucide-react";
import { api, type Bucket, type Video } from "../api";
import { emit } from "../events";
import { type Language, bucketLabels, useI18n } from "../i18n";
import { BUCKET_ICONS } from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";

const BUCKET_ORDER: Bucket[] = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];
const BUCKET_ACTION_GROUPS: { label: { en: string; pl: string }; buckets: Bucket[] }[] = [
  { label: { en: "Today", pl: "Dziś" }, buckets: ["today", "tonight"] },
  { label: { en: "Tomorrow", pl: "Jutro" }, buckets: ["tomorrow", "tomorrow_evening"] },
  { label: { en: "Weekend", pl: "Weekend" }, buckets: ["weekend"] },
];
const BUCKET_SECTIONS: { id: string; label: { en: string; pl: string }; Icon: typeof Sun; buckets: Bucket[] }[] = [
  { id: "today", label: { en: "Today", pl: "Dziś" }, Icon: Sun, buckets: ["today", "tonight"] },
  { id: "tomorrow", label: { en: "Tomorrow", pl: "Jutro" }, Icon: Sun, buckets: ["tomorrow", "tomorrow_evening"] },
  { id: "weekend", label: { en: "Weekend", pl: "Weekend" }, Icon: Coffee, buckets: ["weekend"] },
];

function formatShowFrom(showFrom: string, language: Language): string {
  const d = new Date(showFrom);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const locale = language === "pl" ? "pl-PL" : "en-US";
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  if (targetStart.getTime() === todayStart.getTime()) return language === "pl" ? `dziś o ${time}` : `today at ${time}`;
  if (targetStart.getTime() === tomorrowStart.getTime()) return language === "pl" ? `jutro o ${time}` : `tomorrow at ${time}`;

  const weekday = d.toLocaleDateString(locale, { weekday: "long" });
  const date = d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return language === "pl" ? `${weekday}, ${date} o ${time}` : `${weekday}, ${date} at ${time}`;
}

export default function WatchlistPage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t, bucketLabel, language } = useI18n();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

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
      <h1 className="page-title">{t("navWatchlist")}</h1>
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        <div className="empty-state">
          <Clock />
          <div>{t("watchlistEmpty")}</div>
        </div>
      ) : (
        <>
          {sections.map(({ id, label, Icon, items }) => {
            return (
              <section key={id} className="bucket-section">
                <h2 className="bucket-title">
                  <Icon /> {label[language]} <span className="count">{items.length}</span>
                </h2>
                <div className="scheduled-list">
                  {items.map((v) => (
                    <article key={v.video_id} className="scheduled-item">
                      <img src={v.thumbnail} alt="" className="scheduled-thumb" onClick={() => onPlay(v)} />
                      <div className="scheduled-info">
                        <div className="scheduled-title">{v.title}</div>
                        <div className="muted scheduled-channel">{v.channel_title}</div>
                      </div>
                      <div className="muted scheduled-date">
                        {v.show_from ? formatShowFrom(v.show_from, language) : ""}
                      </div>
                      <div className="scheduled-actions">
                        {BUCKET_ACTION_GROUPS.map((group) => (
                          <div
                            key={group.label.en}
                            className={`scheduled-action-block${group.buckets.length === 1 ? " scheduled-action-block--single" : ""}`}
                          >
                            <div className="scheduled-action-label">{group.label[language]}</div>
                            <div className="scheduled-action-group">
                              {group.buckets.map((bucket) => {
                                const Icon = BUCKET_ICONS[bucket];
                                const active = v.bucket === bucket;
                                return (
                                  <button
                                    key={bucket}
                                    className={`icon-btn${active ? " active" : ""}`}
                                    title={active ? bucketLabels[language][bucket] : `${t("moveTo")} ${bucketLabels[language][bucket]}`}
                                    style={active ? { color: "var(--accent)" } : undefined}
                                    onClick={() => api.queue(v.video_id, bucket).then(() => { emit("queue-changed"); load(); })}
                                  >
                                    <Icon size={15} />
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        <button className="icon-btn" title={t("removeFromQueue")} onClick={() => api.dequeue(v.video_id).then(() => { emit("queue-changed"); load(); })}><X size={15} /></button>
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
