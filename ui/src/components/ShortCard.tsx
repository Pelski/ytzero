import { useState } from "react";
import type { MouseEvent } from "react";
import { Archive, Check, Eye, Heart, Lock, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type Video } from "../api";
import { formatTimeAgo, formatViewsCount, useI18n } from "../i18n";
import { img } from "../img";
import Tooltip from "./Tooltip";
import { Badge } from "./ui";
import "./VideoCard.css";

const EXIT_MS = 320;

export default function ShortCard({
  video,
  onPlay,
  onRemoved,
  onLiked,
  isWatched,
  isLiked,
}: {
  video: Video;
  onPlay: (v: Video) => void;
  onRemoved: (videoId: string) => void;
  onLiked: (videoId: string, liked: boolean) => void;
  isWatched: boolean;
  isLiked: boolean;
}) {
  const { t, language } = useI18n();
  // YouTube serves a vertical 9:16 thumbnail for Shorts under oardefault.jpg;
  // fall back to the regular 16:9 feed thumbnail (cover-cropped) if it 404s.
  const [portraitFailed, setPortraitFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const thumbSrc = portraitFailed
    ? img(video.thumbnail)
    : img(`https://i.ytimg.com/vi/${video.video_id}/oardefault.jpg`);

  const videoHref = `/watch/${video.video_id}`;

  const play = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onPlay(video);
  };

  const removeWith = (fn: () => Promise<unknown>) => (e: MouseEvent) => {
    e.stopPropagation();
    fn()
      .then(() => {
        setLeaving(true);
        setTimeout(() => onRemoved(video.video_id), EXIT_MS);
      })
      .catch(() => {});
  };

  const toggleLike = (e: MouseEvent) => {
    e.stopPropagation();
    const next = !isLiked;
    onLiked(video.video_id, next);
    api.likeVideo(video.video_id, next).catch(() => onLiked(video.video_id, !next));
  };

  const views = formatViewsCount(video.views, language);
  const timeAgo = formatTimeAgo(video.published_at, language);
  const meta = [views, timeAgo].filter(Boolean).join(" · ");

  return (
    <div className={`short-card${isWatched ? " short-card--watched" : ""}${leaving ? " short-card--leaving" : ""}`}>
      <Tooltip text={video.title} pos="top" delay={450} className="tooltip-wrap--block tooltip-wrap--title short-card-thumb-tooltip">
        <Link to={videoHref} className="short-card-thumb" onClick={play} aria-label={video.title}>
          <img
            src={thumbSrc}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => { if (!portraitFailed) setPortraitFailed(true); }}
          />
        </Link>
      </Tooltip>

      {video.members_only === 1 && (
        <span className={`members-only-marker__icon short-card-members-only${isWatched ? " short-card-members-only--stacked" : ""}`} title={t("membersOnly")} aria-label={t("membersOnly")}>
          <Star size={15} fill="currentColor" />
        </span>
      )}
      {video.is_private === 1 && (
        <Badge variant="warning" size="sm" className="private-video-badge">
          <Lock size={11} /> {t("privateVideoBadge")}
        </Badge>
      )}

      {isWatched && (
        <span className="short-card-watched-badge" aria-label={t("watched")}>
          <Check size={13} strokeWidth={3} />
        </span>
      )}

      <div className="short-card-actions">
        <Tooltip text={isLiked ? t("unlike") : t("like")}>
          <button
            className={`sc-btn${isLiked ? " sc-btn--liked" : ""}`}
            onClick={toggleLike}
            aria-pressed={isLiked}
          >
            <Heart size={16} fill={isLiked ? "currentColor" : "none"} />
          </button>
        </Tooltip>
        {video.status !== "archived" && (
          <Tooltip text={t("watched")}>
            <button
              className="sc-btn"
              onClick={removeWith(() =>
                api.complete(video.video_id).then(() => api.archiveVideo(video.video_id))
              )}
            >
              <Eye size={16} />
            </button>
          </Tooltip>
        )}
        {video.status !== "archived" && (
          <Tooltip text={t("reject")}>
            <button className="sc-btn" onClick={removeWith(() => api.archiveVideo(video.video_id))}>
              <Archive size={16} />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="short-card-info">
        <Tooltip text={video.title} pos="top" delay={450} className="tooltip-wrap--block tooltip-wrap--title">
          <Link to={videoHref} className="short-card-title" onClick={play}>
            {video.title}
          </Link>
        </Tooltip>
        <Link to={`/channel/${video.channel_id}`} className="short-card-channel">
          {video.channel_thumbnail && (
            <img src={img(video.channel_thumbnail)} alt="" draggable={false} />
          )}
          <span>{video.channel_title}</span>
        </Link>
        {meta && <div className="short-card-meta">{meta}</div>}
      </div>
    </div>
  );
}
