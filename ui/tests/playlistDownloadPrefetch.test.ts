import { describe, expect, test } from "bun:test";
import { playlistDownloadContext, playlistPrefetchVideoId } from "../src/pages/usePlaylistDownloadPrefetch";

describe("playlist download prefetch", () => {
  test("uses the next video from an open YouTube playlist", () => {
    expect(playlistPrefetchVideoId("PL123", "next-route", null, undefined)).toBe("next-route");
  });

  test("uses resumed personal and YouTube playlist queues", () => {
    expect(playlistPrefetchVideoId(undefined, undefined, { version: 1, kind: "user-playlist", playlistUuid: "playlist" }, "next-user")).toBe("next-user");
    expect(playlistPrefetchVideoId(undefined, undefined, { version: 1, kind: "channel-playlist", playlistId: "PL123", sort: "oldest" }, "next-channel")).toBe("next-channel");
  });

  test("does not prefetch downloads for non-playlist queues", () => {
    expect(playlistPrefetchVideoId(undefined, undefined, { version: 1, kind: "history" }, "next-history")).toBeNull();
  });
});

describe("playlist download context", () => {
  test("identifies the playlist whose quality should be used", () => {
    expect(playlistDownloadContext("PL1234567890", null)).toEqual({ kind: "channel-playlist", playlistId: "PL1234567890" });
    expect(playlistDownloadContext(undefined, { version: 1, kind: "user-playlist", playlistUuid: "playlist", sort: "added-newest" })).toEqual({ kind: "user-playlist", playlistUuid: "playlist" });
    expect(playlistDownloadContext(undefined, { version: 1, kind: "feed", tags: [], showAll: false, sort: "published" })).toBeUndefined();
  });
});
