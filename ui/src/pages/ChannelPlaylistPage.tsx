import { useCallback, useEffect, useState } from "react";
import "./ChannelPlaylistPage.css";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Download, FileClock, ListMinus, ListPlus, RefreshCw } from "lucide-react";
import { api, type FollowedPlaylist, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { Button, EmptyState, LocalToast, SectionHeader, SelectMenu } from "../components/ui";
import Popconfirm from "../components/Popconfirm";
import ChannelPlaylistHero from "../components/ChannelPlaylistHero";
import { normalizePlaylistSort, playlistSortSearch, type PlaylistSort } from "../playlistSort";

export default function ChannelPlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = normalizePlaylistSort(searchParams.get("sort"));
  const { t } = useI18n();
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
    const [details, contents] = await Promise.all([api.channelPlaylist(id), api.channelPlaylistVideos(id, sort)]);
    setPlaylist(details.playlist);
    setVideos(contents.videos);
    setProcessingVideos(contents.processing);
  }, [id, sort]);

  const changeSort = (next: PlaylistSort) => {
    setSearchParams({ sort: next }, { replace: true });
  };

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
      const result = await api.downloadChannelPlaylist(id, sort);
      setDownloadFeedback(result.queued > 0 ? t("playlistDownloadQueued", { count: result.queued }) : t("playlistDownloadNone"));
      await load();
    } catch { setDownloadFeedback(t("playlistDownloadFailed")); }
    finally { setDownloadPending(false); }
  };

  const allPlaylistVideos = [...videos, ...processingVideos];

  if (loading && !playlist) return <VideoGridSkeleton gridSize="sm" />;
  if (!playlist) return <EmptyState title={t("playlistUnavailable")} />;

  return <>
    <ChannelPlaylistHero playlist={playlist} actions={<>
          <SelectMenu
            floating
            label={t("playlistSort")}
            value={sort}
            onChange={changeSort}
            options={[
              { value: "playlist-order", label: t("playlistSortOrder") },
              { value: "oldest", label: t("playlistSortOldest") },
              { value: "newest", label: t("playlistSortNewest") },
              { value: "title-asc", label: t("playlistSortTitleAsc") },
              { value: "title-desc", label: t("playlistSortTitleDesc") },
            ]}
          />
          <Button onClick={sync} disabled={pending} leadingIcon={<RefreshCw className={pending ? "spin" : undefined} />}>{t("syncPlaylist")}</Button>
          <Button variant={playlist.followed ? "danger" : "primary"} onClick={toggleFollow} disabled={pending} leadingIcon={playlist.followed ? <ListMinus /> : <ListPlus />}>
            {playlist.followed ? t("unfollowPlaylist") : t("followPlaylist")}
          </Button>
          {allPlaylistVideos.length > 0 && allPlaylistVideos.some((video) => video.downloads_allowed) && (allPlaylistVideos.some((video) => video.downloads_enabled)
            ? <Popconfirm message={t("playlistDownloadConfirm", { count: allPlaylistVideos.length })} onConfirm={downloadAll}><Button disabled={downloadPending} leadingIcon={<Download />}>{t("playlistDownloadAll")}</Button></Popconfirm>
            : <Button onClick={downloadAll} leadingIcon={<Download />}>{t("playlistDownloadAll")}</Button>)}
          {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
        </>} />
    {loading ? <VideoGridSkeleton gridSize="sm" /> : videos.length === 0 && processingVideos.length === 0 ? <EmptyState title={t("playlistIsEmpty")} /> : videos.length > 0 ?
      <div className="video-grid video-grid--sm">{videos.map((video) => <VideoCard key={video.video_id} video={video} onPlay={() => navigate(`/watch/${video.video_id}/playlist/${playlist.playlist_id}${playlistSortSearch(sort)}`)} onChanged={load} />)}</div> : null}
    {!loading && processingVideos.length > 0 && <section className="channel-playlist-processing">
      <SectionHeader title={t("processing")} icon={<FileClock />} />
      <div className="video-grid video-grid--sm">{processingVideos.map((video) => <VideoCard key={video.video_id} video={video} onPlay={() => navigate(`/watch/${video.video_id}/playlist/${playlist.playlist_id}${playlistSortSearch(sort)}`)} onChanged={load} />)}</div>
    </section>}
  </>;
}
