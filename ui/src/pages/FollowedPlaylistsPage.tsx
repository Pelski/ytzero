import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ListVideo } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type FollowedPlaylistUpdates } from "../api";
import { img } from "../img";
import { formatPlaylistVideoCount, formatTimeAgo, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { VideoGridSkeleton } from "../components/LoadingState";
import { Badge, EmptyState, PageHeader } from "../components/ui";

export default function FollowedPlaylistsPage() {
  const { t, language } = useI18n();
  useDocumentTitle(t("navFollowedPlaylists"));
  const [playlists, setPlaylists] = useState<FollowedPlaylistUpdates[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.followedPlaylistUpdates()
      .then((result) => setPlaylists(result.playlists))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <PageHeader title={t("navFollowedPlaylists")} />
      {loading && playlists.length === 0 ? (
        <VideoGridSkeleton gridSize="sm" />
      ) : playlists.length === 0 ? (
        <EmptyState
          icon={<ListVideo />}
          title={t("followedPlaylistsEmptyTitle")}
          description={t("followedPlaylistsEmptyDescription")}
        />
      ) : (
        <div className="followed-playlists-view">
          {playlists.map((playlist) => (
            <section className="followed-playlist-section" key={playlist.playlist_id}>
              <header className="channel-playlist-hero channel-playlist-hero--compact">
                <Link className="channel-playlist-hero__media" to={`/playlist/${playlist.playlist_id}`}>
                  {playlist.thumbnail ? <img src={img(playlist.thumbnail)} alt="" /> : <div className="channel-playlist-hero__placeholder"><ListVideo /></div>}
                  <span className="channel-playlist-hero__count"><ListVideo /> {formatPlaylistVideoCount(playlist.video_count, language)}</span>
                </Link>
                <div className="channel-playlist-hero__content">
                  <div className="channel-playlist-hero__eyebrow">{t("publicPlaylist")}</div>
                  <Link className="followed-playlist-title-link" to={`/playlist/${playlist.playlist_id}`}>
                    <h2>{playlist.title}</h2>
                    <ChevronRight />
                  </Link>
                  <Link className="channel-playlist-hero__channel" to={`/channel/${playlist.channel_id}`}>
                    {playlist.channel_thumbnail ? <img src={img(playlist.channel_thumbnail)} alt="" /> : <span className="channel-playlist-hero__avatar-fallback">{playlist.channel_title.charAt(0).toUpperCase()}</span>}
                    <span className="channel-playlist-hero__channel-copy"><small>{t("playlistChannel")}</small><strong>{playlist.channel_title}</strong></span>
                  </Link>
                  <Badge variant={playlist.new_video_count > 0 ? "accent" : "neutral"} className="followed-playlist-new-count">
                    {playlist.new_video_count > 0 ? t("newPlaylistVideosCount", { count: playlist.new_video_count }) : t("noNewVideos")}
                  </Badge>
                </div>
              </header>

              {playlist.new_videos.length > 0 && (
                <div className="scheduled-list followed-playlist-videos">
                  {playlist.new_videos.map((video) => (
                    <article className="scheduled-item followed-playlist-video" key={video.video_id}>
                      <Link to={`/watch/${video.video_id}/playlist/${playlist.playlist_id}`} className="scheduled-thumb-link" aria-label={video.title} title={video.title}>
                        <VideoThumbnail src={img(video.thumbnail)} watched={video.watched === 1} progress={watchProgress(video.watch_position, video.watch_duration)} variant="scheduled" />
                      </Link>
                      <div className="scheduled-info">
                        <Link to={`/watch/${video.video_id}/playlist/${playlist.playlist_id}`} className="scheduled-title" title={video.title}>{video.title}</Link>
                        <div className="muted scheduled-channel">{video.channel_title}</div>
                      </div>
                      <div className="muted scheduled-date">{formatTimeAgo(video.published_at, language)}</div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
