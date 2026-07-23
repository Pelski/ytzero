import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, FolderUp, History, ListMusic, LoaderCircle, Tv } from "lucide-react";
import "./ImportPage.css";
import { api, type ImportCommitResult, type ImportManifest } from "../api";
import { emit } from "../events";
import { useI18n } from "../i18n";
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

export default function ImportPage({ showToast }: { showToast: (msg: string) => void }) {
  const { t } = useI18n();
  useDocumentTitle(t("importTakeout"));
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

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

  const analyze = async (files: File[]) => {
    if (files.length === 0 || analyzing) return;
    setAnalyzing(true);
    try {
      const m = await api.importAnalyze(files);
      setManifest(m);
      setChannelsEnabled(m.channels.length > 0);
      setPlaylistsEnabled(m.playlists.length > 0);
      setHistoryEnabled(m.history.total > 0);
      setExcludedChannels(new Set());
      setExcludedPlaylists(new Set());
      setResult(null);
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
  };

  return (
    <div className="import-page">
      <PageHeader title={t("importTakeout")} description={t("importPageDescription")} />

      {!manifest && !result && (
        <div
          className={`import-dropzone${dragOver ? " import-dropzone--over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); analyze(Array.from(e.dataTransfer.files)); }}
        >
          {analyzing ? <LoaderCircle className="spin" size={32} /> : <FolderUp size={32} />}
          <Text as="div" size="lg">{analyzing ? t("importAnalyzing") : t("importUploadTitle")}</Text>
          <Text as="div" tone="secondary">{t("importUploadDescription")}</Text>
          <Button variant="primary" disabled={analyzing} onClick={() => fileRef.current?.click()}>
            {t("importChooseFiles")}
          </Button>
          <Input
            ref={fileRef}
            type="file"
            accept=".zip,.csv,.json,.html"
            multiple
            hidden
            onChange={(e) => {
              analyze(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      )}

      {manifest && (
        <Stack gap={4} className="import-review">
          {manifest.channels.length > 0 && (
            <SettingsSection className="import-section">
              <SectionHeader
                icon={<Tv />}
                title={t("importSubscriptionsSection")}
                description={t("tagChannelCount", { n: manifest.channels.length })}
                actions={<Switch checked={channelsEnabled} onCheckedChange={setChannelsEnabled} ariaLabel={t("importSubscriptionsSection")} />}
              />
              {channelsEnabled && (
                <>
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
                </>
              )}
            </SettingsSection>
          )}

          {manifest.playlists.length > 0 && (
            <SettingsSection className="import-section">
              <SectionHeader
                icon={<ListMusic />}
                title={t("importPlaylistsSection")}
                description={t("importPlaylistsCount", { n: manifest.playlists.length })}
                actions={<Switch checked={playlistsEnabled} onCheckedChange={setPlaylistsEnabled} ariaLabel={t("importPlaylistsSection")} />}
              />
              {playlistsEnabled && (
                <div className="import-check-list import-check-list--single" role="group" aria-label={t("importPlaylistsSection")}>
                  {manifest.playlists.map((p) => (
                    <div className="import-playlist-row" key={p.name}>
                      <Checkbox
                        label={p.name}
                        checked={!excludedPlaylists.has(p.name)}
                        onChange={() => toggleSet(excludedPlaylists, p.name, setExcludedPlaylists)}
                      />
                      <Badge size="sm">{t("importVideosCount", { n: p.videoCount })}</Badge>
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
                description={t("importHistoryRange", {
                  n: manifest.history.total,
                  from: manifest.history.from?.slice(0, 10) ?? "?",
                  to: manifest.history.to?.slice(0, 10) ?? "?",
                })}
                actions={<Switch checked={historyEnabled} onCheckedChange={setHistoryEnabled} ariaLabel={t("importHistorySection")} />}
              />
              {historyEnabled && (
                <Stack gap={3}>
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
                    <Badge variant="accent">{t("importHistoryEstimate", { n: historyEstimate })}</Badge>
                  </Inline>
                  {historyMode === "all" && manifest.history.undated > 0 && (
                    <Text tone="secondary" size="sm">{t("importHistoryUndatedNote", { n: manifest.history.undated })}</Text>
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
          <dl className="import-result-stats">
            {result.channelsAdded > 0 && <><dt>{t("importDoneChannels")}</dt><dd>{result.channelsAdded}</dd></>}
            {result.playlistsCreated > 0 && <><dt>{t("importDoneNewPlaylists")}</dt><dd>{result.playlistsCreated}</dd></>}
            {result.playlistVideosAdded > 0 && <><dt>{t("importDonePlaylistVideos")}</dt><dd>{result.playlistVideosAdded}</dd></>}
            {result.historyAdded > 0 && <><dt>{t("importDoneHistory")}</dt><dd>{result.historyAdded}</dd></>}
            {result.watchedMarked > 0 && <><dt>{t("importDoneWatched")}</dt><dd>{result.watchedMarked}</dd></>}
          </dl>
          <Inline gap={2}>
            {result.channelsAdded > 0 && <Button onClick={() => navigate("/subscriptions")}>{t("importGoSubscriptions")}</Button>}
            {result.historyAdded > 0 && <Button onClick={() => navigate("/history")}>{t("importGoHistory")}</Button>}
            <Button variant="primary" onClick={reset}>{t("importStartOver")}</Button>
          </Inline>
        </SettingsSection>
      )}
    </div>
  );
}
