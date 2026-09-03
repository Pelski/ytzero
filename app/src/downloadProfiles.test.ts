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

  test("can queue and pin a download atomically from the watch page", () => {
    expect(result.keepRequestOwner).toEqual({ pinned: 1 });
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

  test("keeps one profile's ownership when another profile's retention expires", () => {
    expect(result.retentionOwners).toEqual([{ user_id: 1 }]);
    expect(result.retentionPhysical).toEqual({ status: "done" });
  });

  test("disables age and watched retention, then restores both rules when turned off", () => {
    expect(result.watchedWhileKept).toEqual({ status: "done" });
    expect(result.watchedAfterKeepDisabled).toEqual({ status: "deleted" });
  });

  test("does not let keep downloads bypass the storage cap, while pins and likes remain protected", () => {
    expect(result.storageCap).toEqual([
      { video_id: "cap-kept", status: "deleted" },
      { video_id: "cap-liked", status: "done" },
      { video_id: "cap-pinned", status: "done" },
    ]);
  });

  test("keeps playlist-protected files until the playlist policy is disabled", () => {
    expect(result.playlistProtected).toEqual({ status: "done" });
    expect(result.playlistUnprotected).toEqual({ status: "deleted" });
    expect(result.playlistLibraryItem.playlist_protected).toBe(1);
    expect(result.playlistLibraryItem.playlists).toEqual([
      { id: expect.any(Number), name: "Repairs", icon: "ListMusic", protects_download: 1 },
    ]);
  });

  test("applies offline policy to future videos added by playlist rules", () => {
    expect(result.ruleOfflineResult).toEqual({
      membership: { present: 1 },
      owner: { present: 1 },
      protection: { present: 1 },
    });
  });

  test("protects and groups downloads owned by followed playlists", () => {
    expect(result.followedPlaylistProtected).toEqual({ status: "done" });
    expect(result.followedPlaylistUnprotected).toEqual({ status: "deleted" });
    expect(result.followedPlaylistLibraryItem.playlist_protected).toBe(1);
    expect(result.followedPlaylistLibraryItem.playlists).toEqual([
      { id: "PL-followed-offline", name: "Followed repairs", icon: "ListMusic", protects_download: 1 },
    ]);
  });
});
