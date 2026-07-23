import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, Inbox, RefreshCw, Sparkles } from "lucide-react";
import { api, type DiscoveryRecommendation, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { GRID_SIZES, persistGridSize, readGridSize, type GridSize } from "../gridSize";
import { Button, EmptyState, IconButton, PageHeader } from "../components/ui";

export default function DiscoveryPage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t } = useI18n();
  useDocumentTitle(t("discoveryTitle"));
  const [recommendations, setRecommendations] = useState<DiscoveryRecommendation[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [gridSize, setGridSize] = useState<GridSize>(readGridSize);

  const load = useCallback(async (refresh = false) => {
    const r = await api.discoveryRecommendations(refresh);
    setEnabled(r.enabled);
    setRecommendations(r.recommendations);
  }, []);

  useEffect(() => {
    load().catch(console.error).finally(() => setLoading(false));
  }, [load]);

  const local = useMemo(() => recommendations.filter((r): r is Extract<DiscoveryRecommendation, { kind: "local" }> => r.kind === "local"), [recommendations]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };

  const changeGridSize = (size: GridSize) => {
    setGridSize(size);
    persistGridSize(size);
  };

  const dismiss = async (videoId: string) => {
    await api.dismissDiscoveryRecommendation(videoId);
    setRecommendations((current) => current.filter((r) => {
      const id = r.kind === "local" ? r.video.video_id : r.result.videoId;
      return id !== videoId;
    }));
  };

  if (loading) return <VideoGridSkeleton gridSize={gridSize} />;

  if (!enabled) {
    return (
      <EmptyState icon={<Sparkles />} title={t("discoveryDisabled")} />
    );
  }

  return (
    <>
      <PageHeader title={t("discoveryTitle")} actions={<IconButton label={t("refresh")} icon={<RefreshCw className={refreshing ? "spin" : undefined} />} onClick={refresh} disabled={refreshing} />} />

      {local.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t("discoveryEmpty")} />
      ) : null}

      {local.length > 0 && (
        <section className="discovery-section">
          <div className={`video-grid video-grid--${gridSize}`}>
            {local.map((r) => (
              <div className="recommendation-card" key={r.video.video_id}>
                <VideoCard video={r.video} onPlay={onPlay} onChanged={() => dismiss(r.video.video_id)} />
                <div className="recommendation-meta">
                  <button className="recommendation-reason-btn" aria-label={t("recommendationWhy")}>
                    <Info />
                  </button>
                  <div className="recommendation-popover">
                    <div>{t("recommendationScore")}: {Math.round(r.score)}</div>
                    <div>{r.reasons.map((reason) => tReason(t, reason)).join(" · ")}</div>
                    {r.query && <div>{t("discoveryQuery")}: {r.query}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="load-more">
            <Button onClick={refresh} disabled={refreshing} leadingIcon={<RefreshCw className={refreshing ? "spin" : undefined} />}>{t("reload")}</Button>
          </div>
        </section>
      )}
    </>
  );
}

function tReason(t: (key: any, params?: Record<string, string | number>) => string, reason: string) {
  const key = `reason_${reason.replace(/ /g, "_").replace(/-/g, "_")}`;
  return t(key as any);
}
