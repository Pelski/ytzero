import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Heart, MessageCircle, MessageCircleOff, Pin, RefreshCw, ThumbsUp } from "lucide-react";
import { api, ApiError, type VideoComment, type VideoCommentSort } from "../api";
import { parseCommentText } from "../commentTimestamps";
import { compactNumber, formatTimeAgo, useI18n } from "../i18n";
import { img } from "../img";
import { markYouTubeUrl } from "../youtubeUrl";
import { buildVideoCommentThreads, type VideoCommentThread } from "../videoCommentThreads";
import { Alert, Button, EmptyState, IconButton, SectionHeader, SelectMenu } from "./ui";
import "./VideoComments.css";

const COMMENT_PAGE_SIZE = 20;
const SORT_EXIT_MS = 140;
const SORT_LOADING_MS = 120;

function CommentText({ text, onSeek, seekDisabled }: { text: string; onSeek: (seconds: number) => void; seekDisabled: boolean }) {
  return <>{parseCommentText(text).map((part, index): ReactNode => {
    if (part.type === "url") return <a key={index} href={markYouTubeUrl(part.value)} target="_blank" rel="noreferrer">{part.value}</a>;
    if (part.type === "timestamp") {
      return <button key={index} type="button" className="video-comment__timestamp" disabled={seekDisabled} onClick={() => onSeek(part.seconds)}>{part.value}</button>;
    }
    return part.value;
  })}</>;
}

function CommentRow({ comment, creatorAvatar, onSeek, seekDisabled }: { comment: VideoComment; creatorAvatar?: string | null; onSeek: (seconds: number) => void; seekDisabled: boolean }) {
  const { t, language } = useI18n();
  const published = comment.timestamp
    ? formatTimeAgo(new Date(comment.timestamp * 1_000).toISOString(), language)
    : comment.timeText;
  const author = comment.authorUrl ? (
    <a href={markYouTubeUrl(comment.authorUrl)} target="_blank" rel="noreferrer">{comment.author}</a>
  ) : <span>{comment.author}</span>;

  return (
    <article className={`video-comment${comment.parent && comment.parent !== "root" ? " video-comment--reply" : ""}`}>
      {comment.authorThumbnail ? (
        <img className="video-comment__avatar" src={comment.authorThumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="video-comment__avatar video-comment__avatar--fallback" aria-hidden="true">
          {(comment.author.trim()[0] ?? "?").toUpperCase()}
        </span>
      )}
      <div className="video-comment__body">
        <header className="video-comment__header">
          <strong>{author}</strong>
          {comment.authorIsUploader && <span className="video-comment__badge">{t("commentsCreator")}</span>}
          {published && <time dateTime={comment.timestamp ? new Date(comment.timestamp * 1_000).toISOString() : undefined}>{published}</time>}
        </header>
        {comment.isPinned && <div className="video-comment__pinned"><Pin /> {t("commentsPinned")}</div>}
        <div className="video-comment__text"><CommentText text={comment.text} onSeek={onSeek} seekDisabled={seekDisabled} /></div>
        {(comment.likeCount > 0 || comment.isFavorited) && (
          <footer className="video-comment__meta">
            {comment.likeCount > 0 && <span title={t("commentsLikes")}><ThumbsUp /> {compactNumber(comment.likeCount, language)}</span>}
            {comment.isFavorited && (
              <span className="video-comment__creator-heart" title={t("commentsHearted")} aria-label={t("commentsHearted")}>
                {creatorAvatar ? <img src={img(creatorAvatar)} alt="" /> : <span className="video-comment__creator-heart-fallback" />}
                <Heart fill="currentColor" />
              </span>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}

function CommentThreadRow({ thread, creatorAvatar, onSeek, seekDisabled, revealIndex = 0 }: { thread: VideoCommentThread; creatorAvatar?: string | null; onSeek: (seconds: number) => void; seekDisabled: boolean; revealIndex?: number }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const toggleReplies = () => {
    if (closing) return;
    if (!expanded) {
      setExpanded(true);
      return;
    }
    setClosing(true);
    const closeDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380;
    closeTimer.current = window.setTimeout(() => {
      setExpanded(false);
      setClosing(false);
      closeTimer.current = null;
    }, closeDuration);
  };

  return (
    <div
      className={`video-comment-thread${expanded ? " video-comment-thread--expanded" : ""}${closing ? " video-comment-thread--closing" : ""}`}
      style={{ "--comment-reveal-delay": `${Math.min(revealIndex, COMMENT_PAGE_SIZE - 1) * 75}ms` } as CSSProperties}
    >
      <div className="video-comment-thread__head">
        <CommentRow comment={thread.comment} creatorAvatar={creatorAvatar} onSeek={onSeek} seekDisabled={seekDisabled} />
        {thread.replies.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="video-comment-thread__toggle"
            leadingIcon={<ChevronDown />}
            aria-expanded={expanded}
            onClick={toggleReplies}
          >
            {expanded ? t("commentsHideReplies") : t("commentsReplies", { count: thread.replies.length })}
          </Button>
        )}
      </div>
      {expanded && (
        <div className={`video-comment-thread__replies${closing ? " video-comment-thread__replies--closing" : ""}`}>
          {thread.replies.map((reply, index) => <CommentThreadRow key={reply.comment.id} thread={reply} creatorAvatar={creatorAvatar} onSeek={onSeek} seekDisabled={seekDisabled} revealIndex={index} />)}
        </div>
      )}
    </div>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function errorTitle(code: string | undefined, t: Translate) {
  if (code === "ytdlp_missing") return t("commentsToolMissing");
  if (code === "rate_limited") return t("commentsRateLimited");
  if (code === "login_required") return t("commentsLoginRequired");
  if (code === "timeout") return t("commentsTimeout");
  return t("commentsLoadFailed");
}

function errorHint(code: string | undefined, t: Translate) {
  if (code === "ytdlp_missing") return t("commentsToolMissingHint");
  if (code === "rate_limited") return t("commentsRateLimitedHint");
  if (code === "login_required") return t("commentsLoginRequiredHint");
  if (code === "timeout") return t("commentsTimeoutHint");
  return t("commentsLoadFailedHint");
}

export default function VideoComments({ videoId, creatorAvatar, cinemaMode = false, onSeek, seekDisabled = false }: { videoId: string; creatorAvatar?: string | null; cinemaMode?: boolean; onSeek: (seconds: number) => void; seekDisabled?: boolean }) {
  const { t } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "disabled" | "error">("idle");
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [error, setError] = useState<{ code: string } | null>(null);
  const [sort, setSort] = useState<VideoCommentSort>("top");
  const [loadedSort, setLoadedSort] = useState<VideoCommentSort>("top");
  const [sortTransition, setSortTransition] = useState<"idle" | "leaving" | "loading">("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [visibleThreadCount, setVisibleThreadCount] = useState(COMMENT_PAGE_SIZE);
  const [scrollUnlockProgress, setScrollUnlockProgress] = useState<number | null>(null);
  const threads = buildVideoCommentThreads(comments, loadedSort);
  const visibleThreads = threads.slice(0, visibleThreadCount);

  const load = useCallback(async (refresh = false, requestedSort: VideoCommentSort = sort, animateSort = false) => {
    const version = ++requestVersion.current;
    const backgroundRefresh = refresh && status === "ready" && comments.length > 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = (duration: number) => new Promise<void>((resolve) => window.setTimeout(resolve, reducedMotion ? 0 : duration));
    if (backgroundRefresh) setRefreshing(true);
    else if (animateSort) {
      setSortTransition("leaving");
    }
    else setStatus("loading");
    setError(null);
    const request = api.videoComments(videoId, requestedSort, refresh);
    void request.catch(() => {});
    try {
      if (animateSort) {
        await wait(SORT_EXIT_MS);
        if (requestVersion.current !== version) return;
        setStatus("loading");
        setSortTransition("loading");
        await wait(SORT_LOADING_MS);
      }
      const result = await request;
      if (requestVersion.current !== version) return;
      setVisibleThreadCount(COMMENT_PAGE_SIZE);
      setComments(result.comments);
      setLoadedSort(requestedSort);
      if (animateSort) {
        // Keep the replacement data behind the loading state for a paint. The
        // rows mount only afterwards, so their own reveal animation starts on
        // the first visible frame instead of flashing before it.
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (requestVersion.current !== version) return;
      }
      setSortTransition("idle");
      setStatus("ready");
    } catch (failure) {
      if (requestVersion.current !== version) return;
      const apiError = failure instanceof ApiError ? failure : null;
      setError({ code: apiError?.code ?? "unavailable" });
      if (!backgroundRefresh) setStatus(apiError?.code === "comments_disabled" ? "disabled" : "error");
      setSortTransition("idle");
    } finally {
      if (requestVersion.current === version) setRefreshing(false);
    }
  }, [comments.length, sort, status, videoId]);

  useEffect(() => {
    requestVersion.current += 1;
    setComments([]);
    setError(null);
    setSort("top");
    setLoadedSort("top");
    setSortTransition("idle");
    setRefreshing(false);
    setStatus("idle");
    setVisibleThreadCount(COMMENT_PAGE_SIZE);
    setScrollUnlockProgress(null);
  }, [videoId]);

  useEffect(() => () => {
    requestVersion.current += 1;
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || status !== "idle") return;

    const visibleRatio = () => {
      const bounds = section.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0));
      return visibleHeight / Math.max(1, Math.min(bounds.height, window.innerHeight));
    };

    if (cinemaMode) {
      const progressBar = progressRef.current;
      if (!progressBar) return;
      setScrollUnlockProgress(0);
      let lastY: number | null = null;
      let scrolledDown = 0;
      const onScroll = () => {
        if (lastY === null) return;
        const currentY = window.scrollY;
        scrolledDown += Math.max(0, currentY - lastY);
        lastY = currentY;
        const progress = Math.min(1, scrolledDown / 200);
        setScrollUnlockProgress(progress);
        if (progress < 1) return;
        window.removeEventListener("scroll", onScroll);
        void load();
      };
      const observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting || entry.intersectionRatio < 0.25) return;
        lastY = window.scrollY;
        scrolledDown = 0;
        setScrollUnlockProgress(0);
        observer.disconnect();
        window.addEventListener("scroll", onScroll, { passive: true });
      }, { threshold: 0.25 });
      observer.observe(progressBar);
      return () => {
        observer.disconnect();
        window.removeEventListener("scroll", onScroll);
      };
    }

    const initiallyVisible = visibleRatio() >= 0.5;
    if (!initiallyVisible) {
      setScrollUnlockProgress(null);
      const observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting || entry.intersectionRatio < 0.5) return;
        observer.disconnect();
        void load();
      }, { threshold: 0.5 });
      observer.observe(section);
      return () => observer.disconnect();
    }

    let lastY = window.scrollY;
    let scrolledDown = 0;
    setScrollUnlockProgress(0);
    const onScroll = () => {
      const currentY = window.scrollY;
      if (visibleRatio() < 0.5) {
        lastY = currentY;
        return;
      }
      scrolledDown += Math.max(0, currentY - lastY);
      lastY = currentY;
      const progress = Math.min(1, scrolledDown / 200);
      setScrollUnlockProgress(progress);
      if (progress < 1) return;
      window.removeEventListener("scroll", onScroll);
      void load();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [cinemaMode, load, status]);

  const showScrollUnlock = status === "idle" && (cinemaMode || scrollUnlockProgress !== null);
  const displayedScrollProgress = scrollUnlockProgress ?? 0;

  return (
    <section ref={sectionRef} className="video-comments" aria-busy={status === "loading"}>
      <SectionHeader
        className="video-comments__header"
        title={t("commentsTitle")}
        actions={
          <div className="video-comments__controls">
            <SelectMenu
              className="video-comments__sort"
              size="sm"
              value={sort}
              label={t("commentsSortLabel")}
              options={[
                { value: "top", label: t("commentsSortTop") },
                { value: "new", label: t("commentsSortNewest") },
              ] as const}
              onChange={(nextSort) => {
                if (sort === nextSort) return;
                setSort(nextSort);
                if (status !== "idle") void load(false, nextSort, true);
              }}
            />
            <IconButton
              className="video-comments__refresh"
              variant="ghost"
              size="sm"
              disabled={refreshing}
              label={t("commentsRefresh")}
              icon={<RefreshCw className={refreshing ? "spin" : undefined} />}
              onClick={() => void load(true, sort)}
            />
          </div>
        }
      />

      {status === "idle" && !showScrollUnlock && <div className="video-comments__lazy-placeholder">{t("commentsLazyHint")}</div>}
      {showScrollUnlock && (
        <div className="video-comments__scroll-unlock">
          <span>{t("commentsScrollToLoad")}</span>
          <div
            ref={progressRef}
            className="lp-bar video-comments__scroll-progress"
            role="progressbar"
            aria-label={t("commentsScrollToLoad")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayedScrollProgress * 100)}
          >
            <div className="lp-bar-track">
              <div className="lp-bar-played" style={{ width: `${displayedScrollProgress * 100}%` }} />
            </div>
            <div className="lp-bar-knob" style={{ left: `${displayedScrollProgress * 100}%` }} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
          >
            {t("commentsShow")}
          </Button>
        </div>
      )}
      {status === "loading" && (
        <div className={`video-comments__skeleton${sortTransition === "loading" ? " video-comments__skeleton--sorting" : ""}`} aria-hidden="true">
          {[0, 1, 2].map((item) => <div key={item} className="video-comment-skeleton"><span /><div><b /><i /><i /></div></div>)}
        </div>
      )}
      {status === "disabled" && (
        <EmptyState
          icon={<MessageCircleOff />}
          title={t("commentsDisabled")}
          description={t("commentsDisabledHint")}
        />
      )}
      {status === "error" && (
        <Alert variant="warning" title={errorTitle(error?.code, t)}>
          <div className="video-comments__error-copy">
            <div className="video-comments__error">
            <span>{errorHint(error?.code, t)}</span>
            <Button size="sm" leadingIcon={<RefreshCw />} onClick={() => void load(true)}>{t("commentsRetry")}</Button>
            </div>
          </div>
        </Alert>
      )}
      {status === "ready" && error && (
        <Alert variant="warning" title={errorTitle(error.code, t)}>
          <div className="video-comments__error">
            <span>{errorHint(error.code, t)}</span>
            <Button size="sm" leadingIcon={<RefreshCw />} onClick={() => void load(true, sort)}>{t("commentsRetry")}</Button>
          </div>
        </Alert>
      )}
      {status === "ready" && comments.length === 0 && <EmptyState icon={<MessageCircle />} title={t("commentsEmpty")} />}
      {status === "ready" && comments.length > 0 && (
        <>
          <div className={`video-comments__list${sortTransition === "leaving" ? " video-comments__list--leaving" : ""}`}>{visibleThreads.map((thread, index) => <CommentThreadRow key={thread.comment.id} thread={thread} creatorAvatar={creatorAvatar} onSeek={onSeek} seekDisabled={seekDisabled} revealIndex={index % COMMENT_PAGE_SIZE} />)}</div>
          {visibleThreadCount < threads.length && (
            <div className="video-comments__load-more">
              <Button variant="secondary" onClick={() => setVisibleThreadCount((count) => count + COMMENT_PAGE_SIZE)}>{t("showMore")}</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
