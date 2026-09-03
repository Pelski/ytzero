import { useCallback, useEffect, useState } from "react";
import "./DownloadsPage.css";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, Download, Folder, HardDrive, LoaderCircle, Pin, PinOff, RotateCw, Settings2, Sparkles, Square, Trash2 } from "lucide-react";
import { api, type DownloadsResponse, type DownloadItem } from "../api";
import { formatTimeAgo, useI18n, type I18nKey } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { img } from "../img";
import { formatVideoDuration } from "../components/VideoCard";
import Popconfirm from "../components/Popconfirm";
import Tooltip from "../components/Tooltip";
import { Alert, Badge, Button, Chip, EmptyState, IconButton, Input, PageHeader, RevealRegion, SectionHeader, Switch, Tabs } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import { PlaylistIcon } from "../components/PlaylistIcon";
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

export default function DownloadsPage({ shortsEnabled }: { shortsEnabled: boolean }) {
  const { t, language } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  useDocumentTitle(t("downloadsTitle"));
  const [data, setData] = useState<DownloadsResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [cancellingQueue, setCancellingQueue] = useState(false);
  const [showAllProfiles, setShowAllProfiles] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState<"all" | "kept">("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [expandedPlaylists, setExpandedPlaylists] = useState<Set<string>>(() => new Set());
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
  const visibleDownloads = data.downloads.filter((item) => shortsEnabled || item.is_short !== 1);
  const queueItems = visibleDownloads.filter((d) => d.status === "downloading" || d.status === "queued" || d.status === "error");
  const doneItems = visibleDownloads.filter((d) => d.status === "done");
  const normalizedQuery = libraryQuery.trim().toLocaleLowerCase(language);
  const matchingDoneItems = doneItems.filter((item) => !normalizedQuery
    || item.title.toLocaleLowerCase(language).includes(normalizedQuery)
    || item.channel_title.toLocaleLowerCase(language).includes(normalizedQuery)
    || item.playlists.some((playlist) => playlist.name.toLocaleLowerCase(language).includes(normalizedQuery)));
  const keptItems = matchingDoneItems.filter((item) => item.pinned === 1 || item.playlist_protected === 1);
  const displayedDoneItems = libraryFilter === "kept" ? keptItems : matchingDoneItems;
  const keptGroups = libraryFilter === "kept" ? (() => {
    const groups = new Map<string, { id: number | string | null; name: string; icon: string; items: DownloadItem[] }>();
    for (const item of keptItems) {
      const playlists = item.playlists.length > 0 ? item.playlists : [{ id: null, name: t("downloadsWithoutPlaylist"), icon: "", protects_download: 0 }];
      for (const playlist of playlists) {
        const key = playlist.id == null ? "none" : String(playlist.id);
        const group = groups.get(key) ?? { id: playlist.id, name: playlist.name, icon: playlist.icon, items: [] };
        group.items.push(item);
        groups.set(key, group);
      }
    }
    return [...groups.values()];
  })() : [];
  const visibleQueue = queueExpanded ? queueItems : queueItems.slice(0, QUEUE_COLLAPSED_COUNT);

  const togglePlaylist = (key: string) => {
    setExpandedPlaylists((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderRow = (item: DownloadItem, keyPrefix = "") => {
    const progress = data.active?.video_id === item.video_id ? data.active.percent : null;
    return (
      <div key={`${keyPrefix}${item.user_id}:${item.video_id}`} className={`dl-row dl-row--${item.status}`}>
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
            {item.playlist_protected === 1 && <Badge size="sm" variant="accent">{t("downloadProtectedByPlaylist")}</Badge>}
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
              <IconButton label={t("downloadRetry")} onClick={() => retry(item)}><RotateCw /></IconButton>
            </Tooltip>
          )}
          {item.status === "done" && (
            <Tooltip text={item.pinned === 1 ? t("downloadUnpin") : t("downloadPin")}>
              <IconButton
                label={item.pinned === 1 ? t("downloadUnpin") : t("downloadPin")}
                variant={item.pinned === 1 ? "secondary" : "ghost"}
                onClick={() => togglePin(item)}
              >
                {item.pinned === 1 ? <Pin fill="currentColor" /> : <PinOff />}
              </IconButton>
            </Tooltip>
          )}
          <Popconfirm message={t("downloadRemoveConfirm")} onConfirm={() => remove(item)}>
            <IconButton label={t("downloadRemove")} variant="danger"><Trash2 /></IconButton>
          </Popconfirm>
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader title={t("downloadsTitle")} actions={<div className="dl-header-actions">
        {data.can_view_all && <Switch
          label={t("All profiles")}
          checked={showAllProfiles}
          onCheckedChange={setShowAllProfiles}
        />}
        <div className="dl-storage">
          <HardDrive size={15} />
          <div className="dl-storage-info">
            <span>
              {formatBytes(data.stats.bytes) || "0 B"} / {formatBytes(data.stats.cap_bytes)}
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
          { value: "library", label: t("Library"), icon: <Download /> },
          { value: "automation", label: t("Automation"), icon: <Sparkles /> },
          { value: "configuration", label: t("Configuration"), icon: <Settings2 /> },
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

      {view === "automation" && <DownloadAutomation shortsEnabled={shortsEnabled} />}
      {view === "configuration" && <DownloadConfiguration shortsEnabled={shortsEnabled} />}
      {view === "library" && (queueItems.length === 0 && doneItems.length === 0 ? (
        <EmptyState art={<EmptyArt scene="noDownloads" />} title={t("downloadsEmptyTitle")} description={t("downloadsEmpty")} />
      ) : (
        <>
          {queueItems.length > 0 && (
            <section className="dl-section">
              <SectionHeader title={t("downloadsSectionQueue")} actions={data.scope === "mine" && <Popconfirm message={t("downloadsCancelAllConfirm")} confirmLabel={t("downloadsCancelAll")} onConfirm={cancelQueue}><Button size="sm" variant="danger" disabled={cancellingQueue} leadingIcon={<Square />}>{cancellingQueue ? t("downloadsCancellingAll") : t("downloadsCancelAll")}</Button></Popconfirm>} />
              <div className="dl-list">
                {visibleQueue.map((item) => renderRow(item))}
              </div>
              {queueItems.length > QUEUE_COLLAPSED_COUNT && (
                <Button variant="ghost" className="dl-expand" onClick={() => setQueueExpanded((v) => !v)} aria-expanded={queueExpanded}>
                  <ChevronDown className={`dl-expand-chevron${queueExpanded ? " open" : ""}`} size={15} />
                  {queueExpanded
                    ? t("showLess")
                    : t("downloadsShowAll")}
                </Button>
              )}
            </section>
          )}

          {doneItems.length > 0 && (
            <section className="dl-section">
              <SectionHeader title={t("downloadsSectionDone")} />
              <div className="dl-library-tools">
                <div className="dl-library-filters" aria-label={t("downloadsLibraryFilter")}>
                  <Chip active={libraryFilter === "all"} onClick={() => setLibraryFilter("all")}>{t("downloadsAll")}</Chip>
                  <Chip active={libraryFilter === "kept"} onClick={() => setLibraryFilter("kept")}>{t("downloadsKept")}</Chip>
                </div>
                <Input size="sm" className="dl-library-search" aria-label={t("downloadsSearch")} placeholder={t("downloadsSearch")} value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} />
              </div>
              {displayedDoneItems.length === 0 ? (
                <EmptyState compact icon={<Pin />} title={t(libraryFilter === "kept" ? "downloadsNoKept" : "downloadsNoMatches")} />
              ) : libraryFilter === "kept" ? keptGroups.map((group) => {
                const groupKey = group.id == null ? "none" : String(group.id);
                const expanded = normalizedQuery.length > 0 || expandedPlaylists.has(groupKey);
                return (
                  <section className="dl-folder" key={groupKey}>
                    <Button
                      variant="ghost"
                      className="dl-folder-toggle"
                      leadingIcon={group.id == null ? <Folder /> : <PlaylistIcon icon={group.icon} />}
                      trailingIcon={<ChevronDown className={`dl-folder-chevron${expanded ? " open" : ""}`} />}
                      aria-expanded={expanded}
                      onClick={() => togglePlaylist(groupKey)}
                    >
                      <span className="dl-folder-name">{group.name}</span>
                    </Button>
                    <RevealRegion open={expanded}>
                      <div className="dl-list dl-folder-content">{group.items.map((item) => renderRow(item, `${groupKey}:`))}</div>
                    </RevealRegion>
                  </section>
                );
              }) : <div className="dl-list">{displayedDoneItems.map((item) => renderRow(item))}</div>}
            </section>
          )}
        </>
      ))}
    </>
  );
}
