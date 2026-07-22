import { Check } from "lucide-react";
import type { UserPlaylist } from "../api";
import { useI18n } from "../i18n";
import { PlaylistIcon, PlaylistIconPicker } from "./PlaylistIcon";
import { Button, Input, Menu, MenuItem, MenuLoading, MenuStatus, Stack } from "./ui";
import "./PlaylistPicker.css";

export interface PlaylistPickerProps {
  playlists: UserPlaylist[];
  loading?: boolean;
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
  loading = false,
  name,
  icon,
  onNameChange,
  onIconChange,
  onToggle,
  onCreate,
}: PlaylistPickerProps) {
  const { t } = useI18n();

  return <Menu className="playlist-picker">
      {loading ? <MenuLoading label={t("loading")} /> : <>
      {playlists.length === 0 && <div className="playlist-picker__empty">{t("noPlaylists")}</div>}
      {playlists.map((playlist) => (
        <MenuItem
          key={playlist.id}
          selected={playlist.has_video === 1}
          onClick={() => onToggle(playlist)}
          icon={<span className="playlist-picker__icon"><PlaylistIcon icon={playlist.icon} /></span>}
          suffix={playlist.has_video === 1 ? <MenuStatus><Check size={14} /></MenuStatus> : undefined}
        >
          {playlist.name}
        </MenuItem>
      ))}
      <Stack as="form" gap={2} className="playlist-picker__form" onSubmit={(event) => { event.preventDefault(); onCreate(); }}>
        <div className="playlist-picker__form-title">{t("newPlaylistDots")}</div>
        <div className="playlist-picker__form-row">
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
      </>}
  </Menu>;
}
