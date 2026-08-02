import { describe, expect, test } from "bun:test";
import { parseVideoCardSize, scheduledThumbnailWidth } from "../src/videoCardSize";

describe("video card sizing", () => {
  test("normalizes legacy and numeric card sizes", () => {
    expect(parseVideoCardSize("sm")).toBe(220);
    expect(parseVideoCardSize("372")).toBe(372);
    expect(parseVideoCardSize("999")).toBe(480);
  });

  test("maps every card-size step to a stable scheduled thumbnail width", () => {
    expect([180, 220, 260, 300, 372, 480].map(scheduledThumbnailWidth)).toEqual([88, 98, 108, 118, 136, 163]);
  });
});
