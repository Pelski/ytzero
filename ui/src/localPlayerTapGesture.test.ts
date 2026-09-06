import { describe, expect, test } from "bun:test";
import {
  isMatchingLocalPlayerDoubleTap,
  localPlayerTapSide,
  resolveLocalPlayerDoubleActivation,
} from "./localPlayerTapGesture";

describe("local player tap gestures", () => {
  test("maps the left and right halves of the video to seek directions", () => {
    expect(localPlayerTapSide(199, 100, 200)).toBe("back");
    expect(localPlayerTapSide(200, 100, 200)).toBe("forward");
  });

  test("recognizes two nearby taps on the same side", () => {
    expect(isMatchingLocalPlayerDoubleTap(
      { side: "back", timestamp: 1_000 },
      { side: "back", timestamp: 1_300 },
    )).toBe(true);
    expect(isMatchingLocalPlayerDoubleTap(
      { side: "back", timestamp: 1_000 },
      { side: "forward", timestamp: 1_300 },
    )).toBe(false);
    expect(isMatchingLocalPlayerDoubleTap(
      { side: "back", timestamp: 1_000 },
      { side: "back", timestamp: 1_500 },
    )).toBe(false);
  });

  test("seeks for touch double taps without exiting fullscreen", () => {
    expect(resolveLocalPlayerDoubleActivation("touch", 120, 100, 200)).toBe("back");
    expect(resolveLocalPlayerDoubleActivation("touch", 280, 100, 200)).toBe("forward");
    expect(resolveLocalPlayerDoubleActivation("mouse", 120, 100, 200)).toBe("fullscreen");
  });
});
