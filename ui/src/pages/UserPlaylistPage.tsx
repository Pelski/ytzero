import { useCallback, useEffect, useState } from "react";
import "./UserPlaylistPage.css";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Download, Edit3, Gauge, ListFilter, MoreHorizontal, Save, Trash2, X } from "lucide-react";
import { api, type DownloadQuality, type UserPlaylist, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { PlaylistIcon, PlaylistIconPicker } from "../components/PlaylistIcon";
import Popconfirm from "../components/Popconfirm";
import { emit } from "../events";
import { formatVideoCount, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { Button, EmptyState, IconButton, Input, LocalToast, Menu, MenuItem, MenuSeparator, PageHeader, Popover } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import PlaylistPlaybackActions from "../components/PlaylistPlaybackActions";
import type { PlayVideo, PlaybackQueueContext } from "../playbackQueue";
import { normalizeUserPlaylistSort, type UserPlaylistSort } from "../playlistSort";
import { HeaderSettingsHeader, HeaderSettingsItem, HeaderSettingsOption, HeaderSettingsPopover } from "../components/HeaderSettingsMenu";
import PublicShareControl from "../components/PublicShareControl";

export default function UserPlaylistPage({ onPlay }: { onPlay: PlayVideo }) {
  const { t, language } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = normalizeUserPlaylistSort(searchParams.get("sort"));
  const playlistId = Number(id);
  const [playlist, setPlaylist] = useState<UserPlaylist | null>(null);
  useDocumentTitle(playlist?.name);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("ListMusic");
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<"root" | "sort" | "downloads" | "download-quality">("root");
  const [offlinePolicyPending, setOfflinePolicyPending] = useState(false);
  const [downloadQualityPending, setDownloadQualityPending] = useState(false);

  const load = useCallback(async () => {
    if (!playlistId) return;
    setLoading(true);
    try {
      const r = await api.userPlaylist(playlistId, sort);
      setPlaylist(r.playlist);
      setVideos(r.videos);
      setName(r.playlist.name);
      setIcon(r.playlist.icon);
      setLoading(false);
    } catch (error) {
      console.error(error);
    }
  }, [playlistId, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!playlist || !name.trim()) return;
    const r = await api.updateUserPlaylist(playlist.id, { name: name.trim(), icon });
    setPlaylist(r.playlist);
    setEditing(false);
  };

  const removePlaylist = async () => {
    if (!playlist) return;
    await api.deleteUserPlaylist(playlist.id);
    emit("playlists-changed");
    navigate("/");
  };

  const downloadAll = async () => {
    if (!playlist) return;
    if (!videos.some((video) => video.downloads_enabled)) { navigate("/downloads?view=configuration"); return; }
    setDownloadPending(true); setDownloadFeedback("");
    try {
      const result = await api.downloadUserPlaylist(playlist.id, sort);
      setDownloadFeedback(result.queued > 0 ? t("playlistDownloadQueued", { count: result.queued }) : t("playlistDownloadNone"));
      await load();
    } catch { setDownloadFeedback(t("playlistDownloadFailed")); }
    finally { setDownloadPending(false); }
  };

  const changeOfflinePolicy = async (offline_policy: UserPlaylist["offline_policy"]) => {
    if (!playlist || offlinePolicyPending) return;
    setOfflinePolicyPending(true);
    setDownloadFeedback("");
    try {
      const result = await api.updateUserPlaylist(playlist.id, { offline_policy });
      setPlaylist(result.playlist);
      setDownloadFeedback(t(offline_policy === "none" ? "playlistOfflineDisabled" : offline_policy === "download" ? "playlistOfflineEnabled" : "playlistKeepOfflineEnabled"));
      await load();
    } catch {
      setDownloadFeedback(t("playlistOfflineFailed"));
    } finally {
      setOfflinePolicyPending(false);
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
    if (!playlist || downloadQualityPending) return;
    const download_quality = value === "default" ? null : value;
    setDownloadQualityPending(true);
    setDownloadFeedback("");
    try {
      const result = await api.updateUserPlaylist(playlist.id, { download_quality });
      setPlaylist(result.playlist);
      setDownloadFeedback(t("playlistDownloadQualityUpdated", { quality: downloadQualityLabel(result.playlist.download_quality) }));
    } catch {
      setDownloadFeedback(t("playlistDownloadQualityFailed"));
    } finally {
      setDownloadQualityPending(false);
    }
  };

  const canDownloadPlaylist = videos.length > 0 && videos.some((video) => video.downloads_allowed);
  const sortOptions: Array<{ value: UserPlaylistSort; label: string }> = [
    { value: "playlist-order", label: t("playlistSortOrder") },
    { value: "added-newest", label: t("playlistSortAddedNewest") },
    { value: "added-oldest", label: t("playlistSortAddedOldest") },
    { value: "newest", label: t("playlistSortNewest") },
    { value: "oldest", label: t("playlistSortOldest") },
    { value: "title-asc", label: t("playlistSortTitleAsc") },
    { value: "title-desc", label: t("playlistSortTitleDesc") },
  ];
  const sortLabel = sortOptions.find((option) => option.value === sort)?.label ?? t("playlistSortAddedNewest");
  if (!playlist && loading) return <VideoGridSkeleton gridSize="sm" />;
  if (!playlist) return null;
  const playlistSettingsAction = <HeaderSettingsPopover
    open={settingsOpen}
    onOpenChange={(open) => { setSettingsOpen(open); if (!open) setSettingsView("root"); }}
    label={t("playlistSettings")}
  >
    {settingsView === "root" && <>
      <HeaderSettingsItem icon={<ListFilter />} label={t("playlistSort")} status={sortLabel} onClick={() => setSettingsView("sort")} />
      <HeaderSettingsItem
        icon={<Download />}
        label={t("playlistOfflinePolicy")}
        status={t(playlist.offline_policy === "none" ? "playlistOfflineNone" : playlist.offline_policy === "download" ? "playlistOfflineDownload" : "playlistOfflineKeep")}
        onClick={() => setSettingsView("downloads")}
      />
      <HeaderSettingsItem
        icon={<Gauge />}
        label={t("playlistDownloadQuality")}
        status={downloadQualityLabel(playlist.download_quality)}
        onClick={() => setSettingsView("download-quality")}
      />
    </>}
    {settingsView === "sort" && <>
      <HeaderSettingsHeader onBack={() => setSettingsView("root")} backLabel={t("back")}>{t("playlistSort")}</HeaderSettingsHeader>
      {sortOptions.map((option) => <HeaderSettingsOption
        key={option.value}
        selected={sort === option.value}
        onClick={() => setSearchParams({ sort: option.value }, { replace: true })}
      >
        {option.label}
      </HeaderSettingsOption>)}
    </>}
    {settingsView === "downloads" && <>
      <HeaderSettingsHeader onBack={() => setSettingsView("root")} backLabel={t("back")}>{t("playlistOfflinePolicy")}</HeaderSettingsHeader>
      {(["none", "download", "keep"] as const).map((option) => <HeaderSettingsOption
        key={option}
        selected={playlist.offline_policy === option}
        disabled={offlinePolicyPending}
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
        disabled={downloadQualityPending}
        onClick={() => void changeDownloadQuality(option.value)}
      >
        {option.label}
      </HeaderSettingsOption>)}
    </>}
  </HeaderSettingsPopover>;
  const playbackQueue: PlaybackQueueContext = { version: 1, kind: "user-playlist", playlistUuid: playlist.portable_uuid, sort };
  const playPlaylistVideo = (video: Video) => onPlay(video, playbackQueue);
  const downloadMenuItem = !canDownloadPlaylist ? null : videos.some((video) => video.downloads_enabled)
    ? <Popconfirm
        triggerClassName="ui-menu__popover-trigger"
        message={t("playlistDownloadConfirm", { count: videos.length })}
        onConfirm={() => { setActionsOpen(false); void downloadAll(); }}
      >
        <MenuItem disabled={downloadPending} icon={<Download />}>{t("playlistDownloadAll")}</MenuItem>
      </Popconfirm>
    : <MenuItem icon={<Download />} onClick={() => { setActionsOpen(false); void downloadAll(); }}>{t("playlistDownloadAll")}</MenuItem>;
  const moreActions = <Popover
    align="end"
    surface="menu"
    open={actionsOpen}
    onOpenChange={setActionsOpen}
    trigger={<IconButton variant={actionsOpen ? "secondary" : "ghost"} label={t("moreActions")} icon={<MoreHorizontal />} />}
  >
    <Menu>
      {downloadMenuItem}
      {!editing && <MenuItem icon={<Edit3 />} onClick={() => { setActionsOpen(false); setEditing(true); }}>{t("edit")}</MenuItem>}
      {(downloadMenuItem !== null || !editing) && <MenuSeparator />}
      <Popconfirm
        triggerClassName="ui-menu__popover-trigger"
        message={t("confirmDelete", { name: playlist.name })}
        onConfirm={() => { setActionsOpen(false); void removePlaylist(); }}
      >
        <MenuItem icon={<Trash2 />}>{t("deletePlaylist")}</MenuItem>
      </Popconfirm>
    </Menu>
  </Popover>;

  return (
    <>
      {editing ? (
        <div className="playlist-header">
          <div className="playlist-title-wrap">
            <div className="playlist-edit-row">
              <PlaylistIconPicker value={icon} onChange={setIcon} />
              <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
              <Button variant="primary" leadingIcon={<Save />} onClick={save}>{t("save")}</Button>
              <IconButton label={t("cancel")} icon={<X />} onClick={() => setEditing(false)} />
            </div>
          </div>
          <div className="playlist-actions">
            <PlaylistPlaybackActions videos={videos} disabled={loading} onPlay={playPlaylistVideo} />
            <PublicShareControl resourceType="user_playlist" resourceId={playlist.id} />
            {playlistSettingsAction}
            {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
            {moreActions}
          </div>
        </div>
      ) : (
        <PageHeader
          icon={<div className="playlist-icon"><PlaylistIcon icon={playlist.icon} /></div>}
          title={playlist.name}
          description={formatVideoCount(playlist.video_count, language)}
          actions={<>
            <PlaylistPlaybackActions videos={videos} disabled={loading} onPlay={playPlaylistVideo} />
            <PublicShareControl resourceType="user_playlist" resourceId={playlist.id} />
            {playlistSettingsAction}
            {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
            {moreActions}
          </>}
        />
      )}

      {loading && videos.length === 0 ? (
        <VideoGridSkeleton gridSize="sm" />
      ) : videos.length === 0 ? (
        <EmptyState art={<EmptyArt scene="playlistEmpty" />} title={t("playlistIsEmpty")} description={t("playlistIsEmptyHint")} />
      ) : (
        <div className="video-grid video-grid--sm">
          {videos.map((v) => (
            <VideoCard
              key={v.video_id}
              video={v}
              onPlay={playPlaylistVideo}
              onChanged={load}
              onRemoveFromPlaylist={(videoId) => api.removeVideoFromUserPlaylist(playlist.id, videoId)}
            />
          ))}
        </div>
      )}
    </>
  );
}
