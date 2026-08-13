import { describe, expect, test } from "bun:test";
import { colonDurationToSeconds, formatWatchTime, resolveShareTimestamp, resolveWatchPlayerTarget } from "./watchRuntime";

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

  test("resolves a share timestamp from the first usable player source", () => {
    expect(resolveShareTimestamp(undefined, () => 0, 83.9, 40)).toBe(83);
    expect(resolveShareTimestamp(() => { throw new Error("player unavailable"); }, 42.8)).toBe(42);
    expect(resolveShareTimestamp(Number.NaN, -4, undefined)).toBe(0);
  });
});

describe("watch player target ownership", () => {
  test("waits for the library row to catch up with a known route", () => {
    expect(resolveWatchPlayerTarget("new-video", "old-video", null)).toBe(null);
    expect(resolveWatchPlayerTarget("new-video", "new-video", null)).toBe("new-video");
  });

  test("keeps one target while an external video is imported", () => {
    expect(resolveWatchPlayerTarget("external", null, "external")).toBe("external");
    expect(resolveWatchPlayerTarget("external", "external", null)).toBe("external");
  });

  test("does not let a missing result from the previous route own the player", () => {
    expect(resolveWatchPlayerTarget("new-video", null, "old-video")).toBe(null);
  });
});
