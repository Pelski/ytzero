import { describe, expect, test } from "bun:test";
import type { SocialWatchPartyMessage, SocialWatchPartyPlayback } from "./api";
import {
  mergeWatchPartyMessages,
  projectWatchPartyPosition,
  shouldPublishWatchPartyPlayback,
  watchPartyPlayerStatePaused,
  watchPartyPlaybackNeedsCorrection,
} from "./watchTogetherRuntime";

const playback = (overrides: Partial<SocialWatchPartyPlayback> = {}): SocialWatchPartyPlayback => ({
  revision: 3,
  position: 20,
  paused: false,
  playback_rate: 1,
  updated_at: 1_000,
  ...overrides,
});

describe("Watch together runtime", () => {
  test("treats YouTube buffering as paused while preserving an enhanced fallback", () => {
    expect(watchPartyPlayerStatePaused(1, true)).toBe(false);
    expect(watchPartyPlayerStatePaused(3, false)).toBe(true);
    expect(watchPartyPlayerStatePaused(undefined, false)).toBe(false);
    expect(watchPartyPlayerStatePaused(undefined, true)).toBe(true);
  });

  test("projects a playing position from local receipt time and keeps paused state fixed", () => {
    expect(projectWatchPartyPosition(playback(), 80_000, 82_500)).toBe(22.5);
    expect(projectWatchPartyPosition(playback({ paused: true }), 80_000, 89_000)).toBe(20);
  });

  test("uses local elapsed time even when the client clock is far from the server epoch", () => {
    const serverPlayback = playback({ updated_at: 1_000 });
    const clientReceipt = 3_600_000;
    expect(projectWatchPartyPosition(serverPlayback, clientReceipt, clientReceipt + 2_000)).toBe(22);
  });

  test("ignores stale playback and corrects meaningful drift or state changes", () => {
    const current = { position: 22.1, paused: false, playback_rate: 1 };
    expect(watchPartyPlaybackNeedsCorrection({ current, incoming: playback({ revision: 2 }), lastAppliedRevision: 2, receivedAt: 1_000, now: 3_000 })).toBe(false);
    expect(watchPartyPlaybackNeedsCorrection({ current, incoming: playback(), lastAppliedRevision: 2, receivedAt: 1_000, now: 3_000 })).toBe(false);
    expect(watchPartyPlaybackNeedsCorrection({ current: { ...current, position: 29 }, incoming: playback(), lastAppliedRevision: 2, receivedAt: 1_000, now: 3_000 })).toBe(true);
    expect(watchPartyPlaybackNeedsCorrection({ current, incoming: playback({ paused: true }), lastAppliedRevision: 2, receivedAt: 1_000, now: 3_000 })).toBe(true);
    expect(watchPartyPlaybackNeedsCorrection({
      current: { ...current, paused: true },
      incoming: playback(),
      lastAppliedRevision: 3,
      receivedAt: 1_000,
      now: 3_000,
      enforceCurrentRevision: true,
    })).toBe(true);
  });

  test("verifies an applied host snapshot again before considering it restored", () => {
    const snapshot = playback({ revision: 9, position: 48, paused: true });
    expect(watchPartyPlaybackNeedsCorrection({
      current: { position: 0, paused: true, playback_rate: 1 },
      incoming: snapshot,
      lastAppliedRevision: -1,
      receivedAt: 1_000,
      now: 1_000,
    })).toBe(true);
    expect(watchPartyPlaybackNeedsCorrection({
      current: { position: 48, paused: true, playback_rate: 1 },
      incoming: snapshot,
      lastAppliedRevision: 9,
      receivedAt: 1_000,
      now: 1_750,
      enforceCurrentRevision: true,
    })).toBe(false);
  });

  test("publishes changes immediately and otherwise sends bounded checkpoints", () => {
    const previous = { position: 10, paused: false, playback_rate: 1 };
    expect(shouldPublishWatchPartyPlayback({ current: { position: 11, paused: false, playback_rate: 1 }, previous, previousSentAt: 1_000, now: 2_000 })).toBe(false);
    expect(shouldPublishWatchPartyPlayback({ current: { position: 14, paused: false, playback_rate: 1 }, previous, previousSentAt: 1_000, now: 2_000 })).toBe(true);
    expect(shouldPublishWatchPartyPlayback({ current: { position: 14, paused: false, playback_rate: 1 }, previous, previousSentAt: 1_000, now: 5_000 })).toBe(true);
    expect(shouldPublishWatchPartyPlayback({ current: { position: 11, paused: true, playback_rate: 1 }, previous, previousSentAt: 1_000, now: 2_000 })).toBe(true);
  });

  test("deduplicates POST/SSE message echoes and retains server ordering", () => {
    const author = { id: 1, name: "Ada", username: "Ada", avatar: "", avatar_color: "#123456" };
    const message = (id: string, sequence: number): SocialWatchPartyMessage => ({ id, sequence, body: id, created_at: `2026-08-02T10:00:0${sequence}.000Z`, author });
    expect(JSON.stringify(mergeWatchPartyMessages([message("two", 2)], [message("one", 1), message("two", 2)]).map((item) => item.id))).toBe(JSON.stringify(["one", "two"]));
    expect(JSON.stringify(mergeWatchPartyMessages([], [message("one", 1), message("two", 2)], 1).map((item) => item.id))).toBe(JSON.stringify(["two"]));
  });
});
