import { describe, expect, test } from "bun:test";
import { resolvePlayerKind } from "./watchPlayerMode";

const base = {
  hasVideo: true,
  downloadStatus: null,
  playerSource: "auto" as const,
  playbackPolicyReady: true,
  childDownloadsOnly: false,
  sourceChoice: "undecided" as const,
  watchMode: "youtube" as const,
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

});
