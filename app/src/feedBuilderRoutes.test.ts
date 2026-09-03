import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-feed-builder-routes-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/feedBuilderHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), AVATAR_DIR: resolve(root, "avatars") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`Feed builder harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Feed builder harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("feed builder routes", () => {
  test("keeps classic mode by default and protects concurrent writes", () => {
    expect(result.defaultMode).toBe("classic");
    expect(result.saveStatus).toBe(200);
    expect(result.savedRevision).toBe(1);
    expect(result.conflictStatus).toBe(409);
  });

  test("exposes stable source options and row-aware preview", () => {
    expect(result.optionHasTag).toBe(true);
    expect(result.previewCount).toBe(12);
    expect(result.previewCanFill).toBe(true);
  });

  test("places sections by full rows and never repeats videos across pages", () => {
    expect(result.firstTypes.slice(0, 4)).toEqual(["standard-row", "continue", "standard-row", "recipe-row"]);
    expect(result.firstRowLengths.every((length: number) => length === 3)).toBe(true);
    expect(result.firstRecipeTitle).toBe("Builder picks");
    expect(result.continueId).toBe("builder0045");
    expect(result.uniqueAcrossPages).toBe(true);
  });

  test("keeps randomization stable and page requests idempotent", () => {
    expect(result.stableSeed).toBe("stable-seed");
    expect(result.secondStatus).toBe(200);
    expect(result.idempotentSecond).toBe(true);
  });

  test("handles non-object request bodies without server errors", () => {
    expect(result.nullBodyStatuses).toEqual([200, 200, 400]);
  });
});
