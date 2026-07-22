import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface ReleaseEntry {
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

const outputPath = resolve(import.meta.dir, "../public/changelog.json");
const repositoryPath = resolve(import.meta.dir, "../..");
const CHANGELOG_RELEASE_LIMIT = 10;
const releasesUrl = `https://api.github.com/repos/Pelski/ytzero/releases?per_page=${CHANGELOG_RELEASE_LIMIT}`;

function notesFromBody(body: unknown): string[] {
  if (typeof body !== "string") return [];
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ""));
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

function releaseFromCurrentTag(existingVersions: Set<string>): ReleaseEntry | null {
  const tag = runGit(["describe", "--tags", "--exact-match", "HEAD"]) ?? "";
  if (!/^v\d+\.\d+\.\d+/.test(tag) || existingVersions.has(tag)) return null;

  const previous = runGit(["describe", "--tags", "--abbrev=0", `${tag}^`]) ?? "";
  const range = previous ? `${previous}..${tag}` : tag;
  const log = runGit(["log", "--no-merges", "--pretty=format:%s (`%h`)", range]);
  return {
    version: tag,
    name: tag,
    publishedAt: new Date().toISOString(),
    url: `https://github.com/Pelski/ytzero/releases/tag/${encodeURIComponent(tag)}`,
    notes: log ? log.split("\n").map((line) => line.trim()).filter(Boolean) : [],
  };
}

async function generate() {
  let releases: ReleaseEntry[];
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "YT-Zero-changelog-build",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(releasesUrl, { headers });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const raw = await response.json() as GitHubRelease[];
    releases = (Array.isArray(raw) ? raw : [])
      .filter((release) => release.draft !== true && release.prerelease !== true && typeof release.tag_name === "string")
      .map((release) => ({
        version: release.tag_name as string,
        name: typeof release.name === "string" && release.name ? release.name : release.tag_name as string,
        publishedAt: typeof release.published_at === "string" ? release.published_at : "",
        url: typeof release.html_url === "string" ? release.html_url : "https://github.com/Pelski/ytzero/releases",
        notes: notesFromBody(release.body),
      }));
  } catch (error) {
    try {
      JSON.parse(await readFile(outputPath, "utf8"));
      console.warn(`Changelog refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    } catch {
      throw error;
    }
  }

  const currentTag = releaseFromCurrentTag(new Set(releases.map((release) => release.version)));
  if (currentTag) releases.unshift(currentTag);
  releases = releases.slice(0, CHANGELOG_RELEASE_LIMIT);
  const content = `${JSON.stringify({ releases }, null, 2)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  const previous = await readFile(outputPath, "utf8").catch(() => "");
  if (previous !== content) await writeFile(outputPath, content);
  console.log(`Bundled ${releases.length} changelog release(s)`);
}

await generate();
