import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./SubscriptionsPage.css";
import { Link } from "react-router-dom";
import { AlertTriangle, Clock3, LoaderCircle, Plus, RefreshCw, Search, Users, XCircle } from "lucide-react";
import { api, type Channel, type ChannelSyncJob, type ChannelSyncJobChannel, type Tag } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import TagChip from "../components/TagChip";
import TagCreateForm from "../components/TagCreateForm";
import TagFilterBar from "../components/TagFilterBar";
import TagPickerMenu from "../components/TagPickerMenu";
import { TableSkeleton } from "../components/LoadingState";
import ChannelSearchPicker from "../components/ChannelSearchPicker";
import ChannelSyncDialog from "../components/ChannelSyncDialog";
import { Badge, Button, EmptyState, IconButton, PageHeader, Popover, ProgressBar, SelectMenu, useHorizontalDragScroll } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import { emit, emitToast } from "../events";
import { channelCanSync, isChannelSyncRateLimitMessage } from "../channelSync";
import { useChannelSyncActivity } from "../useChannelSyncActivity";

type SubscriptionSort = "name-asc" | "name-desc" | "latest-video" | "subscribed-recent" | "subscribers-desc" | "videos-desc";
const SYNC_SUMMARY_AUTO_DISMISS_MS = 8_000;

function ChannelSyncSummary({ job }: { job: ChannelSyncJob }) {
  const { t } = useI18n();
  const running = job.status === "running";
  const complete = job.status === "completed";
  const completeWithErrors = complete && job.failed > 0;
  const rateLimited = job.channels.some((channel) => isChannelSyncRateLimitMessage(channel.error));
  const title = running ? t("channelSyncRunning") : completeWithErrors ? t("channelSyncCompletedWithErrors") : complete ? t("channelSyncCompleted") : t("channelSyncHalted");

  return <section className={`subs-sync-summary subs-sync-summary--${job.status}${completeWithErrors ? " subs-sync-summary--errors" : ""}`} aria-live="polite">
    <div className="subs-sync-summary__header">
      <div className="subs-sync-summary__title">
        {running ? <LoaderCircle className="spin" /> : !complete ? <AlertTriangle /> : null}
        <strong>{title}</strong>
      </div>
    </div>
    {running && job.currentChannelTitle && <div className="subs-sync-summary__current">{t("channelSyncCurrentChannel", { channel: job.currentChannelTitle })}</div>}
    <ProgressBar
      className={complete && !completeWithErrors ? "subs-sync-summary__progress--success" : undefined}
      value={job.processed}
      max={Math.max(1, job.total)}
      label={t("channelSyncProgressLabel")}
    />
    <div className="subs-sync-summary__result">
      <span>{t("channelSyncResultSucceeded", { count: job.succeeded })}</span>
      <span>{t("channelSyncResultFailed", { count: job.failed })}</span>
      <span>{t("channelSyncResultSkipped", { count: job.skipped })}</span>
      <span>{t("channelSyncResultAdded", { count: job.added })}</span>
    </div>
    {job.status === "halted" && <div className="subs-sync-summary__reason">{rateLimited ? t("channelSyncRateLimitError") : t("channelSyncHaltedReason")}</div>}
  </section>;
}

function ChannelSyncCardStatus({ channel }: { channel: ChannelSyncJobChannel }) {
  const { t } = useI18n();
  if (channel.status === "completed") return null;

  const copy = channel.status === "pending" ? t("channelSyncStatusPending")
    : channel.status === "running" ? t("channelSyncStatusRunning")
    : channel.status === "failed" ? t("channelSyncStatusFailed")
    : t("channelSyncStatusSkipped");
  const variant = channel.status === "failed" ? "danger"
    : channel.status === "skipped" ? "warning"
    : channel.status === "running" ? "accent"
    : "neutral";
  const icon = channel.status === "running" ? <LoaderCircle className="spin" />
    : channel.status === "failed" ? <XCircle />
    : channel.status === "skipped" ? <AlertTriangle />
    : <Clock3 />;

  const error = channel.status === "failed" && channel.error
    ? isChannelSyncRateLimitMessage(channel.error) ? t("channelSyncRateLimitError") : channel.error
    : null;
  return <div className="subs-card-sync-result">
    <Badge className="subs-card-sync-status" size="sm" variant={variant}>{icon}{copy}</Badge>
    {error && <span className="subs-card-sync-error">{error}</span>}
  </div>;
}

function subscriberNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.replace(",", ".").replace(/\s/g, "");
  const match = normalized.match(/([\d.]+)([KMB])/i);
  if (!match) return Number(normalized.replace(/[^\d.]/g, "")) || 0;
  const multiplier = match[2].toUpperCase() === "B" ? 1_000_000_000 : match[2].toUpperCase() === "M" ? 1_000_000 : 1_000;
  return Number(match[1]) * multiplier || 0;
}

function ChannelTagPicker({ channel, tags, onApply, onTagCreated }: { channel: Channel; tags: Tag[]; onApply: (tags: Tag[]) => void; onTagCreated: (tag: Tag) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3ea6ff");
  const [creating, setCreating] = useState(false);

  const createAndApplyTag = async () => {
    if (!newTagName.trim() || creating) return;
    setCreating(true);
    try {
      const response = await api.addTag(newTagName.trim(), newTagColor);
      const next = channel.tags.some((tag) => tag.id === response.tag.id) ? channel.tags : [...channel.tags, response.tag];
      onTagCreated(response.tag);
      setNewTagName("");
      setOpen(false);
      onApply(next);
      emit("tags-changed");
    } catch (error) {
      console.error(error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="subs-card-tag-picker">
      <Popover open={open} onOpenChange={setOpen} align="end" surface="menu" className="tag-picker-popover subs-card-tag-menu" trigger={<IconButton variant="ghost" size="sm" label={t("manageChannelTags")} icon={<Plus size={13} />} />}>
        <TagPickerMenu
          tags={tags}
          selectedTagIds={channel.tags.map((tag) => tag.id)}
          onToggle={(tag) => {
            const selected = channel.tags.some((item) => item.id === tag.id);
            onApply(selected ? channel.tags.filter((item) => item.id !== tag.id) : [...channel.tags, tag]);
          }}
        >
          <TagCreateForm title={t("newTag")} name={newTagName} color={newTagColor} placeholder={t("tagNamePlaceholder")} submitLabel={t("addTag")} disabled={creating} onNameChange={setNewTagName} onColorChange={setNewTagColor} onSubmit={createAndApplyTag} />
        </TagPickerMenu>
      </Popover>
    </div>
  );
}

function ChannelTagsRow({ channel, tags, onApply, onTagCreated }: { channel: Channel; tags: Tag[]; onApply: (tags: Tag[]) => void; onTagCreated: (tag: Tag) => void }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);
  const { dragScrollProps, dragScrollClassName } = useHorizontalDragScroll<HTMLDivElement>();

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      setShadowLeft(scroller.scrollLeft > 2);
      setShadowRight(scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - 2);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [channel.tags.length]);

  return (
    <div className="subs-card-tags-row">
      <div className={`subs-card-tags-scroll${shadowLeft ? " shadow-left" : ""}${shadowRight ? " shadow-right" : ""}`}>
        <div className={`subs-card-tags-list ${dragScrollClassName}`} ref={scrollerRef} {...dragScrollProps}>
          {channel.tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
        </div>
      </div>
      <ChannelTagPicker channel={channel} tags={tags} onApply={onApply} onTagCreated={onTagCreated} />
    </div>
  );
}

export default function SubscriptionsPage() {
  const { t } = useI18n();
  useDocumentTitle(t("subscriptions"));
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SubscriptionSort>(() => {
    const stored = sessionStorage.getItem("subscriptionSort");
    return stored === "name-desc" || stored === "latest-video" || stored === "subscribed-recent" || stored === "subscribers-desc" || stored === "videos-desc" ? stored : "name-asc";
  });
  // Intentionally not persisted (unlike sort): a forgotten tag filter would
  // silently hide newly-followed channels that have no tags yet, making them
  // look "missing" from subscriptions. Always start unfiltered.
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncDialogChannelIds, setSyncDialogChannelIds] = useState<string[] | undefined>();
  const { job: syncJob, loading: syncActivityLoading, start: startChannelSync } = useChannelSyncActivity();
  const [dismissedSyncJobId, setDismissedSyncJobId] = useState<string | null>(null);
  const syncRunning = syncJob?.status === "running";
  const syncFinishedAt = Date.parse(syncJob?.finishedAt ?? "");
  const syncSummaryExpired = syncJob?.status === "completed" && syncJob.failed === 0
    && Number.isFinite(syncFinishedAt) && Date.now() - syncFinishedAt >= SYNC_SUMMARY_AUTO_DISMISS_MS;
  const channelSyncStates = useMemo(() => new Map(syncJob?.channels.map((channel) => [channel.channelId, channel]) ?? []), [syncJob]);
  const refreshedTerminalJobsRef = useRef(new Set<string>());
  const refreshingTerminalJobsRef = useRef(new Set<string>());

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.channels(), api.tags()])
      .then(([channelResponse, tagResponse]) => {
        setChannels(channelResponse.channels.filter((ch) => ch.followed !== 0));
        setTags(tagResponse.tags);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshChannelsAfterSync = useCallback(async () => {
    const response = await api.channels();
    setChannels(response.channels.filter((channel) => channel.followed !== 0));
    emit("channels-changed");
  }, []);

  useEffect(() => {
    if (!syncJob || syncJob.status === "running" || refreshedTerminalJobsRef.current.has(syncJob.id) || refreshingTerminalJobsRef.current.has(syncJob.id)) return;
    // A terminal snapshot may arrive live or be recovered after reconnect. In
    // both cases refresh derived counts/latest metadata once, without replacing
    // the page with a loading skeleton or looping on subsequent SSE snapshots.
    const jobId = syncJob.id;
    refreshingTerminalJobsRef.current.add(jobId);
    let cancelled = false;
    let retryTimer = 0;
    let attempts = 0;
    const refresh = () => {
      attempts++;
      void refreshChannelsAfterSync().then(() => {
        refreshedTerminalJobsRef.current.add(jobId);
        refreshingTerminalJobsRef.current.delete(jobId);
      }).catch((error) => {
        console.error(error);
        if (!cancelled && attempts < 3) retryTimer = window.setTimeout(refresh, 3_000);
        else refreshingTerminalJobsRef.current.delete(jobId);
      });
    };
    refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      refreshingTerminalJobsRef.current.delete(jobId);
    };
  }, [refreshChannelsAfterSync, syncJob?.id, syncJob?.status]);

  useEffect(() => {
    if (!syncJob || syncJob.status !== "completed" || syncJob.failed > 0) return;
    const finishedAt = Date.parse(syncJob.finishedAt ?? "");
    const remaining = Number.isFinite(finishedAt)
      ? Math.max(0, SYNC_SUMMARY_AUTO_DISMISS_MS - (Date.now() - finishedAt))
      : SYNC_SUMMARY_AUTO_DISMISS_MS;
    const timer = window.setTimeout(() => setDismissedSyncJobId(syncJob.id), remaining);
    return () => window.clearTimeout(timer);
  }, [syncJob?.failed, syncJob?.finishedAt, syncJob?.id, syncJob?.status]);

  const filteredChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = channels.filter((ch) => {
      const title = (ch.title || "").toLowerCase();
      const id = ch.channel_id.toLowerCase();
      const matchesQuery = !q || title.includes(q) || id.includes(q);
      const matchesTags = selectedTags.length === 0 || ch.tags.some((tag) => selectedTags.includes(tag.id));
      return matchesQuery && matchesTags;
    });
    return filtered.sort((a, b) => {
      if (sort === "name-desc") return (b.title || b.channel_id).localeCompare(a.title || a.channel_id);
      if (sort === "latest-video") return (b.latest_video_at || "").localeCompare(a.latest_video_at || "") || (a.title || "").localeCompare(b.title || "");
      if (sort === "subscribed-recent") return (b.subscribed_at || "").localeCompare(a.subscribed_at || "") || (a.title || "").localeCompare(b.title || "");
      if (sort === "subscribers-desc") return subscriberNumber(b.subscriber_count) - subscriberNumber(a.subscriber_count) || (a.title || "").localeCompare(b.title || "");
      if (sort === "videos-desc") return (b.video_count ?? 0) - (a.video_count ?? 0) || (a.title || "").localeCompare(b.title || "");
      return (a.title || a.channel_id).localeCompare(b.title || b.channel_id);
    });
  }, [channels, query, selectedTags, sort]);

  const toggleTag = (id: number) => {
    setSelectedTags((current) => current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id]);
  };

  const clearTagFilters = () => {
    setSelectedTags([]);
  };

  const applyChannelTags = (channel: Channel, nextTags: Tag[]) => {
    const previousTags = channel.tags;
    const previousIds = new Set(channel.tags.map((tag) => tag.id));
    const nextIds = new Set(nextTags.map((tag) => tag.id));
    // Reflect the choice immediately. Network completion should not be needed
    // for chips and tag filters on this page to update.
    setChannels((current) => current.map((item) => item.channel_id === channel.channel_id ? { ...item, tags: nextTags } : item));
    Promise.all([
      ...nextTags.filter((tag) => !previousIds.has(tag.id)).map((tag) => api.tagChannel(channel.channel_id, tag.id)),
      ...channel.tags.filter((tag) => !nextIds.has(tag.id)).map((tag) => api.untagChannel(channel.channel_id, tag.id)),
    ]).then(() => emit("tags-changed"))
      .catch((error) => {
        console.error(error);
        // Do not overwrite a newer edit if another change happened meanwhile.
        const expected = [...nextIds].sort().join(",");
        setChannels((current) => current.map((item) =>
          item.channel_id === channel.channel_id && item.tags.map((tag) => tag.id).sort().join(",") === expected
            ? { ...item, tags: previousTags }
            : item
        ));
      });
  };

  const startSync = async (channelIds: string[]) => {
    await startChannelSync(channelIds);
    emitToast(t("channelSyncStarted"), "scheduled");
  };

  const openSyncDialog = (channelIds?: string[]) => {
    setSyncDialogChannelIds(channelIds);
    setSyncDialogOpen(true);
  };
  const setSyncDialogVisibility = (open: boolean) => {
    setSyncDialogOpen(open);
    if (!open) setSyncDialogChannelIds(undefined);
  };

  return (
    <>
      <PageHeader className="subscriptions-page-header" title={t("subscriptions")} description={t("followedChannelsCount", { n: channels.length })} actions={<>
        <Button leadingIcon={<RefreshCw className={syncRunning ? "spin" : undefined} />} disabled={loading || syncActivityLoading || channels.every((channel) => !channelCanSync(channel))} onClick={() => openSyncDialog()}>{t("channelSyncChannels")}</Button>
        <ChannelSearchPicker onAdded={load} />
      </>} />

      {syncJob && !syncSummaryExpired && syncJob.id !== dismissedSyncJobId && <ChannelSyncSummary job={syncJob} />}

      <div className="subs-toolbar">
        <div className="subs-search">
          <Search size={16} />
          <input
            value={query}
            placeholder={t("searchChannelPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <SelectMenu
          className="subs-sort"
          value={sort}
          label={t("subscriptionSort")}
          options={[
            { value: "name-asc", label: t("subscriptionSortNameAsc") },
            { value: "name-desc", label: t("subscriptionSortNameDesc") },
            { value: "latest-video", label: t("subscriptionSortLatestVideo") },
            { value: "subscribed-recent", label: t("subscriptionSortRecentlyAdded") },
            { value: "subscribers-desc", label: t("subscriptionSortSubscribers") },
            { value: "videos-desc", label: t("subscriptionSortVideos") },
          ] as const}
          onChange={(next: SubscriptionSort) => {
            setSort(next);
            sessionStorage.setItem("subscriptionSort", next);
          }}
        />
      </div>

      <TagFilterBar
        tags={tags}
        selected={selectedTags}
        onToggle={toggleTag}
        onClearAll={clearTagFilters}
      />

      {loading ? (
        <TableSkeleton rows={8} columns={3} />
      ) : filteredChannels.length === 0 ? (
        query || selectedTags.length > 0 ? (
          // A filtered miss is a query outcome, not a milestone — stays plain
          // (it reappears on every keystroke). The useful thing here is a way out.
          <EmptyState
            icon={<Users />}
            title={t("noMatchingChannels")}
            description={t("noMatchingChannelsHint")}
            action={<Button onClick={() => { setQuery(""); setSelectedTags([]); }}>{t("clearFilters")}</Button>}
          />
        ) : (
          <EmptyState art={<EmptyArt scene="noSubscriptions" />} title={t("subscriptionsEmpty")} description={t("subscriptionsEmptyHint")} />
        )
      ) : (
        <div className="subs-grid">
          {filteredChannels.map((ch) => {
            const syncState = channelSyncStates.get(ch.channel_id);
            const syncEnabled = channelCanSync(ch);
            const title = ch.title || ch.channel_id;
            return <div key={ch.channel_id} className="subs-card">
              <div className="subs-card-head">
                <Link to={`/channel/${ch.channel_id}`} className="subs-card-main">
                  {ch.thumbnail ? (
                    <img className="subs-card-avatar" src={img(ch.thumbnail)} alt="" loading="lazy" />
                  ) : (
                    <div className="subs-card-avatar subs-card-avatar-fallback">
                      {title.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="subs-card-body">
                    <div className="subs-card-title">{title}</div>
                    {ch.subscriber_count && <div className="subs-card-meta">{ch.subscriber_count} {t("subscribers")}</div>}
                  </div>
                </Link>
                <IconButton
                  className="subs-card-sync-button"
                  size="sm"
                  variant="ghost"
                  label={t("channelSyncCardAction", { channel: title })}
                  title={!syncEnabled ? t("channelStatusSyncDisabled") : t("channelSyncCardAction", { channel: title })}
                  icon={<RefreshCw className={syncState?.status === "running" ? "spin" : undefined} />}
                  disabled={!syncEnabled || syncActivityLoading}
                  onClick={() => openSyncDialog([ch.channel_id])}
                />
              </div>
              {syncState && <ChannelSyncCardStatus channel={syncState} />}
              <ChannelTagsRow channel={ch} tags={tags} onApply={(nextTags) => applyChannelTags(ch, nextTags)} onTagCreated={(tag) => setTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag])} />
            </div>;
          })}
        </div>
      )}

      <ChannelSyncDialog channels={channels} open={syncDialogOpen} onOpenChange={setSyncDialogVisibility} initialChannelIds={syncDialogChannelIds} onStart={startSync} />
    </>
  );
}
