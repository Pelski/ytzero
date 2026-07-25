import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-profile-oidc-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/profileOidcHarness.ts"], {
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
  if (exitCode !== 0) throw new Error(`OIDC profile harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`OIDC profile harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("OIDC profile administration", () => {
  test("requires the configured identity when the primary creates a mapped profile", () => {
    expect(result.missingStatus).toBe(400);
    expect(result.invalidStatus).toBe(400);
  });

  test("creates a restricted profile before its first SSO login and lets the primary delete it", () => {
    expect(result.createdStatus).toBe(200);
    expect(result.createdRow).toEqual({ oidc_subject: "child@example.com", is_child: 1 });
    expect(result.childLocalOnly).toBe("1");
    expect(result.deletedStatus).toBe(200);
    expect(result.existsAfterDelete).toBe(false);
  });

  test("accepts a non-email identity when a different OIDC claim is configured", () => {
    expect(result.customStatus).toBe(200);
    expect(result.customIdentity).toBe("Team-Member-42");
  });
});
