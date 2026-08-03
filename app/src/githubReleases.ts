import { canonicalVersionKey, compareVersions, isReleaseNewer } from "./version";

export interface GitHubReleaseSummary {
  version: string;
  name: string;
  publishedAt: string;
  url: string;
  notes: string[];
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

export function releaseNotesFromBody(body: unknown): string[] {
  if (typeof body !== "string") return [];
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ""));
}

export function parseGitHubReleases(value: unknown): GitHubReleaseSummary[] {
  if (!Array.isArray(value)) return [];
  const seenVersions = new Set<string>();
  const releases = value
    .filter((release): release is GitHubRelease => (
      typeof release === "object"
      && release !== null
      && release.draft !== true
      && release.prerelease !== true
      && typeof release.tag_name === "string"
    ))
    .filter((release) => {
      const key = canonicalVersionKey(release.tag_name as string);
      if (key === null || seenVersions.has(key)) return false;
      seenVersions.add(key);
      return true;
    })
    .map((release) => ({
      version: release.tag_name as string,
      name: typeof release.name === "string" && release.name ? release.name : release.tag_name as string,
      publishedAt: typeof release.published_at === "string" ? release.published_at : "",
      url: typeof release.html_url === "string" ? release.html_url : "https://github.com/Pelski/ytzero/releases",
      notes: releaseNotesFromBody(release.body),
    }));

  return releases.sort((left, right) => compareVersions(right.version, left.version) ?? 0);
}

export function releasesNewerThan(currentVersion: string, releases: GitHubReleaseSummary[]) {
  return releases.filter((release) => isReleaseNewer(currentVersion, release.version) === true);
}
