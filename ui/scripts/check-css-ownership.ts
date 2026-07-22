import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const globalCss = join(root, "src/styles.css");
const forbiddenGlobal = /\.(?:watch|settings|video|profile|dropdown|ui)-[\w-]+|\.(?:layout|sidebar|topbar)\b/;

async function cssFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry);
    return (await stat(path)).isDirectory() ? cssFiles(path) : path.endsWith(".css") ? [path] : [];
  }));
  return paths.flat();
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry);
    return (await stat(path)).isDirectory() ? sourceFiles(path) : path.endsWith(".tsx") ? [path] : [];
  }));
  return paths.flat();
}

const globalSource = await readFile(globalCss, "utf8");
const failures: string[] = [];
if (globalSource.split("\n").length > 250) failures.push("src/styles.css exceeds 250 lines");
if (forbiddenGlobal.test(globalSource)) failures.push("src/styles.css contains a component or page selector");

const files = await cssFiles(join(root, "src"));
const seenKeyframes = new Map<string, string>();
const seenSelectors = new Map<string, string>();
const duplicateSelectors: string[] = [];

function collectSelectors(source: string, file: string) {
  const stack: { atRule?: string; keyframes?: boolean }[] = [];
  let buffer = "";
  for (const character of source.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (character === "{") {
      const header = buffer.trim().replace(/\s+/g, " ");
      buffer = "";
      if (header.startsWith("@")) {
        stack.push({ atRule: header, keyframes: /@(?:-[\w]+-)?keyframes\b/.test(header) });
        continue;
      }
      if (!header || stack.some((entry) => entry.keyframes || entry.atRule)) {
        stack.push({});
        continue;
      }
      const scope = stack.map((entry) => entry.atRule).filter(Boolean).join(" > ");
      const key = `${scope}\u0000${header}`;
      const previous = seenSelectors.get(key);
      if (previous) duplicateSelectors.push(`duplicate selector ${header}: ${relative(root, previous)} and ${relative(root, file)}`);
      else seenSelectors.set(key, file);
      stack.push({});
      continue;
    }
    if (character === "}") {
      stack.pop();
      buffer = "";
      continue;
    }
    buffer += character;
  }
}
for (const file of files) {
  const name = file.split("/").at(-1);
  if (name === "App.css" || name === "DesignSystem.css" || name === "legacy.css") {
    failures.push(`obsolete aggregate stylesheet: ${relative(root, file)}`);
  }
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/@keyframes\s+([\w-]+)/g)) {
    const previous = seenKeyframes.get(match[1]);
    if (previous) failures.push(`duplicate @keyframes ${match[1]}: ${relative(root, previous)} and ${relative(root, file)}`);
    else seenKeyframes.set(match[1], file);
  }
  collectSelectors(source, file);
}

const LEGACY_MARKUP_BASELINE = 0;
const source = await sourceFiles(join(root, "src"));
let legacyMarkupUses = 0;
for (const file of source) {
  const contents = await readFile(file, "utf8");
  for (const line of contents.split("\n")) {
    if (!line.includes("className")) continue;
    legacyMarkupUses += [...line.matchAll(/(?:^|[\s"'`{])(?:btn(?:-ghost)?|icon-only|dropdown(?:-menu)?)(?=$|[\s"'`})])/g)].length;
  }
}
if (legacyMarkupUses > LEGACY_MARKUP_BASELINE) {
  failures.push(`legacy button/menu markup increased to ${legacyMarkupUses} (baseline: ${LEGACY_MARKUP_BASELINE})`);
}

if (failures.length) {
  console.error("CSS ownership check failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
if (duplicateSelectors.length) {
  console.warn(`CSS ownership: ${duplicateSelectors.length} duplicate selectors detected:\n` + duplicateSelectors.map((item) => `- ${item}`).join("\n"));
}
