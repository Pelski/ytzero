import { useCallback, useEffect, useState, type ReactNode } from "react";
import "./SearchPage.css";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { api, type Channel, type ChannelSearchResult, type SearchResult, type Video } from "../api";
import { formatPublishedAgo, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { img } from "../img";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { Button, EmptyState } from "../components/ui";

// Result lists collapse to this many rows, with a "show more" toggle beyond it.
const PREVIEW_COUNT = 3;

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// Renders the first PREVIEW_COUNT rows, then reveals the rest with a smooth
// height animation behind a show more/less toggle. `expanded`/`onToggle` are
// optional: pass them when the parent also needs to react (e.g. to load more
// data on expand); omit them to let the component manage its own state.
function RevealList<T>({ items, renderRow, listClassName, showMore, showLess, expanded: controlledExpanded, onToggle, busy }: {
  items: T[];
  renderRow: (item: T) => ReactNode;
  listClassName: string;
  showMore: string;
  showLess: string;
  expanded?: boolean;
  onToggle?: () => void;
  busy?: boolean;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const toggle = onToggle ?? (() => setInternalExpanded((value) => !value));
  const rest = items.slice(PREVIEW_COUNT);
  return (
    <div className="reveal-list">
      <div className={listClassName}>{items.slice(0, PREVIEW_COUNT).map(renderRow)}</div>
      {(rest.length > 0 || (expanded && busy)) && (
        <>
          <div className={`reveal-more${expanded ? " reveal-more--open" : ""}`}>
            <div className={`reveal-more__inner ${listClassName}`}>{rest.map(renderRow)}</div>
          </div>
          <div className="reveal-toggle">
            <Button size="sm" onClick={toggle} disabled={busy}>{expanded ? showLess : showMore}</Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function SearchPage({ onPlay, hideExternalSearch = false }: { onPlay: (video: Video) => void; hideExternalSearch?: boolean }) {
  const { t, locale, language } = useI18n();
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  useDocumentTitle(q || t("searchTitle"));
  const [videos, setVideos] = useState<Video[]>([]);
  const [localChannels, setLocalChannels] = useState<Channel[]>([]);
  const [ytResults, setYtResults] = useState<SearchResult[]>([]);
  const [ytChannels, setYtChannels] = useState<ChannelSearchResult[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localLoadingMore, setLocalLoadingMore] = useState(false);
  const [localResultsExpanded, setLocalResultsExpanded] = useState(false);
  const [ytLoading, setYtLoading] = useState(false);

  const reloadLocalVideos = useCallback(() => {
    if (!q) return;
    api.feed({ q, limit: localResultsExpanded ? 100 : 8, status: "all" })
      .then((feed) => setVideos(feed.videos))
      .catch(() => setVideos([]));
  }, [localResultsExpanded, q]);

  const toggleLocalResults = () => {
    if (localResultsExpanded) { setLocalResultsExpanded(false); return; }
    // Expanding may reveal more than the initial page held, so pull the rest.
    setLocalLoadingMore(true);
    api.feed({ q, limit: 100, status: "all" })
      .then((feed) => {
        setVideos(feed.videos);
        setLocalResultsExpanded(true);
      })
      .catch(() => {})
      .finally(() => setLocalLoadingMore(false));
  };

  useEffect(() => {
    if (!q) { setVideos([]); setLocalChannels([]); return; }
    let cancelled = false;
    setLocalResultsExpanded(false);
    setLocalLoading(true);
    Promise.all([
      api.feed({ q, limit: 8, status: "all" }),
      api.channels(),
    ]).then(([feed, channels]) => {
      if (cancelled) return;
      const needle = normalizeSearchText(q);
      setVideos(feed.videos);
      setLocalChannels(channels.channels.filter((channel) =>
        normalizeSearchText(channel.title).includes(needle)
        || normalizeSearchText(channel.channel_id).includes(needle)
        || normalizeSearchText(channel.handle ?? "").includes(needle)
        || normalizeSearchText(channel.description ?? "").includes(needle)));
    }).catch(() => {
      if (!cancelled) { setVideos([]); setLocalChannels([]); }
    }).finally(() => { if (!cancelled) setLocalLoading(false); });
    return () => { cancelled = true; };
  }, [q]);

  useEffect(() => {
    if (!q || hideExternalSearch) { setYtResults([]); setYtChannels([]); return; }
    let cancelled = false;
    setYtLoading(true);
    api.youtubeSearch(q)
      .then((result) => { if (!cancelled) { setYtResults(result.results); setYtChannels(result.channels); } })
      .catch(() => { if (!cancelled) { setYtResults([]); setYtChannels([]); } })
      .finally(() => { if (!cancelled) setYtLoading(false); });
    return () => { cancelled = true; };
  }, [q, hideExternalSearch]);

  if (!q) {
    return <EmptyState icon={<Search />} title={t("searchPlaceholder")} />;
  }

  const localChannelIds = new Set(localChannels.map((channel) => channel.channel_id));
  const youtubeChannels = ytChannels.filter((channel) => !localChannelIds.has(channel.channelId));

  return (
    <div className="search-page">
      <p className="search-info">{t("searchResultsFor")} <b>{q}</b></p>

      {(localLoading || localChannels.length > 0 || videos.length > 0) && (
        <section className="search-results-section search-results-section--local">
          {(localLoading || localChannels.length > 0) && <>
          <div className="search-results-header">{t("localSearchChannels")}</div>
          {localLoading ? <div className="search-channel-loading" /> : (
            <RevealList
              key={q}
              items={localChannels}
              listClassName="yt-results-list yt-channel-results-list"
              showMore={t("showMore")}
              showLess={t("showLess")}
              renderRow={(channel) => (
                <Link key={channel.channel_id} className="yt-result-row" to={`/channel/${channel.channel_id}`}>
                  {channel.thumbnail ? <img className="yt-search-channel-avatar" src={img(channel.thumbnail)} alt="" loading="lazy" /> : <div className="yt-search-channel-avatar yt-search-channel-avatar--fallback">{channel.title.charAt(0).toUpperCase()}</div>}
                  <div className="yt-result-info">
                    <div className="yt-result-title">{channel.title}</div>
                    <div className="yt-result-meta">{[channel.subscriber_count && `${channel.subscriber_count} ${t("subscribers")}`, ...channel.tags.map((tag) => tag.name)].filter(Boolean).join(" · ")}</div>
                  </div>
                </Link>
              )}
            />
          )}
          </>}

          {(localLoading || videos.length > 0) && <div className="search-local-videos-section">
          <div className="search-results-header">{t("localSearchVideos")}</div>
          {localLoading ? <VideoGridSkeleton count={3} gridSize="sm" /> : (
            <RevealList
              items={videos}
              listClassName="search-local-video-list"
              showMore={t("showMore")}
              showLess={t("showLess")}
              expanded={localResultsExpanded}
              onToggle={toggleLocalResults}
              busy={localLoadingMore}
              renderRow={(video) => <VideoCard key={video.video_id} video={video} onPlay={onPlay} onChanged={reloadLocalVideos} searchResultLayout />}
            />
          )}
          </div>}
        </section>
      )}

      {!hideExternalSearch && (
        <section className="search-results-section">
          {youtubeChannels.length > 0 && (
            <>
              <div className="search-results-header">{t("channels")}</div>
              <RevealList
                key={q}
                items={youtubeChannels}
                listClassName="yt-results-list yt-channel-results-list"
                showMore={t("showMore")}
                showLess={t("showLess")}
                renderRow={(channel) => (
                  <Link key={channel.channelId} className="yt-result-row" to={`/channel/${channel.channelId}`}>
                    {channel.thumbnail ? <img className="yt-search-channel-avatar" src={img(channel.thumbnail)} alt="" loading="lazy" /> : <div className="yt-search-channel-avatar" />}
                    <div className="yt-result-info">
                      <div className="yt-result-title">{channel.title}</div>
                      <div className="yt-result-meta">{[channel.handle, channel.subscriberCount && `${channel.subscriberCount} ${t("subscribers")}`, channel.videoCount].filter(Boolean).join(" · ")}</div>
                    </div>
                  </Link>
                )}
              />
            </>
          )}
          <div className="search-results-header">{t("youtubeResults")}</div>
          {ytLoading ? <VideoGridSkeleton count={4} gridSize="sm" /> : ytResults.length === 0 ? null : (
            <div className="yt-results-list">
              {ytResults.map((result) => (
                <Link key={result.videoId} className="yt-result-row" to={`/watch/${result.videoId}`} title={result.title}>
                  <VideoThumbnail src={img(result.thumbnail)} watched={result.watched === 1} progress={watchProgress(result.watch_position, result.watch_duration)} variant="search" loading="lazy">
                    {result.duration && <span className="yt-result-dur">{result.duration}</span>}
                  </VideoThumbnail>
                  <div className="yt-result-info">
                    <div className="yt-result-title">{result.title}</div>
                    {(result.viewCount != null || result.published) && <div className="yt-result-meta">{result.viewCount != null && `${result.viewCount.toLocaleString(locale)} ${t("views")}`}{result.viewCount != null && result.published && " · "}{result.published && formatPublishedAgo(result.published, language)}</div>}
                    <div className="yt-result-channel">{result.channelAvatar && <img className="yt-result-avatar" src={img(result.channelAvatar)} alt="" loading="lazy" />}<span>{result.channelTitle}</span></div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
