import { describe, expect, test } from "bun:test";
import { playbackSpeedDirection, stepPlaybackRate } from "./playbackSpeedStep";

describe("playback speed shortcuts", () => {
  test("recognizes YouTube's shifted comma and period keys", () => {
    expect(playbackSpeedDirection("<")).toBe(-1);
    expect(playbackSpeedDirection(">")).toBe(1);
    expect(playbackSpeedDirection(",")).toBe(null);
  });

  test("steps by 0.25 and clamps to YouTube's supported range", () => {
    expect(stepPlaybackRate(1, -1)).toBe(0.75);
    expect(stepPlaybackRate(1, 1)).toBe(1.25);
    expect(stepPlaybackRate(0.25, -1)).toBe(0.25);
    expect(stepPlaybackRate(2, 1)).toBe(2);
  });

  test("every consecutive press advances from the preceding result", () => {
    let rate = 1;
    rate = stepPlaybackRate(rate, 1);
    rate = stepPlaybackRate(rate, 1);
    rate = stepPlaybackRate(rate, 1);
    expect(rate).toBe(1.75);
    rate = stepPlaybackRate(rate, -1);
    rate = stepPlaybackRate(rate, -1);
    expect(rate).toBe(1.25);
  });

  test("normalizes non-step and invalid rates", () => {
    expect(stepPlaybackRate(1.1, 1)).toBe(1.25);
    expect(stepPlaybackRate(Number.NaN, -1)).toBe(0.75);
  });
});
