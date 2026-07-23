import { describe, expect, test } from "bun:test";
import { searchChannelFromLockup, searchVideoFromLockup } from "./youtube";

// Shapes captured from a live youtube.com/results page after the migration
// from videoRenderer/channelRenderer to lockupViewModel.
const videoLockup = {
  contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
  contentId: "XVFUtEh9zrY",
  contentImage: {
    thumbnailViewModel: {
      image: { sources: [{ url: "https://i.ytimg.com/small.jpg" }, { url: "https://i.ytimg.com/large.jpg" }] },
      overlays: [{ thumbnailBadgeViewModel: { text: "1:01:01" } }],
    },
  },
  metadata: {
    lockupMetadataViewModel: {
      title: { content: "summer lofi &amp; chill beats" },
      image: { decoratedAvatarViewModel: { avatarViewModel: { image: { sources: [{ url: "https://yt3/avatar.jpg" }] } } } },
      metadata: {
        contentMetadataViewModel: {
          metadataRows: [
            {
              metadataParts: [
                { text: { content: "Lofi Girl", commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: "UCSJ4gkVC6NrvII8umztf0Ow" } } } }] } },
                { text: { content: "4.7M views" } },
                { text: { content: "2 years ago" } },
              ],
            },
          ],
        },
      },
    },
  },
};

const channelLockup = {
  contentType: "LOCKUP_CONTENT_TYPE_CHANNEL",
  contentId: "UCDVKYPXwdYUQfgA05CkyFSg",
  contentImage: { avatarViewModel: { image: { sources: [{ url: "https://yt3/gamechops.jpg" }] } } },
  metadata: {
    lockupMetadataViewModel: {
      title: { content: "GameChops" },
      metadata: {
        contentMetadataViewModel: {
          metadataRows: [
            { metadataParts: [{ text: { content: "@gamechops" } }, { text: { content: "620K subscribers" } }, { text: { content: "1.2K videos" } }] },
          ],
        },
      },
    },
  },
};

describe("searchVideoFromLockup", () => {
  test("reads video card fields including abbreviated view count", () => {
    expect(searchVideoFromLockup(videoLockup)).toEqual({
      videoId: "XVFUtEh9zrY",
      title: "summer lofi & chill beats",
      thumbnail: "https://i.ytimg.com/large.jpg",
      duration: "1:01:01",
      channelTitle: "Lofi Girl",
      channelAvatar: "https://yt3/avatar.jpg",
      viewCount: 4_700_000,
      published: { value: 2, unit: "year" },
    });
  });

  test("ignores non-video lockups", () => {
    expect(searchVideoFromLockup({ contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST", contentId: "PL123" })).toBeNull();
  });
});

describe("searchChannelFromLockup", () => {
  test("reads channel card fields", () => {
    expect(searchChannelFromLockup(channelLockup)).toEqual({
      channelId: "UCDVKYPXwdYUQfgA05CkyFSg",
      title: "GameChops",
      thumbnail: "https://yt3/gamechops.jpg",
      handle: "@gamechops",
      subscriberCount: "620K",
      videoCount: "1.2K videos",
    });
  });

  test("ignores non-channel lockups", () => {
    expect(searchChannelFromLockup(videoLockup)).toBeNull();
  });
});
