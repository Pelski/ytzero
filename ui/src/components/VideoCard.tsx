import {
  Archive,
  ArrowDownToLine,
  CalendarCheck,
  CalendarX,
  Check,
  Eye,
  EyeOff,
  Heart,
  Lock,
  Star,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { memo, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDrag } from "@use-gesture/react";
import { api, type Video } from "../api";
import { emit } from "../events";
import { formatTimeAgo, useI18n } from "../i18n";
import { img } from "../img";
import Tooltip from "./Tooltip";
import { VideoThumbnail, watchProgress } from "./VideoThumbnail";
import { BUCKET_ICONS, VideoScheduleActions } from "./VideoScheduleActions";
import { Badge } from "./ui";
import "./VideoCard.css";

export { BUCKET_ICONS } from "./VideoScheduleActions";
const SWIPE_THRESHOLD = 90;
const SWIPE_EXIT_GUTTER = 24;
const SWIPE_MAX_DRAG = 160;
const SWIPE_FEEDBACK_MS = 720;
const FINAL_EXIT_MS = 280;
export type CardFeedback = "watched" | "unwatched" | "rejected" | "restored" | "scheduled" | "unscheduled";

/** Duration in seconds for sorting/comparing; null when the string is unparseable. */
export function parseVideoDurationSeconds(duration: string | null): number | null {
  if (!duration) return null;
  const raw = duration.trim();
  if (!raw) return null;
  const colonParts = raw.split(":").map((part) => part.trim());
  if (colonParts.length >= 2 && colonParts.every((part) => /^\d+$/.test(part))) {
    let seconds = 0;
    for (const part of colonParts) seconds = seconds * 60 + Number(part);
    return seconds;
  }
  const hourMatch = raw.match(/(\d+)\s*(?:h|hr|hrs|hour|hours|godz\.?|godzin|godziny)/i);
  const minuteMatch = raw.match(/(\d+)\s*(?:m|min|mins|minute|minutes|minut|minuty)/i);
  const secondMatch = raw.match(/(\d+)\s*(?:s|sec|secs|second|seconds|sek|sekund|sekundy)/i);
  if (hourMatch || minuteMatch || secondMatch) {
    return Number(hourMatch?.[1] ?? 0) * 3600 + Number(minuteMatch?.[1] ?? 0) * 60 + Number(secondMatch?.[1] ?? 0);
  }
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

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

function VideoCard({
  video,
  onPlay,
  onChanged,
  showRestore,
  showChannelAvatar = true,
  searchResultLayout = false,
  onRemoveFromPlaylist,
  isWatched,
  isLiked,
  showWatchProgress,
  selectable = false,
  selected = false,
  onSelectToggle,
  readOnly = false,
  entering = false,
  showFoundTime = false,
}: {
  video: Video;
  onPlay: (v: Video) => void;
  onChanged: (videoId?: string, feedback?: CardFeedback) => void;
  showRestore?: boolean;
  showChannelAvatar?: boolean;
  searchResultLayout?: boolean;
  onRemoveFromPlaylist?: (videoId: string) => Promise<unknown>;
  isWatched?: boolean;
  isLiked?: boolean;
  showWatchProgress?: boolean;
  /** Selection mode: clicking the card toggles it instead of playing; swipe and hover actions are disabled. */
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: (videoId: string) => void;
  /** Preview mode (e.g. cleanup's "what stays" column): no swipe, no hover actions, still clickable to open. */
  readOnly?: boolean;
  /** Briefly animate a card that has just moved into this grid. */
  entering?: boolean;
  /** Main-feed arrival view: show both YouTube publication and first-seen times. */
  showFoundTime?: boolean;
}) {
  const { t, language, locale } = useI18n();
  const navigate = useNavigate();
  const [fading, setFading] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [actionProximity, setActionProximity] = useState(0);
  const [actionsPinned, setActionsPinned] = useState(false);
  const [actionsHovered, setActionsHovered] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState(video.download_status ?? null);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [committedDir, setCommittedDir] = useState<"left" | "right" | null>(null);
  const [committedFeedback, setCommittedFeedback] = useState<CardFeedback | null>(null);
  const canDownloadLocally = video.live_status !== "live" && video.live_status !== "upcoming";
  const publishedTime = formatTimeAgo(video.published_at, language);
  const foundTime = formatTimeAgo(video.found_at ? `${video.found_at.replace(" ", "T")}Z` : null, language);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastProximityRef = useRef(0);
  const blockNextThumbClickRef = useRef(false);
  const blockClickAfterDragRef = useRef(false);
  const actionsOpen = actionsPinned || actionsHovered || actionProximity > 0.52;

  const exitLeft = () => {
    const cardWidth = cardRef.current?.getBoundingClientRect().width ?? SWIPE_MAX_DRAG;
    setSwipeX(-(cardWidth + SWIPE_EXIT_GUTTER));
  };

  const removeWithLayoutAnimation = (feedback?: CardFeedback) => {
    exitLeft();
    setFading(true);
    window.setTimeout(() => {
      setRemoved(true);
      onChanged(video.video_id, feedback);
    }, FINAL_EXIT_MS);
  };

  const fade = (fn: () => Promise<unknown>, feedback: CardFeedback = "rejected") => {
    fn().then(() => {
      setCommittedFeedback(feedback);
      setCommittedDir(feedback === "watched" ? "right" : "left");
      setFading(true);
      setTimeout(() => removeWithLayoutAnimation(feedback), 180);
    });
  };

  const act = (e: MouseEvent, fn: () => Promise<unknown>, feedback?: CardFeedback) => {
    e.stopPropagation();
    fade(fn, feedback);
  };

  const queueAct = (fn: () => Promise<unknown>) =>
    fn().then((result) => {
      emit("queue-changed");
      return result;
    });

  const markWatchedAndArchive = () =>
    api.complete(video.video_id).then(() => api.archiveVideo(video.video_id));

  const markUnwatched = () => api.markUnwatched(video.video_id);

  const requestLocalDownload = (e: MouseEvent) => {
    e.stopPropagation();
    // Plugin off: send the user to the plugin settings instead of failing.
    if (!video.downloads_enabled) {
      navigate("/settings?tab=plugins");
      return;
    }
    setDownloadStatus("queued");
    api.requestDownload(video.video_id)
      .then((result) => setDownloadStatus(result.download?.status ?? "queued"))
      .catch(() => setDownloadStatus(video.download_status ?? null));
  };

  const cancelLocalDownload = (e: MouseEvent) => {
    e.stopPropagation();
    setDownloadStatus(null);
    api.removeDownload(video.video_id).catch(() => setDownloadStatus(video.download_status ?? null));
  };

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
      enabled: !selectable && !readOnly,
    }
  );

  const commitSwipe = (mx: number) => {
    if (Math.abs(mx) >= SWIPE_THRESHOLD) {
      const dir = mx < 0 ? "left" : "right";
      const cardWidth = cardRef.current?.getBoundingClientRect().width ?? SWIPE_MAX_DRAG;
      const exitX = (dir === "left" ? -1 : 1) * (cardWidth + SWIPE_EXIT_GUTTER);
      setSwiping(false);
      setCommittedDir(dir);
      setCommittedFeedback(dir === "left" ? "rejected" : "watched");
      setSwipeX(exitX);
      setFading(true);
      const action = dir === "left"
        ? api.archiveVideo(video.video_id)
        : markWatchedAndArchive();
      action.then(() => {
        setTimeout(() => removeWithLayoutAnimation(dir === "left" ? "rejected" : "watched"), SWIPE_FEEDBACK_MS);
      });
    } else {
      setCommittedDir(null);
      setCommittedFeedback(null);
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
    if ((e.target as HTMLElement).closest(".thumb-actions")) {
      setActionsHovered(true);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const next = getActionProximity(rect, e.clientX, e.clientY);
    if (Math.abs(next - lastProximityRef.current) < 0.025) return;
    lastProximityRef.current = next;
    setActionProximity(next);
  };

  const toggleActions = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setActionsPinned((pinned) => {
      const next = !pinned;
      lastProximityRef.current = next ? 1 : 0;
      setActionProximity(next ? 1 : 0);
      return next;
    });
  };

  const resetActionProximity = (e: PointerEvent<HTMLDivElement>) => {
    // Touch pointers leave the element as soon as the finger is lifted. Keep
    // the menu open until an action or an explicit outside tap instead.
    if (e.pointerType !== "mouse") return;
    lastProximityRef.current = 0;
    setActionProximity(0);
  };

  useEffect(() => {
    if (!actionsOpen) return;
    const closeOnOutsideTap = (event: Event) => {
      if (cardRef.current?.contains(event.target as Node)) return;
      lastProximityRef.current = 0;
      setActionProximity(0);
      setActionsPinned(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideTap);
    return () => document.removeEventListener("pointerdown", closeOnOutsideTap);
  }, [actionsOpen]);

  const videoHref = `/watch/${video.video_id}`;

  const playFromLink = (e: MouseEvent<HTMLAnchorElement>) => {
    if (selectable) {
      e.preventDefault();
      e.stopPropagation();
      onSelectToggle?.(video.video_id);
      return;
    }
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
  const revealFeedback: CardFeedback | null = committedFeedback
    ?? (activeSwipeDir === "right" ? "watched" : activeSwipeDir === "left" ? "rejected" : null);
  const RevealIcon = revealFeedback === "watched"
    ? Eye
    : revealFeedback === "unwatched"
      ? EyeOff
      : revealFeedback === "restored"
        ? Undo2
        : revealFeedback === "scheduled"
          ? CalendarCheck
          : revealFeedback === "unscheduled"
            ? CalendarX
            : Archive;
  const revealLabel = revealFeedback === "watched"
    ? t("watched")
    : revealFeedback === "unwatched"
      ? t("markUnwatched")
      : revealFeedback === "restored"
        ? t("restore")
        : revealFeedback === "scheduled"
          ? t("scheduledFeedback")
          : revealFeedback === "unscheduled"
            ? t("scheduleRemovedFeedback")
            : t("reject");
  const revealClass = revealFeedback === "watched"
    ? "swipe-reveal--left"
    : revealFeedback === "unwatched"
      ? "swipe-reveal--unscheduled"
      : revealFeedback === "restored"
        ? "swipe-reveal--restored"
        : revealFeedback === "scheduled"
          ? "swipe-reveal--scheduled"
          : revealFeedback === "unscheduled"
            ? "swipe-reveal--unscheduled"
            : "swipe-reveal--right";
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
    <div className={`swipe-wrap${fading ? " card-fading" : ""}${entering ? " video-card-entering" : ""}`}>
      {revealFeedback && (
        <div className={`swipe-reveal ${revealClass}`} style={{ width: revealWidth, opacity: fading ? undefined : contentOpacity }}>
          <span className="swipe-reveal-icon">
            <RevealIcon size={22} />
          </span>
          <span className="swipe-reveal-label">{revealLabel}</span>
        </div>
      )}

      <div
        ref={cardRef}
        {...bind()}
        className={`video-card${watched ? " video-card--watched" : ""}${searchResultLayout ? " video-card--search-result" : ""}`}
        style={{
          transform: `translateX(${swipeX}px) ${cardTilt} ${cardFadeScale}`,
          transition: cardTransition,
          touchAction: "pan-y",
          userSelect: "none",
          willChange: swiping ? "transform" : "auto",
        }}
      >
        {video.members_only === 1 && (
          <Tooltip text={t("membersOnly")} pos="right" delay={300} className={`members-only-marker${isLiked && video.is_short === 1 ? " members-only-marker--stacked" : ""}`}>
            <span className="members-only-marker__icon" aria-label={t("membersOnly")}>
              <Star size={15} fill="currentColor" />
            </span>
          </Tooltip>
        )}
        <div
          className={`thumb-wrap${actionsOpen ? " controls-near" : ""}`}
          style={{ "--actions-proximity": actionProximity } as CSSProperties}
          onPointerMove={selectable || readOnly ? undefined : updateActionProximity}
          onPointerLeave={selectable || readOnly ? undefined : resetActionProximity}
        >
          {selectable && (
            <button
              type="button"
              className={`video-card-select-badge${selected ? " video-card-select-badge--checked" : ""}`}
              aria-pressed={selected}
              aria-label={t("selectVideo")}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelectToggle?.(video.video_id); }}
            >
              {selected && <Check size={14} />}
            </button>
          )}
          <Tooltip text={video.title} pos="top" delay={450} className="tooltip-wrap--block tooltip-wrap--title tooltip-wrap--card-title">
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
                progress={video.status !== "archived" || showWatchProgress
                  ? watchProgress(video.watch_position, video.watch_duration)
                  : null}
                variant="card"
                loading="lazy"
                draggable={false}
              />
            </Link>
          </Tooltip>
          {isLiked && video.is_short === 1 && (
            <span className="thumb-liked-badge"><Heart size={12} fill="currentColor" /></span>
          )}
          {downloadStatus === "done" && (
            <span className="thumb-dl-badge" title={t("downloaded")}><ArrowDownToLine size={11} /></span>
          )}
          {video.live_status === "live" && (
            <span className="live-badge">
              <span className="pulse" /> {t("liveBadge")}
            </span>
          )}
          {video.live_status === "upcoming" && <span className="live-badge upcoming">{t("upcomingBadge")}</span>}
          {video.is_private === 1 && (
            <Badge variant="warning" size="sm" className="private-video-badge">
              <Lock size={11} /> {t("privateVideoBadge")}
            </Badge>
          )}
          {video.is_private !== 1 && video.is_short === 1 && video.live_status === "none" && <span className="short-badge">{t("shortBadge")}</span>}
          {video.is_private !== 1 && video.duration && video.is_short !== 1 && (
            <span className="duration-badge">{formatVideoDuration(video.duration)}</span>
          )}
          {(downloadStatus === "downloading" || downloadStatus === "queued") && (
            <div className="dl-progress-top" title={downloadStatus === "queued" ? t("downloadQueued") : t("downloading")}>
              <div
                className={`dl-progress-top-fill${downloadStatus === "queued" ? " queued" : ""}`}
                style={downloadStatus === "downloading"
                  ? { width: `${Math.min(100, Math.max(3, video.download_progress ?? 0))}%` }
                  : undefined}
              />
            </div>
          )}
          {!selectable && !readOnly && (
          <div className="thumb-actions-zone">
            <button
              type="button"
              className="thumb-actions-peek"
              aria-label={t("moreActions")}
              aria-expanded={actionsOpen}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleActions}
            >
              <span /><span /><span /><span />
            </button>
            <div
              className="thumb-actions"
              onPointerEnter={(e) => { if (e.pointerType === "mouse") setActionsHovered(true); }}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") setActionsHovered(false); }}
            >
              <VideoScheduleActions
                video={video}
                variant="overlay"
                onToggle={(e, bucket, active) => act(
                  e,
                  () => queueAct(() => active ? api.dequeue(video.video_id) : api.queue(video.video_id, bucket)),
                  active ? "unscheduled" : "scheduled",
                )}
              />
              <div className="thumb-actions-row secondary">
                {video.is_private !== 1 && canDownloadLocally && video.downloads_enabled && (downloadStatus === "queued" || downloadStatus === "downloading") && (
                  <Tooltip text={t("cancelDownload")}>
                    <button className="action-btn" onClick={cancelLocalDownload}>
                      <X />
                    </button>
                  </Tooltip>
                )}
                {video.is_private !== 1 && canDownloadLocally && (video.downloads_enabled || video.downloads_allowed) && downloadStatus !== "done" && downloadStatus !== "queued" && downloadStatus !== "downloading" && (
                  <Tooltip text={video.downloads_enabled ? t("downloadLocally") : t("enableDownloadsPlugin")}>
                    <button className="action-btn" onClick={requestLocalDownload}>
                      <ArrowDownToLine />
                    </button>
                  </Tooltip>
                )}
                {video.status !== "archived" && (
                  <Tooltip text={t("reject")}>
                    <button className="action-btn" onClick={(e) => act(e, () => api.archiveVideo(video.video_id), "rejected")}>
                      <Archive />
                    </button>
                  </Tooltip>
                )}
                {watched ? (
                  <Tooltip text={t("markUnwatched")}>
                    <button className="action-btn" onClick={(e) => act(e, markUnwatched, "unwatched")}>
                      <EyeOff />
                    </button>
                  </Tooltip>
                ) : video.status !== "archived" ? (
                  <Tooltip text={t("markWatched")}>
                    <button className="action-btn" onClick={(e) => act(e, markWatchedAndArchive, "watched")}>
                      <Eye />
                    </button>
                  </Tooltip>
                ) : null}
                {showRestore && (
                  <Tooltip text={t("restore")}>
                    <button className="action-btn" onClick={(e) => act(e, () => api.restore(video.video_id), "restored")}>
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
          )}
        </div>

        {searchResultLayout ? (
          <div className="card-body">
            <Tooltip text={video.title} pos="top" delay={450} className="tooltip-wrap--block tooltip-wrap--title tooltip-wrap--card-title">
              <Link to={videoHref} className="v-title" onClick={playFromLink}>{video.title}</Link>
            </Tooltip>
            {(video.views != null || publishedTime) && (
              <div className="v-search-meta">
                {video.views != null && `${video.views.toLocaleString(locale)} ${t("views")}`}
                {video.views != null && publishedTime && " · "}
                {publishedTime}
              </div>
            )}
            <div className="v-search-channel">
              {showChannelAvatar && (
                <Link to={`/channel/${video.channel_id}`} className="card-avatar-link">
                  {video.channel_thumbnail ? (
                    <img className="card-ch-avatar" src={img(video.channel_thumbnail)} alt="" draggable={false} />
                  ) : (
                    <div className="card-ch-avatar card-ch-avatar-fallback">{video.channel_title.charAt(0).toUpperCase()}</div>
                  )}
                </Link>
              )}
              <Link to={`/channel/${video.channel_id}`} className="v-channel">{video.channel_title}</Link>
            </div>
          </div>
        ) : (
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
              <Tooltip text={video.title} pos="top" delay={450} className="tooltip-wrap--block tooltip-wrap--title tooltip-wrap--card-title">
                <Link to={videoHref} className="v-title" onClick={playFromLink}>
                  {video.title}
                </Link>
              </Tooltip>
              <div className="v-channel-meta">
                <Link to={`/channel/${video.channel_id}`} className={`v-channel${publishedTime ? "" : " no-date"}`}>
                  {video.channel_title}
                </Link>
                {publishedTime && !showFoundTime && <span className="v-time">{publishedTime}</span>}
                {showFoundTime && foundTime && (
                  <span className="v-time v-time--arrival">
                    {publishedTime && (
                      <Tooltip text={t("uploadedTime", { time: publishedTime })} pos="top">
                        <span className="v-time-item" aria-label={t("uploadedTime", { time: publishedTime })}>
                          <Upload size={13} aria-hidden="true" />
                          <span>{publishedTime}</span>
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip text={t("foundTime", { time: foundTime })} pos="top">
                      <span className="v-time-item" aria-label={t("foundTime", { time: foundTime })}>
                        <Eye size={13} aria-hidden="true" />
                        <span>{foundTime}</span>
                      </span>
                    </Tooltip>
                  </span>
                )}
              </div>
              {video.source_playlist_id && video.source_playlist_title && (
                <Link className="v-source-playlist" to={`/playlist/${video.source_playlist_id}`}>{video.source_playlist_title}</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(VideoCard);
