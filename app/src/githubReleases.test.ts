import { describe, expect, test } from "bun:test";
import { parseGitHubReleases, releasesNewerThan } from "./githubReleases";

describe("GitHub update releases", () => {
  const releases = parseGitHubReleases([
    { tag_name: "2026.08.9", name: "Nine", body: "## Changes\n- First change\n* Second change", published_at: "2026-08-20T10:00:00Z", html_url: "https://example.test/2026.08.9" },
    { tag_name: "v0.25.3", body: "- Legacy change" },
    { tag_name: "2027.01.1", body: "- Year rollover" },
    { tag_name: "2026.08.10", body: "- Tenth August release" },
    { tag_name: "2026.09.1", body: "- September release" },
    { tag_name: "0.25.3", name: "Duplicate legacy spelling", body: "- Hidden duplicate" },
    { tag_name: "2026.8.1", body: "- Malformed" },
    { tag_name: "2026.13.1", body: "- Malformed" },
    { tag_name: "2026.08.01", body: "- Malformed" },
    { tag_name: "2026.08.11-rc.1", body: "- Malformed" },
    { tag_name: "2027.02.1", prerelease: true, body: "- Hidden" },
    { tag_name: "2027.03.1", draft: true, body: "- Hidden" },
    { name: "Missing tag", body: "- Hidden" },
    null,
    "not a release",
  ]);

  test("filters malformed data, deduplicates canonical versions, and sorts newest first", () => {
    expect(releases.map((release) => release.version)).toEqual([
      "2027.01.1",
      "2026.09.1",
      "2026.08.10",
      "2026.08.9",
      "v0.25.3",
    ]);
    expect(releases.find((release) => release.version === "2026.08.9")).toMatchObject({
      name: "Nine",
      notes: ["First change", "Second change"],
    });
  });

  test("returns every release newer than the installed version", () => {
    expect(releasesNewerThan("2026.08.9", releases).map((release) => release.version)).toEqual([
      "2027.01.1",
      "2026.09.1",
      "2026.08.10",
    ]);
    expect(releasesNewerThan("2027.01.1", releases)).toEqual([]);
    expect(releasesNewerThan("v0.25.3", releases).map((release) => release.version)).toEqual([
      "2027.01.1",
      "2026.09.1",
      "2026.08.10",
      "2026.08.9",
    ]);
  });

  test("returns an empty list for malformed GitHub payloads", () => {
    expect(parseGitHubReleases(null)).toEqual([]);
    expect(parseGitHubReleases({ tag_name: "2026.08.1" })).toEqual([]);
  });
});
