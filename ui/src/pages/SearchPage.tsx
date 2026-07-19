import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { api, type Channel, type ChannelSearchResult, type SearchResult, type Video } from "../api";
import { formatPublishedAgo, useI18n } from "../i18n";
import { img } from "../img";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { VideoThumbnail } from "../components/VideoThumbnail";

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export default function SearchPage({ onPlay, hideExternalSearch = false }: { onPlay: (video: Video) => void; hideExternalSearch?: boolean }) {
  const { t, locale, language } = useI18n();
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
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

  const showAllLocalResults = () => {
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
    return <div className="empty-state"><Search /><div>{t("searchPlaceholder")}</div></div>;
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
            <div className="yt-results-list yt-channel-results-list">
              {localChannels.slice(0, 7).map((channel) => (
                <Link key={channel.channel_id} className="yt-result-row" to={`/channel/${channel.channel_id}`}>
                  {channel.thumbnail ? <img className="yt-search-channel-avatar" src={img(channel.thumbnail)} alt="" loading="lazy" /> : <div className="yt-search-channel-avatar yt-search-channel-avatar--fallback">{channel.title.charAt(0).toUpperCase()}</div>}
                  <div className="yt-result-info">
                    <div className="yt-result-title">{channel.title}</div>
                    <div className="yt-result-meta">{[channel.subscriber_count && `${channel.subscriber_count} ${t("subscribers")}`, ...channel.tags.map((tag) => tag.name)].filter(Boolean).join(" · ")}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
          </>}

          {(localLoading || videos.length > 0) && <div className="search-local-videos-section">
          <div className="search-results-header">{t("localSearchVideos")}</div>
          {localLoading ? <VideoGridSkeleton count={3} gridSize="sm" /> : (
            <>
              <div className="search-local-video-list">
                {(localResultsExpanded ? videos : videos.slice(0, 7)).map((video) => <VideoCard key={video.video_id} video={video} onPlay={onPlay} onChanged={reloadLocalVideos} searchResultLayout />)}
              </div>
              {!localResultsExpanded && videos.length > 7 && (
                <div className="search-local-load-more">
                  <button className="btn" onClick={showAllLocalResults} disabled={localLoadingMore}>
                    {localLoadingMore ? t("loading") : t("showAllResults")}
                  </button>
                </div>
              )}
            </>
          )}
          </div>}
        </section>
      )}

      {!hideExternalSearch && (
        <section className="search-results-section">
          {youtubeChannels.length > 0 && (
            <>
              <div className="search-results-header">{t("channels")}</div>
              <div className="yt-results-list yt-channel-results-list">
                {youtubeChannels.map((channel) => (
                  <Link key={channel.channelId} className="yt-result-row" to={`/channel/${channel.channelId}`}>
                    {channel.thumbnail ? <img className="yt-search-channel-avatar" src={img(channel.thumbnail)} alt="" loading="lazy" /> : <div className="yt-search-channel-avatar" />}
                    <div className="yt-result-info">
                      <div className="yt-result-title">{channel.title}</div>
                      <div className="yt-result-meta">{[channel.handle, channel.subscriberCount && `${channel.subscriberCount} ${t("subscribers")}`, channel.videoCount].filter(Boolean).join(" · ")}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
          <div className="search-results-header">{t("youtubeResults")}</div>
          {ytLoading ? <VideoGridSkeleton count={4} gridSize="sm" /> : ytResults.length === 0 ? null : (
            <div className="yt-results-list">
              {ytResults.map((result) => (
                <Link key={result.videoId} className="yt-result-row" to={`/watch/${result.videoId}`}>
                  <VideoThumbnail src={result.thumbnail} watched={result.watched === 1} variant="search" loading="lazy">
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
