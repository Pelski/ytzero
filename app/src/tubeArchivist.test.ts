import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-tubearchivist-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/tubeArchivistHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), TUBE_ARCHIVIST_CONFIG_DIR: resolve(root, "secrets") },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`TubeArchivist harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`TubeArchivist harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice(7));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("TubeArchivist source plugin", () => {
  test("is disabled and performs no network request on a fresh install", () => {
    expect(result.enabledByDefault).toBe(false);
    expect(result.callsBeforeEnable).toBe(0);
  });
  test("imports archived videos into the existing feed", () => {
    expect(result.synced).toEqual({ imported: 1, pages: 1 });
    expect(result.feedIds).toContain("taVideo01");
    expect(result.localMediaSource).toBe("tubearchivist");
  });
  test("proxies range playback and syncs completion without leaking the token", () => {
    expect(result.streamStatus).toBe(206);
    expect(result.forwardedRange).toBe("bytes=0-3");
    expect(JSON.parse(result.watchedCall)).toEqual({ id: "taVideo01", is_watched: true });
    expect(result.everyUpstreamCallAuthenticated).toBe(true);
    expect(result.statusLeaksToken).toBe(false);
  });
  test("uses archived comments and removes the source immediately when disabled", () => {
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].text).toBe("Archived comment");
    expect(result.subtitles).toEqual([{ lang: "pl", url: "/api/videos/taVideo01/subtitles/pl" }]);
    expect(result.disabledFeedIds).not.toContain("taVideo01");
    expect(result.disabledStreamStatus).toBe(404);
  });
});
