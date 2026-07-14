import {
  Archive,
  Eye,
  Heart,
  Trash2,
  Undo2,
} from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDrag } from "@use-gesture/react";
import { api, type Video } from "../api";
import { emit } from "../events";
import { formatTimeAgo, useI18n } from "../i18n";
import { img } from "../img";
import Tooltip from "./Tooltip";
import { VideoThumbnail } from "./VideoThumbnail";
import { BUCKET_ICONS, VideoScheduleActions } from "./VideoScheduleActions";

export { BUCKET_ICONS } from "./VideoScheduleActions";
const SWIPE_THRESHOLD = 90;
const SWIPE_EXIT_GUTTER = 24;
const SWIPE_MAX_DRAG = 160;
const SWIPE_FEEDBACK_MS = 720;
const FINAL_EXIT_MS = 280;

export function formatVideoDuration(duration: string | null): string {
  if (!duration) return "";
  const raw = duration.trim();
  if (!raw) return "";

  const colonParts = raw.split(":").map((part) => part.trim());
  if (colonParts.length >= 2 && colonParts.every((part) => /^\d+$/.test(part))) {
    let seconds = 0;
    for (const part of colonParts) seconds = seconds * 60 + Number(part);
    return formatDurationSeconds(seconds);
  }

  const hourMatch = raw.match(/(\d+)\s*(?:h|hr|hrs|hour|hours|godz\.?|godzin|godziny)/i);
  const minuteMatch = raw.match(/(\d+)\s*(?:m|min|mins|minute|minutes|minut|minuty)/i);
  const secondMatch = raw.match(/(\d+)\s*(?:s|sec|secs|second|seconds|sek|sekund|sekundy)/i);
  if (hourMatch || minuteMatch || secondMatch) {
    const seconds =
      Number(hourMatch?.[1] ?? 0) * 3600 +
      Number(minuteMatch?.[1] ?? 0) * 60 +
      Number(secondMatch?.[1] ?? 0);
    return formatDurationSeconds(seconds);
  }

  return raw;
}

function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export default function VideoCard({
  video,
  onPlay,
  onChanged,
  showRestore,
  showChannelAvatar = true,
  onRemoveFromPlaylist,
  isWatched,
  isLiked,
  showWatchProgress,
}: {
  video: Video;
  onPlay: (v: Video) => void;
  onChanged: (videoId?: string) => void;
  showRestore?: boolean;
  showChannelAvatar?: boolean;
  onRemoveFromPlaylist?: (videoId: string) => Promise<unknown>;
  isWatched?: boolean;
  isLiked?: boolean;
  showWatchProgress?: boolean;
}) {
  const { t, language } = useI18n();
  const [fading, setFading] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [actionProximity, setActionProximity] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [committedDir, setCommittedDir] = useState<"left" | "right" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastProximityRef = useRef(0);
  const blockNextThumbClickRef = useRef(false);
  const blockClickAfterDragRef = useRef(false);

  const exitLeft = () => {
    const cardWidth = cardRef.current?.getBoundingClientRect().width ?? SWIPE_MAX_DRAG;
    setSwipeX(-(cardWidth + SWIPE_EXIT_GUTTER));
  };

  const removeWithLayoutAnimation = () => {
    exitLeft();
    setFading(true);
    window.setTimeout(() => {
      setRemoved(true);
      onChanged(video.video_id);
    }, FINAL_EXIT_MS);
  };

  const fade = (fn: () => Promise<unknown>, dir: "left" | "right" = "left") => {
    fn().then(() => {
      setCommittedDir(dir);
      setFading(true);
      setTimeout(removeWithLayoutAnimation, 180);
    });
  };

  const act = (e: MouseEvent, fn: () => Promise<unknown>, dir?: "left" | "right") => {
    e.stopPropagation();
    fade(fn, dir);
  };

  const queueAct = (fn: () => Promise<unknown>) =>
    fn().then((result) => {
      emit("queue-changed");
      return result;
    });

  const markWatchedAndArchive = () =>
    api.complete(video.video_id).then(() => api.archiveVideo(video.video_id));

  const bind = useDrag(
    ({ active, movement: [mx], tap, cancel, last }) => {
      if (tap || video.status === "archived") return;

      if (active) {
        setSwiping(true);
        if (Math.abs(mx) > 8) blockClickAfterDragRef.current = true;
        const clamped = Math.sign(mx) * Math.min(Math.abs(mx), SWIPE_MAX_DRAG);
        setSwipeX(clamped);
        // trigger early when well past threshold
        if (Math.abs(mx) > SWIPE_THRESHOLD * 1.8) {
          cancel();
          commitSwipe(mx);
        }
      }

      if (last) {
        setSwiping(false);
        commitSwipe(mx);
      }
    },
    {
      axis: "x",
      filterTaps: true,
      from: [0, 0],
      pointer: { capture: true },
    }
  );

  const commitSwipe = (mx: number) => {
    if (Math.abs(mx) >= SWIPE_THRESHOLD) {
      const dir = mx < 0 ? "left" : "right";
      const cardWidth = cardRef.current?.getBoundingClientRect().width ?? SWIPE_MAX_DRAG;
      const exitX = (dir === "left" ? -1 : 1) * (cardWidth + SWIPE_EXIT_GUTTER);
      setSwiping(false);
      setCommittedDir(dir);
      setSwipeX(exitX);
      setFading(true);
      const action = dir === "left"
        ? api.archiveVideo(video.video_id)
        : markWatchedAndArchive();
      action.then(() => {
        setTimeout(removeWithLayoutAnimation, SWIPE_FEEDBACK_MS);
      });
    } else {
      setCommittedDir(null);
      setSwipeX(0);
    }
  };

  const getActionProximity = (rect: DOMRect, clientX: number, clientY: number) => {
    const targetX = rect.right - 24;
    const targetY = rect.top + 20;
    const distance = Math.hypot(clientX - targetX, clientY - targetY);
    const radius = Math.min(150, rect.width * 0.58);
    return Math.max(0, Math.min(1, 1 - distance / radius));
  };

  const updateActionProximity = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next = getActionProximity(rect, e.clientX, e.clientY);
    if (Math.abs(next - lastProximityRef.current) < 0.025) return;
    lastProximityRef.current = next;
    setActionProximity(next);
    if (next > 0.52) setActionsOpen(true);
  };

  const openTouchActions = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next = getActionProximity(rect, e.clientX, e.clientY);
    if (next < 0.35) return;
    blockNextThumbClickRef.current = true;
    lastProximityRef.current = 1;
    setActionProximity(1);
    setActionsOpen(true);
  };

  const resetActionProximity = () => {
    lastProximityRef.current = 0;
    setActionProximity(0);
    setActionsOpen(false);
  };

  const videoHref = `/watch/${video.video_id}`;

  const playFromLink = (e: MouseEvent<HTMLAnchorElement>) => {
    if (blockNextThumbClickRef.current || blockClickAfterDragRef.current) {
      blockNextThumbClickRef.current = false;
      blockClickAfterDragRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onPlay(video);
  };

  const absX = Math.abs(swipeX);
  const revealProgress = Math.min(1, absX / SWIPE_THRESHOLD);
  const swipeDir = swipeX < -4 ? "left" : swipeX > 4 ? "right" : null;
  const activeSwipeDir = committedDir ?? swipeDir;
  const watched = isWatched ?? video.watched === 1;

  const contentOpacity = Math.min(1, revealProgress * 2.5);
  const revealGap = swiping ? 10 : 0;
  const revealWidth = fading ? "100%" : Math.max(0, Math.min(absX, 160) - revealGap);

  const cardTransition = swiping
    ? "none"
    : fading
      ? "opacity 0.56s ease, transform 0.56s cubic-bezier(0.22, 1, 0.36, 1)"
      : "transform 0.5s cubic-bezier(0.34, 1.4, 0.64, 1)";

  const cardTilt = swiping || fading ? `rotateZ(${Math.sign(swipeX) * Math.min(1.2, absX / 120)}deg)` : "";
  const cardFadeScale = fading ? "scale(0.97)" : "";

  if (removed) return null;

  return (
    <div className={`swipe-wrap${fading ? " card-fading" : ""}`}>
      {activeSwipeDir === "right" && (
        <div className="swipe-reveal swipe-reveal--left" style={{ width: revealWidth, opacity: fading ? undefined : contentOpacity }}>
          <span className="swipe-reveal-icon">
            <Eye size={22} />
          </span>
          <span className="swipe-reveal-label">{t("watched")}</span>
        </div>
      )}
      {activeSwipeDir === "left" && (
        <div className="swipe-reveal swipe-reveal--right" style={{ width: revealWidth, opacity: fading ? undefined : contentOpacity }}>
          <span className="swipe-reveal-icon">
            <Archive size={22} />
          </span>
          <span className="swipe-reveal-label">{t("reject")}</span>
        </div>
      )}

      <div
        ref={cardRef}
        {...bind()}
        className={`video-card${watched ? " video-card--watched" : ""}`}
        style={{
          transform: `translateX(${swipeX}px) ${cardTilt} ${cardFadeScale}`,
          transition: cardTransition,
          touchAction: "pan-y",
          userSelect: "none",
          willChange: swiping ? "transform" : "auto",
        }}
      >
        <div
          className={`thumb-wrap${actionsOpen ? " controls-near" : ""}`}
          style={{ "--actions-proximity": actionProximity } as CSSProperties}
          onPointerMove={updateActionProximity}
          onPointerDown={openTouchActions}
          onPointerLeave={resetActionProximity}
          onMouseLeave={resetActionProximity}
        >
          <Link
            to={videoHref}
            className="thumb-link"
            onClick={playFromLink}
            onDragStart={(e) => e.preventDefault()}
            aria-label={video.title}
          >
            <VideoThumbnail
              src={img(video.thumbnail)}
              watched={watched}
              variant="card"
              loading="lazy"
              draggable={false}
            />
          </Link>
          {isLiked && video.is_short === 1 && (
            <span className="thumb-liked-badge"><Heart size={12} fill="currentColor" /></span>
          )}
          {video.live_status === "live" && (
            <span className="live-badge">
              <span className="pulse" /> {t("liveBadge")}
            </span>
          )}
          {video.live_status === "upcoming" && <span className="live-badge upcoming">{t("upcomingBadge")}</span>}
          {video.is_short === 1 && video.live_status === "none" && <span className="short-badge">{t("shortBadge")}</span>}
          {video.duration && video.is_short !== 1 && (
            <span className="duration-badge">{formatVideoDuration(video.duration)}</span>
          )}
          {video.watch_position != null && video.watch_duration != null && video.watch_duration > 0 && (video.status !== "archived" || showWatchProgress) && (
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.min(100, (video.watch_position / video.watch_duration) * 100)}%` }}
              />
            </div>
          )}
          <div className="thumb-actions-zone">
            <div className="thumb-actions-peek" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            <div className="thumb-actions">
              <VideoScheduleActions
                video={video}
                variant="overlay"
                onToggle={(e, bucket, active) => act(e, () => queueAct(() => active ? api.dequeue(video.video_id) : api.queue(video.video_id, bucket)))}
              />
              <div className="thumb-actions-row secondary">
                {video.status !== "archived" && (
                  <Tooltip text={t("reject")}>
                    <button className="action-btn" onClick={(e) => act(e, () => api.archiveVideo(video.video_id), "left")}>
                      <Archive />
                    </button>
                  </Tooltip>
                )}
                {video.status !== "archived" && (
                  <Tooltip text={t("watched")}>
                    <button className="action-btn" onClick={(e) => act(e, markWatchedAndArchive, "right")}>
                      <Eye />
                    </button>
                  </Tooltip>
                )}
                {showRestore && (
                  <Tooltip text={t("restore")}>
                    <button className="action-btn" onClick={(e) => act(e, () => api.restore(video.video_id))}>
                      <Undo2 />
                    </button>
                  </Tooltip>
                )}
                {onRemoveFromPlaylist && (
                  <Tooltip text={t("removeFromPlaylist")}>
                    <button className="action-btn" onClick={(e) => act(e, () => onRemoveFromPlaylist(video.video_id))}>
                      <Trash2 />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card-body">
          {showChannelAvatar && (
            <Link to={`/channel/${video.channel_id}`} className="card-avatar-link">
              {video.channel_thumbnail ? (
                <img className="card-ch-avatar" src={img(video.channel_thumbnail)} alt="" draggable={false} />
              ) : (
                <div className="card-ch-avatar card-ch-avatar-fallback">
                  {video.channel_title.charAt(0).toUpperCase()}
                </div>
              )}
            </Link>
          )}
          <div className="card-info">
            <Link to={videoHref} className="v-title" onClick={playFromLink}>
              {video.title}
            </Link>
            <div className="v-channel-meta">
              <Link to={`/channel/${video.channel_id}`} className="v-channel">
                {video.channel_title}
              </Link>
              <span className="v-time">{formatTimeAgo(video.published_at, language)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
