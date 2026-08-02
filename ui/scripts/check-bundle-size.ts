import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const assetsDirectory = resolve(import.meta.dir, "../dist/assets");
const assets = await readdir(assetsDirectory);

const budgets: Array<{ pattern: RegExp; maximumBytes: number; label: string }> = [
  { pattern: /^index-.*\.js$/, maximumBytes: 550_000, label: "initial JavaScript" },
  { pattern: /^SettingsPage-.*\.js$/, maximumBytes: 150_000, label: "settings route" },
  { pattern: /^WatchPage-.*\.js$/, maximumBytes: 150_000, label: "watch route" },
  { pattern: /^hls-.*\.js$/, maximumBytes: 550_000, label: "lazy HLS runtime" },
  { pattern: /^EmojiCatalog-.*\.js$/, maximumBytes: 330_000, label: "lazy emoji catalog" },
  { pattern: /^index-.*\.css$/, maximumBytes: 100_000, label: "initial CSS" },
];

const failures: string[] = [];
for (const budget of budgets) {
  const matches = assets.filter((asset) => budget.pattern.test(asset));
  if (matches.length !== 1) {
    failures.push(`${budget.label}: expected one matching asset, found ${matches.length}`);
    continue;
  }
  const bytes = (await stat(resolve(assetsDirectory, matches[0]))).size;
  if (bytes > budget.maximumBytes) {
    failures.push(`${budget.label}: ${bytes} bytes exceeds ${budget.maximumBytes}`);
  }
}

if (failures.length > 0) {
  console.error("UI bundle budget failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
