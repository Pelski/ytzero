import { addCalendarDays, storedUtcTimestampMs, zonedDateTimeParts, zonedDateTimeToUtc } from "./timeZone";

export interface ManualRefreshSchedule {
  days: number[];
  times: string[];
}

const validTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function parseManualRefreshSchedule(daysJson: string | null | undefined, storedTimes: string | null | undefined): ManualRefreshSchedule | null {
  try {
    const days = [...new Set((JSON.parse(daysJson ?? "[]") as unknown[]).filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6))].sort();
    const parsedTimes: unknown = validTime(storedTimes) ? [storedTimes] : JSON.parse(storedTimes ?? "[]");
    const times = Array.isArray(parsedTimes) ? [...new Set(parsedTimes.filter(validTime))].sort() : [];
    return days.length > 0 && times.length > 0 ? { days, times } : null;
  } catch {
    return null;
  }
}

function localDay(date: Date, timeZone: string) {
  const parts = zonedDateTimeParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function weekday(day: string) {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

function occurrence(time: string, day: string, timeZone: string) {
  const [hour, minute] = time.split(":").map(Number);
  return zonedDateTimeToUtc(day, hour, minute, 0, timeZone).getTime();
}

export function latestScheduleOccurrenceMs(schedule: ManualRefreshSchedule, nowMs: number, timeZone: string): number | null {
  const today = localDay(new Date(nowMs), timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = addCalendarDays(today, -offset);
    if (!schedule.days.includes(weekday(day))) continue;
    const latest = schedule.times.map((time) => occurrence(time, day, timeZone)).filter((at) => at <= nowMs).sort((a, b) => b - a)[0];
    if (latest != null) return latest;
  }
  return null;
}

export function nextScheduleOccurrenceMs(schedule: ManualRefreshSchedule, nowMs: number, timeZone: string): number {
  const today = localDay(new Date(nowMs), timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = addCalendarDays(today, offset);
    if (!schedule.days.includes(weekday(day))) continue;
    const next = schedule.times.map((time) => occurrence(time, day, timeZone)).filter((at) => at > nowMs).sort((a, b) => a - b)[0];
    if (next != null) return next;
  }
  throw new Error("manual refresh schedule has no next occurrence");
}

export function manualScheduleIsDue(schedule: ManualRefreshSchedule, lastAttemptedAt: string | null, nowMs: number, timeZone: string): boolean {
  const latest = latestScheduleOccurrenceMs(schedule, nowMs, timeZone);
  if (latest === null) return false;
  const attempted = lastAttemptedAt ? storedUtcTimestampMs(lastAttemptedAt) : Number.NEGATIVE_INFINITY;
  return !Number.isFinite(attempted) || attempted < latest;
}
