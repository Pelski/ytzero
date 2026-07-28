import { useCallback, useEffect, useState } from "react";
import "./ChannelPlaylistPage.css";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Download, FileClock, ListMinus, ListPlus, ListVideo, RefreshCw } from "lucide-react";
import { api, type FollowedPlaylist, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { img } from "../img";
import { formatPlaylistVideoCount, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { Button, EmptyState, LocalToast, SectionHeader } from "../components/ui";
import Popconfirm from "../components/Popconfirm";

export default function ChannelPlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const [playlist, setPlaylist] = useState<FollowedPlaylist | null>(null);
  useDocumentTitle(playlist?.title);
  const [videos, setVideos] = useState<Video[]>([]);
  const [processingVideos, setProcessingVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    const [details, contents] = await Promise.all([api.channelPlaylist(id), api.channelPlaylistVideos(id)]);
    setPlaylist(details.playlist);
    setVideos(contents.videos);
    setProcessingVideos(contents.processing);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().catch(console.error).finally(() => setLoading(false));
  }, [load]);

  const toggleFollow = async () => {
    if (!id || !playlist) return;
    setPending(true);
    try {
      const next = !Boolean(playlist.followed);
      await api.followPlaylist(id, next);
      setPlaylist({ ...playlist, followed: next ? 1 : 0 });
    } finally { setPending(false); }
  };

  const sync = async () => {
    if (!id) return;
    setPending(true);
    try { await api.syncPlaylist(id); await load(); } finally { setPending(false); }
  };

  const downloadAll = async () => {
    if (!id) return;
    if (![...videos, ...processingVideos].some((video) => video.downloads_enabled)) { navigate("/downloads?view=configuration"); return; }
    setDownloadPending(true); setDownloadFeedback("");
    try {
      const result = await api.downloadChannelPlaylist(id);
      setDownloadFeedback(result.queued > 0 ? t("playlistDownloadQueued", { count: result.queued }) : t("playlistDownloadNone"));
      await load();
    } catch { setDownloadFeedback(t("playlistDownloadFailed")); }
    finally { setDownloadPending(false); }
  };

  const allPlaylistVideos = [...videos, ...processingVideos];

  if (loading && !playlist) return <VideoGridSkeleton gridSize="sm" />;
  if (!playlist) return <EmptyState title={t("playlistUnavailable")} />;

  return <>
    <header className="channel-playlist-hero">
      <div className="channel-playlist-hero__media">
        {playlist.thumbnail ? <img src={img(playlist.thumbnail)} alt="" /> : <div className="channel-playlist-hero__placeholder"><ListVideo /></div>}
        <span className="channel-playlist-hero__count"><ListVideo /> {formatPlaylistVideoCount(playlist.video_count, language)}</span>
      </div>
      <div className="channel-playlist-hero__content">
        <div className="channel-playlist-hero__eyebrow">{t("publicPlaylist")}</div>
        <h1>{playlist.title}</h1>
        <Link className="channel-playlist-hero__channel" to={`/channel/${playlist.channel_id}`}>
          {playlist.channel_thumbnail ? <img src={img(playlist.channel_thumbnail)} alt="" /> : <span className="channel-playlist-hero__avatar-fallback">{playlist.channel_title.charAt(0).toUpperCase()}</span>}
          <span className="channel-playlist-hero__channel-copy"><small>{t("playlistChannel")}</small><strong>{playlist.channel_title}</strong></span>
          <ChevronRight />
        </Link>
        <div className="channel-playlist-hero__actions">
          <Button onClick={sync} disabled={pending} leadingIcon={<RefreshCw className={pending ? "spin" : undefined} />}>{t("syncPlaylist")}</Button>
          <Button variant={playlist.followed ? "danger" : "primary"} onClick={toggleFollow} disabled={pending} leadingIcon={playlist.followed ? <ListMinus /> : <ListPlus />}>
            {playlist.followed ? t("unfollowPlaylist") : t("followPlaylist")}
          </Button>
          {allPlaylistVideos.length > 0 && allPlaylistVideos.some((video) => video.downloads_allowed) && (allPlaylistVideos.some((video) => video.downloads_enabled)
            ? <Popconfirm message={t("playlistDownloadConfirm", { count: allPlaylistVideos.length })} onConfirm={downloadAll}><Button disabled={downloadPending} leadingIcon={<Download />}>{t("playlistDownloadAll")}</Button></Popconfirm>
            : <Button onClick={downloadAll} leadingIcon={<Download />}>{t("playlistDownloadAll")}</Button>)}
          {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
        </div>
      </div>
    </header>
    {loading ? <VideoGridSkeleton gridSize="sm" /> : videos.length === 0 && processingVideos.length === 0 ? <EmptyState title={t("playlistIsEmpty")} /> : videos.length > 0 ?
      <div className="video-grid video-grid--sm">{videos.map((video) => <VideoCard key={video.video_id} video={video} onPlay={() => navigate(`/watch/${video.video_id}/playlist/${playlist.playlist_id}`)} onChanged={load} />)}</div> : null}
    {!loading && processingVideos.length > 0 && <section className="channel-playlist-processing">
      <SectionHeader title={t("processing")} icon={<FileClock />} />
      <div className="video-grid video-grid--sm">{processingVideos.map((video) => <VideoCard key={video.video_id} video={video} onPlay={() => navigate(`/watch/${video.video_id}/playlist/${playlist.playlist_id}`)} onChanged={load} />)}</div>
    </section>}
  </>;
}
