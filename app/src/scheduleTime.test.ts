import { describe, expect, test } from "bun:test";
import { computeShowFrom } from "./scheduleTime";

describe("timezone-aware scheduling", () => {
  test("stores tonight as the matching UTC instant during DST", () => {
    expect(computeShowFrom("tonight", new Date("2026-07-24T10:00:00Z"), "Europe/London"))
      .toBe("2026-07-24 18:00:00");
  });

  test("uses the configured local calendar for tomorrow", () => {
    expect(computeShowFrom("tomorrow", new Date("2026-07-24T23:30:00Z"), "Europe/Warsaw"))
      .toBe("2026-07-26 04:00:00");
  });

  test("schedules weekday videos for local Saturday midnight", () => {
    expect(computeShowFrom("weekend", new Date("2026-07-22T12:00:00Z"), "America/New_York"))
      .toBe("2026-07-25 04:00:00");
  });

  test("returns now when the selected period is already active", () => {
    expect(computeShowFrom("weekend", new Date("2026-07-25T12:34:56Z"), "Europe/London"))
      .toBe("2026-07-25 12:34:56");
  });
});
