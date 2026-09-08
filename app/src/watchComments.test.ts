import { describe, expect, test } from "bun:test";
import { isWatchCommentsSetting, normalizeWatchCommentsMode } from "../../shared/watchComments";

describe("watch comment loading mode", () => {
  test("preserves the legacy boolean behavior", () => {
    expect(normalizeWatchCommentsMode("0")).toBe("disabled");
    expect(normalizeWatchCommentsMode("1")).toBe("scroll");
  });

  test("accepts the three current modes and rejects invalid API values", () => {
    expect(normalizeWatchCommentsMode("auto")).toBe("auto");
    expect(normalizeWatchCommentsMode("scroll")).toBe("scroll");
    expect(normalizeWatchCommentsMode("unexpected")).toBe("disabled");
    expect(isWatchCommentsSetting("auto")).toBe(true);
    expect(isWatchCommentsSetting("unexpected")).toBe(false);
  });
});
