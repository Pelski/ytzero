import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-environment-auth-test-"));
let completed = false;

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
  completed = stdout.split("\n").includes("RESULT ok");
  if (!completed) throw new Error(`Environment auth harness returned no completion marker:\n${stdout}`);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("environment-forced shared authentication", () => {
  test("overrides stored auth configuration and accepts only the environment password", () => {
    expect(completed).toBe(true);
  });
});
