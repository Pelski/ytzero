import { useCallback, useEffect, useState } from "react";
import "./DownloadsPage.css";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, Download, HardDrive, LoaderCircle, Pin, PinOff, RotateCw, Settings2, Sparkles, Square, Trash2 } from "lucide-react";
import { api, type DownloadsResponse, type DownloadItem } from "../api";
import { formatTimeAgo, useI18n, type I18nKey } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { img } from "../img";
import { formatVideoDuration } from "../components/VideoCard";
import Popconfirm from "../components/Popconfirm";
import Tooltip from "../components/Tooltip";
import { Alert, Badge, Button, EmptyState, PageHeader, SectionHeader, Switch, Tabs } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import { subscribeServerEvent } from "../serverEvents";
import DownloadAutomation from "../components/DownloadAutomation";
import DownloadConfiguration from "../components/DownloadConfiguration";
import { PageSkeleton } from "../components/LoadingState";

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
  const [searchParams, setSearchParams] = useSearchParams();
  useDocumentTitle(t("downloadsTitle"));
  const [data, setData] = useState<DownloadsResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [cancellingQueue, setCancellingQueue] = useState(false);
  const [showAllProfiles, setShowAllProfiles] = useState(false);
  const requestedView = searchParams.get("view");
  const [view, setViewState] = useState<"library" | "automation" | "configuration">(requestedView === "automation" || requestedView === "configuration" ? requestedView : "library");
  const setView = (next: "library" | "automation" | "configuration") => {
    setViewState(next);
    setSearchParams(next === "library" ? {} : { view: next }, { replace: true });
  };

  const load = useCallback(() => {
    setLoadError("");
    api.downloads(showAllProfiles ? "all" : "mine")
      .then(setData)
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, [showAllProfiles]);

  useEffect(() => {
    load();
    return subscribeServerEvent("downloads", load);
  }, [load]);

  const retry = (item: DownloadItem) => {
    api.requestDownload(item.video_id).then(load).catch(() => {});
  };

  const remove = (item: DownloadItem) => {
    setData((prev) => prev ? { ...prev, downloads: prev.downloads.filter((d) => d.video_id !== item.video_id || d.user_id !== item.user_id) } : prev);
    api.removeDownload(item.video_id, data?.scope === "all" ? item.user_id : undefined).then(load).catch(() => {});
  };

  const togglePin = (item: DownloadItem) => {
    const pinned = item.pinned !== 1;
    setData((prev) => prev ? {
      ...prev,
      downloads: prev.downloads.map((d) => d.video_id === item.video_id && d.user_id === item.user_id ? { ...d, pinned: pinned ? 1 : 0 } : d),
    } : prev);
    api.pinDownload(item.video_id, pinned, data?.scope === "all" ? item.user_id : undefined).catch(load);
  };

  const cancelQueue = () => {
    setCancellingQueue(true);
    setData((previous) => previous ? {
      ...previous,
      active: null,
      downloads: previous.downloads.filter((item) => item.status === "done"),
    } : previous);
    api.cancelDownloadQueue().then(load).catch(load).finally(() => setCancellingQueue(false));
  };

  if (!data) return loadError ? (
    <EmptyState
      icon={<AlertTriangle />}
      title={loadError}
      action={<Button onClick={load} leadingIcon={<RotateCw />}>{t("refresh")}</Button>}
    />
  ) : <PageSkeleton />;

  const usedFrac = data.stats.cap_bytes > 0 ? Math.min(1, data.stats.bytes / data.stats.cap_bytes) : 0;
  const queueItems = data.downloads.filter((d) => d.status === "downloading" || d.status === "queued" || d.status === "error");
  const doneItems = data.downloads.filter((d) => d.status === "done");
  const visibleQueue = queueExpanded ? queueItems : queueItems.slice(0, QUEUE_COLLAPSED_COUNT);

  const renderRow = (item: DownloadItem) => {
    const progress = data.active?.video_id === item.video_id ? data.active.percent : null;
    return (
      <div key={`${item.user_id}:${item.video_id}`} className={`dl-row dl-row--${item.status}`}>
        <Link to={`/watch/${item.video_id}`} className="dl-thumb" title={item.title}>
          <img src={img(item.thumbnail)} alt="" loading="lazy" />
          {item.duration && <span className="duration-badge">{formatVideoDuration(item.duration)}</span>}
        </Link>
        <div className="dl-info">
          <Link to={`/watch/${item.video_id}`} className="dl-title" title={item.title}>{item.title}</Link>
          <div className="dl-meta">
            {data.scope === "all" && <span className="dl-profile"><i style={{ background: item.profile_color }} />{item.profile_name}</span>}
            <Link to={`/channel/${item.channel_id}`} className="dl-channel">{item.channel_title}</Link>
            <span className={`dl-status dl-status--${item.status}`}>
              {item.status === "downloading" && <LoaderCircle className="spin" size={11} />}
              {item.status === "done" && <Check size={12} />}
              {t(STATUS_KEYS[item.status] ?? "downloadQueued")}
              {progress != null && ` ${Math.floor(progress)}%`}
            </span>
            {item.size_bytes != null && <span>{formatBytes(item.size_bytes)}</span>}
            {item.quality && item.status === "done" && <span>{item.quality === "best" ? "max" : `${item.quality}p`}</span>}
            <span className="dl-source" title={item.automation_rule_name ?? undefined}>
              {t(SOURCE_KEYS[item.source] ?? "dlSourceManual")}
              {item.automation_rule_name && ` · ${item.automation_rule_name}`}
            </span>
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
      <PageHeader title={t("downloadsTitle")} actions={<div className="dl-header-actions">
        {data.can_view_all && <Switch
          label={language === "pl" ? "Wszystkie profile" : language === "de" ? "Alle Profile" : "All profiles"}
          checked={showAllProfiles}
          onCheckedChange={setShowAllProfiles}
        />}
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
      </div>} />

      <Tabs
        variant="subtle"
        className="dl-page-tabs"
        label={t("downloadsTitle")}
        value={view}
        onChange={setView}
        options={[
          { value: "library", label: language === "pl" ? "Biblioteka" : language === "de" ? "Bibliothek" : "Library", icon: <Download /> },
          { value: "automation", label: language === "pl" ? "Automatyzacja" : language === "de" ? "Automatisierung" : "Automation", icon: <Sparkles /> },
          { value: "configuration", label: language === "pl" ? "Konfiguracja" : language === "de" ? "Konfiguration" : "Configuration", icon: <Settings2 /> },
        ]}
      />

      {!data.enabled && (
        <Alert className="dl-alert-layout" variant="warning" icon={<AlertTriangle />}>{t("downloadsDisabled")}</Alert>
      )}
      {data.enabled && data.ytdlp_version === null && (
        <Alert className="dl-alert-layout" variant="warning" icon={<AlertTriangle />}>{t("downloadsYtdlpMissing")}</Alert>
      )}
      {data.enabled && data.ytdlp_version !== null && data.ytdlp_js_runtime_version === null && (
        <Alert className="dl-alert-layout" variant="warning" icon={<AlertTriangle />}>{t("downloadsYtdlpJsRuntimeMissing")}</Alert>
      )}

      {view === "automation" && <DownloadAutomation />}
      {view === "configuration" && <DownloadConfiguration />}
      {view === "library" && (queueItems.length === 0 && doneItems.length === 0 ? (
        <EmptyState art={<EmptyArt scene="noDownloads" />} title={t("downloadsEmptyTitle")} description={t("downloadsEmpty")} />
      ) : (
        <>
          {queueItems.length > 0 && (
            <section className="dl-section">
              <SectionHeader title={t("downloadsSectionQueue")} actions={<div className="dl-queue-actions"><Badge>{queueItems.length}</Badge>{data.scope === "mine" && <Popconfirm message={t("downloadsCancelAllConfirm")} confirmLabel={t("downloadsCancelAll")} onConfirm={cancelQueue}><Button size="sm" variant="danger" disabled={cancellingQueue} leadingIcon={<Square />}>{cancellingQueue ? t("downloadsCancellingAll") : t("downloadsCancelAll")}</Button></Popconfirm>}</div>} />
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
              <SectionHeader title={t("downloadsSectionDone")} actions={<Badge>{doneItems.length}</Badge>} />
              <div className="dl-list">
                {doneItems.map(renderRow)}
              </div>
            </section>
          )}
        </>
      ))}
    </>
  );
}
