import { describe, expect, test } from "bun:test";
import { isEligibleRecommendation, mergeRecommendationVideos, prepareRecommendationVideos } from "./recommendationsPageLogic";

const video = (
  videoId: string,
  options: { short?: number | null; live?: "none" | "upcoming" | "live" | "was_live"; watched?: number | null } = {},
) => ({
  video_id: videoId,
  is_short: options.short === undefined ? 0 : options.short,
  live_status: options.live ?? "none",
  watched: options.watched ?? null,
  status: "inbox" as const,
});

describe("recommendation page filtering", () => {
  test("keeps regular unwatched uploads", () => {
    expect(isEligibleRecommendation(video("regular"))).toBe(true);
  });

  test("excludes Shorts, unknown formats and every live format", () => {
    expect(isEligibleRecommendation(video("short", { short: 1 }))).toBe(false);
    expect(isEligibleRecommendation(video("unknown", { short: null }))).toBe(false);
    expect(isEligibleRecommendation(video("upcoming", { live: "upcoming" }))).toBe(false);
    expect(isEligibleRecommendation(video("live", { live: "live" }))).toBe(false);
    expect(isEligibleRecommendation(video("past-live", { live: "was_live" }))).toBe(false);
  });

  test("excludes completed videos but keeps a partially watched one", () => {
    expect(isEligibleRecommendation(video("completed", { watched: 1 }))).toBe(false);
    expect(isEligibleRecommendation({ ...video("scheduled"), status: "queued" })).toBe(false);
    const partial = { ...video("partial"), watch_position: 180, watch_duration: 900 };
    expect(isEligibleRecommendation(partial)).toBe(true);
  });

  test("preserves backend ranking while removing duplicates", () => {
    const result = prepareRecommendationVideos([
      video("first"),
      video("short", { short: 1 }),
      video("second"),
      video("first"),
    ]);
    expect(result.map((item) => item.video_id).join(",")).toBe("first,second");
  });

  test("deduplicates consecutive pages without reordering the first page", () => {
    const result = mergeRecommendationVideos(
      [video("first"), video("second")],
      [video("second"), video("third")],
    );
    expect(result.map((item) => item.video_id).join(",")).toBe("first,second,third");
  });
});
