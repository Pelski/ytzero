import { describe, expect, test } from "bun:test";
import { DeletedVideoError, PrivateVideoError, type VideoInfo } from "./youtube";
import { checkVideoAvailability } from "./videoAvailabilitySync";

const info = { videoId: "video" } as VideoInfo;

describe("channel video availability checks", () => {
  test("accepts oEmbed success without loading the player response", async () => {
    let playerCalls = 0;
    const result = await checkVideoAvailability("video", {
      oEmbed: async () => "available",
      videoInfo: async () => { playerCalls++; return info; },
    });
    expect(result).toBe("available");
    expect(playerCalls).toBe(0);
  });

  test("confirms deletion and privacy after oEmbed reports unavailability", async () => {
    expect(await checkVideoAvailability("deleted", {
      oEmbed: async () => "unavailable",
      videoInfo: async () => { throw new DeletedVideoError(); },
    })).toBe("deleted");
    expect(await checkVideoAvailability("private", {
      oEmbed: async () => "unavailable",
      videoInfo: async () => { throw new PrivateVideoError(); },
    })).toBe("private");
  });

  test("does not turn an inconclusive oEmbed response into a tombstone", async () => {
    let playerCalls = 0;
    const result = await checkVideoAvailability("video", {
      oEmbed: async () => "unknown",
      videoInfo: async () => { playerCalls++; return info; },
    });
    expect(result).toBe("unknown");
    expect(playerCalls).toBe(0);
  });

  test("propagates transient player failures instead of marking a deletion", async () => {
    expect(checkVideoAvailability("video", {
      oEmbed: async () => "unavailable",
      videoInfo: async () => { throw new Error("YouTube fetch failed (503)"); },
    })).rejects.toThrow("503");
  });
});
