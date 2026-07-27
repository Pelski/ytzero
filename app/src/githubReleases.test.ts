import { describe, expect, test } from "bun:test";
import { parseGitHubReleases, releasesNewerThan } from "./githubReleases";

describe("GitHub update releases", () => {
  const releases = parseGitHubReleases([
    { tag_name: "v1.2.0", name: "Blue", body: "## Changes\n- First change\n* Second change", published_at: "2026-07-27T10:00:00Z", html_url: "https://example.test/v1.2.0" },
    { tag_name: "v1.1.0", body: "- Older change" },
    { tag_name: "v1.3.0-rc.1", prerelease: true, body: "- Hidden" },
    { tag_name: "v2.0.0", draft: true, body: "- Hidden" },
  ]);

  test("parses stable release notes and ignores drafts and prereleases", () => {
    expect(releases).toHaveLength(2);
    expect(releases[0]).toMatchObject({ version: "v1.2.0", name: "Blue", notes: ["First change", "Second change"] });
  });

  test("returns every release newer than the installed version", () => {
    expect(releasesNewerThan("v1.0.0", releases).map((release) => release.version)).toEqual(["v1.2.0", "v1.1.0"]);
    expect(releasesNewerThan("v1.2.0", releases)).toEqual([]);
  });
});
