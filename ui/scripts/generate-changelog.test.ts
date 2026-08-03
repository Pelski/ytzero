import { describe, expect, test } from "bun:test";
import { currentBuildTag, notesFromCompare, sortAndDedupeReleases } from "./generate-changelog";

describe("bundled changelog generation", () => {
  test("uses the release tag supplied by tag CI even without git metadata", () => {
    expect(currentBuildTag("2026.08.1", null)).toBe("2026.08.1");
    expect(currentBuildTag("v0.15.0", null)).toBe("v0.15.0");
    expect(currentBuildTag("edge", null)).toBeNull();
    expect(currentBuildTag(undefined, "2026.08.2")).toBe("2026.08.2");
    expect(currentBuildTag("edge", "2026.08.3")).toBe("2026.08.3");
    expect(currentBuildTag("v2026.08.1", null)).toBeNull();
    expect(currentBuildTag("2026.08.0", null)).toBeNull();
    expect(currentBuildTag("2026.08.1-rc.1", null)).toBeNull();
  });

  test("sorts release tags newest-first and removes invalid and canonical duplicates", () => {
    const entry = (version: string, name = version) => ({ version, name, publishedAt: "", url: "", notes: [] });
    const releases = sortAndDedupeReleases([
      entry("2026.08.9"),
      entry("v0.22.0", "Legacy first"),
      entry("2026.09.1"),
      entry("2026.08.10"),
      entry("2027.01.1"),
      entry("0.22.0", "Legacy duplicate"),
      entry("2026.8.1"),
      entry("v2026.08.11"),
      entry("2026.08.12-rc.1"),
    ]);

    expect(releases.map((release) => release.version)).toEqual([
      "2027.01.1", "2026.09.1", "2026.08.10", "2026.08.9", "v0.22.0",
    ]);
    expect(releases.at(-1)?.name).toBe("Legacy first");
  });

  test("turns compared non-merge commits into release-note lines", () => {
    expect(notesFromCompare({ commits: [
      { sha: "1234567890", parents: [{}], commit: { message: "Fix current changelog\n\nDetails" } },
      { sha: "abcdef0123", parents: [{}, {}], commit: { message: "Merge branch" } },
    ] })).toEqual(["Fix current changelog (`1234567`)"]);
  });
});
