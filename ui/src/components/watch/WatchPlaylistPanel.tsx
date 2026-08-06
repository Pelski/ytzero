import { Play } from "lucide-react";
import type { RefObject } from "react";
import { Link } from "react-router-dom";
import type { PlaylistVideo } from "../../api";
import { useI18n } from "../../i18n";
import { img } from "../../img";
import { VideoThumbnail, watchProgress } from "../VideoThumbnail";
import "./WatchPlaylistPanel.css";
import { playlistSortSearch, type PlaylistSort } from "../../playlistSort";

export default function WatchPlaylistPanel({
  activeItemRef,
  currentVideoId,
  itemsRef,
  playlistId,
  playlistIndex,
  sort,
  videos,
}: {
  activeItemRef: RefObject<HTMLAnchorElement>;
  currentVideoId?: string;
  itemsRef: RefObject<HTMLDivElement>;
  playlistId: string;
  playlistIndex: number;
  sort: PlaylistSort;
  videos: PlaylistVideo[];
}) {
  const { t } = useI18n();

  return (
    <div className="watch-playlist-panel">
      <div className="watch-playlist-head">
        <span className="watch-playlist-title">{t("playlist")}</span>
        <span className="watch-playlist-count">
          {playlistIndex >= 0 ? playlistIndex + 1 : 1} / {videos.length}
        </span>
      </div>
      <div className="playlist-items" ref={itemsRef}>
        {videos.map((video, index) => {
          const active = video.videoId === currentVideoId;
          return (
            <Link
              ref={active ? activeItemRef : undefined}
              key={video.videoId}
              to={`/watch/${video.videoId}/playlist/${playlistId}${playlistSortSearch(sort)}`}
              className={`playlist-item${active ? " active" : ""}`}
              title={video.title}
            >
              <span className="playlist-item-num">{index + 1}</span>
              <VideoThumbnail
                src={img(video.thumbnail)}
                watched={video.watched === 1}
                progress={watchProgress(video.watch_position, video.watch_duration)}
                variant="playlist"
                loading="lazy"
              >
                {video.duration && <span className="playlist-item-dur">{video.duration}</span>}
                {active && <span className="playlist-item-playing"><Play size={12} fill="currentColor" /></span>}
              </VideoThumbnail>
              <div className="playlist-item-info">
                <div className="playlist-item-title">{video.title}</div>
                {video.channelTitle && <div className="playlist-item-ch">{video.channelTitle}</div>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
