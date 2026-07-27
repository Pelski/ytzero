import { describe, expect, test } from "bun:test";
import { markYouTubeUrl } from "./youtubeUrl";

describe("YouTube no-redirect URL marker", () => {
  test("adds the marker after query parameters", () => {
    expect(markYouTubeUrl("https://www.youtube.com/watch?v=abc&t=30s")).toBe("https://www.youtube.com/watch?v=abc&t=30s#ytNoRedirect");
    expect(markYouTubeUrl("https://youtu.be/abc")).toBe("https://youtu.be/abc#ytNoRedirect");
  });

  test("keeps an existing fragment and leaves other hosts unchanged", () => {
    expect(markYouTubeUrl("https://music.youtube.com/watch?v=abc#section")).toBe("https://music.youtube.com/watch?v=abc#section&ytNoRedirect");
    expect(markYouTubeUrl("https://example.com/watch?v=abc")).toBe("https://example.com/watch?v=abc");
  });

  test("does not duplicate the marker", () => {
    expect(markYouTubeUrl("https://youtube.com/watch?v=abc#ytNoRedirect")).toBe("https://youtube.com/watch?v=abc#ytNoRedirect");
  });
});
