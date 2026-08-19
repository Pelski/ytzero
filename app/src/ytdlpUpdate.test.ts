import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-ytdlp-update-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/ytdlpUpdateHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: join(root, "db", "source.db"),
      DOWNLOADS_DIR: join(root, "downloads"),
      YTDLP_PATH: join(root, "yt-dlp"),
      YTDLP_AUTO_UPDATE: "1",
      YTDLP_TEST_ROOT: root,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`yt-dlp update harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`yt-dlp update harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("yt-dlp updater", () => {
  test("defaults Docker/native installs to nightly updates every day", () => {
    expect(result.defaults).toEqual({ channel: "nightly", interval: 1 });
  });

  test("persists a supported channel and interval and passes the channel to yt-dlp", () => {
    expect(result.configured).toEqual({ channel: "stable", interval: 3 });
    expect(result.selectedChannel).toBe("stable");
    expect(result.update).toMatchObject({ channel: "stable", previous_version: "2026.08.01", version: "2026.08.19.1", updated: true });
  });

  test("does not run scheduled updates when disabled", () => {
    expect(result.disabled).toBeNull();
  });
});
