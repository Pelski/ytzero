import { useEffect, useMemo, useState } from "react";
import { CalendarClock, LoaderCircle } from "lucide-react";
import { api, PLAYBACK_SPEEDS, type Channel, type ChannelManualStatus, type ChannelShortsFeedVisibility, type MembersOnlyVisibility } from "../../api";
import { SUBTITLE_LANGUAGES } from "../../subtitleLanguages";
import { useI18n } from "../../i18n";
import ChannelRefreshScheduleDialog from "../ChannelRefreshScheduleDialog";
import { Alert, Button, Dialog, SelectMenu, SettingRow, SettingsSection } from "../ui";
import "./ChannelSettingsDialog.css";

type CaptionChoice = "default" | "off" | `language:${string}`;

interface ChannelSettingsDraft {
  status: ChannelManualStatus;
  speed: string;
  captions: CaptionChoice;
  membersOnly: MembersOnlyVisibility;
  shorts: ChannelShortsFeedVisibility;
}

function draftFromChannel(channel: Channel): ChannelSettingsDraft {
  return {
    status: channel.manual_status ?? "active",
    speed: channel.playback_speed ?? "",
    captions: channel.caption_mode === "off"
      ? "off"
      : channel.caption_mode === "language" && channel.caption_language
        ? `language:${channel.caption_language}`
        : "default",
    membersOnly: channel.members_only_visibility ?? "default",
    shorts: channel.shorts_feed_visibility ?? "default",
  };
}

export function hasCustomChannelSettings(channel: Channel): boolean {
  const schedule = channel as Channel & { refresh_schedule_days?: string | null; refresh_schedule_time?: string | null };
  return (channel.manual_status ?? "active") !== "active"
    || channel.playback_speed != null
    || channel.caption_mode != null
    || (channel.members_only_visibility ?? "default") !== "default"
    || (channel.shorts_feed_visibility ?? "default") !== "default"
    || schedule.refresh_schedule_days != null
    || schedule.refresh_schedule_time != null;
}

export default function ChannelSettingsDialog({ channel, open, onOpenChange, onSaved }: {
  channel: Channel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [loadedChannel, setLoadedChannel] = useState<Channel | null>(null);
  const [initial, setInitial] = useState<ChannelSettingsDraft | null>(null);
  const [draft, setDraft] = useState<ChannelSettingsDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);

  useEffect(() => {
    if (!open || !channel) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setLoadedChannel(null);
    setInitial(null);
    setDraft(null);
    api.channel(channel.channel_id).then(({ channel: details }) => {
      if (cancelled) return;
      const next = draftFromChannel(details);
      setLoadedChannel(details);
      setInitial(next);
      setDraft(next);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [channel?.channel_id, open]);

  const captionOptions = useMemo(() => [
    { value: "default" as const, label: t("channelSettingDefault") },
    { value: "off" as const, label: t("captionsOff") },
    ...SUBTITLE_LANGUAGES.map((language) => ({ value: `language:${language.code}` as CaptionChoice, label: language.label })),
  ], [t]);

  const save = async () => {
    if (!channel || !draft || !initial || saving) return;
    setSaving(true);
    setError("");
    try {
      const requests: Promise<unknown>[] = [];
      if (draft.status !== initial.status) requests.push(api.setChannelStatus(channel.channel_id, draft.status));
      if (draft.speed !== initial.speed) requests.push(api.setChannelSpeed(channel.channel_id, draft.speed || null));
      if (draft.captions !== initial.captions) {
        const language = draft.captions.startsWith("language:") ? draft.captions.slice("language:".length) : undefined;
        const mode = language ? "language" : draft.captions === "off" ? "off" : null;
        requests.push(api.setChannelCaptions(channel.channel_id, mode, language));
      }
      if (loadedChannel?.followed !== 0 && draft.membersOnly !== initial.membersOnly) {
        requests.push(api.setChannelMembersOnlyVisibility(channel.channel_id, draft.membersOnly));
      }
      if (loadedChannel?.followed !== 0 && draft.shorts !== initial.shorts) {
        requests.push(api.setChannelShortsFeedVisibility(channel.channel_id, draft.shorts));
      }
      await Promise.all(requests);
      onSaved?.();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const followed = loadedChannel?.followed !== 0;
  const title = channel?.title || channel?.channel_id || t("channelTechnicalSettings");

  return <>
    <Dialog
      open={open && !scheduleOpen}
      onOpenChange={onOpenChange}
      title={`${t("channelTechnicalSettings")} · ${title}`}
      closeLabel={t("close")}
      className="channel-settings-dialog"
      busy={saving}
      footer={<>
        <Button disabled={saving} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
        <Button variant="primary" disabled={loading || saving || !draft} onClick={() => void save()}>
          {saving && <LoaderCircle className="spin" />}{t("save")}
        </Button>
      </>}
    >
      {error && <Alert variant="danger" title={t("error")}>{error}</Alert>}
      {loading || !draft ? (
        <div className="channel-settings-dialog__loading"><LoaderCircle className="spin" />{t("loading")}</div>
      ) : <>
        <SettingsSection title={t("channelStatus")}>
          <SettingRow label={t("channelStatus")} description={draft.status !== "active" ? t("channelStatusSyncDisabled") : undefined}>
            <SelectMenu
              floating
              label={t("channelStatus")}
              value={draft.status}
              options={[
                { value: "active", label: t("channelStatusActive") },
                { value: "paused", label: t("channelStatusPaused") },
                { value: "broken", label: t("channelStatusBroken") },
                { value: "banned", label: t("channelStatusBanned") },
                { value: "deleted", label: t("channelStatusDeleted") },
              ]}
              onChange={(status) => setDraft((current) => current && ({ ...current, status }))}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection title={t("channelPlayback")}>
          <SettingRow label={t("channelSpeed")}>
            <SelectMenu
              floating
              label={t("channelSpeed")}
              value={draft.speed}
              options={[
                { value: "", label: t("channelSettingDefault") },
                ...PLAYBACK_SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` })),
              ]}
              onChange={(speed) => setDraft((current) => current && ({ ...current, speed }))}
            />
          </SettingRow>
          <SettingRow label={t("subtitles")}>
            <SelectMenu
              floating
              searchable
              label={t("subtitles")}
              value={draft.captions}
              options={captionOptions}
              onChange={(captions) => setDraft((current) => current && ({ ...current, captions }))}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection title={t("channelFeed")} description={!followed ? t("channelFeedFollowRequiredHint") : undefined}>
          <SettingRow label={t("channelMembersOnlyFeed")}>
            <SelectMenu
              floating
              disabled={!followed}
              label={t("channelMembersOnlyFeed")}
              value={draft.membersOnly}
              options={[
                { value: "default", label: t("channelSettingDefault") },
                { value: "everywhere", label: t("channelMembersOnlyEverywhere") },
                { value: "channel", label: t("channelMembersOnlyChannelOnly") },
                { value: "hidden", label: t("channelMembersOnlyNowhere") },
              ]}
              onChange={(membersOnly) => setDraft((current) => current && ({ ...current, membersOnly }))}
            />
          </SettingRow>
          <SettingRow label={t("channelShortsFeed")}>
            <SelectMenu
              floating
              disabled={!followed}
              label={t("channelShortsFeed")}
              value={draft.shorts}
              options={[
                { value: "default", label: t("channelSettingDefault") },
                { value: "show", label: t("channelShortsFeedShow") },
              ]}
              onChange={(shorts) => setDraft((current) => current && ({ ...current, shorts }))}
            />
          </SettingRow>
          <SettingRow label={t("channelRefreshSchedule")} description={t("channelRefreshScheduleHint")}>
            <Button disabled={!followed} leadingIcon={<CalendarClock />} onClick={() => setScheduleOpen(true)}>{t("channelRefreshSchedule")}</Button>
          </SettingRow>
        </SettingsSection>
      </>}
    </Dialog>
    {channel && <ChannelRefreshScheduleDialog channelId={channel.channel_id} open={scheduleOpen} onOpenChange={setScheduleOpen} onSaved={onSaved} />}
  </>;
}
