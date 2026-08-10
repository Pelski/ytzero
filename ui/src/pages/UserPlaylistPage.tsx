import { useCallback, useEffect, useState } from "react";
import "./UserPlaylistPage.css";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Download, Edit3, Save, Trash2, X } from "lucide-react";
import { api, type UserPlaylist, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { PlaylistIcon, PlaylistIconPicker } from "../components/PlaylistIcon";
import Popconfirm from "../components/Popconfirm";
import { emit } from "../events";
import { formatVideoCount, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { Button, EmptyState, IconButton, Input, LocalToast, PageHeader, SelectMenu } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import type { PlayVideo, PlaybackQueueContext } from "../playbackQueue";
import { normalizeUserPlaylistSort, type UserPlaylistSort } from "../playlistSort";

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

  const canDownloadPlaylist = videos.length > 0 && videos.some((video) => video.downloads_allowed);
  const sortAction = <SelectMenu
    floating
    label={t("playlistSort")}
    value={sort}
    onChange={(next: UserPlaylistSort) => setSearchParams({ sort: next }, { replace: true })}
    options={[
      { value: "playlist-order", label: t("playlistSortOrder") },
      { value: "added-newest", label: t("playlistSortAddedNewest") },
      { value: "added-oldest", label: t("playlistSortAddedOldest") },
      { value: "newest", label: t("playlistSortNewest") },
      { value: "oldest", label: t("playlistSortOldest") },
      { value: "title-asc", label: t("playlistSortTitleAsc") },
      { value: "title-desc", label: t("playlistSortTitleDesc") },
    ]}
  />;
  const downloadAction = !canDownloadPlaylist ? null : videos.some((video) => video.downloads_enabled)
    ? <Popconfirm message={t("playlistDownloadConfirm", { count: videos.length })} onConfirm={downloadAll}><Button disabled={downloadPending} leadingIcon={<Download />}>{t("playlistDownloadAll")}</Button></Popconfirm>
    : videos.length > 0 && videos.some((video) => video.downloads_allowed) ? <Button onClick={downloadAll} leadingIcon={<Download />}>{t("playlistDownloadAll")}</Button> : null;

  if (!playlist && loading) return <VideoGridSkeleton gridSize="sm" />;
  if (!playlist) return null;
  const playbackQueue: PlaybackQueueContext = { version: 1, kind: "user-playlist", playlistUuid: playlist.portable_uuid, sort };

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
            {sortAction}
            {downloadAction}
            {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
            <Popconfirm message={t("confirmDelete", { name: playlist.name })} onConfirm={removePlaylist}>
              <Button variant="danger" leadingIcon={<Trash2 />}>{t("deletePlaylist")}</Button>
            </Popconfirm>
          </div>
        </div>
      ) : (
        <PageHeader
          icon={<div className="playlist-icon"><PlaylistIcon icon={playlist.icon} /></div>}
          title={playlist.name}
          description={formatVideoCount(playlist.video_count, language)}
          actions={<>{sortAction}{downloadAction}{downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}<IconButton variant="ghost" label={t("edit")} icon={<Edit3 />} onClick={() => setEditing(true)} /><Popconfirm message={t("confirmDelete", { name: playlist.name })} onConfirm={removePlaylist}><Button variant="danger" leadingIcon={<Trash2 />}>{t("deletePlaylist")}</Button></Popconfirm></>}
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
              onPlay={(video) => onPlay(video, playbackQueue)}
              onChanged={load}
              onRemoveFromPlaylist={(videoId) => api.removeVideoFromUserPlaylist(playlist.id, videoId)}
            />
          ))}
        </div>
      )}
    </>
  );
}
