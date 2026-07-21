import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownToLine, Check, ChevronDown, HardDrive, LoaderCircle, Pin, PinOff, RotateCw, Trash2 } from "lucide-react";
import { api, type DownloadsResponse, type DownloadItem } from "../api";
import { formatTimeAgo, useI18n, type I18nKey } from "../i18n";
import { img } from "../img";
import { formatVideoDuration } from "../components/VideoCard";
import Popconfirm from "../components/Popconfirm";
import Tooltip from "../components/Tooltip";

const QUEUE_COLLAPSED_COUNT = 3;

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

// downloads timestamps come from SQLite's datetime('now') — UTC without a
// timezone marker, so tag them before handing to the Intl-based formatter.
function utcAgo(sqliteDate: string, language: Parameters<typeof formatTimeAgo>[1]): string {
  return formatTimeAgo(sqliteDate.includes("Z") || sqliteDate.includes("+") ? sqliteDate : `${sqliteDate.replace(" ", "T")}Z`, language);
}

const STATUS_KEYS: Record<string, I18nKey> = {
  queued: "downloadQueued",
  downloading: "downloading",
  done: "downloaded",
  error: "downloadError",
};

const SOURCE_KEYS: Record<string, I18nKey> = {
  manual: "dlSourceManual",
  scheduled: "dlSourceScheduled",
  feed: "dlSourceFeed",
};

export default function DownloadsPage() {
  const { t, language } = useI18n();
  const [data, setData] = useState<DownloadsResponse | null>(null);
  const [queueExpanded, setQueueExpanded] = useState(false);

  const load = useCallback(() => {
    api.downloads().then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll fast while something is moving, lazily otherwise.
  useEffect(() => {
    const activeQueue = data != null && (data.active != null || data.stats.queued > 0);
    const timer = setInterval(load, activeQueue ? 3_000 : 20_000);
    return () => clearInterval(timer);
  }, [load, data?.active != null, data?.stats.queued]);

  const retry = (item: DownloadItem) => {
    api.requestDownload(item.video_id).then(load).catch(() => {});
  };

  const remove = (item: DownloadItem) => {
    setData((prev) => prev ? { ...prev, downloads: prev.downloads.filter((d) => d.video_id !== item.video_id) } : prev);
    api.removeDownload(item.video_id).then(load).catch(() => {});
  };

  const togglePin = (item: DownloadItem) => {
    const pinned = item.pinned !== 1;
    setData((prev) => prev ? {
      ...prev,
      downloads: prev.downloads.map((d) => d.video_id === item.video_id ? { ...d, pinned: pinned ? 1 : 0 } : d),
    } : prev);
    api.pinDownload(item.video_id, pinned).catch(load);
  };

  if (!data) return null;

  const usedFrac = data.stats.cap_bytes > 0 ? Math.min(1, data.stats.bytes / data.stats.cap_bytes) : 0;
  const queueItems = data.downloads.filter((d) => d.status === "downloading" || d.status === "queued" || d.status === "error");
  const doneItems = data.downloads.filter((d) => d.status === "done");
  const visibleQueue = queueExpanded ? queueItems : queueItems.slice(0, QUEUE_COLLAPSED_COUNT);

  const renderRow = (item: DownloadItem) => {
    const progress = data.active?.video_id === item.video_id ? data.active.percent : null;
    return (
      <div key={item.video_id} className={`dl-row dl-row--${item.status}`}>
        <Link to={`/watch/${item.video_id}`} className="dl-thumb" title={item.title}>
          <img src={img(item.thumbnail)} alt="" loading="lazy" />
          {item.duration && <span className="duration-badge">{formatVideoDuration(item.duration)}</span>}
        </Link>
        <div className="dl-info">
          <Link to={`/watch/${item.video_id}`} className="dl-title" title={item.title}>{item.title}</Link>
          <div className="dl-meta">
            <Link to={`/channel/${item.channel_id}`} className="dl-channel">{item.channel_title}</Link>
            <span className={`dl-status dl-status--${item.status}`}>
              {item.status === "downloading" && <LoaderCircle className="spin" size={11} />}
              {item.status === "done" && <Check size={12} />}
              {t(STATUS_KEYS[item.status] ?? "downloadQueued")}
              {progress != null && ` ${Math.floor(progress)}%`}
            </span>
            {item.size_bytes != null && <span>{formatBytes(item.size_bytes)}</span>}
            {item.quality && item.status === "done" && <span>{item.quality === "best" ? "max" : `${item.quality}p`}</span>}
            <span className="dl-source">{t(SOURCE_KEYS[item.source] ?? "dlSourceManual")}</span>
            {item.finished_at && <span>{utcAgo(item.finished_at, language)}</span>}
          </div>
          {item.status === "downloading" && (
            <div className="dl-progress">
              <div className="dl-progress-fill" style={{ width: `${progress ?? 0}%` }} />
            </div>
          )}
          {item.status === "error" && item.error && (
            <div className="dl-error" title={item.error}>{item.error}</div>
          )}
        </div>
        <div className="dl-actions">
          {item.status === "error" && (
            <Tooltip text={t("downloadRetry")}>
              <button className="action-btn" onClick={() => retry(item)}><RotateCw /></button>
            </Tooltip>
          )}
          {item.status === "done" && (
            <Tooltip text={item.pinned === 1 ? t("downloadUnpin") : t("downloadPin")}>
              <button
                className={`action-btn${item.pinned === 1 ? " active" : ""}`}
                onClick={() => togglePin(item)}
              >
                {item.pinned === 1 ? <Pin fill="currentColor" /> : <PinOff />}
              </button>
            </Tooltip>
          )}
          <Popconfirm message={t("downloadRemoveConfirm")} onConfirm={() => remove(item)}>
            <button className="action-btn" title={t("downloadRemove")}><Trash2 /></button>
          </Popconfirm>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="dl-head">
        <h1 className="page-title">{t("downloadsTitle")}</h1>
        <div className="dl-storage">
          <HardDrive size={15} />
          <div className="dl-storage-info">
            <span>
              {formatBytes(data.stats.bytes) || "0 B"} / {formatBytes(data.stats.cap_bytes)}
              {" · "}{data.stats.files} {t("downloadsFiles")}
            </span>
            <div className="dl-storage-bar">
              <div className="dl-storage-fill" style={{ width: `${usedFrac * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {!data.enabled && (
        <div className="dl-alert"><AlertTriangle size={16} /> {t("downloadsDisabled")}</div>
      )}
      {data.enabled && data.ytdlp_version === null && (
        <div className="dl-alert"><AlertTriangle size={16} /> {t("downloadsYtdlpMissing")}</div>
      )}

      {queueItems.length === 0 && doneItems.length === 0 ? (
        <div className="empty-state">
          <ArrowDownToLine />
          <div>{t("downloadsEmpty")}</div>
        </div>
      ) : (
        <>
          {queueItems.length > 0 && (
            <section className="dl-section">
              <div className="dl-section-head">
                <h2>{t("downloadsSectionQueue")}</h2>
                <span className="dl-section-count">{queueItems.length}</span>
              </div>
              <div className="dl-list">
                {visibleQueue.map(renderRow)}
              </div>
              {queueItems.length > QUEUE_COLLAPSED_COUNT && (
                <button className="dl-expand" onClick={() => setQueueExpanded((v) => !v)} aria-expanded={queueExpanded}>
                  <ChevronDown className={`dl-expand-chevron${queueExpanded ? " open" : ""}`} size={15} />
                  {queueExpanded
                    ? t("showLess")
                    : `${t("downloadsShowAll")} (${queueItems.length})`}
                </button>
              )}
            </section>
          )}

          {doneItems.length > 0 && (
            <section className="dl-section">
              <div className="dl-section-head">
                <h2>{t("downloadsSectionDone")}</h2>
                <span className="dl-section-count">{doneItems.length}</span>
              </div>
              <div className="dl-list">
                {doneItems.map(renderRow)}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
