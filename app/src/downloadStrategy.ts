/**
 * Prefer a separate video + audio pair, then fall back to a progressive
 * format. Keeping the height cap on every branch prevents a fallback from
 * silently exceeding the quality selected by the user.
 */
export function downloadFormat(quality: string, compatible = false): string {
  const parsedHeight = quality === "best" ? null : Number(quality);
  const height = parsedHeight != null && Number.isFinite(parsedHeight) && parsedHeight > 0
    ? Math.floor(parsedHeight)
    : null;
  if (compatible) {
    const compatibilityHeight = Math.min(height ?? 1080, 1080);
    const compatibilityCap = `[height<=${compatibilityHeight}]`;
    return `bestvideo[vcodec^=avc1]${compatibilityCap}+bestaudio[acodec^=mp4a]/best[ext=mp4][vcodec^=avc1][acodec^=mp4a]${compatibilityCap}`;
  }
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

function sanitizePathComponent(segment: string): string {
  return segment
    .normalize("NFC")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:|]+/g, " - ")
    .replace(/[*?"<>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
}

export function renderDownloadOutputTemplate(template: string, values: Record<string, string>, videoId: string): string {
  const rendered = (template.trim() || "{id}").replace(/\{(\w+)\}/g, (_, key: string) => sanitizePathComponent(values[key] ?? ""));
  const segments = rendered.split("/").map(sanitizePathComponent).filter(Boolean);
  let base = segments.join("/") || videoId;
  if (!base.includes(videoId)) base += ` [${videoId}]`;
  return base;
}
