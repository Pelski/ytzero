export const DEFAULT_TIME_ZONE = "UTC";

let timeZoneProvider: () => string = () => DEFAULT_TIME_ZONE;

export function configureTimeZoneProvider(provider: () => string) {
  timeZoneProvider = provider;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** A valid TZ environment value is an operator-owned, machine-bound override. */
export function environmentTimeZone(): string | null {
  const value = process.env.TZ?.trim();
  return isValidTimeZone(value) ? value : null;
}

export function timeZoneIsEnvironmentLocked(): boolean {
  return environmentTimeZone() !== null;
}

export function configuredTimeZone(): string {
  let value = DEFAULT_TIME_ZONE;
  try { value = timeZoneProvider(); } catch {}
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

type ZonedParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  fractionalSecond: string;
  timeZoneName: string;
};

function partsInTimeZone(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    timeZoneName: "longOffset",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as ZonedParts;
}

export function zonedDayHour(date = new Date(), timeZone = configuredTimeZone()) {
  const parts = partsInTimeZone(date, timeZone);
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

export function zonedDateTimeParts(date = new Date(), timeZone = configuredTimeZone()) {
  const parts = partsInTimeZone(date, timeZone);
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    millisecond: Number(parts.fractionalSecond),
  };
}

export function formatZonedTimestamp(date = new Date(), timeZone = configuredTimeZone()): string {
  const parts = partsInTimeZone(date, timeZone);
  const rawOffset = parts.timeZoneName.replace("GMT", "");
  const offset = rawOffset === "" || rawOffset === "+00:00" || rawOffset === "-00:00" ? "Z" : rawOffset;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}${offset}`;
}

export function addCalendarDays(day: string, offsetDays: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/** Convert a wall-clock time in an IANA zone to its UTC instant. */
export function zonedDateTimeToUtc(
  day: string,
  hour: number,
  minute = 0,
  second = 0,
  timeZone = configuredTimeZone(),
): Date {
  const [year, month, date] = day.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, date, hour, minute, second);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = partsInTimeZone(new Date(guess), timeZone);
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const correction = desired - represented;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

export function utcSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function storedUtcTimestampMs(value: string): number {
  const normalized = value.trim().replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(normalized) ? normalized : `${normalized}Z`);
}

export function shiftCalendarInTimeZone(
  date: Date,
  amount: number,
  unit: "days" | "weeks" | "months" | "years",
  timeZone = configuredTimeZone(),
): Date {
  const parts = zonedDateTimeParts(date, timeZone);
  const wall = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  if (unit === "days") wall.setUTCDate(wall.getUTCDate() + amount);
  else if (unit === "weeks") wall.setUTCDate(wall.getUTCDate() + amount * 7);
  else if (unit === "months") wall.setUTCMonth(wall.getUTCMonth() + amount);
  else wall.setUTCFullYear(wall.getUTCFullYear() + amount);
  const targetDay = wall.toISOString().slice(0, 10);
  const shifted = zonedDateTimeToUtc(targetDay, wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), timeZone);
  shifted.setUTCMilliseconds(parts.millisecond);
  return shifted;
}
