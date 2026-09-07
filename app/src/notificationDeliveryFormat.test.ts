import { describe, expect, test } from "bun:test";
import {
  absoluteTarget,
  buildDeliveryMessage,
  excerpt,
  isNotificationProvider,
  parseDeliveryTargets,
} from "./notificationDeliveryFormat";

describe("external notification targets", () => {
  test("accepts newline separated entries and drops duplicates", () => {
    expect(parseDeliveryTargets("tgram://token/chat\n discord://a/b\ntgram://token/chat"))
      .toEqual(["tgram://token/chat", "discord://a/b"]);
  });

  test("preserves commas inside a provider URL", () => {
    expect(parseDeliveryTargets("mailto://user:pass@example.com?to=one@example.com,two@example.com"))
      .toEqual(["mailto://user:pass@example.com?to=one@example.com,two@example.com"]);
  });

  test("treats blank input as no targets", () => {
    expect(parseDeliveryTargets("  \n \t \n")).toEqual([]);
  });

  test("recognizes only the supported providers", () => {
    expect(isNotificationProvider("apprise")).toBe(true);
    expect(isNotificationProvider("ntfy")).toBe(true);
    expect(isNotificationProvider("email")).toBe(false);
  });
});

describe("notification links", () => {
  test("joins the public base URL with the stored in-app target", () => {
    expect(absoluteTarget("https://yt.example.com/", "/watch/abc")).toBe("https://yt.example.com/watch/abc");
    expect(absoluteTarget("https://yt.example.com", "watch/abc")).toBe("https://yt.example.com/watch/abc");
  });

  test("keeps the bare path when no public address is configured", () => {
    expect(absoluteTarget("", "/downloads")).toBe("/downloads");
  });

  test("never rewrites a target that is already absolute", () => {
    expect(absoluteTarget("https://yt.example.com", "https://other.example/x")).toBe("https://other.example/x");
  });
});

describe("delivery messages", () => {
  const base = "https://yt.example.com";

  test("describes a followed channel upload", () => {
    const message = buildDeliveryMessage("channel_video", { videoTitle: "Deep dive", channelTitle: "Some channel" }, "/watch/v1", base);
    expect(message.title).toBe("Deep dive");
    expect(message.body).toBe("New video from Some channel.");
    expect(message.url).toBe("https://yt.example.com/watch/v1");
    expect(message.tags).toContain("channel");
  });

  test("names the rule, the tag and the channel for a tag-rule match", () => {
    const message = buildDeliveryMessage(
      "tag_rule",
      { videoTitle: "Rust in 2026", tagName: "Rust", rulePattern: "rust", channelTitle: "Some channel" },
      "/watch/v2",
      base,
    );
    expect(message.title).toBe("Rust in 2026");
    expect(message.body).toBe("Tagged “Rust” matching “rust” on Some channel.");
    expect(message.url).toBe("https://yt.example.com/watch/v2");
  });

  test("falls back to generic wording when a payload is missing its details", () => {
    expect(buildDeliveryMessage("tag_rule", {}, "/watch/v3", base).body).toBe("A tag rule matched.");
    expect(buildDeliveryMessage("playlist_video", {}, "", "").title).toBe("New video in a followed playlist");
  });

  test("quotes social activity and attributes the actor", () => {
    const message = buildDeliveryMessage("social_comment", { actor: { name: "Ada" }, commentBody: "Nice   find" }, "/social/p1", base);
    expect(message.title).toBe("Ada commented on your post");
    expect(message.body).toBe("Nice find");
  });

  test("reports the failure reason for a failed download", () => {
    const message = buildDeliveryMessage("download_failed", { videoTitle: "Clip", error: "network failure" }, "/downloads", base);
    expect(message.title).toBe("Download failed: Clip");
    expect(message.body).toBe("network failure");
    expect(message.tags).toContain("error");
  });

  test("shortens long bodies to one line", () => {
    expect(excerpt("a".repeat(300))).toHaveLength(240);
    expect(excerpt("one\ntwo")).toBe("one two");
  });
});
