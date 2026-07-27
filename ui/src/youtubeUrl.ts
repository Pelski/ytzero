export const YT_NO_REDIRECT_MARKER = "ytNoRedirect";

export function markYouTubeUrl(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const isYouTube = host === "youtu.be"
      || host === "youtube.com"
      || host.endsWith(".youtube.com")
      || host === "youtube-nocookie.com"
      || host.endsWith(".youtube-nocookie.com");
    if (!isYouTube || (url.protocol !== "http:" && url.protocol !== "https:")) return value;
    const fragments = url.hash.slice(1).split("&").filter(Boolean).filter((part) => part !== YT_NO_REDIRECT_MARKER);
    fragments.push(YT_NO_REDIRECT_MARKER);
    url.hash = fragments.join("&");
    return url.toString();
  } catch {
    return value;
  }
}
