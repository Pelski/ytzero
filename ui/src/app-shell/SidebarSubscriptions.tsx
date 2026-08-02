import { useCallback, useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ChevronRight, Users } from "lucide-react";
import { api } from "../api";
import { subscribe } from "../events";
import { img } from "../img";
import { useI18n } from "../i18n";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";

type RecentChannel = {
  channel_id: string;
  title: string;
  thumbnail: string;
  latest_thumbnail: string | null;
  latest_video_id: string | null;
  watched: number;
  watch_position: number | null;
  watch_duration: number | null;
};

export default function SidebarSubscriptions() {
  const { t } = useI18n();
  const [channels, setChannels] = useState<RecentChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const visibleChannels = channels.slice(0, 5);

  const loadChannels = useCallback(() => {
    api.recentChannels().then((result) => {
      setChannels(result.channels);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(loadChannels, [loadChannels]);
  useEffect(() => subscribe("channels-changed", loadChannels), [loadChannels]);

  return (
    <div className="sidebar-subs">
      <div className="sidebar-subs-header">{t("subscriptions")}</div>
      <NavLink to="/subscriptions" className={({ isActive }) => `sidebar-subs-compact${isActive ? " active" : ""}`}>
        <Users size={18} />
        <span>{t("subscriptions")}</span>
      </NavLink>
      <div className="sidebar-subs-list">
        {loading && channels.length === 0 && (
          <div className="sidebar-skeleton-list" aria-label={t("loading")}>
            {Array.from({ length: 5 }, (_, index) => (
              <div className="sidebar-skeleton-item" aria-hidden="true" key={index}>
                <div className="skeleton sidebar-skeleton-avatar" />
                <div className="skeleton skeleton-line" />
              </div>
            ))}
          </div>
        )}
        {visibleChannels.map((channel) => (
          <div key={channel.channel_id} className="sidebar-sub-item">
            <Link to={`/channel/${channel.channel_id}`} className="sidebar-sub-channel">
              {channel.thumbnail ? (
                <img className="sidebar-sub-avatar" src={img(channel.thumbnail)} alt="" />
              ) : (
                <div className="sidebar-sub-avatar" />
              )}
              <span className="sidebar-sub-name">{channel.title}</span>
            </Link>
            {channel.latest_thumbnail && channel.latest_video_id && (
              <Link to={`/watch/${channel.latest_video_id}`} className="sidebar-sub-video" aria-label={channel.title}>
                <VideoThumbnail
                  src={img(channel.latest_thumbnail)}
                  watched={channel.watched === 1}
                  progress={watchProgress(channel.watch_position, channel.watch_duration)}
                  variant="sidebar"
                />
              </Link>
            )}
          </div>
        ))}
        {!loading && channels.length > 0 && (
          <NavLink to="/subscriptions" className={({ isActive }) => `sidebar-show-more${isActive ? " active" : ""}`}>
            <span>{t("showMore")}</span>
            <ChevronRight size={15} />
          </NavLink>
        )}
      </div>
    </div>
  );
}
