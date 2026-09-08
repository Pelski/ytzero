import type { AdaptiveRefreshOptions } from "./adaptiveRefresh";

const FEED_REFRESH_BATCH_SIZE = 10;
const FEED_REFRESH_FAIRNESS_SLOTS = 2;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function videoMaintenanceMaxAgeDays(): number {
  return positiveNumber(process.env.VIDEO_MAINTENANCE_MAX_AGE_DAYS, 90);
}

export function adaptiveRefreshOptions(force = false): AdaptiveRefreshOptions {
  const minIntervalMin = positiveNumber(process.env.ADAPTIVE_REFRESH_MIN_MINUTES, 10);
  const maxIntervalMin = Math.max(minIntervalMin, positiveNumber(process.env.ADAPTIVE_REFRESH_MAX_MINUTES, 12 * 60));
  const unknownIntervalMin = Math.min(maxIntervalMin, Math.max(minIntervalMin, positiveNumber(process.env.ADAPTIVE_REFRESH_UNKNOWN_MINUTES, 2 * 60)));
  const inactiveMaxIntervalMin = Math.min(3 * 24 * 60, Math.max(maxIntervalMin, positiveNumber(process.env.ADAPTIVE_REFRESH_INACTIVE_MAX_MINUTES, 3 * 24 * 60)));
  return {
    nowMs: Date.now(), batchSize: FEED_REFRESH_BATCH_SIZE, fairnessSlots: FEED_REFRESH_FAIRNESS_SLOTS,
    minIntervalMs: minIntervalMin * 60_000, maxIntervalMs: maxIntervalMin * 60_000,
    unknownIntervalMs: unknownIntervalMin * 60_000, inactiveMaxIntervalMs: inactiveMaxIntervalMin * 60_000, force,
  };
}
