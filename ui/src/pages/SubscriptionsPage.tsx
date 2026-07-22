import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Plus, Search, Users } from "lucide-react";
import { api, type Channel, type Tag } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import TagChip from "../components/TagChip";
import TagCreateForm from "../components/TagCreateForm";
import TagFilterBar from "../components/TagFilterBar";
import { TableSkeleton } from "../components/LoadingState";
import ChannelSearchPicker from "../components/ChannelSearchPicker";
import { EmptyState, IconButton, PageHeader, Popover, SelectMenu } from "../components/ui";
import { emit } from "../events";

type SubscriptionSort = "name-asc" | "name-desc" | "latest-video" | "subscribed-recent" | "subscribers-desc" | "videos-desc";

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
      <Popover open={open} onOpenChange={setOpen} align="end" className="subs-card-tag-menu dropdown-menu" trigger={<IconButton variant="ghost" size="sm" label={t("manageChannelTags")} icon={<Plus size={13} />} />}>
        {tags.map((tag) => {
          const selected = channel.tags.some((item) => item.id === tag.id);
          return <button
            type="button"
            key={tag.id}
            className={selected ? "is-selected" : undefined}
            onClick={() => onApply(selected ? channel.tags.filter((item) => item.id !== tag.id) : [...channel.tags, tag])}
            title={selected ? t("removeTagFromChannel") : t("tagToChannel")}
          >
            <span className="tag-picker-color-dot" style={{ background: tag.color }} />
            {tag.name}
            {selected && <span className="dropdown-menu-status" aria-label={t("selectedTag")}><Check size={14} /></span>}
          </button>;
        })}
        <TagCreateForm title={t("newTag")} name={newTagName} color={newTagColor} placeholder={t("tagNamePlaceholder")} submitLabel={t("addTag")} disabled={creating} onNameChange={setNewTagName} onColorChange={setNewTagColor} onSubmit={createAndApplyTag} />
      </Popover>
    </div>
  );
}

function ChannelTagsRow({ channel, tags, onApply, onTagCreated }: { channel: Channel; tags: Tag[]; onApply: (tags: Tag[]) => void; onTagCreated: (tag: Tag) => void }) {
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
      <ChannelTagPicker channel={channel} tags={tags} onApply={onApply} onTagCreated={onTagCreated} />
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
              <ChannelTagsRow channel={ch} tags={tags} onApply={(nextTags) => applyChannelTags(ch, nextTags)} onTagCreated={(tag) => setTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag])} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
