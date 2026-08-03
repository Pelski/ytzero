import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-social-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/socialHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "social.db"), AVATAR_DIR: resolve(root, "avatars") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`Social harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Social harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Social domain", () => {
  test("shares videos, resolves @profile and keeps several reactions per profile", () => {
    expect(result.postMentionIds).toEqual([result.friendId]);
    expect(result.myReactions.sort()).toEqual(["👨‍👩‍👧‍👦", "🤯"]);
    expect(result.reactions).toEqual({ "🤯": 1, "👨‍👩‍👧‍👦": 1 });
    expect(result.reactionProfiles).toEqual({ "🤯": [result.friendId], "👨‍👩‍👧‍👦": [result.friendId] });
    expect(result.recentEmojis.afterAdding).toEqual(["👨‍👩‍👧‍👦", "🤯"]);
    expect(result.recentEmojis.afterRemoving).toEqual(["👨‍👩‍👧‍👦", "🤯"]);
    expect(result.recentEmojis.limited).toEqual(["🎯", "🥳", "😍", "🤣", "😂", "😁"]);
    expect(result.recentEmojis.otherProfile).toEqual([]);
    expect(result.skinTones).toEqual({ initial: "neutral", saved: "1f3fe", friend: "1f3fe", otherProfile: "neutral", invalid: { code: "social_invalid_skin_tone", status: 400 } });
    expect(result.invalidReaction).toEqual({ code: "social_invalid_reaction", status: 400 });
    expect(result.legacyReaction).toEqual({ visible: true, removed: true });
    expect(result.commentMentionIds).toEqual([1]);
    expect(result.commentLike).toEqual({ count: 1, mine: true });
    expect(result.commentPreview).toEqual(["Pierwszy komentarz", "Drugi komentarz", "Najnowszy komentarz"]);
    expect(result.socialNotificationTargets).toEqual([`/social/${result.postId}`]);
    expect(result.notificationQuotes).toEqual([
      { kind: "social_comment", source: "comment", body: "Drugi komentarz" },
      { kind: "social_comment_like", source: "comment", body: "Też polecam @Default" },
      { kind: "social_mention", source: "post", body: "Obejrzyj @Friend" },
      { kind: "social_mention", source: "comment", body: "Też polecam @Default" },
    ]);
  });

  test("keeps child profiles out unless enabled", () => {
    expect(result.childError).toEqual({ code: "social_child_restricted", status: 403 });
    expect(result.childMentionable).toBe(false);
  });

  test("keeps Watch together opt-in and enforces its access gate", () => {
    expect(result.watchTogether).toEqual({
      settingDefault: 0,
      domainDefault: false,
      disabledError: { code: "social_watch_together_disabled", status: 409 },
      enabled: true,
    });
  });
});
