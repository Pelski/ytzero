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
    expect(routes).toHaveLength(226);
    expect(routes).toContain(transcriptRoute);
    expect(routes).toContain(playbackAdjacentRoute);
    expect(routes).toContain("GET /plugins/tubearchivist/config");
    expect(routes).toContain("POST /plugins/tubearchivist/sync");
    const legacyRoutes = routes.filter((route) => route !== transcriptRoute && route !== playbackAdjacentRoute);
    expect(createHash("sha256").update(legacyRoutes.join("\n")).digest("hex"))
      .toBe("b7055a1054cc40f4127456fa246674aeaa5c06433a90468bacdcb0548968b4bf");
  });

  test("does not register duplicate method/path pairs", () => {
    expect(new Set(routes).size).toBe(routes.length);
  });
});
