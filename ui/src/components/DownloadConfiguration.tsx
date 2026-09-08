import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, FolderUp, Info, RotateCw, Trash2 } from "lucide-react";
import { api, type DownloadConfigResponse, type DownloadCookieHealth, type DownloadSettingDef, type DownloadSettingValue } from "../api";
import { useI18n } from "../i18n";
import { Alert, Badge, Button, Chip, FileDropzone, Input, InputGroup, MultiSelectMenu, SelectMenu, SettingRow, SettingsSection, Slider, Switch, Textarea } from "./ui";
import "./DownloadConfiguration.css";

const SECTION_KEYS = {
  behavior: ["quality", "compatible_format", "watch_source_mode", "default_player", "prefetch_next_playlist_video", "thumb_progress", "download_scheduled", "download_live_archives", "download_shorts"],
  files: ["output_template", "write_thumbnail", "embed_metadata", "write_info_json", "write_nfo", "write_subs", "write_auto_subs", "sub_langs"],
  storage: ["keep_downloads", "retention_days", "delete_watched", "delete_watched_hours", "keep_liked", "max_storage_gb"],
  advanced: ["experimental_streaming"],
} as const;

export default function DownloadConfiguration({ shortsEnabled }: { shortsEnabled: boolean }) {
  const { t, locale } = useI18n();
  const [config, setConfig] = useState<DownloadConfigResponse | null>(null);
  const [error, setError] = useState("");
  const [cookies, setCookies] = useState(false);
  const [cookieHealth, setCookieHealth] = useState<DownloadCookieHealth | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedCookies, setPastedCookies] = useState("");
  const [updatingYtdlp, setUpdatingYtdlp] = useState(false);
  const [ytdlpNotice, setYtdlpNotice] = useState("");

  const load = useCallback(() => api.downloadConfig().then((result) => {
    setConfig(result);
    setCookies(result.cookies_configured);
    setCookieHealth(null);
    if (result.cookies_configured) void api.downloadCookies().then(setCookieHealth).catch(() => setCookieHealth({ configured: true, recognition: "unknown", checked_at: null }));
  }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))), []);
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
        ? t("Updated yt-dlp from {p0} to {p1}.", { p0: result.previous_version ?? "unknown", p1: result.version ?? "unknown" })
        : t("yt-dlp is already up to date."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUpdatingYtdlp(false); }
  };

  const renderControl = (definition: DownloadSettingDef) => {
    const value = config?.settings[definition.key] ?? definition.defaultValue;
    if (definition.type === "toggle") return <Switch ariaLabel={definition.label} checked={Number(value) === 1} onCheckedChange={(next) => void update(definition.key, next ? 1 : 0)} />;
    if (definition.type === "select") return <SelectMenu label={definition.label} value={String(value)} options={definition.options?.map((option) => ({ value: option.value, label: option.label })) ?? []} onChange={(next) => void update(definition.key, next)} />;
    if (definition.type === "multiselect") {
      const selected = String(value).split(",").filter(Boolean);
      return <MultiSelectMenu values={selected} options={definition.options?.map((option) => ({ value: option.value, label: option.label })) ?? []} onChange={(next) => void update(definition.key, next.join(","))} label={definition.label} searchable floating summary={(items) => t("{p0} languages", { p0: items.length })} />;
    }
    if (definition.type === "text") return <Input aria-label={definition.label} defaultValue={String(value)} onBlur={(event) => event.target.value.trim() !== String(value) && void update(definition.key, event.target.value.trim())} />;
    if (definition.type === "time") return <Input aria-label={definition.label} type="time" value={String(value)} onChange={(event) => event.target.value && void update(definition.key, event.target.value)} />;
    if (definition.key === "max_storage_gb") return <InputGroup suffix="GB"><Input aria-label={definition.label} type="number" min={definition.min} max={definition.max} step={definition.step} value={Number(value)} onChange={(event) => void update(definition.key, Number(event.target.value))} /></InputGroup>;
    return <div className="dl-config-slider"><Slider aria-label={definition.label} min={definition.min ?? 0} max={definition.max ?? 100} step={definition.step} value={Number(value)} onChange={(next) => void update(definition.key, next)} /><Input aria-label={`${definition.label} · ${t("numeric value")}`} type="number" min={definition.min} max={definition.max} step={definition.step} value={Number(value)} onChange={(event) => void update(definition.key, Number(event.target.value))} /></div>;
  };

  const adminLabel = <Badge size="sm" variant="warning">{t("Administrator")}</Badge>;
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
    try { const result = await api.uploadDownloadCookies(file); setCookies(result.configured); setCookieHealth(result); setPasteOpen(false); setPastedCookies(""); }
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
  const cookieStatus = !cookies
    ? { label: t("downloadCookiesNotConfigured"), variant: "neutral" as const }
    : cookieHealth?.recognition === "recognized"
      ? { label: t("downloadCookiesRecognized"), variant: "success" as const }
      : cookieHealth?.recognition === "unrecognized"
        ? { label: t("downloadCookiesUnrecognized"), variant: "danger" as const }
        : cookieHealth
          ? { label: t("downloadCookiesStatusError"), variant: "warning" as const }
          : { label: t("downloadCookiesConfigured"), variant: "neutral" as const };
  return <div className="dl-config">
    {error && <Alert variant="danger">{error}</Alert>}
    <SettingsSection title={t("Video downloads")} description={t("Keep video copies on the server so their availability does not depend on external providers.")}>
      <SettingRow label={t("Allow downloads for this profile")} description={t("Controls manual and automatic downloads only for the active profile.")}><Switch ariaLabel={t("Allow downloads for this profile")} disabled={!config.can_manage} checked={config.enabled} onCheckedChange={(next) => void setEnabled(next)} /></SettingRow>
    </SettingsSection>
    {!config.can_manage_admin_settings && <Alert className="dl-config-admin-info" variant="info">{t("Settings marked Administrator affect shared files and can only be changed by an administrator.")}</Alert>}
    {config.can_manage_admin_settings && <SettingsSection title="yt-dlp" description={t("Manage the shared yt-dlp binary used for downloads, streaming, audio, subtitles and comments.")}>
      <SettingRow label={t("Installed version")} description={config.ytdlp.version ? t("The version currently used by YT Zero.") : t("yt-dlp was not found or cannot be started.")}><div className="dl-ytdlp-actions"><Badge>{config.ytdlp.version ?? t("Unavailable")}</Badge><Button variant="primary" disabled={updatingYtdlp || !config.ytdlp.version} onClick={() => void runYtdlpUpdate()} leadingIcon={<RotateCw className={updatingYtdlp ? "spin" : undefined} />}>{updatingYtdlp ? t("Updating…") : t("Update now")}</Button></div></SettingRow>
      <SettingRow label={t("Release channel")} description={t("Nightly receives fixes fastest; stable changes less often.")}><SelectMenu label={t("Release channel")} value={config.ytdlp.update_channel} options={[{ value: "nightly", label: t("Nightly") }, { value: "stable", label: t("Stable") }]} onChange={(value) => void updateYtdlpConfig({ update_channel: value as "stable" | "nightly" })} /></SettingRow>
      <SettingRow label={t("Automatic updates")} description={t("Checks and updates yt-dlp at the selected interval.")}><SelectMenu label={t("Automatic updates")} value={String(config.ytdlp.update_interval_days)} options={[
        { value: "0", label: t("Never") },
        { value: "1", label: t("Every day") },
        { value: "3", label: t("Every 3 days") },
        { value: "7", label: t("Every week") },
        { value: "30", label: t("Every 30 days") },
      ]} onChange={(value) => void updateYtdlpConfig({ update_interval_days: Number(value) as 0 | 1 | 3 | 7 | 30 })} /></SettingRow>
      {ytdlpNotice && <Alert variant="success">{ytdlpNotice}</Alert>}
    </SettingsSection>}
    <fieldset className="dl-config-managed" disabled={!config.can_manage}>
    {section(t("Playback and quality"), t("Defaults used by manual and automatic downloads."), SECTION_KEYS.behavior.filter((key) => shortsEnabled || key !== "download_shorts"))}
    <SettingsSection title={t("Download schedule")} description={t("Keep adding items to the queue at any time, but only start downloads during this profile's allowed window.")}>
      <SettingRow label={t("Use download schedule")} description={t("A download already in progress can finish after the window closes.")}><Switch ariaLabel={t("Use download schedule")} checked={scheduleEnabled} onCheckedChange={(checked) => void update("download_schedule_enabled", checked ? 1 : 0)} /></SettingRow>
      {scheduleEnabled && <>
        <SettingRow label={t("Days")} description={t("For an overnight window, select the day on which it starts.")}><div className="dl-schedule-days">{weekdays.map((day) => <Chip key={day.value} active={scheduleDays.includes(day.value)} onClick={() => toggleScheduleDay(day.value)}>{day.label}</Chip>)}</div></SettingRow>
        <SettingRow label={t("Download window")} description={`${t("Instance timezone")}: ${config.time_zone}`}><div className="dl-schedule-times"><Input type="time" aria-label={t("Start time")} value={String(config.settings.download_schedule_start ?? "23:00")} onChange={(event) => event.target.value && void update("download_schedule_start", event.target.value)} /><span aria-hidden="true">–</span><Input type="time" aria-label={t("End time")} value={String(config.settings.download_schedule_end ?? "07:00")} onChange={(event) => event.target.value && void update("download_schedule_end", event.target.value)} /></div></SettingRow>
      </>}
    </SettingsSection>
    {section(t("Files and metadata"), t("Choose which additional data and files are saved alongside each video."), SECTION_KEYS.files)}
    {section(t("Storage and cleanup"), t("Automatic cleanup never removes pinned or protected files."), SECTION_KEYS.storage.filter((key) => Number(config.settings.keep_downloads) !== 1 || !["retention_days", "delete_watched", "delete_watched_hours"].includes(key)))}
    <SettingsSection title={t("YouTube access cookies")} description={t("Only needed for content your YouTube account can access, such as age-restricted or members-only videos.")}>
      <Alert variant="warning" icon={<Info />}>{t("Cookies are a secret stored only on this machine. They are excluded from portable backups.")}</Alert>
      <Badge className="dl-cookie-health" variant={cookieStatus.variant}>{cookieStatus.label}</Badge>
      <FileDropzone
        accept=".txt,text/plain"
        disabled={uploading || !config.can_manage}
        icon={<FileText />}
        title={t("cookies.txt file")}
        description={t("Drop a Netscape-format file here or choose it from disk.")}
        actionLabel={uploading ? t("Uploading…") : t("Choose cookies.txt")}
        actionIcon={<FolderUp />}
        onFiles={(files) => { if (files[0]) void uploadCookies(files[0]); }}
      />
      <div className="dl-cookie-actions"><Button disabled={uploading} onClick={() => setPasteOpen((value) => !value)} leadingIcon={<FileText />}>{t("Paste instead")}</Button>{cookies && <Button variant="danger" onClick={() => api.removeDownloadCookies().then((result) => { setCookies(result.configured); setCookieHealth(result); })} leadingIcon={<Trash2 />}>{t("Remove")}</Button>}</div>
      {pasteOpen && <div className="dl-cookie-paste"><Textarea value={pastedCookies} onChange={(event) => setPastedCookies(event.target.value)} placeholder="# Netscape HTTP Cookie File" /><Button variant="primary" disabled={!pastedCookies.trim() || uploading} onClick={() => void uploadCookies(new File([pastedCookies], "cookies.txt", {type:"text/plain"}))}>{t("Save cookies")}</Button></div>}
    </SettingsSection>
    {section(t("Experimental"), t("Features that may require additional tools or have compatibility limits."), SECTION_KEYS.advanced)}
    </fieldset>
  </div>;
}
