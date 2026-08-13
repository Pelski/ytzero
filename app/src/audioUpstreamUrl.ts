export function safeGoogleVideoUrl(candidate: string, base?: string): string | null {
  try {
    const url = base ? new URL(candidate, base) : new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (hostname !== "googlevideo.com" && !hostname.endsWith(".googlevideo.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function googleVideoHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
