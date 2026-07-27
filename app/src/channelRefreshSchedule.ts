import { addCalendarDays, storedUtcTimestampMs, zonedDateTimeParts, zonedDateTimeToUtc } from "./timeZone";

export interface ManualRefreshSchedule {
  days: number[];
  time: string;
}

export function parseManualRefreshSchedule(daysJson: string | null | undefined, time: string | null | undefined): ManualRefreshSchedule | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  try {
    const days = [...new Set((JSON.parse(daysJson ?? "[]") as unknown[]).filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6))].sort();
    return days.length > 0 ? { days, time } : null;
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

function occurrence(schedule: ManualRefreshSchedule, day: string, timeZone: string) {
  const [hour, minute] = schedule.time.split(":").map(Number);
  return zonedDateTimeToUtc(day, hour, minute, 0, timeZone).getTime();
}

export function latestScheduleOccurrenceMs(schedule: ManualRefreshSchedule, nowMs: number, timeZone: string): number | null {
  const today = localDay(new Date(nowMs), timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = addCalendarDays(today, -offset);
    if (!schedule.days.includes(weekday(day))) continue;
    const at = occurrence(schedule, day, timeZone);
    if (at <= nowMs) return at;
  }
  return null;
}

export function nextScheduleOccurrenceMs(schedule: ManualRefreshSchedule, nowMs: number, timeZone: string): number {
  const today = localDay(new Date(nowMs), timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = addCalendarDays(today, offset);
    if (!schedule.days.includes(weekday(day))) continue;
    const at = occurrence(schedule, day, timeZone);
    if (at > nowMs) return at;
  }
  throw new Error("manual refresh schedule has no next occurrence");
}

export function manualScheduleIsDue(schedule: ManualRefreshSchedule, lastAttemptedAt: string | null, nowMs: number, timeZone: string): boolean {
  const latest = latestScheduleOccurrenceMs(schedule, nowMs, timeZone);
  if (latest === null) return false;
  const attempted = lastAttemptedAt ? storedUtcTimestampMs(lastAttemptedAt) : Number.NEGATIVE_INFINITY;
  return !Number.isFinite(attempted) || attempted < latest;
}
