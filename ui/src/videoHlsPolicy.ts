export type VideoHlsRecoveryAction = "ignore" | "reload-master" | "restart-network" | "recover-media" | "fatal";

export function videoHlsStartPosition(startSeconds: number, durationSeconds?: number): number {
  if (!Number.isFinite(startSeconds) || startSeconds <= 0) return 0;
  if (Number.isFinite(durationSeconds) && Number(durationSeconds) > 0 && startSeconds >= Number(durationSeconds) - 5) return 0;
  return startSeconds;
}

export function videoHlsRecoveryPosition(
  currentTime: number,
  startPosition: number,
  playbackStarted: boolean,
): number {
  if (Number.isFinite(currentTime) && currentTime >= 0 && (playbackStarted || currentTime > 0)) return currentTime;
  return startPosition;
}

export function shouldUseNativeVideoHls(canPlayType: string, vendor: string): boolean {
  // Chromium can advertise HLS support even when its native playback path is
  // incomplete. Keep native HLS to Apple browsers and use hls.js elsewhere.
  return /apple/i.test(vendor) && (canPlayType === "probably" || canPlayType === "maybe");
}

export function videoHlsRecoveryAction({
  fatal,
  masterReloadPending = false,
  masterReloadUsed = false,
  mediaRecoveryUsed,
  networkRecoveryUsed,
  responseCode,
  type,
}: {
  fatal: boolean;
  masterReloadPending?: boolean;
  masterReloadUsed?: boolean;
  mediaRecoveryUsed: boolean;
  networkRecoveryUsed: boolean;
  responseCode?: number;
  type: string;
}): VideoHlsRecoveryAction {
  if (type === "networkError" && responseCode === 410) {
    if (masterReloadPending) return "ignore";
    if (!masterReloadUsed) return "reload-master";
    return "fatal";
  }
  if (!fatal) return "ignore";
  if (type === "networkError" && !networkRecoveryUsed) return "restart-network";
  if (type === "mediaError" && !mediaRecoveryUsed) return "recover-media";
  return "fatal";
}
