import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-routes-manifest-test-"));
let routes: string[] = [];
let sha256 = "";

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
  ({ routes, sha256 } = JSON.parse(line.slice("RESULT ".length)) as { routes: string[]; sha256: string });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("HTTP route manifest", () => {
  test("keeps every registered method and path stable while routers are extracted", () => {
    expect(routes).toHaveLength(211);
    expect(sha256).toBe("a1dda061ac6334593b29124025bc3c20ef2b11200871a5830ac19809384c7672");
  });

  test("does not register duplicate method/path pairs", () => {
    expect(new Set(routes).size).toBe(routes.length);
  });
});
