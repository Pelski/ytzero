export interface RefreshCandidate {
  channelId: string;
  addedAt: string | null;
  lastRefreshedAt: string | null;
  lastAttemptedAt: string | null;
  consecutiveFailures: number;
  publishedAt: string[];
  manualSchedule?: { days: number[]; time: string } | null;
  manualDue?: boolean;
}

export interface AdaptiveRefreshOptions {
  nowMs: number;
  batchSize: number;
  fairnessSlots: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  unknownIntervalMs: number;
  force?: boolean;
}

export interface ScheduledRefresh extends RefreshCandidate {
  targetIntervalMs: number;
  overdueRatio: number;
  reason: "manual" | "adaptive" | "fairness";
}

const parseTime = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = Date.parse(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Median upload gap is deliberately resistant to a one-off burst or hiatus. */
export function estimateUploadCadenceMs(publishedAt: string[]): number | null {
  const times = [...new Set(publishedAt.map(parseTime).filter((value): value is number => value !== null))]
    .sort((a, b) => b - a);
  if (times.length < 3) return null;
  const gaps = times.slice(0, -1).map((time, index) => time - times[index + 1]).filter((gap) => gap > 0).sort((a, b) => a - b);
  if (gaps.length < 2) return null;
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle];
}

export function targetRefreshIntervalMs(candidate: RefreshCandidate, options: AdaptiveRefreshOptions): number {
  const cadence = estimateUploadCadenceMs(candidate.publishedAt);
  const adaptive = cadence === null ? options.unknownIntervalMs : cadence / 24;
  const base = clamp(adaptive, options.minIntervalMs, options.maxIntervalMs);
  const failures = Math.max(0, Math.floor(candidate.consecutiveFailures));
  if (failures === 0) return base;
  const failureBackoff = Math.min(options.maxIntervalMs * 2, options.minIntervalMs * 2 ** failures);
  return Math.max(base, failureBackoff);
}

function lastAttemptMs(candidate: RefreshCandidate) {
  return parseTime(candidate.lastAttemptedAt) ?? parseTime(candidate.lastRefreshedAt);
}

function oldestFirst(a: RefreshCandidate, b: RefreshCandidate) {
  const aAttempt = lastAttemptMs(a) ?? Number.NEGATIVE_INFINITY;
  const bAttempt = lastAttemptMs(b) ?? Number.NEGATIVE_INFINITY;
  if (aAttempt !== bAttempt) return aAttempt - bAttempt;
  const aAdded = parseTime(a.addedAt) ?? Number.NEGATIVE_INFINITY;
  const bAdded = parseTime(b.addedAt) ?? Number.NEGATIVE_INFINITY;
  return aAdded - bAdded || a.channelId.localeCompare(b.channelId);
}

/**
 * Reserve a small part of every batch for oldest-first rotation, then spend
 * the remaining request budget on the most overdue adaptive candidates.
 */
export function selectRefreshBatch(candidates: RefreshCandidate[], options: AdaptiveRefreshOptions): ScheduledRefresh[] {
  const batchSize = Math.max(0, Math.floor(options.batchSize));
  const fairnessSlots = clamp(Math.floor(options.fairnessSlots), 0, batchSize);
  const manual = candidates.filter((candidate) => candidate.manualSchedule && candidate.manualDue);
  const manualIds = new Set(manual.map((candidate) => candidate.channelId));
  const remainingSize = Math.max(0, batchSize - manual.length);
  const scored = candidates.filter((candidate) => !manualIds.has(candidate.channelId)).map((candidate) => {
    const targetIntervalMs = targetRefreshIntervalMs(candidate, options);
    const attemptedAt = lastAttemptMs(candidate);
    const elapsed = attemptedAt === null ? Number.POSITIVE_INFINITY : Math.max(0, options.nowMs - attemptedAt);
    return { ...candidate, targetIntervalMs, overdueRatio: elapsed / targetIntervalMs };
  }).filter((candidate) => options.force || candidate.overdueRatio >= 1);

  const adaptive = [...scored]
    .sort((a, b) => b.overdueRatio - a.overdueRatio || oldestFirst(a, b))
    .slice(0, Math.max(0, remainingSize - Math.min(fairnessSlots, remainingSize)));
  const adaptiveIds = new Set(adaptive.map((candidate) => candidate.channelId));
  const fairness = scored
    .filter((candidate) => !adaptiveIds.has(candidate.channelId))
    .sort(oldestFirst)
    .slice(0, Math.min(fairnessSlots, remainingSize));

  // Due fixed schedules run first; adaptive work follows before fairness work.
  return [
    ...manual.slice(0, batchSize).map((candidate) => ({ ...candidate, targetIntervalMs: 0, overdueRatio: Number.POSITIVE_INFINITY, reason: "manual" as const })),
    ...adaptive.map((candidate) => ({ ...candidate, reason: "adaptive" as const })),
    ...fairness.map((candidate) => ({ ...candidate, reason: "fairness" as const })),
  ];
}
