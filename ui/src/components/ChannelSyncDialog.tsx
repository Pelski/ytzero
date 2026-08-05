import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, CircleOff, Clock3, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { ApiError, type Channel } from "../api";
import { channelCanSync, filterChannelSyncChoices, initialChannelSyncSelection } from "../channelSync";
import { img } from "../img";
import { formatChannelCount, useI18n } from "../i18n";
import { Alert, Badge, Button, Checkbox, Dialog, EmptyState, Input, InputGroup, List, ScrollArea } from "./ui";
import "./ChannelSyncDialog.css";

function manualStatusLabel(channel: Channel, t: ReturnType<typeof useI18n>["t"]): string {
  switch (channel.manual_status) {
    case "paused": return t("channelStatusPaused");
    case "broken": return t("channelStatusBroken");
    case "banned": return t("channelStatusBanned");
    case "deleted": return t("channelStatusDeleted");
    default: return t("channelStatusActive");
  }
}

export default function ChannelSyncDialog({ channels, open, onOpenChange, initialChannelIds, onStart }: {
  channels: Channel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialChannelIds?: string[];
  onStart: (channelIds: string[]) => Promise<unknown>;
}) {
  const { t, locale, language } = useI18n();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const selectionTitleId = useId();
  const warningId = useId();

  useEffect(() => {
    if (!open) return;
    setSelectedIds(initialChannelSyncSelection(channels, initialChannelIds));
    setQuery("");
    setError("");
  }, [open]); // Opening is the deliberate reset point; edits stay intact while the dialog is visible.

  const visibleChannels = useMemo(() => filterChannelSyncChoices(channels, query, locale), [channels, locale, query]);
  const visibleEligibleIds = useMemo(() => visibleChannels.filter(channelCanSync).map((channel) => channel.channel_id), [visibleChannels]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = visibleEligibleIds.length > 0 && visibleEligibleIds.every((channelId) => selectedSet.has(channelId));

  const toggle = (channelId: string) => {
    setSelectedIds((current) => current.includes(channelId)
      ? current.filter((id) => id !== channelId)
      : [...current, channelId]);
  };

  const start = async () => {
    if (selectedIds.length === 0 || starting) return;
    setStarting(true);
    setError("");
    try {
      await onStart(selectedIds);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 429
          ? t("channelSyncRateLimitError")
          : t("channelSyncStartFailed"));
    } finally {
      setStarting(false);
    }
  };
  const setOpen = (nextOpen: boolean) => {
    if (starting && !nextOpen) return;
    onOpenChange(nextOpen);
  };
  const selectVisible = () => setSelectedIds((current) => [...new Set([...current, ...visibleEligibleIds])]);

  return <Dialog
    open={open}
    onOpenChange={setOpen}
    title={t("channelSyncDialogTitle")}
    closeLabel={t("close")}
    className="channel-sync-dialog"
    descriptionId={warningId}
    dismissible={!starting}
    busy={starting}
    footer={<div className="channel-sync-dialog__footer-actions">
      <Button disabled={starting} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
      <Button
        variant="primary"
        leadingIcon={starting ? <LoaderCircle className="spin" /> : <RefreshCw />}
        disabled={starting || selectedIds.length === 0}
        onClick={() => void start()}
      >
        {starting ? t("channelSyncStarting") : t("channelSyncStart", { channels: formatChannelCount(selectedIds.length, language) })}
      </Button>
    </div>}
  >
    <div className="channel-sync-dialog__content" aria-busy={starting}>
      <div className="channel-sync-dialog__overview">
        <Alert id={warningId} className="channel-sync-dialog__warning" variant="warning" icon={<AlertTriangle />} title={t("channelSyncWarningTitle")}>
          {t("channelSyncWarning")}
        </Alert>
        <Alert className="channel-sync-dialog__background-note" variant="info" icon={<Clock3 />} title={t("channelSyncBackgroundTitle")}>
          {t("channelSyncBackground")}
        </Alert>
      </div>

      <section className="channel-sync-dialog__selection" aria-labelledby={selectionTitleId}>
        <header className="channel-sync-dialog__selection-header">
          <h3 id={selectionTitleId}>{t("channelSyncSelectionTitle")}</h3>
        </header>

        <div className="channel-sync-dialog__toolbar">
          <InputGroup prefix={<Search size={16} />}>
            <Input
              value={query}
              placeholder={t("channelSyncSearchPlaceholder")}
              aria-label={t("channelSyncSearchPlaceholder")}
              disabled={starting}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
          <div className="channel-sync-dialog__bulk-actions">
            <Button size="sm" variant="ghost" leadingIcon={<CheckCheck />} disabled={starting || visibleEligibleIds.length === 0 || allVisibleSelected} onClick={selectVisible}>{t("channelSyncSelectVisible")}</Button>
            <Button size="sm" variant="ghost" leadingIcon={<CircleOff />} disabled={starting || selectedIds.length === 0} onClick={() => setSelectedIds([])}>{t("channelSyncSelectNone")}</Button>
          </div>
        </div>

        <ScrollArea className="channel-sync-dialog__scroll" viewportClassName="channel-sync-dialog__viewport">
          {visibleChannels.length === 0 ? (
            <EmptyState compact icon={<Search />} title={t("channelSyncNoMatchingChannels")} />
          ) : (
            <List divided={false} className="channel-sync-dialog__list" aria-label={t("channelSyncSelectionTitle")}>
              {visibleChannels.map((channel) => {
                const enabled = channelCanSync(channel);
                const selected = selectedSet.has(channel.channel_id);
                const title = channel.title || channel.channel_id;
                return <div className="channel-sync-dialog__choice-row" role="listitem" key={channel.channel_id}>
                  <Checkbox
                    className={`channel-sync-dialog__choice${selected ? " channel-sync-dialog__choice--selected" : ""}`}
                    label={<span className="channel-sync-dialog__choice-content">
                      {channel.thumbnail ? <img src={img(channel.thumbnail)} alt="" loading="lazy" /> : <span className="channel-sync-dialog__avatar-fallback">{title.charAt(0).toUpperCase()}</span>}
                      <span className="channel-sync-dialog__choice-copy"><strong>{title}</strong><small>{channel.handle || channel.channel_id}</small></span>
                      {!enabled && <Badge size="sm" variant={channel.manual_status === "paused" ? "warning" : "danger"}>{manualStatusLabel(channel, t)}</Badge>}
                    </span>}
                    aria-label={t("channelSyncIncludeChannel", { channel: title })}
                    checked={selected}
                    disabled={!enabled || starting}
                    onChange={() => toggle(channel.channel_id)}
                  />
                </div>;
              })}
            </List>
          )}
        </ScrollArea>
      </section>

      {error && <Alert variant="danger">{error}</Alert>}
    </div>
  </Dialog>;
}
