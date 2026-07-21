import { Check } from "lucide-react";
import type { UserPlaylist } from "../api";
import { useI18n } from "../i18n";
import { PlaylistIcon, PlaylistIconPicker } from "./PlaylistIcon";
import { Button, Input, Stack } from "./ui";

export interface PlaylistPickerProps {
  playlists: UserPlaylist[];
  name: string;
  icon: string;
  onNameChange: (name: string) => void;
  onIconChange: (icon: string) => void;
  onToggle: (playlist: UserPlaylist) => void;
  onCreate: () => void;
}

/** Shared contents for desktop and compact playlist menus. */
export default function PlaylistPicker({
  playlists,
  name,
  icon,
  onNameChange,
  onIconChange,
  onToggle,
  onCreate,
}: PlaylistPickerProps) {
  const { t } = useI18n();

  return (
    <>
      {playlists.length === 0 && <div className="dropdown-empty">{t("noPlaylists")}</div>}
      {playlists.map((playlist) => (
        <button
          type="button"
          key={playlist.id}
          className={playlist.has_video === 1 ? "is-selected" : undefined}
          onClick={() => onToggle(playlist)}
        >
          <span className="playlist-dot"><PlaylistIcon icon={playlist.icon} /></span>
          {playlist.name}
          {playlist.has_video === 1 && <span className="dropdown-menu-status"><Check size={14} /></span>}
        </button>
      ))}
      <Stack as="form" gap={2} className="dropdown-form" onSubmit={(event) => { event.preventDefault(); onCreate(); }}>
        <div className="dropdown-form-title">{t("newPlaylistDots")}</div>
        <div className="dropdown-form-row">
          <PlaylistIconPicker value={icon} onChange={onIconChange} compact />
          <Input
            size="sm"
            value={name}
            placeholder={t("name")}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
        <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>{t("createAndAdd")}</Button>
      </Stack>
    </>
  );
}
