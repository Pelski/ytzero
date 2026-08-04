export const YT_NO_REDIRECT_MARKER = "ytNoRedirect";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value.startsWith("www.") ? `https://${value}` : value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id: string | null | undefined;
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0];
    else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(?:shorts|live|embed)\//.test(url.pathname)) id = url.pathname.split("/")[2];
    } else if (host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com")) {
      if (url.pathname.startsWith("/embed/")) id = url.pathname.split("/")[2];
    }
    return id && VIDEO_ID_PATTERN.test(id) ? id : null;
  } catch {
    return null;
  }
}

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
