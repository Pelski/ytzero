import { describe, expect, test } from "bun:test";
import { playlistContinuationToken, playlistVideoFromLockup } from "./youtube";

describe("YouTube playlist view models", () => {
  test("parses current video lockups", () => {
    const video = playlistVideoFromLockup({
      contentId: "video123",
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      contentImage: { thumbnailViewModel: { image: { sources: [{ url: "small" }, { url: "large" }] }, overlays: [{ thumbnailBadgeViewModel: { text: "12:34" } }] } },
      metadata: { lockupMetadataViewModel: {
        title: { content: "Title &amp; more" },
        metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: {
          content: "Creator",
          commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: "UCcreator" } } } }],
        } }] }] } },
      } },
      rendererContext: { commandContext: { onTap: { innertubeCommand: { watchEndpoint: { index: 4 } } } } },
    }, 1);
    expect(video).toEqual({
      videoId: "video123", title: "Title & more", thumbnail: "large",
      channelTitle: "Creator", channelId: "UCcreator", duration: "12:34", index: 5,
    });
  });

  test("reads current continuation view models", () => {
    expect(playlistContinuationToken({
      continuationItemViewModel: { continuationCommand: { innertubeCommand: { continuationCommand: { token: "next-page" } } } },
    })).toBe("next-page");
  });
});
