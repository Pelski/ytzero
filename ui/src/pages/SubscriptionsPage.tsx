import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Users } from "lucide-react";
import { api, type Channel } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import TagChip from "../components/TagChip";
import { TableSkeleton } from "../components/LoadingState";

export default function SubscriptionsPage() {
  const { t, language } = useI18n();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .channels()
      .then((r) => setChannels(r.channels.filter((ch) => ch.followed !== 0)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((ch) => {
      const title = (ch.title || "").toLowerCase();
      const id = ch.channel_id.toLowerCase();
      return title.includes(q) || id.includes(q);
    });
  }, [channels, query]);

  return (
    <>
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{t("subscriptions")}</h1>
          <p className="page-hint">
            {language === "pl"
              ? `${channels.length} obserwowanych kanałów`
              : `${channels.length} followed channels`}
          </p>
        </div>
      </div>

      <div className="subs-toolbar">
        <Search size={16} />
        <input
          value={query}
          placeholder={t("searchChannelPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <TableSkeleton rows={8} columns={3} />
      ) : filteredChannels.length === 0 ? (
        <div className="empty-state">
          <Users />
          <div>{query ? t("noMatchingChannels") : t("subscriptionsEmpty")}</div>
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
                {ch.subscriber_count && <div className="subs-card-meta">{ch.subscriber_count}</div>}
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
