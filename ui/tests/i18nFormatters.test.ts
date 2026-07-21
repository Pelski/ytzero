import { describe, expect, test } from "bun:test";
import { formatPlaylistVideoCount } from "../src/i18n";

describe("playlist video-count localization", () => {
  test("replaces YouTube's English label with the active locale", () => {
    expect(formatPlaylistVideoCount("1 video", "pl")).toBe("1 film");
    expect(formatPlaylistVideoCount("2 videos", "pl")).toBe("2 filmy");
    expect(formatPlaylistVideoCount("7 videos", "pl")).toBe("7 filmów");
  });

  test("normalizes compact counts before applying plural rules", () => {
    expect(formatPlaylistVideoCount("1.2K videos", "en")).toBe("1200 videos");
    expect(formatPlaylistVideoCount("1.2K videos", "de")).toBe("1200 Videos");
  });
});
