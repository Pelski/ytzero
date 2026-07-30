import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-feed-import-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/feedImportHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Feed/import harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Feed/import harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("watched Takeout videos and the feed", () => {
  test("archives imported history and clears scheduling state", () => {
    expect(result.imported).toEqual({ historyAdded: 1, watchedMarked: 1 });
    expect(result.importedState).toEqual({
      status: "archived",
      watched: 1,
      bucket: null,
      queued_at: null,
      show_from: null,
    });
    expect(result.importedHistoryRows).toBe(1);
  });

  test("excludes watched videos already stored as inbox records", () => {
    expect(result.feedIds).toEqual(["feed-new-01"]);
    expect(result.showAllFeedIds).toEqual(["feed-new-01"]);
  });
});
