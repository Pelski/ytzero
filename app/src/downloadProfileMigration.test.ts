import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-download-profile-migration-test-"));
const dbPath = resolve(root, "db", "source.db");
let result: Record<string, any> = {};
let restartResult: Record<string, any> = {};

async function phase(name: string) {
  const process = Bun.spawn(["bun", "app/tests/downloadMigrationHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: dbPath,
      MIGRATION_PHASE: name,
      DOWNLOAD_COOKIES_DIR: resolve(root, "download-cookies"),
      LEGACY_DOWNLOAD_COOKIES_FILE: resolve(root, "legacy-cookies.txt"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(`Migration ${name} failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`No migration result:\n${stdout}`);
  return JSON.parse(line.slice(7));
}

async function legacyBootstrapPhase() {
  const legacyPath = resolve(root, "legacy-bootstrap.db");
  const process = Bun.spawn(["bun", "app/tests/downloadLegacyBootstrapHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: legacyPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(`Legacy bootstrap failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`No legacy bootstrap result:\n${stdout}`);
  return JSON.parse(line.slice(7));
}

beforeAll(async () => {
  await phase("seed");
  result = await phase("audit");
  restartResult = await phase("restart");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("legacy downloads migration", () => {
  test("adds the profile column before creating its index on an old database", async () => {
    expect(await legacyBootstrapPhase()).toEqual({ hasUserId: true, hasProfileIndex: true });
  });

  test("assigns old jobs and rules to the primary profile", () => {
    expect(result.owner).toEqual({ user_id: 1, pinned: 1 });
    expect(result.jobOwner).toEqual({ requested_by_user_id: 1 });
    expect(result.ruleOwner).toEqual({ user_id: 1 });
  });

  test("copies old profile preferences while retaining administrator storage settings", () => {
    expect(result.qualities).toEqual([{ user_id: 1, value: "720" }, { user_id: 2, value: "720" }]);
    expect(result.retentions).toEqual([{ user_id: 1, value: "21" }, { user_id: 2, value: "21" }]);
    expect(result.outputTemplate).toEqual({ value: "legacy/{id}" });
    expect(result.cookiesConfigured).toEqual([true, true]);
    expect(result.legacyCookiesRemain).toBe(false);
  });

  test("does not recreate ownership removed after the one-time migration", () => {
    expect(restartResult.ownerAfterRestart).toBeNull();
    expect(restartResult.cookiesConfigured).toEqual([true, false]);
  });
});
