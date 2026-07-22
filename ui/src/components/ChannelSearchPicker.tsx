import { Check, Pencil, Search, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ChannelSearchResult } from "../api";
import { emit } from "../events";
import { img } from "../img";
import { useI18n } from "../i18n";
import { Button, Dialog, IconButton, Input, List, ListRow } from "./ui";
import "./ChannelSearchPicker.css";

const SEARCH_DEBOUNCE_MS = 1_800;

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
  const hasSearchQuery = query.trim().length >= 2;

  useEffect(() => {
    if (!open) return;
    api.channels()
      .then((response) => setFollowedIds(new Set(response.channels.filter((channel) => channel.followed !== 0).map((channel) => channel.channel_id))))
      .catch(console.error);
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
    }, SEARCH_DEBOUNCE_MS);
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
      <Button variant="primary" leadingIcon={<Search size={15} />} onClick={() => setOpen(true)}>{t("searchYouTube")}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={t("addChannel")} closeLabel={t("close")} className="channel-search-dialog">
            <p className="channel-search-modal-description">{t("searchYouTubeChannels")}</p>
            <div className="channel-search-picker-input">
              <Search size={16} />
              <Input autoFocus value={query} placeholder={t("searchYouTubeChannels")} onChange={(event) => setQuery(event.target.value)} />
              {loading && <span className="channel-search-picker-loading" />}
            </div>
            {error && <div className="channel-search-error">{error}</div>}
            {results.length > 0 && (
              <List className="channel-search-results">
                {results.map((channel) => {
                  const followed = followedIds.has(channel.channelId);
                  const naming = namingId === channel.channelId;
                  return (
                    <ListRow key={channel.channelId} className="channel-search-result" media={channel.thumbnail ? (
                        <Link className="channel-search-result-link" to={`/channel/${channel.channelId}`} aria-label={channel.title} onClick={() => setOpen(false)}><img className="channel-search-result-avatar-media" src={img(channel.thumbnail)} alt="" /></Link>
                      ) : (
                        <Link className="channel-search-result-avatar channel-search-result-link" to={`/channel/${channel.channelId}`} aria-label={channel.title} onClick={() => setOpen(false)}>{channel.title.charAt(0).toUpperCase()}</Link>
                      )} actions={<>
                      {!followed && (
                        <IconButton
                          variant="ghost"
                          label={naming ? t("cancel") : t("followWithCustomName")}
                          icon={naming ? <X size={14} /> : <Pencil size={14} />}
                          onClick={() => {
                            setNamingId(naming ? null : channel.channelId);
                            setCustomName("");
                          }}
                          disabled={addingId !== null}
                        />
                      )}
                      <Button
                        variant={followed ? "secondary" : "primary"}
                        leadingIcon={followed ? <Check size={15} /> : <UserPlus size={15} />}
                        onClick={() => addChannel(channel, naming ? customName.trim() || undefined : undefined)}
                        disabled={addingId !== null || followed}
                      >
                        {addingId === channel.channelId ? t("addingChannel") : followed ? t("channelFollowed") : t("follow")}
                      </Button>
                      </>}>
                      <div className="channel-search-result-copy">
                        <Link className="channel-search-result-title" to={`/channel/${channel.channelId}`} onClick={() => setOpen(false)}>{channel.title}</Link>
                        {naming ? (
                          <Input
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
                    </ListRow>
                  );
                })}
              </List>
            )}
            {hasSearchQuery && !loading && results.length === 0 && !error && <p className="channel-search-empty">{t("noMatchingChannels")}</p>}
      </Dialog>
    </>
  );
}
