import { describe, expect, test } from "bun:test";
import { parseVideoCardSwipeConfig } from "./videoCardSwipeConfig";
import { classifyVideoCardSwipeDevice } from "./videoCardSwipeRuntime";

describe("video card swipe device configuration", () => {
  test("defaults to swipe on every device", () => {
    expect(parseVideoCardSwipeConfig(null).devices).toEqual(["desktop", "tablet", "mobile"]);
  });

  test("classifies fine pointers as desktop and coarse pointers by screen size", () => {
    expect(classifyVideoCardSwipeDevice(false, 390, 844)).toBe("desktop");
    expect(classifyVideoCardSwipeDevice(true, 390, 844)).toBe("mobile");
    expect(classifyVideoCardSwipeDevice(true, 1180, 820)).toBe("tablet");
    expect(classifyVideoCardSwipeDevice(true, 1920, 1080)).toBe("desktop");
  });
});
