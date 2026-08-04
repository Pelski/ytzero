import { describe, expect, test } from "bun:test";
import { markYouTubeUrl, youtubeVideoId } from "./youtubeUrl";

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

describe("YouTube video URL detection", () => {
  test("recognizes standard, shortened and player URLs", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=b6bxeEZ_j9A")).toBe("b6bxeEZ_j9A");
    expect(youtubeVideoId("https://youtu.be/b6bxeEZ_j9A#ytNoRedirect")).toBe("b6bxeEZ_j9A");
    expect(youtubeVideoId("https://youtube.com/shorts/b6bxeEZ_j9A?feature=share")).toBe("b6bxeEZ_j9A");
    expect(youtubeVideoId("https://www.youtube.com/live/b6bxeEZ_j9A")).toBe("b6bxeEZ_j9A");
    expect(youtubeVideoId("https://www.youtube-nocookie.com/embed/b6bxeEZ_j9A")).toBe("b6bxeEZ_j9A");
  });

  test("rejects channels, playlists, other hosts and malformed ids", () => {
    expect(youtubeVideoId("https://youtube.com/channel/UC123")).toBe(null);
    expect(youtubeVideoId("https://youtube.com/playlist?list=PL123")).toBe(null);
    expect(youtubeVideoId("https://example.com/watch?v=b6bxeEZ_j9A")).toBe(null);
    expect(youtubeVideoId("https://youtu.be/too-short")).toBe(null);
  });
});
