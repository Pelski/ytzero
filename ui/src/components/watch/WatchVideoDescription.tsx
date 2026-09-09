import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, ExternalLink, Eye, ThumbsUp } from "lucide-react";
import { compactNumber, formatViewsCount, useI18n } from "../../i18n";
import { formatAppDate } from "../../dateTime";
import { markYouTubeUrl } from "../../youtubeUrl";
import WatchDescription from "./WatchDescription";

const DESCRIPTION_COLLAPSED_HEIGHT = 148;

export default function WatchVideoDescription({
  baseUrl,
  channelHandles,
  description,
  likes,
  linkMode = "app",
  publishedAt,
  showYouTube = true,
  videoId,
  views,
}: {
  baseUrl: string;
  channelHandles?: Map<string, string>;
  description: string;
  likes?: number | null;
  linkMode?: "app" | "external";
  publishedAt?: string | null;
  showYouTube?: boolean;
  videoId?: string;
  views?: number | null;
}) {
  const { t, language, locale, timeZone } = useI18n();
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [expandable, setExpandable] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [description, videoId]);

  useLayoutEffect(() => {
    const element = descriptionRef.current;
    if (!element) return;
    const measure = () => setExpandable(element.scrollHeight > DESCRIPTION_COLLAPSED_HEIGHT + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, likes, publishedAt, showYouTube, videoId, views]);

  return <>
    <div ref={descriptionRef} className={`watch-desc${expandable && !open ? " clamped" : ""}`} onClick={() => expandable && !open && setOpen(true)}>
      <div className="watch-desc-stats">
        {views != null && <span className="stat"><Eye /> {formatViewsCount(views, language)}</span>}
        {likes != null && <span className="stat"><ThumbsUp /> {compactNumber(likes, language)}</span>}
        {publishedAt && <span className="stat"><CalendarDays /> {formatAppDate(publishedAt, locale, timeZone)}</span>}
        {showYouTube && videoId && <a
          className="watch-youtube-link"
          href={markYouTubeUrl(`https://www.youtube.com/watch?v=${videoId}`)}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        ><ExternalLink /> YouTube</a>}
      </div>
      {description && <>
        <div className="watch-desc-sep" />
        <WatchDescription text={description} baseUrl={baseUrl} channelHandles={channelHandles} linkMode={linkMode} />
      </>}
    </div>
    {expandable && <button type="button" className="watch-desc-toggle" onClick={() => setOpen((value) => !value)}>{t(open ? "showLess" : "showMore")}</button>}
  </>;
}
