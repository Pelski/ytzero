import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, Inbox, RefreshCw, Sparkles } from "lucide-react";
import { api, type DiscoveryRecommendation, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { useI18n } from "../i18n";
import { GRID_SIZES, persistGridSize, readGridSize, type GridSize } from "../gridSize";

export default function DiscoveryPage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t } = useI18n();
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
      <div className="empty-state">
        <Sparkles />
        <div>{t("discoveryDisabled")}</div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{t("discoveryTitle")}</h1>
        </div>
        <div className="toolbar-right" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button className="btn icon-only" title={t("refresh")} onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? "spin" : undefined} />
          </button>
        </div>
      </div>

      {local.length === 0 ? (
        <div className="empty-state">
          <Inbox />
          <div>{t("discoveryEmpty")}</div>
        </div>
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
            <button className="btn" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={refreshing ? "spin" : undefined} />
              {t("reload")}
            </button>
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
