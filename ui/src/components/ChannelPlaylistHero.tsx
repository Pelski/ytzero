import type { ReactNode } from "react";
import { ChevronRight, ListVideo } from "lucide-react";
import { Link } from "react-router-dom";
import type { FollowedPlaylist } from "../api";
import { img } from "../img";
import { formatPlaylistVideoCount, useI18n } from "../i18n";
import "./ChannelPlaylistHero.css";

export default function ChannelPlaylistHero({ playlist, compact = false, status, actions }: {
  playlist: FollowedPlaylist;
  compact?: boolean;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  const { t, language } = useI18n();
  const media = <>
    {playlist.thumbnail ? <img src={img(playlist.thumbnail)} alt="" /> : <div className="channel-playlist-hero__placeholder"><ListVideo /></div>}
    <span className="channel-playlist-hero__count"><ListVideo /> {formatPlaylistVideoCount(playlist.video_count, language)}</span>
  </>;

  return (
    <header className={`channel-playlist-hero${compact ? " channel-playlist-hero--compact" : ""}`}>
      {compact
        ? <Link className="channel-playlist-hero__media" to={`/playlist/${playlist.playlist_id}`}>{media}</Link>
        : <div className="channel-playlist-hero__media">{media}</div>}
      <div className="channel-playlist-hero__content">
        <div className="channel-playlist-hero__eyebrow">{t("publicPlaylist")}</div>
        {compact
          ? <Link className="followed-playlist-title-link" to={`/playlist/${playlist.playlist_id}`}><h2>{playlist.title}</h2><ChevronRight /></Link>
          : <h1>{playlist.title}</h1>}
        <Link className="channel-playlist-hero__channel" to={`/channel/${playlist.channel_id}`}>
          {playlist.channel_thumbnail ? <img src={img(playlist.channel_thumbnail)} alt="" /> : <span className="channel-playlist-hero__avatar-fallback">{playlist.channel_title.charAt(0).toUpperCase()}</span>}
          <span className="channel-playlist-hero__channel-copy"><small>{t("playlistChannel")}</small><strong>{playlist.channel_title}</strong></span>
          {!compact && <ChevronRight />}
        </Link>
        {status}
        {actions && <div className="channel-playlist-hero__actions">{actions}</div>}
      </div>
    </header>
  );
}
