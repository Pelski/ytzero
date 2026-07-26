/**
 * Prefer a separate video + audio pair, then fall back to a progressive
 * format. Keeping the height cap on every branch prevents a fallback from
 * silently exceeding the quality selected by the user.
 */
export function downloadFormat(quality: string): string {
  const parsedHeight = quality === "best" ? null : Number(quality);
  const height = parsedHeight != null && Number.isFinite(parsedHeight) && parsedHeight > 0
    ? Math.floor(parsedHeight)
    : null;
  const cap = height ? `[height<=${height}]` : "";
  return `bestvideo${cap}+bestaudio/bestvideo*${cap}/best${cap}`;
}

/**
 * Logged-in YouTube clients can expose fewer downloadable formats when a PO
 * Token is unavailable. Public videos therefore use the anonymous client
 * first; configured cookies remain a fallback for account-gated content.
 */
export function downloadCookieAttempts(cookiesConfigured: boolean): boolean[] {
  return cookiesConfigured ? [false, true] : [false];
}
