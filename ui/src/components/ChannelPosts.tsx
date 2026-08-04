import { useEffect, useRef, useState } from "react";
import { ExternalLink, Heart, MessageCircle, Play, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ChannelPost } from "../channelPostTypes";
import { img } from "../img";
import { formatTimeAgo, useI18n } from "../i18n";
import { markYouTubeUrl, youtubeVideoId } from "../youtubeUrl";
import { linkifyText } from "../linkifyText";
import { Button, ButtonAnchor, EmptyState, Menu, MenuItem, Popover } from "./ui";
import VideoCard from "./VideoCard";
import "./ChannelPosts.css";

const PAGE_SIZE = 12;

function YouTubePostLink({ value, href, videoId }: { value: string; href: string; videoId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const openYouTube = () => {
    setOpen(false);
    window.open(markYouTubeUrl(href), "_blank", "noopener,noreferrer");
  };
  return <Popover
    align="start"
    surface="menu"
    open={open}
    onOpenChange={setOpen}
    rootClassName="channel-post-link-popover"
    trigger={<button type="button" className="channel-post-link-trigger">{value}</button>}
  >
    <Menu>
      <MenuItem icon={<Play />} onClick={() => { setOpen(false); navigate(`/watch/${videoId}`); }}>{t("openHere")}</MenuItem>
      <MenuItem icon={<ExternalLink />} onClick={openYouTube}>{t("openOnYouTube")}</MenuItem>
    </Menu>
  </Popover>;
}

function PostText({ value }: { value: string }) {
  return <>{linkifyText(value).map((part, index) => {
    if (part.type === "text") return part.value;
    const videoId = youtubeVideoId(part.href);
    return videoId
      ? <YouTubePostLink key={`${part.value}-${index}`} value={part.value} href={part.href} videoId={videoId} />
      : <a key={`${part.value}-${index}`} href={part.href} target="_blank" rel="noreferrer">{part.value}</a>;
  })}</>;
}

export default function ChannelPosts({ channelId, channelName, channelAvatar, onPlay, refreshRevision }: { channelId: string; channelName: string; channelAvatar: string; onPlay: (video: NonNullable<ChannelPost["localVideo"]>) => void; refreshRevision: number }) {
  const { t, language } = useI18n();
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const appliedRefreshRevision = useRef(refreshRevision);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const result = await api.channelPosts(channelId, language);
      setPosts(result.posts);
      if (!silent) setVisible(PAGE_SIZE);
    } catch (reason) {
      if (!silent) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [channelId, language]);
  useEffect(() => {
    if (appliedRefreshRevision.current === refreshRevision) return;
    appliedRefreshRevision.current = refreshRevision;
    void load(true);
  }, [refreshRevision]);

  if (loading) return <div className="channel-posts-loading"><RefreshCw className="channel-posts-spin" />{t("channelPostsLoading")}</div>;
  if (error) return <EmptyState title={t("channelPostsError")} description={error} action={<Button onClick={() => void load()}>{t("reload")}</Button>} />;
  if (posts.length === 0) return <EmptyState title={t("channelPostsEmpty")} description={t("channelPostsEmptyHint")} />;

  return <section className="channel-posts">
    <div className="channel-posts-list">
      {posts.slice(0, visible).map((post) => <article className="channel-post" key={post.id}>
        <header className="channel-post-header">
          {channelAvatar ? <img className="channel-post-avatar" src={img(channelAvatar)} alt="" /> : <span className="channel-post-avatar channel-post-avatar--fallback">{channelName.slice(0, 1)}</span>}
          <div className="channel-post-identity"><strong>{channelName}</strong><span>{post.publishedAt ? formatTimeAgo(post.publishedAt, language) : post.publishedText}</span></div>
        </header>
        {(post.text || post.images.length > 0 || post.attachment) && <div className="channel-post-body">
        {post.text && <p className="channel-post-text"><PostText value={post.text} /></p>}
        {post.images.length > 0 && <div className={`channel-post-images channel-post-images--${Math.min(post.images.length, 4)}`}>
          {post.images.map((image, index) => <img key={`${image.url}-${index}`} src={img(image.url)} alt="" loading="lazy" />)}
        </div>}
        {post.attachment?.type === "video" && post.localVideo && <div className="channel-post-video">
          <VideoCard video={post.localVideo} onPlay={onPlay} onChanged={() => void load(true)} allowReject={false} allowMarkWatched={false} searchResultLayout showWatchProgress />
        </div>}
        {post.attachment?.type === "video" && !post.localVideo && <Link className="channel-post-attachment" to={`/watch/${post.attachment.id}`}>
          {post.attachment.thumbnail && <img src={img(post.attachment.thumbnail)} alt="" loading="lazy" />}
          <strong>{post.attachment.title || t("channelPostVideo")}</strong>
        </Link>}
        {post.attachment?.type === "playlist" && <a className="channel-post-attachment" href={markYouTubeUrl(`https://www.youtube.com/playlist?list=${post.attachment.id}`)} target="_blank" rel="noreferrer">
          {post.attachment.thumbnail && <img src={img(post.attachment.thumbnail)} alt="" loading="lazy" />}
          <strong>{post.attachment.title || t("channelPostPlaylist")}</strong>
        </a>}
        {post.attachment?.type === "poll" && <div className="channel-post-poll">
          {post.attachment.title && <strong>{post.attachment.title}</strong>}
          {post.attachment.choices?.map((choice, index) => <div className="channel-post-poll-choice" key={`${choice.text}-${index}`}><span>{choice.text}</span>{choice.votes && <small>{choice.votes}</small>}</div>)}
        </div>}
        </div>}
        <footer className="channel-post-footer">
          {post.likeCount && <span className="channel-post-footer-stat"><Heart />{post.likeCount}</span>}
          {post.replyCount && <span className="channel-post-footer-stat"><MessageCircle />{post.replyCount}</span>}
          <ButtonAnchor variant="ghost" size="sm" href={markYouTubeUrl(post.url)} target="_blank" rel="noreferrer" leadingIcon={<ExternalLink />}>{t("openOnYouTube")}</ButtonAnchor>
        </footer>
      </article>)}
    </div>
    {visible < posts.length && <div className="channel-posts-more"><Button onClick={() => setVisible((count) => count + PAGE_SIZE)}>{t("showMore")}</Button></div>}
  </section>;
}
