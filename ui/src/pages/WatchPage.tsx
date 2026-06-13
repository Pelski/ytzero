import { useEffect, useRef, useState } from "react";
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
  Share2,
  ThumbsUp,
  Undo2,
} from "lucide-react";
import { api, type AppSettings, type Bucket, type SponsorSegment, type UserPlaylist, type Video, SB_CATEGORIES } from "../api";
import { compactNumber, formatTimeAgo, formatViewsCount, useI18n } from "../i18n";
import TagChip from "../components/TagChip";
import { PlaylistIcon, PlaylistIconPicker } from "../components/PlaylistIcon";
import { BUCKET_ICONS } from "../components/VideoCard";
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

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Render plain text with URLs turned into clickable links. */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer"
            className="desc-link"
            onClick={(e) => e.stopPropagation()}
          >
            {p}
          </a>
        ) : (
          p
        )
      )}
    </>
  );
}

export default function WatchPage() {
  const { t, bucketLabel, language, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<Video | null>(null);
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
  const [sbSegments, setSbSegments] = useState<SponsorSegment[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const playlistMenuRef = useRef<HTMLDivElement>(null);
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const archivedRef = useRef(false);
  const progressRef = useRef<{ position: number; duration: number } | null>(null);
  const sbSegmentsRef = useRef<SponsorSegment[]>([]);

  useEffect(() => {
    api.settings().then((r) => setSettings(r.settings)).catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    sbSegmentsRef.current = sbSegments;
  }, [sbSegments]);

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
    archivedRef.current = false;
    window.scrollTo(0, 0);
    api
      .video(id)
      .then((r) => {
        setVideo(r.video);
        setRelated(r.related);
      })
      .catch(console.error);
    api.watch(id).catch(() => {});
  }, [id]);

  // Create YT.Player and poll progress every 5 s
  useEffect(() => {
    if (!id || !video || video.video_id !== id) return;

    const wrap = playerWrapRef.current;
    if (!wrap) return;
    const canAutoArchive = video.live_status !== "live" && video.live_status !== "upcoming";

    const startSeconds =
      video.watch_position && video.watch_duration && video.watch_duration > 0 &&
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
            api.archiveVideo(id).catch(() => {});
          }
          for (const seg of sbSegmentsRef.current) {
            if (position >= seg.segment[0] && position < seg.segment[1] - 0.3) {
              p.seekTo(seg.segment[1], true);
              break;
            }
          }
        } catch {}
      }, 1_000);
    });

    return () => {
      destroyed = true;
      clearInterval(pollInterval);
      if (progressRef.current) {
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
  }, [id, video?.video_id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

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

  useEffect(() => {
    localStorage.setItem(CINEMA_MODE_KEY, cinemaMode ? "1" : "0");
    document.body.classList.toggle("cinema", cinemaMode);
    if (cinemaMode) {
      document.body.classList.add("sidebar-hidden");
    } else {
      document.body.classList.remove("sidebar-hidden");
    }
    if (!cinemaMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCinemaMode(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("cinema", "sidebar-hidden");
      document.removeEventListener("keydown", onKey);
    };
  }, [cinemaMode]);

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

  if (!video) return null;

  const reload = () => api.video(video.video_id).then((r) => setVideo(r.video));

  const copyLink = () => {
    navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${video.video_id}`).then(() => {
      setCopyKey((k) => k + 1);
    });
  };

  const queue = async (bucket: Bucket) => {
    setMenuOpen(false);
    await api.queue(video.video_id, bucket);
    emit("queue-changed");
    reload();
  };

  const openPlaylistMenu = async () => {
    const next = !playlistOpen;
    setPlaylistOpen(next);
    if (next) {
      const r = await api.userPlaylists(video.video_id);
      setPlaylists(r.playlists);
    }
  };

  const togglePlaylist = async (playlist: UserPlaylist) => {
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
    if (!newPlaylistName.trim()) return;
    const r = await api.createUserPlaylist({ name: newPlaylistName.trim(), icon: newPlaylistIcon });
    await api.addVideoToUserPlaylist(r.playlist.id, video.video_id);
    setPlaylists((items) => [...items, { ...r.playlist, has_video: 1, video_count: 1 }]);
    setNewPlaylistName("");
    setNewPlaylistIcon("ListMusic");
    emit("playlists-changed");
  };

  return (
    <div className={`watch-layout${cinemaMode ? " theater" : ""}`}>
      <div>
        <div className="cinema-player-wrap">
          {cinemaMode && (
            <div
              className="player-glow"
              style={{ backgroundImage: `url(${img(video.thumbnail)})` }}
            />
          )}
          <div className="watch-player-shell">
            <div ref={playerWrapRef} className="watch-player" />
          </div>
        </div>
        <h1 className="watch-title">{video.title}</h1>
        <div className="watch-row">
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
                  <div className="sub">{video.channel_subscriber_count}</div>
                )}
              </div>
            </div>
          </div>
          <button
            className={`btn${cinemaMode ? " active" : ""}`}
            onClick={() => setCinemaMode((m) => !m)}
            title={t("cinemaMode")}
          >
            <Clapperboard size={15} /> {t("cinema")}
          </button>
          <div className="dropdown" ref={menuRef}>
            <button className="btn" onClick={() => setMenuOpen((o) => !o)}>
              <Clock /> {t("watchLater")}
            </button>
            {menuOpen && (
              <div className="dropdown-menu">
                {(["today", "tonight", "tomorrow", "weekend"] as Bucket[]).map((b) => {
                  const Icon = BUCKET_ICONS[b];
                  return (
                    <button key={b} onClick={() => queue(b)}>
                      <Icon /> {bucketLabel(b)}
                    </button>
                  );
                })}
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
        {(video.live_status === "live" || video.bucket || video.tags.length > 0) && (
          <div className="watch-tags">
            {video.live_status === "live" && (
              <span className="watch-queue-tag live">{t("liveStream")}</span>
            )}
            {video.bucket && (
              <span className="watch-queue-tag">{bucketLabel(video.bucket)}</span>
            )}
            {video.tags.map((t) => (
              <TagChip key={`${t.id}-${t.source}`} tag={t} />
            ))}
          </div>
        )}
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
              <Linkify text={video.description} />
            </>
          )}
        </div>
        {video.description && (
          <button className="watch-desc-toggle" onClick={() => setDescOpen((o) => !o)}>
            {descOpen ? t("showLess") : t("showMore")}
          </button>
        )}
        {sbSegments.length > 0 && (
          <div className="sb-segments">
            <span className="sb-segments-label">{t("sbSegmentsTitle")}</span>
            <div className="sb-segments-list">
              {[...sbSegments].sort((a, b) => a.segment[0] - b.segment[0]).map((seg) => {
                const cat = SB_CATEGORIES.find((c) => c.id === seg.category);
                return (
                  <div
                    key={seg.UUID}
                    className="sb-segment-row"
                    style={{ "--sb-color": cat?.color ?? "#888" } as React.CSSProperties}
                    onClick={() => playerRef.current?.seekTo(seg.segment[0], true)}
                  >
                    <span className="sb-dot" />
                    <span className="sb-segment-name">{cat?.label[language] ?? seg.category}</span>
                    <span className="sb-time">{fmtTime(seg.segment[0])} → {fmtTime(seg.segment[1])}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <aside>
        <h2 className="related-title">{t("moreLikeThis")}</h2>
        {related.filter((v) => v.is_short !== 1).map((v) => (
          <div key={v.video_id} className="related-item" onClick={() => navigate(`/watch/${v.video_id}`)}>
            <div className="thumb-wrap">
              <img src={img(v.thumbnail)} alt="" loading="lazy" />
              {v.live_status === "live" && (
                <span className="live-badge">
                  <span className="pulse" /> {t("liveBadge")}
                </span>
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
          </div>
        ))}
      </aside>
    </div>
  );
}
