import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-environment-auth-test-"));
let result: Record<string, unknown> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/environmentAuthHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: resolve(root, "db", "auth.db"),
      YTZERO_AUTH_METHOD: "shared",
      YTZERO_AUTH_PASSWORD: "environment-only-password",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Environment auth harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Environment auth harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice(7));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("environment-forced shared authentication", () => {
  test("overrides stored auth configuration and accepts only the environment password", () => {
    expect(result).toEqual({
      method: "shared",
      passwordConfigured: true,
      usernameField: false,
      storedLoginStatus: 401,
      environmentLoginStatus: 200,
      methodChangeStatus: 409,
    });
  });
});
