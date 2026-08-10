import { BookmarkPlus } from "lucide-react";
import { useState } from "react";
import { api, type UserPlaylist } from "../api";
import { emit } from "../events";
import { useI18n } from "../i18n";
import PlaylistPicker from "./PlaylistPicker";
import { FloatingPopover } from "./ui";

export function VideoCardPlaylistAction({
  videoId,
  onOpenChange,
}: {
  videoId: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("ListMusic");

  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) return;
    setLoading(true);
    api.userPlaylists(videoId)
      .then((result) => setPlaylists(result.playlists))
      .catch((error) => console.error("Failed to load playlists for video card", error))
      .finally(() => setLoading(false));
  };

  const togglePlaylist = async (playlist: UserPlaylist) => {
    const hasVideo = playlist.has_video === 1;
    try {
      if (hasVideo) await api.removeVideoFromUserPlaylist(playlist.id, videoId);
      else await api.addVideoToUserPlaylist(playlist.id, videoId);
      setPlaylists((items) => items.map((item) => item.id === playlist.id
        ? { ...item, has_video: hasVideo ? 0 : 1, video_count: Math.max(0, item.video_count + (hasVideo ? -1 : 1)) }
        : item));
      emit("playlists-changed");
    } catch (error) {
      console.error("Failed to update playlist from video card", error);
    }
  };

  const createPlaylist = async () => {
    if (!name.trim()) return;
    try {
      const result = await api.createUserPlaylist({ name: name.trim(), icon });
      await api.addVideoToUserPlaylist(result.playlist.id, videoId);
      setPlaylists((items) => [...items, { ...result.playlist, has_video: 1, video_count: 1 }]);
      setName("");
      setIcon("ListMusic");
      emit("playlists-changed");
    } catch (error) {
      console.error("Failed to create playlist from video card", error);
    }
  };

  const trigger = <button
    type="button"
    className="action-btn"
    aria-label={t("addToPlaylist")}
    title={t("addToPlaylist")}
    onClick={(event) => {
      event.stopPropagation();
      changeOpen(!open);
    }}
  >
    <BookmarkPlus />
  </button>;

  return (
    <FloatingPopover open={open} onOpenChange={changeOpen} align="end" trigger={trigger} toggleOnTriggerClick={false}>
      <div onPointerDown={(event) => event.stopPropagation()}>
        <PlaylistPicker
          playlists={playlists}
          loading={loading}
          name={name}
          icon={icon}
          onNameChange={setName}
          onIconChange={setIcon}
          onToggle={togglePlaylist}
          onCreate={createPlaylist}
        />
      </div>
    </FloatingPopover>
  );
}
