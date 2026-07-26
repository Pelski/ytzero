import { describe, expect, test } from "bun:test";
import { addCalendarDays, appDayKey, calendarDayDifference, formatAppDateTime, parseAppTimestamp } from "./dateTime";

describe("application timezone formatting", () => {
  test("treats timezone-less SQLite timestamps as UTC", () => {
    expect(parseAppTimestamp("2026-07-26 23:30:00").toISOString()).toBe("2026-07-26T23:30:00.000Z");
  });

  test("groups the same instant into the configured local day", () => {
    expect(appDayKey("2026-07-26 23:30:00", "Europe/Warsaw")).toBe("2026-07-27");
    expect(appDayKey("2026-07-26 23:30:00", "America/New_York")).toBe("2026-07-26");
  });

  test("formats independently of the browser timezone", () => {
    expect(formatAppDateTime("2026-07-26T13:02:45.000Z", "en-GB", "Europe/London").includes("14:02:45"))
      .toBe(true);
  });

  test("does calendar arithmetic across month boundaries", () => {
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(calendarDayDifference("2026-03-01", "2026-02-28")).toBe(1);
  });
});
