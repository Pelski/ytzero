import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Users } from "lucide-react";
import { api, type Channel } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import TagChip from "../components/TagChip";
import TagFilterBar from "../components/TagFilterBar";
import { TableSkeleton } from "../components/LoadingState";
import ChannelSearchPicker from "../components/ChannelSearchPicker";

export default function SubscriptionsPage() {
  const { t } = useI18n();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<number[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("subscriptionTags") ?? "[]"); } catch { return []; }
  });

  const load = useCallback(() => {
    setLoading(true);
    api
      .channels()
      .then((r) => setChannels(r.channels.filter((ch) => ch.followed !== 0)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tags = useMemo(() => {
    const unique = new Map<number, Channel["tags"][number]>();
    for (const channel of channels) {
      for (const tag of channel.tags) unique.set(tag.id, tag);
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [channels]);

  const filteredChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((ch) => {
      const title = (ch.title || "").toLowerCase();
      const id = ch.channel_id.toLowerCase();
      const matchesQuery = !q || title.includes(q) || id.includes(q);
      const matchesTags = selectedTags.length === 0 || ch.tags.some((tag) => selectedTags.includes(tag.id));
      return matchesQuery && matchesTags;
    });
  }, [channels, query, selectedTags]);

  const toggleTag = (id: number) => {
    setSelectedTags((current) => {
      const next = current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id];
      sessionStorage.setItem("subscriptionTags", JSON.stringify(next));
      return next;
    });
  };

  return (
    <>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{t("subscriptions")}</h1>
          <p className="page-hint">{t("followedChannelsCount", { n: channels.length })}</p>
        </div>
        <ChannelSearchPicker onAdded={load} />
      </div>

      <div className="subs-toolbar">
        <Search size={16} />
        <input
          value={query}
          placeholder={t("searchChannelPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <TagFilterBar
        tags={tags}
        selected={selectedTags}
        onToggle={toggleTag}
        onClearAll={() => { setSelectedTags([]); sessionStorage.removeItem("subscriptionTags"); }}
      />

      {loading ? (
        <TableSkeleton rows={8} columns={3} />
      ) : filteredChannels.length === 0 ? (
        <div className="empty-state">
          <Users />
          <div>{query || selectedTags.length > 0 ? t("noMatchingChannels") : t("subscriptionsEmpty")}</div>
        </div>
      ) : (
        <div className="subs-grid">
          {filteredChannels.map((ch) => (
            <Link key={ch.channel_id} to={`/channel/${ch.channel_id}`} className="subs-card">
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
                {ch.tags.length > 0 && (
                  <div className="subs-card-tags">
                    {ch.tags.map((tag) => (
                      <TagChip key={tag.id} tag={tag} />
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
