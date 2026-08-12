import { ExternalLink, Lock, Star } from "lucide-react";
import { ButtonAnchor } from "../ui";

interface WatchRestrictedPlayerProps {
  actionHref?: string;
  actionLabel?: string;
  description: string;
  kind: "members" | "private";
  thumbnailUrl: string;
  title: string;
}

export default function WatchRestrictedPlayer({
  actionHref,
  actionLabel,
  description,
  kind,
  thumbnailUrl,
  title,
}: WatchRestrictedPlayerProps) {
  return (
    <div className="wp-panel wp-panel--members" style={{ backgroundImage: `url(${thumbnailUrl})` }}>
      <div className="wp-panel-scrim" />
      <div className="wp-panel-content">
        <span className="wp-members-icon" aria-hidden="true">
          {kind === "private" ? <Lock /> : <Star fill="currentColor" />}
        </span>
        <h3>{title}</h3>
        <p className="wp-panel-sub">{description}</p>
        {actionHref && actionLabel ? (
          <ButtonAnchor
            variant="primary"
            href={actionHref}
            target="_blank"
            rel="noreferrer"
            leadingIcon={<ExternalLink />}
          >
            {actionLabel}
          </ButtonAnchor>
        ) : null}
      </div>
    </div>
  );
}
