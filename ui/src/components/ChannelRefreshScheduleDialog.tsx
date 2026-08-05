import { useEffect, useMemo, useState } from "react";
import { Clock3, Info, Plus, Trash2 } from "lucide-react";
import { api, type ChannelRefreshScheduleDetails } from "../api";
import { useI18n } from "../i18n";
import { Alert, Button, Chip, Dialog, Field, IconButton, Input, SettingRow, SettingsSection, Switch } from "./ui";
import "./ChannelRefreshScheduleDialog.css";

function formatInterval(ms: number | null, locale: string, unavailable: string) {
  if (ms == null) return unavailable;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "long" }).format(minutes);
  const hours = Math.round(minutes / 6) / 10;
  if (hours < 48) return new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "long", maximumFractionDigits: 1 }).format(hours);
  return new Intl.NumberFormat(locale, { style: "unit", unit: "day", unitDisplay: "long", maximumFractionDigits: 1 }).format(Math.round(hours / 2.4) / 10);
}

function nextUnusedTime(times: string[]) {
  const used = new Set(times);
  for (let offset = 0; offset < 24; offset++) {
    const candidate = `${String((12 + offset) % 24).padStart(2, "0")}:02`;
    if (!used.has(candidate)) return candidate;
  }
  for (let minutes = 0; minutes < 24 * 60; minutes++) {
    const candidate = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  return times[0] ?? "12:02";
}

export default function ChannelRefreshScheduleDialog({ channelId, open, onOpenChange, onSaved }: { channelId: string; open: boolean; onOpenChange: (open: boolean) => void; onSaved?: () => void }) {
  const { t, locale } = useI18n();
  const [details, setDetails] = useState<ChannelRefreshScheduleDetails | null>(null);
  const [mode, setMode] = useState<"adaptive" | "manual">("adaptive");
  const [days, setDays] = useState<number[]>([]);
  const [times, setTimes] = useState<string[]>(["18:02"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) => ({
    value: index,
    label: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 7, 2 + index))),
  })), [locale]);

  useEffect(() => {
    if (!open) return;
    setError(""); setDetails(null);
    api.channelRefreshSchedule(channelId).then((value) => {
      setDetails(value); setMode(value.mode); setDays(value.days); setTimes(value.times);
    }).catch(() => setError(t("channelRefreshLoadFailed")));
  }, [channelId, open, t]);

  const save = async () => {
    if (mode === "manual" && days.length === 0) { setError(t("channelRefreshDaysRequired")); return; }
    if (mode === "manual" && (times.length === 0 || times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))) { setError(t("channelRefreshTimesRequired")); return; }
    setSaving(true); setError("");
    try {
      const value = await api.setChannelRefreshSchedule(channelId, { mode, days, times: [...new Set(times)].sort() });
      setDetails(value); onSaved?.(); onOpenChange(false);
    } catch { setError(t("channelRefreshSaveFailed")); }
    finally { setSaving(false); }
  };

  const automatic = details?.automatic;
  const date = (value: string | null | undefined) => value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: details?.timeZone }).format(new Date(value))
    : t("channelRefreshUnavailable");

  return <Dialog open={open} onOpenChange={onOpenChange} title={t("channelRefreshSchedule")} closeLabel={t("close")} className="channel-refresh-dialog" footer={<><Button onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button variant="primary" disabled={saving || !details} onClick={save}>{t("save")}</Button></>}>
    {error && <Alert variant="danger">{error}</Alert>}
    <SettingsSection description={t("channelRefreshScheduleHint")}>
      <SettingRow label={t("channelRefreshManual")} description={t("channelRefreshManualHint")}>
        <Switch checked={mode === "manual"} onCheckedChange={(checked) => setMode(checked ? "manual" : "adaptive")} ariaLabel={t("channelRefreshManual")} />
      </SettingRow>
      {mode === "manual" && <div className="channel-refresh-manual">
        <Field label={t("channelRefreshPublicationDays")} error={days.length === 0 ? t("channelRefreshDaysRequired") : undefined}>
          <div className="channel-refresh-days">{weekdays.map((day) => <Chip key={day.value} active={days.includes(day.value)} onClick={() => setDays(days.includes(day.value) ? days.filter((value) => value !== day.value) : [...days, day.value].sort())}>{day.label}</Chip>)}</div>
        </Field>
        <Field label={t("channelRefreshTimes")} hint={`${t("timeZoneLabel")}: ${details?.timeZone ?? "…"}`} error={times.length === 0 ? t("channelRefreshTimesRequired") : undefined}>
          <div className="channel-refresh-times">
            {times.map((time, index) => <div className="channel-refresh-time-row" key={index}>
              <Input id={`channel-refresh-time-${index}`} type="time" value={time} aria-label={`${t("channelRefreshTime")} ${index + 1}`} onChange={(event) => setTimes((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))} />
              {times.length > 1 && <IconButton size="sm" variant="ghost" label={t("channelRefreshRemoveTime")} icon={<Trash2 />} onClick={() => setTimes((current) => current.filter((_, currentIndex) => currentIndex !== index))} />}
            </div>)}
            <Button className="channel-refresh-add-time" size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => setTimes((current) => [...current, nextUnusedTime(current)])}>{t("channelRefreshAddTime")}</Button>
          </div>
        </Field>
        <Alert variant="info" icon={<Info />} title={t("channelRefreshTimingTipTitle")}>{t("channelRefreshTimingTip")}</Alert>
        {details?.nextManualAt && <SettingRow label={t("channelRefreshNextManual")}><strong>{date(details.nextManualAt)}</strong></SettingRow>}
      </div>}
    </SettingsSection>
    <SettingsSection title={t("channelRefreshAutomaticCalculations")} description={t("channelRefreshAutomaticHint")}>
      <SettingRow label={t("channelRefreshSamples")}><strong>{automatic?.sampleCount ?? "—"}</strong></SettingRow>
      <SettingRow label={t("channelRefreshCadence")}><strong>{formatInterval(automatic?.cadenceMs ?? null, locale, t("channelRefreshUnavailable"))}</strong></SettingRow>
      <SettingRow label={t("channelRefreshCheckInterval")}><strong>{formatInterval(automatic?.targetIntervalMs ?? null, locale, t("channelRefreshUnavailable"))}</strong></SettingRow>
      <SettingRow label={t("channelRefreshFailures")}><strong>{automatic?.consecutiveFailures ?? "—"}</strong></SettingRow>
      <SettingRow label={t("channelRefreshLastAttempt")}><strong>{date(automatic?.lastAttemptedAt)}</strong></SettingRow>
      <SettingRow label={t("channelRefreshNextAdaptive")}><strong>{date(automatic?.nextRefreshAt)}</strong></SettingRow>
    </SettingsSection>
    <div className="channel-refresh-footnote"><Clock3 />{t("channelRefreshManualOverrides")}</div>
  </Dialog>;
}
