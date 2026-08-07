import { configuredTimeZone, zonedDateTimeParts } from "./timeZone";

export type DownloadScheduleSettings = {
  download_schedule_enabled: number;
  download_schedule_days: string;
  download_schedule_start: string;
  download_schedule_end: string;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minuteOfDay(value: string): number | null {
  const match = TIME_RE.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function selectedDays(value: string): Set<number> {
  return new Set(value.split(",").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
}

/** Days identify the day on which a window starts. An overnight Monday window
 * therefore remains open on Tuesday morning until its end time. */
export function downloadScheduleAllowsNow(
  settings: DownloadScheduleSettings,
  now = new Date(),
  timeZone = configuredTimeZone(),
): boolean {
  if (settings.download_schedule_enabled !== 1) return true;
  const days = selectedDays(settings.download_schedule_days);
  const start = minuteOfDay(settings.download_schedule_start);
  const end = minuteOfDay(settings.download_schedule_end);
  if (days.size === 0 || start == null || end == null) return false;

  const parts = zonedDateTimeParts(now, timeZone);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
  const previousWeekday = (weekday + 6) % 7;
  const minute = parts.hour * 60 + parts.minute;

  if (start < end) return days.has(weekday) && minute >= start && minute < end;
  if (start > end) return minute >= start ? days.has(weekday) : minute < end && days.has(previousWeekday);
  return minute >= start ? days.has(weekday) : days.has(previousWeekday);
}
