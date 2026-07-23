import { useCallback, useEffect, useRef, useState } from "react";
import "./FeedPage.css";
import { subscribe } from "../events";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, Eye, Inbox, Plus, RefreshCw, Upload } from "lucide-react";
import { api, type Bucket, type Channel, type Tag, type Video } from "../api";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { img } from "../img";
import ChildTimeRequestBanner from "../components/ChildTimeRequestBanner";
import TagFilterBar from "../components/TagFilterBar";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { GRID_SIZES, persistGridSize, readGridSize, type GridSize } from "../gridSize";
import { Button, ButtonLink, Divider, EmptyState, IconButton } from "../components/ui";

type TopChannel = Channel & { watch_count: number; is_live: number };

function FeedOnboarding() {
  const { t } = useI18n();
  return (
    <section className="feed-onboarding">
      <div className="feed-onboarding-icon"><Inbox /></div>
      <div className="feed-onboarding-copy">
        <span className="feed-onboarding-eyebrow">YT Zero</span>
        <h1>{t("feedOnboardingTitle")}</h1>
        <p>{t("feedOnboardingDescription")}</p>
      </div>
      <div className="feed-onboarding-actions">
        <ButtonLink variant="primary" to="/subscriptions" leadingIcon={<Plus size={16} />}>{t("feedOnboardingAddChannels")}</ButtonLink>
        <ButtonLink to="/settings?tab=channels" leadingIcon={<Upload size={16} />}>{t("feedOnboardingImportSubscriptions")}</ButtonLink>
      </div>
      <div className="feed-onboarding-steps" aria-label={t("feedOnboardingHowItWorks")}>
        <div><span className="feed-onboarding-step-number">1</span><p>{t("feedOnboardingStepOne")}</p></div>
        <ArrowRight aria-hidden="true" />
        <div><span className="feed-onboarding-step-number">2</span><p>{t("feedOnboardingStepTwo")}</p></div>
        <ArrowRight aria-hidden="true" />
        <div><span className="feed-onboarding-step-number">3</span><p>{t("feedOnboardingStepThree")}</p></div>
      </div>
    </section>
  );
}

function ChannelAvatarRow() {
  const [channels, setChannels] = useState<TopChannel[]>([]);
  const scroll = useHScroll();

  useEffect(() => {
    api.topChannels().then((r) => setChannels(r.channels)).catch(() => {});
  }, []);

  useEffect(() => subscribe("channels-changed", () => {
    api.topChannels().then((r) => setChannels(r.channels)).catch(() => {});
  }), []);

  if (channels.length === 0) return null;

  return (
    <div className={`h-scroll-wrap channel-avatar-section${scroll.shadowLeft ? " shadow-left" : ""}${scroll.shadowRight ? " shadow-right" : ""}`}>
      <div className="channel-avatar-row" ref={scroll.ref}>
        {channels.map((ch) => (
          <Link key={ch.channel_id} to={`/channel/${ch.channel_id}`} className="channel-avatar-item">
            <div className="channel-avatar-wrap">
              {ch.thumbnail ? (
                <img className="channel-avatar-img" src={img(ch.thumbnail)} alt="" />
              ) : (
                <div className="channel-avatar-img channel-avatar-placeholder" />
              )}
              {ch.is_live === 1 && <span className="channel-avatar-live">LIVE</span>}
            </div>
            <span className="channel-avatar-name">{ch.title}</span>
            {ch.subscriber_count && (
              <span className="channel-avatar-subs">{ch.subscriber_count}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

const BUCKET_ORDER: Bucket[] = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];

function useHScroll() {
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((el: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;
    const update = () => {
      setShadowLeft(el.scrollLeft > 4);
      setShadowRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: false });
    cleanupRef.current = () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return { ref, shadowLeft, shadowRight };
}

export default function FeedPage({
  onPlay,
  showToast,
}: {
  onPlay: (v: Video) => void;
  showToast: (m: string) => void;
}) {
  const { t } = useI18n();
  useDocumentTitle();
  const [videos, setVideos] = useState<Video[]>([]);
  const [queued, setQueued] = useState<Video[]>([]);
  const [inProgress, setInProgress] = useState<Video[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("feedTags") ?? "[]"); } catch { return []; }
  });
  const [showAll, setShowAll] = useState(() => sessionStorage.getItem("feedShowAll") === "1");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [gridSize, setGridSize] = useState<GridSize>(readGridSize);
  const [showTopChannels, setShowTopChannels] = useState(true);
  const [hasSubscriptions, setHasSubscriptions] = useState<boolean | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const inProgressScroll = useHScroll();
  const queuedScroll = useHScroll();
  const hScrollWrapRef = useRef<HTMLDivElement>(null);
  const [hCardWidth, setHCardWidth] = useState(220);
  const [hCardMin, setHCardMin] = useState(248);

  useEffect(() => {
    const read = () => setHCardMin(Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--video-card-min"), 10) || 248);
    read();
    const unsubscribeChanged = subscribe("video-card-size-changed", read);
    const unsubscribeApplied = subscribe("video-card-size-applied", read);
    return () => { unsubscribeChanged(); unsubscribeApplied(); };
  }, []);

  useEffect(() => {
    const el = hScrollWrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const min = hCardMin;
      const gap = 12;
      // Match CSS Grid's auto-fill calculation: gaps consume width too.
      // Without them, a 220 px preference could squeeze in one extra card.
      const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
      setHCardWidth(Math.max(min, Math.floor((w - (cols - 1) * gap) / cols)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hCardMin]);

  const load = useCallback(async (requestedPage = page) => {
    if (requestedPage === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const feed = await api.feed({ tags: selectedTags, page: requestedPage, show_all: showAll });
      setVideos((prev) => (requestedPage === 0 ? feed.videos : [...prev, ...feed.videos]));
      setHasMore(feed.videos.length === 40);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedTags, page, showAll]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const loadTags = useCallback(() => {
    api.tags().then((r) => setTags(r.tags)).catch(console.error);
  }, []);

  const loadQueued = useCallback(() => {
    api.watchlist().then((r) => setQueued(r.videos)).catch(console.error);
  }, []);

  const loadInProgress = useCallback(() => {
    api.inProgress().then((r) => setInProgress(r.videos.filter((video) => video.is_short === 0))).catch(console.error);
  }, []);

  useEffect(() => {
    loadTags();
    loadQueued();
    loadInProgress();
  }, [loadTags, loadQueued, loadInProgress]);

  const loadSubscriptionState = useCallback(() => {
    api.channels().then((r) => setHasSubscriptions(r.channels.some((channel) => channel.followed !== 0))).catch(() => {});
  }, []);

  useEffect(() => {
    loadSubscriptionState();
    return subscribe("channels-changed", loadSubscriptionState);
  }, [loadSubscriptionState]);

  const loadTopChannelsSetting = useCallback(() => {
    api.settings().then((r) => setShowTopChannels(r.settings.show_top_channels !== "0")).catch(() => {});
  }, []);

  useEffect(() => { loadTopChannelsSetting(); }, [loadTopChannelsSetting]);

  useEffect(() => subscribe("tags-changed", loadTags), [loadTags]);
  useEffect(() => subscribe("queue-changed", loadQueued), [loadQueued]);
  useEffect(() => subscribe("top-channels-changed", loadTopChannelsSetting), [loadTopChannelsSetting]);

  // Infinite scroll
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setPage((p) => p + 1); },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, videos]);

  const changeGridSize = (size: GridSize) => {
    setGridSize(size);
    persistGridSize(size);
  };

  const toggleTag = (id: number) => {
    setLoading(true);
    setPage(0);
    setSelectedTags((s) => {
      const next = s.includes(id) ? s.filter((t) => t !== id) : [...s, id];
      sessionStorage.setItem("feedTags", JSON.stringify(next));
      return next;
    });
  };

  const toggleShowAll = () => {
    setLoading(true);
    setPage(0);
    setShowAll((s) => {
      const next = !s;
      if (next) sessionStorage.setItem("feedShowAll", "1");
      else sessionStorage.removeItem("feedShowAll");
      return next;
    });
  };

  const clearTags = () => {
    setLoading(true);
    setPage(0);
    setSelectedTags([]);
    sessionStorage.removeItem("feedTags");
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.refresh();
      showToast(t("refreshed", { channels: r.channels, added: r.added }));
      setLoading(true);
      setPage(0);
      await load(0);
    } catch (e) {
      showToast(`${t("refreshError")} ${e instanceof Error ? e.message : e}`);
    } finally {
      setRefreshing(false);
    }
  };

  const reload = () => {
    setLoading(true);
    setPage(0);
    load(0).catch(console.error);
    loadQueued();
    loadInProgress();
  };

  const removeFromFeed = (videoId?: string) => {
    if (videoId) setVideos((current) => current.filter((v) => v.video_id !== videoId));
    loadQueued();
    loadInProgress();
  };

  // Time-based queued sections — only show videos that have unlocked.
  const now = new Date();
  const dueQueuedVideos = queued
    .filter((v) => v.bucket && (!v.show_from || new Date(v.show_from) <= now))
    .sort((a, b) => {
      const bucketDiff = BUCKET_ORDER.indexOf(a.bucket!) - BUCKET_ORDER.indexOf(b.bucket!);
      if (bucketDiff !== 0) return bucketDiff;
      return new Date(a.show_from ?? 0).getTime() - new Date(b.show_from ?? 0).getTime();
    });
  const showQueuedSection = dueQueuedVideos.length > 0 && selectedTags.length === 0;
  const showFeedPreludeDivider = inProgress.length > 0 || showQueuedSection;

  if (!loading && hasSubscriptions === false) {
    return (
      <>
        <ChildTimeRequestBanner />
        <FeedOnboarding />
      </>
    );
  }

  return (
    <>
      <ChildTimeRequestBanner />
      <div className="toolbar" ref={hScrollWrapRef}>
        <TagFilterBar
          tags={tags}
          selected={selectedTags}
          onToggle={toggleTag}
          onClearAll={clearTags}
          suffix={
            <button
              className={`chip${showAll ? " active" : ""}`}
              onClick={toggleShowAll}
              title={t("showAll")}
            >
              <Eye size={13} />
              {t("showAll")}
            </button>
          }
        />
        <div className="toolbar-right" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <IconButton label={t("refresh")} icon={<RefreshCw className={refreshing ? "spin" : undefined} />} onClick={refresh} disabled={refreshing} />
        </div>
      </div>

      {showTopChannels && <ChannelAvatarRow />}

      {inProgress.length > 0 && (
        <div className="continue-watching-section">
          <div className="time-section-header">
            <Clock size={16} />
            <span>{t("continueWatching")}</span>
          </div>
          <div className={`h-scroll-wrap${inProgressScroll.shadowLeft ? " shadow-left" : ""}${inProgressScroll.shadowRight ? " shadow-right" : ""}`}>
            <div className={`h-scroll-row h-scroll-row--${gridSize}`} ref={inProgressScroll.ref}>
              {inProgress.map((v) => (
                <div key={v.video_id} className="h-scroll-card" style={{ width: hCardWidth }}>
                  <VideoCard video={v} onPlay={onPlay} onChanged={loadInProgress} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showQueuedSection && (
        <div className="time-section">
          <div className="time-section-header">
            <Clock size={16} />
            <span>{t("navWatchlist")}</span>
          </div>
          <div className={`h-scroll-wrap${queuedScroll.shadowLeft ? " shadow-left" : ""}${queuedScroll.shadowRight ? " shadow-right" : ""}`}>
            <div className={`h-scroll-row h-scroll-row--${gridSize}`} ref={queuedScroll.ref}>
              {dueQueuedVideos.map((v) => (
                <div key={v.video_id} className="h-scroll-card" style={{ width: hCardWidth }}>
                  <VideoCard video={v} onPlay={onPlay} onChanged={reload} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showFeedPreludeDivider && <Divider />}

      {loading && videos.length === 0 ? (
        <VideoGridSkeleton gridSize={gridSize} />
      ) : videos.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t("noVideos")} />
      ) : (
        <>
          <div className={`video-grid video-grid--${gridSize}`}>
            {videos.map((v) => (
              <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={removeFromFeed} />
            ))}
          </div>
          {loadingMore && <VideoGridSkeleton count={4} gridSize={gridSize} />}
          {hasMore && !loadingMore && (
            <div className="load-more">
              <Button ref={loadMoreRef} onClick={() => setPage((p) => p + 1)}>{t("loadMore")}</Button>
            </div>
          )}
        </>
      )}

    </>
  );
}
