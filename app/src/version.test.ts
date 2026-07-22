import { describe, expect, test } from "bun:test";
import { isReleaseNewer } from "./version";

describe("release version comparison", () => {
  test("compares semantic versions", () => {
    expect(isReleaseNewer("0.9.0", "v0.9.1")).toBe(true);
    expect(isReleaseNewer("v0.9.1", "v0.9.1")).toBe(false);
    expect(isReleaseNewer("1.0.0", "v0.9.1")).toBe(false);
  });

  test("treats a stable release as newer than the matching prerelease", () => {
    expect(isReleaseNewer("v1.2.0-rc.1", "v1.2.0")).toBe(true);
  });

  test("does not guess for development labels", () => {
    expect(isReleaseNewer("dev", "v0.9.1")).toBeNull();
    expect(isReleaseNewer("edge", "v0.9.1")).toBeNull();
  });
});
