import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DocsLink {
  title: string;
  slug: string;
}

export interface DocsGroup {
  title: string;
  links: DocsLink[];
}

const wikiDirectory = `${resolve(process.cwd(), "../wiki")}/`;
const sidebar = readFileSync(`${wikiDirectory}_Sidebar.md`, "utf8");
const homeMatch = sidebar.match(/^###\s+\[([^\]]+)\]\(([^)]+)\)/m);

export const docsHome: DocsLink = {
  title: homeMatch?.[1] ?? "YT Zero",
  slug: homeMatch?.[2] ?? "Home",
};

export const docsNavigation: DocsGroup[] = [];
let currentGroup: DocsGroup | undefined;

for (const line of sidebar.split("\n")) {
  const groupMatch = line.match(/^\*\*([^*]+)\*\*$/);
  if (groupMatch) {
    currentGroup = { title: groupMatch[1], links: [] };
    docsNavigation.push(currentGroup);
    continue;
  }

  const linkMatch = line.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)$/);
  if (linkMatch && currentGroup) {
    currentGroup.links.push({ title: linkMatch[1], slug: linkMatch[2] });
  }
}

export const docsLinks = [docsHome, ...docsNavigation.flatMap((group) => group.links)];

export function docsTitle(slug: string) {
  if (slug === docsHome.slug) return "YT Zero documentation";
  return docsLinks.find((link) => link.slug === slug)?.title ?? slug.replaceAll("-", " ");
}

export function docsNeighbors(slug: string) {
  const index = docsLinks.findIndex((link) => link.slug === slug);
  return {
    previous: index > 0 ? docsLinks[index - 1] : undefined,
    next: index >= 0 && index < docsLinks.length - 1 ? docsLinks[index + 1] : undefined,
  };
}

function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#|~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const docsSearchIndex = docsLinks.map((link) => ({
  ...link,
  content: plainText(readFileSync(`${wikiDirectory}${link.slug}.md`, "utf8")),
}));
