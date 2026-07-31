import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Edit3, LoaderCircle, MessageCircle, MoreHorizontal, Plus, Send, ThumbsUp, Trash2 } from "lucide-react";
import {
  api,
  type Profile,
  type SocialComment,
  type SocialMention,
  type SocialPost,
  type SocialProfileRef,
  type Video,
} from "../api";
import { ProfileAvatar } from "../components/ProfileMenu";
import EmptyArt from "../components/illustrations/EmptyArt";
import EmojiReactionPicker from "../components/social/EmojiReactionPicker";
import ProfileMentionInput from "../components/social/ProfileMentionInput";
import VideoCard from "../components/VideoCard";
import { VideoThumbnail } from "../components/VideoThumbnail";
import Popconfirm from "../components/Popconfirm";
import Tooltip from "../components/Tooltip";
import { Alert, Button, Chip, Dialog, EmptyState, Field, IconButton, Inline, Input, List, ListButton, Menu, MenuItem, PageHeader, Popover, Stack } from "../components/ui";
import { formatTimeAgo, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { subscribeServerEvent } from "../serverEvents";
import { img } from "../img";
import type { PlayVideo } from "../playbackQueue";
import type { EmojiSkinTone } from "../emojiSkinTone";
import "../components/VideoComments.css";
import "../components/LoadingState.css";
import "./SocialPage.css";

function SocialPostSkeleton() {
  return <article className="social-post social-post--skeleton" aria-hidden="true">
    <div className="social-post-skeleton__header">
      <span className="skeleton social-post-skeleton__avatar" />
      <div><span className="skeleton social-post-skeleton__name" /><span className="skeleton social-post-skeleton__time" /></div>
    </div>
    <div className="social-post-skeleton__video">
      <span className="skeleton social-post-skeleton__thumbnail" />
      <div className="social-post-skeleton__video-copy">
        <span className="skeleton social-post-skeleton__title" />
        <span className="skeleton social-post-skeleton__title social-post-skeleton__title--short" />
        <span className="skeleton social-post-skeleton__meta" />
      </div>
    </div>
    <div className="social-post-skeleton__actions"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
  </article>;
}

function SocialPostsSkeleton({ count = 3, showBack, onBack }: { count?: number; showBack?: boolean; onBack?: () => void }) {
  const { t } = useI18n();
  return <div className="social-posts social-posts--loading" aria-label={t("loading")}>
    {showBack && <Button className="social-posts__back" variant="ghost" leadingIcon={<ArrowLeft />} onClick={onBack}>{t("socialBackToAll")}</Button>}
    {Array.from({ length: count }, (_, index) => <SocialPostSkeleton key={index} />)}
  </div>;
}

function MentionText({ text, mentions }: { text: string; mentions: SocialMention[] }) {
  const tokens = new Set(mentions.map((mention) => mention.token.toLocaleLowerCase()));
  return <>{text.split(/(@[\p{L}\p{N}_]+)/gu).map((part, index) =>
    tokens.has(part.toLocaleLowerCase())
      ? <span className="social-mention" key={`${part}-${index}`}>{part}</span>
      : part
  )}</>;
}

function SocialCommentRow({
  comment,
  expanding = false,
  profiles,
  onChange,
  onDelete,
  onError,
}: {
  comment: SocialComment;
  expanding?: boolean;
  profiles: SocialProfileRef[];
  onChange: (comment: SocialComment) => void;
  onDelete: (id: string) => void;
  onError: () => void;
}) {
  const { t, language } = useI18n();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [liking, setLiking] = useState(false);
  const toggleLike = async () => {
    if (liking) return;
    const optimistic = { ...comment, liked_by_me: !comment.liked_by_me, like_count: Math.max(0, comment.like_count + (comment.liked_by_me ? -1 : 1)) };
    onChange(optimistic);
    setLiking(true);
    try {
      const result = await api.setSocialCommentLike(comment.id, !comment.liked_by_me);
      onChange(result.comment);
    } catch {
      onChange(comment);
      onError();
    } finally {
      setLiking(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      const result = await api.updateSocialComment(comment.id, body);
      onChange(result.comment);
      setEditing(false);
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  };
  return <article className={`video-comment social-comment${expanding ? " social-comment--expanding" : ""}`}>
    {comment.author.avatar
      ? <img className="video-comment__avatar" src={comment.author.avatar} alt="" decoding="async" />
      : <span className="video-comment__avatar video-comment__avatar--fallback" style={{ background: comment.author.avatar_color }}>{comment.author.name.trim()[0]?.toUpperCase() ?? "?"}</span>}
    <div className="video-comment__body">
      <header className="video-comment__header">
        <strong>{comment.author.name}</strong>
        <time dateTime={comment.created_at}>{formatTimeAgo(comment.created_at, language)}</time>
        {comment.updated_at !== comment.created_at && <span>{t("socialEdited")}</span>}
      </header>
      {editing ? <Stack gap={2}>
        <ProfileMentionInput value={body} onChange={setBody} profiles={profiles} placeholder={t("socialCommentPlaceholder")} rows={3} disabled={saving} />
        <Inline justify="end">
          <Button size="sm" variant="ghost" onClick={() => { setBody(comment.body); setEditing(false); }}>{t("cancel")}</Button>
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={!body.trim() || saving}>{t("save")}</Button>
        </Inline>
      </Stack> : <div className="video-comment__text"><MentionText text={comment.body} mentions={comment.mentions} /></div>}
      {!editing && <footer className="video-comment__meta social-comment__actions">
        <button type="button" className={`social-comment__like${comment.liked_by_me ? " is-liked" : ""}`} aria-pressed={comment.liked_by_me} aria-label={comment.liked_by_me ? t("socialUnlikeComment") : t("socialLikeComment")} disabled={liking} onClick={() => void toggleLike()}>
          <ThumbsUp fill={comment.liked_by_me ? "currentColor" : "none"} /> {comment.like_count > 0 && comment.like_count}
        </button>
        {comment.can_edit && <button type="button" onClick={() => setEditing(true)}><Edit3 /> {t("edit")}</button>}
        {comment.can_delete && <Popconfirm message={t("socialDeleteCommentConfirm")} onConfirm={() => onDelete(comment.id)}>
          <button type="button" className="social-comment__delete"><Trash2 /> {t("delete")}</button>
        </Popconfirm>}
      </footer>}
    </div>
  </article>;
}

function SocialComments({ open, post, profiles, onPostChange, onError }: { open: boolean; post: SocialPost; profiles: SocialProfileRef[]; onPostChange: (post: SocialPost) => void; onError: () => void }) {
  const { t } = useI18n();
  const [comments, setComments] = useState<SocialComment[]>(post.comment_preview);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const previewIds = useMemo(() => new Set(post.comment_preview.map((comment) => comment.id)), [post.comment_preview]);
  const mergeComments = (current: SocialComment[], incoming: SocialComment[]) => {
    const byId = new Map(current.map((comment) => [comment.id, comment]));
    for (const comment of incoming) byId.set(comment.id, comment);
    return [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  };
  const load = useCallback(async (append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setLoadError(false);
    try {
      const result = await api.socialComments(post.id, append ? nextCursor : null, 40);
      setComments((current) => mergeComments(append ? current : post.comment_preview, result.comments));
      setNextCursor(result.next_cursor);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [nextCursor, post.comment_preview, post.id]);
  useEffect(() => { if (open) void load(false); }, [open, post.id]);
  useEffect(() => { if (!open) setComments(post.comment_preview); }, [open, post.comment_preview]);
  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const result = await api.createSocialComment(post.id, body);
      if (result.comment) setComments((current) => mergeComments(current, [result.comment]));
      setBody("");
      onPostChange({ ...post, comments_count: post.comments_count + 1, comment_preview: [...post.comment_preview, result.comment].filter(Boolean).slice(-3) as SocialComment[] });
    } catch {
      onError();
    } finally { setSending(false); }
  };
  const remove = async (id: string) => {
    try {
      await api.deleteSocialComment(id);
      setComments((current) => current.filter((comment) => comment.id !== id));
      onPostChange({ ...post, comments_count: Math.max(0, post.comments_count - 1), comment_preview: post.comment_preview.filter((comment) => comment.id !== id) });
    } catch {
      onError();
    }
  };
  if (!open) return post.comment_preview.length > 0 ? <section className="social-comments social-comments--preview">
    <div className="social-comment-preview-list">
      {post.comment_preview.map((comment, index) => <article className="social-comment-preview" key={comment.id} style={{ "--comment-index": index } as CSSProperties}>
        {comment.author.avatar
          ? <img className="social-comment-preview__avatar" src={comment.author.avatar} alt="" decoding="async" />
          : <span className="social-comment-preview__avatar social-comment-preview__avatar--fallback" style={{ background: comment.author.avatar_color }}>{comment.author.name.trim()[0]?.toUpperCase() ?? "?"}</span>}
        <strong>{comment.author.name}</strong>
        <span className="social-comment-preview__text"><MentionText text={comment.body} mentions={comment.mentions} /></span>
      </article>)}
    </div>
  </section> : null;
  return <section className="social-comments">
    <div className="social-comments__panel">
      {loadError && <Alert variant="warning" className="social-comments__error">{t("socialCommentsLoadError")} <Button size="sm" variant="ghost" onClick={() => void load(false)}>{t("reload")}</Button></Alert>}
      {loading && comments.length === 0 ? <div className="social-comments__skeleton" aria-hidden="true">{[0, 1].map((item) => <div className="social-comment-skeleton" key={item}>
        <span className="skeleton" /><div><b className="skeleton" /><i className="skeleton" /><i className="skeleton" /></div>
      </div>)}</div> : comments.map((comment) =>
        <SocialCommentRow
          key={comment.id}
          comment={comment}
          expanding={previewIds.has(comment.id)}
          profiles={profiles}
          onChange={(next) => setComments((current) => current.map((item) => item.id === next.id ? next : item))}
          onDelete={(id) => void remove(id)}
          onError={onError}
        />
      )}
      {!loading && !loadError && nextCursor && <div className="social-comments__load-more"><Button size="sm" variant="ghost" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? <LoaderCircle className="spin" /> : t("socialLoadMoreComments")}</Button></div>}
      <div className="social-comments__composer">
        <ProfileMentionInput className="social-comment-composer__input" value={body} onChange={setBody} profiles={profiles} placeholder={t("socialCommentPlaceholder")} rows={2} disabled={sending} />
        <IconButton variant="primary" label={t("socialCommentAction")} icon={sending ? <LoaderCircle className="spin" /> : <Send />} disabled={!body.trim() || sending} onClick={() => void send()} />
      </div>
    </div>
  </section>;
}

function SocialPostCard({
  post,
  profiles,
  onPlay,
  onChange,
  onDelete,
  reactionsEnabled,
  recentEmojis,
  onEmojiUsed,
  emojiSkinTone,
  onEmojiSkinToneChange,
  commentsEnabled,
  commentsInitiallyOpen = false,
  onError,
}: {
  post: SocialPost;
  profiles: SocialProfileRef[];
  onPlay: PlayVideo;
  onChange: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  reactionsEnabled: boolean;
  recentEmojis: readonly string[];
  onEmojiUsed: (emoji: string) => void;
  emojiSkinTone: EmojiSkinTone;
  onEmojiSkinToneChange: (skinTone: EmojiSkinTone) => void;
  commentsEnabled: boolean;
  commentsInitiallyOpen?: boolean;
  onError: () => void;
}) {
  const { t, language } = useI18n();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body);
  const [saving, setSaving] = useState(false);
  const [reacting, setReacting] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(commentsInitiallyOpen);
  const updateReaction = async (key: string) => {
    const selected = !post.my_reactions.includes(key);
    const optimistic: SocialPost = {
      ...post,
      my_reactions: selected ? [...post.my_reactions, key] : post.my_reactions.filter((item) => item !== key),
      reactions: { ...post.reactions, [key]: Math.max(0, (post.reactions[key] ?? 0) + (selected ? 1 : -1)) },
    };
    onChange(optimistic);
    setReacting(key);
    try {
      onChange((await api.setSocialReaction(post.id, key, selected)).post);
      if (selected) onEmojiUsed(key);
    }
    catch { onChange(post); onError(); }
    finally { setReacting(null); }
  };
  const save = async () => {
    setSaving(true);
    try {
      onChange((await api.updateSocialPost(post.id, body)).post);
      setEditing(false);
    } catch {
      onError();
    } finally { setSaving(false); }
  };
  const refreshVideo = () => api.socialPost(post.id).then((result) => onChange(result.post)).catch(() => {});
  return <article className="social-post" id={`social-post-${post.id}`}>
    <header className="social-post__header">
      <ProfileAvatar profile={post.author} size={36} />
      <div className="social-post__identity">
        <strong>{post.author.name}</strong>
        <span><Link className="social-post__permalink" to={`/social/${encodeURIComponent(post.id)}`}><time dateTime={post.created_at}>{formatTimeAgo(post.created_at, language)}</time></Link>{post.updated_at !== post.created_at ? ` · ${t("socialEdited")}` : ""}</span>
      </div>
      {(post.can_edit || post.can_delete) && <Popover align="end" surface="menu" trigger={<IconButton variant="ghost" size="sm" label={t("moreActions")} icon={<MoreHorizontal />} />}>
        <Menu>
          {post.can_edit && <MenuItem icon={<Edit3 />} onClick={() => setEditing(true)}>{t("edit")}</MenuItem>}
          {post.can_delete && <Popconfirm triggerClassName="social-post__menu-popconfirm" message={t("socialDeletePostConfirm")} onConfirm={() => onDelete(post.id)}>
            <MenuItem icon={<Trash2 />}>{t("delete")}</MenuItem>
          </Popconfirm>}
        </Menu>
      </Popover>}
    </header>
    {editing ? <Stack gap={2} className="social-post__edit">
      <ProfileMentionInput value={body} onChange={setBody} profiles={profiles} placeholder={t("socialPostPlaceholder")} disabled={saving} maxLength={1_000} />
      <Inline justify="end"><Button variant="ghost" onClick={() => { setBody(post.body); setEditing(false); }}>{t("cancel")}</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>{t("save")}</Button></Inline>
    </Stack> : post.body && <p className="social-post__body"><MentionText text={post.body} mentions={post.mentions} /></p>}
    <div className="social-post__video">
      <VideoCard
        key={`${post.id}:${post.video.status}:${post.video.watched ?? ""}`}
        video={post.video}
        onPlay={onPlay}
        onChanged={() => void refreshVideo()}
        allowReject={false}
        allowMarkWatched={false}
        searchResultLayout
        showWatchProgress
      />
    </div>
    {(reactionsEnabled || commentsEnabled) && <div className="social-actions">
      {reactionsEnabled && Object.entries(post.reactions).filter(([, count]) => count > 0).map(([key, count]) => {
        const active = post.my_reactions.includes(key);
        const profileNames = (post.reaction_profiles[key] ?? []).map((profile) => profile.name).join(", ");
        const chip = <Chip active={active} className="social-reaction" aria-label={`${t("socialReact")}: ${key}${profileNames ? ` — ${profileNames}` : ""}`} disabled={reacting !== null} onClick={() => void updateReaction(key)}>
          <span className="social-reactions__emoji" aria-hidden="true">{key}</span><span className="social-reactions__count">{count}</span>
        </Chip>;
        return profileNames
          ? <Tooltip key={key} text={profileNames} pos="top" delay={250} className="social-reaction-tooltip" portal>{chip}</Tooltip>
          : <span key={key}>{chip}</span>;
      })}
      {reactionsEnabled && <EmojiReactionPicker recent={recentEmojis} selected={post.my_reactions} skinTone={emojiSkinTone} disabled={reacting !== null} onSelect={(emoji) => void updateReaction(emoji)} onSkinToneChange={onEmojiSkinToneChange} />}
      {commentsEnabled && <Button
        className="social-comments-toggle"
        size="sm"
        variant="ghost"
        leadingIcon={<MessageCircle />}
        aria-expanded={commentsOpen}
        onClick={() => setCommentsOpen((value) => !value)}
      >
        {commentsOpen ? t("socialHideComments") : t("socialShowComments")} {post.comments_count > 0 && `(${post.comments_count})`}
      </Button>}
    </div>}
    {commentsEnabled && <SocialComments open={commentsOpen} post={post} profiles={profiles} onPostChange={onChange} onError={onError} />}
  </article>;
}

export default function SocialPage({ onPlay, showToast }: { onPlay: PlayVideo; showToast: (message: string) => void }) {
  const { t } = useI18n();
  useDocumentTitle(t("socialTitle"));
  const navigate = useNavigate();
  const { postUuid } = useParams<{ postUuid: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const legacyPostUuid = searchParams.get("post");
  const focusedPostUuid = postUuid ?? legacyPostUuid;
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [profiles, setProfiles] = useState<SocialProfileRef[]>([]);
  const [activeProfile, setActiveProfile] = useState<SocialProfileRef | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [postBody, setPostBody] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [query, setQuery] = useState("");
  const [videos, setVideos] = useState<Video[]>([]);
  const [searching, setSearching] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [emojiSkinTone, setEmojiSkinTone] = useState<EmojiSkinTone>("neutral");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async (append = false) => {
    if (append && (loadingMoreRef.current || !nextCursor || focusedPostUuid)) return;
    if (append) {
      loadingMoreRef.current = true;
      setLoadingMore(true);
      setLoadMoreError(false);
    } else {
      setLoading(true);
      setLoadMoreError(false);
    }
    if (!append) setPosts([]);
    setError(false);
    try {
      if (focusedPostUuid) {
        const result = await api.socialPost(focusedPostUuid);
        setPosts([result.post]);
        setNextCursor(null);
        return;
      }
      const result = await api.socialPosts(append ? nextCursor : null);
      setPosts((current) => append ? [...current, ...result.posts.filter((post) => !current.some((item) => item.id === post.id))] : result.posts);
      setNextCursor(result.next_cursor);
    } catch {
      if (append) setLoadMoreError(true);
      else setError(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [focusedPostUuid, nextCursor]);

  useEffect(() => { void load(false); }, [focusedPostUuid]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || focusedPostUuid || !nextCursor || loading || loadingMore || loadMoreError) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMoreRef.current) void load(true);
    }, { rootMargin: "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [focusedPostUuid, load, loadMoreError, loading, loadingMore, nextCursor]);
  useEffect(() => {
    if (!postUuid && legacyPostUuid) navigate(`/social/${encodeURIComponent(legacyPostUuid)}`, { replace: true });
  }, [legacyPostUuid, navigate, postUuid]);
  useEffect(() => {
    Promise.all([api.socialProfiles(), api.profiles(), api.pluginSettings("social"), api.socialRecentEmojis()]).then(([social, all, config, recent]) => {
      setProfiles(social.profiles);
      const active = all.profiles.find((profile: Profile) => profile.active);
      setActiveProfile(social.profiles.find((profile) => profile.id === active?.id) ?? null);
      setCommentsEnabled(Number(config.settings.comments_enabled ?? 1) === 1);
      setReactionsEnabled(Number(config.settings.reactions_enabled ?? 1) === 1);
      setRecentEmojis(recent.emojis);
      setEmojiSkinTone(recent.skinTone);
    }).catch(() => {});
  }, []);
  useEffect(() => subscribeServerEvent("social", (data) => {
    const postId = typeof data?.postId === "string" ? data.postId : null;
    if (!postId) return;

    const isPostDeletion = data?.deleted === true && typeof data?.commentId !== "string";
    if (isPostDeletion) {
      if (focusedPostUuid === postId) {
        navigate("/social", { replace: true });
        return;
      }
      setPosts((current) => current.filter((post) => post.id !== postId));
      return;
    }

    if (focusedPostUuid && focusedPostUuid !== postId) return;

    void api.socialPost(postId).then(({ post }) => {
      setPosts((current) => current.some((item) => item.id === postId)
        ? current.map((item) => item.id === postId ? post : item)
        : [post, ...current]);
    }).catch(() => {});
  }), [focusedPostUuid, navigate]);

  useEffect(() => {
    if (focusedPostUuid) return;
    const videoId = searchParams.get("video");
    if (!videoId) return;
    api.video(videoId).then(({ video }) => {
      setSelectedVideo(video);
      setComposerOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("video");
      setSearchParams(next, { replace: true });
    }).catch(() => {});
  }, [focusedPostUuid, searchParams, setSearchParams]);

  useEffect(() => {
    if (!composerOpen) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      api.feed({ q: query.trim() || undefined, status: "all", show_all: true, all_sources: true, limit: 20 })
        .then((result) => setVideos(result.videos))
        .catch(() => setVideos([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [composerOpen, query]);

  const publish = async () => {
    if (!selectedVideo) return;
    setPublishing(true);
    try {
      const result = await api.createSocialPost(selectedVideo.video_id, postBody);
      setPosts((current) => [result.post, ...current]);
      setComposerOpen(false);
      setSelectedVideo(null);
      setPostBody("");
      setQuery("");
    } catch {
      showToast(t("socialActionError"));
    } finally { setPublishing(false); }
  };
  const updatePost = (next: SocialPost) => setPosts((current) => current.map((post) => post.id === next.id ? next : post));
  const rememberEmoji = (emoji: string) => setRecentEmojis((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 6));
  const rememberEmojiSkinTone = (skinTone: EmojiSkinTone) => {
    const previous = emojiSkinTone;
    setEmojiSkinTone(skinTone);
    void api.setSocialEmojiSkinTone(skinTone).catch(() => {
      setEmojiSkinTone((current) => current === skinTone ? previous : current);
      showToast(t("socialActionError"));
    });
  };
  const deletePost = async (id: string) => {
    try {
      await api.deleteSocialPost(id);
      setPosts((current) => current.filter((post) => post.id !== id));
      if (focusedPostUuid === id) navigate("/social", { replace: true });
    } catch {
      showToast(t("socialActionError"));
    }
  };

  const selectedPreview = useMemo(() => selectedVideo && <List divided={false} className="social-selected-video"><ListButton
    media={<VideoThumbnail src={img(selectedVideo.thumbnail)} watched={Boolean(selectedVideo.watched)} variant="sidebar" />}
    title={selectedVideo.title}
    description={selectedVideo.channel_title}
    meta={t("remove")}
    onClick={() => setSelectedVideo(null)}
  /></List>, [selectedVideo, t]);

  return <div className="social-page">
    <PageHeader
      title={t("socialTitle")}
      actions={!focusedPostUuid ? <Button variant="primary" leadingIcon={<Plus />} onClick={() => setComposerOpen(true)}>{t("socialShareVideo")}</Button> : undefined}
    />
    {error ? <Alert variant="danger">{t("socialLoadError")}</Alert> : loading ? <SocialPostsSkeleton count={focusedPostUuid ? 1 : 3} showBack={Boolean(focusedPostUuid)} onBack={() => navigate("/social")} /> : posts.length === 0 ? <EmptyState art={<EmptyArt scene="socialEmpty" />} title={t("socialEmptyTitle")} description={t("socialEmptyDescription")} action={<Button variant="primary" onClick={() => setComposerOpen(true)}>{t("socialShareVideo")}</Button>} /> : <div className={`social-posts${focusedPostUuid ? " social-posts--focused" : ""}`}>
      {focusedPostUuid && <Button className="social-posts__back" variant="ghost" leadingIcon={<ArrowLeft />} onClick={() => navigate("/social")}>{t("socialBackToAll")}</Button>}
      {posts.map((post, index) => <div className={`social-post-entry${focusedPostUuid ? " social-post-entry--focused" : ""}`} style={{ "--social-post-index": Math.min(index, 6) } as CSSProperties} key={`${focusedPostUuid ? "focused" : "feed"}:${post.id}`}><SocialPostCard post={post} profiles={profiles} onPlay={onPlay} onChange={updatePost} onDelete={(id) => void deletePost(id)} reactionsEnabled={reactionsEnabled} recentEmojis={recentEmojis} onEmojiUsed={rememberEmoji} emojiSkinTone={emojiSkinTone} onEmojiSkinToneChange={rememberEmojiSkinTone} commentsEnabled={commentsEnabled} commentsInitiallyOpen={Boolean(focusedPostUuid)} onError={() => showToast(t("socialActionError"))} /></div>)}
      {loadingMore && <SocialPostSkeleton />}
    </div>}
    {!focusedPostUuid && nextCursor && <div className="social-load-more" ref={loadMoreRef} aria-label={loadingMore ? t("loading") : undefined}>
      {loadMoreError && <Button variant="ghost" onClick={() => void load(true)}>{t("reload")}</Button>}
    </div>}

    <Dialog
      open={composerOpen}
      onOpenChange={(open) => { setComposerOpen(open); if (!open) { setSelectedVideo(null); setPostBody(""); } }}
      title={t("socialShareVideo")}
      closeLabel={t("close")}
      className="social-composer-dialog"
      footer={<Inline justify="end"><Button variant="ghost" onClick={() => setComposerOpen(false)}>{t("cancel")}</Button><Button variant="primary" onClick={() => void publish()} disabled={!selectedVideo || publishing}>{publishing ? t("socialPublishing") : t("socialPublish")}</Button></Inline>}
    >
      <Stack gap={4}>
        {activeProfile && <div className="social-composer-author"><ProfileAvatar profile={activeProfile} size={38} /><span>{activeProfile.name}</span></div>}
        <Field label={t("socialChooseVideo")}>
          {selectedPreview ?? <>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("socialSearchPlaceholder")} />
            <div className="social-video-results">
              {searching ? <LoaderCircle className="spin" /> : videos.length === 0 ? <span>{t("socialNoVideos")}</span> : <List>
                {videos.map((video) => <ListButton key={video.video_id} media={<VideoThumbnail src={img(video.thumbnail)} watched={Boolean(video.watched)} variant="sidebar" />} title={video.title} description={video.channel_title} onClick={() => setSelectedVideo(video)} />)}
              </List>}
            </div>
          </>}
        </Field>
        <Field label={t("socialMentionProfiles")}>
          <ProfileMentionInput value={postBody} onChange={setPostBody} profiles={profiles} placeholder={t("socialPostPlaceholder")} disabled={publishing} maxLength={1_000} />
        </Field>
      </Stack>
    </Dialog>
  </div>;
}
