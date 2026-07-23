import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2, Clock, FileArchive, FileText, FolderUp, History, ListMusic,
  LoaderCircle, Plus, ScanSearch, Tv, X,
} from "lucide-react";
import "./ImportPage.css";
import { api, type ImportCommitResult, type ImportManifest } from "../api";
import { emit } from "../events";
import { formatChannelCount, formatHistoryEntryCount, formatPlaylistCount, formatVideoCount, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import {
  Alert, Badge, Button, Checkbox, Inline, Input, PageHeader, SectionHeader,
  SegmentedControl, SettingsSection, Stack, Switch, Text,
} from "../components/ui";

function defaultHistoryFrom(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

export default function ImportPage({ showToast }: { showToast: (msg: string) => void }) {
  const { t, language } = useI18n();
  useDocumentTitle(t("importTakeout"));
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [manifest, setManifest] = useState<ImportManifest | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportCommitResult | null>(null);

  const [channelsEnabled, setChannelsEnabled] = useState(true);
  const [excludedChannels, setExcludedChannels] = useState<Set<string>>(new Set());
  const [channelQuery, setChannelQuery] = useState("");
  const [playlistsEnabled, setPlaylistsEnabled] = useState(true);
  const [excludedPlaylists, setExcludedPlaylists] = useState<Set<string>>(new Set());
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [historyMode, setHistoryMode] = useState<"since" | "all">("since");
  const [historyFrom, setHistoryFrom] = useState(defaultHistoryFrom);

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    setPendingFiles((prev) => {
      const known = new Set(prev.map(fileKey));
      return [...prev, ...files.filter((f) => !known.has(fileKey(f)))];
    });
  };

  const removeFile = (key: string) => {
    setPendingFiles((prev) => prev.filter((f) => fileKey(f) !== key));
  };

  const analyze = async () => {
    if (pendingFiles.length === 0 || analyzing) return;
    setAnalyzing(true);
    try {
      const m = await api.importAnalyze(pendingFiles);
      setManifest(m);
      // Keep the default cutoff inside the export's actual range, otherwise
      // the estimate starts at 0 and looks broken.
      setHistoryFrom((prev) => {
        const from = m.history.from?.slice(0, 10);
        const to = m.history.to?.slice(0, 10);
        if (to && prev > to) return from ?? prev;
        if (from && prev < from) return from;
        return prev;
      });
      setChannelsEnabled(m.channels.length > 0);
      setPlaylistsEnabled(m.playlists.length > 0);
      setHistoryEnabled(m.history.total > 0);
      setExcludedChannels(new Set());
      setExcludedPlaylists(new Set());
      setResult(null);
      setPendingFiles([]);
    } catch (e) {
      showToast(`${t("importError")}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredChannels = useMemo(() => {
    if (!manifest) return [];
    const q = channelQuery.trim().toLowerCase();
    if (!q) return manifest.channels;
    return manifest.channels.filter((ch) => ch.title.toLowerCase().includes(q) || ch.channelId.toLowerCase().includes(q));
  }, [manifest, channelQuery]);

  const selectedChannelCount = manifest ? manifest.channels.length - excludedChannels.size : 0;
  const selectedPlaylists = manifest ? manifest.playlists.filter((p) => !excludedPlaylists.has(p.name)) : [];
  const selectedPlaylistVideoCount = selectedPlaylists.reduce((n, p) => n + p.videoCount, 0);

  // Month-granular estimate from the histogram; the exact cutoff is applied
  // server-side on commit.
  const historyEstimate = useMemo(() => {
    if (!manifest) return 0;
    if (historyMode === "all") return manifest.history.total;
    const fromMonth = historyFrom.slice(0, 7);
    return manifest.history.months.filter((m) => m.month >= fromMonth).reduce((n, m) => n + m.count, 0);
  }, [manifest, historyMode, historyFrom]);

  const anythingSelected =
    (channelsEnabled && selectedChannelCount > 0)
    || (playlistsEnabled && selectedPlaylists.length > 0)
    || (historyEnabled && historyEstimate > 0);

  const commit = async () => {
    if (!manifest || committing) return;
    setCommitting(true);
    try {
      const r = await api.importCommit({
        sessionId: manifest.sessionId,
        channels: { enabled: channelsEnabled && selectedChannelCount > 0, excludedIds: [...excludedChannels] },
        playlists: { enabled: playlistsEnabled && selectedPlaylists.length > 0, excludedNames: [...excludedPlaylists] },
        history: { enabled: historyEnabled, from: historyMode === "since" ? historyFrom : null },
      });
      setResult(r);
      setManifest(null);
      if (r.channelsAdded > 0) emit("channels-changed");
      if (r.playlistsCreated > 0 || r.playlistVideosAdded > 0) emit("playlists-changed");
    } catch (e) {
      showToast(`${t("importError")}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCommitting(false);
    }
  };

  const toggleSet = (set: Set<string>, key: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    update(next);
  };

  const reset = () => {
    setManifest(null);
    setResult(null);
    setChannelQuery("");
    setPendingFiles([]);
  };

  // Enrichment and channel refresh run in parallel schedulers, so the wait is
  // whichever finishes last.
  const estimateMin = result?.background
    ? Math.max(result.background.enrichEstimateMin, result.background.channelRefreshEstimateMin)
    : 0;
  const estimateLabel = estimateMin >= 60
    ? t("importEstimateHours", { h: Math.floor(estimateMin / 60), m: estimateMin % 60 })
    : t("importEstimateMinutes", { n: Math.max(estimateMin, 1) });

  return (
    <div className="import-page">
      <PageHeader title={t("importTakeout")} description={t("importPageDescription")} />

      {!manifest && !result && (
        <Stack gap={4}>
          <div
            className={`import-dropzone${dragOver ? " import-dropzone--over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)); }}
          >
            <FolderUp size={32} />
            <Text as="div" size="lg">{t("importUploadTitle")}</Text>
            <Text as="div" tone="secondary">{t("importUploadDescription")}</Text>
            <Button variant={pendingFiles.length === 0 ? "primary" : "default"} onClick={() => fileRef.current?.click()}>
              {pendingFiles.length === 0 ? null : <Plus />}
              {pendingFiles.length === 0 ? t("importChooseFiles") : t("importAddMoreFiles")}
            </Button>
            <Input
              ref={fileRef}
              type="file"
              accept=".zip,.csv,.json,.html"
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          {pendingFiles.length > 0 && (
            <SettingsSection className="import-section import-staged">
              <SectionHeader
                icon={<FileText />}
                title={t("importFilesReady")}
                description={t("importDropMoreHint")}
              />
              <ul className="import-file-list">
                {pendingFiles.map((f) => {
                  const key = fileKey(f);
                  const isZip = /\.zip$/i.test(f.name);
                  return (
                    <li className="import-file-row" key={key}>
                      {isZip ? <FileArchive size={16} /> : <FileText size={16} />}
                      <span className="import-file-name" title={f.name}>{f.name}</span>
                      <span className="import-file-size">{formatFileSize(f.size)}</span>
                      <button
                        type="button"
                        className="import-file-remove"
                        aria-label={t("importRemoveFile", { name: f.name })}
                        onClick={() => removeFile(key)}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Inline gap={3} justify="end" className="import-staged-actions">
                <Button variant="primary" disabled={analyzing} onClick={analyze}>
                  {analyzing ? <LoaderCircle className="spin" /> : <ScanSearch />}
                  {analyzing ? t("importAnalyzing") : t("importAnalyzeFiles", { n: pendingFiles.length })}
                </Button>
              </Inline>
            </SettingsSection>
          )}
        </Stack>
      )}

      {manifest && (
        <Stack gap={4} className="import-review">
          {manifest.channels.length > 0 && (
            <SettingsSection className="import-section">
              <SectionHeader
                icon={<Tv />}
                title={t("importSubscriptionsSection")}
                description={formatChannelCount(manifest.channels.length, language)}
                actions={<Switch checked={channelsEnabled} onCheckedChange={setChannelsEnabled} ariaLabel={t("importSubscriptionsSection")} />}
              />
              {channelsEnabled && (
                <Stack gap={3} className="import-section-body">
                  <Inline gap={2}>
                    <Input
                      type="text"
                      className="import-channel-search"
                      placeholder={t("searchChannelPlaceholder")}
                      value={channelQuery}
                      onChange={(e) => setChannelQuery(e.target.value)}
                    />
                    <Button size="sm" onClick={() => {
                      const next = new Set(excludedChannels);
                      for (const ch of filteredChannels) next.delete(ch.channelId);
                      setExcludedChannels(next);
                    }}>{t("importSelectAll")}</Button>
                    <Button size="sm" onClick={() => {
                      const next = new Set(excludedChannels);
                      for (const ch of filteredChannels) next.add(ch.channelId);
                      setExcludedChannels(next);
                    }}>{t("importSelectNone")}</Button>
                  </Inline>
                  <div className="import-check-list" role="group" aria-label={t("importSubscriptionsSection")}>
                    {filteredChannels.map((ch) => (
                      <Checkbox
                        key={ch.channelId}
                        label={ch.title || ch.channelId}
                        checked={!excludedChannels.has(ch.channelId)}
                        onChange={() => toggleSet(excludedChannels, ch.channelId, setExcludedChannels)}
                      />
                    ))}
                  </div>
                </Stack>
              )}
            </SettingsSection>
          )}

          {manifest.playlists.length > 0 && (
            <SettingsSection className="import-section">
              <SectionHeader
                icon={<ListMusic />}
                title={t("importPlaylistsSection")}
                description={formatPlaylistCount(manifest.playlists.length, language)}
                actions={<Switch checked={playlistsEnabled} onCheckedChange={setPlaylistsEnabled} ariaLabel={t("importPlaylistsSection")} />}
              />
              {playlistsEnabled && (
                <div className="import-check-list import-check-list--single import-section-body" role="group" aria-label={t("importPlaylistsSection")}>
                  {manifest.playlists.map((p) => (
                    <div className="import-playlist-row" key={p.name}>
                      <Checkbox
                        label={p.name}
                        checked={!excludedPlaylists.has(p.name)}
                        onChange={() => toggleSet(excludedPlaylists, p.name, setExcludedPlaylists)}
                      />
                      <Badge size="sm">{formatVideoCount(p.videoCount, language)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </SettingsSection>
          )}

          {manifest.history.total > 0 && (
            <SettingsSection className="import-section">
              <SectionHeader
                icon={<History />}
                title={t("importHistorySection")}
                description={[
                  formatHistoryEntryCount(manifest.history.total, language),
                  manifest.history.from && manifest.history.to
                    ? `${manifest.history.from.slice(0, 10)} – ${manifest.history.to.slice(0, 10)}`
                    : null,
                ].filter(Boolean).join(" · ")}
                actions={<Switch checked={historyEnabled} onCheckedChange={setHistoryEnabled} ariaLabel={t("importHistorySection")} />}
              />
              {historyEnabled && (
                <Stack gap={3} className="import-section-body">
                  <Inline gap={3}>
                    <SegmentedControl
                      value={historyMode}
                      onChange={setHistoryMode}
                      label={t("importHistorySection")}
                      options={[
                        { value: "since", label: t("importHistorySince") },
                        { value: "all", label: t("importHistoryAll") },
                      ]}
                    />
                    {historyMode === "since" && (
                      <Input
                        type="date"
                        value={historyFrom}
                        min={manifest.history.from?.slice(0, 10)}
                        max={manifest.history.to?.slice(0, 10)}
                        onChange={(e) => e.target.value && setHistoryFrom(e.target.value)}
                      />
                    )}
                    <Badge variant="accent">{t("importHistoryEstimate", { count: formatHistoryEntryCount(historyEstimate, language) })}</Badge>
                  </Inline>
                  {manifest.history.undated > 0 && (
                    <Text tone="secondary" size="sm">
                      {historyMode === "all"
                        ? t("importHistoryUndatedNote", { count: formatHistoryEntryCount(manifest.history.undated, language) })
                        : t("importHistoryUndatedSkipNote", { count: formatHistoryEntryCount(manifest.history.undated, language) })}
                    </Text>
                  )}
                  {historyEstimate > 5000 && (
                    <Alert variant="warning">{t("importHistoryAllWarning")}</Alert>
                  )}
                </Stack>
              )}
            </SettingsSection>
          )}

          <Inline gap={3} justify="end" className="import-commit-bar">
            {!anythingSelected && <Text tone="secondary">{t("importNothingSelected")}</Text>}
            <Button variant="primary" disabled={!anythingSelected || committing} onClick={commit}>
              {committing ? <LoaderCircle className="spin" /> : <CheckCircle2 />}
              {committing ? t("importCommitting") : t("importCommit")}
            </Button>
          </Inline>
        </Stack>
      )}

      {result && (
        <SettingsSection className="import-section import-result">
          <SectionHeader icon={<CheckCircle2 />} title={t("importDoneTitle")} description={t("importDoneSubtitle")} />
          <div className="import-result-stats">
            {([
              [t("importDoneChannels"), result.channelsAdded],
              [t("importDoneNewPlaylists"), result.playlistsCreated],
              [t("importDonePlaylistVideos"), result.playlistVideosAdded],
              [t("importDoneHistory"), result.historyAdded],
              [t("importDoneWatched"), result.watchedMarked],
            ] as const).filter(([, n]) => n > 0).map(([label, n]) => (
              <div className="import-stat" key={label}>
                <span className="import-stat-value">{n}</span>
                <span className="import-stat-label">{label}</span>
              </div>
            ))}
          </div>
          <Alert variant="info" icon={<Clock size={16} />}>
            <Stack gap={2}>
              <span>{t("importDoneBackgroundInfo")}</span>
              {result.background && result.background.enrichPending > 0 && (
                <strong>{t("importDoneEstimate", { time: estimateLabel, count: formatVideoCount(result.background.enrichPending, language) })}</strong>
              )}
            </Stack>
          </Alert>
          <Inline gap={2} className="import-result-actions">
            {result.channelsAdded > 0 && <Button onClick={() => navigate("/subscriptions")}>{t("importGoSubscriptions")}</Button>}
            {result.historyAdded > 0 && <Button onClick={() => navigate("/history")}>{t("importGoHistory")}</Button>}
            <Button variant="primary" onClick={reset}>{t("importStartOver")}</Button>
          </Inline>
        </SettingsSection>
      )}
    </div>
  );
}
