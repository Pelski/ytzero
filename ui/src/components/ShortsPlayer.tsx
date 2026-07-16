import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Heart, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
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

const TRANS_MS = 360;
const NUM_SLOTS = 3;

// Slot ring layout:
//   currentSlot        → y=0   (visible)
//   (cs+1)%3 (next)   → y=100 (below)
//   (cs+2)%3 (prev)   → y=-100 (above)
//
// translateY is in % of slot height (= 100dvh) — so 100% = one screen down.

type SlotState = {
  videoIdx: number | null;
  y: number;      // percentage (−100 / 0 / 100)
  animate: boolean;
};

export default function ShortsPlayer({
  videos,
  initialIndex,
  onClose,
  onVideoChange,
  onLoadMore,
  onWatched,
  onLiked,
}: {
  videos: Video[];
  initialIndex: number;
  onClose: () => void;
  onVideoChange: (videoId: string) => void;
  onLoadMore: () => void;
  onWatched: (videoId: string) => void;
  onLiked: (videoId: string, liked: boolean) => void;
}) {
  const { t } = useI18n();
  // Stable refs for callbacks & videos to avoid stale closures
  const videosRef = useRef(videos);
  useEffect(() => { videosRef.current = videos; }, [videos]);
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);
  const onWatchedRef = useRef(onWatched);
  useEffect(() => { onWatchedRef.current = onWatched; }, [onWatched]);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const onVideoChangeRef = useRef(onVideoChange);
  useEffect(() => { onVideoChangeRef.current = onVideoChange; }, [onVideoChange]);
  const onLikedRef = useRef(onLiked);
  useEffect(() => { onLikedRef.current = onLiked; }, [onLiked]);

  // Current video index shown in UI
  const [vidIdx, setVidIdx] = useState(initialIndex);

  // Local liked state per video_id (overrides what came from the list)
  const [likedOverrides, setLikedOverrides] = useState<Record<string, boolean>>({});

  // Which slot is "current" (ring pointer)
  const currentSlotRef = useRef(1); // slot 1 starts as current

  // Prevent double-firing during animation
  const animatingRef = useRef(false);

  // Slot positions + video assignments
  const [slots, setSlots] = useState<SlotState[]>(() => [
    { videoIdx: initialIndex > 0 ? initialIndex - 1 : null,             y: -100, animate: false }, // slot 0 = prev
    { videoIdx: initialIndex,                                             y: 0,    animate: false }, // slot 1 = current
    { videoIdx: initialIndex < videos.length - 1 ? initialIndex + 1 : null, y: 100,  animate: false }, // slot 2 = next
  ]);
  const slotsRef = useRef(slots);
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  // YT player instances (one per slot, lazily created)
  const playerRefs = useRef<(any | null)[]>([null, null, null]);
  const slotElemRefs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ] as const;

  // Create or reload a player for a given slot.
  // Non-current slots start playing immediately (for buffer preload) but are
  // paused by the onStateChange handler the moment playback begins.
  const ensurePlayer = useCallback((s: number, videoId: string, autoplay = false) => {
    const w = window as any;
    if (!w.YT?.Player) return;
    if (playerRefs.current[s]) {
      // loadVideoById triggers buffering; onStateChange handles auto-pause for non-current slots
      playerRefs.current[s].loadVideoById(videoId);
    } else {
      const container = slotElemRefs[s].current;
      if (!container) return;
      const inner = document.createElement("div");
      container.appendChild(inner);
      playerRefs.current[s] = new w.YT.Player(inner, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1, // always start to trigger buffering; non-current slots are paused below
          controls: 0,
          fs: 0,
          rel: 0,
          cc_load_policy: 0,
          iv_load_policy: 3,
          disablekb: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onStateChange: (event: any) => {
            // Pause any slot that starts playing while it's not the active one
            if (event.data === 1 /* PLAYING */ && s !== currentSlotRef.current) {
              event.target.pauseVideo();
            }
            if (event.data === 0 /* ENDED */ && s === currentSlotRef.current) {
              const videoIdx = slotsRef.current[s]?.videoIdx;
              const completed = videoIdx == null ? undefined : videosRef.current[videoIdx];
              if (completed) {
                api.complete(completed.video_id).catch(() => {});
                onWatchedRef.current(completed.video_id);
              }
            }
          },
        },
      });
      // If this slot shouldn't autoplay yet (it's a neighbour), pause it once ready
      if (!autoplay) {
        playerRefs.current[s].addEventListener?.("onReady", () => {
          if (s !== currentSlotRef.current) playerRefs.current[s]?.pauseVideo();
        });
      }
    }
  }, []);

  // Init on mount: create players for whichever slots have a video
  useEffect(() => {
    let destroyed = false;
    loadYouTubeApi().then(() => {
      if (destroyed) return;
      const initSlots = slotsRef.current;
      for (let s = 0; s < NUM_SLOTS; s++) {
        const vidI = initSlots[s].videoIdx;
        if (vidI === null || vidI < 0 || vidI >= videosRef.current.length) continue;
        ensurePlayer(s, videosRef.current[vidI].video_id, s === 1 /* autoplay current */);
      }
      // Opening a Short adds it to history; completion is recorded on ENDED.
      const initVid = videosRef.current[initialIndex];
      if (initVid) {
        api.watch(initVid.video_id).catch(() => {});
      }
    });
    return () => {
      destroyed = true;
      playerRefs.current.forEach((p) => p?.destroy());
      playerRefs.current = [null, null, null];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((dir: 1 | -1) => {
    if (animatingRef.current) return;

    const cs = currentSlotRef.current;
    const currentSlots = slotsRef.current;
    const currentVidIdx = currentSlots[cs].videoIdx;
    if (currentVidIdx === null) return;

    const newVidIdx = currentVidIdx + dir;
    const vids = videosRef.current;
    if (newVidIdx < 0 || newVidIdx >= vids.length) return;

    // targetSlot: the slot we're scrolling INTO
    // recycledSlot: the slot on the opposite side (gets repositioned)
    const targetSlot  = dir === 1 ? (cs + 1) % NUM_SLOTS : (cs + 2) % NUM_SLOTS;
    const recycledSlot = dir === 1 ? (cs + 2) % NUM_SLOTS : (cs + 1) % NUM_SLOTS;

    // The recycled slot jumps to where targetSlot currently is (opposite side of new current)
    const recycledY = currentSlots[targetSlot].y;
    const recycledVidIdx = newVidIdx + dir;
    const recycledHasVideo = recycledVidIdx >= 0 && recycledVidIdx < vids.length;

    animatingRef.current = true;

    // Animate current & target slots; recycled slot jumps instantly (no transition)
    setSlots((prev) =>
      prev.map((s, i) => {
        if (i === cs || i === targetSlot) return { ...s, y: s.y - dir * 100, animate: true };
        return { videoIdx: recycledHasVideo ? recycledVidIdx : null, y: recycledY, animate: false };
      })
    );

    // Pre-load video in recycled slot
    if (recycledHasVideo) {
      ensurePlayer(recycledSlot, vids[recycledVidIdx].video_id, false);
    }

    setTimeout(() => {
      // Update ring pointer
      currentSlotRef.current = targetSlot;
      setVidIdx(newVidIdx);

      // Swap playback
      playerRefs.current[cs]?.pauseVideo();
      playerRefs.current[targetSlot]?.playVideo();

      // Remove all transitions
      setSlots((prev) => prev.map((s) => ({ ...s, animate: false })));

      // Opening a Short adds it to history; completion is recorded on ENDED.
      const newVid = vids[newVidIdx];
      if (newVid) {
        onVideoChangeRef.current(newVid.video_id);
        api.watch(newVid.video_id).catch(() => {});
      }

      // Trigger load-more if near end
      if (newVidIdx >= videosRef.current.length - 5) onLoadMoreRef.current();

      animatingRef.current = false;
    }, TRANS_MS + 20);
  }, [ensurePlayer]);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      switch (e.key) {
        case "Escape": onCloseRef.current(); break;
        case "ArrowDown": e.preventDefault(); navigate(1);  break;
        case "ArrowUp":   e.preventDefault(); navigate(-1); break;
        case " ": {
          e.preventDefault();
          const p = playerRefs.current[currentSlotRef.current];
          const state = p?.getPlayerState();
          if (state === 1) p?.pauseVideo(); else p?.playVideo();
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const video = videos[vidIdx];
  const canPrev = vidIdx > 0;
  const canNext = vidIdx < videos.length - 1;

  const isLiked = video
    ? (video.video_id in likedOverrides ? likedOverrides[video.video_id] : video.liked === 1)
    : false;

  const toggleLike = useCallback(() => {
    if (!video) return;
    const next = !isLiked;
    setLikedOverrides((prev) => ({ ...prev, [video.video_id]: next }));
    api.likeVideo(video.video_id, next).catch(() => {
      setLikedOverrides((prev) => ({ ...prev, [video.video_id]: !next }));
    });
    onLikedRef.current(video.video_id, next);
  }, [video, isLiked]);

  return (
    <div className="sp-overlay">
      <button className="sp-close" onClick={onClose} aria-label="Zamknij"><X size={22} /></button>
      <button
        className={`sp-like${isLiked ? " sp-like--active" : ""}`}
        onClick={toggleLike}
        aria-label={isLiked ? t("unlike") : t("like")}
      >
        <Heart size={22} fill={isLiked ? "currentColor" : "none"} />
      </button>

      {/* Ring of 3 slides */}
      <div className="sp-track">
        {([0, 1, 2] as const).map((s) => {
          const slot = slots[s];
          const slotVid =
            slot.videoIdx !== null && slot.videoIdx >= 0 && slot.videoIdx < videos.length
              ? videos[slot.videoIdx]
              : null;
          return (
            <div
              key={s}
              className="sp-slide"
              style={{
                transform: `translateY(${slot.y}%)`,
                transition: slot.animate ? `transform ${TRANS_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : "none",
              }}
            >
              <div ref={slotElemRefs[s]} className="sp-frame" />
              {slotVid && (
                <div className="sp-info">
                  <div className="sp-info-channel">
                    {slotVid.channel_thumbnail && (
                      <img src={img(slotVid.channel_thumbnail)} alt="" className="sp-ch-avatar" />
                    )}
                    <Link to={`/channel/${slotVid.channel_id}`} className="sp-ch-name" onClick={onClose}>
                      {slotVid.channel_title}
                    </Link>
                  </div>
                  <div className="sp-title">{slotVid.title}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Fixed nav buttons */}
      <div className="sp-nav">
        <button className="sp-nav-btn" onClick={() => navigate(-1)} disabled={!canPrev} aria-label="Poprzedni">
          <ChevronUp size={26} />
        </button>
        <button className="sp-nav-btn" onClick={() => navigate(1)} disabled={!canNext} aria-label="Następny">
          <ChevronDown size={26} />
        </button>
      </div>

      {/* Counter */}
      {videos.length > 1 && (
        <div className="sp-counter">{vidIdx + 1} / {videos.length}</div>
      )}
    </div>
  );
}
