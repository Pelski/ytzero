import { useI18n } from "../i18n";

export function VideoGridSkeleton({
  count = 8,
  gridSize,
}: {
  count?: number;
  gridSize?: "sm" | "md" | "lg";
}) {
  const { t } = useI18n();
  return (
    <div
      className={`video-grid${gridSize ? ` video-grid--${gridSize}` : ""} skeleton-grid`}
      aria-label={t("loading")}
    >
      {Array.from({ length: count }, (_, i) => (
        <div className="video-card skeleton-card" aria-hidden="true" key={i}>
          <div className="skeleton skeleton-thumb" />
          <div className="card-body">
            <div className="skeleton skeleton-avatar" />
            <div className="card-info">
              <div className="skeleton skeleton-line skeleton-line-title" />
              <div className="skeleton skeleton-line skeleton-line-title short" />
              <div className="skeleton skeleton-line skeleton-line-meta" />
            </div>
          </div>
        </div>
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
  return (
    <div className="page-skeleton" aria-hidden="true">
      <div className="skeleton skeleton-heading" />
      <VideoGridSkeleton count={8} />
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
