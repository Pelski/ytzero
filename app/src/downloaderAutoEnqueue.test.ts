import { describe, expect, test } from "bun:test";
import { shouldAutoDownloadVideo } from "./downloadContentPolicy";

describe("automatic download content preferences", () => {
  test("excludes Shorts when automatic Short downloads are disabled", () => {
    expect(shouldAutoDownloadVideo(1, false)).toBe(false);
    expect(shouldAutoDownloadVideo(1, true)).toBe(true);
    expect(shouldAutoDownloadVideo(0, false)).toBe(true);
    expect(shouldAutoDownloadVideo(null, false)).toBe(true);
  });
});
