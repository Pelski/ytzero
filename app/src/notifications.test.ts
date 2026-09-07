import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-notifications-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/notificationsHarness.ts"], {
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
  if (exitCode !== 0) throw new Error(`Notifications harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Notifications harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("download failure notifications", () => {
  test("notifies adult profiles once per download cycle and skips children", () => {
    expect(result.firstCreated).toBe(1);
    expect(result.duplicateCreated).toBe(0);
    expect(result.firstRows).toHaveLength(1);
    expect(result.firstRows[0].user_id).toBe(1);
    expect(result.firstRows[0].kind).toBe("download_failed");
    expect(result.firstRows[0].target).toBe("/downloads");
    expect(JSON.parse(result.firstRows[0].payload).videoTitle).toBe("Failed video");
    expect(result.nextCycleCreated).toBe(1);
    expect(result.finalCount).toBe(2);
  });

  test("uses an opt-in channel default and lets the profile master switch win", () => {
    expect(result.channelDefaultCreated).toBe(0);
    expect(result.channelOverrideCreated).toBe(1);
    expect(result.masterDisabledCreated).toBe(0);
  });
});

describe("auto-tag rule notifications", () => {
  test("reports only owned rules while still tagging the video", () => {
    expect(result.taggedVideo.count).toBe(1);
    expect(result.ruleMatches).toHaveLength(1);
    expect(result.ruleMatches[0].userId).toBe(1);
    expect(result.ruleMatches[0].tagName).toBe("Rust");
    expect(result.ruleMatches[0].pattern).toBe("rust");
  });

  test("is opt-in per category and never repeats for the same rule and video", () => {
    expect(result.tagRuleDefaultCreated).toBe(0);
    expect(result.tagRuleCategoryCreated).toBe(1);
    expect(result.tagRuleDuplicateCreated).toBe(0);
    expect(result.tagRuleRows).toHaveLength(1);
    expect(result.tagRuleRows[0].target).toBe("/watch/rustvideo1");
    const payload = JSON.parse(result.tagRuleRows[0].payload);
    expect(payload.tagName).toBe("Rust");
    expect(payload.rulePattern).toBe("rust");
    expect(payload.channelTitle).toBe("Notification channel");
  });

  test("lets a per-rule override switch one rule off", () => {
    expect(result.tagRuleSourceOffCreated).toBe(0);
  });
});

describe("external notification provider", () => {
  test("hides provider connection details from regular profiles", () => {
    expect(result.adminDeliverySnapshot.appriseServerUrl).toBe("http://apprise.local:8000");
    expect(result.adminDeliverySnapshot.publicBaseUrl).toBe("https://ytzero.example");
    expect(result.profileDeliverySnapshot.appriseServerUrl).toBe("");
    expect(result.profileDeliverySnapshot.publicBaseUrl).toBe("");
    expect(result.profileDeliverySnapshot.providerConfigured).toBe(true);
    expect(result.profileDeliverySnapshot.publicBaseUrlConfigured).toBe(true);
  });

  test("rejects provider connection changes from a regular profile", () => {
    expect(result.unauthorizedProviderError).toBe("administrator setting");
  });

  test("sends a provider-neutral bell notification through Apprise", () => {
    expect(result.delivered).toBe(true);
    expect(result.deliveredRequest.url).toBe("http://apprise.local:8000/notify");
    expect(result.deliveredRequest.body.urls).toEqual(["tgram://token/chat", "discord://id/token"]);
    expect(result.deliveredRequest.body.title).toBe("Rust in 2026");
    expect(result.deliveredRequest.body.body).toContain("https://ytzero.example/watch/rustvideo1");
  });

  test("resetting the plugin resets only its provider choice", () => {
    expect(result.resetDeliverySnapshot.provider).toBe("off");
    expect(result.resetDeliverySnapshot.appriseServerUrl).toBe("http://apprise.local:8000");
    expect(result.resetDeliveryRows).toEqual([{ provider: "apprise", enabled: 1, targets: "tgram://token/chat\ndiscord://id/token" }]);
  });
});
