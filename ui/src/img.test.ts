import { describe, expect, test } from "bun:test";
import { img, youtubeThumbnailFallback } from "./img";

describe("image proxy URLs", () => {
  test("keeps the existing proxy URL for ordinary callers", () => {
    expect(img("https://i.ytimg.com/vi/example/hqdefault.jpg"))
      .toBe("/api/img?u=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fexample%2Fhqdefault.jpg");
  });

  test("can ask the proxy to expose a cache miss as an image error", () => {
    expect(img("https://i.ytimg.com/vi/example/oardefault.jpg", { onMiss: "error" }))
      .toBe("/api/img?u=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fexample%2Foardefault.jpg&onMiss=error");
  });

  test("does not append proxy options to local image paths", () => {
    expect(img("/assets/poster.jpg", { onMiss: "error" })).toBe("/assets/poster.jpg");
  });
});

describe("YouTube thumbnail fallback URLs", () => {
  for (const url of [
    "https://i.ytimg.com/vi/video-id/maxresdefault.jpg",
    "https://i2.ytimg.com/vi/video-id/sddefault.jpg",
    "https://i4.ytimg.com/vi_webp/video-id/hqdefault.webp",
    "https://img.youtube.com/vi/video-id/0.jpg",
  ]) {
    test(`extracts the video ID from ${url}`, () => {
      expect(youtubeThumbnailFallback(url)).toBe("https://i.ytimg.com/vi/video-id/hqdefault.jpg");
    });
  }

  test("extracts the video ID from a proxied thumbnail URL", () => {
    expect(youtubeThumbnailFallback(img("https://i.ytimg.com/vi/video-id/maxresdefault.jpg")))
      .toBe("https://i.ytimg.com/vi/video-id/hqdefault.jpg");
  });

  test("ignores unsupported image hosts", () => {
    expect(youtubeThumbnailFallback("https://example.com/vi/video-id/maxresdefault.jpg")).toBe(null);
  });

  test("ignores unsupported YouTube thumbnail paths", () => {
    expect(youtubeThumbnailFallback("https://i.ytimg.com/an_image/video-id.jpg")).toBe(null);
  });
});
