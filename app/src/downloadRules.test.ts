import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-download-rules-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/downloadRulesHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`Download rules harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Download rules harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("download automation rules", () => {
  test("combines source, required keywords and exclusions", () => {
    expect(result.preview.matches).toBe(1);
    expect(result.preview.ready).toBe(1);
    expect(result.preview.sample.map((video: any) => video.video_id)).toEqual(["rule-main"]);
  });

  test("does not queue watched, archived, or imported history entries", () => {
    expect(result.preview.sample.map((video: any) => video.video_id)).not.toContain("rule-watched");
    expect(result.preview.sample.map((video: any) => video.video_id)).not.toContain("rule-archived");
    expect(result.preview.sample.map((video: any) => video.video_id)).not.toContain("rule-imported");
  });

  test("uses the same result to feed automatic queue candidates", () => {
    expect(result.candidates).toEqual([{ video_id: "rule-main", rule_id: result.created.id, user_id: 1 }]);
  });

  test("requires the profile preference before rules can auto-download Shorts", () => {
    expect(result.candidatesWithoutShorts.map((candidate: any) => candidate.video_id)).not.toContain("rule-short");
    expect(result.candidatesWithShorts.map((candidate: any) => candidate.video_id)).toContain("rule-short");
  });

  test("members-only content requires explicit opt-in", () => {
    expect(result.updatedPreview.matches).toBe(2);
    expect(result.updatedPreview.sample.map((video: any) => video.video_id).sort()).toEqual(["rule-main", "rule-members"]);
  });

  test("stores a stable portable identity", () => {
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].portable_uuid).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("rejects selected-source rules without a channel or playlist", () => {
    expect(result.invalidRuleError).toBe("at least one channel or playlist is required");
  });

  test("supports explicit exceptions to the all-subscriptions source", () => {
    expect(result.subscriptionExceptions.matches).toBe(1);
    expect(result.subscriptionExceptions.sample[0].video_id).toBe("rule-other");
  });

  test("migrates the old global switch and per-channel overrides without widening downloads", () => {
    expect(result.legacyRules).toHaveLength(2);
    expect(result.legacyRules[0].source_mode).toBe("subscriptions");
    expect(result.legacyRules[0].channel_ids.sort()).toEqual(["UC-other", "UC-rule"]);
    expect(result.legacyRules[0].lookback_hours).toBe(72);
    expect(result.legacyRules[1].source_mode).toBe("selected");
    expect(result.legacyRules[1].channel_ids).toEqual(["UC-rule"]);
    expect(result.legacyRules[1].min_duration_seconds).toBe(300);
  });
});
