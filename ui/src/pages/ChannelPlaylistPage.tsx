import { useCallback, useEffect, useState } from "react";
import "./ChannelPlaylistPage.css";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bell, Download, FileClock, Gauge, ListFilter, ListMinus, ListPlus, MoreHorizontal, RefreshCw } from "lucide-react";
import { api, type DownloadQuality, type FollowedPlaylist, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { EmptyState, IconButton, LocalToast, Menu, MenuItem, MenuSeparator, Popover, SectionHeader } from "../components/ui";
import Popconfirm from "../components/Popconfirm";
import ChannelPlaylistHero from "../components/ChannelPlaylistHero";
import PlaylistPlaybackActions from "../components/PlaylistPlaybackActions";
import { normalizePlaylistSort, playlistSortSearch, type PlaylistSort } from "../playlistSort";
import { videosInPlaylistOrder } from "../playlistPlayback";
import NotificationSourceMenu from "../components/NotificationSourceMenu";
import type { NotificationSourceMode } from "../components/NotificationSourceSelect";
import { HeaderSettingsHeader, HeaderSettingsItem, HeaderSettingsOption, HeaderSettingsPopover } from "../components/HeaderSettingsMenu";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<"root" | "sort" | "notifications" | "downloads" | "download-quality">("root");
  const [notificationMode, setNotificationMode] = useState<NotificationSourceMode>("default");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [offlinePolicySaving, setOfflinePolicySaving] = useState(false);
  const [downloadQualitySaving, setDownloadQualitySaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [details, contents, preferences] = await Promise.all([api.channelPlaylist(id), api.channelPlaylistVideos(id, sort), api.notificationPreferences()]);
    setPlaylist(details.playlist);
    setVideos(contents.videos);
    setProcessingVideos(contents.processing);
    setVideoOrder(contents.order);
    const value = preferences.playlists.find((source) => source.playlist_id === id)?.notification_enabled;
    setNotificationMode(value == null ? "default" : value === 1 ? "on" : "off");
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
      setPlaylist({ ...playlist, followed: next ? 1 : 0, offline_policy: next ? playlist.offline_policy : "none", download_quality: next ? playlist.download_quality : null });
    } finally { setPending(false); }
  };

  const sync = async () => {
    if (!id) return;
    setPending(true);
    try { await api.syncPlaylist(id); await load(); } finally { setPending(false); }
  };

  const changeNotificationMode = async (next: NotificationSourceMode) => {
    if (!id || notificationSaving || !playlist?.followed) return;
    const previous = notificationMode;
    setNotificationMode(next);
    setNotificationSaving(true);
    try {
      await api.updateNotificationSource("playlist", id, next === "default" ? null : next === "on");
    } catch (error) {
      setNotificationMode(previous);
      console.error(error);
    } finally { setNotificationSaving(false); }
  };

  const changeOfflinePolicy = async (next: FollowedPlaylist["offline_policy"]) => {
    if (!id || offlinePolicySaving || !playlist?.followed) return;
    const previous = playlist.offline_policy;
    setPlaylist({ ...playlist, offline_policy: next });
    setOfflinePolicySaving(true);
    setDownloadFeedback("");
    try {
      await api.updateFollowedPlaylistDownloadSettings(id, { offline_policy: next });
      setDownloadFeedback(t(next === "none" ? "playlistOfflineDisabled" : next === "download" ? "playlistOfflineEnabled" : "playlistKeepOfflineEnabled"));
    } catch (error) {
      setPlaylist((current) => current ? { ...current, offline_policy: previous } : current);
      setDownloadFeedback(t("playlistOfflineFailed"));
      console.error(error);
    } finally {
      setOfflinePolicySaving(false);
    }
  };

  const downloadQualityOptions: Array<{ value: DownloadQuality | "default"; label: string }> = [
    { value: "default", label: t("playlistDownloadQualityDefault") },
    { value: "best", label: t("playlistDownloadQualityBest") },
    ...(["1440", "1080", "720", "480"] as const).map((quality) => ({ value: quality, label: `${quality}p` })),
  ];
  const downloadQualityLabel = (quality: DownloadQuality | null) => quality === null
    ? t("playlistDownloadQualityDefault")
    : quality === "best" ? t("playlistDownloadQualityBest") : `${quality}p`;
  const changeDownloadQuality = async (value: DownloadQuality | "default") => {
    if (!id || downloadQualitySaving || !playlist?.followed) return;
    const previous = playlist.download_quality;
    const download_quality = value === "default" ? null : value;
    setPlaylist({ ...playlist, download_quality });
    setDownloadQualitySaving(true);
    setDownloadFeedback("");
    try {
      const result = await api.updateFollowedPlaylistDownloadSettings(id, { download_quality });
      setPlaylist((current) => current ? { ...current, download_quality: result.download_quality } : current);
      setDownloadFeedback(t("playlistDownloadQualityUpdated", { quality: downloadQualityLabel(result.download_quality) }));
    } catch (error) {
      setPlaylist((current) => current ? { ...current, download_quality: previous } : current);
      setDownloadFeedback(t("playlistDownloadQualityFailed"));
      console.error(error);
    } finally {
      setDownloadQualitySaving(false);
    }
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

  const sortOptions: Array<{ value: PlaylistSort; label: string }> = [
    { value: "playlist-order", label: t("playlistSortOrder") },
    { value: "oldest", label: t("playlistSortOldest") },
    { value: "newest", label: t("playlistSortNewest") },
    { value: "title-asc", label: t("playlistSortTitleAsc") },
    { value: "title-desc", label: t("playlistSortTitleDesc") },
  ];
  const sortLabel = sortOptions.find((option) => option.value === sort)?.label ?? t("playlistSortOrder");

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
          {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
          <HeaderSettingsPopover
            open={settingsOpen}
            onOpenChange={(open) => { setSettingsOpen(open); if (!open) setSettingsView("root"); }}
            label={t("playlistSettings")}
          >
            {settingsView === "root" && <>
              <HeaderSettingsItem icon={<ListFilter />} label={t("playlistSort")} status={sortLabel} onClick={() => setSettingsView("sort")} />
              {playlist.followed && <HeaderSettingsItem icon={<Bell />} label={t("notificationPlaylistUpdates")} status={notificationMode === "default" ? t("notificationSourceDefaultOn") : notificationMode === "on" ? t("notificationSourceAlwaysOn") : t("notificationSourceAlwaysOff")} onClick={() => setSettingsView("notifications")} />}
              {playlist.followed && <HeaderSettingsItem
                icon={<Download />}
                label={t("playlistOfflinePolicy")}
                status={t(playlist.offline_policy === "none" ? "playlistOfflineNone" : playlist.offline_policy === "download" ? "playlistOfflineDownload" : "playlistOfflineKeep")}
                onClick={() => setSettingsView("downloads")}
              />}
              {playlist.followed && <HeaderSettingsItem
                icon={<Gauge />}
                label={t("playlistDownloadQuality")}
                status={downloadQualityLabel(playlist.download_quality)}
                onClick={() => setSettingsView("download-quality")}
              />}
            </>}
            {settingsView === "sort" && <>
              <HeaderSettingsHeader onBack={() => setSettingsView("root")} backLabel={t("back")}>{t("playlistSort")}</HeaderSettingsHeader>
              {sortOptions.map((option) => <HeaderSettingsOption key={option.value} selected={sort === option.value} onClick={() => changeSort(option.value)}>{option.label}</HeaderSettingsOption>)}
            </>}
            {settingsView === "notifications" && <NotificationSourceMenu
              mode={notificationMode}
              defaultEnabled
              title={t("notificationPlaylistUpdates")}
              disabled={notificationSaving}
              onBack={() => setSettingsView("root")}
              onChange={(mode) => void changeNotificationMode(mode)}
            />}
            {settingsView === "downloads" && <>
              <HeaderSettingsHeader onBack={() => setSettingsView("root")} backLabel={t("back")}>{t("playlistOfflinePolicy")}</HeaderSettingsHeader>
              {(["none", "download", "keep"] as const).map((option) => <HeaderSettingsOption
                key={option}
                selected={playlist.offline_policy === option}
                disabled={offlinePolicySaving}
                onClick={() => void changeOfflinePolicy(option)}
              >
                {t(option === "none" ? "playlistOfflineNone" : option === "download" ? "playlistOfflineDownload" : "playlistOfflineKeep")}
              </HeaderSettingsOption>)}
            </>}
            {settingsView === "download-quality" && <>
              <HeaderSettingsHeader onBack={() => setSettingsView("root")} backLabel={t("back")}>{t("playlistDownloadQuality")}</HeaderSettingsHeader>
              {downloadQualityOptions.map((option) => <HeaderSettingsOption
                key={option.value}
                selected={(playlist.download_quality ?? "default") === option.value}
                disabled={downloadQualitySaving}
                onClick={() => void changeDownloadQuality(option.value)}
              >
                {option.label}
              </HeaderSettingsOption>)}
            </>}
          </HeaderSettingsPopover>
          <Popover
            align="end"
            surface="menu"
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            trigger={<IconButton variant={actionsOpen ? "secondary" : "default"} label={t("moreActions")} icon={<MoreHorizontal />} />}
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
