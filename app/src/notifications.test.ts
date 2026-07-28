import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-notifications-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/notificationsHarness.ts"], {
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
  if (exitCode !== 0) throw new Error(`Notifications harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Notifications harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("download failure notifications", () => {
  test("notifies adult profiles once per download cycle and skips children", () => {
    expect(result.firstCreated).toBe(1);
    expect(result.duplicateCreated).toBe(0);
    expect(result.firstRows).toHaveLength(1);
    expect(result.firstRows[0].user_id).toBe(1);
    expect(result.firstRows[0].kind).toBe("download_failed");
    expect(result.firstRows[0].target).toBe("/downloads");
    expect(JSON.parse(result.firstRows[0].payload).videoTitle).toBe("Failed video");
    expect(result.nextCycleCreated).toBe(1);
    expect(result.finalCount).toBe(2);
  });
});
