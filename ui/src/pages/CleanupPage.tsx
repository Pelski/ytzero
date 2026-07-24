import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eraser, Inbox } from "lucide-react";
import { api, type Channel, type CleanupFilter, type CleanupPreviewResult, type Tag } from "../api";
import { formatChannelCount, formatVideoCount, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { emit } from "../events";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import TagFilterBar from "../components/TagFilterBar";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Inline,
  MultiSelectMenu,
  PageHeader,
  SegmentedControl,
  SettingRow,
  SettingsSection,
  Switch,
  Tabs,
} from "../components/ui";
import "./CleanupPage.css";

type CleanupStatus = NonNullable<CleanupFilter["status"]>;
type CleanupAction = "archive" | "watched";
type ChannelMode = "include" | "exclude";
type Side = "clean" | "remain";

const DATE_PRESET_DAYS = [7, 14, 30, 90] as const;
const EMPTY_PREVIEW: CleanupPreviewResult = { videos: [], total: 0, page: 0, limit: 0 };

function daysAgoDateInput(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

export default function CleanupPage() {
  const { t, language } = useI18n();
  useDocumentTitle(t("cleanupTitle"));

  const [channels, setChannels] = useState<Channel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [status, setStatus] = useState<CleanupStatus>("inbox");
  const [beforeDate, setBeforeDate] = useState("");
  const [channelMode, setChannelMode] = useState<ChannelMode>("exclude");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [includeTagIds, setIncludeTagIds] = useState<number[]>([]);
  const [excludeTagIds, setExcludeTagIds] = useState<number[]>([]);
  const [includeHidden, setIncludeHidden] = useState(false);

  const [excludedVideoIds, setExcludedVideoIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [side, setSide] = useState<Side>("clean");
  const [cleanResult, setCleanResult] = useState<CleanupPreviewResult>(EMPTY_PREVIEW);
  const [remainResult, setRemainResult] = useState<CleanupPreviewResult>(EMPTY_PREVIEW);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [action, setAction] = useState<CleanupAction>("archive");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ affected: number } | null>(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    api.channels().then((r) => setChannels(r.channels.filter((ch) => ch.followed !== 0))).catch(() => {});
    api.tags().then((r) => setTags(r.tags)).catch(() => {});
  }, []);

  const filter: CleanupFilter = useMemo(() => ({
    status,
    before: beforeDate ? `${beforeDate}T00:00:00.000Z` : null,
    channels: channelIds.length ? { mode: channelMode, ids: channelIds } : null,
    tags: (includeTagIds.length || excludeTagIds.length) ? { include: includeTagIds, exclude: excludeTagIds } : null,
    include_hidden: includeHidden,
  }), [status, beforeDate, channelMode, channelIds, includeTagIds, excludeTagIds, includeHidden]);

  const excludeArray = useMemo(() => [...excludedVideoIds], [excludedVideoIds]);

  // Exceptions belong to the current result set — a real filter change (not a
  // per-card exclude toggle, which is handled entirely locally below) starts fresh.
  const reloadTimer = useRef<number | null>(null);
  useEffect(() => {
    setLoadingPreview(true);
    setApplied(null);
    setExcludedVideoIds(new Set());
    setRemovingIds(new Set());
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      Promise.all([
        api.cleanupPreview(filter, "clean", { excludeVideoIds: [] }),
        api.cleanupPreview(filter, "remain", { excludeVideoIds: [] }),
      ])
        .then(([clean, remain]) => {
          setCleanResult(clean);
          setRemainResult(remain);
        })
        .catch(console.error)
        .finally(() => setLoadingPreview(false));
    }, 300);
    return () => { if (reloadTimer.current) window.clearTimeout(reloadTimer.current); };
  }, [filter]);

  const loadMore = useCallback((targetSide: Side) => {
    const current = targetSide === "clean" ? cleanResult : remainResult;
    setLoadingMore(true);
    api.cleanupPreview(filter, targetSide, { excludeVideoIds: excludeArray, page: current.page + 1 })
      .then((r) => {
        const merged = { ...r, videos: [...current.videos, ...r.videos] };
        if (targetSide === "clean") setCleanResult(merged);
        else setRemainResult(merged);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  }, [filter, excludeArray, cleanResult, remainResult]);

  // Unchecking a card in the "to clean" list excludes it from the operation. Fully
  // local: fade the card out, then drop it from the list and shift the count over
  // to "stays" — no refetch, so the rest of the grid never flickers or reflows.
  const CARD_REMOVE_MS = 260;
  const toggleExclude = (videoId: string) => {
    if (excludedVideoIds.has(videoId)) return;
    setRemovingIds((prev) => new Set(prev).add(videoId));
    window.setTimeout(() => {
      setExcludedVideoIds((prev) => new Set(prev).add(videoId));
      setCleanResult((prev) => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
        videos: prev.videos.filter((v) => v.video_id !== videoId),
      }));
      setRemainResult((prev) => ({ ...prev, total: prev.total + 1 }));
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
    }, CARD_REMOVE_MS);
  };

  const toggleChannel = (ids: string[]) => setChannelIds(ids);

  const cycleTag = (id: number) => {
    if (includeTagIds.includes(id)) {
      setIncludeTagIds((prev) => prev.filter((t) => t !== id));
      setExcludeTagIds((prev) => [...prev, id]);
    } else if (excludeTagIds.includes(id)) {
      setExcludeTagIds((prev) => prev.filter((t) => t !== id));
    } else {
      setIncludeTagIds((prev) => [...prev, id]);
    }
  };

  const clearTagFilters = () => {
    setIncludeTagIds([]);
    setExcludeTagIds([]);
  };

  const apply = async () => {
    setApplying(true);
    try {
      const result = await api.cleanupApply(filter, action, excludeArray);
      setConfirmOpen(false);
      setExcludedVideoIds(new Set());
      setApplied({ affected: result.affected });
      emit("queue-changed");
      const [clean, remain] = await Promise.all([
        api.cleanupPreview(filter, "clean", { excludeVideoIds: [] }),
        api.cleanupPreview(filter, "remain", { excludeVideoIds: [] }),
      ]);
      setCleanResult(clean);
      setRemainResult(remain);
    } catch (e) {
      console.error(e);
    } finally {
      setApplying(false);
    }
  };

  const undo = async () => {
    setUndoing(true);
    try {
      await api.cleanupUndo();
      setApplied(null);
      emit("queue-changed");
      const [clean, remain] = await Promise.all([
        api.cleanupPreview(filter, "clean", { excludeVideoIds: excludeArray }),
        api.cleanupPreview(filter, "remain", { excludeVideoIds: excludeArray }),
      ]);
      setCleanResult(clean);
      setRemainResult(remain);
    } catch (e) {
      console.error(e);
    } finally {
      setUndoing(false);
    }
  };

  const channelOptions = useMemo(
    () => channels.map((ch) => ({ value: ch.channel_id, label: ch.title || ch.channel_id, searchText: ch.title || ch.channel_id })),
    [channels],
  );

  const active = side === "clean" ? cleanResult : remainResult;
  const noOp = useMemo(
    () => !beforeDate && channelIds.length === 0 && includeTagIds.length === 0 && excludeTagIds.length === 0,
    [beforeDate, channelIds, includeTagIds, excludeTagIds],
  );

  return (
    <>
      <PageHeader icon={<Eraser />} title={t("cleanupTitle")} description={t("cleanupDescription")} />

      {applied && (
        <Alert variant="success" icon={<CheckCircle2 size={16} />} className="cleanup-applied-banner">
          <Inline gap={3} justify="between">
            <span>{t("cleanupApplied", { count: formatVideoCount(applied.affected, language) })}</span>
            <Button size="sm" onClick={undo} disabled={undoing}>{t("undo")}</Button>
          </Inline>
        </Alert>
      )}

      <SettingsSection className="cleanup-filters">
        <SettingRow label={t("cleanupStatusLabel")}>
          <SegmentedControl
            value={status}
            onChange={setStatus}
            label={t("cleanupStatusLabel")}
            options={[
              { value: "inbox", label: t("cleanupStatusInbox") },
              { value: "queued", label: t("cleanupStatusQueued") },
              { value: "all", label: t("cleanupStatusAll") },
            ]}
          />
        </SettingRow>

        <SettingRow label={t("cleanupBeforeLabel")} description={t("cleanupBeforeHint")}>
          <Inline gap={2}>
            <input
              type="date"
              className="ui-input"
              value={beforeDate}
              max={TODAY}
              onChange={(e) => setBeforeDate(e.target.value)}
            />
            {DATE_PRESET_DAYS.map((days) => (
              <button key={days} type="button" className="chip" onClick={() => setBeforeDate(daysAgoDateInput(days))}>
                {t("cleanupDaysAgo", { n: days })}
              </button>
            ))}
            {beforeDate && (
              <button type="button" className="chip chip-clear" onClick={() => setBeforeDate("")}>{t("clear")}</button>
            )}
          </Inline>
        </SettingRow>

        {channels.length > 0 && (
          <SettingRow label={t("cleanupChannelsLabel")}>
            <Inline gap={2}>
              <SegmentedControl
                value={channelMode}
                onChange={setChannelMode}
                label={t("cleanupChannelsLabel")}
                options={[
                  { value: "include", label: t("cleanupChannelModeInclude") },
                  { value: "exclude", label: t("cleanupChannelModeExclude") },
                ]}
              />
              <MultiSelectMenu
                values={channelIds}
                onChange={toggleChannel}
                options={channelOptions}
                label={t("cleanupChannelsLabel")}
                searchable
                emptyLabel={t("cleanupChannelsAny")}
                summary={(selected) => selected.length === 0 ? t("cleanupChannelsAny") : formatChannelCount(selected.length, language)}
              />
            </Inline>
          </SettingRow>
        )}

        {tags.length > 0 && (
          <SettingRow label={t("cleanupTagsLabel")} description={t("cleanupTagsHint")}>
            <TagFilterBar
              tags={tags}
              tristate
              selected={includeTagIds}
              excludedIds={excludeTagIds}
              onCycle={cycleTag}
              onClearAll={clearTagFilters}
            />
          </SettingRow>
        )}

        <SettingRow label={t("cleanupIncludeHidden")} description={t("cleanupIncludeHiddenHint")}>
          <Switch checked={includeHidden} onCheckedChange={setIncludeHidden} ariaLabel={t("cleanupIncludeHidden")} />
        </SettingRow>
      </SettingsSection>

      {noOp ? (
        <Alert variant="info" className="cleanup-noop-hint">{t("cleanupNoFilterHint")}</Alert>
      ) : (
        <>
          <Tabs
            className="cleanup-tabs"
            value={side}
            onChange={setSide}
            label={t("cleanupTitle")}
            options={[
              { value: "clean", label: t("cleanupToClean"), count: cleanResult.total },
              { value: "remain", label: t("cleanupRemain"), count: remainResult.total },
            ]}
          />

          {loadingPreview ? (
            <VideoGridSkeleton />
          ) : active.videos.length === 0 ? (
            <EmptyState className="cleanup-grid" icon={<Inbox />} title={side === "clean" ? t("cleanupEmptyClean") : t("cleanupEmptyRemain")} />
          ) : (
            <>
              <div className="video-grid cleanup-grid">
                {active.videos.map((v) => (
                  side === "clean" ? (
                    <div key={v.video_id} className={`cleanup-card${removingIds.has(v.video_id) ? " cleanup-card--removing" : ""}`}>
                      <VideoCard
                        video={v}
                        onPlay={() => {}}
                        onChanged={() => {}}
                        selectable
                        selected={!removingIds.has(v.video_id)}
                        onSelectToggle={toggleExclude}
                      />
                    </div>
                  ) : (
                    <VideoCard key={v.video_id} video={v} onPlay={() => {}} onChanged={() => {}} readOnly />
                  )
                ))}
              </div>
              {loadingMore && <VideoGridSkeleton count={4} />}
              {!loadingMore && active.videos.length < active.total && (
                <div className="load-more">
                  <Button onClick={() => loadMore(side)}>{t("loadMore")}</Button>
                </div>
              )}
            </>
          )}

          <div className="cleanup-action-bar">
            <SegmentedControl
              value={action}
              onChange={setAction}
              label={t("cleanupActionLabel")}
              options={[
                { value: "archive", label: t("cleanupActionArchive") },
                { value: "watched", label: t("cleanupActionWatched") },
              ]}
            />
            <Button
              variant="primary"
              disabled={cleanResult.total === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Eraser size={16} />
              {t("cleanupApplyButton", { count: formatVideoCount(cleanResult.total, language) })}
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("cleanupConfirmTitle")}
        closeLabel={t("close")}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>{t("cancel")}</Button>
            <Button variant="danger" onClick={apply} disabled={applying}>
              {applying ? t("cleanupApplying") : t("cleanupConfirmConfirm")}
            </Button>
          </>
        }
      >
        <p>
          {t("cleanupConfirmBody", {
            count: formatVideoCount(cleanResult.total, language),
            action: action === "archive" ? t("cleanupActionArchive") : t("cleanupActionWatched"),
          })}
        </p>
      </Dialog>
    </>
  );
}
