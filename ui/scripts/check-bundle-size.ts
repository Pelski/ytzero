import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const assetsDirectory = resolve(import.meta.dir, "../dist/assets");
const assets = await readdir(assetsDirectory);

const budgets: Array<{ pattern: RegExp; maximumBytes: number; label: string }> = [
  // Route-level splitting is intentionally disabled until shared component
  // styles have been moved out of page stylesheets. Splitting the routes first
  // changes CSS availability and breaks cards on the feed even though the
  // TypeScript build succeeds. HLS and the emoji catalogue remain safely lazy.
  { pattern: /^index-.*\.js$/, maximumBytes: 1_050_000, label: "initial JavaScript" },
  { pattern: /^hls-.*\.js$/, maximumBytes: 550_000, label: "lazy HLS runtime" },
  { pattern: /^EmojiCatalog-.*\.js$/, maximumBytes: 330_000, label: "lazy emoji catalog" },
  { pattern: /^index-.*\.css$/, maximumBytes: 280_000, label: "initial CSS" },
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
