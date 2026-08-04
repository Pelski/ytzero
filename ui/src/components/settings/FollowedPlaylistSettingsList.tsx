import { useState } from "react";
import { ListMinus, ListMusic, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type FollowedPlaylist } from "../../api";
import { img } from "../../img";
import { formatVideoCount, useI18n } from "../../i18n";
import { Button, List, ListRow } from "../ui";
import "./FollowedPlaylistSettingsList.css";

export function FollowedPlaylistSettingsList({ playlists, onChanged }: { playlists: FollowedPlaylist[]; onChanged: () => void }) {
  const { t, language } = useI18n();
  const [pending, setPending] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setPending(key);
    try { await action(); onChanged(); }
    finally { setPending(null); }
  };

  return <List className="followed-playlists-settings">
    {playlists.map((playlist) => {
      const count = Number.parseInt(playlist.video_count, 10) || 0;
      const syncKey = `${playlist.playlist_id}:sync`;
      const unfollowKey = `${playlist.playlist_id}:unfollow`;
      return <ListRow
        key={playlist.playlist_id}
        className="followed-playlist-settings-row"
        media={<Link to={`/playlist/${playlist.playlist_id}`} className="followed-playlist-settings-row__media" aria-label={playlist.title}>{playlist.thumbnail ? <img src={img(playlist.thumbnail)} alt="" /> : <span><ListMusic /></span>}</Link>}
        title={<Link to={`/playlist/${playlist.playlist_id}`} className="followed-playlist-settings-row__title">{playlist.title}</Link>}
        description={playlist.channel_title}
        meta={formatVideoCount(count, language)}
        actions={<>
          <Button size="sm" leadingIcon={<RefreshCw />} disabled={pending !== null} onClick={() => void run(syncKey, () => api.syncPlaylist(playlist.playlist_id))}>{t("syncPlaylist")}</Button>
          <Button size="sm" variant="danger" leadingIcon={<ListMinus />} disabled={pending !== null} onClick={() => void run(unfollowKey, () => api.followPlaylist(playlist.playlist_id, false))}>{t("unfollowPlaylist")}</Button>
        </>}
      />;
    })}
  </List>;
}
