import { addCalendarDays, configuredTimeZone, utcSqlTimestamp, zonedDateTimeToUtc, zonedDayHour } from "./timeZone";

export const SCHEDULE_BUCKETS = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"] as const;

export function computeShowFrom(bucket: string, now = new Date(), timeZone = configuredTimeZone()): string {
  const local = zonedDayHour(now, timeZone);
  let targetDay = local.day;
  let targetHour: number | null = null;

  if (bucket === "today") return utcSqlTimestamp(now);
  if (bucket === "tonight") {
    if (local.hour >= 19) return utcSqlTimestamp(now);
    targetHour = 19;
  } else if (bucket === "tomorrow") {
    targetDay = addCalendarDays(local.day, 1);
    targetHour = 6;
  } else if (bucket === "tomorrow_evening") {
    targetDay = addCalendarDays(local.day, 1);
    targetHour = 19;
  } else if (bucket === "weekend") {
    const weekday = new Date(`${local.day}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) return utcSqlTimestamp(now);
    targetDay = addCalendarDays(local.day, 6 - weekday);
    targetHour = 0;
  }

  return targetHour == null
    ? utcSqlTimestamp(now)
    : utcSqlTimestamp(zonedDateTimeToUtc(targetDay, targetHour, 0, 0, timeZone));
}
