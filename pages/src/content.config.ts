import { defineCollection } from "astro:content";
import { glob, type Loader } from "astro/loaders";
import { z } from "astro/zod";

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

const repository = process.env.GITHUB_REPOSITORY ?? "Pelski/ytzero";
const releasesEndpoint = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repository}/releases`;

function markdownText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s*\([0-9a-f]{7,40}\)\s*$/i, "")
    .replace(/\s+-\s+/g, " — ")
    .replace(/\s+/g, " ")
    .trim();
}

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ytzero-pages",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function releaseChanges(body: string) {
  return [...body.matchAll(/^[-*]\s+(.+)$/gm)].map((match) => markdownText(match[1]));
}

function normalizeReleaseMarkdown(body: string) {
  return body.replace(
    /\[\[([^\]]+)\]\((https?:\/\/[^)]+)\)\]\(\[[^\]]+\]\((https?:\/\/[^)]+)\)\)/g,
    "[$1]($2)",
  );
}

function releaseTitle(release: GitHubRelease, body: string) {
  const explicitTitle = body.match(/<!--\s*changelog-title:\s*([^]*?)-->/i)?.[1]?.trim();
  if (explicitTitle) return markdownText(explicitTitle);
  if (release.name?.trim() && release.name.trim() !== release.tag_name) {
    return markdownText(release.name.trim().replace(new RegExp(`^${release.tag_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+[—-]\\s+`), ""));
  }
  return releaseChanges(body)[0]?.slice(0, 110) || `YT Zero ${release.tag_name}`;
}

function releaseDescription(body: string, version: string) {
  const explicitSummary = body.match(/<!--\s*changelog-summary:\s*([^]*?)-->/i)?.[1]?.trim();
  if (explicitSummary) return markdownText(explicitSummary);

  const paragraphs = body.split(/\n\s*\n/).map((part) => part.trim());
  const prose = paragraphs.find((part) => part && !part.startsWith("#") && !part.startsWith("-") && !part.startsWith("[") && !part.startsWith("<!--"));
  if (prose) return markdownText(prose).slice(0, 220);

  const changes = releaseChanges(body);
  if (changes[1]) return changes[1].slice(0, 220);

  return `Changes, fixes, and improvements included in YT Zero ${version}.`;
}

const githubReleasesLoader: Loader = {
  name: "github-releases",
  async load({ store, parseData, renderMarkdown, generateDigest, logger }) {
    const headers = githubHeaders();

    const releases: GitHubRelease[] = [];
    for (let page = 1; ; page += 1) {
      const response = await fetch(`${releasesEndpoint}?per_page=100&page=${page}`, { headers });
      if (!response.ok) {
        throw new Error(`GitHub Releases request failed with ${response.status} ${response.statusText}.`);
      }
      const batch = await response.json() as GitHubRelease[];
      releases.push(...batch);
      if (batch.length < 100) break;
    }

    store.clear();
    for (const release of releases) {
      if (release.draft || !release.published_at) continue;

      const body = normalizeReleaseMarkdown(release.body?.trim() || "No release notes were provided.");
      const data = await parseData({
        id: release.tag_name,
        data: {
          title: releaseTitle(release, body),
          description: releaseDescription(body, release.tag_name),
          date: new Date(release.published_at),
          version: release.tag_name,
          category: release.prerelease ? "Preview" : "Release",
          githubUrl: release.html_url,
        },
      });
      const rendered = await renderMarkdown(body);
      store.set({
        id: release.tag_name,
        data,
        body,
        digest: generateDigest(`${release.published_at}:${body}`),
        rendered,
      });
    }

    logger.info(`Loaded ${store.keys().length} published GitHub releases.`);
  },
};

const updates = defineCollection({
  loader: githubReleasesLoader,
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    version: z.string(),
    category: z.enum(["Release", "Preview"]),
    githubUrl: z.url(),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
  }),
});

const docs = defineCollection({
  loader: glob({
    base: "../wiki",
    pattern: "*.md",
    generateId: ({ entry }) => entry.replace(/\.md$/, ""),
  }),
});

export const collections = { updates, docs };
