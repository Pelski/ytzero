import { describe, expect, test } from "bun:test";
import { addCalendarDays, formatZonedTimestamp, isValidTimeZone, zonedDateTimeToUtc, zonedDayHour } from "./timeZone";

describe("configured timezone", () => {
  test("validates IANA timezone names", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("not/a-timezone")).toBe(false);
  });

  test("formats timestamps with the timezone's DST offset", () => {
    expect(formatZonedTimestamp(new Date("2026-07-26T13:02:45.883Z"), "Europe/London"))
      .toBe("2026-07-26T14:02:45.883+01:00");
    expect(formatZonedTimestamp(new Date("2026-12-26T13:02:45.883Z"), "Europe/London"))
      .toBe("2026-12-26T13:02:45.883Z");
  });

  test("derives the local analytics day and hour across midnight", () => {
    expect(zonedDayHour(new Date("2026-07-26T23:30:00.000Z"), "Europe/Warsaw"))
      .toEqual({ day: "2026-07-27", hour: 1 });
  });

  test("adds calendar days without DST arithmetic", () => {
    expect(addCalendarDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  test("converts configured local midnight to the correct UTC boundary", () => {
    expect(zonedDateTimeToUtc("2026-07-26", 0, 0, 0, "Europe/London").toISOString())
      .toBe("2026-07-25T23:00:00.000Z");
  });
});
