import { Check } from "lucide-react";
import type { ReactNode } from "react";

export type VideoThumbnailVariant =
  | "card"
  | "search"
  | "related"
  | "playlist"
  | "scheduled"
  | "external"
  | "sidebar"
  | "childWatching";

const VARIANT_CLASSES: Record<VideoThumbnailVariant, { frame: string; image: string }> = {
  card: { frame: "video-card-thumbnail", image: "thumb" },
  search: { frame: "yt-result-thumb", image: "" },
  related: { frame: "thumb-wrap related-thumb", image: "" },
  playlist: { frame: "playlist-item-thumb", image: "" },
  scheduled: { frame: "scheduled-thumb-frame", image: "scheduled-thumb" },
  external: { frame: "external-thumb-frame", image: "external-thumb" },
  sidebar: { frame: "sidebar-sub-thumb-frame", image: "sidebar-sub-thumb" },
  childWatching: { frame: "child-watching-thumb", image: "" },
};

function WatchedIndicator({ watched }: { watched: boolean }) {
  if (!watched) return null;
  return (
    <>
      <span className="watched-check-badge" aria-hidden="true">
        <Check size={13} strokeWidth={3} />
      </span>
      <span className="watched-progress-bar" aria-hidden="true">
        <span className="progress-bar-fill" />
      </span>
    </>
  );
}

export function VideoThumbnail({
  src,
  watched,
  variant,
  alt = "",
  loading,
  draggable,
  children,
}: {
  src: string;
  watched: boolean;
  variant: VideoThumbnailVariant;
  alt?: string;
  loading?: "eager" | "lazy";
  draggable?: boolean;
  children?: ReactNode;
}) {
  const classes = VARIANT_CLASSES[variant];
  const watchedClass = watched ? " watched-thumbnail--watched" : "";
  return (
    <span className={`video-thumbnail watched-thumbnail ${classes.frame}${watchedClass}`}>
      <img
        className={`video-thumbnail-image watched-thumbnail-image ${classes.image}`.trim()}
        src={src}
        alt={alt}
        loading={loading}
        draggable={draggable}
      />
      {children}
      <WatchedIndicator watched={watched} />
    </span>
  );
}
