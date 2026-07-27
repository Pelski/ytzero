import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-async-route-responses-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/asyncRouteResponsesHarness.ts"], {
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
  if (exitCode !== 0) throw new Error(`Async route responses harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Async route responses harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("async database route response shapes", () => {
  test("serializes plugin data instead of unresolved promises", () => {
    expect(result.pluginsStatus).toBe(200);
    expect(result.pluginsIsArray).toBe(true);
    expect(result.pluginSettingsStatus).toBe(200);
    expect(result.pluginSettingsIsObject).toBe(true);
  });

  test("serializes channel data instead of unresolved promises", () => {
    expect(result.channelsStatus).toBe(200);
    expect(result.channelsIsArray).toBe(true);
    expect(result.instanceHasDataIsBoolean).toBe(true);
    expect(result.recentChannelsStatus).toBe(200);
    expect(result.recentChannelsIsArray).toBe(true);
  });

  test("serializes download data instead of unresolved promises", () => {
    expect(result.downloadsStatus).toBe(200);
    expect(result.downloadsIsArray).toBe(true);
    expect(result.downloadStatsIsObject).toBe(true);
  });

  test("returns and reloads the newly saved global plugin value", () => {
    expect(result.updateDownloadSettingsStatus).toBe(200);
    expect(result.updatedDownloadSetting).toBe(17);
    expect(result.reloadedDownloadSetting).toBe(17);
  });

  test("returns and reloads plugin defaults after reset", () => {
    expect(result.resetDownloadSettingsStatus).toBe(200);
    expect(result.resetDownloadSetting).toBe(25);
    expect(result.reloadedResetDownloadSetting).toBe(25);
  });

  test("reloads committed profile and global settings after a write", () => {
    expect(result.updateSettingsStatus).toBe(200);
    expect(result.reloadedUserSetting).toBe("0");
    expect(result.reloadedGlobalSetting).toBe("#123456");
  });
});
