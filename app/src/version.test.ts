import { describe, expect, test } from "bun:test";
import { canonicalVersionKey, compareVersions, isReleaseNewer } from "./version";

describe("release version comparison", () => {
  test("compares CalVer counters numerically", () => {
    expect(isReleaseNewer("2026.08.9", "2026.08.10")).toBe(true);
    expect(isReleaseNewer("2026.08.10", "2026.08.10")).toBe(false);
    expect(isReleaseNewer("2026.08.10", "2026.08.9")).toBe(false);
    expect(compareVersions("2026.08.10", "2026.08.9")).toBe(1);
    expect(compareVersions("2026.08.9007199254740993", "2026.08.9007199254740992")).toBe(1);
  });

  test("handles month and year rollovers", () => {
    expect(isReleaseNewer("2026.08.99", "2026.09.1")).toBe(true);
    expect(isReleaseNewer("2026.12.99", "2027.01.1")).toBe(true);
    expect(isReleaseNewer("2027.01.1", "2026.12.99")).toBe(false);
  });

  test("keeps historical 0.x.y releases comparable", () => {
    expect(isReleaseNewer("0.9.0", "v0.9.1")).toBe(true);
    expect(isReleaseNewer("v0.9.1", "0.9.1")).toBe(false);
    expect(canonicalVersionKey("v0.25.3")).toBe("0.25.3");
  });

  test("orders CalVer after every historical release", () => {
    expect(isReleaseNewer("v0.25.3", "2026.08.1")).toBe(true);
    expect(isReleaseNewer("2026.08.1", "v0.25.3")).toBe(false);
    expect(compareVersions("2026.08.1", "v0.25.3")).toBe(1);
  });

  test("rejects non-canonical CalVer labels", () => {
    for (const value of [
      "v2026.08.1",
      "0000.08.1",
      "2026.00.1",
      "2026.13.1",
      "2026.8.1",
      "2026.08.0",
      "2026.08.01",
      "2026.08.1-rc.1",
    ]) {
      expect(canonicalVersionKey(value)).toBeNull();
      expect(isReleaseNewer("2026.07.1", value)).toBeNull();
    }
  });

  test("does not guess for development labels", () => {
    expect(isReleaseNewer("dev", "2026.08.1")).toBeNull();
    expect(isReleaseNewer("edge", "2026.08.1")).toBeNull();
  });
});
