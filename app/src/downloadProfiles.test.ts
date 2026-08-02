import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-download-profiles-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/downloadProfilesHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), AVATAR_DIR: resolve(root, "avatars"), DOWNLOADS_DIR: resolve(root, "downloads"), DOWNLOAD_COOKIES_DIR: resolve(root, "download-cookies") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(`Download profiles harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`No result:\n${stdout}`);
  result = JSON.parse(line.slice(7));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("profile-scoped downloads", () => {
  test("shows only the active profile unless an administrator requests all", () => {
    expect(result.primaryMine).toEqual(["1:scope-primary", "1:scope-shared"]);
    expect(result.secondaryMine).toEqual([`${result.secondaryId}:scope-secondary`, `${result.secondaryId}:scope-shared`]);
    expect(result.primaryAll).toHaveLength(4);
    expect(result.secondaryAllScope).toBe("mine");
  });

  test("isolates automation rules and profile preferences", () => {
    expect(result.primaryRuleCount).toBe(0);
    expect(result.secondaryRuleCount).toBe(1);
    expect(result.secondaryQualityStatus).toBe(200);
    expect(result.secondaryQuality).toBe("720");
    expect(result.secondaryCompatibleFormat).toBe(1);
    expect(result.primaryCompatibleFormat).toBe(0);
    expect(result.secondaryRetention).toBe(30);
    expect(result.primaryRetention).toBe(14);
    expect(result.secondaryAdminSettingStatus).toBe(403);
    expect(result.secondaryCookies).toBe(true);
    expect(result.primaryCookies).toBe(false);
  });

  test("removing shared ownership does not delete another profile's file", () => {
    expect(result.sharedOwnersAfterDelete).toEqual([{ user_id: 1 }]);
    expect(result.sharedPhysicalAfterDelete).toEqual({ status: "done" });
  });

  test("applies retention per owner without deleting a file retained by another profile", () => {
    expect(result.retentionOwners).toEqual([{ user_id: result.secondaryId }]);
    expect(result.retentionPhysical).toEqual({ status: "done" });
  });
});
