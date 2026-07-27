import { describe, expect, test } from "bun:test";
import { latestScheduleOccurrenceMs, manualScheduleIsDue, nextScheduleOccurrenceMs, parseManualRefreshSchedule } from "./channelRefreshSchedule";

describe("manual channel refresh schedules", () => {
  const schedule = { days: [1, 3], time: "18:02" }; // Monday and Wednesday

  test("parses and validates stored values", () => {
    expect(parseManualRefreshSchedule("[3,1,3]", "18:02")).toEqual(schedule);
    expect(parseManualRefreshSchedule("[1]", "25:00")).toBeNull();
    expect(parseManualRefreshSchedule("[]", "18:02")).toBeNull();
  });

  test("finds occurrences in the configured timezone", () => {
    const now = Date.parse("2026-07-27T18:00:00Z"); // Monday 20:00 in Warsaw
    expect(new Date(latestScheduleOccurrenceMs(schedule, now, "Europe/Warsaw")!).toISOString()).toBe("2026-07-27T16:02:00.000Z");
    expect(new Date(nextScheduleOccurrenceMs(schedule, now, "Europe/Warsaw")).toISOString()).toBe("2026-07-29T16:02:00.000Z");
  });

  test("becomes due once per scheduled occurrence", () => {
    const now = Date.parse("2026-07-27T16:03:00Z");
    expect(manualScheduleIsDue(schedule, "2026-07-27 16:01:00", now, "Europe/Warsaw")).toBe(true);
    expect(manualScheduleIsDue(schedule, "2026-07-27 16:02:05", now, "Europe/Warsaw")).toBe(false);
  });
});
