import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-download-live-archives-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/downloadLiveArchivesHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: resolve(root, "db", "source.db"),
      DOWNLOADS_DIR: resolve(root, "downloads"),
      DOWNLOAD_COOKIES_DIR: resolve(root, "download-cookies"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`Live archive download harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Live archive download harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("scheduled downloads of completed live streams", () => {
  test("keeps completed live archives out by default", () => {
    expect(result.queuedWithDefault).toBe(1);
    expect(result.defaultDownloads).toEqual([{ video_id: "scheduled-regular" }]);
  });

  test("queues completed archives after opt-in without queuing active or upcoming streams", () => {
    expect(result.queuedAfterOptIn).toBe(1);
    expect(result.optedInDownloads).toEqual([
      { video_id: "scheduled-live-archive" },
      { video_id: "scheduled-regular" },
    ]);
  });
});
