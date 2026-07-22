import { describe, expect, test } from "bun:test";
import { normalizeSponsorSegments } from "./sponsorblock";

describe("SponsorBlock segment normalization", () => {
  test("keeps valid skip segments and accepts a lowercase API uuid", () => {
    const [segment] = normalizeSponsorSegments("video", [{
      category: "sponsor", actionType: "skip", segment: [10, 20], UUID: "", uuid: "lowercase-id",
    } as any]);
    expect(segment.UUID).toBe("lowercase-id");
    expect(JSON.stringify(segment.segment)).toBe(JSON.stringify([10, 20]));
  });

  test("creates a stable fallback id and rejects malformed ranges", () => {
    const segments = normalizeSponsorSegments("video", [
      { category: "intro", actionType: "skip", segment: [2, 8], UUID: "" },
      { category: "sponsor", actionType: "skip", segment: [20, 10], UUID: "bad" },
      { category: "chapter", actionType: "chapter", segment: [0, 5], UUID: "chapter" },
    ]);
    expect(segments.length).toBe(1);
    expect(segments[0].UUID).toBe("video:intro:2:8:0");
  });
});
