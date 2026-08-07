import { describe, expect, test } from "bun:test";
import { isVideoCardActionMode, normalizeVideoCardActionMode, VIDEO_CARD_ACTION_MODES } from "./videoCardActions";

describe("video card action modes", () => {
  test("accepts every persisted mode", () => {
    expect(VIDEO_CARD_ACTION_MODES.every(isVideoCardActionMode)).toBe(true);
    expect(isVideoCardActionMode("bar_always")).toBe(true);
  });

  test("normalizes unsupported backup values to hover", () => {
    expect(normalizeVideoCardActionMode("surprise")).toBe("hover");
  });
});
