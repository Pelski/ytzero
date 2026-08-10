import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CirclePlay,
  RefreshCw,
  Tag,
  UsersRound,
} from "lucide-react";
import "./RecommendationsPage.css";
import type {
  RecommendationsRequest,
  RecommendationsResponse,
  RecommendationSummary,
  Video,
} from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import EmptyArt from "../components/illustrations/EmptyArt";
import { Alert, Button, EmptyState, IconButton } from "../components/ui";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { readGridSize, type GridSize } from "../gridSize";
import { mergeRecommendationVideos, prepareRecommendationVideos } from "./recommendationsPageLogic";
import type { PlayVideo, PlaybackQueueContext } from "../playbackQueue";

const PAGE_SIZE = 40;

export type LoadRecommendations = (request: RecommendationsRequest) => Promise<RecommendationsResponse>;

export interface RecommendationsPageProps {
  onPlay: PlayVideo;
  loadRecommendations: LoadRecommendations;
}

type LoadMode = "initial" | "refresh" | "append";

export default function RecommendationsPage({ onPlay, loadRecommendations }: RecommendationsPageProps) {
  const { t } = useI18n();
  const title = t("recommendationsTitle");
  useDocumentTitle(title);
  const [videos, setVideos] = useState<Video[]>([]);
  const [summary, setSummary] = useState<RecommendationSummary | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [gridSize] = useState<GridSize>(readGridSize);
  const loaderRef = useRef(loadRecommendations);
  const requestGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { loaderRef.current = loadRecommendations; }, [loadRecommendations]);

  const load = useCallback(async (requestedPage: number, mode: LoadMode) => {
    if (mode === "append" && loadingMoreRef.current) return;

    const generation = mode === "append"
      ? requestGenerationRef.current
      : ++requestGenerationRef.current;

    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    if (mode === "append") {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    setError(false);

    try {
      const result = await loaderRef.current({
        page: requestedPage,
        limit: PAGE_SIZE,
        refresh: mode === "refresh",
      });
      if (generation !== requestGenerationRef.current) return;
      const eligible = prepareRecommendationVideos(result.videos);
      setVideos((current) => mode === "append" ? mergeRecommendationVideos(current, eligible) : eligible);
      setSummary(result.summary);
      setPage(result.page);
      setHasMore(result.has_more);
    } catch (loadError) {
      if (generation !== requestGenerationRef.current) return;
      console.error(loadError);
      setError(true);
    } finally {
      if (generation === requestGenerationRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    void load(0, "initial");
    return () => { requestGenerationRef.current += 1; };
  }, [load]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !loadingMoreRef.current) void load(page + 1, "append"); },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, load, loadingMore, page, videos]);

  const refresh = () => { void load(0, "refresh"); };
  const removeCard = (videoId?: string) => {
    if (videoId) setVideos((current) => current.filter((video) => video.video_id !== videoId));
  };

  const pulseTags = summary?.top_tags.filter((tag) => tag.seconds > 0).slice(0, 5) ?? [];
  const pulseChannels = summary?.top_channels.filter((channel) => channel.seconds > 0).slice(0, 4) ?? [];
  const playbackQueue: PlaybackQueueContext = { version: 1, kind: "recommendations" };

  return (
    <div className="recommendations-page">
      <header className="recommendations-heading">
        <div className="recommendations-heading__title-row">
          <h1>{title}</h1>
          <IconButton
            label={t("refresh")}
            icon={<RefreshCw className={refreshing ? "spin" : undefined} />}
            onClick={refresh}
            disabled={refreshing || loading}
          />
        </div>
        <div className="recommendations-signals" aria-label={t("recommendationsWhyTitle")}>
          <span className="recommendations-signals__label">{t("recommendationsWhyTitle")}</span>
          <div className="recommendations-signals__items">
            {pulseTags.map((tag) => (
              <div key={tag.id} className="recommendations-signal">
                <Tag aria-hidden="true" />
                <span className="recommendations-signal__copy">
                  <strong>{tag.name}</strong>
                  <small>{t("recommendationsPulseMinutes", { minutes: Math.max(1, Math.round(tag.seconds / 60)) })}</small>
                </span>
              </div>
            ))}
            {pulseChannels.map((channel) => (
              <div key={channel.channel_id} className="recommendations-signal">
                <UsersRound aria-hidden="true" />
                <span className="recommendations-signal__copy">
                  <strong>{channel.title}</strong>
                  <small>{t("recommendationsPulseMinutes", { minutes: Math.max(1, Math.round(channel.seconds / 60)) })}</small>
                </span>
              </div>
            ))}
            {summary && summary.partial_count > 0 && (
              <div className="recommendations-signal">
                <CirclePlay aria-hidden="true" />
                <span className="recommendations-signal__copy">
                  <strong>{t("recommendationsProgressTitle")}</strong>
                  <small>{t("recommendationsPartialCount", { count: summary.partial_count })}</small>
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && videos.length > 0 && (
        <Alert className="recommendations-inline-error" variant="danger" icon={<AlertTriangle />}>
          <span>{t("recommendationsLoadErrorDescription")}</span>
          <Button size="sm" onClick={refresh}>{t("refresh")}</Button>
        </Alert>
      )}

      {loading && videos.length === 0 ? (
        <VideoGridSkeleton gridSize={gridSize} />
      ) : error && videos.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle />}
          title={t("recommendationsLoadErrorTitle")}
          description={t("recommendationsLoadErrorDescription")}
          action={<Button onClick={refresh}>{t("refresh")}</Button>}
        />
      ) : videos.length === 0 ? (
        <EmptyState
          art={<EmptyArt scene="noDiscovery" />}
          title={t("recommendationsEmptyTitle")}
          description={t("recommendationsEmptyDescription")}
          action={<Button onClick={refresh}>{t("refresh")}</Button>}
        />
      ) : (
        <>
          <div className={`video-grid video-grid--${gridSize}`}>
            {videos.map((video) => (
              <VideoCard key={video.video_id} video={video} onPlay={(item) => onPlay(item, playbackQueue)} onChanged={removeCard} showWatchProgress />
            ))}
          </div>
          {loadingMore && <VideoGridSkeleton count={4} gridSize={gridSize} />}
          {hasMore && !loadingMore && (
            <div className="recommendations-load-more">
              <Button ref={loadMoreRef} onClick={() => void load(page + 1, "append")}>{t("loadMore")}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
