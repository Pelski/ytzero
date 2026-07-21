import { describe, expect, test } from "bun:test";
import { watchProgress } from "../src/components/VideoThumbnail";

describe("watchProgress", () => {
  test("normalizes playback position to a thumbnail fraction", () => {
    expect(watchProgress(30, 120)).toBe(0.25);
    expect(watchProgress(150, 120)).toBe(1);
  });

  test("ignores missing and invalid playback state", () => {
    expect(watchProgress(null, 120)).toBeNull();
    expect(watchProgress(30, 0)).toBeNull();
    expect(watchProgress(0, 120)).toBeNull();
  });
});
