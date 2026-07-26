import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-profile-permissions-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/profilePermissionsHarness.ts"], {
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
  if (exitCode !== 0) throw new Error(`Profile permissions harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Profile permissions harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("administrator-only profile permissions", () => {
  test("uses safe defaults and lets administrators bypass restrictions", () => {
    expect(result.enableStatus).toBe(200);
    expect(result.adminLocked).toBe(false);
    expect(result.secondaryLocked).toBe(true);
    expect(result.defaultAreas).toEqual(["channels", "followed_playlists", "imports", "appearance", "feed", "navigation", "playback", "plugins", "profiles"]);
    expect(result.adminSettingsStatus).toBe(200);
    expect(result.restrictedSettingsStatus).toBe(403);
    expect(result.defaultTagStatus).toBe(200);
    expect(result.defaultFilterStatus).toBe(200);
    expect(result.restrictedImportStatus).toBe(403);
  });

  test("does not let a child-lock PIN override administrator permissions", () => {
    expect(result.unlockStatus).toBe(200);
    expect(result.restrictedAfterPinStatus).toBe(403);
  });

  test("delegates disabled areas while retaining the separate PIN gate", () => {
    expect(result.policyStatus).toBe(200);
    expect(result.policyAreas).toEqual(["followed_playlists", "filters", "playlists", "playback"]);
    expect(result.pinLockedSettingsStatus).toBe(423);
    expect(result.delegatedSettingsStatus).toBe(200);
    expect(result.restrictedPlaybackStatus).toBe(403);
    expect(result.restrictedPlaylistStatus).toBe(403);
    expect(result.restrictedFollowedPlaylistStatus).toBe(403);
    expect(result.restrictedFilterStatus).toBe(403);
    expect(result.delegatedProfileStatus).toBe(200);
    expect(result.forbiddenPolicyStatus).toBe(403);
    expect(result.changedPinStatus).toBe(200);
    expect(result.disabledStatus).toBe(200);
  });

  test("keeps advanced diagnostics and backups administrator-only", () => {
    expect(result.forbiddenLogsStatus).toBe(403);
    expect(result.forbiddenExternalStatus).toBe(403);
    expect(result.forbiddenVersionStatus).toBe(403);
    expect(result.forbiddenUpdateCheckStatus).toBe(403);
    expect(result.forbiddenUpdateIntervalStatus).toBe(403);
    expect(result.forbiddenBackupStatus).toBe(403);
    expect(result.adminLogsStatus).toBe(200);
  });
});
