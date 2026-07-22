import { describe, expect, test } from "bun:test";
import { isAllowedRemoteImageUrl, isValidImagePayload, videoIdFromThumbnailUrl } from "./imageCachePolicy";

describe("image cache policy", () => {
  test("accepts supported YouTube image hosts and rejects lookalikes", () => {
    expect(isAllowedRemoteImageUrl("https://i.ytimg.com/vi/id/hqdefault.jpg")).toBe(true);
    expect(isAllowedRemoteImageUrl("https://yt3.ggpht.com/example=s900")).toBe(true);
    expect(isAllowedRemoteImageUrl("https://evil-ytimg.com/image.jpg")).toBe(false);
    expect(isAllowedRemoteImageUrl("http://i.ytimg.com/vi/id/hqdefault.jpg")).toBe(false);
  });

  test("accepts real image signatures and rejects HTML disguised as an image", () => {
    const jpeg = new Uint8Array(64);
    jpeg.set([0xff, 0xd8, 0xff]);
    expect(isValidImagePayload("image/jpeg", jpeg)).toBe(true);

    const html = new TextEncoder().encode("<html><body>rate limited response from upstream</body></html>");
    expect(isValidImagePayload("image/jpeg", html)).toBe(false);
    expect(isValidImagePayload("text/html", jpeg)).toBe(false);
  });

  test("extracts video ids only from YouTube video thumbnail URLs", () => {
    expect(videoIdFromThumbnailUrl("https://i.ytimg.com/vi/abc_123/hqdefault.jpg")).toBe("abc_123");
    expect(videoIdFromThumbnailUrl("https://i.ytimg.com/vi_webp/abc-123/maxresdefault.webp")).toBe("abc-123");
    expect(videoIdFromThumbnailUrl("https://yt3.ggpht.com/channel-avatar")).toBeNull();
  });
});
