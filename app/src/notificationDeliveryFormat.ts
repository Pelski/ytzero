/**
 * Pure formatting for notifications that leave the installation.
 *
 * Everything the bell shows can also be forwarded to an external service, so
 * this module turns a stored notification row into the small, provider-neutral
 * message shape (`title`, `body`, `url`, `tags`) that every provider adapter in
 * `notificationDelivery.ts` maps onto its own payload. It performs no I/O and
 * reads no configuration, which keeps the wording testable on its own.
 */

export const NOTIFICATION_PROVIDERS = ["off", "apprise", "webhook", "ntfy"] as const;
export type NotificationProvider = (typeof NOTIFICATION_PROVIDERS)[number];

export function isNotificationProvider(value: unknown): value is NotificationProvider {
  return typeof value === "string" && (NOTIFICATION_PROVIDERS as readonly string[]).includes(value);
}

export interface DeliveryMessage {
  title: string;
  body: string;
  url: string;
  /** Stable, machine-readable labels forwarded to providers that support them. */
  tags: string[];
}

type Payload = Record<string, unknown>;

function textOf(payload: Payload, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function actorName(payload: Payload): string {
  const actor = payload.actor;
  if (!actor || typeof actor !== "object") return "";
  const name = (actor as Payload).name;
  return typeof name === "string" ? name.trim() : "";
}

/** Collapse a body to a single line so chat providers keep messages compact. */
export function excerpt(value: string, limit = 240): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * Join the instance base URL with a stored in-app target path. An empty or
 * non-absolute base yields the bare path: providers still render it, and a
 * misconfigured base must never silently point at another host.
 */
export function absoluteTarget(baseUrl: string, target: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const path = target.trim();
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${suffix}` : suffix;
}

export function buildDeliveryMessage(kind: string, payload: Payload, target: string, baseUrl = ""): DeliveryMessage {
  const url = absoluteTarget(baseUrl, target);
  const videoTitle = textOf(payload, "videoTitle");
  const channelTitle = textOf(payload, "channelTitle");

  if (kind === "channel_video") {
    return {
      title: videoTitle || "New video",
      body: channelTitle ? `New video from ${channelTitle}.` : "A followed channel published a new video.",
      url,
      tags: ["ytzero", "channel"],
    };
  }
  if (kind === "playlist_video") {
    const playlistTitle = textOf(payload, "playlistTitle");
    return {
      title: videoTitle || "New video in a followed playlist",
      body: playlistTitle ? `Added to “${playlistTitle}”.` : "A followed playlist received a new video.",
      url,
      tags: ["ytzero", "playlist"],
    };
  }
  if (kind === "tag_rule") {
    const tagName = textOf(payload, "tagName");
    const pattern = textOf(payload, "rulePattern");
    const parts = [
      tagName ? `Tagged “${tagName}”` : "A tag rule matched",
      pattern ? `matching “${pattern}”` : "",
      channelTitle ? `on ${channelTitle}` : "",
    ].filter(Boolean);
    return {
      title: videoTitle || "A tag rule matched a video",
      body: `${parts.join(" ")}.`,
      url,
      tags: ["ytzero", "rule"],
    };
  }
  if (kind === "download_failed") {
    const error = textOf(payload, "error");
    return {
      title: videoTitle ? `Download failed: ${videoTitle}` : "Download failed",
      body: error ? excerpt(error) : "The video could not be downloaded.",
      url,
      tags: ["ytzero", "download", "error"],
    };
  }
  if (kind === "app_update") {
    const version = textOf(payload, "version");
    return {
      title: "A new YT Zero version is available",
      body: version ? `Version ${version} is ready to install.` : "An update is ready to install.",
      url,
      tags: ["ytzero", "update"],
    };
  }
  if (kind.startsWith("social_")) {
    const actor = actorName(payload) || "Someone";
    const action = kind === "social_post" ? "shared a video"
      : kind === "social_comment" ? "commented on your post"
      : kind === "social_mention" ? "mentioned you"
      : kind === "social_comment_like" ? "liked your comment"
      : "reacted to your post";
    const quote = textOf(payload, "commentBody") || textOf(payload, "postBody");
    return {
      title: `${actor} ${action}`,
      body: quote ? excerpt(quote) : "Open the conversation in Social.",
      url,
      tags: ["ytzero", "social"],
    };
  }
  return {
    title: videoTitle || "YT Zero notification",
    body: excerpt(textOf(payload, "description")) || "Open YT Zero to see the details.",
    url,
    tags: ["ytzero"],
  };
}

/**
 * Split a stored target list into individual entries. One target per line keeps
 * commas inside provider URLs intact (for example a mail recipient list).
 */
export function parseDeliveryTargets(value: string): string[] {
  return [...new Set(
    value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean),
  )];
}
