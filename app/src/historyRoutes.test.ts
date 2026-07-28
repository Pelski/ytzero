import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-history-routes-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/historyHarness.ts"], {
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
  if (exitCode !== 0) throw new Error(`History harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`History harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("watch history routes", () => {
  test("paginates grouped videos and reports whether another page exists", () => {
    expect(result.firstStatus).toBe(200);
    expect(result.firstCount).toBe(60);
    expect(result.firstHasMore).toBe(true);
    expect(result.secondStatus).toBe(200);
    expect(result.secondCount).toBe(1);
    expect(result.secondHasMore).toBe(false);
    expect(result.invalidPage).toBe(0);
  });

  test("removes every watch of the selected video only for the active profile", () => {
    expect(result.deleteStatus).toBe(200);
    expect(result.primaryRowsAfterDelete).toBe(0);
    expect(result.secondaryRowsAfterDelete).toBe(1);
  });
});
