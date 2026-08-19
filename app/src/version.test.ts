import { describe, expect, test } from "bun:test";
import { canonicalVersionKey, compareVersions, isReleaseNewer, pickBuildCommit, pickBuildVersion } from "./version";

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

describe("build version resolution", () => {
  test("prefers the stamped file over the environment", () => {
    expect(pickBuildVersion("2026.08.1\n", "edge")).toBe("2026.08.1");
    expect(pickBuildVersion("edge\n", undefined)).toBe("edge");
  });

  test("falls back to the environment when the file is missing or blank", () => {
    expect(pickBuildVersion(null, "2026.08.1")).toBe("2026.08.1");
    expect(pickBuildVersion("", "2026.08.1")).toBe("2026.08.1");
    expect(pickBuildVersion("  \n", "2026.08.1")).toBe("2026.08.1");
  });

  test("reports a development build when neither source is set", () => {
    expect(pickBuildVersion(null, undefined)).toBe("dev");
    expect(pickBuildVersion(null, "")).toBe("dev");
  });
});

describe("build commit resolution", () => {
  const head = "a".repeat(40);
  const never = () => {
    throw new Error("git must not be consulted once a commit is baked in");
  };

  test("prefers the stamped file, then the environment", () => {
    expect(pickBuildCommit("330100e\n", "519e1e6", never)).toBe("330100e");
    expect(pickBuildCommit(null, "519e1e6", never)).toBe("519e1e6");
  });

  test("falls back to git for an unstamped checkout", () => {
    expect(pickBuildCommit(null, undefined, () => `${head}\n`)).toBe(head);
  });

  test("ignores values that are not commit hashes", () => {
    expect(pickBuildCommit("", "unknown", () => "330100e")).toBe("330100e");
    expect(pickBuildCommit("not-a-hash", undefined, () => "330100e")).toBe("330100e");
    expect(pickBuildCommit("330100", undefined, () => "330100e")).toBe("330100e");
  });

  test("reports an unknown commit when no source has one", () => {
    expect(pickBuildCommit(null, undefined, () => null)).toBe("unknown");
    expect(pickBuildCommit(null, "unknown", () => "fatal: not a git repository")).toBe("unknown");
  });
});
