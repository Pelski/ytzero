import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-profile-credentials-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/profileCredentialsHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), AVATAR_DIR: resolve(root, "avatars") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`Profile credentials harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Profile credentials harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("per-profile credential routes", () => {
  test("generates credentials separately for each profile", () => {
    expect(result.firstStatus).toBe(200);
    expect(result.secondStatus).toBe(200);
    expect(result.usernames).toEqual(["Dom_Rodzinny", "Dom_Rodzinny_2"]);
    expect(result.firstOnlyTargetHasPassword).toBe(true);
    expect(result.firstPasswordVerifies).toBe(true);
    expect(result.secondPasswordVerifies).toBe(true);
  });

  test("regenerates one profile and invalidates its previous password", () => {
    expect(result.regenerateStatus).toBe(200);
    expect(result.regeneratedPasswordChanged).toBe(true);
    expect(result.oldPasswordInvalidated).toBe(true);
    expect(result.regeneratedPasswordVerifies).toBe(true);
  });

  test("lets the authenticated profile change its own password", () => {
    expect(result.wrongChangeStatus).toBe(401);
    expect(result.changedStatus).toBe(200);
    expect(result.newPasswordVerifies).toBe(true);
  });

  test("lets only an administrator hide other profiles from the authenticated picker", () => {
    expect(result.visibilityUpdateStatus).toBe(200);
    expect(result.visibilityConfigured).toBe(true);
    expect(result.sharedPickerProfilesHidden).toBe(false);
    expect(result.pickerProfilesHidden).toBe(true);
    expect(result.nonAdminVisibilityUpdateStatus).toBe(403);
  });

  test("lets an authenticated administrator manage child restrictions", () => {
    expect(result.adminChildUpdateStatus).toBe(200);
    expect(result.nonAdminChildUpdateStatus).toBe(403);
    expect(result.childFlag).toBe(1);
    expect(result.childLimit).toBe("45");
  });

  test("lets only the primary owner delegate and revoke administrator access", () => {
    expect(result.sharedAdminGrantStatus).toBe(409);
    expect(result.grantAdminStatus).toBe(200);
    expect(result.delegatedIsAdmin).toBe(true);
    expect(result.delegatedCanManageAdministrators).toBe(false);
    expect(result.delegatedPrimaryEditStatus).toBe(403);
    expect(result.delegatedRoleChangeStatus).toBe(403);
    expect(result.delegatedChildUpdateStatus).toBe(200);
    expect(result.delegatedVisibilityUpdateStatus).toBe(200);
    expect(result.revokeAdminStatus).toBe(200);
    expect(result.revokedIsAdmin).toBe(false);
  });
});
