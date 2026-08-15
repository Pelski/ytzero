import { useCallback, useEffect, useState } from "react";
import "./ChannelPlaylistPage.css";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Download, FileClock, ListMinus, ListPlus, MoreHorizontal, RefreshCw } from "lucide-react";
import { api, type FollowedPlaylist, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { EmptyState, IconButton, LocalToast, Menu, MenuItem, MenuSeparator, Popover, SectionHeader, SelectMenu } from "../components/ui";
import Popconfirm from "../components/Popconfirm";
import ChannelPlaylistHero from "../components/ChannelPlaylistHero";
import PlaylistPlaybackActions from "../components/PlaylistPlaybackActions";
import { normalizePlaylistSort, playlistSortSearch, type PlaylistSort } from "../playlistSort";
import { videosInPlaylistOrder } from "../playlistPlayback";

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
  const [videoOrder, setVideoOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [details, contents] = await Promise.all([api.channelPlaylist(id), api.channelPlaylistVideos(id, sort)]);
    setPlaylist(details.playlist);
    setVideos(contents.videos);
    setProcessingVideos(contents.processing);
    setVideoOrder(contents.order);
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
  const orderedPlaylistVideos = videosInPlaylistOrder(allPlaylistVideos, videoOrder);
  const canDownloadPlaylist = allPlaylistVideos.length > 0 && allPlaylistVideos.some((video) => video.downloads_allowed);
  const playPlaylistVideo = (video: Video) => {
    if (id) navigate(`/watch/${video.video_id}/playlist/${id}${playlistSortSearch(sort)}`);
  };

  if (loading && !playlist) return <VideoGridSkeleton gridSize="sm" />;
  if (!playlist) return <EmptyState title={t("playlistUnavailable")} />;
  const downloadMenuItem = !canDownloadPlaylist ? null : allPlaylistVideos.some((video) => video.downloads_enabled)
    ? <Popconfirm
        triggerClassName="ui-menu__popover-trigger"
        message={t("playlistDownloadConfirm", { count: allPlaylistVideos.length })}
        onConfirm={() => { setActionsOpen(false); void downloadAll(); }}
      >
        <MenuItem disabled={downloadPending} icon={<Download />}>{t("playlistDownloadAll")}</MenuItem>
      </Popconfirm>
    : <MenuItem icon={<Download />} onClick={() => { setActionsOpen(false); void downloadAll(); }}>{t("playlistDownloadAll")}</MenuItem>;

  return <>
    <ChannelPlaylistHero playlist={playlist} actions={<>
          <PlaylistPlaybackActions videos={orderedPlaylistVideos} disabled={loading} onPlay={playPlaylistVideo} />
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
          {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
          <Popover
            align="end"
            surface="menu"
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            trigger={<IconButton variant={actionsOpen ? "secondary" : "ghost"} label={t("moreActions")} icon={<MoreHorizontal />} />}
          >
            <Menu>
              <MenuItem
                disabled={pending}
                icon={<RefreshCw className={pending ? "spin" : undefined} />}
                onClick={() => { setActionsOpen(false); void sync(); }}
              >
                {t("syncPlaylist")}
              </MenuItem>
              {downloadMenuItem}
              <MenuSeparator />
              <MenuItem
                disabled={pending}
                icon={playlist.followed ? <ListMinus /> : <ListPlus />}
                onClick={() => { setActionsOpen(false); void toggleFollow(); }}
              >
                {playlist.followed ? t("unfollowPlaylist") : t("followPlaylist")}
              </MenuItem>
            </Menu>
          </Popover>
        </>} />
    {loading ? <VideoGridSkeleton gridSize="sm" /> : videos.length === 0 && processingVideos.length === 0 ? <EmptyState title={t("playlistIsEmpty")} /> : videos.length > 0 ?
      <div className="video-grid video-grid--sm">{videos.map((video) => <VideoCard key={video.video_id} video={video} onPlay={playPlaylistVideo} onChanged={load} />)}</div> : null}
    {!loading && processingVideos.length > 0 && <section className="channel-playlist-processing">
      <SectionHeader title={t("processing")} icon={<FileClock />} />
      <div className="video-grid video-grid--sm">{processingVideos.map((video) => <VideoCard key={video.video_id} video={video} onPlay={playPlaylistVideo} onChanged={load} />)}</div>
    </section>}
  </>;
}
