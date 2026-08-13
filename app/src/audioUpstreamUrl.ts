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

const GOOGLE_VIDEO_REDIRECT_LIMIT = 4;
const GOOGLE_VIDEO_REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Follow only a bounded chain of HTTPS redirects that stays on googlevideo. */
export async function fetchGoogleVideoResponse(
  fetchImpl: typeof fetch,
  candidate: string,
  init: RequestInit,
): Promise<Response | null> {
  let currentUrl = safeGoogleVideoUrl(candidate);
  if (!currentUrl) return null;
  for (let hop = 0; hop <= GOOGLE_VIDEO_REDIRECT_LIMIT; hop += 1) {
    const response = await fetchImpl(currentUrl, { ...init, redirect: "manual" }).catch(() => null);
    if (!response) return null;
    if (!GOOGLE_VIDEO_REDIRECTS.has(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (hop === GOOGLE_VIDEO_REDIRECT_LIMIT || !location) return null;
    currentUrl = safeGoogleVideoUrl(location, currentUrl);
    if (!currentUrl) return null;
  }
  return null;
}
