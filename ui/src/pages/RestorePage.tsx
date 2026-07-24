import { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, CheckCircle2, Download, FileArchive, LoaderCircle, ShieldCheck, Upload } from "lucide-react";
import { api, type BackupOptions, type RestoreAnalysis } from "../api";
import { useDocumentTitle } from "../useDocumentTitle";
import { useI18n } from "../i18n";
import { Alert, Badge, Button, ButtonAnchor, Checkbox, FileDropzone, Inline, PageHeader, SelectMenu, SettingRow, SettingsSection, Stack, Tabs } from "../components/ui";
import "./RestorePage.css";

type RestoreTab = "export" | "restore";
type Mapping = { action: "create" | "merge" | "skip"; targetProfileId?: number };

const LABELS: Record<string, string> = {
  "instance.settings": "Instance appearance and settings",
  "instance.plugins": "Enabled plugins and portable plugin settings",
  "instance.channels": "Shared channel names and download overrides",
  "profiles.index": "Profiles and avatars",
  "profile.settings": "Profile preferences",
  "profile.subscriptions": "Subscriptions and channel overrides",
  "profile.followed-playlists": "Followed YouTube playlists",
  "profile.tags": "Tags and assignments",
  "profile.rules": "Automatic tag and filter rules",
  "profile.playlists": "Personal playlists and rules",
  "profile.video-state": "Queue, archive, likes and playback progress",
  "profile.history": "Watch history",
  "profile.discovery-feedback": "Discovery feedback",
  "profile.analytics": "Insights and Pulse history",
  "library.referenced-videos": "Required referenced-video index",
};
const LABELS_PL: Record<string, string> = {
  "instance.settings": "Wygląd i ustawienia instancji", "instance.plugins": "Włączone wtyczki i ich przenośne ustawienia", "instance.channels": "Wspólne nazwy kanałów i reguły pobierania", "profiles.index": "Profile i awatary", "profile.avatar": "Awatary profili", "profile.settings": "Preferencje profili", "profile.subscriptions": "Subskrypcje i ustawienia kanałów", "profile.followed-playlists": "Obserwowane playlisty YouTube", "profile.tags": "Tagi i przypisania", "profile.rules": "Reguły tagowania i filtrowania", "profile.playlists": "Osobiste playlisty i reguły", "profile.video-state": "Kolejka, archiwum, polubienia i postęp", "profile.history": "Historia oglądania", "profile.discovery-feedback": "Opinie dla Odkrywania", "profile.analytics": "Historia Statystyk i Pulsu", "library.referenced-videos": "Wymagany indeks filmów",
};

function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function RestorePage({ showToast }: { showToast: (message: string) => void }) {
  const { language } = useI18n();
  const tx = (en: string, pl: string) => language === "pl" ? pl : en;
  const sectionLabel = (id: string) => language === "pl" ? (LABELS_PL[id] ?? id) : (LABELS[id] ?? id);
  useDocumentTitle(tx("Backup and restore", "Kopia zapasowa i przywracanie"));
  const [tab, setTab] = useState<RestoreTab>("export");
  const [options, setOptions] = useState<BackupOptions | null>(null);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("setup");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<RestoreAnalysis | null>(null);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [restoreSections, setRestoreSections] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<"merge" | "replace">("merge");
  const [dryRun, setDryRun] = useState<Awaited<ReturnType<typeof api.restorePlan>> | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.restoreCommit>> | null>(null);

  useEffect(() => {
    api.backupOptions().then((value) => {
      setOptions(value);
      setProfiles(value.profiles.map((profile) => profile.id));
      setSections(value.presets.setup ?? []);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const visibleSections = useMemo(() => options?.sections.filter((section) => section.category !== "dependency") ?? [], [options]);
  const selectPreset = (next: string) => {
    setPreset(next);
    if (next !== "custom" && options) setSections(options.presets[next] ?? []);
  };
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const exportArchive = async () => {
    if (!options || busy) return;
    setBusy(true);
    try {
      const blob = await api.exportBackup({ preset, profiles, sections });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `ytzero-backup-${new Date().toISOString().slice(0, 10)}.zip`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const analyze = async (file: File) => {
    setBusy(true); setResult(null); setDryRun(null);
    try {
      const value = await api.restoreAnalyze(file);
      setAnalysis(value);
      setRestoreSections([...new Set(value.manifest.sections.map((section) => section.id))]);
      const next: Record<string, Mapping> = {};
      for (const source of value.manifest.profiles) {
        const same = value.existingProfiles.find((target) => target.portable_uuid === source.id);
        next[source.id] = same ? { action: "merge", targetProfileId: same.id } : { action: "create" };
      }
      setMappings(next);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const review = async () => {
    if (!analysis) return;
    setBusy(true);
    try { setDryRun(await api.restorePlan({ sessionId: analysis.sessionId, mappings, sections: restoreSections, strategy })); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!analysis || !dryRun) return;
    setBusy(true);
    try { setResult(await api.restoreCommit(analysis.sessionId, dryRun.planRevision)); setAnalysis(null); setDryRun(null); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  if (error) return <><PageHeader title={tx("Backup and restore", "Kopia zapasowa i przywracanie")} /><Alert variant="danger" title={tx("Unavailable", "Niedostępne")}>{error}</Alert></>;
  return <div className="restore-page">
    <PageHeader title={tx("Backup and restore", "Kopia zapasowa i przywracanie")} description={tx("Move selected configuration and personal data between YT Zero installations.", "Przenoś wybrane ustawienia i dane osobiste między instalacjami YT Zero.")} icon={<ArchiveRestore />} />
    <Tabs value={tab} onChange={setTab} label={tx("Backup operation", "Operacja kopii zapasowej")} options={[{ value: "export", label: tx("Export backup", "Eksport kopii"), icon: <Download /> }, { value: "restore", label: tx("Restore backup", "Przywracanie kopii"), icon: <Upload /> }]} />

    {tab === "export" && <Stack gap={4}>
      <SettingsSection title={tx("What should the backup contain?", "Co ma zawierać kopia?")} description={tx("Presets select categories; the manifest records the exact sections included.", "Preset wybiera kategorie, a manifest zapisuje dokładną listę sekcji.")}>
        <SettingRow label={tx("Preset", "Preset")} description={tx("Setup and organization is the recommended portable backup.", "Konfiguracja i organizacja to zalecany wariant przenośnej kopii.")}>
          <SelectMenu label={tx("Backup preset", "Preset kopii")} value={preset} onChange={selectPreset} options={[{ value: "configuration", label: tx("Configuration only", "Tylko konfiguracja") }, { value: "setup", label: tx("Setup and organization", "Konfiguracja i organizacja") }, { value: "full", label: tx("Full personal data", "Pełne dane osobiste") }, { value: "custom", label: tx("Custom", "Własny") }]} />
        </SettingRow>
        <div className="restore-options-grid">
          {visibleSections.map((section) => <Checkbox key={section.id} label={sectionLabel(section.id)} description={section.sensitivity === "personal" ? tx("Personal data — opt in", "Dane osobiste — opcjonalne") : section.scope === "instance" ? tx("Instance", "Instancja") : tx("Per profile", "Dla każdego profilu")} checked={sections.includes(section.id)} disabled={preset !== "custom"} onChange={() => setSections(toggle(sections, section.id))} />)}
        </div>
      </SettingsSection>
      <SettingsSection title={tx("Profiles", "Profile")}>
        <div className="restore-options-grid">{options?.profiles.map((profile) => <Checkbox key={profile.id} label={profile.name} description={profile.isChild ? tx("Child profile", "Profil dziecka") : tx("Profile", "Profil")} checked={profiles.includes(profile.id)} onChange={() => setProfiles(toggle(profiles, profile.id))} />)}</div>
      </SettingsSection>
      <Alert variant="info" title={tx("Downloaded media is not included", "Pobrane media nie są dołączane")}>{tx("For exact disaster recovery, stop YT Zero and copy the complete data/ directory.", "Aby wykonać dokładną kopię awaryjną, zatrzymaj YT Zero i skopiuj cały katalog data/.")} <a href="https://github.com/Pelski/ytzero/wiki/Backup-and-Updates" target="_blank" rel="noreferrer">{tx("Read the backup guide", "Przeczytaj instrukcję")}</a>.</Alert>
      <Inline justify="end"><Button variant="primary" leadingIcon={busy ? <LoaderCircle className="spin" /> : <Download />} disabled={busy || profiles.length === 0 || sections.length === 0} onClick={exportArchive}>{busy ? tx("Creating backup…", "Tworzenie kopii…") : tx("Download backup", "Pobierz kopię")}</Button></Inline>
    </Stack>}

    {tab === "restore" && <Stack gap={4}>
      {!analysis && !result && <SettingsSection title={tx("Upload a portable backup", "Wczytaj przenośną kopię")} description={tx("The archive is checked and analyzed without changing application data.", "Archiwum zostanie sprawdzone i przeanalizowane bez zmiany danych aplikacji.")}>
        <FileDropzone
          accept=".zip,.ytzero-backup"
          disabled={busy}
          icon={<FileArchive size={30} />}
          title={tx("Drop a portable backup here", "Upuść tutaj przenośną kopię")}
          description={tx("Choose or drop a .zip or .ytzero-backup file.", "Wybierz lub upuść plik .zip albo .ytzero-backup.")}
          actionLabel={busy ? tx("Analyzing…", "Analizowanie…") : tx("Choose backup", "Wybierz kopię")}
          actionIcon={busy ? <LoaderCircle className="spin" /> : <Upload />}
          onFiles={(files) => { if (files[0]) void analyze(files[0]); }}
        />
      </SettingsSection>}

      {analysis && !dryRun && <>
        <Alert variant="success" icon={<ShieldCheck />} title={tx("Integrity verified", "Integralność potwierdzona")}>{tx("Created", "Utworzono")} {new Date(analysis.manifest.createdAt).toLocaleString()} — YT Zero {analysis.manifest.appVersion}, {size(analysis.archiveBytes)}.{analysis.sameSource ? tx(" This backup came from this installation.", " Ta kopia pochodzi z tej instalacji.") : ""}</Alert>
        {analysis.warnings.map((warning) => <Alert key={warning} variant="warning">{warning}</Alert>)}
        <SettingsSection title={tx("Profile destinations", "Profile docelowe")} description={tx("Create a profile, merge into an existing one, or skip it.", "Utwórz profil, scal dane z istniejącym albo pomiń.")}>
          {analysis.manifest.profiles.map((source) => {
            const mapping = mappings[source.id] ?? { action: "skip" };
            const value = mapping.action === "merge" ? `merge:${mapping.targetProfileId}` : mapping.action;
            return <SettingRow key={source.id} label={source.name} description={source.isChild ? tx("Child profile", "Profil dziecka") : undefined}>
              <SelectMenu label={`${tx("Destination for", "Cel dla") } ${source.name}`} value={value} onChange={(next) => { if (next === "create" || next === "skip") setMappings({ ...mappings, [source.id]: { action: next } }); else setMappings({ ...mappings, [source.id]: { action: "merge", targetProfileId: Number(next.split(":")[1]) } }); }} options={[{ value: "create", label: tx("Create new profile", "Utwórz nowy profil") }, ...analysis.existingProfiles.map((target) => ({ value: `merge:${target.id}`, label: `${tx("Merge into", "Scal z") } ${target.name}` })), { value: "skip", label: tx("Skip", "Pomiń") }]} />
            </SettingRow>;
          })}
        </SettingsSection>
        <SettingsSection title={tx("Categories", "Kategorie")}>
          <div className="restore-options-grid">{[...new Set(analysis.manifest.sections.map((section) => section.id))].filter((id) => id !== "library.referenced-videos").map((id) => <Checkbox key={id} label={sectionLabel(id)} checked={restoreSections.includes(id)} onChange={() => setRestoreSections(toggle(restoreSections, id))} />)}</div>
        </SettingsSection>
        <SettingsSection title={tx("Conflict strategy", "Strategia konfliktów")}>
          <SettingRow label={tx("Apply selected categories", "Zastosuj wybrane kategorie")} description={strategy === "replace" ? tx("Existing rows in each mapped profile/category are removed inside the restore transaction.", "Istniejące wpisy wybranego profilu i kategorii zostaną usunięte w tej samej transakcji.") : tx("Matching objects are updated and unrelated existing data is preserved.", "Pasujące obiekty zostaną zaktualizowane, a pozostałe dane zachowane.")}>
            <SelectMenu label={tx("Conflict strategy", "Strategia konfliktów")} value={strategy} onChange={setStrategy} options={[{ value: "merge", label: tx("Merge safely", "Scal bezpiecznie") }, { value: "replace", label: tx("Replace selected categories", "Zastąp wybrane kategorie") }]} />
          </SettingRow>
          {strategy === "replace" && <Alert variant="danger" title={tx("Destructive option", "Opcja destrukcyjna")}>{tx("Selected categories in mapped profiles will be replaced. An automatic database snapshot is created first.", "Wybrane kategorie w przypisanych profilach zostaną zastąpione. Najpierw powstanie automatyczny snapshot bazy.")}</Alert>}
        </SettingsSection>
        <Alert variant="info" title={tx("Always excluded", "Zawsze wykluczone")}>{analysis.exclusions.join("; ")}. {tx("Authentication remains unchanged.", "Uwierzytelnianie pozostanie bez zmian.")}</Alert>
        <Inline justify="between"><Button onClick={() => { void api.deleteRestoreSession(analysis.sessionId); setAnalysis(null); }}>{tx("Cancel", "Anuluj")}</Button><Button variant="primary" disabled={busy || restoreSections.length === 0} onClick={review}>{busy ? tx("Preparing review…", "Przygotowywanie podglądu…") : tx("Review changes", "Przejrzyj zmiany")}</Button></Inline>
      </>}

      {analysis && dryRun && <SettingsSection title={tx("Dry-run review", "Podgląd na sucho")} description={tx("Restore uses this exact parsed plan; it will not re-interpret your choices.", "Przywracanie użyje dokładnie tego planu bez ponownej interpretacji wyborów.")}>
        <div className="restore-summary">
          <Badge variant="success">{tx("Create", "Utwórz")} {dryRun.changes.createProfiles} {tx("profiles", "profili")}</Badge>
          <Badge>{tx("Update", "Aktualizuj")} {dryRun.changes.mergeProfiles} {tx("profiles", "profili")}</Badge>
          <Badge>{tx("Apply", "Zastosuj")} {dryRun.changes.records.toLocaleString()} {tx("records", "wpisów")}</Badge>
          {dryRun.changes.skipProfiles > 0 && <Badge variant="warning">{tx("Skip", "Pomiń")} {dryRun.changes.skipProfiles} {tx("profiles", "profili")}</Badge>}
        </div>
        {dryRun.warnings.map((warning) => <Alert key={warning} variant="warning">{warning}</Alert>)}
        <Inline justify="between"><Button onClick={() => setDryRun(null)}>{tx("Back", "Wstecz")}</Button><Button variant={strategy === "replace" ? "danger" : "primary"} disabled={busy} onClick={commit}>{busy ? tx("Restoring…", "Przywracanie…") : tx("Restore backup", "Przywróć kopię")}</Button></Inline>
      </SettingsSection>}

      {result && <SettingsSection title={tx("Restore complete", "Przywracanie zakończone")}>
        <Alert variant="success" icon={<CheckCircle2 />} title={tx("Backup restored", "Kopia przywrócona")}>{tx("Created", "Utworzono")} {result.counts.created}, {tx("updated", "zaktualizowano")} {result.counts.updated}, {tx("skipped", "pominięto")} {result.counts.skipped}. {tx("An automatic pre-restore database snapshot was saved.", "Zapisano automatyczny snapshot bazy sprzed operacji.")}</Alert>
        {result.counts.warnings.map((warning) => <Alert key={warning} variant="warning">{warning}</Alert>)}
        <Inline><Button onClick={() => setResult(null)}>{tx("Restore another backup", "Przywróć inną kopię")}</Button><ButtonAnchor href="/" variant="primary">{tx("Return to YT Zero", "Wróć do YT Zero")}</ButtonAnchor></Inline>
      </SettingsSection>}
    </Stack>}
  </div>;
}
