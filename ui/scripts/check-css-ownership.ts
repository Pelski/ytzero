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

const globalSource = await readFile(globalCss, "utf8");
const failures: string[] = [];
if (globalSource.split("\n").length > 250) failures.push("src/styles.css exceeds 250 lines");
if (forbiddenGlobal.test(globalSource)) failures.push("src/styles.css contains a component or page selector");

const files = await cssFiles(join(root, "src"));
const seenKeyframes = new Map<string, string>();
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/@keyframes\s+([\w-]+)/g)) {
    const previous = seenKeyframes.get(match[1]);
    if (previous) failures.push(`duplicate @keyframes ${match[1]}: ${relative(root, previous)} and ${relative(root, file)}`);
    else seenKeyframes.set(match[1], file);
  }
}

if (failures.length) {
  console.error("CSS ownership check failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
