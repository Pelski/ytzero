import { Check, Pencil, Search, UserPlus, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { api, type ChannelSearchResult } from "../api";
import { emit } from "../events";
import { img } from "../img";
import { useI18n } from "../i18n";

export default function ChannelSearchPicker({ onAdded }: { onAdded?: (name: string) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChannelSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  // Row with the optional "follow under a custom name" input open.
  const [namingId, setNamingId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");

  useEffect(() => {
    if (!open) return;
    api.channels()
      .then((response) => setFollowedIds(new Set(response.channels.filter((channel) => channel.followed !== 0).map((channel) => channel.channel_id))))
      .catch(console.error);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const value = query.trim();
    if (value.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.youtubeSearch(value)
        .then((response) => setResults(response.channels))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const addChannel = async (channel: ChannelSearchResult, name?: string) => {
    setAddingId(channel.channelId);
    setError("");
    try {
      const result = await api.addChannel(`https://www.youtube.com/channel/${channel.channelId}`, name);
      emit("channels-changed");
      onAdded?.(name || result.title || channel.title || channel.channelId);
      setFollowedIds((current) => new Set([...current, channel.channelId]));
      setNamingId(null);
      setCustomName("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error"));
    } finally {
      setAddingId(null);
    }
  };

  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>
        <Search size={15} /> {t("searchYouTube")}
      </button>
      {open && createPortal(
        <div className="channel-search-modal-backdrop" onMouseDown={() => setOpen(false)}>
          <div className="channel-search-modal" role="dialog" aria-modal="true" aria-label={t("searchYouTubeChannels")} onMouseDown={(event) => event.stopPropagation()}>
            <div className="channel-search-modal-header">
              <div>
                <h2>{t("addChannel")}</h2>
                <p>{t("searchYouTubeChannels")}</p>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} title={t("close")}><X size={17} /></button>
            </div>
            <div className="channel-search-picker-input">
              <Search size={16} />
              <input autoFocus value={query} placeholder={t("searchYouTubeChannels")} onChange={(event) => setQuery(event.target.value)} />
              {loading && <span className="channel-search-picker-loading" />}
            </div>
            {error && <div className="channel-search-error">{error}</div>}
            {results.length > 0 && (
              <div className="channel-search-results">
                {results.map((channel) => {
                  const followed = followedIds.has(channel.channelId);
                  const naming = namingId === channel.channelId;
                  return (
                    <div key={channel.channelId} className="channel-search-result">
                      {channel.thumbnail ? (
                        <img src={img(channel.thumbnail)} alt="" />
                      ) : (
                        <span className="channel-search-result-avatar">{channel.title.charAt(0).toUpperCase()}</span>
                      )}
                      <div className="channel-search-result-copy">
                        <strong>{channel.title}</strong>
                        {naming ? (
                          <input
                            className="channel-search-custom-name"
                            autoFocus
                            value={customName}
                            placeholder={t("customNameOptional")}
                            onChange={(event) => setCustomName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") addChannel(channel, customName.trim() || undefined);
                              if (event.key === "Escape") { setNamingId(null); setCustomName(""); }
                            }}
                          />
                        ) : (
                          <span>{[channel.handle, channel.subscriberCount].filter(Boolean).join(" · ")}</span>
                        )}
                      </div>
                      {!followed && (
                        <button
                          className="icon-btn"
                          title={naming ? t("cancel") : t("followWithCustomName")}
                          onClick={() => {
                            setNamingId(naming ? null : channel.channelId);
                            setCustomName("");
                          }}
                          disabled={addingId !== null}
                        >
                          {naming ? <X size={14} /> : <Pencil size={14} />}
                        </button>
                      )}
                      <button
                        className={`btn${followed ? " active" : " primary"}`}
                        onClick={() => addChannel(channel, naming ? customName.trim() || undefined : undefined)}
                        disabled={addingId !== null || followed}
                      >
                        {followed ? <Check size={15} /> : <UserPlus size={15} />}
                        {addingId === channel.channelId ? t("addingChannel") : followed ? t("channelFollowed") : t("follow")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
