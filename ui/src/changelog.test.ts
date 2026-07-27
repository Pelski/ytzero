import { describe, expect, test } from "bun:test";
import type { AppChangelog, UpdateCheck } from "./api";
import { mergeRemoteChangelog } from "./changelog";

const baseCheck = {
  currentVersion: "edge", commit: "abcdef0", latestVersion: "v1.2.0", updateAvailable: null,
  checkedAt: "", latestUrl: "", publishedAt: "", availableReleases: [],
} satisfies Omit<UpdateCheck, "releases">;

describe("remote changelog merge", () => {
  test("marks every API release newer than the latest bundled changelog entry as upcoming on a test build", () => {
    const local: AppChangelog = {
      releases: [
        { version: "v1.1.0", name: "Bundled latest", publishedAt: "", url: "", notes: [] },
        { version: "v1.0.0", name: "Bundled older", publishedAt: "", url: "", notes: [] },
      ],
    };
    const merged = mergeRemoteChangelog(local, {
      ...baseCheck,
      releases: [
        { version: "v1.3.0", name: "Newest remote", publishedAt: "", url: "", notes: [] },
        { version: "v1.2.0", name: "Newer remote", publishedAt: "", url: "", notes: [] },
        { version: "v1.1.0", name: "Shared boundary", publishedAt: "", url: "", notes: [] },
      ],
    });
    expect(merged.releases.find((release) => release.version === "v1.3.0")?.upcoming).toBe(true);
    expect(merged.releases.find((release) => release.version === "v1.2.0")?.upcoming).toBe(true);
    expect(merged.releases.find((release) => release.version === "v1.1.0")?.upcoming).toBe(false);
    expect(merged.releases[0].version).toBe("v1.3.0");
  });

  test("keeps the available-update marker for comparable release builds", () => {
    const local: AppChangelog = { releases: [{ version: "v1.1.0", name: "Current", publishedAt: "", url: "", notes: [] }] };
    const release = { version: "v1.2.0", name: "New", publishedAt: "", url: "", notes: [] };
    const merged = mergeRemoteChangelog(local, {
      ...baseCheck, currentVersion: "v1.1.0", updateAvailable: true, releases: [release], availableReleases: [release],
    });
    expect(merged.releases[0].version).toBe("v1.2.0");
    expect(merged.releases[0].available).toBe(true);
    expect(merged.releases[0].upcoming).toBe(undefined);
  });
});
