import { describe, expect, test } from "bun:test";
import { feedMaxAgeCutoff, isFeedMaxAgeUnit } from "./feedMaxAge";

const NOW = new Date("2026-07-24T12:00:00.000Z");

describe("feed max-age cutoff", () => {
  test("subtracts days, weeks, months and years", () => {
    expect(feedMaxAgeCutoff(10, "days", NOW, "UTC")).toBe("2026-07-14T12:00:00.000Z");
    expect(feedMaxAgeCutoff(2, "weeks", NOW, "UTC")).toBe("2026-07-10T12:00:00.000Z");
    expect(feedMaxAgeCutoff(6, "months", NOW, "UTC")).toBe("2026-01-24T12:00:00.000Z");
    expect(feedMaxAgeCutoff(1, "years", NOW, "UTC")).toBe("2025-07-24T12:00:00.000Z");
  });

  test("month arithmetic crosses year boundaries", () => {
    expect(feedMaxAgeCutoff(9, "months", NOW, "UTC")).toBe("2025-10-24T12:00:00.000Z");
  });

  test("preserves local wall time across daylight-saving changes", () => {
    expect(feedMaxAgeCutoff(1, "months", new Date("2026-04-24T11:00:00.000Z"), "Europe/London"))
      .toBe("2026-03-24T12:00:00.000Z");
  });

  test("settings arrive as strings and are accepted", () => {
    expect(feedMaxAgeCutoff("6", "months", NOW, "UTC")).toBe(feedMaxAgeCutoff(6, "months", NOW, "UTC"));
  });

  test("off / unknown unit disables the limit", () => {
    expect(feedMaxAgeCutoff(6, "off", NOW)).toBeNull();
    expect(feedMaxAgeCutoff(6, "decades", NOW)).toBeNull();
    expect(feedMaxAgeCutoff(6, undefined, NOW)).toBeNull();
  });

  test("non-positive or unparseable values disable the limit", () => {
    expect(feedMaxAgeCutoff(0, "months", NOW)).toBeNull();
    expect(feedMaxAgeCutoff(-3, "months", NOW)).toBeNull();
    expect(feedMaxAgeCutoff("", "months", NOW)).toBeNull();
    expect(feedMaxAgeCutoff("abc", "months", NOW)).toBeNull();
  });

  test("absurd values are clamped rather than producing a useless date", () => {
    expect(feedMaxAgeCutoff(99999, "years", NOW, "UTC")).toBe(feedMaxAgeCutoff(600, "years", NOW, "UTC"));
  });

  test("isFeedMaxAgeUnit only accepts the four real units", () => {
    expect(isFeedMaxAgeUnit("days")).toBe(true);
    expect(isFeedMaxAgeUnit("years")).toBe(true);
    expect(isFeedMaxAgeUnit("off")).toBe(false);
    expect(isFeedMaxAgeUnit(6)).toBe(false);
  });
});
