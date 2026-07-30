import { describe, expect, test } from "bun:test";
import { deArrowHashPrefix, selectDeArrowBranding } from "./dearrow";

describe("DeArrow branding", () => {
  test("uses the documented four-character SHA-256 prefix", () => {
    expect(deArrowHashPrefix("dQw4w9WgXcQ")).toBe("5f6b");
  });

  test("selects trusted replacement titles and thumbnails", () => {
    expect(selectDeArrowBranding("video-id", {
      titles: [{ title: "A >clear title", original: false, votes: 2, locked: false }],
      thumbnails: [{ timestamp: 42.5, original: false, votes: 0, locked: false }],
    })).toEqual({
      title: "A clear title",
      thumbnail: "https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=video-id&time=42.5",
    });
  });

  test("keeps originals and rejects negatively rated candidates", () => {
    expect(selectDeArrowBranding("video-id", {
      titles: [{ title: "Untrusted", original: false, votes: -1, locked: false }],
      thumbnails: [{ timestamp: null, original: true, votes: 4, locked: false }],
    })).toEqual({ title: null, thumbnail: null });
  });
});
