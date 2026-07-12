import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { emit } from "../events";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  BookmarkPlus,
  CalendarDays,
  Check,
  Clock,
  Clapperboard,
  ExternalLink,
  Eye,
  Gauge,
  Pause,
  Play,
  Share2,
  SkipForward,
  Square,
  ThumbsUp,
  Undo2,
} from "lucide-react";
import { api, type AppSettings, type Bucket, type PlaylistVideo, type SponsorSegment, type UserPlaylist, type Video, type VideoChapter, type VideoInfo, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
import { compactNumber, formatTimeAgo, formatViewsCount, useI18n, type I18nKey } from "../i18n";
import TagChip from "../components/TagChip";
import { PlaylistIcon, PlaylistIconPicker } from "../components/PlaylistIcon";
import { BUCKET_ICONS, formatVideoDuration } from "../components/VideoCard";
import { img } from "../img";

let ytApiReady: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (!ytApiReady) {
    ytApiReady = new Promise<void>((resolve) => {
      const w = window as any;
      if (w.YT?.Player) { resolve(); return; }
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      if (!document.querySelector('script[src*="iframe_api"]')) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }
    });
  }
  return ytApiReady;
}

const CINEMA_MODE_KEY = "watchCinemaMode";
const SIDEBAR_KEY = "sidebar_open";

function restoreSidebarVisibility() {
  document.body.classList.remove("cinema");
  document.body.classList.toggle("sidebar-hidden", localStorage.getItem(SIDEBAR_KEY) === "0");
}
const WATCH_LATER_GROUPS: {
  labelKey: I18nKey;
  buckets: Bucket[];
}[] = [
  { labelKey: "groupToday", buckets: ["today", "tonight"] },
  { labelKey: "groupTomorrow", buckets: ["tomorrow", "tomorrow_evening"] },
  { labelKey: "groupWeekend", buckets: ["weekend"] },
];

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Render plain text with URLs turned into clickable links. */
function rewriteYouTubeUrl(url: string, base: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      if (id) return `${base}/watch/${id}`;
    }
    if (h === "youtube.com") {
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `${base}/watch/${id}`;
      }
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        if (id) return `${base}/watch/${id}`;
      }
      if (u.pathname.startsWith("/channel/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `${base}/channel/${id}`;
      }
    }
  } catch {}
  return null;
}

// YouTube glues a truncation marker straight onto long links in descriptions
// (e.g. "https://makerworld.com...​" with a trailing ellipsis + zero-width
// space). Peel that — plus stray trailing punctuation — off the URL so the href
// isn't broken and the leftover renders as plain text, the way YouTube shows it.
function splitTrailingJunk(url: string): [string, string] {
  let u = url;
  let trailing = "";
  const junk = /(\.\.\.|[​‌‍﻿…)\].,;:!?'"»」]+)$/;
  let m: RegExpMatchArray | null;
  while ((m = u.match(junk)) && m[0].length && u.length - m[0].length > "https://".length) {
    trailing = m[0] + trailing;
    u = u.slice(0, u.length - m[0].length);
  }
  return [u, trailing];
}

function Linkify({ text, baseUrl }: { text: string; baseUrl: string }) {
  const base = baseUrl || window.location.origin;
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!/^https?:\/\//.test(p)) return p;
        const [url, trailing] = splitTrailingJunk(p);
        const local = rewriteYouTubeUrl(url, base);
        return (
          <span key={i}>
            {local ? (
              <a href={local} className="desc-link" onClick={(e) => e.stopPropagation()}>
                {url}
              </a>
            ) : (
              <a href={url} target="_blank" rel="noreferrer" className="desc-link" onClick={(e) => e.stopPropagation()}>
                {url}
              </a>
            )}
            {trailing}
          </span>
        );
      })}
    </>
  );
}

export default function WatchPage() {
  const { t, bucketLabel, language, locale } = useI18n();
  const { id, playlistId } = useParams<{ id: string; playlistId?: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<Video | null>(null);
  const [videoMissing, setVideoMissing] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [related, setRelated] = useState<Video[]>([]);
  const [copyKey, setCopyKey] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistIcon, setNewPlaylistIcon] = useState("ListMusic");
  const [cinemaMode, setCinemaMode] = useState(() => localStorage.getItem(CINEMA_MODE_KEY) === "1");
  const [cinemaVisible, setCinemaVisible] = useState(() => localStorage.getItem(CINEMA_MODE_KEY) === "1");
  const [sbSegments, setSbSegments] = useState<SponsorSegment[]>([]);
  const [appUrl, setAppUrl] = useState("");
  const [sbPaused, setSbPaused] = useState(false);
  const [disabledSegs, setDisabledSegs] = useState<Set<string>>(new Set());
  const [chapters, setChapters] = useState<VideoChapter[]>([]);
  const [playlistVideos, setPlaylistVideos] = useState<PlaylistVideo[]>([]);
  const [speed, setSpeed] = useState("1");
  const [speedOpen, setSpeedOpen] = useState(false);
  // Path to the next playlist video, read by the player's onStateChange when a
  // video ends. A ref keeps the player effect free of playlist dependencies.
  const nextInPlaylistRef = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const playlistMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  // Desired playback rate, read by the player's onReady/onStateChange so the
  // player effect doesn't need speed in its dependency list.
  const speedRef = useRef("1");
  const likeButtonRef = useRef<HTMLButtonElement>(null);
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const archivedRef = useRef(false);
  const progressRef = useRef<{ position: number; duration: number } | null>(null);
  const sbSegmentsRef = useRef<SponsorSegment[]>([]);
  const sbPausedRef = useRef(false);
  const disabledSegsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    api.settings().then((r) => setSettings(r.settings)).catch(() => setSettings(null));
    api.config().then((r) => setAppUrl(r.app_url)).catch(() => {});
  }, []);

  // Effective playback rate: per-channel override, else the global default.
  // Kept in a ref so the player effect can read it without re-creating the player.
  useEffect(() => {
    const eff = video?.channel_playback_speed ?? settings?.player_speed ?? "1";
    setSpeed(eff);
    speedRef.current = eff;
  }, [video?.channel_playback_speed, settings?.player_speed]);

  useEffect(() => {
    sbSegmentsRef.current = sbSegments;
  }, [sbSegments]);
  useEffect(() => { sbPausedRef.current = sbPaused; }, [sbPaused]);
  useEffect(() => { disabledSegsRef.current = disabledSegs; }, [disabledSegs]);

  // Reset skip overrides when navigating to another video.
  useEffect(() => {
    setSbPaused(false);
    setDisabledSegs(new Set());
  }, [id]);

  useEffect(() => {
    setChapters([]);
    if (!id) return;
    let cancelled = false;
    api.chapters(id)
      .then((r) => { if (!cancelled) setChapters(r.chapters); })
      .catch(() => { if (!cancelled) setChapters([]); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!playlistId) { setPlaylistVideos([]); return; }
    let cancelled = false;
    api.playlistVideos(playlistId)
      .then((r) => { if (!cancelled) setPlaylistVideos(r.videos); })
      .catch(() => { if (!cancelled) setPlaylistVideos([]); });
    return () => { cancelled = true; };
  }, [playlistId]);

  const playlistIndex = playlistId ? playlistVideos.findIndex((v) => v.videoId === id) : -1;

  // Keep the "next video" target in sync for the player's end-of-video handler.
  useEffect(() => {
    const next = playlistIndex >= 0 ? playlistVideos[playlistIndex + 1] : undefined;
    nextInPlaylistRef.current = next ? `/watch/${next.videoId}/playlist/${playlistId}` : null;
  }, [playlistIndex, playlistVideos, playlistId]);

  useEffect(() => {
    if (!video || settings?.sponsorblock_enabled !== "1") {
      setSbSegments([]);
      return;
    }
    let cancelled = false;
    const cats = (() => {
      try { return JSON.parse(settings.sponsorblock_categories || '["sponsor"]') as string[]; }
      catch { return ["sponsor"]; }
    })();
    if (cats.length === 0) { setSbSegments([]); return; }
    api.sponsorblock(video.video_id, cats)
      .then((segs) => { if (!cancelled) setSbSegments(segs.filter((s) => s.actionType === "skip")); })
      .catch(() => { if (!cancelled) setSbSegments([]); });
    return () => { cancelled = true; };
  }, [video?.video_id, settings?.sponsorblock_enabled, settings?.sponsorblock_categories]);

  useEffect(() => {
    if (!id) return;
    setDescOpen(false);
    setVideo(null);
    setVideoMissing(false);
    setVideoInfo(null);
    archivedRef.current = false;
    window.scrollTo(0, 0);
    api
      .video(id)
      .then((r) => {
        setVideo(r.video);
        setRelated(r.related);
        // External video already in DB but its RSS siblings were cleared:
        // refresh them in the background so the "related" panel refills.
        if (r.video.external && r.related.length === 0) {
          api.videoInfo(id)
            .then(() => api.video(id))
            .then((r2) => setRelated(r2.related))
            .catch(() => {});
        }
      })
      .catch((e: Error) => {
        if (e.message === "not found" || e.message.startsWith("HTTP 4")) {
          setVideoMissing(true);
          api.videoInfo(id)
            .then((r) => {
              setVideoInfo(r.info);
              // Video was just inserted as external — fetch the full Video object
              return api.video(id).then((full) => {
                setVideo(full.video);
                setRelated(full.related);
                setVideoMissing(false);
                setVideoInfo(null);
              });
            })
            .catch(() => {});
        } else {
          console.error(e);
        }
      });
    api.watch(id).catch(() => {});
  }, [id]);

  // Create YT.Player and poll progress every 5 s
  useEffect(() => {
    if (!id || (!video && !videoMissing)) return;

    const wrap = playerWrapRef.current;
    if (!wrap) return;
    const canAutoArchive = video ? (video.live_status !== "live" && video.live_status !== "upcoming") : false;

    const startSeconds =
      video?.watch_position && video?.watch_duration && video.watch_duration > 0 &&
      video.watch_position / video.watch_duration < 0.9
        ? Math.floor(video.watch_position) : 0;

    const playerVars: Record<string, any> = {
      autoplay: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
      origin: window.location.origin,
    };
    if (startSeconds > 10) playerVars.start = startSeconds;
    if (settings?.player_hl) playerVars.hl = settings.player_hl;
    if (settings?.player_cc === "1") {
      playerVars.cc_load_policy = 1;
      if (settings.player_cc_lang) playerVars.cc_lang_pref = settings.player_cc_lang;
    }
    if (settings?.player_quality && settings.player_quality !== "auto") playerVars.vq = settings.player_quality;

    let pollInterval: ReturnType<typeof setInterval>;
    let destroyed = false;
    // YT resets the rate to 1× on load, so apply the desired speed once the
    // player is ready and again on the first PLAYING event to make it stick.
    let speedApplied = false;
    const applySpeed = (p: any) => {
      try { p?.setPlaybackRate(Number(speedRef.current)); } catch {}
    };

    const inner = document.createElement("div");
    inner.id = `yt-inner-${id}`;
    wrap.appendChild(inner);

    loadYouTubeApi().then(() => {
      if (destroyed) return;
      const w = window as any;
      playerRef.current = new w.YT.Player(`yt-inner-${id}`, {
        host: "https://www.youtube-nocookie.com",
        videoId: id,
        width: "100%",
        height: "100%",
        playerVars,
        events: {
          onReady: (e: any) => applySpeed(e.target),
          onStateChange: (e: any) => {
            // 1 === playing: apply the desired speed once (YT resets on load).
            if (e?.data === 1 && !speedApplied) {
              speedApplied = true;
              applySpeed(e.target);
            }
            // 0 === ended: advance to the next playlist video when in a playlist.
            if (e?.data === 0 && nextInPlaylistRef.current) {
              navigate(nextInPlaylistRef.current);
            }
          },
        },
      });

      pollInterval = setInterval(() => {
        const p = playerRef.current;
        if (!p?.getCurrentTime) return;
        try {
          const position = p.getCurrentTime() as number;
          const playerDuration = p.getDuration() as number;
          if (!position || !playerDuration) return;
          progressRef.current = { position, duration: playerDuration };
          api.saveProgress(id, position, playerDuration).catch(() => {});
          if (canAutoArchive && playerDuration > 30 && position / playerDuration >= 0.9 && !archivedRef.current) {
            archivedRef.current = true;
            api.saveProgress(id, playerDuration, playerDuration).catch(() => {});
            api.archiveVideo(id).catch(() => {});
          }
          if (!sbPausedRef.current) {
            for (const seg of sbSegmentsRef.current) {
              if (disabledSegsRef.current.has(seg.UUID)) continue;
              if (position >= seg.segment[0] && position < seg.segment[1] - 0.3) {
                p.seekTo(seg.segment[1], true);
                break;
              }
            }
          }
        } catch {}
      }, 1_000);
    });

    return () => {
      destroyed = true;
      clearInterval(pollInterval);
      if (progressRef.current && !archivedRef.current) {
        const { position, duration } = progressRef.current;
        api.saveProgress(id, position, duration).catch(() => {});
        progressRef.current = null;
      }
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    };
  }, [id, video?.video_id, videoMissing]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!speedOpen) return;
    const close = (e: MouseEvent) => {
      if (!speedMenuRef.current?.contains(e.target as Node)) setSpeedOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [speedOpen]);

  // Apply a speed: change playback now and persist it as this channel's override
  // (null clears the override, falling back to the global default).
  const changeSpeed = (v: string | null) => {
    const eff = v ?? settings?.player_speed ?? "1";
    setSpeed(eff);
    speedRef.current = eff;
    try { playerRef.current?.setPlaybackRate(Number(eff)); } catch {}
    setSpeedOpen(false);
    if (video) {
      api.setChannelSpeed(video.channel_id, v).catch(() => {});
      setVideo((prev) => (prev ? { ...prev, channel_playback_speed: v } : prev));
    }
  };

  useEffect(() => {
    if (!playlistOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Element;
      if (playlistMenuRef.current?.contains(target)) return;
      if (target.closest?.(".playlist-icon-popover")) return;
      setPlaylistOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [playlistOpen]);

  // Cinema class lifecycle — separated from key listener so cleanup doesn't
  // prematurely remove the class when transitioning out.
  useEffect(() => {
    localStorage.setItem(CINEMA_MODE_KEY, cinemaMode ? "1" : "0");
    if (cinemaMode) {
      document.body.classList.add("cinema", "sidebar-hidden");
      requestAnimationFrame(() => requestAnimationFrame(() => setCinemaVisible(true)));
    } else {
      setCinemaVisible(false);
      const t = setTimeout(() => {
        restoreSidebarVisibility();
      }, 400);
      return () => {
        clearTimeout(t);
        restoreSidebarVisibility();
      };
    }
  }, [cinemaMode]);

  // Escape key — only active in cinema mode
  useEffect(() => {
    if (!cinemaMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCinemaMode(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cinemaMode]);

  // Unmount: clean cinema mode without overriding the user's saved sidebar state.
  useEffect(() => restoreSidebarVisibility, []);

  // Keyboard shortcuts: T = cinema, F = fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input,textarea,select")) return;
      if (e.key === "t" || e.key === "T") setCinemaMode((v) => !v);
      if (e.key === "f" || e.key === "F") {
        const el = playerWrapRef.current ?? document.documentElement;
        if (!document.fullscreenElement) el.requestFullscreen?.();
        else document.exitFullscreen?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Refresh views + likes in the background every 30 s while watching
  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => {
      api.video(id).then((r) => {
        setVideo((prev) => prev ? { ...prev, views: r.video.views, likes: r.video.likes } : prev);
      }).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    const title = (video?.title ?? videoInfo?.title ?? "").trim();
    document.title = title || (id ? `YouTube video ${id}` : "YouTube video");
  }, [id, video?.title, videoInfo?.title]);

  if (!video && !videoMissing) return null;

  const reload = () => video && api.video(video.video_id).then((r) => setVideo(r.video));

  const copyLink = () => {
    if (!video) return;
    navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${video.video_id}`).then(() => {
      setCopyKey((k) => k + 1);
    });
  };

  const queue = async (bucket: Bucket) => {
    if (!video) return;
    setMenuOpen(false);
    await api.queue(video.video_id, bucket);
    emit("queue-changed");
    reload();
  };

  const openPlaylistMenu = async () => {
    if (!video) return;
    const next = !playlistOpen;
    setPlaylistOpen(next);
    if (next) {
      const r = await api.userPlaylists(video.video_id);
      setPlaylists(r.playlists);
    }
  };

  const togglePlaylist = async (playlist: UserPlaylist) => {
    if (!video) return;
    const hasVideo = playlist.has_video === 1;
    if (hasVideo) await api.removeVideoFromUserPlaylist(playlist.id, video.video_id);
    else await api.addVideoToUserPlaylist(playlist.id, video.video_id);
    setPlaylists((items) =>
      items.map((p) =>
        p.id === playlist.id
          ? { ...p, has_video: hasVideo ? 0 : 1, video_count: Math.max(0, p.video_count + (hasVideo ? -1 : 1)) }
          : p
      )
    );
    emit("playlists-changed");
  };

  const createPlaylist = async () => {
    if (!video || !newPlaylistName.trim()) return;
    const r = await api.createUserPlaylist({ name: newPlaylistName.trim(), icon: newPlaylistIcon });
    await api.addVideoToUserPlaylist(r.playlist.id, video.video_id);
    setPlaylists((items) => [...items, { ...r.playlist, has_video: 1, video_count: 1 }]);
    setNewPlaylistName("");
    setNewPlaylistIcon("ListMusic");
    emit("playlists-changed");
  };

  const toggleLiked = async () => {
    if (!video) return;
    const next = video.liked !== 1;
    if (next && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const rect = likeButtonRef.current?.getBoundingClientRect();
      confetti({
        particleCount: 90,
        spread: 65,
        startVelocity: 36,
        scalar: 0.85,
        origin: rect
          ? {
              x: (rect.left + rect.width / 2) / window.innerWidth,
              y: (rect.top + rect.height / 2) / window.innerHeight,
            }
          : { x: 0.5, y: 0.65 },
      });
    }
    setVideo((prev) => prev ? { ...prev, liked: next ? 1 : null } : prev);
    try {
      await api.likeVideo(video.video_id, next);
    } catch (e) {
      setVideo((prev) => prev ? { ...prev, liked: next ? null : 1 } : prev);
      console.error(e);
    }
  };

  return (
    <div className={`watch-layout${cinemaMode ? " theater" : ""}`}>
      <div>
        <div className="cinema-player-wrap">
          {video && (
            <div
              className="player-glow"
              style={{ backgroundImage: `url(${img(video.thumbnail)})`, opacity: cinemaVisible ? 0.6 : 0 }}
            />
          )}
          <div className="watch-player-shell">
            <div ref={playerWrapRef} className="watch-player" />
          </div>
        </div>
        {(video ?? videoInfo) && (
          <h1 className="watch-title">{video?.title ?? videoInfo?.title}</h1>
        )}
        {videoMissing && videoInfo && (
          <div className="watch-row">
            <div className="watch-channel">
              <div className="watch-channel-top">
                <div>
                  <Link to={`/channel/${videoInfo.channelId}`} className="name channel-link">
                    {videoInfo.channelTitle}
                  </Link>
                </div>
              </div>
            </div>
            <a
              className="btn"
              href={`https://www.youtube.com/watch?v=${videoInfo.videoId}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              YouTube
            </a>
          </div>
        )}
        {videoMissing && videoInfo && (
          <div
            className={`watch-desc${descOpen ? "" : " clamped"}`}
            onClick={() => !descOpen && setDescOpen(true)}
          >
            <div className="watch-desc-stats">
              {videoInfo.viewCount != null && (
                <span className="stat"><Eye /> {formatViewsCount(videoInfo.viewCount, language)}</span>
              )}
              {videoInfo.publishedAt && (
                <span className="stat"><CalendarDays /> {new Date(videoInfo.publishedAt).toLocaleDateString(locale)}</span>
              )}
            </div>
            {videoInfo.description && (
              <>
                <div className="watch-desc-sep" />
                <Linkify text={videoInfo.description} baseUrl={appUrl} />
              </>
            )}
          </div>
        )}
        {videoMissing && videoInfo?.description && (
          <button className="watch-desc-toggle" onClick={() => setDescOpen((o) => !o)}>
            {descOpen ? t("showLess") : t("showMore")}
          </button>
        )}
        {video && <div className="watch-row">
          <div className="watch-channel">
            <div className="watch-channel-top">
              {video.channel_thumbnail && (
                <Link to={`/channel/${video.channel_id}`}>
                  <img className="watch-ch-avatar" src={img(video.channel_thumbnail)} alt="" />
                </Link>
              )}
              <div>
                <Link to={`/channel/${video.channel_id}`} className="name channel-link">
                  {video.channel_title}
                </Link>
                {video.channel_subscriber_count && (
                  <div className="sub">{video.channel_subscriber_count} {t("subscribers")}</div>
                )}
              </div>
            </div>
          </div>
          <div className="watch-actions">
            <button
              ref={likeButtonRef}
              className={`btn like-btn${video.liked === 1 ? " active like-active" : ""}`}
              title={video.liked === 1 ? t("unlike") : t("like")}
              aria-pressed={video.liked === 1}
              onClick={toggleLiked}
            >
              <ThumbsUp fill={video.liked === 1 ? "currentColor" : "none"} />
              {t("like")}
            </button>
            <button
              className={`btn${cinemaMode ? " active" : ""}`}
              onClick={() => setCinemaMode((m) => !m)}
              title={t("cinemaMode")}
            >
              <Clapperboard size={15} /> {t("cinema")}
            </button>
            <div className="dropdown" ref={speedMenuRef}>
              <button
                className={`btn${speed !== "1" ? " active" : ""}`}
                onClick={() => setSpeedOpen((o) => !o)}
                title={t("playbackSpeed")}
              >
                <Gauge size={15} /> {speed}×
              </button>
              {speedOpen && (
                <div className="dropdown-menu speed-menu">
                  {PLAYBACK_SPEEDS.map((s) => (
                    <button
                      key={s}
                      className={speed === s ? "is-selected" : undefined}
                      onClick={() => changeSpeed(s)}
                    >
                      {s === "1" ? "1×" : `${s}×`}
                      {speed === s && <span className="dropdown-menu-status"><Check size={14} /></span>}
                    </button>
                  ))}
                  {video?.channel_playback_speed != null && (
                    <button onClick={() => changeSpeed(null)}>{t("speedDefault")}</button>
                  )}
                </div>
              )}
            </div>
            <div className="dropdown" ref={menuRef}>
              <button className="btn" onClick={() => setMenuOpen((o) => !o)}>
                <Clock /> {t("watchLater")}
              </button>
              {menuOpen && (
                <div className="dropdown-menu schedule-menu">
                  {WATCH_LATER_GROUPS.map((group) => (
                    <div key={group.labelKey} className="dropdown-menu-group">
                      <div className="dropdown-menu-label">{t(group.labelKey)}</div>
                      <div className="dropdown-menu-row">
                        {group.buckets.map((b) => {
                          const Icon = BUCKET_ICONS[b];
                          return (
                            <button key={b} className="schedule-icon-choice" title={bucketLabel(b)} onClick={() => queue(b)}>
                              <Icon />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="dropdown" ref={playlistMenuRef}>
              <button className="btn icon-only" title={t("addToPlaylist")} onClick={openPlaylistMenu}>
                <BookmarkPlus />
              </button>
              {playlistOpen && (
                <div className="dropdown-menu playlist-picker-menu">
                  {playlists.length === 0 && <div className="dropdown-empty">{t("noPlaylists")}</div>}
                  {playlists.map((p) => (
                    <button key={p.id} className={p.has_video === 1 ? "is-selected" : undefined} onClick={() => togglePlaylist(p)}>
                      <span className="playlist-dot"><PlaylistIcon icon={p.icon} /></span>
                      {p.name}
                      {p.has_video === 1 && (
                        <span className="dropdown-menu-status"><Check size={14} /></span>
                      )}
                    </button>
                  ))}
                  <div className="dropdown-form">
                    <div className="dropdown-form-title">{t("newPlaylistDots")}</div>
                    <div className="dropdown-form-row">
                      <PlaylistIconPicker value={newPlaylistIcon} onChange={setNewPlaylistIcon} compact />
                      <input
                        value={newPlaylistName}
                        placeholder={t("name")}
                        onChange={(e) => setNewPlaylistName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
                      />
                    </div>
                    <button className="btn primary" disabled={!newPlaylistName.trim()} onClick={createPlaylist}>{t("createAndAdd")}</button>
                  </div>
                </div>
              )}
            </div>
            {video.status !== "archived" ? (
              <button className="btn icon-only" title={t("reject")} onClick={() => api.archiveVideo(video.video_id).then(reload)}>
                <Archive />
              </button>
            ) : (
              <button className="btn icon-only" title={t("restore")} onClick={() => api.restore(video.video_id).then(reload)}>
                <Undo2 />
              </button>
            )}
            <div className="share-btn-wrap">
              <button
                className="btn icon-only"
                title={t("copyYoutubeLink")}
                onClick={copyLink}
              >
                <Share2 />
              </button>
              {copyKey > 0 && (
                <span key={copyKey} className="copy-toast">{t("copied")}</span>
              )}
            </div>
            <a
              className="btn"
              href={`https://www.youtube.com/watch?v=${video.video_id}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              YouTube
            </a>
          </div>
        </div>}
        {video && (video.live_status === "live" || video.tags.length > 0) && (
          <div className="watch-tags">
            {video.live_status === "live" && (
              <span className="watch-queue-tag live">{t("liveStream")}</span>
            )}
            {video.tags.map((t) => (
              <TagChip key={`${t.id}-${t.source}`} tag={t} />
            ))}
          </div>
        )}
        {video && (
          <div
            className={`watch-desc${descOpen ? "" : " clamped"}`}
            onClick={() => !descOpen && setDescOpen(true)}
          >
            <div className="watch-desc-stats">
              {video.views != null && (
                <span className="stat"><Eye /> {formatViewsCount(video.views, language)}</span>
              )}
              {video.likes != null && (
                <span className="stat"><ThumbsUp /> {compactNumber(video.likes, language)}</span>
              )}
              {video.published_at && (
                <span className="stat"><CalendarDays /> {new Date(video.published_at).toLocaleDateString(locale)}</span>
              )}
            </div>
            {video.description && (
              <>
                <div className="watch-desc-sep" />
                <Linkify text={video.description} baseUrl={appUrl} />
              </>
            )}
          </div>
        )}
        {video?.description && (
          <button className="watch-desc-toggle" onClick={() => setDescOpen((o) => !o)}>
            {descOpen ? t("showLess") : t("showMore")}
          </button>
        )}
        {(chapters.length > 0 || sbSegments.length > 0) && (
          <div className="watch-panels">
            {chapters.length > 0 && (
              <div className="sb-segments watch-panel">
                <span className="sb-segments-label">{t("chaptersTitle")}</span>
                <div className="sb-segments-list">
                  {chapters.map((ch) => (
                    <div
                      key={ch.start}
                      className="sb-segment-row"
                      onClick={() => playerRef.current?.seekTo(ch.start, true)}
                    >
                      <span className="sb-segment-name">{ch.title}</span>
                      <span className="sb-time">{fmtTime(ch.start)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sbSegments.length > 0 && (
              <div className={`sb-segments watch-panel${sbPaused ? " sb-paused" : ""}`}>
                <div className="sb-segments-head">
                  <span className="sb-segments-label">{t("sbSegmentsTitle")}</span>
                  <button
                    type="button"
                    className={`sb-pause-btn${sbPaused ? " active" : ""}`}
                    onClick={() => setSbPaused((p) => !p)}
                    title={sbPaused ? t("sbResume") : t("sbPause")}
                  >
                    {sbPaused ? <Play /> : <Pause />}
                    <span>{sbPaused ? t("sbResume") : t("sbPause")}</span>
                  </button>
                </div>
                <div className="sb-segments-list">
                  {[...sbSegments].sort((a, b) => a.segment[0] - b.segment[0]).map((seg) => {
                    const cat = SB_CATEGORIES.find((c) => c.id === seg.category);
                    const off = disabledSegs.has(seg.UUID);
                    return (
                      <div
                        key={seg.UUID}
                        className={`sb-segment-row${off ? " disabled" : ""}`}
                        style={{ "--sb-color": cat?.color ?? "#888" } as React.CSSProperties}
                        onClick={() => playerRef.current?.seekTo(seg.segment[0], true)}
                      >
                        <span className="sb-dot" />
                        <span className="sb-segment-name">{cat ? t(cat.labelKey) : seg.category}</span>
                        <span className="sb-time">{fmtTime(seg.segment[0])} → {fmtTime(seg.segment[1])}</span>
                        <button
                          type="button"
                          className="sb-seg-toggle"
                          title={off ? t("sbSegEnable") : t("sbSegDisable")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDisabledSegs((prev) => {
                              const next = new Set(prev);
                              if (next.has(seg.UUID)) next.delete(seg.UUID);
                              else next.add(seg.UUID);
                              return next;
                            });
                          }}
                        >
                          {off ? <SkipForward /> : <Square />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <aside>
        {playlistId && playlistVideos.length > 0 && (
          <div className="watch-playlist-panel">
            <div className="watch-playlist-head">
              <span className="watch-playlist-title">{t("playlist")}</span>
              <span className="watch-playlist-count">
                {playlistIndex >= 0 ? playlistIndex + 1 : 1} / {playlistVideos.length}
              </span>
            </div>
            <div className="playlist-items">
              {playlistVideos.map((v, i) => (
                <Link
                  key={v.videoId}
                  to={`/watch/${v.videoId}/playlist/${playlistId}`}
                  className={`playlist-item${v.videoId === id ? " active" : ""}`}
                >
                  <span className="playlist-item-num">{i + 1}</span>
                  <div className="playlist-item-thumb">
                    <img src={img(v.thumbnail)} alt="" loading="lazy" />
                    {v.duration && <span className="playlist-item-dur">{v.duration}</span>}
                    {v.videoId === id && (
                      <span className="playlist-item-playing">
                        <Play size={12} fill="currentColor" />
                      </span>
                    )}
                  </div>
                  <div className="playlist-item-info">
                    <div className="playlist-item-title">{v.title}</div>
                    {v.channelTitle && <div className="playlist-item-ch">{v.channelTitle}</div>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
        <h2 className="related-title">{t("moreLikeThis")}</h2>
        {related.filter((v) => v.is_short !== 1).map((v) => (
          <Link key={v.video_id} className="related-item" to={`/watch/${v.video_id}`}>
            <div className="thumb-wrap">
              <img src={img(v.thumbnail)} alt="" loading="lazy" />
              {v.live_status === "live" && (
                <span className="live-badge">
                  <span className="pulse" /> {t("liveBadge")}
                </span>
              )}
              {v.duration && v.is_short !== 1 && (
                <span className="duration-badge">{formatVideoDuration(v.duration)}</span>
              )}
            </div>
            <div>
              <div className="r-title">{v.title}</div>
              <div className="r-meta">
                {v.channel_title}
                <br />
                {v.views != null && `${formatViewsCount(v.views, language)} · `}
                {formatTimeAgo(v.published_at, language)}
              </div>
            </div>
          </Link>
        ))}
      </aside>
    </div>
  );
}
