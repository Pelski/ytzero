import { describe, expect, test } from "bun:test";
import { resolvePlayerKind } from "./watchPlayerMode";

const base = {
  hasVideo: true,
  isLive: false,
  downloadStatus: null,
  playerSource: "auto" as const,
  playbackPolicyReady: true,
  childDownloadsOnly: false,
  sourceChoice: "undecided" as const,
  watchMode: "youtube" as const,
  streamingEnabled: false,
};

describe("resolvePlayerKind", () => {
  test("does not mount YouTube before the download policy is loaded", () => {
    expect(resolvePlayerKind({ ...base, playbackPolicyReady: false })).toBe("loading");
  });

  test("shows the source choice when ask mode is ready", () => {
    expect(resolvePlayerKind({ ...base, watchMode: "ask" })).toBe("choice");
  });

  test("honors each choice made in ask mode", () => {
    expect(resolvePlayerKind({ ...base, watchMode: "ask", sourceChoice: "youtube" })).toBe("youtube");
    expect(resolvePlayerKind({ ...base, watchMode: "ask", sourceChoice: "wait" })).toBe("waiting");
  });

  test("plays an existing local file without waiting for policy requests", () => {
    expect(resolvePlayerKind({ ...base, downloadStatus: "done", playbackPolicyReady: false })).toBe("local");
  });

  test("always uses YouTube for a live or upcoming stream", () => {
    expect(resolvePlayerKind({ ...base, isLive: true, downloadStatus: "done", watchMode: "download" })).toBe("youtube");
  });

  describe("experimental streaming", () => {
    test("streams a not-yet-downloaded video when enabled", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true })).toBe("stream");
    });

    test("prefers streaming over the wait/ask panels", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, watchMode: "download" })).toBe("stream");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, watchMode: "ask" })).toBe("stream");
    });

    test("still plays a finished local file instead of re-streaming", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, downloadStatus: "done" })).toBe("local");
    });

    test("never streams a live broadcast", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, isLive: true })).toBe("youtube");
    });

    test("lets the viewer fall back to YouTube", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, playerSource: "youtube" })).toBe("youtube");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, sourceChoice: "youtube" })).toBe("youtube");
    });

    test("does not stream for a downloads-only child profile", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, childDownloadsOnly: true })).toBe("blocked");
    });

    test("hands off to the local player once the background download finishes", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, downloadStatus: "done" })).toBe("local");
    });

    test("keeps streaming while the download is still in progress", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, downloadStatus: "downloading" })).toBe("stream");
    });
  });

});
