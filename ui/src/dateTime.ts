export const DEFAULT_TIME_ZONE = "UTC";

export function normalizeTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** SQLite timestamps are UTC but omit the timezone suffix. */
export function parseAppTimestamp(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return new Date(`${trimmed}T12:00:00Z`);
  const normalized = trimmed.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(normalized) ? normalized : `${normalized}Z`);
}

export function appDayKey(value: string | number | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(parseAppTimestamp(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCalendarDays(day: string, offsetDays: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function addCalendarYears(day: string, offsetYears: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + offsetYears);
  return date.toISOString().slice(0, 10);
}

export function calendarDayDifference(laterDay: string, earlierDay: string): number {
  return Math.round((Date.parse(`${laterDay}T12:00:00Z`) - Date.parse(`${earlierDay}T12:00:00Z`)) / 86_400_000);
}

export function formatAppDate(
  value: string | number | Date,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: normalizeTimeZone(timeZone) }).format(parseAppTimestamp(value));
}

export function formatAppTime(value: string | number | Date, locale: string, timeZone: string): string {
  return formatAppDate(value, locale, timeZone, { hour: "2-digit", minute: "2-digit" });
}

export function formatAppDateTime(value: string | number | Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: normalizeTimeZone(timeZone), dateStyle: "medium", timeStyle: "medium",
  }).format(parseAppTimestamp(value));
}

/** Format a YYYY-MM-DD domain day without letting browser timezone move it. */
export function formatCalendarDay(day: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
