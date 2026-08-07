import { describe, expect, test } from "bun:test";
import { downloadScheduleAllowsNow, type DownloadScheduleSettings } from "./downloadSchedule";

const schedule = (patch: Partial<DownloadScheduleSettings> = {}): DownloadScheduleSettings => ({
  download_schedule_enabled: 1,
  download_schedule_days: "1,2,3,4,5",
  download_schedule_start: "23:00",
  download_schedule_end: "07:00",
  ...patch,
});

describe("download schedule", () => {
  test("allows an overnight window on its start day and following morning", () => {
    expect(downloadScheduleAllowsNow(schedule(), new Date("2026-08-03T23:30:00Z"), "UTC")).toBe(true);
    expect(downloadScheduleAllowsNow(schedule(), new Date("2026-08-04T06:59:00Z"), "UTC")).toBe(true);
    expect(downloadScheduleAllowsNow(schedule(), new Date("2026-08-04T07:00:00Z"), "UTC")).toBe(false);
  });

  test("uses the configured timezone and selected start weekdays", () => {
    expect(downloadScheduleAllowsNow(schedule({ download_schedule_days: "1" }), new Date("2026-08-03T21:30:00Z"), "Europe/Warsaw")).toBe(true);
    expect(downloadScheduleAllowsNow(schedule({ download_schedule_days: "2" }), new Date("2026-08-03T21:30:00Z"), "Europe/Warsaw")).toBe(false);
  });

  test("allows all times when disabled", () => {
    expect(downloadScheduleAllowsNow(schedule({ download_schedule_enabled: 0 }), new Date("2026-08-02T12:00:00Z"), "UTC")).toBe(true);
  });
});
