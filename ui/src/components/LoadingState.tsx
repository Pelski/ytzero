import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import "./LoadingState.css";
import "./VideoGrid.css";

function useDelayedVisibility(delay: number) {
  const [visible, setVisible] = useState(delay <= 0);

  useEffect(() => {
    if (delay <= 0) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  return visible;
}

export function DelayedPageSkeleton({ delay = 200 }: { delay?: number }) {
  const visible = useDelayedVisibility(delay);
  return visible ? <PageSkeleton /> : null;
}

export function VideoGridSkeleton({
  count = 8,
  gridSize,
  delay = 200,
}: {
  count?: number;
  gridSize?: "sm" | "md" | "lg";
  delay?: number;
}) {
  const { t } = useI18n();
  const visible = useDelayedVisibility(delay);
  if (!visible) return null;
  return (
    <div
      className={`video-grid${gridSize ? ` video-grid--${gridSize}` : ""} skeleton-grid`}
      aria-label={t("loading")}
    >
      {Array.from({ length: count }, (_, i) => (
        <article className="skeleton-video-card" aria-hidden="true" key={i}>
          <div className="skeleton skeleton-thumb">
            <span className="skeleton-duration" />
          </div>
          <div className="skeleton-video-card-body">
            <div className="skeleton skeleton-avatar" />
            <div className="skeleton-video-card-info">
              <div className="skeleton skeleton-line skeleton-line-title" />
              <div className="skeleton skeleton-line skeleton-line-title short" />
              <div className="skeleton-video-card-meta">
                <div className="skeleton skeleton-line skeleton-line-channel" />
                <span className="skeleton-meta-dot" />
                <div className="skeleton skeleton-line skeleton-line-time" />
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ShortsGridSkeleton({ count = 12 }: { count?: number }) {
  const { t } = useI18n();
  return (
    <div className="shorts-grid skeleton-grid" aria-label={t("loading")}>
      {Array.from({ length: count }, (_, i) => (
        <div className="short-card skeleton skeleton-short" aria-hidden="true" key={i} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 3 }: { rows?: number; columns?: number }) {
  const { t } = useI18n();
  return (
    <table className="list-table skeleton-table" aria-label={t("loading")}>
      <tbody>
        {Array.from({ length: rows }, (_, row) => (
          <tr key={row} aria-hidden="true">
            {Array.from({ length: columns }, (_, column) => (
              <td key={column} className={column > 0 ? "shrink" : undefined}>
                <div className={`skeleton skeleton-line${column > 0 ? " skeleton-line-small" : ""}`} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PageSkeleton() {
  const { t } = useI18n();
  return (
    <div className="page-skeleton" role="status" aria-label={t("loading")}>
      <div className="skeleton skeleton-heading" aria-hidden="true" />
      <VideoGridSkeleton count={8} delay={0} />
    </div>
  );
}

export function PlaylistItemsSkeleton({ count = 8 }: { count?: number }) {
  const { t } = useI18n();
  return (
    <div className="playlist-items skeleton-playlist" aria-label={t("loading")}>
      {Array.from({ length: count }, (_, i) => (
        <div className="playlist-item skeleton-playlist-item" aria-hidden="true" key={i}>
          <div className="skeleton skeleton-playlist-num" />
          <div className="skeleton skeleton-playlist-thumb" />
          <div className="playlist-item-info">
            <div className="skeleton skeleton-line skeleton-line-title" />
            <div className="skeleton skeleton-line skeleton-line-meta" />
          </div>
        </div>
      ))}
    </div>
  );
}
