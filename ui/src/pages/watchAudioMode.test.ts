import { describe, expect, test } from "bun:test";
import { canUseWatchAudioMode, ownedWatchPosition, resolveWatchPlaybackStart, resolveWatchStartSeconds } from "./watchAudioMode";

const available = {
  childProfile: false,
  hasVideo: true,
  liveStatus: "none",
  membersOnly: false,
  playerKind: "youtube" as const,
  privateVideo: false,
  watchTogetherRoomId: null,
};

describe("watch audio mode", () => {
  test("is limited to playable solo videos", () => {
    expect(canUseWatchAudioMode(available)).toBe(true);
    expect(canUseWatchAudioMode({ ...available, childProfile: true })).toBe(false);
    expect(canUseWatchAudioMode({ ...available, liveStatus: "live" })).toBe(true);
    expect(canUseWatchAudioMode({ ...available, liveStatus: "upcoming" })).toBe(false);
    expect(canUseWatchAudioMode({ ...available, membersOnly: true })).toBe(false);
    expect(canUseWatchAudioMode({ ...available, privateVideo: true })).toBe(false);
    expect(canUseWatchAudioMode({ ...available, watchTogetherRoomId: "room" })).toBe(false);
    expect(canUseWatchAudioMode({ ...available, playerKind: "loading" })).toBe(false);
    expect(canUseWatchAudioMode({ ...available, playerKind: "blocked" })).toBe(false);
  });

  test("chooses the first valid handoff or resume position", () => {
    expect(resolveWatchStartSeconds(0, 83.9, 40)).toBe(83);
    expect(resolveWatchStartSeconds(Number.NaN, -1, undefined, 12.8)).toBe(12);
    expect(resolveWatchStartSeconds(undefined, null, 0)).toBe(0);
  });

  test("applies a newly changed URL timestamp without breaking later handoffs", () => {
    expect(resolveWatchPlaybackStart({
      capturedPosition: 60,
      savedPosition: 20,
      sharedTargetChanged: true,
      sharedTargetSeconds: 300,
    })).toBe(300);
    expect(resolveWatchPlaybackStart({
      capturedPosition: 83.9,
      savedPosition: 20,
      sharedTargetChanged: false,
      sharedTargetSeconds: 300,
    })).toBe(83);
  });

  test("never carries a transient position to another video", () => {
    expect(ownedWatchPosition("video-a", "video-a", 83.9)).toBe(83.9);
    expect(ownedWatchPosition("video-b", "video-a", 83.9)).toBe(0);
    expect(ownedWatchPosition(undefined, "video-a", 83.9)).toBe(0);
  });
});
