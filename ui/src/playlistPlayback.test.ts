import { describe, expect, test } from "bun:test";
import { isContinuousPlaylistQueue, playbackEndAction, playlistContinueTarget, videosInPlaylistOrder } from "./playlistPlayback";
import type { PlaybackQueueContext } from "./playbackQueue";

const item = (id: string, watched: number | null = null, status: "inbox" | "archived" = "inbox") => ({ id, watched, status });
const userPlaylist = { version: 1, kind: "user-playlist", playlistUuid: "playlist", sort: "added-newest" } satisfies PlaybackQueueContext;
const channelPlaylist = { version: 1, kind: "channel-playlist", playlistId: "PL1234567890", sort: "oldest" } satisfies PlaybackQueueContext;
const feed = { version: 1, kind: "feed", tags: [], showAll: false, sort: "published" } satisfies PlaybackQueueContext;

describe("playlist playback", () => {
  test("classifies both playlist sources as continuous queues", () => {
    expect(isContinuousPlaylistQueue(userPlaylist)).toBe(true);
    expect(isContinuousPlaylistQueue(channelPlaylist)).toBe(true);
    expect(isContinuousPlaylistQueue(feed)).toBe(false);
    expect(isContinuousPlaylistQueue(null)).toBe(false);
  });

  test("advances playlists independently of feed autoplay", () => {
    expect(playbackEndAction(userPlaylist, true, false)).toBe("advance");
    expect(playbackEndAction(channelPlaylist, true, false)).toBe("advance");
    expect(playbackEndAction(feed, true, false)).toBe("stop");
    expect(playbackEndAction(feed, true, true)).toBe("offer");
    expect(playbackEndAction(userPlaylist, false, true)).toBe("stop");
  });

  test("continues after the furthest watched item instead of the first unwatched gap", () => {
    const videos = [item("watched-1", 1), item("skipped"), item("watched-2", 1), item("next")];
    expect(playlistContinueTarget(videos)?.id).toBe("next");
  });

  test("moves past explicitly skipped videos", () => {
    const videos = [item("done", 1, "archived"), item("rejected", null, "archived"), item("next")];
    expect(playlistContinueTarget(videos)?.id).toBe("next");
  });

  test("keeps a partially watched next item as the continuation target", () => {
    const videos = [item("done", 1), { id: "partial", watched: null, status: "inbox" as const, watch_position: 120 }];
    expect(playlistContinueTarget(videos)?.id).toBe("partial");
  });

  test("hides continuation before progress and at the end of the selected order", () => {
    expect(playlistContinueTarget([])).toBe(null);
    expect(playlistContinueTarget([item("unwatched-zero", 0)])).toBe(null);
    expect(playlistContinueTarget([item("only", 1)])).toBe(null);
    expect(playlistContinueTarget([item("first"), item("second")])).toBe(null);
    expect(playlistContinueTarget([item("first", 1), item("last", 1)])).toBe(null);
  });

  test("uses the supplied visible order", () => {
    const a = item("a", 1), b = item("b"), c = item("c");
    expect(playlistContinueTarget([a, b, c])?.id).toBe("b");
    expect(playlistContinueTarget([c, b, a])).toBe(null);
  });

  test("restores the backend order after ready and processing sections were split", () => {
    const ready = [{ video_id: "ready-1" }, { video_id: "ready-2" }];
    const processing = [{ video_id: "processing" }];
    expect(videosInPlaylistOrder([...ready, ...processing], ["ready-1", "processing", "ready-2"]))
      .toEqual([ready[0], processing[0], ready[1]]);
    expect(videosInPlaylistOrder([...ready, ...processing], ["ready-2", "missing", "ready-2"]))
      .toEqual([ready[1], ready[0], processing[0]]);
  });
});
