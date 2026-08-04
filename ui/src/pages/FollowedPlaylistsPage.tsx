import { useCallback, useEffect, useState } from "react";
import "./FollowedPlaylistsPage.css";
import { Link } from "react-router-dom";
import { api, type FollowedPlaylistUpdates } from "../api";
import { img } from "../img";
import { formatTimeAgo, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { VideoGridSkeleton } from "../components/LoadingState";
import { Badge, EmptyState, PageHeader } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import ChannelPlaylistHero from "../components/ChannelPlaylistHero";

export default function FollowedPlaylistsPage() {
  const { t, language } = useI18n();
  useDocumentTitle(t("navFollowedPlaylists"));
  const [playlists, setPlaylists] = useState<FollowedPlaylistUpdates[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.followedPlaylistUpdates()
      .then((result) => {
        setPlaylists(result.playlists);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <PageHeader title={t("navFollowedPlaylists")} />
      {loading && playlists.length === 0 ? (
        <VideoGridSkeleton gridSize="sm" />
      ) : playlists.length === 0 ? (
        <EmptyState
          art={<EmptyArt scene="playlistEmpty" />}
          title={t("followedPlaylistsEmptyTitle")}
          description={t("followedPlaylistsEmptyDescription")}
        />
      ) : (
        <div className="followed-playlists-view">
          {playlists.map((playlist) => (
            <section className="followed-playlist-section" key={playlist.playlist_id}>
              <ChannelPlaylistHero
                playlist={playlist}
                compact
                status={<Badge variant={playlist.new_video_count > 0 ? "accent" : "neutral"} className="followed-playlist-new-count">
                  {playlist.new_video_count > 0 ? t("newPlaylistVideosCount", { count: playlist.new_video_count }) : t("noNewVideos")}
                </Badge>}
              />

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
