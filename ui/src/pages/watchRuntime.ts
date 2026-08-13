let ytApiReady: Promise<void> | null = null;

export function loadYouTubeApi(): Promise<void> {
  if (!ytApiReady) {
    ytApiReady = new Promise<void>((resolve) => {
      const target = window as typeof window & { YT?: { Player?: unknown }; onYouTubeIframeAPIReady?: () => void };
      if (target.YT?.Player) {
        resolve();
        return;
      }
      const previousReadyHandler = target.onYouTubeIframeAPIReady;
      target.onYouTubeIframeAPIReady = () => {
        previousReadyHandler?.();
        resolve();
      };
      if (!document.querySelector('script[src*="iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }
    });
  }
  return ytApiReady;
}

export function colonDurationToSeconds(duration: string | null | undefined): number | undefined {
  if (!duration) return undefined;
  const parts = duration.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d+$/.test(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function formatWatchTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

type ShareTimestampCandidate = number | null | undefined | (() => unknown);

export function resolveShareTimestamp(...candidates: ShareTimestampCandidate[]): number {
  for (const candidate of candidates) {
    try {
      const value = typeof candidate === "function" ? Number(candidate()) : candidate;
      if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
    } catch {
      // An unavailable player source should not prevent using the next fallback.
    }
  }
  return 0;
}

/**
 * Own the player mount with the requested route, not with whichever library
 * row happened to resolve most recently. A missing row is a valid target while
 * its external import runs; once that import lands, the target stays unchanged.
 */
export function resolveWatchPlayerTarget(
  routeVideoId: string | undefined,
  loadedVideoId: string | null | undefined,
  missingVideoId: string | null,
): string | null {
  return routeVideoId && (loadedVideoId === routeVideoId || missingVideoId === routeVideoId) ? routeVideoId : null;
}

export function isMissingVideoError(error: Error): boolean {
  return error.message === "not found" || error.message === "HTTP 404";
}

export function canAutoArchiveVideo(
  video: { video_id: string; live_status: string } | null,
  routeVideoId: string | undefined,
): boolean {
  return Boolean(video && video.video_id === routeVideoId && video.live_status !== "live" && video.live_status !== "upcoming");
}
