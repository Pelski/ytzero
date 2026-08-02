import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-download-recovery-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/downloadRecoveryHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), DOWNLOADS_DIR: resolve(root, "downloads"), DOWNLOAD_COOKIES_DIR: resolve(root, "cookies") },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(`Download recovery harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Download recovery harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("download recovery manifests", () => {
  test("writes a short, title-independent manifest beside the downloaded file", () => {
    expect(result.writtenManifest).toMatchObject({ schemaVersion: 1, videoId: "recover001", file: "moved.mp4", sizeBytes: 15 });
  });

  test("reconnects a moved file before cleanup removes its old database path", () => {
    expect(result.recovered.status).toBe("done");
    expect(result.recovered.path).toBe(resolve(root, "downloads", "moved.mp4"));
    expect(result.recovered.size_bytes).toBe(15);
  });

  test("preserves an unfamiliar file that has a valid recovery manifest", () => {
    expect(result.unknownPreserved).toBe(true);
  });
});
