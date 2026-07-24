// How far back the main feed reaches. Pure date math, no db access — see
// feedQuery.ts for the settings lookup that feeds it.

export const FEED_MAX_AGE_UNITS = ["days", "weeks", "months", "years"] as const;
export type FeedMaxAgeUnit = (typeof FEED_MAX_AGE_UNITS)[number];

/** Guards against a hand-edited setting producing an absurd or negative window. */
const MAX_VALUE = 600;

export function isFeedMaxAgeUnit(value: unknown): value is FeedMaxAgeUnit {
  return typeof value === "string" && (FEED_MAX_AGE_UNITS as readonly string[]).includes(value);
}

/**
 * ISO timestamp of the oldest publication date the feed may show, or null when
 * the limit is off / unusable. Returned in the same format as videos.published_at
 * so it can be compared as a plain string parameter in SQL.
 */
export function feedMaxAgeCutoff(value: unknown, unit: unknown, now: Date = new Date()): string | null {
  if (!isFeedMaxAgeUnit(unit)) return null;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  const n = Math.min(MAX_VALUE, parsed);

  const cutoff = new Date(now);
  if (unit === "days") cutoff.setDate(cutoff.getDate() - n);
  else if (unit === "weeks") cutoff.setDate(cutoff.getDate() - n * 7);
  else if (unit === "months") cutoff.setMonth(cutoff.getMonth() - n);
  else cutoff.setFullYear(cutoff.getFullYear() - n);
  return cutoff.toISOString();
}
