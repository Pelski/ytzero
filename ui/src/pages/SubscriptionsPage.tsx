import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Users } from "lucide-react";
import { api, type Channel, type Tag } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import TagChip from "../components/TagChip";
import TagFilterBar from "../components/TagFilterBar";
import { TableSkeleton } from "../components/LoadingState";
import ChannelSearchPicker from "../components/ChannelSearchPicker";
import { EmptyState, IconButton, OptionPicker, PageHeader, Popover } from "../components/ui";

type SubscriptionSort = "name-asc" | "name-desc" | "latest-video" | "subscribed-recent" | "subscribers-desc" | "videos-desc";

function subscriberNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.replace(",", ".").replace(/\s/g, "");
  const match = normalized.match(/([\d.]+)([KMB])/i);
  if (!match) return Number(normalized.replace(/[^\d.]/g, "")) || 0;
  const multiplier = match[2].toUpperCase() === "B" ? 1_000_000_000 : match[2].toUpperCase() === "M" ? 1_000_000 : 1_000;
  return Number(match[1]) * multiplier || 0;
}

function ChannelTagPicker({ channel, tags, onApply }: { channel: Channel; tags: Tag[]; onApply: (tags: Tag[]) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Tag[]>(channel.tags);

  const applyAndClose = () => {
    if (!open) return;
    setOpen(false);
    if (draft.map((tag) => tag.id).sort().join(",") !== channel.tags.map((tag) => tag.id).sort().join(",")) onApply(draft);
  };

  return (
    <div className="subs-card-tag-picker">
      <Popover open={open} onOpenChange={(next) => { if (next) { setDraft(channel.tags); setOpen(true); } else applyAndClose(); }} align="end" className="subs-card-tag-menu" trigger={<IconButton variant="ghost" size="sm" label={t("manageChannelTags")} icon={<Plus size={13} />} />}>
        {tags.length === 0 ? <div className="dropdown-empty">{t("noTags")}</div> : <OptionPicker label={t("manageChannelTags")} value={draft.map((tag) => tag.id)} options={tags.map((tag) => ({ value: tag.id, label: tag.name, icon: <span className="dot" style={{ background: tag.color }} /> }))} onChange={(id) => setDraft((current) => current.some((tag) => tag.id === id) ? current.filter((tag) => tag.id !== id) : [...current, tags.find((tag) => tag.id === id)!])} />}
      </Popover>
    </div>
  );
}

function ChannelTagsRow({ channel, tags, onApply }: { channel: Channel; tags: Tag[]; onApply: (tags: Tag[]) => void }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);

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
        <div className="subs-card-tags-list" ref={scrollerRef}>
          {channel.tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
        </div>
      </div>
      <ChannelTagPicker channel={channel} tags={tags} onApply={onApply} />
    </div>
  );
}

export default function SubscriptionsPage() {
  const { t } = useI18n();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SubscriptionSort>(() => {
    const stored = sessionStorage.getItem("subscriptionSort");
    return stored === "name-desc" || stored === "latest-video" || stored === "subscribed-recent" || stored === "subscribers-desc" || stored === "videos-desc" ? stored : "name-asc";
  });
  const [selectedTags, setSelectedTags] = useState<number[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("subscriptionTags") ?? "[]"); } catch { return []; }
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.channels(), api.tags()])
      .then(([channelResponse, tagResponse]) => {
        setChannels(channelResponse.channels.filter((ch) => ch.followed !== 0));
        setTags(tagResponse.tags);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    setSelectedTags((current) => {
      const next = current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id];
      sessionStorage.setItem("subscriptionTags", JSON.stringify(next));
      return next;
    });
  };

  const clearTagFilters = () => {
    setSelectedTags([]);
    sessionStorage.setItem("subscriptionTags", "[]");
  };

  const applyChannelTags = (channel: Channel, nextTags: Tag[]) => {
    const previousIds = new Set(channel.tags.map((tag) => tag.id));
    const nextIds = new Set(nextTags.map((tag) => tag.id));
    Promise.all([
      ...nextTags.filter((tag) => !previousIds.has(tag.id)).map((tag) => api.tagChannel(channel.channel_id, tag.id)),
      ...channel.tags.filter((tag) => !nextIds.has(tag.id)).map((tag) => api.untagChannel(channel.channel_id, tag.id)),
    ]).then(() => setChannels((current) => current.map((item) => item.channel_id === channel.channel_id ? { ...item, tags: nextTags } : item)))
      .catch(console.error);
  };

  return (
    <>
      <PageHeader title={t("subscriptions")} description={t("followedChannelsCount", { n: channels.length })} actions={<ChannelSearchPicker onAdded={load} />} />

      <div className="subs-toolbar">
        <div className="subs-search">
          <Search size={16} />
          <input
            value={query}
            placeholder={t("searchChannelPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="select subs-sort"
          value={sort}
          aria-label={t("subscriptionSort")}
          onChange={(event) => {
            const next = event.target.value as SubscriptionSort;
            setSort(next);
            sessionStorage.setItem("subscriptionSort", next);
          }}
        >
          <option value="name-asc">{t("subscriptionSortNameAsc")}</option>
          <option value="name-desc">{t("subscriptionSortNameDesc")}</option>
          <option value="latest-video">{t("subscriptionSortLatestVideo")}</option>
          <option value="subscribed-recent">{t("subscriptionSortRecentlyAdded")}</option>
          <option value="subscribers-desc">{t("subscriptionSortSubscribers")}</option>
          <option value="videos-desc">{t("subscriptionSortVideos")}</option>
        </select>
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
        <EmptyState icon={<Users />} title={query || selectedTags.length > 0 ? t("noMatchingChannels") : t("subscriptionsEmpty")} />
      ) : (
        <div className="subs-grid">
          {filteredChannels.map((ch) => (
            <div key={ch.channel_id} className="subs-card">
              <Link to={`/channel/${ch.channel_id}`} className="subs-card-main">
                {ch.thumbnail ? (
                  <img className="subs-card-avatar" src={img(ch.thumbnail)} alt="" loading="lazy" />
                ) : (
                  <div className="subs-card-avatar subs-card-avatar-fallback">
                    {(ch.title || ch.channel_id).charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="subs-card-body">
                  <div className="subs-card-title">{ch.title || ch.channel_id}</div>
                  {ch.subscriber_count && <div className="subs-card-meta">{ch.subscriber_count} {t("subscribers")}</div>}
                </div>
              </Link>
              <ChannelTagsRow channel={ch} tags={tags} onApply={(nextTags) => applyChannelTags(ch, nextTags)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
