import { describe, expect, test } from "bun:test";
import { currentBuildTag, notesFromCompare } from "./generate-changelog";

describe("bundled changelog generation", () => {
  test("uses the release tag supplied by tag CI even without git metadata", () => {
    expect(currentBuildTag("v0.15.0", null)).toBe("v0.15.0");
    expect(currentBuildTag("edge", null)).toBeNull();
    expect(currentBuildTag(undefined, "v0.15.0")).toBe("v0.15.0");
  });

  test("turns compared non-merge commits into release-note lines", () => {
    expect(notesFromCompare({ commits: [
      { sha: "1234567890", parents: [{}], commit: { message: "Fix current changelog\n\nDetails" } },
      { sha: "abcdef0123", parents: [{}, {}], commit: { message: "Merge branch" } },
    ] })).toEqual(["Fix current changelog (`1234567`)"]);
  });
});
