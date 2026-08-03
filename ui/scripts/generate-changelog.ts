import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { compareReleaseVersions, isReleaseVersion, releaseVersionKey } from "../src/releaseVersion";

export interface ReleaseEntry {
  version: string;
  name: string;
  publishedAt: string;
  url: string;
  notes: string[];
  current?: boolean;
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

interface GitHubCompare {
  commits?: Array<{
    sha?: unknown;
    parents?: unknown[];
    commit?: { message?: unknown; committer?: { date?: unknown } };
  }>;
}

const outputPath = resolve(import.meta.dir, "../public/changelog.json");
const repositoryPath = resolve(import.meta.dir, "../..");
const CHANGELOG_RELEASE_LIMIT = 10;
const releasesUrl = `https://api.github.com/repos/Pelski/ytzero/releases?per_page=${CHANGELOG_RELEASE_LIMIT}`;

export function notesFromBody(body: unknown): string[] {
  if (typeof body !== "string") return [];
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ""));
}

export function notesFromCompare(value: unknown): string[] {
  const commits = (value as GitHubCompare | null)?.commits;
  if (!Array.isArray(commits)) return [];
  return commits
    .filter((commit) => !Array.isArray(commit.parents) || commit.parents.length <= 1)
    .map((commit) => {
      const subject = typeof commit.commit?.message === "string" ? commit.commit.message.split("\n", 1)[0].trim() : "";
      const sha = typeof commit.sha === "string" ? commit.sha.slice(0, 7) : "";
      return subject ? `${subject}${sha ? ` (\`${sha}\`)` : ""}` : "";
    })
    .filter(Boolean);
}

function runGit(args: string[]): string | null {
  try {
    const result = Bun.spawnSync(["git", ...args], { cwd: repositoryPath });
    return result.success ? result.stdout.toString().trim() : null;
  } catch {
    // The UI Docker build intentionally contains neither git nor the .git
    // directory. Release metadata from the repository is only an optional
    // enhancement; the GitHub release list remains the changelog source.
    return null;
  }
}

export function currentBuildTag(environmentVersion: string | undefined, exactGitTag: string | null): string | null {
  return [environmentVersion, exactGitTag].find((candidate): candidate is string =>
    typeof candidate === "string" && isReleaseVersion(candidate)
  ) ?? null;
}

export function sortAndDedupeReleases(releases: ReleaseEntry[]): ReleaseEntry[] {
  const seen = new Set<string>();
  return releases
    .filter((release) => release && typeof release.version === "string" && isReleaseVersion(release.version))
    .sort((left, right) => -(compareReleaseVersions(left.version, right.version) ?? 0))
    .filter((release) => {
      const key = releaseVersionKey(release.version);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function releaseFromCurrentTag(tag: string, previousVersion: string | undefined, headers: Record<string, string>): Promise<ReleaseEntry> {
  const previous = runGit(["describe", "--tags", "--abbrev=0", `${tag}^`]) ?? previousVersion ?? "";
  const range = previous ? `${previous}..${tag}` : tag;
  const log = runGit(["log", "--no-merges", "--pretty=format:%s (`%h`)", range]);
  let notes = log ? log.split("\n").map((line) => line.trim()).filter(Boolean) : [];
  let publishedAt = runGit(["show", "-s", "--format=%cI", tag]) ?? "";

  // Docker builds intentionally exclude .git. The tag ref already exists when
  // tag CI starts, even though the GitHub Release may still be publishing, so
  // compare it with the latest previously published release.
  if (notes.length === 0 && previous) {
    try {
      const compareUrl = `https://api.github.com/repos/Pelski/ytzero/compare/${encodeURIComponent(previous)}...${encodeURIComponent(tag)}`;
      const response = await fetch(compareUrl, { headers });
      if (!response.ok) throw new Error(`GitHub compare API returned ${response.status}`);
      const compared = await response.json() as GitHubCompare;
      notes = notesFromCompare(compared);
      const lastCommit = compared.commits?.at(-1);
      if (typeof lastCommit?.commit?.committer?.date === "string") publishedAt = lastCommit.commit.committer.date;
    } catch (error) {
      console.warn(`Current changelog notes unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    version: tag,
    name: tag,
    publishedAt,
    url: `https://github.com/Pelski/ytzero/releases/tag/${encodeURIComponent(tag)}`,
    notes,
    current: true,
  };
}

async function cachedReleases(): Promise<ReleaseEntry[]> {
  try {
    const cached = JSON.parse(await readFile(outputPath, "utf8")) as { releases?: unknown };
    return Array.isArray(cached.releases) ? cached.releases as ReleaseEntry[] : [];
  } catch {
    return [];
  }
}

export async function generate() {
  let releases: ReleaseEntry[];
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "YT-Zero-changelog-build",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const response = await fetch(releasesUrl, { headers });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const raw = await response.json() as GitHubRelease[];
    releases = (Array.isArray(raw) ? raw : [])
      .filter((release): release is GitHubRelease & { tag_name: string } => (
        typeof release === "object"
        && release !== null
        && release.draft !== true
        && release.prerelease !== true
        && typeof release.tag_name === "string"
        && isReleaseVersion(release.tag_name)
      ))
      .map((release) => ({
        version: release.tag_name,
        name: typeof release.name === "string" && release.name ? release.name : release.tag_name,
        publishedAt: typeof release.published_at === "string" ? release.published_at : "",
        url: typeof release.html_url === "string" ? release.html_url : "https://github.com/Pelski/ytzero/releases",
        notes: notesFromBody(release.body),
      }));
  } catch (error) {
    releases = sortAndDedupeReleases(await cachedReleases());
    if (releases.length === 0) throw error;
    console.warn(`Changelog refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  releases = sortAndDedupeReleases(releases.map(({ current: _current, ...release }) => release));
  const currentTag = currentBuildTag(process.env.YTZERO_VERSION, runGit(["describe", "--tags", "--exact-match", "HEAD"]));
  if (currentTag) {
    const currentKey = releaseVersionKey(currentTag);
    const existing = releases.find((release) => releaseVersionKey(release.version) === currentKey);
    if (existing) existing.current = true;
    else releases.unshift(await releaseFromCurrentTag(currentTag, releases[0]?.version, headers));
  }
  releases = sortAndDedupeReleases(releases).slice(0, CHANGELOG_RELEASE_LIMIT);
  const content = `${JSON.stringify({ releases }, null, 2)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  const previous = await readFile(outputPath, "utf8").catch(() => "");
  if (previous !== content) await writeFile(outputPath, content);
  console.log(`Bundled ${releases.length} changelog release(s)`);
}

if (import.meta.main) await generate();
