// Route YouTube image URLs through the backend cache/proxy so they are stored
// locally and survive origin rate-limiting (HTTP 429).
export function img(url: string | null | undefined, options?: { onMiss?: "error" }): string {
  if (!url) return "";
  if (!/^https?:\/\//.test(url)) return url;
  const proxyUrl = `/api/img?u=${encodeURIComponent(url)}`;
  return options?.onMiss === "error" ? `${proxyUrl}&onMiss=error` : proxyUrl;
}

const YOUTUBE_THUMBNAIL_HOST = ".ytimg.com";

// Returns a stable YouTube thumbnail URL for both direct and proxied thumbnail
// sources. Other image hosts and local paths deliberately have no fallback.
export function youtubeThumbnailFallback(url: string): string | null {
  const originalUrl = getProxiedImageUrl(url) ?? url;

  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return null;
  }

  if (!parsed.hostname.endsWith(YOUTUBE_THUMBNAIL_HOST) && parsed.hostname !== "img.youtube.com") return null;

  const [, format, videoId] = parsed.pathname.split("/");
  if ((format !== "vi" && format !== "vi_webp") || !videoId) return null;

  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function getProxiedImageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://ytzero.local");
  } catch {
    return null;
  }

  return parsed.pathname === "/api/img" ? parsed.searchParams.get("u") : null;
}
