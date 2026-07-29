import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-recommendations-routes-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/recommendationsHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: resolve(root, "db", "source.db"),
      AVATAR_DIR: resolve(root, "avatars"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Recommendations harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Recommendations harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("recommendations route", () => {
  test("returns the feed contract without exposing per-video ranking metadata", () => {
    expect(result.fullStatus).toBe(200);
    expect(result.ids.length).toBeGreaterThan(1);
    expect(result.leaksRankingMetadata).toBe(false);
    expect(result.everyRegular).toBe(true);
    expect(result.externalEnabled).toBe(false);
  });

  test("strictly excludes shorts, live formats, private, completed and incomplete videos", () => {
    for (const excluded of [
      "rec-completed", "rec-near-complete", "rec-short", "rec-unknown-short",
      "rec-live", "rec-upcoming", "rec-was-live", "rec-private", "rec-incomplete",
    ]) expect(result.ids).not.toContain(excluded);
    expect(result.ids).toContain("rec-partial");
  });

  test("isolates the active profile's candidate pool", () => {
    expect(result.ids).not.toContain("rec-other-profile");
    expect(result.ids).not.toContain("rec-unowned");
  });

  test("paginates a stable diversified ranking", () => {
    expect(result.firstStatus).toBe(200);
    expect(result.secondStatus).toBe(200);
    expect(result.firstHasMore).toBe(true);
    expect(result.firstId).toBe(result.firstRepeatId);
    expect(result.secondId).not.toBe(result.firstId);
  });

  test("summarizes current-hour Pulse signals without reasons attached to films", () => {
    expect(result.summary.watch_count).toBe(2);
    expect(result.summary.partial_count).toBe(1);
    expect(result.summary.current_hour).toBeGreaterThanOrEqual(0);
    expect(result.summary.current_hour).toBeLessThan(24);
    expect(result.summary.top_channels).toContainEqual(expect.objectContaining({ channel_id: "UC-rec-a", seconds: 900 }));
    expect(result.summary.top_tags).toContainEqual(expect.objectContaining({ id: expect.any(Number), name: "Engineering", seconds: 900 }));
    expect(result.summary.based_on).toEqual(expect.arrayContaining(["watch_history", "channels", "tags", "time_of_day", "unfinished"]));
  });

  test("keeps core local recommendations available for child profiles and honors downloads-only", () => {
    expect(result.childStatus).toBe(200);
    expect(result.childEnabled).toBe(true);
    expect(result.childIds.length).toBeGreaterThan(0);
    expect(result.downloadsOnlyBefore).toEqual([]);
    expect(result.downloadsOnlyAfter).toContain("rec-fresh-b");
  });
});
