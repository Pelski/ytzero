import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-routes-manifest-test-"));
let routes: string[] = [];

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/routesManifestHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: resolve(root, "db", "source.db"),
      AVATAR_DIR: resolve(root, "avatars"),
      DOWNLOADS_DIR: resolve(root, "downloads"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Routes manifest harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Routes manifest harness returned no result:\n${stdout}`);
  ({ routes } = JSON.parse(line.slice("RESULT ".length)) as { routes: string[] });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("HTTP route manifest", () => {
  test("keeps every registered method and path stable while routers are extracted", () => {
    const transcriptRoute = "POST /videos/:id/transcript";
    const playbackAdjacentRoute = "POST /playback/adjacent";
    const liveAudioRoute = "GET /videos/:id/audio-live/:resource";
    const retryAudioRoute = "POST /videos/:id/audio/retry";
    expect(routes).toHaveLength(229);
    expect(routes).toContain(transcriptRoute);
    expect(routes).toContain(playbackAdjacentRoute);
    expect(routes).toContain(liveAudioRoute);
    expect(routes).toContain(retryAudioRoute);
    expect(routes).toContain("GET /plugins/tubearchivist/config");
    expect(routes).toContain("POST /plugins/tubearchivist/sync");
    const legacyRoutes = routes.filter((route) => route !== transcriptRoute && route !== playbackAdjacentRoute && route !== liveAudioRoute && route !== retryAudioRoute);
    expect(createHash("sha256").update(legacyRoutes.join("\n")).digest("hex"))
      .toBe("41e8bc10839e472581c4b99528626dcf5e1880c97ade30ad49319e76074947fd");
  });

  test("does not register duplicate method/path pairs", () => {
    expect(new Set(routes).size).toBe(routes.length);
  });
});
