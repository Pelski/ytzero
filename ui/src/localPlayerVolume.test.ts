import { describe, expect, test } from "bun:test";
import { enforceLocalPlayerVolume } from "./localPlayerVolume";

describe("local player volume ownership", () => {
  test("restores the slider volume after an out-of-band media change", () => {
    const media = { volume: 1 };

    expect(enforceLocalPlayerVolume(media, 0.25)).toBe(true);
    expect(media.volume).toBe(0.25);
  });

  test("does not rewrite an already synchronized media element", () => {
    const media = { volume: 0.3 };

    expect(enforceLocalPlayerVolume(media, 0.3)).toBe(false);
    expect(media.volume).toBe(0.3);
  });

  test("clamps persisted values to the media element range", () => {
    const media = { volume: 0.5 };

    enforceLocalPlayerVolume(media, 2);
    expect(media.volume).toBe(1);
    enforceLocalPlayerVolume(media, -1);
    expect(media.volume).toBe(0);
  });
});
