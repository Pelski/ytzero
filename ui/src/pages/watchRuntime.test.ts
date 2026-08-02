import { describe, expect, test } from "bun:test";
import { colonDurationToSeconds, formatWatchTime } from "./watchRuntime";

describe("watch runtime formatting", () => {
  test("parses YouTube-style clock durations", () => {
    expect(colonDurationToSeconds("15:04")).toBe(904);
    expect(colonDurationToSeconds("1:02:03")).toBe(3723);
  });

  test("rejects malformed durations", () => {
    expect(colonDurationToSeconds(undefined)).toBe(undefined);
    expect(colonDurationToSeconds("90")).toBe(undefined);
    expect(colonDurationToSeconds("1:xx")).toBe(undefined);
  });

  test("formats chapter and segment timestamps", () => {
    expect(formatWatchTime(904.9)).toBe("15:04");
    expect(formatWatchTime(3723)).toBe("1:02:03");
  });
});
