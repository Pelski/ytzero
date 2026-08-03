import { describe, expect, test } from "bun:test";
import type { AppChangelog, UpdateCheck } from "./api";
import { mergeRemoteChangelog } from "./changelog";
import { compareReleaseVersions, isReleaseVersion, releaseVersionKey } from "./releaseVersion";

const baseCheck = {
  currentVersion: "edge", commit: "abcdef0", latestVersion: "2026.08.2", updateAvailable: null,
  checkedAt: "", latestUrl: "", publishedAt: "", availableReleases: [],
} satisfies Omit<UpdateCheck, "releases">;

describe("release version handling", () => {
  test("compares CalVer numerically across sequence, month, and year boundaries", () => {
    expect(compareReleaseVersions("2026.08.10", "2026.08.9")).toBe(1);
    expect(compareReleaseVersions("2026.08.9007199254740993", "2026.08.9007199254740992")).toBe(1);
    expect(compareReleaseVersions("2026.10.1", "2026.09.20")).toBe(1);
    expect(compareReleaseVersions("2027.01.1", "2026.12.40")).toBe(1);
    expect(compareReleaseVersions("2026.08.1", "v0.22.0")).toBe(1);
  });

  test("accepts canonical CalVer and historical 0.x.y versions only", () => {
    expect(isReleaseVersion("2026.08.1")).toBe(true);
    expect(isReleaseVersion("v0.22.0")).toBe(true);
    expect(isReleaseVersion("0.22.0")).toBe(true);
    expect(releaseVersionKey("v0.22.0")).toBe(releaseVersionKey("0.22.0"));

    for (const invalid of [
      "v2026.08.1", "0000.08.1", "2026.8.1", "2026.00.1", "2026.13.1", "2026.08.0",
      "2026.08.01", "2026.08.1-rc.1", "1.2.3", " 2026.08.1",
    ]) {
      expect(isReleaseVersion(invalid)).toBe(false);
      expect(releaseVersionKey(invalid)).toBe(null);
    }
    expect(compareReleaseVersions("not-a-version", "2026.08.1")).toBe(null);
  });
});

describe("remote changelog merge", () => {
  test("marks every API release newer than the latest bundled changelog entry as upcoming on a test build", () => {
    const local: AppChangelog = {
      releases: [
        { version: "v0.11.0", name: "Bundled latest", publishedAt: "", url: "", notes: [] },
        { version: "v0.10.0", name: "Bundled older", publishedAt: "", url: "", notes: [] },
      ],
    };
    const merged = mergeRemoteChangelog(local, {
      ...baseCheck,
      releases: [
        { version: "v0.13.0", name: "Newest remote", publishedAt: "", url: "", notes: [] },
        { version: "v0.12.0", name: "Newer remote", publishedAt: "", url: "", notes: [] },
        { version: "v0.11.0", name: "Shared boundary", publishedAt: "", url: "", notes: [] },
      ],
    });
    expect(merged.releases.find((release) => release.version === "v0.13.0")?.upcoming).toBe(true);
    expect(merged.releases.find((release) => release.version === "v0.12.0")?.upcoming).toBe(true);
    expect(merged.releases.find((release) => release.version === "v0.11.0")?.upcoming).toBe(false);
    expect(merged.releases[0].version).toBe("v0.13.0");
  });

  test("keeps the available-update marker for comparable release builds", () => {
    const local: AppChangelog = { releases: [{ version: "2026.08.9", name: "Current", publishedAt: "", url: "", notes: [] }] };
    const release = { version: "2026.08.10", name: "New", publishedAt: "", url: "", notes: [] };
    const merged = mergeRemoteChangelog(local, {
      ...baseCheck, currentVersion: "2026.08.9", updateAvailable: true, releases: [release], availableReleases: [release],
    });
    expect(merged.releases[0].version).toBe("2026.08.10");
    expect(merged.releases[0].available).toBe(true);
    expect(merged.releases[0].upcoming).toBe(undefined);
  });

  test("sorts, filters, and canonically deduplicates mixed release history", () => {
    const local: AppChangelog = { releases: [
      { version: "2026.08.9", name: "Current", publishedAt: "", url: "", notes: [] },
      { version: "2026.07.20", name: "Earlier month", publishedAt: "", url: "", notes: [] },
      { version: "v0.22.0", name: "Legacy", publishedAt: "", url: "", notes: [] },
      { version: "0.22.0", name: "Duplicate legacy", publishedAt: "", url: "", notes: [] },
      { version: "2026.8.8", name: "Invalid", publishedAt: "", url: "", notes: [] },
    ] };
    const merged = mergeRemoteChangelog(local, { ...baseCheck, releases: [
      { version: "2026.08.10", name: "Next sequence", publishedAt: "", url: "", notes: [] },
      { version: "2027.01.1", name: "Next year", publishedAt: "", url: "", notes: [] },
      { version: "2026.09.1", name: "Next month", publishedAt: "", url: "", notes: [] },
      { version: "0.22.0", name: "Remote legacy wins", publishedAt: "", url: "", notes: [] },
      { version: "2026.09.1-rc.1", name: "Invalid prerelease", publishedAt: "", url: "", notes: [] },
    ] });

    expect(merged.releases.map((release) => release.version).join(",")).toBe(
      "2027.01.1,2026.09.1,2026.08.10,2026.08.9,2026.07.20,0.22.0"
    );
    expect(merged.releases.find((release) => release.version === "2026.08.10")?.upcoming).toBe(true);
    expect(merged.releases.find((release) => release.version === "0.22.0")?.name).toBe("Remote legacy wins");
  });
});
