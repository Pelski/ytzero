import { api } from "./api";
import { isIncognitoMode } from "./incognitoMode";

interface ProgressWrite {
  position: number;
  duration: number;
}

const latest = new Map<string, ProgressWrite>();
const running = new Set<string>();

/**
 * Progress is a heartbeat, so it must not be debounced until playback stops.
 * Instead, keep at most one request in flight and coalesce any newer ticks.
 */
export function queueProgressWrite(videoId: string, position: number, duration: number) {
  if (isIncognitoMode()) {
    latest.delete(videoId);
    return;
  }
  latest.set(videoId, { position, duration });
  if (running.has(videoId)) return;
  running.add(videoId);
  void (async () => {
    try {
      while (latest.has(videoId)) {
        const next = latest.get(videoId)!;
        latest.delete(videoId);
        if (isIncognitoMode()) break;
        await api.saveProgress(videoId, next.position, next.duration);
      }
    } catch {
      // The next playback tick retries with fresh state. Keeping a rejected
      // stale write would risk replacing a newer seek position later.
      latest.delete(videoId);
    } finally {
      running.delete(videoId);
      const next = latest.get(videoId);
      if (next) queueProgressWrite(videoId, next.position, next.duration);
    }
  })();
}
