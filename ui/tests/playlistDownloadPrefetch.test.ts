import { describe, expect, test } from "bun:test";
import { playlistPrefetchVideoId } from "../src/pages/usePlaylistDownloadPrefetch";

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
