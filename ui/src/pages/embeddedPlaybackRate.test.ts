import { describe, expect, test } from "bun:test";
import { applyEmbeddedPlaybackRate } from "./embeddedPlaybackRate";
import type { WatchPlayerHandle } from "../playerHandle";

function playerWithRateSink(rates: number[]): WatchPlayerHandle {
  return {
    destroy() {},
    getCurrentTime: () => 0,
    getDuration: () => 0,
    getPlaybackRate: () => rates[rates.length - 1] ?? 1,
    getPlayerState: () => 1,
    pauseVideo() {},
    playVideo() {},
    seekTo() {},
    setPlaybackRate: (rate) => rates.push(rate),
  };
}

describe("embedded playback-rate commands", () => {
  test("uses the extension bridge while an embedded video is enhanced", async () => {
    const commands: Array<{ videoId: string; command: string; rate: unknown }> = [];
    const fallbackRates: number[] = [];
    const result = await applyEmbeddedPlaybackRate({
      audioActive: false,
      getPlayer: () => playerWithRateSink(fallbackRates),
      playerKind: "youtube",
      rate: 2,
      sendCommand: async (videoId, command, payload) => {
        commands.push({ videoId, command, rate: payload?.rate });
        return {};
      },
      videoId: "abcdefghijk",
    });

    expect(result).toBe("bridge");
    expect(commands).toEqual([{ videoId: "abcdefghijk", command: "set-playback-rate", rate: 2 }]);
    expect(fallbackRates).toEqual([]);
  });

  test("falls back to the player API when the extension bridge is unavailable", async () => {
    const fallbackRates: number[] = [];
    const result = await applyEmbeddedPlaybackRate({
      audioActive: false,
      getPlayer: () => playerWithRateSink(fallbackRates),
      playerKind: "youtube",
      rate: 1.25,
      sendCommand: async () => { throw new Error("bridge unavailable"); },
      videoId: "abcdefghijk",
    });

    expect(result).toBe("fallback");
    expect(fallbackRates).toEqual([1.25]);
  });

  test("does not apply a stale fallback after a newer rate command", async () => {
    const fallbackRates: number[] = [];
    const result = await applyEmbeddedPlaybackRate({
      audioActive: false,
      getPlayer: () => playerWithRateSink(fallbackRates),
      playerKind: "youtube",
      rate: 2,
      sendCommand: async () => { throw new Error("late bridge failure"); },
      shouldFallback: () => false,
      videoId: "abcdefghijk",
    });

    expect(result).toBe("superseded");
    expect(fallbackRates).toEqual([]);
  });
});
