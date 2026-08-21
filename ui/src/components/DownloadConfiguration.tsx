import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, FolderUp, Info, RotateCw, Trash2 } from "lucide-react";
import { api, type DownloadConfigResponse, type DownloadSettingDef, type DownloadSettingValue } from "../api";
import { useI18n } from "../i18n";
import { Alert, Badge, Button, Chip, FileDropzone, Input, InputGroup, MultiSelectMenu, SelectMenu, SettingRow, SettingsSection, Slider, Switch, Textarea } from "./ui";
import "./DownloadConfiguration.css";

const SECTION_KEYS = {
  behavior: ["quality", "compatible_format", "watch_source_mode", "prefetch_next_playlist_video", "thumb_progress", "download_scheduled", "download_live_archives", "download_shorts"],
  files: ["output_template", "write_thumbnail", "embed_metadata", "write_info_json", "write_nfo", "write_subs", "write_auto_subs", "sub_langs"],
  storage: ["keep_downloads", "retention_days", "delete_watched", "delete_watched_hours", "keep_liked", "max_storage_gb"],
  advanced: ["experimental_streaming"],
} as const;

export default function DownloadConfiguration({ shortsEnabled }: { shortsEnabled: boolean }) {
  const { language, locale } = useI18n();
  const tx = (en: string, pl: string, de: string) => language === "pl" ? pl : language === "de" ? de : en;
  const [config, setConfig] = useState<DownloadConfigResponse | null>(null);
  const [error, setError] = useState("");
  const [cookies, setCookies] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedCookies, setPastedCookies] = useState("");
  const [updatingYtdlp, setUpdatingYtdlp] = useState(false);
  const [ytdlpNotice, setYtdlpNotice] = useState("");

  const load = useCallback(() => api.downloadConfig().then((result) => { setConfig(result); setCookies(result.cookies_configured); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))), []);
  useEffect(() => { void load(); }, [load]);

  const defs = useMemo(() => new Map(config?.definitions.map((definition) => [definition.key, definition]) ?? []), [config]);
  const update = async (key: string, value: DownloadSettingValue) => {
    if (!config) return;
    setConfig({ ...config, settings: { ...config.settings, [key]: value } });
    try { setConfig(await api.updateDownloadConfig({ settings: { [key]: value } })); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); load(); }
  };
  const setEnabled = async (enabled: boolean) => {
    if (!config) return;
    setConfig({ ...config, enabled });
    try { setConfig(await api.updateDownloadConfig({ enabled })); } catch { load(); }
  };
  const updateYtdlpConfig = async (patch: Partial<{ update_channel: "stable" | "nightly"; update_interval_days: 0 | 1 | 3 | 7 | 30 }>) => {
    if (!config) return;
    const next = { update_channel: config.ytdlp.update_channel, update_interval_days: config.ytdlp.update_interval_days, ...patch };
    setConfig({ ...config, ytdlp: { ...config.ytdlp, ...next } });
    try { const ytdlp = await api.updateYtdlpConfig(next); setConfig((current) => current ? { ...current, ytdlp } : current); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); void load(); }
  };
  const runYtdlpUpdate = async () => {
    setUpdatingYtdlp(true); setError(""); setYtdlpNotice("");
    try {
      const result = await api.updateYtdlp();
      setConfig((current) => current ? { ...current, ytdlp: { ...current.ytdlp, version: result.version, update_channel: result.channel } } : current);
      setYtdlpNotice(result.updated
        ? tx(`Updated yt-dlp from ${result.previous_version ?? "unknown"} to ${result.version ?? "unknown"}.`, `Zaktualizowano yt-dlp z ${result.previous_version ?? "nieznanej"} do ${result.version ?? "nieznanej"}.`, `yt-dlp wurde von ${result.previous_version ?? "unbekannt"} auf ${result.version ?? "unbekannt"} aktualisiert.`)
        : tx("yt-dlp is already up to date.", "yt-dlp jest już aktualny.", "yt-dlp ist bereits aktuell."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUpdatingYtdlp(false); }
  };

  const renderControl = (definition: DownloadSettingDef) => {
    const value = config?.settings[definition.key] ?? definition.defaultValue;
    if (definition.type === "toggle") return <Switch ariaLabel={definition.label} checked={Number(value) === 1} onCheckedChange={(next) => void update(definition.key, next ? 1 : 0)} />;
    if (definition.type === "select") return <SelectMenu label={definition.label} value={String(value)} options={definition.options?.map((option) => ({ value: option.value, label: option.label })) ?? []} onChange={(next) => void update(definition.key, next)} />;
    if (definition.type === "multiselect") {
      const selected = String(value).split(",").filter(Boolean);
      return <MultiSelectMenu values={selected} options={definition.options?.map((option) => ({ value: option.value, label: option.label })) ?? []} onChange={(next) => void update(definition.key, next.join(","))} label={definition.label} searchable floating summary={(items) => tx(`${items.length} languages`, `${items.length} języków`, `${items.length} Sprachen`)} />;
    }
    if (definition.type === "text") return <Input aria-label={definition.label} defaultValue={String(value)} onBlur={(event) => event.target.value.trim() !== String(value) && void update(definition.key, event.target.value.trim())} />;
    if (definition.type === "time") return <Input aria-label={definition.label} type="time" value={String(value)} onChange={(event) => event.target.value && void update(definition.key, event.target.value)} />;
    if (definition.key === "max_storage_gb") return <InputGroup suffix="GB"><Input aria-label={definition.label} type="number" min={definition.min} max={definition.max} step={definition.step} value={Number(value)} onChange={(event) => void update(definition.key, Number(event.target.value))} /></InputGroup>;
    return <div className="dl-config-slider"><Slider aria-label={definition.label} min={definition.min ?? 0} max={definition.max ?? 100} step={definition.step} value={Number(value)} onChange={(next) => void update(definition.key, next)} /><Input aria-label={`${definition.label} · ${tx("numeric value", "wartość liczbowa", "Zahlenwert")}`} type="number" min={definition.min} max={definition.max} step={definition.step} value={Number(value)} onChange={(event) => void update(definition.key, Number(event.target.value))} /></div>;
  };

  const adminLabel = <Badge size="sm" variant="warning">{tx("Administrator", "Administrator", "Administrator")}</Badge>;
  const section = (title: string, description: string, keys: readonly string[]) => <SettingsSection title={title} description={description}>{keys.map((key) => {
    const definition = defs.get(key);
    if (!definition) return null;
    const adminOnly = config?.admin_setting_keys.includes(key) ?? false;
    if (adminOnly && !config?.can_manage_admin_settings) return null;
    return <SettingRow key={key} label={<span className="dl-config-setting-label">{definition.label}{adminOnly && adminLabel}</span>} description={definition.description}>
      <fieldset className="dl-config-control-lock" disabled={!config?.can_manage || (adminOnly && !config.can_manage_admin_settings)}>{renderControl(definition)}</fieldset>
    </SettingRow>;
  })}</SettingsSection>;

  const uploadCookies = async (file: File) => {
    setUploading(true); setError("");
    try { const result = await api.uploadDownloadCookies(file); setCookies(result.configured); setPasteOpen(false); setPastedCookies(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUploading(false); }
  };

  if (!config) return null;
  const scheduleEnabled = Number(config.settings.download_schedule_enabled) === 1;
  const scheduleDays = String(config.settings.download_schedule_days ?? "0,1,2,3,4,5,6").split(",").map(Number).filter((day) => day >= 0 && day <= 6);
  const weekdays = Array.from({ length: 7 }, (_, day) => ({
    value: day,
    label: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 7, 2 + day))),
  }));
  const toggleScheduleDay = (day: number) => {
    const next = scheduleDays.includes(day) ? scheduleDays.filter((value) => value !== day) : [...scheduleDays, day].sort();
    if (next.length > 0) void update("download_schedule_days", next.join(","));
  };
  return <div className="dl-config">
    {error && <Alert variant="danger">{error}</Alert>}
    <SettingsSection title={tx("Video downloads", "Pobieranie filmów", "Video-Downloads")} description={tx("Keep video copies on the server so their availability does not depend on external providers.", "Zapisuje kopie filmów na serwerze, aby były dostępne niezależnie od YouTube.", "Speichere Videokopien auf dem Server, damit ihre Verfügbarkeit nicht von externen Anbietern abhängt.")}>
      <SettingRow label={tx("Allow downloads for this profile", "Pobieranie na tym profilu", "Downloads für dieses Profil erlauben")} description={tx("Controls manual and automatic downloads only for the active profile.", "Włącza ręczne i automatyczne pobieranie tylko dla aktywnego profilu.", "Steuert manuelle und automatische Downloads nur für dieses Profil.")}><Switch ariaLabel={tx("Allow downloads for this profile", "Pobieranie na tym profilu", "Downloads für dieses Profil erlauben")} disabled={!config.can_manage} checked={config.enabled} onCheckedChange={(next) => void setEnabled(next)} /></SettingRow>
    </SettingsSection>
    {!config.can_manage_admin_settings && <Alert className="dl-config-admin-info" variant="info">{tx("Settings marked Administrator affect shared files and can only be changed by an administrator.", "Opcje oznaczone jako Administrator wpływają na wspólne pliki i może je zmieniać tylko administrator.", "Als Administrator markierte Einstellungen betreffen gemeinsame Dateien und können nur von Administratoren geändert werden.")}</Alert>}
    {config.can_manage_admin_settings && <SettingsSection title="yt-dlp" description={tx("Manage the shared yt-dlp binary used for downloads, streaming, audio, subtitles and comments.", "Zarządzaj wspólnym plikiem yt-dlp używanym do pobierania, streamingu, audio, napisów i komentarzy.", "Verwalte die gemeinsame yt-dlp-Datei für Downloads, Streaming, Audio, Untertitel und Kommentare.")}>
      <SettingRow label={tx("Installed version", "Zainstalowana wersja", "Installierte Version")} description={config.ytdlp.version ? tx("The version currently used by YT Zero.", "Wersja używana obecnie przez YT Zero.", "Die aktuell von YT Zero verwendete Version.") : tx("yt-dlp was not found or cannot be started.", "Nie znaleziono yt-dlp lub nie można go uruchomić.", "yt-dlp wurde nicht gefunden oder kann nicht gestartet werden.")}><div className="dl-ytdlp-actions"><Badge>{config.ytdlp.version ?? tx("Unavailable", "Niedostępny", "Nicht verfügbar")}</Badge><Button variant="primary" disabled={updatingYtdlp || !config.ytdlp.version} onClick={() => void runYtdlpUpdate()} leadingIcon={<RotateCw className={updatingYtdlp ? "spin" : undefined} />}>{updatingYtdlp ? tx("Updating…", "Aktualizowanie…", "Aktualisierung…") : tx("Update now", "Aktualizuj teraz", "Jetzt aktualisieren")}</Button></div></SettingRow>
      <SettingRow label={tx("Release channel", "Kanał wydań", "Release-Kanal")} description={tx("Nightly receives fixes fastest; stable changes less often.", "Nightly najszybciej otrzymuje poprawki; stable zmienia się rzadziej.", "Nightly erhält Korrekturen am schnellsten; Stable ändert sich seltener.")}><SelectMenu label={tx("Release channel", "Kanał wydań", "Release-Kanal")} value={config.ytdlp.update_channel} options={[{ value: "nightly", label: "Nightly" }, { value: "stable", label: "Stable" }]} onChange={(value) => void updateYtdlpConfig({ update_channel: value as "stable" | "nightly" })} /></SettingRow>
      <SettingRow label={tx("Automatic updates", "Automatyczne aktualizacje", "Automatische Updates")} description={tx("Checks and updates yt-dlp at the selected interval.", "Sprawdza i aktualizuje yt-dlp w wybranym odstępie czasu.", "Prüft und aktualisiert yt-dlp im gewählten Intervall.")}><SelectMenu label={tx("Automatic updates", "Automatyczne aktualizacje", "Automatische Updates")} value={String(config.ytdlp.update_interval_days)} options={[
        { value: "0", label: tx("Never", "Nigdy", "Nie") },
        { value: "1", label: tx("Every day", "Codziennie", "Täglich") },
        { value: "3", label: tx("Every 3 days", "Co 3 dni", "Alle 3 Tage") },
        { value: "7", label: tx("Every week", "Co tydzień", "Wöchentlich") },
        { value: "30", label: tx("Every 30 days", "Co 30 dni", "Alle 30 Tage") },
      ]} onChange={(value) => void updateYtdlpConfig({ update_interval_days: Number(value) as 0 | 1 | 3 | 7 | 30 })} /></SettingRow>
      {ytdlpNotice && <Alert variant="success">{ytdlpNotice}</Alert>}
    </SettingsSection>}
    <fieldset className="dl-config-managed" disabled={!config.can_manage}>
    {section(tx("Playback and quality", "Odtwarzanie i jakość", "Wiedergabe und Qualität"), tx("Defaults used by manual and automatic downloads.", "Ustawienia wspólne dla pobrań ręcznych i automatycznych.", "Standards für manuelle und automatische Downloads."), SECTION_KEYS.behavior.filter((key) => shortsEnabled || key !== "download_shorts"))}
    <SettingsSection title={tx("Download schedule", "Harmonogram pobierania", "Download-Zeitplan")} description={tx("Keep adding items to the queue at any time, but only start downloads during this profile's allowed window.", "Dodawaj filmy do kolejki o dowolnej porze, ale rozpoczynaj pobieranie tylko w oknie dozwolonym dla tego profilu.", "Füge jederzeit Einträge zur Warteschlange hinzu, starte Downloads aber nur im erlaubten Zeitfenster dieses Profils.")}>
      <SettingRow label={tx("Use download schedule", "Używaj harmonogramu", "Download-Zeitplan verwenden")} description={tx("A download already in progress can finish after the window closes.", "Rozpoczęte pobieranie może zakończyć się po zamknięciu okna.", "Ein bereits laufender Download darf nach Ende des Zeitfensters fertig werden.")}><Switch ariaLabel={tx("Use download schedule", "Używaj harmonogramu", "Download-Zeitplan verwenden")} checked={scheduleEnabled} onCheckedChange={(checked) => void update("download_schedule_enabled", checked ? 1 : 0)} /></SettingRow>
      {scheduleEnabled && <>
        <SettingRow label={tx("Days", "Dni", "Tage")} description={tx("For an overnight window, select the day on which it starts.", "Dla okna nocnego wybierz dzień, w którym się rozpoczyna.", "Wähle bei einem Zeitfenster über Mitternacht den Starttag.")}><div className="dl-schedule-days">{weekdays.map((day) => <Chip key={day.value} active={scheduleDays.includes(day.value)} onClick={() => toggleScheduleDay(day.value)}>{day.label}</Chip>)}</div></SettingRow>
        <SettingRow label={tx("Download window", "Okno pobierania", "Download-Zeitfenster")} description={`${tx("Instance timezone", "Strefa czasowa instancji", "Zeitzone der Instanz")}: ${config.time_zone}`}><div className="dl-schedule-times"><Input type="time" aria-label={tx("Start time", "Godzina rozpoczęcia", "Startzeit")} value={String(config.settings.download_schedule_start ?? "23:00")} onChange={(event) => event.target.value && void update("download_schedule_start", event.target.value)} /><span aria-hidden="true">–</span><Input type="time" aria-label={tx("End time", "Godzina zakończenia", "Endzeit")} value={String(config.settings.download_schedule_end ?? "07:00")} onChange={(event) => event.target.value && void update("download_schedule_end", event.target.value)} /></div></SettingRow>
      </>}
    </SettingsSection>
    {section(tx("Files and metadata", "Pliki i metadane", "Dateien und Metadaten"), tx("Choose which additional data and files are saved alongside each video.", "Wybierz, jakie dodatkowe dane i pliki mają być zapisywane obok filmu.", "Wähle, welche zusätzlichen Daten und Dateien neben jedem Video gespeichert werden."), SECTION_KEYS.files)}
    {section(tx("Storage and cleanup", "Miejsce i sprzątanie", "Speicher und Bereinigung"), tx("Automatic cleanup never removes pinned or protected files.", "Automatyczne sprzątanie nie usuwa przypiętych ani chronionych plików.", "Automatische Bereinigung entfernt keine geschützten Dateien."), SECTION_KEYS.storage.filter((key) => Number(config.settings.keep_downloads) !== 1 || !["retention_days", "delete_watched", "delete_watched_hours"].includes(key)))}
    <SettingsSection title={tx("YouTube access cookies", "Cookies dostępu do YouTube", "YouTube-Zugriffscookies")} description={tx("Only needed for content your YouTube account can access, such as age-restricted or members-only videos.", "Potrzebne tylko do treści wymagających dostępu z Twojego konta YouTube.", "Nur für Inhalte nötig, auf die dein YouTube-Konto Zugriff hat.")}>
      <Alert variant="warning" icon={<Info />}>{tx("Cookies are a secret stored only on this machine. They are excluded from portable backups.", "Cookies są sekretem zapisanym tylko na tej maszynie. Nie trafiają do przenośnych backupów.", "Cookies sind geheim, lokal gespeichert und nicht Teil portabler Backups.")}</Alert>
      <strong className={`dl-cookie-status${cookies ? " is-configured" : ""}`}>{cookies ? tx("Configured", "Skonfigurowane", "Konfiguriert") : tx("Not configured", "Nieskonfigurowane", "Nicht konfiguriert")}</strong>
      <FileDropzone
        accept=".txt,text/plain"
        disabled={uploading || !config.can_manage}
        icon={<FileText />}
        title={tx("cookies.txt file", "Plik cookies.txt", "cookies.txt-Datei")}
        description={tx("Drop a Netscape-format file here or choose it from disk.", "Upuść tutaj plik w formacie Netscape albo wybierz go z dysku.", "Lege hier eine Datei im Netscape-Format ab oder wähle sie vom Datenträger.")}
        actionLabel={uploading ? tx("Uploading…", "Wgrywanie…", "Wird hochgeladen…") : tx("Choose cookies.txt", "Wybierz cookies.txt", "cookies.txt auswählen")}
        actionIcon={<FolderUp />}
        onFiles={(files) => { if (files[0]) void uploadCookies(files[0]); }}
      />
      <div className="dl-cookie-actions"><Button disabled={uploading} onClick={() => setPasteOpen((value) => !value)} leadingIcon={<FileText />}>{tx("Paste instead", "Wklej zamiast tego", "Stattdessen einfügen")}</Button>{cookies && <Button variant="danger" onClick={() => api.removeDownloadCookies().then((result) => setCookies(result.configured))} leadingIcon={<Trash2 />}>{tx("Remove", "Usuń", "Entfernen")}</Button>}</div>
      {pasteOpen && <div className="dl-cookie-paste"><Textarea value={pastedCookies} onChange={(event) => setPastedCookies(event.target.value)} placeholder="# Netscape HTTP Cookie File" /><Button variant="primary" disabled={!pastedCookies.trim() || uploading} onClick={() => void uploadCookies(new File([pastedCookies], "cookies.txt", {type:"text/plain"}))}>{tx("Save cookies", "Zapisz cookies", "Cookies speichern")}</Button></div>}
    </SettingsSection>
    {section(tx("Experimental", "Eksperymentalne", "Experimentell"), tx("Features that may require additional tools or have compatibility limits.", "Funkcje mogące wymagać dodatkowych narzędzi lub mieć ograniczenia zgodności.", "Funktionen mit zusätzlichen Anforderungen oder Einschränkungen."), SECTION_KEYS.advanced)}
    </fieldset>
  </div>;
}
